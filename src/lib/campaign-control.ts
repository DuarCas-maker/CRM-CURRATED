import type { SendingBudget } from "./campaign-delivery";
import type { CampaignContact } from "./campaign-center";
export interface ControlSender {
  can_view_account:boolean;
  account_id: string;
  campaign_id: string;
  email: string;
  status: string;
  campaign_status: string;
  daily_limit: number;
  pending: number;
  timezone: string;
  start_hour: number;
  end_hour: number;
  scheduled_at: string | null;
  remaining: number | null;
  budget: Omit<SendingBudget, "account_id">;
  blockers: string[];
}
export interface ControlCampaign {
  id: string;
  name: string;
  seller_id: string;
  created_by: string;
  batch_id: string | null;
  created_at: string;
  daily_limit: number;
  status: string;
  used_24h: number;
  metrics: {
    enrolled: number;
    sent: number;
    replied: number;
    unanswered: number;
    pending: number;
    failed: number;
    uncertain: number;
    blocked: number;
    attention: number;
  };
  senders: ControlSender[];
}
export interface ControlOverview {
  funnel: {
    total: number;
    valid: number;
    invalid: number;
    uncertain: number;
    pending: number;
    review: number;
    running: number;
    suppressed: number;
    available: number;
    reserved: number;
  };
  summary: {
    unanswered:number;
    campaigns: number;
    active: number;
    scheduled: number;
    sent: number;
    pending: number;
    replied: number;
  };
  total: number;
  campaigns: ControlCampaign[];
}
export function campaignUsageBlocked(c: ControlCampaign) {
  const pendingSenders = c.senders.filter(s => s.pending > 0);
  return ["active", "scheduled"].includes(c.status) && c.metrics.pending > 0 && pendingSenders.length > 0 && pendingSenders.every(s => s.blockers.includes("usage_unknown"));
}
export interface ControlLead {
  monthly_income?: number | null;
  contact_id: string;
  name: string;
  email: string;
  company: string;
  classification: string;
  verification: string;
  state: string | null;
  reason_code: string | null;
  retryable: boolean;
  suppressed: boolean;
}
export interface ControlRecipient extends CampaignContact {
  account_id: string;
  campaign_id: string;
  manageable: boolean;
}
export const controlMessages: Record<string, [string, string]> = {
  CC_FORBIDDEN: [
    "Se requiere una sesión autorizada con MFA.",
    "An authorized MFA session is required.",
  ],
  CC_NOT_FOUND: ["La campaña no está disponible.", "Campaign unavailable."],
  CC_STALE: [
    "La selección o sus permisos cambiaron. Actualiza y vuelve a revisar antes de confirmar.",
    "The selection or permissions changed. Refresh and review before confirming.",
  ],
  CC_TARGET_HISTORY: [
    "La cuenta destino conserva un intento anterior para este contacto. Elige otra cuenta: ese historial no se reemplaza ni se reactiva.",
    "The target account holds a previous attempt for this contact. Choose another account: history cannot be replaced or reactivated.",
  ],
  CC_KEY_REUSED: [
    "La solicitud ya se utilizó con otros datos. Revisa la operación.",
    "This request was already used with different data. Review the operation.",
  ],
  CC_MIXED_BRAND: [
    "Todos los remitentes deben pertenecer a la misma marca revisada.",
    "All senders must belong to the same reviewed brand.",
  ],
  CC_INVALID_INPUT: [
    "Revisa los campos y la selección.",
    "Check fields and selection.",
  ],
  CC_SELECTION_LIMIT: [
    "El máximo es de 5.000 contactos; selecciona una parte del lote.",
    "Select up to 5,000 contacts from this file.",
  ],
};
export const sendingBlockers: Record<string, [string, string]> = {
  sender_limit:['Límite de este remitente alcanzado','This sender reached its limit'],
  outside_window: ["Fuera del horario de envío", "Outside sending hours"],
  account_limit: ["Sin cupo disponible en 24 h", "No sending capacity in 24h"],
  usage_unknown: [
    "Uso de Gmail sin sincronizar",
    "Gmail usage not synchronized",
  ],
  account_disconnected: ["Cuenta desconectada", "Account disconnected"],
  sender_permission: ["Remitente sin autorización", "Sender not authorized"],
  brand_review: ["Revisar marca o permisos", "Review brand or permissions"],
  campaign_paused: ["Campaña pausada", "Campaign paused"],
  campaign_draft: ["Borrador sin activar", "Draft not activated"],
  scheduled: ["Fecha programada pendiente", "Scheduled time not reached"],
  provider_wait: ["Espera indicada por Gmail", "Gmail retry window"],
  group_limit: [
    "Límite total de campaña alcanzado",
    "Total campaign limit reached",
  ],
  reconciliation: [
    "Resultado de envío incierto: conciliar",
    "Unknown sending outcome: reconcile",
  ],
};
