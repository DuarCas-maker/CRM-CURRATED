import type { ControlLead } from "./campaign-control";
import type { Locale } from "./domain";

export const leadFunnelFilters = [
  "all", "pending", "running", "available", "campaign", "contacted",
  "review", "excluded", "restricted",
] as const;
export type LeadFunnelFilter = (typeof leadFunnelFilters)[number];
export type LeadFunnelState = Exclude<LeadFunnelFilter, "all">;
export interface LeadFunnelRow extends ControlLead {
  funnel_state: LeadFunnelState;
  funnel_reason: string;
}
export interface LeadFunnelPage {
  funnel: Record<LeadFunnelState | "total", number>;
  total: number;
  rows: LeadFunnelRow[];
}
const labels: Record<LeadFunnelFilter, [string, string]> = {
  all: ["Total de leads", "Total leads"],
  pending: ["Por verificar", "To verify"],
  running: ["Verificando", "Verifying"],
  available: ["Disponibles para campaña", "Ready for a campaign"],
  campaign: ["En campaña", "In a campaign"],
  contacted: ["Ya contactados", "Already contacted"],
  review: ["Necesitan revisión", "Need review"],
  excluded: ["Excluidos del envío", "Excluded from sending"],
  restricted: ["Otras restricciones", "Other restrictions"],
};
const descriptions: Record<LeadFunnelFilter, [string, string]> = {
  all: ["Todos los contactos únicos de tu pool.", "All unique contacts in your pool."],
  pending: ["Pendientes de autorizar una verificación; sin una solicitud en curso.", "Awaiting verification authorization; no request in progress."],
  running: ["Verificación autorizada: en cola o procesándose en Bouncer.", "Authorized verification: queued or being processed by Bouncer."],
  available: ["Correos verificados y contactos libres para iniciar una campaña.", "Verified emails and contacts ready to start a campaign."],
  campaign: ["Reservados en una campaña; todavía sin envío confirmado.", "Reserved in a campaign; no confirmed send yet."],
  contacted: ["Gmail confirmó al menos un envío real. Las respuestas se siguen en Campañas y resultados.", "Gmail confirmed at least one real send. Track replies in Campaigns and results."],
  review: ["Errores técnicos, resultados inciertos o correos dudosos. Revisa el motivo antes de reintentar.", "Technical errors, unknown outcomes or uncertain emails. Review the reason before retrying."],
  excluded: ["Correos inválidos, bajas o bloqueos; quedan fuera del envío.", "Invalid emails or suppressed contacts; excluded from sending."],
  restricted: ["Contactos que requieren resolver otra condición antes de crear una campaña.", "Contacts that need another condition resolved before starting a campaign."],
};
export const leadFunnelLabel = (filter: LeadFunnelFilter, locale: Locale) => labels[filter][locale === "es" ? 0 : 1];
export const leadFunnelDescription = (filter: LeadFunnelFilter, locale: Locale) => descriptions[filter][locale === "es" ? 0 : 1];
export function leadFunnelReason(row: LeadFunnelRow, locale: Locale): string {
  const reasons: Record<string, [string, string]> = {
    confirmed_send: ["Envío confirmado por Gmail; no implica lectura ni entrega definitiva.", "Send confirmed by Gmail; this does not confirm opening or final delivery."],
    campaign_reserved: ["Reservado en una campaña. Consulta su programación o resultados en Campañas.", "Reserved in a campaign. Review its schedule or results in Campaigns."],
    suppressed: ["Baja o bloqueo: excluido del envío.", "Suppressed: excluded from sending."],
    invalid_email: ["Bouncer clasificó este correo como inválido.", "Bouncer classified this email as invalid."],
    uncertain_email: ["Correo dudoso: Bouncer no pudo confirmar su validez. No se enviará.", "Uncertain email: Bouncer could not confirm its validity. It will not be sent."],
    technical_error: ["Error técnico. Resuelve la causa antes de autorizar un reintento.", "Technical error. Resolve the cause before authorizing a retry."],
    uncertain_request: ["Resultado de la solicitud sin confirmar. Requiere conciliación; no se puede repetir.", "Unknown request outcome. Reconciliation required; it cannot be retried."],
    review: ["La verificación necesita revisión antes de continuar.", "Verification needs review before continuing."],
    queued: ["Verificación autorizada y en cola.", "Verification authorized and queued."],
    submitted: ["Bouncer está procesando la verificación.", "Bouncer is processing the verification."],
    pending_verification: ["Pendiente de autorizar la verificación con Bouncer.", "Awaiting Bouncer verification authorization."],
    eligible: ["Listo para seleccionar en una campaña.", "Ready to select for a campaign."],
    advanced_case: ["El expediente requiere preparación o ya avanzó en el pipeline.", "The case needs preparation or has already advanced in the pipeline."],
    already_contacted: ["Hay una interacción previa registrada; no está libre para un primer contacto nuevo.", "A previous interaction is recorded; unavailable for new initial outreach."],
    missing_data: ["Faltan datos necesarios para preparar la campaña.", "Required campaign preparation data is missing."],
    unverified: ["El formato o la verificación del correo requiere revisión.", "The email format or verification needs review."],
    not_prepared: ["Completa la preparación del expediente antes de crear una campaña.", "Complete case preparation before creating a campaign."],
  };
  if (row.reason_code === "provider_http_402" && row.funnel_state === "review")
    return locale === "es" ? "Bouncer rechazó la solicitud por créditos insuficientes. Revisa el saldo antes de reintentar." : "Bouncer rejected the request due to insufficient credits. Check the balance before retrying.";
  return (reasons[row.funnel_reason] || descriptions[row.funnel_state])[locale === "es" ? 0 : 1];
}
export async function requestLeadFunnel(params: URLSearchParams, signal?: AbortSignal): Promise<LeadFunnelPage> {
  const query = new URLSearchParams(params);
  query.set("mode", "leads");
  const response = await fetch("/api/campaigns/flow?" + query, { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "No se pudo consultar el funnel de leads.");
  return result;
}
