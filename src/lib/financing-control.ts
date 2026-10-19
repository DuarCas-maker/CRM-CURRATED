import type { Locale, Workspace, Opportunity } from "./domain";
import type { OperationalSettings } from "./operations";
import { demoOperationalDashboard } from "./operations";
import { underwritingReadiness } from "./underwriting-status";

export type ControlRow = {
  id: string;
  row_key: string;
  company: string;
  contact: string;
  stage: Opportunity["stage"];
  process_id: string | null;
  sequence_number: number | null;
  process_label: string | null;
  process_state: string | null;
  stage_entered_at: string | null;
  owner_id: string | null;
  owner_name: string;
  handed_off_at: string | null;
  required_count: number;
  received_count: number;
  approved_count: number;
  review_count: number;
  correction_count: number;
  missing_count: number;
  documents_complete: boolean;
  application_status: string;
  risk_status: string;
  reply_count: number;
  reply_due_at: string | null;
  followup_due_at: string | null;
  waiting_for: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  overdue_tasks: number;
  next_task: string | null;
  next_task_at: string | null;
  task_owner_name: string | null;
  next_action: string | null;
  next_action_at: string | null;
  next_lender_action: string | null;
  next_lender_action_at: string | null;
  confirmed_count: number;
  response_count: number;
  application_sent_count: number;
  active_offers: number;
  expiring_offers: number;
  expired_offers: number;
  next_offer_expiry: string | null;
  lenders: {
    id: string;
    name: string;
    status: string;
    responded: boolean;
    sent_at: string;
    application_sent: boolean;
  }[];
  priority: string;
  priority_rank: number;
  needs_attention: boolean;
  is_overdue: boolean | null;
  due_at: string | null;
};
export type ControlSummary = {
  active_opportunities: number;
  total_opportunities: number;
  active_processes: number;
  total_processes: number;
  unknown_processes: number;
  pipeline_amount: number;
  total_requested_amount: number;
  complete_cases: number;
  required_documents: number;
  received_documents: number;
  approved_documents: number;
  review_documents: number;
  application_counts: Record<string, number>;
  risk_counts: Record<string, number>;
  confirmed_processes: number | null;
  confirmed_submissions: number | null;
  responded_submissions: number | null;
  application_sent_cases: number | null;
  active_offers: number | null;
  expiring_offers: number | null;
  funded_amount: number | null;
  funded_count: number | null;
  historical_funding_records: number | null;
  attention: number;
  lender_counts:
    { name: string; submissions: number; responses: number }[] | null;
};
export type FinancingControlData = {
  version: 2;
  as_of: string;
  rows: ControlRow[];
  total: number;
  stages: Record<string, number>;
  alerts: ControlRow[];
  summary: ControlSummary;
  settings: OperationalSettings;
};
export type ControlSection =
  "activity" | "documents" | "analysis" | "lenders" | "mail";
