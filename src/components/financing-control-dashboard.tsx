"use client";
import {
  Info,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  Layers,
  ShieldCheck,
  Send,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Locale } from "@/lib/domain";
import { currency, dateLabel } from "@/lib/domain";
import { processStates } from "@/lib/financing-history";
import type {
  ControlRow,
  ControlSection,
  FinancingControlData,
} from "@/lib/financing-control";
import { controlAction } from "@/lib/financing-control";
import { t } from "./ui";
import "./financing-control-dashboard.css";
import { FinancingTrackingTable } from "./financing-tracking-table";

const statusLabels: Record<string, [string, string]> = {
  pending: ["Pendiente", "Pending"],
  draft: [
    "Borrador · revisión humana pendiente",
    "Draft · human review pending",
  ],
  received: ["Recibida", "Received"],
  signed: ["Firmada · revisar", "Signed · review"],
  approved: ["Aprobado y vigente", "Approved and current"],
  blocked: ["Bloqueado por requisitos", "Blocked by requirements"],
  not_started: ["No iniciado", "Not started"],
  queued: ["En cola", "Queued"],
  preparing: ["Preparando", "Preparing"],
  running: ["En curso", "Running"],
  outdated: ["Desactualizado", "Outdated"],
  failed: ["Falló", "Failed"],
  uncertain: ["Resultado incierto", "Uncertain result"],
  rejected: ["Descartado por revisión humana", "Discarded after human review"],
  no_process: ["Sin proceso asociado", "No linked process"],
  restricted: ["Etapa restringida", "Restricted stage"],
  submitted: ["Enviado", "Submitted"],
  reviewing: ["En revisión del lender", "Lender reviewing"],
  requirements: ["Requisitos adicionales", "Additional requirements"],
  offer: ["Oferta", "Offer"],
  withdrawn: ["Retirada", "Withdrawn"],
};
function InfoNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="control-info">
      <summary aria-label={label}>
        <Info size={15} aria-hidden="true" />
      </summary>
      <div className="control-explanation">{children}</div>
    </details>
  );
}
const filters: [string, string, string][] = [
  ["all", "Todos", "All"],
  ["attention", "Necesitan atención", "Need attention"],
  ["reply", "Por responder", "Awaiting reply"],
  ["overdue", "Vencidos", "Overdue"],
  ["missing", "Docs. faltantes", "Missing docs"],
  ["review", "Docs. por revisar", "Docs to review"],
  ["documents", "Documentos", "Documents"],
  ["application", "Aplicación incompleta", "Incomplete application"],
  ["analysis", "Riesgo por validar", "Risk to validate"],
  ["unsent", "Paquete sin enviar", "Package not sent"],
  ["lender", "Con lender", "With lender"],
  ["negotiation", "Negociación", "Negotiation"],
  ["offers", "Ofertas por vencer / vencidas", "Expiring / expired offers"],
  ["unassigned", "Sin responsable", "Unassigned"],
];
export function FinancingControlDashboard({
  data,
  locale,
  filter,
  setFilter,
  page,
  setPage,
  processState,
  setProcessState,
  stalled,
  setStalled,
  open,
  period,
  loading = false,
}: {
  data: FinancingControlData;
  locale: Locale;
  filter: string;
  setFilter: (s: string) => void;
  page: number;
  setPage: (n: number) => void;
  processState: string;
  setProcessState: (s: string) => void;
  stalled: string;
  setStalled: (s: string) => void;
  open: (id: string, section: ControlSection) => void;
  period: string;
  loading?: boolean;
}) {
  const s = data.summary,
    en = locale === "en",
    na = t(locale, "No disponible", "Not available");
  const number = (n: number | null | undefined) =>
    n == null ? na : new Intl.NumberFormat(en ? "en-US" : "es-CO").format(n);
  const money = (n: number | null) => (n === null ? na : currency(n, locale));
  const stageName = (state: string) =>
    state in processStates
      ? processStates[state as keyof typeof processStates][en ? 1 : 0]
      : t(locale, ...(statusLabels[state] || statusLabels.no_process));
  const reviewRisk =
    (s.risk_counts.draft || 0) +
    (s.risk_counts.outdated || 0) +
    (s.risk_counts.failed || 0) +
    (s.risk_counts.uncertain || 0) +
    (s.risk_counts.rejected || 0);
  const help = t(locale, "Cómo se calcula", "How this is calculated");
  const kpis: {
    label: string;
    value: string;
    total: string;
    detail: string;
    help: string;
    icon: ReactNode;
    dark?: boolean;
  }[] = [
    {
      label: t(locale, "Procesos activos", "Active processes"),
      value: number(s.active_processes),
      total: t(
        locale,
        `de ${number(s.total_processes)} procesos registrados`,
        `of ${number(s.total_processes)} recorded processes`,
      ),
      detail: t(
        locale,
        `${s.active_opportunities} de ${s.total_opportunities} oportunidades · ${s.unknown_processes} procesos sin clasificar`,
        `${s.active_opportunities} of ${s.total_opportunities} opportunities · ${s.unknown_processes} unclassified processes`,
      ),
      help: t(
        locale,
        "Procesos clasificados como activos, sin fecha de cierre y fuera de estados terminales. Oportunidades y procesos se cuentan por separado. Totales de referencia: búsqueda, responsable, campaña y período de creación del expediente.",
        "Processes classified active, with no end date and outside terminal states. Opportunities and processes are separate units. Reference totals use search, owner, campaign and case creation period.",
      ),
      icon: <Layers size={18} />,
    },
    {
      label: t(locale, "Pipeline solicitado · USD", "Requested pipeline · USD"),
      value: money(s.pipeline_amount),
      total: t(
        locale,
        `Total solicitado: ${money(s.total_requested_amount)}`,
        `Total requested: ${money(s.total_requested_amount)}`,
      ),
      detail: t(
        locale,
        "Importe por oportunidad, sin duplicar lenders",
        "Amount per opportunity, without lender duplication",
      ),
      help: t(
        locale,
        "Suma del importe solicitado de oportunidades activas seleccionadas, una vez por oportunidad. El total incluye las oportunidades del universo general filtrado. No representa aprobación ni desembolso.",
        "Sum of requested amounts for selected active opportunities, once per opportunity. Total includes opportunities in the general filtered scope. It does not represent approval or disbursement.",
      ),
      icon: <CircleDollarSign size={18} />,
    },
    {
      label: t(locale, "Documentación completa", "Complete documentation"),
      value: number(s.complete_cases),
      total: t(
        locale,
        `de ${s.active_opportunities} expedientes activos`,
        `of ${s.active_opportunities} active cases`,
      ),
      detail: t(
        locale,
        `${s.approved_documents}/${s.required_documents} requisitos aprobados · ${s.received_documents} recibidos`,
        `${s.approved_documents}/${s.required_documents} requirements approved · ${s.received_documents} received`,
      ),
      help: t(
        locale,
        "Un expediente cuenta una vez, aunque tenga varios procesos. Exige aplicación firmada y aprobada, cuatro extractos con hashes distintos y los adicionales obligatorios aprobados con archivo, hash y revisión humana. Los adjuntos detectados en correo no cuentan.",
        "Each case counts once, even with multiple processes. Requires a signed approved application, four statements with distinct hashes and all mandatory extras approved with a file, hash and human review. Detected email attachments do not count.",
      ),
      icon: <FileCheck2 size={18} />,
    },
    {
      label: t(
        locale,
        "Riesgo por revisar / resolver",
        "Risk to review / resolve",
      ),
      value: number(reviewRisk),
      total: t(
        locale,
        `de ${s.active_opportunities} expedientes activos`,
        `of ${s.active_opportunities} active cases`,
      ),
      detail: t(
        locale,
        `${s.risk_counts.approved || 0} vigentes · ${s.risk_counts.draft || 0} borradores · ${s.risk_counts.outdated || 0} desactualizados`,
        `${s.risk_counts.approved || 0} current · ${s.risk_counts.draft || 0} drafts · ${s.risk_counts.outdated || 0} outdated`,
      ),
      help: t(
        locale,
        "Cuenta borradores, informes desactualizados, fallos, resultados inciertos y descartes, una vez por expediente. Un informe al 100% sigue siendo borrador hasta su revisión humana. Bloqueados y no iniciados aparecen en el desglose inferior.",
        "Counts drafts, outdated reports, failures, uncertain results and discarded reports, once per case. A 100% report remains a draft until human review. Blocked and not-started cases appear below.",
      ),
      icon: <ShieldCheck size={18} />,
    },
    {
      label: t(
        locale,
        "Procesos con envío confirmado",
        "Processes with confirmed sends",
      ),
      value: number(s.confirmed_processes),
      total: t(
        locale,
        `de ${s.active_processes} procesos activos`,
        `of ${s.active_processes} active processes`,
      ),
      detail: t(
        locale,
        `${number(s.confirmed_submissions)} solicitudes · ${number(s.responded_submissions)} con respuesta`,
        `${number(s.confirmed_submissions)} submissions · ${number(s.responded_submissions)} with replies`,
      ),
      help: t(
        locale,
        "Proceso con al menos una submission y correo enviado reconciliado con mensaje saliente confirmado. La aplicación enviada requiere su versión en submission_documents. Cola, incertidumbre y submitted_at por sí solos no cuentan. Las respuestas requieren mensaje recibido posterior al primer envío.",
        "Process with at least one submission and sent email reconciled with a confirmed outgoing message. A sent application requires its version in submission_documents. Queues, uncertain sends and submitted_at alone do not count. Replies require received messages after the first send.",
      ),
      icon: <Send size={18} />,
    },
    {
      label: t(
        locale,
        "Desembolsos registrados · USD",
        "Recorded funding · USD",
      ),
      value: money(s.funded_amount),
      total: t(
        locale,
        `Total del período: ${number(s.funded_count)} operaciones`,
        `Period total: ${number(s.funded_count)} deals`,
      ),
      detail: t(
        locale,
        `${number(s.historical_funding_records)} registros históricos por conciliar`,
        `${number(s.historical_funding_records)} historical records to reconcile`,
      ),
      help: t(
        locale,
        "Suma de funded_amount por fecha real funded_at, con permisos closer. Aplica búsqueda, responsable y campaña; el período filtra el desembolso, no la creación del caso. Los registros de financiación histórica por proceso se informan aparte para evitar doble conteo. No cambia con las pestañas operativas.",
        "Sum of funded_amount by actual funded_at, with closer permissions. Applies search, owner and campaign; period filters funding events, not case creation. Historical process funding records are shown separately to avoid double counting. Operational tabs do not change it.",
      ),
      icon: <CheckCircle2 size={18} />,
      dark: true,
    },
  ];
  const next = (r: ControlRow) => controlAction(r, locale);
  return (
    <div className="financing-control" aria-busy={loading}>
      <p className="control-scope">
        {t(
          locale,
          "Estado actual de expedientes creados en el período seleccionado. Desembolsos: fecha real del evento.",
          "Current state of cases created in the selected period. Funding: actual event date.",
        )}{" "}
        <strong>
          {period === "all"
            ? t(locale, "Todo el historial", "All history")
            : t(locale, `Últimos ${period} días`, `Last ${period} days`)}
        </strong>{" "}
        · {t(locale, "Corte", "As of")} {dateLabel(data.as_of, locale, true)}
      </p>
      <section
        className="control-kpis"
        aria-label={t(
          locale,
          "Indicadores de financiación",
          "Financing indicators",
        )}
      >
        {kpis.map((k) => (
          <article
            className={`control-kpi ${k.dark ? "control-kpi-dark" : ""}`}
            key={k.label}
          >
            <div className="control-kpi-label">
              <span>
                {k.icon}
                {k.label}
              </span>
              <InfoNote label={`${help}: ${k.label}`}>{k.help}</InfoNote>
            </div>
            <strong className="control-kpi-value">{k.value}</strong>
            <span className="control-kpi-total">{k.total}</span>
            <small>{k.detail}</small>
          </article>
        ))}
      </section>
      <div className="control-top-grid">
        <section className="panel control-stages">
          <div className="section-heading">
            <h2>
              {t(
                locale,
                "Distribución por etapa del proceso",
                "Distribution by process stage",
              )}
            </h2>
            <InfoNote label={`${help}: ${t(locale, "etapas", "stages")}`}>
              {t(
                locale,
                "Cada proceso aparece una sola vez en su estado actual. Las filas sin proceso se muestran aparte. Esta distribución no mide conversión histórica. Se aplican los filtros operativos, antes de paginar.",
                "Each process appears once in its current state. Rows without a process are shown separately. This distribution does not measure historical conversion. Operational filters apply before pagination.",
              )}
            </InfoNote>
          </div>
          <div className="control-stage-list">
            {Object.entries(data.stages).map(([state, n]) => (
              <button
                key={state}
                className="control-stage-row"
                onClick={() => {
                  setProcessState(state);
                  setPage(0);
                }}
              >
                <span>{stageName(state)}</span>
                <span className="control-stage-bar">
                  <span
                    style={{
                      width: `${data.total ? (100 * n) / data.total : 0}%`,
                    }}
                  />
                </span>
                <strong>
                  {n}
                  <small> / {data.total}</small>
                </strong>
              </button>
            ))}
            {!data.total && (
              <p className="muted">
                {t(
                  locale,
                  "Sin registros para estos filtros.",
                  "No records for these filters.",
                )}
              </p>
            )}
          </div>
          <p className="muted">
            {s.active_processes} {t(locale, "procesos", "processes")} ·{" "}
            {data.total - s.active_processes}{" "}
            {t(
              locale,
              "filas sin proceso asociado",
              "rows without a linked process",
            )}
          </p>
        </section>
        <section className="panel control-priorities">
          <div className="section-heading">
            <h2>
              {t(locale, "Para atender hoy", "To address today")}{" "}
              <span className="badge">{s.attention}</span>
            </h2>
            <InfoNote
              label={`${help}: ${t(locale, "prioridades", "priorities")}`}
            >
              {t(
                locale,
                `Oferta vigente que vence en ${data.settings.offer_warning_hours} h, conversación pendiente, tarea o seguimiento vencido, falta de responsable, documentos por revisar, riesgo y proceso estancado. Respuesta del equipo: ${data.settings.reply_hours} h; seguimiento: ${data.settings.followup_hours} h calendario. No se envían correos desde esta vista.`,
                `Current offer expiring within ${data.settings.offer_warning_hours} h, pending conversation, overdue task or follow-up, missing owner, document review, risk and stalled process. Team reply: ${data.settings.reply_hours} h; follow-up: ${data.settings.followup_hours} calendar h. This view does not send email.`,
              )}
            </InfoNote>
          </div>
          {data.alerts.map((r) => {
            const a = next(r);
            return (
              <button
                className={`control-alert ${r.priority === "offers" ? "control-alert-critical" : ""}`}
                key={r.row_key}
                onClick={() => open(r.id, a.section)}
              >
                <span>
                  <span className="control-alert-heading">
                    <strong>{r.company}</strong>
                    {a.due && <small>{dateLabel(a.due, locale)}</small>}
                  </span>
                  <span>{a.label}</span>
                  <small>
                    {a.reason} ·{" "}
                    {a.owner || t(locale, "Sin responsable", "Unassigned")}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            );
          })}
          {!data.alerts.length && (
            <p className="muted">
              {t(
                locale,
                "Sin alertas en los filtros actuales.",
                "No alerts in the current filters.",
              )}
            </p>
          )}
        </section>
      </div>
      <FinancingTrackingTable
        data={data}
        locale={locale}
        filter={filter}
        setFilter={setFilter}
        page={page}
        setPage={setPage}
        processState={processState}
        setProcessState={setProcessState}
        stalled={stalled}
        setStalled={setStalled}
        open={open}
        loading={loading}
        filters={filters}
        stageName={stageName}
      />
      {s.lender_counts && s.lender_counts.length > 0 && (
        <section className="panel control-lenders">
          <div className="section-heading">
            <h2>
              {t(
                locale,
                "Envíos confirmados por lender",
                "Confirmed submissions by lender",
              )}
            </h2>
            <InfoNote label={`${help}: lenders`}>
              {t(
                locale,
                "Una submission cuenta una vez por lender, aunque tenga varios correos. Respuesta significa mensaje entrante confirmado posterior al envío; no implica aprobación comercial. Se aplican los mismos filtros de la tabla.",
                "A submission counts once per lender, even with multiple emails. A reply is a confirmed incoming message after submission; it does not imply commercial approval. The table filters apply.",
              )}
            </InfoNote>
          </div>
          {s.lender_counts.map((l) => (
            <div className="control-stage-row" key={l.name}>
              <span>{l.name}</span>
              <span className="control-stage-bar">
                <span
                  style={{
                    width: `${s.confirmed_submissions ? (100 * l.submissions) / s.confirmed_submissions : 0}%`,
                  }}
                />
              </span>
              <strong>
                {l.responses} / {l.submissions}
                <small>
                  {" "}
                  {t(
                    locale,
                    "respuestas / solicitudes",
                    "replies / submissions",
                  )}
                </small>
              </strong>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
