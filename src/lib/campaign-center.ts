import type { Campaign } from "./domain";

export interface CampaignMetrics {
  enrolled: number;
  sent: number;
  replied: number;
  unanswered: number;
  pending: number;
  attention: number;
  failed: number;
  uncertain: number;
  cancelled: number;
  blocked: number;
}
export interface CampaignContact {
  contact_id: string;
  opportunity_id: string | null;
  company: string;
  name: string;
  email: string;
  send_status: string;
  sent_at: string | null;
  reply_at: string | null;
  last_interaction: string | null;
  needs_attention: boolean;
  conversation_id: string | null;
}
export type CenterCampaign = Campaign & { metrics: CampaignMetrics };
export interface CampaignCenter {
  summary: {
    active: number;
    sent: number;
    replied: number;
    unanswered: number;
  };
  total: number;
  campaigns: CenterCampaign[];
}
export const emptyMetrics: CampaignMetrics = {
  enrolled: 0,
  sent: 0,
  replied: 0,
  unanswered: 0,
  pending: 0,
  attention: 0,
  failed: 0,
  uncertain: 0,
  cancelled: 0,
  blocked: 0,
};
export const responseRate = (m: Pick<CampaignMetrics, "sent" | "replied">) =>
  m.sent > 0 ? Math.round((m.replied / m.sent) * 1000) / 10 : 0;
export const campaignLabels: Record<string, [string, string]> = {
  draft: ["Borrador", "Draft"],
  active: ["Activa", "Active"],
  scheduled: ["Programada", "Scheduled"],
  paused: ["Pausada", "Paused"],
  completed: ["Finalizada", "Completed"],
  sent: ["Aceptado por Gmail", "Accepted by Gmail"],
  queued: ["En cola", "Queued"],
  sending: ["En proceso", "Processing"],
  pending: ["Por enviar", "Pending"],
  failed: ["Fallido", "Failed"],
  uncertain: ["Incierto · revisar", "Uncertain · review"],
  cancelled: ["Cancelado", "Cancelled"],
  blocked: ["Bloqueado", "Blocked"],
  suppressed: ["Baja / exclusión", "Suppressed"],
  bounced: ["Rebote", "Bounced"],
  goal_met: ["Objetivo completado", "Goal completed"],
  created: ["Campaña creada", "Campaign created"],
  replied: ["Respuesta recibida", "Reply received"],
};
export function campaignState(c: Pick<Campaign, "status" | "scheduled_at">) {
  return c.status === "active" &&
    c.scheduled_at &&
    Date.parse(c.scheduled_at) > Date.now()
    ? "scheduled"
    : c.status;
}
// Quoting alone does not prevent spreadsheet formula execution.
export function campaignCsv(rows: unknown[][]) {
  return (
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let cell = String(value ?? "");
            if (/^[\s]*[=+@\-\t\r]/.test(cell)) cell = "'" + cell;
            return '"' + cell.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
