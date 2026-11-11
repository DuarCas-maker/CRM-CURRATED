import { createHash, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  bindingCommandV2Schema,
  bindingPageV2Schema,
  bindingResultV2Schema,
  checkCommandV2Schema,
  checkResultV2Schema,
} from "../../composio-bindings-v2";
import {
  bindingMessages,
  type BindingErrorCode,
} from "../../composio-bindings";
import { ComposioBindingError } from "./composio-binding";
import { serviceClient } from "../supabase";
import { mailQuotaEnabled } from "../mail-quota";
import {
  existingVerificationContext,
  existingVerificationHash,
  existingVerificationTarget,
  verifyExistingComposioBinding,
  type ExistingPermissionReceipt,
} from "./composio-existing-verifier";
import { createExistingComposioProvider } from "./composio-existing-provider";

export interface BindingV2Ports {
  enabled: boolean;
  checksEnabled: boolean;
  human: SupabaseClient;
  service(): SupabaseClient;
  descriptor(): unknown;
  apiKey(): string;
  fetchImpl: typeof fetch;
  now(): number;
}
const injection = new AsyncLocalStorage<BindingV2Ports>();
export function withBindingV2<T>(
  ports: BindingV2Ports,
  action: () => Promise<T>,
) {
  return injection.run(Object.freeze({ ...ports }), action);
}
export function bindingV2Enabled() {
  return (
    injection.getStore()?.enabled ??
    process.env.COMPOSIO_BINDING_V2_ENABLED === "true"
  );
}
export function bindingV2Ports(human: SupabaseClient): BindingV2Ports {
  const injected = injection.getStore();
  if (injected) return injected;
  return {
    enabled: bindingV2Enabled(),
    checksEnabled: process.env.COMPOSIO_BINDING_CHECKS_ENABLED === "true",
    human,
    service: serviceClient,
    descriptor: () => {
      try {
        return {
          context: JSON.parse(process.env.COMPOSIO_MAIL_CONTEXT ?? "{}"),
          auth_config_id: process.env.COMPOSIO_EXISTING_AUTH_CONFIG_ID,
        };
      } catch {
        throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
      }
    },
    apiKey: () => process.env.COMPOSIO_API_KEY ?? "",
    fetchImpl: (input, init) => fetch(input, init),
    now: Date.now,
  };
}
const descriptorSchema = z.strictObject({
  context: existingVerificationContext,
  auth_config_id: z.string().regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
});
async function rpc(
  db: SupabaseClient,
  name: string,
  input: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, input);
  if (error) {
    const code = Object.hasOwn(bindingMessages, error.message)
      ? (error.message as BindingErrorCode)
      : "C_BINDING_UNAVAILABLE";
    throw new ComposioBindingError(
      code,
      code === "C_BINDING_FORBIDDEN"
        ? 403
        : code === "C_BINDING_INVALID_INPUT"
          ? 400
          : code === "C_BINDING_UNAVAILABLE"
            ? 503
            : 409,
    );
  }
  return data;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value);
  if (!p.success) throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
  return p.data;
}
function enabled(p: BindingV2Ports) {
  if (!p.enabled) throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
}
async function authorize(p: BindingV2Ports, account: string) {
  enabled(p);
  await rpc(p.human, "composio_binding_authorize_v2", { account });
}
async function publish(p: BindingV2Ports, account: string) {
  await authorize(p, account);
  const d = parse(descriptorSchema, p.descriptor()),
    digest = existingVerificationHash(d.context)!;
  const service = p.service();
  await rpc(service, "composio_binding_check_context_v2", {
    account,
    auth_config: d.auth_config_id,
    context_document: JSON.stringify(d.context),
    context_digest: digest,
  });
  return { d, digest, service };
}
export async function bindingPageV2(
  p: BindingV2Ports,
  account: string,
  cursor: string | null,
  pageSize: number,
) {
  enabled(p);
  const page = parse(
    bindingPageV2Schema,
    await rpc(p.human, "composio_binding_page_v2", {
      account,
      cursor,
      page_size: pageSize,
    }),
  );
  if (page.account.id !== account)
    throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
  return {
    ...page,
    verification_available:
      page.verification_available && p.checksEnabled && mailQuotaEnabled(),
  };
}
export async function bindingCommandV2(
  p: BindingV2Ports,
  account: string,
  body: unknown,
) {
  const input = bindingCommandV2Schema.safeParse(body);
  if (!input.success)
    throw new ComposioBindingError("C_BINDING_INVALID_INPUT", 400);
  if (input.data.kind === "revoke_binding") await authorize(p, account);
  else await publish(p, account);
  return parse(
    bindingResultV2Schema,
    await rpc(p.human, "composio_binding_command_v2", {
      account,
      kind: input.data.kind,
      p: input.data.payload,
      request_key: input.data.idempotency_key,
    }),
  );
}
export async function bindingCheckV2(
  p: BindingV2Ports,
  account: string,
  body: unknown,
  signal?: AbortSignal,
) {
  const input = checkCommandV2Schema.safeParse(body);
  if (!input.success)
    throw new ComposioBindingError("C_BINDING_INVALID_INPUT", 400);
  await authorize(p, account);
  if (!p.checksEnabled || !mailQuotaEnabled() || signal?.aborted)
    throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
  const { d, digest, service } = await publish(p, account);
  const nonce = randomBytes(32).toString("hex"),
    nonceHash = createHash("sha256").update(nonce).digest("hex");
  const begun = parse(
    checkResultV2Schema,
    await rpc(p.human, "composio_binding_check_begin_v2", {
      account,
      binding: input.data.binding_id,
      expected: input.data.expected,
      context_digest: digest,
      nonce_hash: nonceHash,
      request_key: input.data.idempotency_key,
    }),
  );
  if (begun.replay || begun.status !== "prepared") return begun;
  const ticket = { check_id: begun.id, nonce, context_digest: digest };
  const snapshot = () =>
    rpc(service, "composio_binding_check_snapshot_v2", ticket);
  const target = parse(existingVerificationTarget, await snapshot());
  if (
    target.account_id !== account ||
    target.binding_id !== input.data.binding_id ||
    target.auth_config_id !== d.auth_config_id ||
    target.composio_project_id !== d.context.composio_project_id
  )
    throw new ComposioBindingError("C_BINDING_STALE");
  let step = 0;
  const provider = createExistingComposioProvider({
    apiKey: p.apiKey(),
    credentialVersion: d.context.credential_version,
    now: p.now,
    fetchImpl: p.fetchImpl,
    beforeRequest: async () => {
      if (signal?.aborted || !p.checksEnabled || !mailQuotaEnabled())
        throw new ComposioBindingError("C_BINDING_STALE");
      await authorize(p, account);
      const current = parse(descriptorSchema, p.descriptor());
      if (
        current.auth_config_id !== d.auth_config_id ||
        existingVerificationHash(current.context) !== digest
      )
        throw new ComposioBindingError("C_BINDING_STALE");
      if (
        (await rpc(service, "composio_binding_check_admit_v2", {
          ...ticket,
          step: ++step,
        })) !== true
      )
        throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
    },
  });
  let evidence: ExistingPermissionReceipt | null = null;
  const facts = await verifyExistingComposioBinding(
    target,
    {
      ...provider,
      now: p.now,
      context: () => parse(descriptorSchema, p.descriptor()).context,
      authorize: async (currentTarget, hash) => {
        if (
          !p.enabled ||
          !p.checksEnabled ||
          signal?.aborted ||
          hash !== digest
        )
          return false;
        try {
          await authorize(p, account);
          const current = parse(descriptorSchema, p.descriptor());
          if (
            current.auth_config_id !== currentTarget.auth_config_id ||
            existingVerificationHash(current.context) !== digest
          )
            return false;
          return (
            JSON.stringify(
              parse(existingVerificationTarget, await snapshot()),
            ) === JSON.stringify(currentTarget)
          );
        } catch {
          return false;
        }
      },
    },
    {
      signal,
      onEvidence: (value) => {
        evidence = value;
      },
    },
  );
  await authorize(p, account);
  const current = parse(descriptorSchema, p.descriptor());
  if (
    !p.checksEnabled ||
    !mailQuotaEnabled() ||
    current.auth_config_id !== d.auth_config_id ||
    existingVerificationHash(current.context) !== digest
  )
    throw new ComposioBindingError("C_BINDING_STALE");
  return parse(
    checkResultV2Schema,
    await rpc(service, "composio_binding_check_finish_v2", {
      ...ticket,
      facts,
      evidence,
    }),
  );
}
