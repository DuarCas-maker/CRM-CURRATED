import { z } from "zod";
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const brandPreparationSchema = z.strictObject({
  brand_id: z.uuid(),
  brand_revision: revision,
  account_revision: revision,
});
export type BrandPreparation = z.infer<typeof brandPreparationSchema>;
export function sameBrandPreparation(left: unknown, right: unknown) {
  const a = brandPreparationSchema.safeParse(left),
    b = brandPreparationSchema.safeParse(right);
  return (
    a.success &&
    b.success &&
    a.data.brand_id === b.data.brand_id &&
    a.data.brand_revision === b.data.brand_revision &&
    a.data.account_revision === b.data.account_revision
  );
}
export const brandSnapshotSchema = z.object({
  version: z.literal(1),
  brand_id: z.uuid(),
  brand_code: z.string(),
  brand_name: z.string(),
  brand_revision: revision,
  account_id: z.uuid(),
  account_revision: revision,
  actor_id: z.uuid().nullable(),
  purpose: z.enum(["mail", "campaign", "system_notification"]),
  authorization: z.enum(["human_aal2", "system_notification"]),
  prepared_at: z.string(),
});
export type BrandSnapshot = z.infer<typeof brandSnapshotSchema>;
export const brandCapabilitySchema = brandPreparationSchema.extend({
  account_id: z.uuid(),
  brand_name: z.string(),
  brand_code: z.string(),
  can_campaign: z.boolean(),
});
export type BrandCapability = z.infer<typeof brandCapabilitySchema>;
export function accountPreparation(
  account: { brand_context?: BrandCapability } | undefined,
): BrandPreparation | null {
  const parsed = brandPreparationSchema.safeParse(
    account?.brand_context
      ? {
          brand_id: account.brand_context.brand_id,
          brand_revision: account.brand_context.brand_revision,
          account_revision: account.brand_context.account_revision,
        }
      : null,
  );
  return parsed.success ? parsed.data : null;
}
export function snapshotPreparation(
  snapshot: unknown,
): BrandPreparation | null {
  const s = brandSnapshotSchema.safeParse(snapshot);
  return s.success
    ? {
        brand_id: s.data.brand_id,
        brand_revision: s.data.brand_revision,
        account_revision: s.data.account_revision,
      }
    : null;
}
export const brandDeliveryMessages = {
  BRAND_PREPARATION_REQUIRED: [
    "Revisa y confirma la marca de la cuenta antes de enviar.",
    "Review and confirm the sender brand before sending.",
  ],
  BRAND_PREPARATION_STALE: [
    "La preparación cambió. Actualiza y revisa de nuevo.",
    "Preparation changed. Refresh and review again.",
  ],
  BRAND_DELIVERY_FORBIDDEN: [
    "Faltan permisos vigentes para esta cuenta, marca o expediente.",
    "Current sender, brand or case permissions are required.",
  ],
  BRAND_REPLY_MISMATCH: [
    "Esta respuesta pertenece a otra marca. Revisa el remitente.",
    "This reply belongs to another brand. Review the sender.",
  ],
  BRAND_SNAPSHOT_IMMUTABLE: [
    "La intención aprobada se conserva. Prepara una nueva operación.",
    "The approved intent is preserved. Prepare a new operation.",
  ],
  BRAND_INTENT_IMMUTABLE: [
    "La intención aprobada se conserva. Prepara una nueva operación.",
    "The approved intent is preserved. Prepare a new operation.",
  ],
  BRAND_RECONCILIATION_REQUIRED: [
    "El resultado necesita conciliación antes de otro intento.",
    "Reconcile the result before another attempt.",
  ],
  BRAND_ADMISSION_REQUIRED: [
    "El envío no tiene una admisión válida.",
    "The send has no valid admission.",
  ],
  BRAND_DELIVERY_UNAVAILABLE: [
    "Las guardas de envío no están disponibles.",
    "Delivery guards are unavailable.",
  ],
} as const;
