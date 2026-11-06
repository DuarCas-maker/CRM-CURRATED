import { z } from "zod";
import type { Locale } from "./domain";

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = revision.min(1);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const project = identifier.refine((v) => !/^(ac_|ca_)/.test(v));
const userId = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
const expected = {
  expected_head_revision: revision,
  expected_account_revision: revision,
  expected_brand_revision: revision,
  expected_context_hash: digest,
};
export const bindingStatuses = [
  "candidate",
  "verified",
  "blocked",
  "revoked",
  "superseded",
] as const;
export const bindingReasons = [
  "replaced",
  "operator_revoked",
  "connection_changed",
  "incorrect_setup",
  "stale_context",
  "identity_mismatch",
  "verification_incomplete",
  "provider_unavailable",
  "permission_unproven",
] as const;
export const bindingRevokeReasons = [
  "operator_revoked",
  "connection_changed",
  "incorrect_setup",
] as const;
const schemas = {
  register_candidate: z.strictObject({
    ...expected,
    composio_project_id: project,
    auth_config_id: z
      .string()
      .trim()
      .regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
    connected_account_id: z
      .string()
      .trim()
      .regex(/^ca_[A-Za-z0-9_-]{1,128}$/),
    composio_user_id: userId,
    google_quota_project_id: identifier,
  }),
  confirm_binding: z.strictObject({
    ...expected,
    binding_id: z.uuid(),
    check_id: z.uuid(),
  }),
  revoke_binding: z.strictObject({
    ...expected,
    binding_id: z.uuid(),
    reason: z.enum(bindingRevokeReasons),
  }),
};
export type BindingKind = keyof typeof schemas;
export function parseBindingCommand(input: unknown) {
  const envelope = z
    .strictObject({
      kind: z.enum(["register_candidate", "confirm_binding", "revoke_binding"]),
      payload: z.unknown(),
      idempotency_key: z.uuid(),
    })
    .safeParse(input);
  if (!envelope.success) return null;
  const parsed = schemas[envelope.data.kind].safeParse(envelope.data.payload);
  return parsed.success
    ? {
        kind: envelope.data.kind,
        payload: parsed.data,
        idempotency_key: envelope.data.idempotency_key,
      }
    : null;
}
export function parseBindingQuery(params: URLSearchParams) {
  if (
    [...params.keys()].some(
      (k) => !["cursor", "limit"].includes(k) || params.getAll(k).length !== 1,
    )
  )
    return null;
  const raw = params.get("limit") ?? "25";
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(raw)) return null;
  const cursor = params.get("cursor");
  if (cursor !== null) {
    const parts = cursor.split(":");
    if (
      parts.length !== 2 ||
      !/^[1-9][0-9]*$/.test(parts[0]) ||
      !positive.safeParse(Number(parts[0])).success ||
      !z.uuid().safeParse(parts[1]).success
    )
      return null;
  }
  return { cursor, limit: Number(raw) };
}

const instant = z.iso.datetime({ offset: true });
const masked = z.string().regex(/^…(?:[A-Za-z0-9_-]{4})?$/);
export const bindingRowSchema = z.strictObject({
  id: z.uuid(),
  revision: positive,
  status: z.enum(bindingStatuses),
  reason: z.enum(bindingReasons).nullable(),
  stale: z.boolean(),
  created_at: instant,
  reviewed_at: instant.nullable(),
  external_refs: z.strictObject({
    project: masked,
    auth_config: masked,
    connection: masked,
    user: masked,
    quota: masked,
  }),
});
export const bindingPageSchema = z.strictObject({
  account: z.strictObject({
    id: z.uuid(),
    email: z.email(),
    brand_id: z.uuid().nullable(),
    brand_name: z.string().nullable(),
    brand_revision: revision,
    account_revision: revision,
    context_hash: digest,
    ready: z.boolean(),
  }),
  head_revision: revision,
  transport: z.literal("gmail_oauth"),
  composio_enabled: z.literal(false),
  verification_available: z.boolean(),
  can_confirm: z.boolean(),
  current: bindingRowSchema.nullable(),
  history: z.array(bindingRowSchema).max(100),
  cursor: z.string().nullable(),
});
export const bindingResultSchema = z.strictObject({
  id: z.uuid(),
  head_revision: positive,
  status: z.enum(bindingStatuses),
  transport: z.literal("gmail_oauth"),
  composio_enabled: z.literal(false),
});
export type BindingPage = z.infer<typeof bindingPageSchema>;
export type BindingRow = z.infer<typeof bindingRowSchema>;
export type BindingResult = z.infer<typeof bindingResultSchema>;

export function bindingExpected(page: BindingPage) {
  return {
    expected_head_revision: page.head_revision,
    expected_account_revision: page.account.account_revision,
    expected_brand_revision: page.account.brand_revision,
    expected_context_hash: page.account.context_hash,
  };
}
// Preserve one intent for a retry of identical normalized input, without retaining IDs in logs.
export function bindingRequest(
  previous: { fingerprint: string; key: string } | null,
  account: string,
  kind: BindingKind,
  payload: object,
  newKey: () => string,
) {
  const fingerprint = JSON.stringify({ account, kind, payload });
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: newKey() };
}
export const bindingMessages = {
  C_BINDING_FORBIDDEN: [
    "Se requiere superadmin activo y MFA.",
    "An active superadmin with MFA is required.",
  ],
  C_BINDING_NOT_FOUND: [
    "La cuenta no está disponible.",
    "The account is unavailable.",
  ],
  C_BINDING_INVALID_INPUT: [
    "Revisa los campos de la asociación.",
    "Review the binding fields.",
  ],
  C_BINDING_STALE: [
    "La revisión cambió. Actualiza y revisa antes de continuar.",
    "The revision changed. Refresh and review before continuing.",
  ],
  C_BINDING_ACCOUNT_NOT_READY: [
    "Revisa la conexión directa y la marca de esta cuenta.",
    "Review this account's direct connection and brand.",
  ],
  C_BINDING_CONFLICT: [
    "La conexión tiene una asociación incompatible.",
    "The connection has a conflicting binding.",
  ],
  C_BINDING_IDEMPOTENCY_CONFLICT: [
    "La solicitud ya se usó para otra operación.",
    "The request was already used for another operation.",
  ],
  C_BINDING_EVIDENCE_REQUIRED: [
    "Falta evidencia del servidor; la asociación sigue pendiente.",
    "Server evidence is required; the binding remains pending.",
  ],
  C_BINDING_IMMUTABLE: [
    "Conserva el registro anterior y prepara un nuevo candidato.",
    "Keep the previous record and prepare a new candidate.",
  ],
  C_BINDING_UNAVAILABLE: [
    "La administración de asociaciones no está disponible.",
    "Binding administration is unavailable.",
  ],
} as const;
export type BindingErrorCode = keyof typeof bindingMessages;
export function bindingErrorText(code: string, locale: Locale) {
  const known = Object.hasOwn(bindingMessages, code)
    ? (code as BindingErrorCode)
    : "C_BINDING_UNAVAILABLE";
  return bindingMessages[known][locale === "en" ? 1 : 0];
}