export function controlAction(
  row: ControlRow,
  locale: Locale,
): {
  label: string;
  reason: string;
  section: ControlSection;
  owner: string;
  due: string | null;
} {
  const en = locale === "en";
  const values: Record<string, [string, string, ControlSection]> = {
    offers: [
      en
        ? "Review offer before expiry"
        : "Revisar oferta antes del vencimiento",
      en
        ? `${row.expiring_offers} offers expire soon`
        : `${row.expiring_offers} ofertas próximas a vencer`,
      "lenders",
    ],
    reply: [
      en
        ? "Reply to pending conversation"
        : "Responder la conversación pendiente",
      en
        ? `${row.reply_count} conversations await the team`
        : `${row.reply_count} conversaciones esperan al equipo`,
      "mail",
    ],
    overdue: [
      row.overdue_tasks > 0
        ? row.next_task ||
          (en ? "Complete overdue task" : "Completar tarea vencida")
        : row.next_lender_action ||
          (en ? "Complete overdue follow-up" : "Completar seguimiento vencido"),
      row.overdue_tasks > 0
        ? en
          ? `${row.overdue_tasks} overdue tasks`
          : `${row.overdue_tasks} tareas vencidas`
        : row.waiting_for === "client"
          ? en
            ? "Client follow-up deadline reached"
            : "Venció el plazo de seguimiento al cliente"
          : en
            ? "Lender or scheduled follow-up deadline reached"
            : "Venció el plazo de seguimiento al lender o de la acción programada",
      row.overdue_tasks > 0 ? "activity" : "mail",
    ],
    unassigned: [
      en ? "Assign a case owner" : "Asignar responsable del expediente",
      en ? "No assigned owner" : "No hay responsable asignado",
      "activity",
    ],
    documents: [
      en ? "Review or correct documents" : "Revisar o corregir documentos",
      en
        ? `${row.review_count} to review · ${row.correction_count} to correct`
        : `${row.review_count} por revisar · ${row.correction_count} por corregir`,
      "documents",
    ],
    analysis: [
      en ? "Review risk analysis" : "Revisar análisis de riesgo",
      en
        ? "Human review or a new current report is needed"
        : "Hace falta revisión humana o un nuevo informe vigente",
      "analysis",
    ],
    stalled: [
      en
        ? "Review process with no stage transition"
        : "Revisar proceso sin cambio de etapa",
      en
        ? "At least 7 days in the recorded state"
        : "Al menos 7 días en el estado registrado",
      "activity",
    ],
    lender: [
      en
        ? "Check lender or client follow-up"
        : "Revisar seguimiento al lender o cliente",
      en
        ? "Recorded wait or pending lender reply"
        : "Espera registrada o respuesta pendiente del lender",
      "mail",
    ],
  };
  const [label, reason, section] = values[row.priority] || [
    row.next_task ||
      row.next_action ||
      (en ? "Set next action" : "Definir próxima acción"),
    en ? "No higher-priority signal" : "Sin señal de mayor prioridad",
    "activity",
  ];
  return {
    label,
    reason,
    section,
    owner:
      row.priority === "overdue" && row.overdue_tasks > 0
        ? row.task_owner_name || ""
        : row.owner_name,
    due:
      row.priority === "offers"
        ? row.next_offer_expiry
        : row.priority === "reply"
          ? row.reply_due_at
          : row.due_at,
  };
}
export function stageDuration(
  entered: string | null,
  asOf: string,
  locale: Locale,
) {
  if (
    !entered ||
    !Number.isFinite(Date.parse(entered)) ||
    Date.parse(entered) > Date.parse(asOf)
  )
    return locale === "es" ? "Sin fecha verificable" : "No verified date";
  const hours = Math.floor((Date.parse(asOf) - Date.parse(entered)) / 3600000);
  return `${Math.floor(hours / 24)} d · ${hours % 24} h`;
}

