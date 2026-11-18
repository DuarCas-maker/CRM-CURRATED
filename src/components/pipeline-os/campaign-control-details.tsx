"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { Locale, Workspace } from "@/lib/domain";
import { accountPreparation } from "@/lib/brand-delivery";
import { campaignLabels } from "@/lib/campaign-center";
import {
  sendingBlockers,
  type ControlCampaign,
  type ControlRecipient,
  type ControlSender,
} from "@/lib/campaign-control";
import {
  campaignControlRequest,
  campaignControlAction,
} from "@/lib/campaign-control-client";
import { Modal, t } from "../ui";
import { CampaignSequence } from "./campaign-sequence";
export function SenderStatus({
  sender,
  locale,
}: {
  sender: ControlSender;
  locale: Locale;
}) {
  const l = (code: string) =>
    (sendingBlockers[code] || [code, code])[locale === "es" ? 0 : 1];
  return (
    <article className="cc-sender-card">
      <div>
        <strong>{sender.email}</strong>
        <span
          className={`cc-badge ${sender.status === 'connected' ? "good" : "waiting"}`}
        >
          {sender.status === "connected"
            ? t(locale, "Conectada", "Connected")
            : t(locale, "Sin conexión", "Disconnected")}
        </span>
      </div>
      <p>
        {t(locale, "Cupo de esta cuenta para la campaña", "This account's campaign capacity")}
        :{" "}
        <strong>
          {sender.remaining === null
            ? t(locale, "Sin lectura utilizable", "No usable reading")
            : sender.remaining}
        </strong>{" "}
        · {t(locale, "máximo del remitente", "sender limit")}{" "}
        {sender.daily_limit}/24 h
      </p>
      {sender.can_view_account && <p>
        {t(locale, "Uso total de Gmail en 24 h", "Total Gmail usage in 24h")}: {" "}
        {sender.budget.synced_at
          ? `${sender.budget.total_messages} / ${sender.budget.daily_limit}`
          : t(locale, "Sin sincronizar", "Not synchronized")}{" "}
        <span>
          ({sender.budget.external_messages}{" "}
          {t(locale, "externos al CRM", "outside CRM")})
        </span>
      </p>}
      <small>
        {String(sender.start_hour).padStart(2, "0")}:00–
        {String(sender.end_hour).padStart(2, "0")}:00 · {sender.timezone}
        {sender.scheduled_at &&
          ` · ${t(locale, "Programada", "Scheduled")}: ${new Date(sender.scheduled_at).toLocaleString(locale === "es" ? "es-CO" : "en-US")}`}
      </small>
      <div className="cc-reasons">
        {[...new Set(sender.blockers)].map((code) => (
          <span key={code}>{l(code)}</span>
        ))}
        {!sender.blockers.length && sender.pending > 0 && (
          <span>
            {t(locale, "Pendientes en la cola", "Pending in the queue")}
          </span>
        )}
      </div>
    </article>
  );
}
export function CampaignControlDetails({
  id,
  data,
  locale,
  close,
  changed,
  openConversation,
}: {
  id: string;
  data: Workspace;
  locale: Locale;
  close: () => void;
  changed: () => void;
  openConversation: (opportunity: string, conversation: string) => void;
}) {
  const [details, setDetails] = useState<{
      campaign: ControlCampaign;
      rows: ControlRecipient[];
      total: number;
    } | null>(null),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState(""),
    [actionError, setActionError] = useState(""),
    [notice, setNotice] = useState(""),
    [selection, setSelection] = useState<string[]>([]);
  const [intent, setIntent] = useState(""),
    [target, setTarget] = useState(""),
    [scheduled, setScheduled] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const manage = ["superadmin", "seller_admin"].includes(data.profile.role);
  useEffect(() => {
    setPage(0);
    setSelection([]);
  }, [id, filter, query]);
  useEffect(() => {
    setSelection([]);
  }, [page]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setRevision((n) => n + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(
      () =>
        void campaignControlRequest<{
          campaign: ControlCampaign;
          rows: ControlRecipient[];
          total: number;
        }>(
          new URLSearchParams({
            mode: "details",
            campaign: id,
            filter,
            search: query,
            page: String(page),
          }).toString(),
          abort.signal,
        )
          .then((r) => {
            if (abort.signal.aborted) return;
            setDetails(r);
            setError("");
            setSelection((ids) => {
              const next = ids.filter((x) =>
                r.rows.some((row) => row.contact_id === x && row.manageable),
              );
              return next.length === ids.length ? ids : next;
            });
            if (page > 0 && page * 50 >= r.total)
              setPage(Math.max(0, Math.ceil(r.total / 50) - 1));
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
  }, [id, filter, query, page, revision]);
  useEffect(() => {
    setIntent("");
    setConfirmed(false);
  }, [selection]);
  const campaign = details?.campaign;
  const selectable =
    details?.rows.filter((r) => r.manageable).map((r) => r.contact_id) || [];
  const prepared = campaign?.senders.map((s) => ({
    account_id: s.account_id,
    brand_preparation: accountPreparation(
      data.accounts.find((a) => a.id === s.account_id),
    ),
  }));
  const ready = prepared?.every(
    (s) =>
      s.brand_preparation &&
      data.accounts.find((a) => a.id === s.account_id)?.brand_context
        ?.can_campaign,
  );
  const label = (s: string) =>
    (campaignLabels[s] || [s, s])[locale === "es" ? 0 : 1];
  function review(kind: string) {
    setIntent(kind);
    setActionError("");
    setConfirmed(false);
    setScheduled("");
    setTarget(
      campaign?.senders.find((s) => s.status === "connected")?.account_id || "",
    );
  }
  async function submit() {
    if (!campaign || busy || !confirmed) return;
    setBusy(true);
    setActionError("");
    try {
      let payload: Record<string, unknown> = { id };
      if (intent === "activate" || intent === "schedule")
        payload = {
          ...payload,
          senders: prepared,
          ...(intent === "schedule"
            ? { scheduled_at: new Date(scheduled).toISOString() }
            : {}),
        };
      if (intent === "reassign" || intent === "exclude")
        payload = {
          ...payload,
          contact_ids: [...selection].sort(),
          expected_count: selection.length,
          ...(intent === "reassign"
            ? {
                target_account_id: target,
                target_preparation: accountPreparation(
                  data.accounts.find((a) => a.id === target),
                ),
              }
            : {}),
        };
      await campaignControlAction(intent, payload, keys.current);
      setIntent("");
      setSelection([]);
      setNotice(
        t(
          locale,
          "Operación confirmada. Los datos se están actualizando.",
          "Operation confirmed. Refreshing data.",
        ),
      );
      setRevision((n) => n + 1);
      changed();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cc-details">
      <div className="cc-section-head">
        <button className="pos-btn" onClick={close}>
          <ArrowLeft size={15} />
          {t(locale, "Volver a campañas", "Back to campaigns")}
        </button>
        <button
          className="pos-btn"
          disabled={loading}
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={14} />
          {t(locale, "Actualizar", "Refresh")}
        </button>
      </div>
      {error && (
        <p role="alert" className="pos-alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="pos-notice">
          {notice}
        </p>
      )}
      {!campaign ? (
        <p role="status">
          {t(locale, "Consultando resultados…", "Loading results…")}
        </p>
      ) : (
        <>
          <CampaignSequence id={id} locale={locale} revision={revision}/>
          <section className="cc-surface">
            <div className="cc-section-head">
              <div>
                <span className="cc-kicker">
                  {t(locale, "RESULTADOS DE CAMPAÑA", "CAMPAIGN RESULTS")}
                </span>
                <h2>{campaign.name}</h2>
              </div>
              <span className={`cc-badge ${campaign.status}`}>
                {label(campaign.status)}
              </span>
            </div>
            <div className="cc-detail-metrics">
              {[
                ["enrolled", "Destinatarios", "Recipients"],
                ["sent", "Enviados", "Sent"],
                ["pending", "Por enviar", "Pending"],
                ["replied", "Respondieron", "Replied"],
              ].map(([key, es, en]) => (
                <div key={key}>
                  <strong>
                    {campaign.metrics[key as keyof typeof campaign.metrics]}
                  </strong>
                  <span>{t(locale, es, en)}</span>
                </div>
              ))}
            </div>
            <p className="cc-note">
              {t(
                locale,
                `Límite total: ${campaign.daily_limit}/24 h · ${campaign.used_24h} envíos o reservas en 24 h. Solo cuenta como enviado cuando Gmail lo confirma.`,
                `Total limit: ${campaign.daily_limit}/24h · ${campaign.used_24h} sends or reservations in 24h. Sent means Gmail confirmed acceptance.`,
              )}
            </p>
            <p className="cc-note">{t(locale,`Sin respuesta: ${campaign.metrics.unanswered} · Fallidos: ${campaign.metrics.failed} · Excluidos o bloqueados: ${campaign.metrics.blocked}`,`Unanswered: ${campaign.metrics.unanswered} · Failed: ${campaign.metrics.failed} · Excluded or blocked: ${campaign.metrics.blocked}`)}</p>
            {campaign.used_24h >= campaign.daily_limit && (
              <p className="cc-callout">
                {t(
                  locale,
                  "La campaña alcanzó su máximo total de 24 h. Esperará a que se libere cupo.",
                  "The campaign reached its total 24h limit and will wait for capacity.",
                )}
              </p>
            )}
            {!!campaign.metrics.uncertain && (
              <p className="cc-callout">
                {t(
                  locale,
                  "Hay envíos con resultado incierto. Requieren conciliación antes de repetirlos o moverlos.",
                  "Some sends have unknown outcomes. Reconcile them before retrying or moving them.",
                )}
              </p>
            )}
            {manage && (
              <div className="cc-actions">
                {campaign.status === "active" ||
                campaign.status === "scheduled" ? (
                  <button className="pos-btn" onClick={() => review("pause")}>
                    {t(locale, "Pausar campaña", "Pause campaign")}
                  </button>
                ) : (
                  campaign.status !== "completed" && (
                    <>
                      <button
                        className="pos-btn"
                        disabled={!ready}
                        onClick={() => review("schedule")}
                      >
                        {t(locale, "Programar", "Schedule")}
                      </button>
                      <button
                        className="pos-btn pos-primary"
                        disabled={!ready}
                        onClick={() => review("activate")}
                      >
                        {t(locale, "Revisar y activar", "Review and activate")}
                      </button>
                    </>
                  )
                )}
                {!ready && (
                  <span>
                    {t(
                      locale,
                      "Revisa la conexión y los permisos de los remitentes en Configuración del CRM.",
                      "Review sender connections and permissions in CRM Settings.",
                    )}
                  </span>
                )}
              </div>
            )}
          </section>
          <div className="cc-senders-grid">
            {campaign.senders.map((s) => (
              <SenderStatus key={s.account_id} sender={s} locale={locale} />
            ))}
          </div>
          <section className="cc-surface">
            <div className="cc-section-head">
              <div>
                <h3>
                  {t(
                    locale,
                    "Destinatarios y resultados",
                    "Recipients and results",
                  )}
                </h3>
                <p>
                  {t(
                    locale,
                    "Consulta quién recibió, quién respondió y por qué otros esperan.",
                    "See who received, who replied and why others wait.",
                  )}
                </p>
              </div>
              <div className="cc-tools">
                <input
                  aria-label={t(
                    locale,
                    "Buscar destinatario",
                    "Search recipients",
                  )}
                  maxLength={200}
                  placeholder={t(
                    locale,
                    "Buscar contacto…",
                    "Search contacts…",
                  )}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label={t(locale, "Filtrar resultados", "Filter results")}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {[
                    ["all", "Todos", "All"],
                    ["pending", "Por enviar", "Pending"],
                    ["sent", "Enviados", "Sent"],
                    ["replied", "Respondieron", "Replied"],
                    ["unanswered", "Sin respuesta", "Unanswered"],
                    ["errors", "Errores o bloqueos", "Errors or blocks"],
                  ].map(([key, es, en]) => (
                    <option key={key} value={key}>
                      {t(locale, es, en)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {manage && (
              <label className="cc-check">
                <input
                  type="checkbox"
                  checked={
                    !!selectable.length &&
                    selection.length === selectable.length
                  }
                  disabled={loading || !selectable.length}
                  onChange={(e) =>
                    setSelection(e.target.checked ? selectable : [])
                  }
                />
                {t(
                  locale,
                  "Seleccionar pendientes de esta página",
                  "Select pending contacts on this page",
                )}
              </label>
            )}
            {loading && (
              <p role="status">
                {t(locale, "Actualizando resultados…", "Refreshing results…")}
              </p>
            )}
            {!loading && !details?.rows.length && (
              <p className="cc-empty">
                {t(
                  locale,
                  "No hay destinatarios con estos filtros.",
                  "No recipients match these filters.",
                )}
              </p>
            )}
            <div className="cc-contact-list">
              {details?.rows.map((r) => (
                <div className="cc-recipient-row" key={r.contact_id}>
                  {manage && (
                    <input
                      type="checkbox"
                      checked={selection.includes(r.contact_id)}
                      disabled={loading || !r.manageable}
                      aria-label={t(
                        locale,
                        `Seleccionar ${r.email}`,
                        `Select ${r.email}`,
                      )}
                      onChange={(e) =>
                        setSelection((ids) =>
                          e.target.checked
                            ? [...ids, r.contact_id]
                            : ids.filter((id) => id !== r.contact_id),
                        )
                      }
                    />
                  )}
                  <span>
                    <strong>{r.company || r.name}</strong>
                    <span>
                      {r.name} · {r.email}
                    </span>
                    <small>
                      {
                        campaign.senders.find(
                          (s) => s.account_id === r.account_id,
                        )?.email
                      }
                    </small>
                  </span>
                  <span>
                    <span
                      className={`cc-badge ${r.send_status === "sent" ? "good" : "waiting"}`}
                    >
                      {label(r.send_status)}
                    </span>
                    <small>
                      {r.sent_at
                        ? new Date(r.sent_at).toLocaleString(
                            locale === "es" ? "es-CO" : "en-US",
                          )
                        : t(
                            locale,
                            "Sin envío confirmado",
                            "No confirmed send",
                          )}
                    </small>
                    {r.reply_at && (
                      <small>
                        {t(locale, "Respuesta", "Reply")}:{" "}
                        {new Date(r.reply_at).toLocaleString(
                          locale === "es" ? "es-CO" : "en-US",
                        )}
                      </small>
                    )}
                  </span>
                  {r.conversation_id && r.opportunity_id && (
                    <button
                      className="pos-btn"
                      onClick={() =>
                        openConversation(r.opportunity_id!, r.conversation_id!)
                      }
                    >
                      {t(locale, "Conversación", "Conversation")}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="cc-pagination">
              <span>
                {page + 1} /{" "}
                {Math.max(1, Math.ceil((details?.total || 0) / 50))}
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
                disabled={loading || (page + 1) * 50 >= (details?.total || 0)}
                onClick={() => setPage((n) => n + 1)}
              >
                {t(locale, "Siguiente", "Next")}
              </button>
            </div>
            {manage && (
              <div className="cc-actions">
                <span>
                  {selection.length} {t(locale, "seleccionados", "selected")}
                </span>
                <button
                  className="pos-btn"
                  disabled={
                    !selection.length || loading || campaign.senders.length < 2
                  }
                  onClick={() => review("reassign")}
                >
                  {t(locale, "Reasignar remitente", "Reassign sender")}
                </button>
                <button
                  className="pos-btn"
                  disabled={!selection.length || loading}
                  onClick={() => review("exclude")}
                >
                  {t(
                    locale,
                    "Excluir de esta campaña",
                    "Exclude from this campaign",
                  )}
                </button>
              </div>
            )}
          </section>
        </>
      )}
      {intent && campaign && (
        <div className="cc-modal-host">
          <Modal
            locale={locale}
            dirty={false}
            busy={busy}
            close={() => setIntent("")}
            title={t(
              locale,
              "Revisar operación de campaña",
              "Review campaign action",
            )}
          >
            {actionError && (
              <p role="alert" className="pos-alert">
                {actionError}
              </p>
            )}
            <p>
              {intent === "pause"
                ? t(
                    locale,
                    "Se pausarán todos los remitentes. Un envío ya admitido puede terminar su despacho.",
                    "All senders will pause. A send already admitted may finish dispatching.",
                  )
                : intent === "exclude"
                  ? t(
                      locale,
                      `Se excluirán ${selection.length} contactos pendientes de esta campaña. Se conserva su historial.`,
                      `${selection.length} pending contacts will be excluded from this campaign. History is preserved.`,
                    )
                  : intent === "reassign"
                    ? t(
                        locale,
                        `Se moverán ${selection.length} contactos pendientes a la cuenta elegida. Si la campaña está activa, podrán enviarse según el horario y cupo de esa cuenta.`,
                        `${selection.length} pending contacts will move to the selected account. If the campaign is active, they may send subject to its schedule and capacity.`,
                      )
                    : t(
                        locale,
                        `Autorizarás el envío real a ${campaign.metrics.pending} destinatarios pendientes, con ${campaign.senders.length} remitentes y máximo ${campaign.daily_limit}/24h. Los límites y horarios se mantienen.`,
                        `You will authorize real sending to ${campaign.metrics.pending} pending recipients with ${campaign.senders.length} senders and a total limit of ${campaign.daily_limit}/24h. Limits and sending hours remain enforced.`,
                      )}
            </p>
            {intent === "schedule" && (
              <label className="cc-field">
                {t(locale, "Fecha y hora local", "Local date and time")}
                <input
                  type="datetime-local"
                  value={scheduled}
                  onChange={(e) => {
                    setScheduled(e.target.value);
                    setConfirmed(false);
                  }}
                />
                <small>
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </small>
              </label>
            )}
            {intent === "reassign" && (
              <label className="cc-field">
                {t(locale, "Cuenta destino", "Target account")}
                <select
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  {campaign.senders.map((s) => (
                    <option
                      key={s.account_id}
                      value={s.account_id}
                      disabled={s.status !== "connected"}
                    >
                      {s.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="cc-check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {t(
                locale,
                "Revisé el alcance y confirmo esta operación.",
                "I reviewed the scope and confirm this action.",
              )}
            </label>
            <div className="pos-row">
              <button
                className="pos-btn pos-primary"
                disabled={
                  busy ||
                  !confirmed ||
                  (intent === "schedule" && !scheduled) ||
                  (intent === "reassign" && !target)
                }
                onClick={() => void submit()}
              >
                {busy
                  ? t(locale, "Procesando…", "Processing…")
                  : t(locale, "Confirmar operación", "Confirm action")}
              </button>
              <button
                className="pos-btn"
                disabled={busy}
                onClick={() => setIntent("")}
              >
                {t(locale, "Cancelar", "Cancel")}
              </button>
            </div>
          </Modal>
        </div>
      )}
    </section>
  );
}
