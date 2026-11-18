"use client";
import { Fragment, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  FileText,
  Mail,
  Sparkles,
  Landmark,
  Check,
} from "lucide-react";
import type { Locale } from "@/lib/domain";
import { currency, dateLabel, stageLabels } from "@/lib/domain";
import {
  pipelineLabel,
  pipelineStages,
  type PipelineBoard,
  type PipelineGroup,
  type PipelineRow,
} from "@/lib/pipeline-os/module";
import { t } from "../ui";

export type CaseSection =
  "activity" | "documents" | "analysis" | "lenders" | "mail_history";
export type OpenPipelineCase = (id: string, section?: CaseSection) => void;

export function PipelineTable({
  board,
  group,
  locale,
  open,
  mail,
  complete,
  busy,
}: {
  board: PipelineBoard;
  group: PipelineGroup;
  locale: Locale;
  open: OpenPipelineCase;
  mail: (id: string) => void;
  complete?: (id: string) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  return (
    <div className="pos-card pos-table-card">
      <div className="pos-card-head">
        <h3>{pipelineLabel(group, locale)}</h3>
        <span className="pos-muted">
          {board.total} {t(locale, "expedientes", "files")}
        </span>
      </div>
      <div className="pos-scroll">
        <table className="pos-table">
          <thead>
            <tr>
              <th>{t(locale, "Negocio / responsable", "Business / rep")}</th>
              <th>{t(locale, "Estado", "Stage")}</th>
              {group === "offers" ? (
                <>
                  <th>{t(locale, "Selección humana", "Human selection")}</th>
                  <th>{t(locale, "Mayor monto", "Highest amount")}</th>
                  <th>{t(locale, "Comparación", "Comparison")}</th>
                </>
              ) : group === "clients" ? (
                <>
                  <th>{t(locale, "Fondeado", "Funded")}</th>
                  <th>{t(locale, "Fecha", "Date")}</th>
                  <th>{t(locale, "Próximo paso", "Next step")}</th>
                </>
              ) : (
                <>
                  <th>{t(locale, "Documentos", "Documents")}</th>
                  <th>Lenders</th>
                  <th>{t(locale, "Próximo paso", "Next step")}</th>
                </>
              )}
              <th>{t(locale, "Acciones", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>
                    <button className="pos-business" onClick={() => open(r.id)}>
                      {r.company}
                      <ArrowUpRight size={13} />
                    </button>
                    <div className="pos-small pos-muted">
                      {r.ownerName} · {r.contact}
                    </div>
                    {r.campaignEngagement && <span className="pos-pill">{r.campaignEngagement === "bounced" ? t(locale,"Incidencia: rebote","Issue: bounced") : r.campaignEngagement === "in_progress" ? t(locale,"En proceso · respondió","In progress · replied") : t(locale,"Sin respuesta","No reply")}</span>}
                    {group === "tasks" && (
                      <span className={`pos-pill pos-p${r.priority}`}>
                        P{r.priority}
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`pos-pill pos-stage-${r.groups[2] || r.stage}`}
                    >
                      {stageLabels[locale][r.stage]}
                    </span>
                    {r.processState && (
                      <div className="pos-small pos-muted">
                        {r.processState.replaceAll("_", " ")}
                      </div>
                    )}
                  </td>
                  {group === "offers" ? (
                    <>
                      <td>
                        {r.selectedOffer ? (
                          <>
                            <strong>
                              {currency(r.selectedOffer.amount, locale)}
                            </strong>
                            <div className="pos-small">
                              {r.selectedOffer.lenderName}
                            </div>
                            <span className="pos-pill pos-good">
                              <Check size={11} />
                              {t(locale, "Elegida", "Selected")}
                            </span>
                          </>
                        ) : (
                          <span className="pos-muted">
                            {t(
                              locale,
                              "Pendiente de revisión",
                              "Awaiting review",
                            )}
                          </span>
                        )}
                      </td>
                      <td>
                        {r.highestOffer ? (
                          <>
                            <strong>
                              {currency(r.highestOffer.amount, locale)}
                            </strong>
                            <div className="pos-small pos-muted">
                              {r.highestOffer.lenderName}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <button
                          className="pos-btn pos-sm"
                          aria-expanded={expanded.includes(r.id)}
                          aria-controls={`pos-offers-${r.id}`}
                          onClick={() =>
                            setExpanded((x) =>
                              x.includes(r.id)
                                ? x.filter((i) => i !== r.id)
                                : [...x, r.id],
                            )
                          }
                        >
                          {r.offers?.length ?? "—"}{" "}
                          {t(locale, "ofertas", "offers")}
                          <ChevronDown size={13} />
                        </button>
                      </td>
                    </>
                  ) : group === "clients" ? (
                    <>
                      <td>
                        {r.fundedAmount === null
                          ? "—"
                          : currency(r.fundedAmount, locale)}
                      </td>
                      <td>{dateLabel(r.fundedAt, locale)}</td>
                      <td>
                        <NextAction row={r} locale={locale} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <button
                          className="pos-text-btn"
                          onClick={() => open(r.id, "documents")}
                        >
                          {r.documentCount} {t(locale, "archivos", "files")}
                        </button>
                        <div className="pos-small pos-muted">
                          {r.approvedCount}/{r.requiredCount}{" "}
                          {t(
                            locale,
                            "requeridos aprobados",
                            "required approved",
                          )}
                        </div>
                      </td>
                      <td>
                        <button
                          className="pos-text-btn"
                          onClick={() => mail(r.id)}
                        >
                          {r.lenderCount ?? "—"}{" "}
                          {t(locale, "contactados", "contacted")}
                        </button>
                      </td>
                      <td>
                        <NextAction row={r} locale={locale} />
                      </td>
                    </>
                  )}
                  <td>
                    <div className="pos-actions">
                      <button
                        className="pos-btn pos-sm"
                        onClick={() => mail(r.id)}
                        aria-label={`${t(locale, "Conversaciones de", "Conversations for")} ${r.company}`}
                        title={t(locale, "Conversaciones", "Conversations")}
                      >
                        <Mail size={14} />
                      </button>
                      <button
                        className="pos-btn pos-sm"
                        onClick={() =>
                          open(
                            r.id,
                            group === "offers"
                              ? "lenders"
                              : group === "app" || group === "need"
                                ? "analysis"
                                : "activity",
                          )
                        }
                      >
                        <span>
                          {group === "app" || group === "need"
                            ? "UW"
                            : t(locale, "Abrir", "Open")}
                        </span>
                        <ArrowUpRight size={13} />
                      </button>
                      {r.taskId && complete && (
                        <button
                          className="pos-btn pos-sm"
                          disabled={busy}
                          onClick={() => complete(r.taskId!)}
                          aria-label={t(
                            locale,
                            "Completar próxima tarea",
                            "Complete next task",
                          )}
                        >
                          <Check size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {group === "offers" && expanded.includes(r.id) && (
                  <tr id={`pos-offers-${r.id}`}>
                    <td colSpan={6}>
                      <OfferComparison row={r} locale={locale} open={open} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!board.rows.length && (
        <div className="pos-empty">
          <FileText size={25} />
          <strong>
            {t(
              locale,
              "No hay expedientes en esta vista",
              "No files in this view",
            )}
          </strong>
          <span>
            {t(
              locale,
              "Prueba otros filtros o continúa en otra etapa.",
              "Try different filters or continue in another stage.",
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function NextAction({ row: r, locale }: { row: PipelineRow; locale: Locale }) {
  return (
    <>
      <div>
        {r.nextAction || t(locale, "Definir próxima acción", "Set next action")}
      </div>
      <div className="pos-small pos-muted">
        {r.nextActionAt
          ? dateLabel(r.nextActionAt, locale, true)
          : t(locale, "Sin fecha programada", "Not scheduled")}{" "}
        · {r.waitingDays === null ? "—" : `${r.waitingDays} d`}{" "}
        {t(locale, "sin cambios", "since update")}
      </div>
    </>
  );
}
function OfferComparison({
  row,
  locale,
  open,
}: {
  row: PipelineRow;
  locale: Locale;
  open: OpenPipelineCase;
}) {
  return (
    <div className="pos-comparison">
      <p className="pos-small pos-muted">
        {t(
          locale,
          "Compara monto, plazo, costo y requisitos antes de elegir. El mayor monto no es una recomendación automática.",
          "Compare amount, term, cost and requirements before choosing. The highest amount is not an automatic recommendation.",
        )}
      </p>
      <table className="pos-table">
        <thead>
          <tr>
            {[
              "Lender",
              t(locale, "Monto / diferencia", "Amount / difference"),
              t(locale, "Plazo", "Term"),
              t(locale, "Costo / comisiones", "Cost / fees"),
              t(locale, "Frecuencia", "Frequency"),
              t(
                locale,
                "Requisitos / siguiente paso",
                "Requirements / next step",
              ),
            ].map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row.offers?.map((o) => (
            <tr key={o.id}>
              <td>
                {o.lenderName}
                {o.status === "accepted" && (
                  <span className="pos-pill pos-good">
                    {t(locale, "Seleccionada", "Selected")}
                  </span>
                )}
              </td>
              <td>
                <b>{currency(o.amount, locale)}</b>
                <div className="pos-small pos-muted">
                  {currency(o.amount - row.requestedAmount, locale)}{" "}
                  {t(locale, "vs. solicitado", "vs. requested")}
                </div>
              </td>
              <td>{o.term || "—"}</td>
              <td>
                {o.cost || "—"}
                <div className="pos-small pos-muted">{o.fees || "—"}</div>
              </td>
              <td>{o.frequency || "—"}</td>
              <td>
                {o.requirements || t(locale, "Por confirmar", "To confirm")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="pos-btn pos-primary"
        onClick={() => open(row.id, "lenders")}
      >
        <Landmark size={14} />
        {t(
          locale,
          "Revisar y elegir en el expediente",
          "Review and choose in the file",
        )}
      </button>
    </div>
  );
}

export function PipelineUpdates({
  board,
  locale,
  open,
  mode,
}: {
  board: PipelineBoard;
  locale: Locale;
  open: OpenPipelineCase;
  mode: "updates" | "recap";
}) {
  const groups = [
    "signed",
    "docsout",
    "offers",
    "need",
    "app",
    "clients",
    "files",
  ] as PipelineGroup[];
  return (
    <div className="pos-grid2">
      <section className="pos-card">
        <div className="pos-card-head">
          <h3>
            <Sparkles size={17} />
            {mode === "recap"
              ? t(locale, "Resumen de actividad", "Activity recap")
              : t(locale, "Updates del pipeline", "Pipeline updates")}
          </h3>
          <span className="pos-pill">{board.hours} h</span>
        </div>
        <p className="pos-small pos-muted">
          {t(
            locale,
            "Registros actualizados en el CRM durante esta ventana. La recepción de correo depende de la sincronización configurada; este reporte no ejecuta un barrido nuevo de Gmail.",
            "CRM records updated in this window. Email reception depends on configured synchronization; this report does not run a new Gmail scan.",
          )}
        </p>
        {groups.map((g) => {
          const items = board.updates.filter((x) => x.group === g);
          return items.length ? (
            <div className="pos-update-group" key={g}>
              <h4>
                {pipelineLabel(g, locale)}{" "}
                <span className="pos-pill">{items.length}</span>
              </h4>
              {items.map((x) => (
                <button
                  className="pos-update"
                  key={x.eventId || x.id}
                  onClick={() => open(x.id)}
                >
                  <span>
                    <b>{x.company}</b>
                    <span>
                      {x.summary ||
                        x.nextAction ||
                        t(locale, "Revisar expediente", "Review file")}
                    </span>
                    {x.sourceMessageId && (
                      <small>
                        {t(
                          locale,
                          "Correo revisado · evidencia en el expediente",
                          "Reviewed email · evidence in file",
                        )}
                      </small>
                    )}
                  </span>
                  <time>{dateLabel(x.at, locale, true)}</time>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          ) : null;
        })}
        {!board.updates.length && (
          <p className="pos-empty">
            {t(
              locale,
              "No hay registros actualizados en esta ventana.",
              "No updated records in this window.",
            )}
          </p>
        )}
        {board.updates.length === 50 && (
          <p className="pos-small pos-muted">
            {t(
              locale,
              "Se muestran hasta 50 registros recientes. Consulta Expedientes para el listado completo.",
              "Showing up to 50 recent records. Use Files for the full list.",
            )}
          </p>
        )}
      </section>
      <section className="pos-card pos-priorities">
        <h3>{t(locale, "Tus próximas 3 acciones", "Your next 3 actions")}</h3>
        <p className="pos-small pos-muted">
          {t(
            locale,
            "Contratos y tareas vencidas primero. Abre el expediente para revisar la evidencia.",
            "Contracts and overdue tasks first. Open the file to review the evidence.",
          )}
        </p>
        {board.priorities.map((r, i) => (
          <button
            className="pos-priority"
            key={r.id}
            onClick={() => open(r.id)}
          >
            <span className="pos-step">{i + 1}</span>
            <span>
              <b>{r.company}</b>
              <span>
                {r.nextAction ||
                  t(locale, "Definir próximo paso", "Set next step")}
              </span>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
        {!board.priorities.length && (
          <p className="pos-muted">
            {t(
              locale,
              "No hay acciones pendientes en este ámbito.",
              "No pending actions in this scope.",
            )}
          </p>
        )}
      </section>
    </div>
  );
}

export function PipelineStats({
  board,
  locale,
  owner,
}: {
  board: PipelineBoard;
  locale: Locale;
  owner: (id: string) => void;
}) {
  const max = Math.max(1, ...board.byRep.map((x) => x.tasks));
  return (
    <div className="pos-grid2">
      <section className="pos-card">
        <h3>{t(locale, "Pipeline por etapa", "Pipeline by stage")}</h3>
        {[...pipelineStages, "clients" as const].map((g) => (
          <div className="pos-funnel" key={g}>
            <span>{pipelineLabel(g, locale)}</span>
            <div>
              <i
                style={{
                  width: `${Math.max(1, (board.counts[g] / Math.max(1, board.counts.files)) * 100)}%`,
                }}
              />
            </div>
            <b>{board.counts[g]}</b>
          </div>
        ))}
        <p className="pos-small pos-muted">
          {t(
            locale,
            "Conteos de expedientes únicos dentro de los filtros activos.",
            "Unique business files within the active filters.",
          )}
        </p>
      </section>
      <section className="pos-card">
        <h3>
          {t(locale, "Trabajo activo por responsable", "Active work by rep")}
        </h3>
        {board.byRep.map((r) => (
          <button
            className="pos-rep-bar"
            key={r.id}
            onClick={() => owner(r.id)}
          >
            <span>{r.name}</span>
            <span className="pos-bar-track">
              <i style={{ width: `${(r.tasks / max) * 100}%` }} />
            </span>
            <b>{r.tasks}</b>
          </button>
        ))}
        {!board.byRep.length && (
          <p className="pos-muted">
            {t(locale, "Sin resultados", "No results")}
          </p>
        )}
      </section>
      <section className="pos-card pos-span2">
        <h3>{t(locale, "Resultados por responsable", "Results by rep")}</h3>
        <div className="pos-scroll">
          <table className="pos-table">
            <thead>
              <tr>
                {[
                  t(locale, "Responsable", "Rep"),
                  t(locale, "Expedientes", "Files"),
                  t(locale, "Activos", "Active"),
                  t(locale, "Ofertas vigentes", "Active offers"),
                  t(locale, "Clientes fondeados", "Funded clients"),
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.byRep.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      className="pos-text-btn"
                      onClick={() => owner(r.id)}
                    >
                      {r.name}
                    </button>
                  </td>
                  <td>{r.total}</td>
                  <td>{r.tasks}</td>
                  <td>{board.summary.offers === null ? "—" : r.offers}</td>
                  <td>{r.funded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
