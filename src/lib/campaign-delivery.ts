export interface CampaignAudience {
  contact_id: string;
  opportunity_id: string | null;
  name: string;
  email: string;
  company: string;
  amount: string | null;
  industry: string;
  phone: string;
  reason: string;
  missing_fields: string[];
}
export interface SendingBudget {
  recipient_count: number;
  recipient_limit: number;
  account_id: string;
  crm_messages: number;
  external_messages: number;
  campaign_messages: number;
  total_messages: number;
  daily_limit: number;
  campaign_limit: number;
  reserve: number;
  remaining: number;
  campaign_remaining: number;
  synced_at: string | null;
  send_retry_at: string | null;
}
export const audienceReasons: Record<string, [string, string]> = {
  eligible: ["Disponible", "Eligible"],
  excluded: ["Excluido manualmente", "Manually excluded"],
  unverified: ["Correo sin verificación válida", "Email not verified"],
  suppressed: ["Baja o bloqueo", "Unsubscribed or blocked"],
  other_campaign: ["En otra campaña", "In another campaign"],
  unavailable: ["Sin oportunidad disponible", "No available opportunity"],
  goal_met: ["Objetivo completado", "Goal completed"],
  missing_data: ["Datos faltantes", "Missing data"],
  sequence_finished: ["Secuencia finalizada", "Sequence finished"],
};
export function audienceValues(contact: CampaignAudience) {
  return {
    name: contact.name,
    company: contact.company,
    amount: contact.amount || "",
    industry: contact.industry,
    phone: contact.phone,
    application_url: "https://example.test/apply/preview",
    unsubscribe_url: "https://example.test/unsubscribe/preview",
  };
}
