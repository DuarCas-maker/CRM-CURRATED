import { z } from "zod";

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const instant = revision;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const nonce = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const connection = z.string().regex(/^ca_[A-Za-z0-9_-]{1,128}$/);
const owner = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);

export const connectErrorCodes = [
  "CONNECT_INVALID_INPUT",
  "CONNECT_FORBIDDEN",
  "CONNECT_NOT_FOUND",
  "CONNECT_STALE",
  "CONNECT_CONFLICT",
  "CONNECT_CLOSED",
  "CONNECT_NOT_READY",
  "CONNECT_UNAVAILABLE",
  "CONNECT_IDENTITY_MISMATCH",
  "CONNECT_NEEDS_RECONCILIATION",
] as const;
export type ConnectErrorCode = (typeof connectErrorCodes)[number];
const messages: Record<ConnectErrorCode, string> = {
  CONNECT_INVALID_INPUT: "Solicitud inválida. / Invalid request.",
  CONNECT_FORBIDDEN: "Sesión no autorizada. / Session not authorized.",
  CONNECT_NOT_FOUND: "Intento no disponible. / Attempt not available.",
  CONNECT_STALE:
    "El contexto cambió; vuelve a revisar. / Context changed; review again.",
  CONNECT_CONFLICT:
    "El intento ya está en proceso o la clave está en conflicto. / Attempt in progress or key conflict.",
  CONNECT_CLOSED: "El intento terminó o caducó. / Attempt closed or expired.",
  CONNECT_NOT_READY:
    "El intento aún no permite esta acción. / Attempt is not ready for this action.",
  CONNECT_UNAVAILABLE:
    "La operación no está disponible. / Operation unavailable.",
  CONNECT_IDENTITY_MISMATCH:
    "La identidad no coincide. / Identity does not match.",
  CONNECT_NEEDS_RECONCILIATION:
    "Resultado incierto; requiere conciliación. / Uncertain result; reconciliation required.",
};
export class ConnectError extends Error {
  readonly needsReconciliation: boolean;
  readonly beforeEmission: boolean;
  readonly ledgerRecorded: boolean | undefined;
  constructor(
    public readonly code: ConnectErrorCode,
    options: { beforeEmission?: boolean; ledgerRecorded?: boolean } = {},
  ) {
    super(messages[code]);
    this.name = "ConnectError";
    this.needsReconciliation = code === "CONNECT_NEEDS_RECONCILIATION";
    this.beforeEmission = options.beforeEmission ?? false;
    this.ledgerRecorded = options.ledgerRecorded;
  }
}

export const connectRequestSchema = z.strictObject({
  attempt_id: z.uuid(),
  expected_revision: revision,
  idempotency_key: z.uuid(),
  browser_proof: nonce,
});
export const connectResumeSchema = connectRequestSchema.pick({
  attempt_id: true,
  browser_proof: true,
});
export const connectCallbackSchema = connectRequestSchema
  .extend({
    state: nonce,
    status: z.enum(["success", "failed"]),
    connected_account_id: connection.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "success" && !value.connected_account_id)
      ctx.addIssue({
        code: "custom",
        path: ["connected_account_id"],
        message: "Connection required",
      });
  });
export type ConnectRequest = z.infer<typeof connectRequestSchema>;
export type ConnectCallback = z.infer<typeof connectCallbackSchema>;

// This is a normalized trusted-server port result, never a browser authorization assertion.
export const connectSessionSchema = z.strictObject({
  actor_id: z.uuid(),
  session_id: z.uuid(),
  role: z.enum([
    "superadmin",
    "seller_admin",
    "seller",
    "closer_admin",
    "closer",
  ]),
  active: z.boolean(),
  aal: z.enum(["aal1", "aal2"]),
  authorization_revision: revision,
  expires_at_ms: instant,
});
export type ConnectSession = z.infer<typeof connectSessionSchema>;
export const connectBindingSchema = z.strictObject({
  actor_id: z.uuid(),
  session_hash: digest,
  authorization_revision: revision,
  browser_hash: digest,
  state_hash: digest,
});
export type ConnectBinding = z.infer<typeof connectBindingSchema>;
export type ConnectAuthority = Pick<
  ConnectBinding,
  "actor_id" | "session_hash" | "authorization_revision" | "browser_hash"
