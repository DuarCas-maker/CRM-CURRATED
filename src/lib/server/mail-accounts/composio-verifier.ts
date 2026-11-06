import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";

// Internal normalized contracts only. No provider SDK, URL, environment or transport factory.
const text = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const owner = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
const scopes = z.array(z.string().min(1).max(256)).max(64);
export const requiredComposioScopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;
export const verificationContextSchema = z.strictObject({
  composio_project_id: id,
  credential_version: text,
  google_quota_project_id: id,
  auth_config_revision: text,
  provenance_reference: text,
  project_provenance: z.literal("server_reviewed"),
  quota_provenance: z.literal("oauth_client_reviewed"),
});
export type VerificationContext = z.infer<typeof verificationContextSchema>;
export const verificationTargetSchema = z.strictObject({
  account_id: z.uuid(),
  binding_id: z.uuid(),
  composio_project_id: id,
  auth_config_id: z.string().regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
  connected_account_id: z.string().regex(/^ca_[A-Za-z0-9_-]{1,128}$/),
  composio_user_id: owner,
  google_quota_project_id: id,
  expected_mailbox_email: z.email().max(254),
});
export type VerificationTarget = z.infer<typeof verificationTargetSchema>;
const connectionSchema = z.strictObject({
  id: id,
  auth_config_id: id,
  user_id: owner,
  toolkit: text,
  status: text,
  disabled: z.boolean(),
  effective_grants: z
    .strictObject({
      connected_account_id: id,
      auth_config_id: id,
      user_id: owner,
      scopes,
      provenance_reference: text,
      source: z.literal("effective_grants"),
    })
    .nullable(),
});
const configSchema = z.strictObject({
  id,
  toolkit: text,
  enabled: z.boolean(),
  revision: text,
  declared_scopes: scopes,
});
const profileSchema = z.strictObject({
  connected_account_id: id,
  primary_email: z.string().trim().pipe(z.email().max(254)),
});
export const verificationFactsSchema = z.strictObject({
  project: z.boolean(),
  config: z.boolean(),
  connection: z.boolean(),
  owner: z.boolean(),
  toolkit: z.boolean(),
  active: z.boolean(),
  mailbox: z.boolean(),
  permissions: z.boolean(),
  quota: z.boolean(),
  configuration: z.boolean(),
  reason: z
    .enum([
      "identity_mismatch",
      "verification_incomplete",
      "provider_unavailable",
      "permission_unproven",
      "stale_context",
    ])
    .nullable(),
});
export type VerificationFacts = z.infer<typeof verificationFactsSchema>;
export interface ComposioVerificationDependencies {
  connection(input: { id: string; signal: AbortSignal }): Promise<unknown>;
  authConfig(input: { id: string; signal: AbortSignal }): Promise<unknown>;
  profile(input: {
    connectedAccountId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
}
export interface VerificationTiming {
  now(): number;
  schedule(ms: number, callback: () => void): () => void;
}
const realTiming: VerificationTiming = {
  now: () => performance.now(),
  schedule: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};
export function verificationContextHash(input: unknown): string | null {
  const parsed = verificationContextSchema.safeParse(input);
  if (!parsed.success) return null;
  // Explicit order, independent of input key order; never a hash of credentials.
  const c = parsed.data;
  return createHash("sha256")
    .update(
      JSON.stringify([
        c.composio_project_id,
        c.credential_version,
        c.google_quota_project_id,
        c.auth_config_revision,
        c.provenance_reference,
        c.project_provenance,
        c.quota_provenance,
      ]),
    )
    .digest("hex");
}
export function incompleteVerification(
  reason: VerificationFacts["reason"] = "verification_incomplete",
): VerificationFacts {
  return {
    project: false,
    config: false,
    connection: false,
    owner: false,
    toolkit: false,
    active: false,
    mailbox: false,
    permissions: false,
    quota: false,
    configuration: false,
    reason,
  };
}
export function verificationPassed(facts: VerificationFacts): boolean {
  return (
    facts.reason === null &&
    Object.entries(facts).every(
      ([key, value]) => key === "reason" || value === true,
    )
  );
}
function bounded<T>(schema: z.ZodType<T>, value: unknown): T {
  const json = JSON.stringify(value);
  if (typeof json !== "string" || Buffer.byteLength(json) > 256 * 1024)
    throw new Error("invalid_normalized_response");
  return schema.parse(value);
}
async function timed<T>(
  read: (signal: AbortSignal) => Promise<T>,
  limit: number,
  timing: VerificationTiming,
  outer?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let cancel = () => {},
    detach = () => {};
  try {
    if (outer?.aborted || limit <= 0)
      throw new Error("verification_unavailable");
    return await Promise.race([
      new Promise<never>((_, reject) => {
        const abort = () => {
          controller.abort();
          reject(new Error("verification_unavailable"));
        };
        cancel = timing.schedule(limit, abort);
        outer?.addEventListener("abort", abort, { once: true });
        detach = () => outer?.removeEventListener("abort", abort);
      }),
      Promise.resolve().then(() => {
        if (controller.signal.aborted)
          throw new Error("verification_unavailable");
        return read(controller.signal);
      }),
    ]);
  } finally {
    cancel();
    detach();
    controller.abort();
  }
}
export async function verifyComposioBinding(
  targetInput: unknown,
  contextInput: unknown,
  dependencies: ComposioVerificationDependencies,
  options: { signal?: AbortSignal; timing?: VerificationTiming } = {},
): Promise<VerificationFacts> {
  const facts = incompleteVerification();
  const target = verificationTargetSchema.safeParse(targetInput),
    context = verificationContextSchema.safeParse(contextInput);
  if (!target.success || !context.success) return facts;
  const t = target.data,
    c = context.data,
    timing = options.timing ?? realTiming;
  facts.project = t.composio_project_id === c.composio_project_id;
  facts.quota = t.google_quota_project_id === c.google_quota_project_id;
  if (!facts.project || !facts.quota) return facts;
  const started = timing.now();
  const read = async <T>(
    fn: (signal: AbortSignal) => Promise<unknown>,
    schema: z.ZodType<T>,
  ) => {
    const stepStarted = timing.now();
    const value = await timed(
      fn,
      Math.min(10000, 30000 - (stepStarted - started)),
      timing,
      options.signal,
    );
    // A synchronous dependency can delay the timer queue; elapsed time still closes the result.
    if (
      timing.now() - stepStarted >= 10000 ||
      timing.now() - started >= 30000 ||
      options.signal?.aborted
    )
      throw new Error("verification_unavailable");
    return bounded(schema, value);
  };
  try {
    const connection = await read(
      (signal) =>
        dependencies.connection({ id: t.connected_account_id, signal }),
      connectionSchema,
    );
    facts.connection = connection.id === t.connected_account_id;
    facts.config = connection.auth_config_id === t.auth_config_id;
    facts.owner = connection.user_id === t.composio_user_id;
    facts.toolkit = connection.toolkit === "gmail";
    facts.active = connection.status === "ACTIVE" && !connection.disabled;
    if (
      ![
        facts.connection,
        facts.config,
        facts.owner,
        facts.toolkit,
        facts.active,
      ].every(Boolean)
    )
      return { ...facts, reason: "identity_mismatch" };
    const config = await read(
      (signal) => dependencies.authConfig({ id: t.auth_config_id, signal }),
      configSchema,
    );
    facts.config = config.id === t.auth_config_id;
    facts.toolkit = facts.toolkit && config.toolkit === "gmail";
    facts.active = facts.active && config.enabled;
    facts.configuration = config.revision === c.auth_config_revision;
    if (
      ![facts.config, facts.toolkit, facts.active, facts.configuration].every(
        Boolean,
      )
    )
      return { ...facts, reason: "identity_mismatch" };
    const grants = connection.effective_grants;
    facts.permissions =
      !!grants &&
      grants.connected_account_id === t.connected_account_id &&
      grants.auth_config_id === t.auth_config_id &&
      grants.user_id === t.composio_user_id &&
      requiredComposioScopes.every(
        (s) => config.declared_scopes.includes(s) && grants.scopes.includes(s),
      );
    if (!facts.permissions) return { ...facts, reason: "permission_unproven" };
    const profile = await read(
      (signal) =>
        dependencies.profile({
          connectedAccountId: t.connected_account_id,
          signal,
        }),
      profileSchema,
    );
    facts.mailbox =
      profile.connected_account_id === t.connected_account_id &&
      profile.primary_email.toLowerCase() ===
        t.expected_mailbox_email.trim().toLowerCase();
    facts.reason = facts.mailbox ? null : "identity_mismatch";
    return facts;
  } catch (error) {
    // Never persist/propagate provider messages, responses or details of Zod input.
    facts.reason =
      error instanceof z.ZodError ||
      (error instanceof Error &&
        error.message === "invalid_normalized_response")
        ? "verification_incomplete"
        : "provider_unavailable";
    return facts;
  }
}
