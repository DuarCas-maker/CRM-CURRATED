import { z } from "zod";
import {
  parseBrandCreateInput,
  parseBrandMembershipInput,
  parseBrandReviewInput,
} from "./pipeline-os/s01/brand-inputs";
import type { Locale } from "./domain";

export const brandKinds = [
  "brand_create",
  "brand_update",
  "brand_set_status",
  "brand_membership_set",
  "brand_mapping_propose",
  "brand_mapping_confirm",
  "brand_mapping_discard",
] as const;
export type BrandKind = (typeof brandKinds)[number];
export const brandCollections = [
  "brands",
  "memberships",
  "reviews",
  "accounts",
  "people",
] as const;
export type BrandCollection = (typeof brandCollections)[number];
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = revision.min(1);
const reference = z
  .string()
  .trim()
  .min(1)
  .refine((v) => [...v].length <= 120 && !/[\x00-\x1f\x7f]/.test(v));
const instant = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
const schemas = {
  brand_update: z.strictObject({
    brand_id: z.uuid(),
    name: reference,
    expected_revision: positive,
  }),
  brand_set_status: z.strictObject({
    brand_id: z.uuid(),
    active: z.boolean(),
    expected_revision: positive,
  }),
  brand_mapping_propose: z
    .strictObject({
      account_id: z.uuid(),
      proposed_brand_id: z.uuid().nullable(),
      evidence_reference: reference.nullable().default(null),
      expected_account_revision: revision,
      review_id: z.uuid().optional(),
      expected_review_revision: positive.optional(),
      history_approved: z.boolean().default(false),
      history_from: instant.nullable().default(null),
      history_to: instant.nullable().default(null),
    })
    .refine(
      (p) =>
        (p.review_id === undefined) ===
        (p.expected_review_revision === undefined),
    ),
  brand_mapping_confirm: z.strictObject({
    review_id: z.uuid(),
    expected_review_revision: positive,
    expected_account_revision: revision,
    acknowledge_conflict: z.boolean().default(false),
  }),
  brand_mapping_discard: z.strictObject({
    review_id: z.uuid(),
    expected_review_revision: positive,
    reason: z.literal("admin_discarded"),
  }),
};
export function parseBrandCommand(
  kind: string,
  input: unknown,
): { kind: BrandKind; payload: Record<string, unknown> } | null {
  if (kind === "brand_create") {
    const r = parseBrandCreateInput(input);
    return r.ok && reference.safeParse(r.value.name).success
      ? { kind, payload: { ...r.value } }
      : null;
  }
  if (kind === "brand_membership_set") {
    const r = parseBrandMembershipInput(input);
    return r.ok ? { kind, payload: { ...r.value } } : null;
  }
  if (!Object.hasOwn(schemas, kind)) return null;
  const result = schemas[kind as keyof typeof schemas].safeParse(input);
  if (!result.success) return null;
  if (kind === "brand_mapping_propose") {
    const r = schemas.brand_mapping_propose.parse(result.data);
    const checked = parseBrandReviewInput({
      account_id: r.account_id,
      proposed_brand_id: r.proposed_brand_id,
      expected_account_revision: r.expected_account_revision,
      evidence_reference: r.evidence_reference,
      request_key: "00000000-0000-4000-8000-000000000001",
      history_approved: r.history_approved,
      history_from: r.history_from,
      history_to: r.history_to,
    });
    if (!checked.ok) return null;
  }
  return { kind: kind as BrandKind, payload: result.data };
}

const oauthSchema = z
  .strictObject({
    mode: z.enum(["new", "reconnect"]),
    brand_id: z.uuid(),
    expected_brand_revision: positive,
    account_id: z.uuid().nullable().default(null),
    expected_account_revision: positive.nullable().default(null),
  })
  .refine((p) =>
    p.mode === "new"
      ? p.account_id === null && p.expected_account_revision === null
      : p.account_id !== null && p.expected_account_revision !== null,
  );
export type BrandOAuthIntent = z.infer<typeof oauthSchema>;
export function parseBrandOAuthIntent(input: unknown) {
  const r = oauthSchema.safeParse(input);
  return r.success ? r.data : null;
}