// Demo only. No submission or process is inferred for real workspaces.
export function demoFinancingControl(
  data: Workspace,
  opportunities: Opportunity[],
  filter: string,
  page: number,
  processState = "",
  stalled = "",
  now = Date.now(),
): FinancingControlData {
  const source = demoOperationalDashboard(data, opportunities, "all", 0, now);
  const rows: ControlRow[] = source.rows.map((r) => {
    const docs = data.documents.filter(
      (d) => d.opportunity_id === r.id && d.kind !== "analysis_report",
    );
    const ready = underwritingReadiness(docs, true);
    const required =
      5 +
      docs.filter(
        (d) =>
          d.required !== false &&
          !["application", "bank_statement"].includes(d.kind),
      ).length;
    const received = Math.min(
      required,
      docs.filter((d) => !!d.storage_path).length,
    );
    const approved = Math.min(
      required,
      docs.filter((d) => ready.usable(d)).length,
    );
    const reviewed = data.analyses.some(
      (a) => a.opportunity_id === r.id && a.is_current !== false,
    );
    return {
      ...r,
      row_key: `demo:${r.id}`,
      process_id: null,
      sequence_number: null,
      process_label: null,
      process_state: null,
      stage_entered_at: null,
      required_count: required,
      received_count: received,
      approved_count: approved,
      review_count: r.document_review_count,
      correction_count: docs.filter((d) => d.status === "correction").length,
      missing_count: required - received,
      documents_complete: ready.ready,
      application_status: ready.applicationReady
        ? "approved"
        : received
          ? "received"
          : "pending",
      risk_status: reviewed
        ? "approved"
        : ready.ready
          ? "not_started"
          : "blocked",
      task_owner_name: r.owner_name,
      last_inbound_at: r.reply_since,
      last_outbound_at: null,
      confirmed_count: 0,
      response_count: 0,
      application_sent_count: 0,
      active_offers: 0,
      expiring_offers: 0,
      expired_offers: 0,
      lenders: [],
      priority_rank:
        r.priority === "reply" ? 1 : r.priority === "overdue" ? 2 : 4,
      is_overdue: r.overdue,
    };
  });
  const selected = rows.filter(
    (r) =>
      (!processState || r.process_state === processState) &&
      (!stalled ||
        (!!r.stage_entered_at &&
          Date.parse(r.stage_entered_at) <=
            now - Number(stalled) * 86400000)) &&
      (filter === "all" ||
        (filter === "attention" && r.needs_attention) ||
        (filter === "reply" && r.reply_count > 0) ||
        (filter === "overdue" && r.is_overdue) ||
        (filter === "documents" &&
          r.review_count + r.missing_count + r.correction_count > 0) ||
        (filter === "missing" && r.missing_count > 0) ||
        (filter === "review" && r.review_count > 0) ||
        (filter === "analysis" && r.risk_status !== "approved") ||
        (filter === "application" && r.application_status !== "approved") ||
        (filter === "unassigned" && !r.owner_id)),
  );
  const counts = (key: "risk_status" | "application_status") =>
    selected.reduce<Record<string, number>>((a, r) => {
      a[r[key]] = (a[r[key]] || 0) + 1;
      return a;
    }, {});
  const funded = opportunities.filter(
    (o) => o.funded_at && o.funded_amount !== null,
  );
  return {
    version: 2,
    as_of: new Date(now).toISOString(),
    rows: selected.slice(page * 50, page * 50 + 50),
    total: selected.length,
    settings: source.settings,
    stages: { no_process: selected.length },
    alerts: selected.filter((r) => r.needs_attention).slice(0, 5),
    summary: {
      active_opportunities: selected.length,
      total_opportunities: opportunities.length,
      active_processes: 0,
      total_processes: 0,
      unknown_processes: 0,
      pipeline_amount: opportunities
        .filter((o) => selected.some((r) => r.id === o.id))
        .reduce((s, o) => s + o.amount, 0),
      total_requested_amount: opportunities.reduce((s, o) => s + o.amount, 0),
      complete_cases: selected.filter((r) => r.documents_complete).length,
      required_documents: selected.reduce((s, r) => s + r.required_count, 0),
      received_documents: selected.reduce((s, r) => s + r.received_count, 0),
      approved_documents: selected.reduce((s, r) => s + r.approved_count, 0),
      review_documents: selected.reduce((s, r) => s + r.review_count, 0),
      application_counts: counts("application_status"),
      risk_counts: counts("risk_status"),
      confirmed_processes: null,
      confirmed_submissions: null,
      responded_submissions: null,
      application_sent_cases: null,
      active_offers: null,
      expiring_offers: null,
      funded_amount: funded.reduce((s, o) => s + (o.funded_amount || 0), 0),
      funded_count: funded.length,
      historical_funding_records: null,
      attention: selected.filter((r) => r.needs_attention).length,
      lender_counts: null,
    },
  };
}