>;
export const connectConfigSchema = z.strictObject({
  generation: revision.min(1),
  project_id: identifier.refine((s) => !/^(ac_|ca_)/.test(s)),
  auth_config_id: z.string().regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
  quota_project_id: identifier.nullable(),
  owner_id: owner,
  callback_mode: z.literal("standard"),
});
export type ConnectConfig = z.infer<typeof connectConfigSchema>;
export const connectStates = [
  "prepared",
  "link_pending",
  "awaiting_consent",
  "identity_checking",
  "awaiting_brand",
  "ready_to_register",
  "completed",
  "cancelled",
  "expired",
  "rejected",
  "uncertain",
] as const;
export type ConnectPhaseKind = "link" | "identity" | "registration";
const phaseSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["link", "identity", "registration"]),
  fingerprint: digest,
});

function hostedUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      u.origin === "https://connect.composio.dev" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      /^\/link\/[A-Za-z0-9_-]+$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
const navigationSchema = z.strictObject({
  url: z.string().max(4096).refine(hostedUrl),
  expires_at_ms: instant,
});
export const connectAttemptSchema = z
  .strictObject({
    id: z.uuid(),
    revision,
    state: z.enum(connectStates),
    created_at_ms: instant,
    deadline_ms: instant,
    account_id: z.uuid(),
    brand_id: z.uuid(),
    expected_mailbox_email: z
      .email()
      .max(254)
      .refine((s) => s === s.trim().toLowerCase()),
    binding: connectBindingSchema,
    config: connectConfigSchema,
    context_hash: digest,
    phase: phaseSchema.nullable(),
    connection_id: connection.nullable(),
    navigation: navigationSchema.nullable(),
    binding_id: z.uuid().nullable(),
    cleanup_required: z.boolean(),
  })
  .superRefine((a, ctx) => {
    const bad = () =>
      ctx.addIssue({ code: "custom", message: "Inconsistent persisted state" });
    if (
      a.deadline_ms <= a.created_at_ms ||
      a.deadline_ms - a.created_at_ms > 600_000
    )
      bad();
    if (
      a.navigation &&
      (!a.connection_id || a.navigation.expires_at_ms < a.deadline_ms)
    )
      bad();
    if (
      a.state === "prepared" &&
      (a.phase || a.connection_id || a.navigation || a.binding_id)
    )
      bad();
    if (a.state === "link_pending" && a.phase?.kind !== "link") bad();
    if (
      a.state === "link_pending" &&
      (a.connection_id || a.navigation || a.binding_id)
    )
      bad();
    if (
      a.state === "identity_checking" &&
      (a.phase?.kind !== "identity" || !a.connection_id)
    )
      bad();
    if (
      a.state === "awaiting_consent" &&
      (!a.connection_id || !a.navigation || a.phase)
    )
      bad();
    if (
      a.state === "completed" &&
      (!a.binding_id || !a.connection_id || a.phase || a.navigation)
    )
      bad();
    if (
      ["awaiting_brand", "ready_to_register"].includes(a.state) &&
      (!a.connection_id || a.navigation || a.binding_id)
    )
      bad();
    if (
      ["cancelled", "expired", "rejected", "uncertain"].includes(a.state) &&
      (a.phase || a.navigation || a.binding_id)
    )
      bad();
    if (a.state === "uncertain" && !a.cleanup_required) bad();
    if (a.state !== "completed" && a.binding_id) bad();
    if (a.state === "awaiting_brand" && a.phase) bad();
    if (a.phase?.kind === "link" && a.state !== "link_pending") bad();
    if (a.phase?.kind === "identity" && a.state !== "identity_checking") bad();
    if (a.phase?.kind === "registration" && a.state !== "ready_to_register")
      bad();
  });
export type ConnectAttempt = z.infer<typeof connectAttemptSchema>;
export const connectSnapshotSchema = z.strictObject({
  attempt: connectAttemptSchema,
  current_context_hash: digest,
});
export type ConnectSnapshot = z.infer<typeof connectSnapshotSchema>;
export const connectLeaseSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["link", "identity", "registration"]),
  fingerprint: digest,
  revision,
  capability: nonce,
  callback_state: nonce.nullable(),
});
export type ConnectLease = z.infer<typeof connectLeaseSchema>;
export const connectReceiptSchema = z.strictObject({
  kind: z.enum(["absent", "replay", "conflict"]),
});
export const connectClaimSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("claimed"),
    snapshot: connectSnapshotSchema,
    lease: connectLeaseSchema,
  }),
  z.strictObject({ kind: z.literal("replay") }),
  z.strictObject({ kind: z.literal("conflict") }),
]);

