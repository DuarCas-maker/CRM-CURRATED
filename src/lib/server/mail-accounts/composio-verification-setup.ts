import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bindingExpected } from "../../composio-bindings";
import { bindingPageV2Schema } from "../../composio-bindings-v2";
import {
  verificationSetupCommandSchema,
  verificationSetupPageSchema,
  verificationSetupMessages,
  type VerificationSetupErrorCode,
} from "../../composio-verification-setup";
import { mailQuotaPolicySchema } from "../../mail-quota-policy";
import { HttpError } from "../supabase";
import { mailQuotaEnabled } from "../mail-quota";
import { bindingV2Ports, type BindingV2Ports } from "./composio-binding-v2";
import {
  existingVerificationContext,
  existingVerificationHash,
} from "./composio-existing-verifier";

export interface VerificationSetupPorts {
  enabled: boolean;
  targetAccount: string | null;
  quotaEnabled: boolean;
  binding: BindingV2Ports;
}
const injection = new AsyncLocalStorage<VerificationSetupPorts>();
export function withVerificationSetup<T>(
  ports: VerificationSetupPorts,
  action: () => Promise<T>,
) {
  return injection.run(ports, action);
}
export function verificationSetupEnabled() {
  return (
    injection.getStore()?.enabled ??
    process.env.COMPOSIO_VERIFIER_SETUP_ENABLED === "true"
  );
}
export function verificationSetupPorts(
  human: SupabaseClient,
): VerificationSetupPorts {
  return (
    injection.getStore() ?? {
      enabled: verificationSetupEnabled(),
      targetAccount: process.env.COMPOSIO_VERIFIER_ACCOUNT_ID ?? null,
      quotaEnabled: mailQuotaEnabled(),
      binding: bindingV2Ports(human),
    }
  );
}
export class VerificationSetupError extends HttpError {
  constructor(
    public readonly code: VerificationSetupErrorCode,
    status = 409,
  ) {
    super(status, verificationSetupMessages[code].join(" / "));
  }
}
function gate(p: VerificationSetupPorts, account: string) {
  if (
    !p.enabled ||
    !p.binding.enabled ||
    !z.uuid().safeParse(p.targetAccount).success ||
    p.targetAccount !== account
  )
    throw new VerificationSetupError("SETUP_UNAVAILABLE", 404);
}
async function rpc(
  db: SupabaseClient,
  name: string,
  input: Record<string, unknown> = {},
) {
  const { data, error } = await db.rpc(name, input);
  if (error) {
    const msg = error.message;
    if (msg === "C_BINDING_FORBIDDEN" || msg === "QGR_FORBIDDEN")
      throw new VerificationSetupError("SETUP_FORBIDDEN", 403);
    if (typeof msg === "string" && /^(QGR_|C_BINDING_)/.test(msg))
      throw new VerificationSetupError("SETUP_CONFLICT");
    throw new VerificationSetupError("SETUP_UNAVAILABLE", 503);
  }
  return data;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new VerificationSetupError("SETUP_UNAVAILABLE", 503);
  return parsed.data;
}
const descriptorSchema = z.strictObject({
  context: existingVerificationContext,
  auth_config_id: z.string().regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
});
const snapshotSchema = z.strictObject({
  closed: z.boolean(),
  policy: mailQuotaPolicySchema.nullable(),
});
async function page(p: VerificationSetupPorts, account: string) {
  const value = parse(
    bindingPageV2Schema,
    await rpc(p.binding.human, "composio_binding_page_v2", {
      account,
      cursor: null,
      page_size: 1,
    }),
  );
  if (value.account.id !== account)
    throw new VerificationSetupError("SETUP_UNAVAILABLE", 503);
  return value;
}
function revision(
  d: z.infer<typeof descriptorSchema>,
  a: Awaited<ReturnType<typeof page>>,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        existingVerificationHash(d.context),
        d.auth_config_id,
        a.account.id,
        bindingExpected(a),
        a.current && [
          a.current.id,
          a.current.revision,
          a.current.status,
          a.current.stale,
        ],
        a.account.ready,
        a.latest_check && [
          a.latest_check.id,
          a.latest_check.status,
          a.latest_check.valid_until,
        ],
      ]),
    )
    .digest("hex");
}
async function review(p: VerificationSetupPorts, account: string) {
  gate(p, account);
  await rpc(p.binding.human, "composio_binding_authorize_v2", { account });
  const d = parse(descriptorSchema, p.binding.descriptor());
  if (d.context.policy.state !== "enabled")
    throw new VerificationSetupError("SETUP_CONFLICT");
  const a = await page(p, account);
  const snapshot = parse(
    snapshotSchema,
    await rpc(p.binding.service(), "mail_quota_snapshot"),
  );
  if (snapshot.closed) throw new VerificationSetupError("SETUP_CONFLICT");
  const policy = d.context.policy;
  const ready = JSON.stringify(snapshot.policy) === JSON.stringify(policy);
  const expected = snapshot.policy?.generation ?? 0;
  const checks = p.binding.checksEnabled && p.quotaEnabled;
  return {
    d,
    a,
    snapshot,
    result: parse(verificationSetupPageSchema, {
      account_id: account,
      setup_revision: revision(d, a),
      policy: {
        expected_generation: expected,
        proposed_generation: policy.generation,
        limits: policy.limits,
        ready,
        can_publish:
          !ready &&
          policy.generation === expected + 1 &&
          (!snapshot.policy || snapshot.policy.policy_id === policy.policy_id),
      },
      candidate_id: a.current?.id ?? null,
      can_grant:
        ready &&
        checks &&
        a.account.ready &&
        !!a.current &&
        ["candidate", "blocked"].includes(a.current.status) &&
        !a.current.stale &&
        !a.latest_check &&
        a.policy?.enabled === true &&
        a.policy.id === policy.policy_id &&
        a.policy.generation === policy.generation,
      verification_available: a.verification_available && checks,
      checks_enabled: checks,
      transport: "gmail_oauth",
      composio_enabled: false,
    }),
  };
}
export async function verificationSetupPage(
  p: VerificationSetupPorts,
  account: string,
) {
  return (await review(p, account)).result;
}
export async function verificationSetupCommand(
  p: VerificationSetupPorts,
  account: string,
  body: unknown,
) {
  gate(p, account);
  const input = verificationSetupCommandSchema.safeParse(body);
  if (!input.success)
    throw new VerificationSetupError("SETUP_INVALID_INPUT", 400);
  const b = input.data,
    r = await review(p, account);
  if (b.setup_revision !== r.result.setup_revision)
    throw new VerificationSetupError("SETUP_STALE");
  // Reauthorize and recheck mutable server configuration before the human RPC.
  await rpc(p.binding.human, "composio_binding_authorize_v2", { account });
  gate(p, account);
  const currentDescriptor = parse(descriptorSchema, p.binding.descriptor());
  if (revision(currentDescriptor, await page(p, account)) !== b.setup_revision)
    throw new VerificationSetupError("SETUP_STALE");
  if (b.action === "publish_policy") {
    if (
      r.d.context.policy.generation !== b.expected_generation + 1 ||
      (!r.result.policy.can_publish && !r.result.policy.ready)
    )
      throw new VerificationSetupError("SETUP_CONFLICT");
    const result = parse(
      z.strictObject({
        policy_id: z.uuid(),
        generation: z.number().int(),
        state: z.literal("enabled"),
        group_scope: z.literal("gmail:crm:shared"),
      }),
      await rpc(p.binding.human, "mail_quota_publish", {
        value: r.d.context.policy,
        expected_generation: b.expected_generation,
        quiescent: true,
        request_key: b.idempotency_key,
      }),
    );
    if (
      result.policy_id !== r.d.context.policy.policy_id ||
      result.generation !== r.d.context.policy.generation
    )
      throw new VerificationSetupError("SETUP_UNAVAILABLE", 503);
  } else {
    if (
      !p.binding.checksEnabled ||
      !p.quotaEnabled ||
      !r.result.can_grant ||
      b.binding_id !== r.result.candidate_id
    )
      throw new VerificationSetupError("SETUP_CONFLICT");
    const remaining = Date.parse(b.expires_at) - p.binding.now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 600000)
      throw new VerificationSetupError("SETUP_INVALID_INPUT", 400);
    await rpc(p.binding.human, "composio_binding_budget_v2", {
      account,
      context_digest: existingVerificationHash(r.d.context),
      maximum: 4,
      expires_at: b.expires_at,
      request_key: b.idempotency_key,
      included_confirmed: true,
    });
  }
  return {
    action: b.action,
    saved: true as const,
    transport: "gmail_oauth" as const,
    composio_enabled: false as const,
  };
}
export function verificationSetupJsonError(error: unknown) {
  const status =
    error instanceof HttpError &&
    [400, 401, 403, 404, 409, 413].includes(error.status)
      ? error.status
      : 503;
  const code =
    error instanceof VerificationSetupError
      ? error.code
      : status === 401 || status === 403
        ? "SETUP_FORBIDDEN"
        : status === 400 || status === 413
          ? "SETUP_INVALID_INPUT"
          : "SETUP_UNAVAILABLE";
  return Response.json(
    { code, error: verificationSetupMessages[code].join(" / ") },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
