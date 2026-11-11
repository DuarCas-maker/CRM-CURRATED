import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  verificationContextV2Schema as existingVerificationContext,
  verificationContextV2Hash as existingVerificationHash,
} from "../mail-transport/verification-context-v2";
export {
  verificationContextV2Schema as existingVerificationContext,
  verificationContextV2Hash as existingVerificationHash,
} from "../mail-transport/verification-context-v2";
import { reserveGmailQuota } from "../mail-quota";
import { requiredComposioScopes } from "./composio-verifier";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const version = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const owner = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
export const existingVerificationTarget = z.strictObject({
  contract_version: z.literal(2),
  account_id: z.uuid(),
  binding_id: z.uuid(),
  binding_revision: z.number().int().positive(),
  composio_project_id: id,
  auth_config_id: z.string().regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
  connected_account_id: z.string().regex(/^ca_[A-Za-z0-9_-]{1,128}$/),
  composio_user_id: owner,
  quota_policy_id: z.uuid(),
  quota_policy_generation: z.number().int().positive(),
  expected_mailbox_email: z.email().max(254),
});
export const existingConnection = z.strictObject({
  id,
  auth_config_id: id,
  user_id: owner,
  toolkit: z.string(),
  status: z.string(),
  disabled: z.boolean(),
  revision: version,
});
export const existingConfig = z.strictObject({
  id,
  toolkit: z.string(),
  enabled: z.boolean(),
  revision: version,
});
const grants = z.strictObject({
  source: z.literal("reviewed_effective_grants"),
  contract_reference: version,
  connected_account_id: id,
  auth_config_id: id,
  user_id: owner,
  connection_revision: version,
  credential_version: version,
  observed_at_ms: z.number().int().nonnegative(),
  expires_at_ms: z.number().int().positive(),
  scopes: z.array(z.string().min(1).max(256)).max(64),
});
type Target = z.infer<typeof existingVerificationTarget>;
export interface ExistingVerificationPorts {
  // Trusted server ports only. Not browser input, Auth Config scopes or a UI assertion.
  context(): unknown;
  authorize(target: Readonly<Target>, contextHash: string): Promise<boolean>;
  now(): number;
  connection(input: { id: string; signal: AbortSignal }): Promise<unknown>;
  authConfig(input: { id: string; signal: AbortSignal }): Promise<unknown>;
  effectiveGrants(input: {
    target: Readonly<Target>;
    connectionRevision: string;
    deadlineMs: number;
    authorize(): Promise<void>;
    signal: AbortSignal;
  }): Promise<unknown>;
  profile(input: {
    connectedAccountId: string;
    userId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
}
export type ExistingVerificationFacts = {
  contract_version: 2;
  project: boolean;
  config: boolean;
  connection: boolean;
  owner: boolean;
  toolkit: boolean;
  active: boolean;
  mailbox: boolean;
  permissions: boolean;
  quota_policy: boolean;
  configuration: boolean;
  reason:
    | null
    | "identity_mismatch"
    | "verification_incomplete"
    | "permission_unproven"
    | "stale_context"
    | "provider_unavailable";
};
export const permissionReceiptSchema = z.strictObject({
  source: z.literal("google-tokeninfo-proxy-v1"),
  observed_at_ms: z.number().int().nonnegative(),
  valid_until_ms: z.number().int().positive(),
});
export type ExistingPermissionReceipt = z.infer<typeof permissionReceiptSchema>;
export function existingVerificationPassed(f: ExistingVerificationFacts) {
  return (
    f.reason === null &&
    Object.entries(f).every(
      ([k, v]) => k === "contract_version" || k === "reason" || v === true,
    )
  );
}
class Stale extends Error {}
class GrantExpired extends Error {}
export async function verifyExistingComposioBinding(
  targetInput: unknown,
  ports: ExistingVerificationPorts,
  options: {
    signal?: AbortSignal;
    onEvidence?(receipt: ExistingPermissionReceipt): void;
  } = {},
): Promise<ExistingVerificationFacts> {
  const f: ExistingVerificationFacts = {
    contract_version: 2,
    project: false,
    config: false,
    connection: false,
    owner: false,
    toolkit: false,
    active: false,
    mailbox: false,
    permissions: false,
    quota_policy: false,
    configuration: false,
    reason: "verification_incomplete",
  };
  const t = existingVerificationTarget.safeParse(targetInput),
    c = existingVerificationContext.safeParse(ports.context());
  if (!t.success || !c.success) return f;
  const target = Object.freeze(t.data),
    context = c.data,
    hash = existingVerificationHash(context)!;
  const started = ports.now(),
    deadline = started + 30000;
  let grantDeadline: number | null = null;
  const fresh = async () => {
    if (grantDeadline !== null && ports.now() >= grantDeadline)
      throw new GrantExpired();
    if (
      options.signal?.aborted ||
      !Number.isSafeInteger(ports.now()) ||
      ports.now() >= deadline ||
      existingVerificationHash(ports.context()) !== hash ||
      !(await ports.authorize(target, hash))
    )
      throw new Stale();
    if (
      ports.now() >= deadline ||
      options.signal?.aborted ||
      existingVerificationHash(ports.context()) !== hash
    )
      throw new Stale();
    if (grantDeadline !== null && ports.now() >= grantDeadline)
      throw new GrantExpired();
  };
  const read = async <T>(
    fn: (signal: AbortSignal) => Promise<unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> => {
    await fresh();
    const step = ports.now(),
      controller = new AbortController();
    const stop = () => controller.abort();
    options.signal?.addEventListener("abort", stop, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => fn(controller.signal)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort();
              reject(new Error("timeout"));
            },
            Math.min(10000, deadline - ports.now()),
          );
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
      ]);
      await fresh();
      if (ports.now() - step >= 10000) throw new Error("timeout");
      const encoded = JSON.stringify(value);
      if (!encoded || Buffer.byteLength(encoded) > 256 * 1024)
        throw new z.ZodError([]);
      return schema.parse(value);
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", stop);
      controller.abort();
    }
  };
  try {
    await fresh();
    f.project = target.composio_project_id === context.composio_project_id;
    f.quota_policy =
      context.policy.state === "enabled" &&
      target.quota_policy_id === context.policy.policy_id &&
      target.quota_policy_generation === context.policy.generation;
    if (!f.project || !f.quota_policy) {
      f.reason = "stale_context";
      return f;
    }
    const conn = await read(
      (s) => ports.connection({ id: target.connected_account_id, signal: s }),
      existingConnection,
    );
    f.connection = conn.id === target.connected_account_id;
    f.owner = conn.user_id === target.composio_user_id;
    f.config = conn.auth_config_id === target.auth_config_id;
    f.toolkit = conn.toolkit === "gmail";
    f.active = conn.status === "ACTIVE" && !conn.disabled;
    if (
      ![f.connection, f.owner, f.config, f.toolkit, f.active].every(Boolean)
    ) {
      f.reason = "identity_mismatch";
      return f;
    }
    const config = await read(
      (s) => ports.authConfig({ id: target.auth_config_id, signal: s }),
      existingConfig,
    );
    f.config = f.config && config.id === target.auth_config_id;
    f.toolkit = f.toolkit && config.toolkit === "gmail";
    f.active = f.active && config.enabled;
    f.configuration = config.revision === context.auth_config_revision;
    if (![f.config, f.toolkit, f.active, f.configuration].every(Boolean)) {
      f.reason = "stale_context";
      return f;
    }
    const grant = await read(
      (s) =>
        ports.effectiveGrants({
          target,
          connectionRevision: conn.revision,
          deadlineMs: deadline,
          authorize: fresh,
          signal: s,
        }),
      grants.nullable(),
    );
    f.permissions =
      !!grant &&
      grant.connected_account_id === conn.id &&
      grant.auth_config_id === config.id &&
      grant.user_id === conn.user_id &&
      grant.connection_revision === conn.revision &&
      grant.credential_version === context.credential_version &&
      grant.observed_at_ms <= ports.now() &&
      grant.observed_at_ms >= started - 30000 &&
      grant.expires_at_ms > ports.now() &&
      grant.expires_at_ms - grant.observed_at_ms <= 60000 &&
      requiredComposioScopes.every((scope) => grant.scopes.includes(scope));
    if (!f.permissions) {
      f.reason = "permission_unproven";
      return f;
    }
    grantDeadline = grant!.expires_at_ms;
    const lease = await reserveGmailQuota({
      account: target.account_id,
      provider: "composio",
      path: "profile",
      key: randomUUID(),
      deadline: new Date(deadline).toISOString(),
      signal: options.signal,
      requiresV2: true,
      authorize: fresh,
      legacy: async () => {
        throw new Stale();
      },
    });
    const profile = await read(
      (s) =>
        lease.emit(() =>
          ports.profile({
            connectedAccountId: target.connected_account_id,
            userId: target.composio_user_id,
            signal: s,
          }),
        ),
      z.strictObject({
        connected_account_id: id,
        primary_email: z.string().trim().pipe(z.email().max(254)),
      }),
    );
    f.mailbox =
      profile.connected_account_id === conn.id &&
      profile.primary_email.toLowerCase() ===
        target.expected_mailbox_email.toLowerCase();
    await fresh();
    if (grant!.expires_at_ms <= ports.now()) {
      f.permissions = false;
      f.reason = "permission_unproven";
      return f;
    }
    f.reason = f.mailbox ? null : "identity_mismatch";
    if (
      f.reason === null &&
      grant!.contract_reference === "google-tokeninfo-proxy-v1"
    )
      options.onEvidence?.(
        Object.freeze({
          source: "google-tokeninfo-proxy-v1",
          observed_at_ms: grant!.observed_at_ms,
          valid_until_ms: grant!.expires_at_ms,
        }),
      );
    return f;
  } catch (error) {
    if (error instanceof GrantExpired) f.permissions = false;
    f.reason =
      error instanceof GrantExpired
        ? "permission_unproven"
        : error instanceof Stale
          ? "stale_context"
          : error instanceof z.ZodError
            ? "verification_incomplete"
            : "provider_unavailable";
    return f;
  }
}
