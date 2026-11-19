"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { Locale, Workspace } from "@/lib/domain";
import type { EmailTemplate } from "@/lib/campaign-templates";
import { campaignLabels } from "@/lib/campaign-center";
import { sendingBlockers, campaignUsageBlocked, type ControlOverview } from "@/lib/campaign-control";
import { campaignControlRequest } from "@/lib/campaign-control-client";
import type { Action } from "../crm";
import { CampaignTemplates } from "../campaign-templates";
import { CampaignControlLeads } from "./campaign-control-leads";
import { CampaignControlDetails } from "./campaign-control-details";
import { t } from "../ui";
import "./campaign-control.css";
export function CampaignControlPanel({
  data,
  locale,
  act,
  changed,
  create,
  openConversation,
  campaignsOnly = false,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  changed: () => Promise<void>;
  create: (template?: EmailTemplate) => void;
  openConversation: (opportunity: string, conversation: string) => void;
  campaignsOnly?: boolean;
}) {
  const [overview, setOverview] = useState<ControlOverview | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [view, setView] = useState("campaigns"),
    [batch, setBatch] = useState(""),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [leadFilter, setLeadFilter] = useState("all"),
    [selected, setSelected] = useState(""),
    [revision, setRevision] = useState(0);
  const manage = ["superadmin", "seller_admin"].includes(data.profile.role),
    index = locale === "es" ? 0 : 1;
  const label = (s: string) => (campaignLabels[s] || [s, s])[index];
  const refresh = () => setRevision((n) => n + 1);
  useEffect(() => {
    setPage(0);
  }, [batch, filter, query]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (data.demo) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(
      () =>
        void campaignControlRequest<ControlOverview>(
          new URLSearchParams({
            mode: "overview",
            filter,
            search: query,
            page: String(page),
            ...(batch ? { batch } : {}),
          }).toString(),
          abort.signal,
        )
          .then((r) => {
            if (!abort.signal.aborted) {
              setOverview(r);
              setError("");
            }
          })
          .catch((e) => {
            if (!abort.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!abort.signal.aborted) setLoading(false);
          }),
      200,
    );
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [batch, filter, query, page, revision, data.demo]);
  const number = (n: number | undefined) =>
    n === undefined
      ? "—"
      : n.toLocaleString(locale === "es" ? "es-CO" : "en-US");
  const stages = [
    ["all", "Contactos totales", "Total contacts", "total"],
    ["valid", "Válidos", "Valid", "valid"],
    ["pending", "Por verificar", "To verify", "pending"],
    ["review", "Revisar Bouncer", "Review Bouncer", "review"],
    ["uncertain", "Dudosos", "Uncertain", "uncertain"],
    ["invalid", "Inválidos", "Invalid", "invalid"],
  ] as const;
  if (selected)
    return (
      <div className="cc-workspace">
        <CampaignControlDetails
          key={selected}
          id={selected}
          data={data}
          locale={locale}
          close={() => setSelected("")}
          changed={refresh}
          openConversation={openConversation}
        />
      </div>
    );
  return (
    <div className="cc-workspace" aria-busy={loading}>
      <div className="cc-toolbar">
        <div>
          <span className="cc-kicker">
            {t(
              locale,
              "DE LA BASE A LA CONVERSACIÓN",
              "FROM CONTACTS TO CONVERSATIONS",
            )}
          </span>
          <p>
            {t(
              locale,
              "Verifica, organiza y sigue cada envío desde un solo lugar.",
              "Verify, organize and track every send in one place.",
            )}
          </p>
        </div>
        <div className="pos-row">
          <button
            className="pos-btn"
            disabled={loading}
            onClick={refresh}
            aria-label={t(locale, "Actualizar campañas", "Refresh campaigns")}
          >
            <RefreshCw size={16} />
          </button>
          {manage && (
            <button className="pos-btn pos-primary" onClick={() => create()}>
              <Plus size={16} />
              {t(locale, "Crear campaña", "Create campaign")}
            </button>
          )}
        </div>
      </div>
      {data.demo && (
        <p className="pos-info">
          {t(
            locale,
            "Demostración. Las métricas y operaciones reales requieren sesión del CRM.",
            "Demo. Actual metrics and actions require a CRM session.",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="pos-alert">
          {error}
          <button className="pos-btn" onClick={refresh}>
            {t(locale, "Reintentar consulta", "Retry query")}
          </button>
        </p>
      )}
      <div className="cc-summary-groups">
        <section className="cc-summary-group cc-summary-campaigns" aria-label={t(locale, "Resumen de campañas", "Campaign summary")}>
          <h3 className="cc-summary-label">{t(locale, "Campañas", "Campaigns")}</h3>
          <div className="cc-overview-metrics cc-campaign-metrics">
            <div>
              <span>{t(locale, "Total de campañas", "Total campaigns")}</span>
              <strong>{number(overview?.summary.campaigns)}</strong>
              <small>
                {t(
                  locale,
                  `${number(overview?.summary.active)} activas · ${number(overview?.summary.scheduled)} programadas`,
                  `${number(overview?.summary.active)} active · ${number(overview?.summary.scheduled)} scheduled`,
                )}
              </small>
            </div>
          </div>
        </section>
        <section className="cc-summary-group" aria-label={t(locale, "Resumen de leads", "Lead summary")}>
          <h3 className="cc-summary-label">{t(locale, "Leads", "Leads")}</h3>
          <div className="cc-overview-metrics cc-lead-metrics">
            {[
              { key: "available", es: "Leads disponibles para envío", en: "Leads available to send", value: overview?.funnel.available, detailEs: "Listos en Preparar leads", detailEn: "Ready in Prepare leads" },
              { key: "pending", es: "Leads por enviar / programados", en: "Leads pending / scheduled", value: overview?.summary.pending, detailEs: "En campaña; esperan fecha o cupo", detailEn: "In a campaign; waiting for schedule or capacity" },
              { key: "sent", es: "Leads enviados", en: "Leads sent", value: overview?.summary.sent, detailEs: "Envío confirmado por Gmail", detailEn: "Send confirmed by Gmail" },
              { key: "replied", es: "Leads que respondieron", en: "Leads who replied", value: overview?.summary.replied, detailEs: "Respuesta confirmada a la campaña", detailEn: "Confirmed reply to the campaign" },
            ].map((metric) => (
              <div key={metric.key} className={metric.key === "available" ? "cc-metric-available" : undefined}>
                <span>{t(locale, metric.es, metric.en)}</span>
                <strong>{number(metric.value)}</strong>
                <small>{t(locale, metric.detailEs, metric.detailEn)}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
      {!campaignsOnly && <section className="cc-surface cc-funnel">
        <div className="cc-section-head">
          <div>
            <span className="cc-kicker">
              BOUNCER → {t(locale, "AUDIENCIA → ENVÍO", "AUDIENCE → SENDING")}
            </span>
            <h3>{t(locale, "Tu base de contactos", "Your contact pool")}</h3>
          </div>
          <label className="cc-batch">
            <FileSpreadsheet size={15} />
            <select
              aria-label={t(
                locale,
                "Filtrar base por archivo",
                "Filter pool by file",
              )}
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
            >
              <option value="">
                {t(locale, "Todos los archivos", "All files")}
              </option>
              {data.imports.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="cc-funnel-stages">
          {stages.map(([id, es, en, key]) => (
            <button
              key={id}
              className={`${key} ${view === "leads" && leadFilter === id ? "selected" : ""}`}
              onClick={() => {
                setLeadFilter(id);
                setView("leads");
              }}
            >
              <span>{t(locale, es, en)}</span>
              <strong>{number(overview?.funnel[key])}</strong>
              <small>
                {id === "review"
                  ? t(
                      locale,
                      "Errores o solicitudes por conciliar",
                      "Errors or requests to reconcile",
                    )
                  : t(locale, "Ver contactos →", "View contacts →")}
              </small>
            </button>
          ))}
        </div>
        <div className="cc-funnel-footer">
          <span>
            <ShieldCheck size={15} />
            {number(overview?.funnel.available)}{" "}
            {t(
              locale,
              "disponibles para primer contacto",
              "available for first contact",
            )}{" "}
            · {number(overview?.funnel.reserved)}{" "}
            {t(locale, "reservados en campañas", "reserved in campaigns")}
          </span>
          <small>
            {t(
              locale,
              "Cada contacto cuenta una vez. Ser válido no implica tener cupo de Gmail o estar libre de exclusiones.",
              "Each contact counts once. Validity does not imply Gmail capacity or freedom from exclusions.",
            )}
          </small>
        </div>
      </section>}
      <nav
        className="cc-tabs"
        aria-label={t(locale, "Vistas de campañas", "Campaign views")}
      >
        {[
          ["campaigns", "Campañas", "Campaigns"],
          ["leads", "Contactos y Bouncer", "Contacts and Bouncer"],
          ["templates", "Plantillas", "Templates"],
        ].filter(([id]) => !campaignsOnly || id !== "leads").map(([id, es, en]) => (
          <button
            key={id}
            className={view === id ? "selected" : ""}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            {t(locale, es, en)}
          </button>
        ))}
      </nav>
      {view === "campaigns" && (
        <>
          <div className="cc-section-head">
            <h3>{t(locale, "Seguimiento de campañas", "Campaign progress")}</h3>
            <div className="cc-tools">
              <input
                aria-label={t(locale, "Buscar campaña", "Search campaigns")}
                maxLength={200}
                placeholder={t(locale, "Buscar campaña…", "Search campaigns…")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label={t(locale, "Filtrar campañas", "Filter campaigns")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  "all",
                  "active",
                  "scheduled",
                  "draft",
                  "paused",
                  "completed",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s === "all"
                      ? t(locale, "Todos los estados", "All statuses")
                      : label(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {loading && !overview && (
            <p role="status">
              {t(locale, "Consultando campañas…", "Loading campaigns…")}
            </p>
          )}
          {overview && !overview.campaigns.length && (
            <section className="cc-surface cc-empty">
              <FileSpreadsheet size={30} />
              <h3>
                {t(
                  locale,
                  "Prepara tu próxima campaña",
                  "Prepare your next campaign",
                )}
              </h3>
              <p>
                {t(
                  locale,
                  "Carga un Excel o retoma un lote. Primero revisas Bouncer y la audiencia; después eliges cuándo enviar.",
                  "Upload a spreadsheet or reuse an import. Review Bouncer and your audience, then decide when to send.",
                )}
              </p>
            </section>
          )}
          <div className="cc-campaign-list">
            {overview?.campaigns.map((c) => {
              const blockers = [
                ...new Set(
                  c.senders
                    .filter((s) => s.pending > 0)
                    .flatMap((s) => s.blockers),
                ),
              ];
              if (c.used_24h >= c.daily_limit) blockers.push("group_limit");
              return (
                <article className="cc-surface cc-campaign-card" key={c.id}>
                  <div className="cc-section-head">
                    <div>
                      <h3>{c.name}</h3>
                      <p>
                        {c.senders.length} {t(locale, "remitentes", "senders")}{" "}
                        ·{" "}
                        {new Date(c.created_at).toLocaleDateString(
                          locale === "es" ? "es-CO" : "en-US",
                        )}
                      </p>
                    </div>
                    <span className={`cc-badge ${campaignUsageBlocked(c) ? "waiting" : c.status}`}>
                      {label(c.status)}
                      {campaignUsageBlocked(c) && t(locale, " · Bloqueada por sincronización de Gmail", " · Blocked by Gmail usage sync")}
                    </span>
                  </div>
                  <div className="cc-card-metrics">
                    {[
                      ["enrolled", "Destinatarios", "Recipients"],
                      ["sent", "Enviados", "Sent"],
                      ["pending", "Por enviar", "Pending"],
                      ["replied", "Respondieron", "Replied"],
                    ].map(([key, es, en]) => (
                      <span key={key}>
                        <strong>
                          {number(c.metrics[key as keyof typeof c.metrics])}
                        </strong>
                        {t(locale, es, en)}
                      </span>
                    ))}
                  </div>
                  {!!blockers.length && c.metrics.pending > 0 && (
                    <div
                      className="cc-reasons"
                      aria-label={t(
                        locale,
                        "Motivos de espera",
                        "Waiting reasons",
                      )}
                    >
                      {blockers.slice(0, 4).map((code) => (
                        <span key={code}>
                          {(sendingBlockers[code] || [code, code])[index]}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="cc-note">{t(locale,`Sin respuesta: ${c.metrics.unanswered} · Fallidos: ${c.metrics.failed} · Por conciliar: ${c.metrics.uncertain} · Excluidos o bloqueados: ${c.metrics.blocked}`,`Unanswered: ${c.metrics.unanswered} · Failed: ${c.metrics.failed} · Reconcile: ${c.metrics.uncertain} · Excluded or blocked: ${c.metrics.blocked}`)}</p>
                  <div className="cc-actions">
                    <span>
                      {c.metrics.uncertain
                        ? t(
                            locale,
                            `${c.metrics.uncertain} resultados inciertos por conciliar`,
                            `${c.metrics.uncertain} unknown results need reconciliation`,
                          )
                        : c.metrics.pending
                          ? t(
                              locale,
                              "Los pendientes conservan su remitente.",
                              "Pending contacts keep their sender.",
                            )
                          : t(
                              locale,
                              "Sin destinatarios pendientes.",
                              "No pending recipients.",
                            )}
                    </span>
                    <button
                      className="pos-btn"
                      onClick={() => setSelected(c.id)}
                    >
                      {t(
                        locale,
                        "Ver resultados y remitentes",
                        "View results and senders",
                      )}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="cc-pagination">
            <span>
              {page + 1} / {Math.max(1, Math.ceil((overview?.total || 0) / 25))}
            </span>
            <button
              className="pos-btn"
              disabled={loading || page === 0}
              onClick={() => setPage((n) => n - 1)}
            >
              {t(locale, "Anterior", "Previous")}
            </button>
            <button
              className="pos-btn"
              disabled={loading || (page + 1) * 25 >= (overview?.total || 0)}
              onClick={() => setPage((n) => n + 1)}
            >
              {t(locale, "Siguiente", "Next")}
            </button>
          </div>
        </>
      )}
      {view === "leads" && !data.demo && (
        <>
          <div className="cc-tools">
            <label className="cc-field">
              {t(locale, "Clasificación", "Classification")}
              <select
                value={leadFilter}
                onChange={(e) => setLeadFilter(e.target.value)}
              >
                {stages.map(([id, es, en]) => (
                  <option key={id} value={id}>
                    {t(locale, es, en)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <CampaignControlLeads
            batch={batch}
            filter={leadFilter}
            locale={locale}
            manage={manage && !data.demo}
            changed={refresh}
          />
        </>
      )}
      {view === "templates" && (
        <section className="cc-surface cc-templates">
          <CampaignTemplates
            data={data}
            locale={locale}
            act={act}
            changed={changed}
            useTemplate={create}
          />
        </section>
      )}
      <p className="cc-note">
        {t(
          locale,
          `${data.accounts.filter((a) => a.status === "connected").length} cuentas conectadas · ${data.accounts.filter((a) => a.status !== "connected").length} sin conexión. Solo los remitentes autorizados y de la misma marca pueden participar.`,
          `${data.accounts.filter((a) => a.status === "connected").length} connected accounts · ${data.accounts.filter((a) => a.status !== "connected").length} disconnected. Only authorized senders from the same brand can participate.`,
        )}
      </p>
    </div>
  );
}