export interface BrandRow {
  key: string;
  id?: string;
  code?: string;
  name?: string;
  active?: boolean;
  revision?: number;
  brand_id?: string;
  user_id?: string;
  brand_name?: string | null;
  brand_code?: string | null;
  email?: string;
  organization?: string;
  status?: string;
  operating_brand_id?: string | null;
  brand_revision?: number;
  account_id?: string;
  proposed_brand_id?: string | null;
  expected_account_revision?: number;
  evidence_reference?: string | null;
  history_approved?: boolean;
  history_from?: string | null;
  history_to?: string | null;
  proposed_brand_revision?: number | null;
  impact_fingerprint?: string | null;
  account_email?: string;
  role?: string;
  impact?: {
    queued: number;
    sending: number;
    uncertain: number;
    active_campaigns: number;
  };
}
export interface BrandPage {
  items: BrandRow[];
  next_cursor: string | null;
  is_admin: boolean;
}
const base = { key: z.string().min(1).max(73) };
const rowSchemas = {
  brands: z.object({
    ...base,
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
    revision: positive,
  }),
  memberships: z.object({
    ...base,
    brand_id: z.uuid(),
    user_id: z.uuid(),
    active: z.boolean(),
    revision: positive,
    brand_name: z.string(),
    brand_code: z.string(),
  }),
  accounts: z.object({
    ...base,
    id: z.uuid(),
    email: z.email(),
    organization: z.string(),
    status: z.string(),
    operating_brand_id: z.uuid().nullable(),
    brand_revision: revision,
    brand_name: z.string().nullable(),
    brand_code: z.string().nullable(),
  }),
  reviews: z.object({
    ...base,
    id: z.uuid(),
    account_id: z.uuid(),
    proposed_brand_id: z.uuid().nullable(),
    status: z.enum(["pending", "confirmed", "conflict", "discarded"]),
    revision: positive,
    expected_account_revision: revision,
    evidence_reference: z.string().nullable(),
    history_approved: z.boolean(),
    history_from: z.string().nullable(),
    history_to: z.string().nullable(),
    proposed_brand_revision: positive.nullable(),
    account_email: z.email(),
    brand_name: z.string().nullable(),
    brand_code: z.string().nullable(),
    impact: z.object({
      queued: revision,
      sending: revision,
      uncertain: revision,
      active_campaigns: revision,
    }),
  }),
  people: z.object({
    ...base,
    id: z.uuid(),
    name: z.string(),
    role: z.enum([
      "superadmin",
      "seller_admin",
      "seller",
      "closer_admin",
      "closer",
    ]),
    active: z.boolean(),
  }),
};
export function parseBrandPage(
  collection: BrandCollection,
  value: unknown,
): BrandPage | null {
  const p = z
    .object({
      items: z.array(rowSchemas[collection]).max(100),
      next_cursor: z.string().max(73).nullable(),
      is_admin: z.boolean(),
    })
    .safeParse(value);
  return p.success ? p.data : null;
}
export const brandMessages = {
  BRAND_INVALID_INPUT: ["Revisa los campos indicados.", "Review the fields."],
  BRAND_FORBIDDEN: [
    "Se requiere superadmin activo y MFA.",
    "An active superadmin with MFA is required.",
  ],
  BRAND_NOT_FOUND: [
    "El recurso no está disponible.",
    "The resource is unavailable.",
  ],
  BRAND_STALE_REVISION: [
    "La asignación cambió. Actualiza antes de continuar.",
    "The assignment changed. Refresh before continuing.",
  ],
  BRAND_REVIEW_STALE: [
    "La propuesta o sus conflictos cambiaron. Edítala y revísala otra vez.",
    "The proposal or its conflicts changed. Edit and review it again.",
  ],
  BRAND_REVIEW_REQUIRED: [
    "Confirma primero la marca de la cuenta.",
    "Confirm the account brand first.",
  ],
  BRAND_CONFLICT_ACK_REQUIRED: [
    "Revisa y acepta expresamente los conflictos.",
    "Review and explicitly acknowledge the conflicts.",
  ],
  BRAND_CONFLICT: [
    "Ya existe un registro incompatible. Actualiza la vista.",
    "A conflicting record exists. Refresh the view.",
  ],
  BRAND_KEY_REUSED: [
    "La clave de solicitud pertenece a otra operación.",
    "The request key belongs to a different operation.",
  ],
  BRAND_USER_INACTIVE: ["El usuario está inactivo.", "The user is inactive."],
  BRAND_OAUTH_INVALID: [
    "La autorización expiró o ya se utilizó. Iníciala otra vez.",
    "Authorization expired or was already used. Start again.",
  ],
  BRAND_IDENTITY_MISMATCH: [
    "Selecciona exactamente el correo de la cuenta que reconectas.",
    "Select exactly the mailbox being reconnected.",
  ],
  BRAND_RECONNECT_REQUIRED: [
    "La cuenta ya existe. Inicia una reconexión explícita.",
    "The account already exists. Start an explicit reconnection.",
  ],
  BRAND_UNAVAILABLE: [
    "La administración de marcas no está disponible.",
    "Brand administration is unavailable.",
  ],
} as const;
export type BrandErrorCode = keyof typeof brandMessages;
export function brandErrorText(code: string, locale: Locale) {
  return (
    brandMessages[code as BrandErrorCode]?.[locale === "es" ? 0 : 1] ||
    brandMessages.BRAND_UNAVAILABLE[locale === "es" ? 0 : 1]
  );
}
