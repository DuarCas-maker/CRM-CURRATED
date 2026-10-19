"use client";

import { Fragment, useState } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ChevronDown,
  Clock3,
  FileWarning,
  Info,
} from "lucide-react";
import type { Locale } from "@/lib/domain";
import { dateLabel, stageLabels } from "@/lib/domain";
import { processStates } from "@/lib/financing-history";
import {
  controlAction,
  stageDuration,
  type ControlRow,
  type ControlSection,
  type FinancingControlData,
} from "@/lib/financing-control";
import { t } from "./ui";

const shortStates: Record<string, [string, string]> = {
  pending: ["Pendiente", "Pending"],
  draft: ["Borrador IA · revisar", "AI draft · review"],
  received: ["Recibida · revisar", "Received · review"],
  signed: ["Firmada · revisar", "Signed · review"],
  approved: ["Revisado", "Reviewed"],
  blocked: ["Bloqueado", "Blocked"],
  not_started: ["No iniciado", "Not started"],
  queued: ["En cola", "Queued"],
  preparing: ["Preparando", "Preparing"],
  running: ["En curso", "Running"],
  outdated: ["Desactualizado", "Outdated"],
  failed: ["Falló", "Failed"],
  uncertain: ["Incierto", "Uncertain"],
  rejected: ["Descartado", "Discarded"],
};
function CompactStatus({
  value,
  locale,
  application = false,
}: {
  value: string;
  locale: Locale;
  application?: boolean;
}) {
  const label =
    application && value === "approved"
      ? t(locale, "Aprobada", "Approved")
      : application && value === "draft"
        ? t(locale, "Borrador", "Draft")
        : shortStates[value]
          ? t(locale, ...shortStates[value])
          : value;
  return (
    <span className={`control-status control-status-${value}`}>{label}</span>
  );
}
function recency(value: string, asOf: string, locale: Locale) {
  const minutes = Math.floor((Date.parse(asOf) - Date.parse(value)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0)
    return t(locale, "No disponible", "Not available");
  if (minutes < 1) return t(locale, "Ahora", "Just now");
  const amount =
    minutes >= 1440
      ? `${Math.floor(minutes / 1440)} d`
      : minutes >= 60
        ? `${Math.floor(minutes / 60)} h`
        : `${minutes} min`;
  return t(locale, `Hace ${amount}`, `${amount} ago`);
}
function RowDetails({
  row: r,
  locale,
  asOf,
  lenderVisible,
}: {
  row: ControlRow;
  locale: Locale;
  asOf: string;
  lenderVisible: boolean;
}) {
  const a = controlAction(r, locale),
    na = t(locale, "No disponible", "Not available");
  const date = (value: string | null) =>
    value ? dateLabel(value, locale, true) : na;
  return (
    <div className="control-row-detail-grid">
      <div>
        <strong>
          {t(locale, "Documentos del expediente", "Case documents")}
        </strong>
        <p>
          {r.received_count}/{r.required_count}{" "}
          {t(locale, "recibidos", "received")} · {r.approved_count}/
          {r.required_count} {t(locale, "aprobados", "approved")}
        </p>
        <p>
          {r.review_count} {t(locale, "por revisar", "to review")} ·{" "}
          {r.missing_count} {t(locale, "faltantes", "missing")} ·{" "}
          {r.correction_count} {t(locale, "por corregir", "to correct")}
        </p>
        <p>
          {t(
            locale,
            "Aplicación y riesgo son información compartida del expediente; no certifican vigencia para cada renovación.",
            "Application and risk are shared case information; they do not certify currency for each renewal.",
          )}
        </p>
      </div>
      <div>
        <strong>
          {t(locale, "Proceso y comunicación", "Process and communication")}
        </strong>
        <p>
          {r.process_id
            ? `#${r.sequence_number} · ${r.process_label}`
            : t(locale, "Sin proceso asociado", "No linked process")}
        </p>
        <p>{stageDuration(r.stage_entered_at, asOf, locale)}</p>
        <p>
          {t(locale, "Recibido", "Received")}: {date(r.last_inbound_at)}
        </p>
        <p>
          {t(locale, "Enviado", "Sent")}: {date(r.last_outbound_at)}
        </p>
        <p>SLA: {date(r.reply_due_at || r.followup_due_at)}</p>
      </div>
      <div>
        <strong>
          {t(locale, "Solicitudes y ofertas", "Submissions and offers")}
        </strong>
        {lenderVisible ? (
          <>
            <p>
              {r.confirmed_count}{" "}
              {t(locale, "solicitudes confirmadas", "confirmed submissions")} ·{" "}
              {r.response_count} {t(locale, "con respuesta", "with replies")}
            </p>
            <p>
              {r.application_sent_count}{" "}
              {t(
                locale,
                "con aplicación en el paquete enviado",
                "with application in the sent package",
              )}
            </p>
            <p>
              {r.active_offers} {t(locale, "ofertas activas", "active offers")}{" "}
              · {r.expiring_offers} {t(locale, "por vencer", "expiring")} ·{" "}
              {r.expired_offers} {t(locale, "vencidas", "expired")}
            </p>
            {r.lenders.map((l) => (
              <p key={l.id}>
                {l.name} · {l.status} · {date(l.sent_at)}
              </p>
            ))}
          </>
        ) : (
          <p>{na}</p>
        )}
      </div>
      <div>
        <strong>{t(locale, "Próxima acción", "Next action")}</strong>
        <p>{a.reason}</p>
        <p>{a.label}</p>
        <p>
          {a.owner || t(locale, "Sin responsable", "Unassigned")} ·{" "}
          {date(a.due)}
        </p>
        <p>
          {t(locale, "Etapa de oportunidad", "Opportunity stage")}:{" "}
          {stageLabels[locale][r.stage]}
        </p>
      </div>
    </div>
  );
}

export function FinancingTrackingTable({
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
  loading,
  filters,
  stageName,
}: {
  data: FinancingControlData;
  locale: Locale;
  filter: string;
  setFilter: (value: string) => void;
  page: number;
  setPage: (value: number) => void;
  processState: string;
  setProcessState: (value: string) => void;
  stalled: string;
  setStalled: (value: string) => void;
  open: (id: string, section: ControlSection) => void;
  loading: boolean;
  filters: [string, string, string][];
  stageName: (value: string) => string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const s = data.summary,
    na = t(locale, "No disponible", "Not available");
  const number = (value: number | null) =>
    value === null ? na : String(value);
  return (
    <section className="panel control-tracking">
      <div className="control-tracking-heading">
        <div>
          <h2>{t(locale, "Seguimiento de expedientes", "Case tracking")}</h2>
          <p>
            {t(
              locale,
              "Documentos, riesgo y próximos pasos, en una sola vista.",
              "Documents, risk and next steps in one view.",
            )}
          </p>
        </div>
        <span>
          {data.rows.length} / {data.total} {t(locale, "registros", "records")}
        </span>
      </div>
      <div className="control-tracking-toolbar">
        <label>
          {t(locale, "Mostrar", "Show")}
          <select
            aria-label={t(locale, "Filtro de atención", "Attention filter")}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            {filters.map(([key, es, en]) => (
              <option value={key} key={key}>
                {t(locale, es, en)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t(locale, "Etapa del proceso", "Process stage")}
          <select
            value={processState}
            onChange={(e) => {
              setProcessState(e.target.value);
              setPage(0);
            }}
          >
            <option value="">{t(locale, "Todas", "All")}</option>
            <option value="no_process">
              {t(locale, "Sin proceso asociado", "No linked process")}
            </option>
            <option value="restricted">
              {t(locale, "Etapa restringida", "Restricted stage")}
            </option>
            {Object.entries(processStates).map(([key, label]) => (
              <option key={key} value={key}>
                {label[locale === "es" ? 0 : 1]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t(locale, "Tiempo en etapa", "Time in stage")}
          <select
            value={stalled}
            onChange={(e) => {
              setStalled(e.target.value);
              setPage(0);
            }}
          >
            <option value="">
              {t(locale, "Cualquier duración", "Any duration")}
            </option>
            {[3, 5, 7, 14].map((days) => (
              <option key={days} value={days}>
                ≥ {days} {t(locale, "días", "days")}
              </option>
            ))}
          </select>
        </label>
        {(filter !== "all" || processState || stalled) && (
          <button
            className="text-button control-reset"
            onClick={() => {
              setFilter("all");
              setProcessState("");
              setStalled("");
              setPage(0);
            }}
          >
            {t(locale, "Limpiar", "Clear")}
          </button>
        )}
        <details className="control-breakdown">
          <summary>
            <Info size={13} />
            {t(locale, "Ver desglose", "View breakdown")}
            <ChevronDown size={12} />
          </summary>
          <div className="control-breakdown-body">
            <p>
              {t(
                locale,
                "Estado compartido del expediente. Las fechas de etapa requieren una transición auditada.",
                "Shared case status. Stage dates require an audited transition.",
              )}
            </p>
            <div className="control-breakdown-metrics">
              <span>
                {t(locale, "Aplicaciones", "Applications")}:{" "}
                {Object.entries(s.application_counts).map(([state, count]) => (
                  <span key={state}>
                    <CompactStatus value={state} locale={locale} application />{" "}
                    <b>{count}</b>{" "}
                  </span>
                ))}
              </span>
              <span>
                {t(locale, "Riesgo", "Risk")}:{" "}
                {Object.entries(s.risk_counts).map(([state, count]) => (
                  <span key={state}>
                    <CompactStatus value={state} locale={locale} />{" "}
                    <b>{count}</b>{" "}
                  </span>
                ))}
              </span>
              <span>
                {t(
                  locale,
                  "Aplicación en paquete confirmado",
                  "Application in confirmed package",
                )}
                :{" "}
                <b>
                  {number(s.application_sent_cases)}/{s.active_opportunities}
                </b>{" "}
                ·{" "}
                {t(
                  locale,
                  "Ofertas activas / por vencer",
                  "Active / expiring offers",
                )}
                :{" "}
                <b>
                  {number(s.active_offers)} / {number(s.expiring_offers)}
                </b>
              </span>
            </div>
          </div>
        </details>
      </div>
      <div className="table-wrap control-tracking-scroll">
        <table className="control-table">
          <thead>
            <tr>
              {[
                t(locale, "Cliente / proceso", "Client / process"),
                t(locale, "Documentación", "Documentation"),
                t(locale, "Aplicación", "Application"),
                t(locale, "Análisis de riesgo", "Risk analysis"),
                t(locale, "Envío / lender", "Submission / lender"),
                t(locale, "Permanencia", "Time in stage"),
                t(locale, "Comunicación", "Communication"),
                t(locale, "Próximo paso", "Next step"),
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const a = controlAction(r, locale),
                detailId = `control-detail-${r.row_key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
              const received = r.last_inbound_at,
                sent = r.last_outbound_at;
              const last =
                received && sent
                  ? Date.parse(received) >= Date.parse(sent)
                    ? received
                    : sent
                  : received || sent;
              const inbound = !!last && last === received;
              const waiting = r.reply_count > 0 ? "team" : r.waiting_for;
              const waitingLabel = waiting
                ? {
                    team: t(locale, "Equipo", "Team"),
                    client: t(locale, "Cliente", "Client"),
                    lender: "Lender",
                  }[waiting] || na
                : null;
              const progress =
                r.required_count > 0
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        (100 * r.approved_count) / r.required_count,
                      ),
                    )
                  : 0;
              const noDate = stageDuration(
                r.stage_entered_at,
                data.as_of,
                locale,
              );
              return (
                <Fragment key={r.row_key}>
                  <tr
                    className={expanded === r.row_key ? "control-row-open" : ""}
                  >
                    <td className="control-company">
                      <button
                        className="text-button"
                        onClick={() => open(r.id, "activity")}
                      >
                        <strong>{r.company}</strong>
                      </button>
                      <small>
                        {r.contact}
                        {r.process_id ? ` · #${r.sequence_number}` : ""}
                      </small>
                      <div className="control-company-meta">
                        <span
                          className="control-status"
                          title={
                            r.process_id
                              ? t(locale, "Etapa del proceso", "Process stage")
                              : t(
                                  locale,
                                  "Etapa de oportunidad · sin proceso asociado",
                                  "Opportunity stage · no linked process",
                                )
                          }
                        >
                          {r.process_state
                            ? stageName(r.process_state)
                            : stageLabels[locale][r.stage]}
                        </span>
                        <span>
                          {r.owner_name ||
                            t(locale, "Sin responsable", "Unassigned")}
                        </span>
                      </div>
                    </td>
                    <td className="control-documents">
                      <button
                        className="text-button control-doc-main"
                        onClick={() => open(r.id, "documents")}
                      >
                        {r.approved_count}/{r.required_count}{" "}
                        {t(locale, "aprobados", "approved")}
                      </button>
                      <div className="control-document-meta">
                        <span>
                          {r.received_count}/{r.required_count}{" "}
                          {t(locale, "recibidos", "received")}
                        </span>
                        {r.review_count > 0 && (
                          <span
                            className="control-document-signal"
                            title={t(
                              locale,
                              `${r.review_count} por revisar`,
                              `${r.review_count} to review`,
                            )}
                            aria-label={t(
                              locale,
                              `${r.review_count} por revisar`,
                              `${r.review_count} to review`,
                            )}
                          >
                            <Clock3 size={11} />
                            {r.review_count}
                          </span>
                        )}
                        {(r.missing_count > 0 || r.correction_count > 0) && (
                          <span
                            className="control-document-signal"
                            title={t(
                              locale,
                              `${r.missing_count} faltantes · ${r.correction_count} por corregir`,
                              `${r.missing_count} missing · ${r.correction_count} to correct`,
                            )}
                            aria-label={t(
                              locale,
                              `${r.missing_count} faltantes · ${r.correction_count} por corregir`,
                              `${r.missing_count} missing · ${r.correction_count} to correct`,
                            )}
                          >
                            <FileWarning size={11} />
                          </span>
                        )}
                      </div>
                      <div
                        className="control-document-bar"
                        role="progressbar"
                        aria-label={t(
                          locale,
                          "Requisitos documentales aprobados",
                          "Approved document requirements",
                        )}
                        aria-valuenow={r.approved_count}
                        aria-valuemin={0}
                        aria-valuemax={Math.max(1, r.required_count)}
                      >
                        <span style={{ width: `${progress}%` }} />
                      </div>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => open(r.id, "documents")}
                      >
                        <CompactStatus
                          value={r.application_status}
                          locale={locale}
                          application
                        />
                      </button>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => open(r.id, "analysis")}
                      >
                        <CompactStatus value={r.risk_status} locale={locale} />
                      </button>
                    </td>
                    <td>
                      {s.confirmed_submissions === null ? (
                        <span className="control-cell-muted">{na}</span>
                      ) : (
                        <>
                          <button
                            className="text-button control-submission-main"
                            onClick={() => open(r.id, "lenders")}
                          >
                            {r.confirmed_count
                              ? `${r.confirmed_count} ${t(locale, "solicitudes", "submissions")}`
                              : t(locale, "Sin enviar", "Not sent")}
                          </button>
                          {r.confirmed_count > 0 && (
                            <small>
                              {r.response_count}/{r.confirmed_count}{" "}
                              {t(locale, "respuestas", "replies")}
                            </small>
                          )}
                          {r.active_offers > 0 && (
                            <small
                              className={
                                r.expiring_offers ? "control-expiring" : ""
                              }
                            >
                              {r.active_offers} {t(locale, "ofertas", "offers")}
                              {r.expiring_offers
                                ? ` · ${r.expiring_offers} ${t(locale, "por vencer", "expiring")}`
                                : ""}
                            </small>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <strong className="control-duration" title={noDate}>
                        {r.stage_entered_at
                          ? noDate
                          : t(locale, "Sin fecha", "No date")}
                      </strong>
                      {!r.stage_entered_at && (
                        <span className="control-sr-only">
                          {t(
                            locale,
                            "Sin fecha verificable",
                            "No verified date",
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      {last ? (
                        <span
                          className="control-message-age"
                          title={`${inbound ? t(locale, "Recibido", "Received") : t(locale, "Enviado", "Sent")}: ${dateLabel(last, locale, true)}`}
                        >
                          {inbound ? (
                            <ArrowDownLeft size={12} />
                          ) : (
                            <ArrowUpRight size={12} />
                          )}{" "}
                          {recency(last, data.as_of, locale)}
                        </span>
                      ) : (
                        <span
                          className="control-cell-muted"
                          aria-label={t(
                            locale,
                            "Sin mensajes con fecha verificable",
                            "No messages with a verified date",
                          )}
                        >
                          —
                        </span>
                      )}
                      {waitingLabel && (
                        <small className="control-waiting">
                          {t(locale, "Espera", "Waiting")}: {waitingLabel}
                        </small>
                      )}
                    </td>
                    <td className="control-next">
                      <button
                        className="text-button control-next-link"
                        onClick={() => open(r.id, a.section)}
                      >
                        {a.label}
                        <ArrowUpRight size={12} />
                      </button>
                      <small>
                        {a.owner || t(locale, "Sin responsable", "Unassigned")}
                        {a.due ? ` · ${dateLabel(a.due, locale)}` : ""}
                      </small>
                      <button
                        className="control-detail-toggle"
                        aria-expanded={expanded === r.row_key}
                        aria-controls={
                          expanded === r.row_key ? detailId : undefined
                        }
                        aria-label={t(
                          locale,
                          `Detalle de ${r.company}`,
                          `Details for ${r.company}`,
                        )}
                        onClick={() =>
                          setExpanded(expanded === r.row_key ? null : r.row_key)
                        }
                      >
                        {t(locale, "Detalle", "Details")}
                        <ChevronDown size={11} />
                      </button>
                    </td>
                  </tr>
                  {expanded === r.row_key && (
                    <tr className="control-detail-row" id={detailId}>
                      <td colSpan={8}>
                        <RowDetails
                          row={r}
                          locale={locale}
                          asOf={data.as_of}
                          lenderVisible={s.confirmed_submissions !== null}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!data.rows.length && (
        <p className="control-empty">
          {t(
            locale,
            "No hay expedientes con estos filtros.",
            "No cases match these filters.",
          )}
        </p>
      )}
      <div className="table-footer">
        <span>
          {data.rows.length ? page * 50 + 1 : 0}–
          {data.rows.length ? page * 50 + data.rows.length : 0} / {data.total}
        </span>
        <div className="card-actions">
          <button
            className="button"
            disabled={!page || loading}
            onClick={() => setPage(page - 1)}
          >
            {t(locale, "Anterior", "Previous")}
          </button>
          <button
            className="button"
            disabled={(page + 1) * 50 >= data.total || loading}
            onClick={() => setPage(page + 1)}
          >
            {t(locale, "Siguiente", "Next")}
          </button>
        </div>
      </div>
    </section>
  );
}
