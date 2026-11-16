import { z } from "zod";

const count = z.number().int().nonnegative();
export const campaignImportStatusSchema = z.object({
  batch: z.object({
    id: z.uuid(),
    name: z.string(),
    status: z.string(),
    total: count,
    processed: count,
    imported: count,
    duplicates: count,
    errors: count,
  }),
  counts: z.object({
    unique_contacts: count,
    valid: count,
    invalid: count,
    uncertain: count,
    pending: count,
    running: count,
    attention: count,
    excluded: count,
  }),
  next_verification_count: count.max(5000),
  ready: z.boolean(),
});
export type CampaignImportStatus = z.infer<typeof campaignImportStatusSchema>;
export const campaignImportSteps = [
  ["Archivo", "File"],
  ["Revisión", "Review"],
  ["Bouncer", "Bouncer"],
  ["Plantilla", "Template"],
  ["Envío", "Sending"],
  ["Respuestas", "Replies"],
] as const;
export const campaignImportErrors: Record<string, [string, string]> = {
  CI_FORBIDDEN: [
    "Se requiere un administrador con MFA.",
    "An administrator with MFA is required.",
  ],
  CI_BATCH_NOT_FOUND: [
    "El lote no está disponible.",
    "Import batch unavailable.",
  ],
  CI_IMPORT_RUNNING: [
    "La importación todavía se está procesando.",
    "The import is still processing.",
  ],
  CI_STALE: [
    "La cantidad pendiente cambió. Actualiza y vuelve a revisar antes de confirmar.",
    "The pending count changed. Refresh and review before confirming.",
  ],
  CI_VERIFICATION_PENDING: [
    "Termina la revisión y verificación del lote antes de crear la campaña.",
    "Finish reviewing and verifying this import before creating the campaign.",
  ],
  CI_SELECTION_SCOPE: [
    "Selecciona solo destinatarios elegibles de este archivo.",
    "Select eligible recipients from this file only.",
  ],
  CI_SELECTION_LIMIT: [
    "El límite es de 5.000 destinatarios por campaña. Elige una selección; no se recortó el lote.",
    "The campaign limit is 5,000 recipients. Make a selection; the import was not truncated.",
  ],
  CI_TEMPLATE_CHANGED: [
    "La plantilla cambió. Vuelve a seleccionarla.",
    "The template changed. Select it again.",
  ],
  CI_UNAVAILABLE: [
    "El recorrido de campañas por archivo todavía no está disponible. No se usará una audiencia global.",
    "Import campaigns are unavailable. A global audience will not be used.",
  ],
};
export function importCampaignHref(
  batch: string,
  template?: string,
  account?: string,
  search = "",
  page = 0,
) {
  z.uuid().parse(batch);
  const q = new URLSearchParams({ batch });
  if (template && account) {
    q.set("mode", "leads");
    q.set("template", z.uuid().parse(template));
    q.set("account", z.uuid().parse(account));
    q.set("search", search);
    q.set("page", String(page));
  }
  return "/api/campaigns/import?" + q;
}