// Internal normalized facts only; this is not a claim about the external wire schema.
export const connectLinkSchema = navigationSchema.extend({
  connected_account_id: connection,
});
export type ConnectLink = z.infer<typeof connectLinkSchema>;
export const connectIdentitySchema = z.strictObject({
  connected_account_id: connection,
  project_id: identifier,
  auth_config_id: z.string().regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
  owner_id: owner,
  primary_email: z.string().trim().pipe(z.email().max(254)),
  toolkit: z.string().max(64),
  active: z.boolean(),
});
export type ConnectIdentity = z.infer<typeof connectIdentitySchema>;

export interface ConnectStoreCommand {
  attempt_id: string;
  expected_revision: number;
  idempotency_key: string;
  fingerprint: string;
  command: "start" | "callback" | "cancel" | "register";
  authority: ConnectAuthority;
  expected_context_hash: string;
}
export interface ConnectLeaseCommand {
  command: ConnectStoreCommand;
  lease: ConnectLease;
}
export interface ConnectStore {
  // A real adapter MUST authorize/validate current session and CAS atomically, not trust supplied flags.
  load(input: {
    attempt_id: string;
    authority: ConnectAuthority;
  }): Promise<unknown>;
  lookupReceipt(input: ConnectStoreCommand): Promise<unknown>;
  claimPhase(
    input: ConnectStoreCommand & { phase: ConnectPhaseKind },
  ): Promise<unknown>;
  saveLink(
    input: ConnectLeaseCommand & { link: ConnectLink; deadline_ms: number },
  ): Promise<unknown>;
  finishIdentity(
    input: ConnectLeaseCommand & { identity: ConnectIdentity },
  ): Promise<unknown>;
  releaseClaim(input: ConnectLeaseCommand): Promise<void>;
  reject(input: {
    command: ConnectStoreCommand;
    lease?: ConnectLease;
    reason: "provider_cancelled" | "identity_mismatch";
  }): Promise<unknown>;
  cancel(input: ConnectStoreCommand): Promise<unknown>;
  registerCandidate(input: ConnectLeaseCommand): Promise<unknown>;
  // These are capability-bound negative ledgers: they never reactivate terminal attempts.
  markUncertain(input: {
    attempt_id: string;
    lease: ConnectLease;
    reason: "provider_unknown" | "save_failed";
    observed_connection_id?: string;
  }): Promise<void>;
  recordResidual(input: {
    attempt_id: string;
    lease: ConnectLease;
    reason: "late_result" | "verification_unavailable";
    connection_id?: string;
  }): Promise<void>;
}
export interface ConnectProvider {
  createLink(input: {
    attempt_id: string;
    project_id: string;
    auth_config_id: string;
    owner_id: string;
    callback_url: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  readIdentity(input: {
    connected_account_id: string;
    project_id: string;
    auth_config_id: string;
    owner_id: string;
    signal: AbortSignal;
  }): Promise<unknown>;
}
export interface ConnectClock {
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}
export interface ConnectDependencies {
  session: { readCurrent(): Promise<unknown> };
  store: ConnectStore;
  provider: ConnectProvider;
  clock: ConnectClock;
  callbackOrigin: string;
}

export function connectStatus(a: ConnectAttempt) {
  const next =
    a.state === "prepared"
      ? "authorize"
      : a.state === "awaiting_consent"
        ? "resume"
        : a.state === "awaiting_brand"
          ? "review_brand"
          : a.state === "ready_to_register" && !a.phase
            ? "register_candidate"
            : a.state === "uncertain"
              ? "reconcile"
              : a.phase
                ? "wait"
                : "none";
  return {
    id: a.id,
    revision: a.revision,
    state: a.state,
    deadline_ms: a.deadline_ms,
    account_id: a.account_id,
    brand_id: a.brand_id,
    binding_id: a.binding_id,
    cleanup_required: a.cleanup_required,
    composio_enabled: false as const,
    next,
  };
}
export type ConnectStatus = ReturnType<typeof connectStatus>;
