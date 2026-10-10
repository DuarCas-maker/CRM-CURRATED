"use client";
import { useEffect, useState } from "react";
import type { Workspace, Locale } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import type { MailSnapshot } from "@/lib/gmail-history";
import { Modal, t } from "./ui";

export interface HistoryCandidate {
  imported_at: string | null;
  id: string;
  email: string;
  name: string;
  company_name: string;
  phone: string;
  classification: "unknown" | "active" | "inactive";
  participant_kind: "unknown" | "client" | "lender" | "broker" | "other";
  selected: boolean;
  copied_only: boolean;
  message_count: number;
  inbound_count: number;
  outbound_count: number;
  campaign_count: number;
  attachment_count: number;
  copy_count: number;
  first_at: string;
  last_at: string;
  existing_contact_id: string | null;
  candidate_opportunity_ids: string[];
  evidence_ids: string[];
  selected_company_id: string | null;
  selected_opportunity_id: string | null;
  selected_process_id: string | null;
  submission_id: string | null;
  last_error: string | null;
}
interface HistoryRun {
  id: string;
  account_id: string;
  purpose: string;
  status: string;
  phase: string;
  scanned: number;
  estimated_messages: number;
  skipped: number;
  imported: number;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
}
interface HistoryData {
  accounts: {
    id: string;
    email: string;
    owner_id: string | null;
    status: string;
    sync_enabled: boolean;
  }[];
  runs: HistoryRun[];
  candidates?: HistoryCandidate[];
  total?: number;
  stats?: {
    messages: number;
    first_at: string;
    last_at: string;
    documents: number;
    documents_to_copy: number;
    candidates: number;
    selected: number;
    matches: number;
    ambiguous: number;
    months: {
      month_label: string;
      messages: number;
      direct_participants: number;
    }[];
  };
}
interface Matches {
  cases: { id: string; company: string; stage: string; company_id: string }[];
  companies: { id: string; name: string }[];
  processes: {
    id: string;
    opportunity_id: string;
    label: string;
    sequence_number: number;
  }[];
  submissions: {
    id: string;
    opportunity_id: string;
    lender_id: string;
    process_id: string | null;
  }[];
}
export function MailEvidence({
  id,
  locale,
  close,
}: {
  id: string;
  locale: Locale;
  close: () => void;
}) {
  const [message, setMessage] = useState<MailSnapshot | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/gmail/archive/${id}`, { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        setMessage(body);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [id]);
  return (
    <Modal
      title={message?.subject || t(locale, "Correo de origen", "Source email")}
      close={close}
    >
      {error && <div className="error-banner">{error}</div>}
      {message && (
        <>
          <p>
            {dateLabel(message.sent_at, locale, true)} · {message.nature} ·{" "}
            {message.direction}
          </p>
          {message.participants.map((p, i) => (
            <p key={i}>
              <strong>{p.role}:</strong> {p.name} {p.email}
            </p>
          ))}
          <pre className="mail-evidence-body">{message.body}</pre>
          {message.attachments.map((a) => (
            <p key={a.part_id}>
              {a.name} · {Math.round(a.size / 1024)} KB
            </p>
          ))}
        </>
      )}
    </Modal>
  );
}

export function GmailHistory({
  workspace,
  locale,
}: {
  workspace: Workspace;
  locale: Locale;
}) {
  const [data, setData] = useState<HistoryData>({ accounts: [], runs: [] });
  const [runId, setRunId] = useState(""),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [editing, setEditing] = useState<HistoryCandidate | null>(null),
    [source, setSource] = useState<string | null>(null);
  const [evidenceLimit, setEvidenceLimit] = useState(20);
  useEffect(() => {
    setEvidenceLimit(20);
  }, [editing?.id]);
  const [matches, setMatches] = useState<Matches>({
    cases: [],
    companies: [],
    processes: [],
    submissions: [],
  });
  const [search, setSearch] = useState("");
  const [organizations, setOrganizations] = useState<
    { id: string; domain: string }[]
  >([]);
  async function load() {
    const r = await fetch(
      `/api/gmail/history?${new URLSearchParams({ ...(runId ? { run: runId } : {}), page: String(page) })}`,
    );
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    setData(body);
  }
  useEffect(() => {
    if (workspace.demo) return;
    let mounted = true;
    const refresh = () =>
      load().catch((e) => {
        if (mounted) setError(e.message);
      });
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
    // Each change of run/page must replace the polling closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, page, workspace.demo]);
  useEffect(() => {
    if (workspace.demo) return;
    fetch("/api/gmail/config")
      .then((r) => r.json())
      .then((body) => setOrganizations(body.organizations || []))
      .catch(() => {});
  }, [workspace.demo]);
  const run = data.runs.find((r) => r.id === runId),
    stats = data.stats;
  async function action(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/gmail/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      if (body.id) {
        setRunId(body.id);
        setPage(0);
      }
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function findMatches(candidate: HistoryCandidate, query?: string) {
    try {
      const r = await fetch(
        `/api/gmail/history?${new URLSearchParams({ candidate: candidate.id, ...(query !== undefined ? { search: query } : {}) })}`,
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setMatches(body);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function selectPayload(c: HistoryCandidate, selected: boolean) {
    return {
      operation: "select",
      run_id: runId,
      candidate_id: c.id,
      selected,
      name: c.name,
      company_name: c.company_name,
      phone: c.phone,
      classification: c.classification,
      participant_kind: c.participant_kind,
      selected_company_id: c.selected_company_id,
      selected_opportunity_id: c.selected_opportunity_id,
      selected_process_id: c.selected_process_id,
      submission_id: c.submission_id,
    };
  }
  return (
    <section className="panel settings-panel gmail-history-panel">
      <h2>
        {t(locale, "Importación histórica de Gmail", "Historical Gmail import")}
      </h2>
      <p>
        {t(
          locale,
          "Autorizar una cuenta permite analizar hasta un año. La incorporación comercial requiere revisión y confirmación; no envía correos ni ejecuta Bouncer.",
          "Account authorization allows analysis of up to one year. Commercial import requires review and confirmation; it does not send emails or run Bouncer.",
        )}
      </p>
      {workspace.demo ? (
        <p className="muted">
          {t(
            locale,
            "Conecta una cuenta real desde la aplicación autenticada. Esta vista no realiza llamadas externas.",
            "Connect a real account from the authenticated app. This demo makes no external calls.",
          )}
        </p>
      ) : (
        <>
          {error && <div className="error-banner">{error}</div>}
          <form
            action="/api/gmail/connect"
            method="get"
            className="gmail-connect-form"
          >
            <label>
              {t(
                locale,
                "Organización de Google Workspace",
                "Google Workspace organization",
              )}
              <select
                name="organization"
                required
                disabled={!organizations.length}
              >
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.domain} ({o.id})
                  </option>
                ))}
              </select>
            </label>
            <button className="button" disabled={!organizations.length}>
              {t(locale, "Autorizar con Google", "Authorize with Google")}
            </button>
          </form>
          {!organizations.length && (
            <p className="muted">
              {t(
                locale,
                "Falta configurar GOOGLE_OAUTH_ORGANIZATIONS en la web y el trabajador.",
                "Configure GOOGLE_OAUTH_ORGANIZATIONS on the web and worker.",
              )}
            </p>
          )}
          {data.accounts.map((a) => (
            <div className="gmail-account-card" key={a.id}>
              <div>
                <strong>{a.email}</strong>
                <small>
                  {a.status} ·{" "}
                  {a.sync_enabled
                    ? t(locale, "Sincronización habilitada", "Sync enabled")
                    : t(
                        locale,
                        "Pendiente de importación confirmada",
                        "Awaiting confirmed import",
                      )}
                </small>
              </div>
              <label>
                {t(locale, "Responsable de esta cuenta", "Mailbox owner")}
                <select
                  value={a.owner_id || ""}
                  disabled={busy}
                  onChange={(e) =>
                    action({
                      operation: "owner",
                      account_id: a.id,
                      owner_id: e.target.value,
                    })
                  }
                >
                  <option value="">
                    {t(locale, "Asignar responsable", "Assign owner")}
                  </option>
                  {workspace.profiles
                    .filter(
                      (p) =>
                        p.active &&
                        ["superadmin", "seller_admin", "seller"].includes(
                          p.role,
                        ),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button"
                disabled={
                  busy ||
                  a.status !== "connected" ||
                  data.runs.some(
                    (r) =>
                      r.account_id === a.id &&
                      ["analyzing", "importing", "paused"].includes(r.status),
                  )
                }
                onClick={() =>
                  action({
                    operation: "start",
                    account_id: a.id,
                    request_key: crypto.randomUUID(),
                  })
                }
              >
                {t(locale, "Analizar un año", "Analyze one year")}
              </button>
              <button
                className="button"
                disabled={busy || a.status !== "connected"}
                onClick={() => {
                  if (
                    confirm(
                      t(
                        locale,
                        "Desconectar la cuenta conservará el historial y los documentos copiados. ¿Continuar?",
                        "Disconnecting preserves the archive and copied files. Continue?",
                      ),
                    )
                  )
                    action({ operation: "disconnect", account_id: a.id });
                }}
              >
                {t(locale, "Desconectar", "Disconnect")}
              </button>
            </div>
          ))}
          <label>
            {t(locale, "Análisis e importaciones", "Analyses and imports")}
            <select
              value={runId}
              onChange={(e) => {
                setRunId(e.target.value);
                setPage(0);
              }}
            >
              <option value="">
                {t(locale, "Seleccionar análisis", "Select analysis")}
              </option>
              {data.runs
                .filter(
                  (r) => r.purpose === "historical" || r.status === "review",
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {data.accounts.find((a) => a.id === r.account_id)?.email} ·{" "}
                    {r.purpose === "continuous"
                      ? t(locale, "Mensajes nuevos", "New messages")
                      : t(locale, "Histórico", "History")}{" "}
                    · {dateLabel(r.created_at, locale, true)} · {r.status}
                  </option>
                ))}
            </select>
          </label>
          {run && (
            <>
              <div className="gmail-run-progress" aria-live="polite">
                <strong>{run.status}</strong> · {run.scanned}{" "}
                {t(locale, "mensajes guardados", "messages saved")} ·{" "}
                {run.imported}{" "}
                {t(
                  locale,
                  "participantes incorporados",
                  "participants imported",
                )}
                <p>
                  {t(
                    locale,
                    "La cantidad inicial de Gmail es estimada. El tiempo depende del volumen, los adjuntos y los límites de Google.",
                    "Gmail's initial count is an estimate. Duration depends on volume, attachments and Google's limits.",
                  )}
                </p>
                {run.last_error && (
                  <p className="error-banner">{run.last_error}</p>
                )}
              </div>
              <div className="card-actions">
                {["analyzing", "importing"].includes(run.status) && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      action({ operation: "pause", run_id: run.id })
                    }
                  >
                    {t(locale, "Pausar", "Pause")}
                  </button>
                )}
                {["paused", "failed"].includes(run.status) && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      action({ operation: "resume", run_id: run.id })
                    }
                  >
                    {t(locale, "Reanudar", "Resume")}
                  </button>
                )}
                {run.status === "review" && (
                  <button
                    className="button primary"
                    disabled={busy || !stats?.selected}
                    onClick={() => {
                      if (
                        confirm(
                          t(
                            locale,
                            "¿Incorporar únicamente los candidatos seleccionados? Los demás quedarán fuera del flujo comercial.",
                            "Import only selected candidates? Others stay outside the commercial workflow.",
                          ),
                        )
                      )
                        action({ operation: "confirm", run_id: run.id });
                    }}
                  >
                    {t(locale, "Confirmar importación", "Confirm import")} (
                    {stats?.selected || 0})
                  </button>
                )}
                {["completed", "paused", "failed"].includes(run.status) &&
                  !!run.imported && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            t(
                              locale,
                              "Se retirarán del flujo solo expedientes creados por esta importación sin trabajo posterior. Se conservarán los correos, archivos y expedientes modificados. ¿Continuar?",
                              "Only untouched cases created by this import will leave the workflow. Emails, files and modified cases remain. Continue?",
                            ),
                          )
                        )
                          action({ operation: "undo", run_id: run.id });
                      }}
                    >
                      {t(locale, "Deshacer incorporación", "Undo import")}
                    </button>
                  )}
              </div>
              {stats && (
                <>
                  <p>
                    {stats.messages} {t(locale, "mensajes", "messages")} ·{" "}
                    {stats.candidates}{" "}
                    {t(
                      locale,
                      "participantes candidatos",
                      "candidate participants",
                    )}{" "}
                    · {stats.matches}{" "}
                    {t(locale, "coincidencias por correo", "email matches")} ·{" "}
                    {stats.ambiguous}{" "}
                    {t(
                      locale,
                      "asociaciones por revisar",
                      "associations to review",
                    )}
                  </p>
                  <p>
                    {stats.first_at && dateLabel(stats.first_at, locale)} —{" "}
                    {stats.last_at && dateLabel(stats.last_at, locale)} ·{" "}
                    {stats.documents}{" "}
                    {t(locale, "adjuntos encontrados", "attachments found")} ·{" "}
                    {stats.documents_to_copy}{" "}
                    {t(
                      locale,
                      "recientes que se copiarían si se importan sus expedientes",
                      "recent files to copy if their cases are imported",
                    )}
                  </p>
                  <details>
                    <summary>
                      {t(
                        locale,
                        "Participantes identificados por mes",
                        "Participants by month",
                      )}
                    </summary>
                    {stats.months.map((m) => (
                      <p key={m.month_label}>
                        {m.month_label}: {m.direct_participants}{" "}
                        {t(
                          locale,
                          "participantes directos",
                          "direct participants",
                        )}{" "}
                        · {m.messages} {t(locale, "mensajes", "messages")}
                      </p>
                    ))}
                  </details>
                </>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t(locale, "Incorporar", "Import")}</th>
                      <th>
                        {t(locale, "Contacto / empresa", "Contact / company")}
                      </th>
                      <th>{t(locale, "Evidencia", "Evidence")}</th>
                      <th>{t(locale, "Clasificación", "Classification")}</th>
                      <th>{t(locale, "Revisión", "Review")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.candidates || []).map((c) => (
                      <tr key={c.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${t(locale, "Seleccionar", "Select")} ${c.email}`}
                            checked={c.selected}
                            disabled={
                              busy ||
                              !!c.imported_at ||
                              !["review", "failed"].includes(run.status)
                            }
                            onChange={() => {
                              if (c.selected) action(selectPayload(c, false));
                              else {
                                setEditing(c);
                                setSearch(c.company_name || c.name);
                                findMatches(c);
                              }
                            }}
                          />
                        </td>
                        <td>
                          <strong>{c.name || c.email}</strong>
                          <small>{c.email}</small>
                          <small>
                            {c.company_name ||
                              t(
                                locale,
                                "Empresa pendiente de confirmar",
                                "Confirm company",
                              )}
                          </small>
                        </td>
                        <td>
                          {c.inbound_count} {t(locale, "recibidos", "received")}{" "}
                          / {c.outbound_count} {t(locale, "enviados", "sent")}
                          <small>
                            {c.campaign_count}{" "}
                            {t(
                              locale,
                              "con señales de campaña",
                              "with campaign signals",
                            )}{" "}
                            · {c.attachment_count}{" "}
                            {t(locale, "adjuntos", "attachments")}
                          </small>
                          <button
                            className="text-button"
                            onClick={() => setSource(c.evidence_ids[0])}
                          >
                            {t(locale, "Abrir correo", "Open email")}
                          </button>
                        </td>
                        <td>
                          {c.participant_kind} · {c.classification}
                          <small>
                            {c.copied_only
                              ? t(locale, "Solo en copia", "Copied only")
                              : t(
                                  locale,
                                  "Comunicación directa",
                                  "Direct communication",
                                )}
                          </small>
                        </td>
                        <td>
                          <small>
                            {c.existing_contact_id
                              ? t(
                                  locale,
                                  "Contacto existente; no se sobrescribirán sus datos",
                                  "Existing contact; current data stays unchanged",
                                )
                              : t(locale, "Contacto nuevo", "New contact")}
                          </small>
                          {c.last_error && (
                            <small className="error-banner">
                              {c.last_error}
                            </small>
                          )}
                          <button
                            className="button"
                            disabled={
                              busy ||
                              !!c.imported_at ||
                              !["review", "failed"].includes(run.status)
                            }
                            onClick={() => {
                              setEditing(c);
                              setSearch(c.company_name || c.name);
                              findMatches(c);
                            }}
                          >
                            {t(locale, "Revisar", "Review")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-actions">
                <button
                  className="button"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  {t(locale, "Anterior", "Previous")}
                </button>
                <span>
                  {page + 1} / {Math.max(1, Math.ceil((data.total || 0) / 50))}
                </span>
                <button
                  className="button"
                  disabled={(page + 1) * 50 >= (data.total || 0)}
                  onClick={() => setPage(page + 1)}
                >
                  {t(locale, "Siguiente", "Next")}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {editing && (
        <Modal
          title={t(
            locale,
            "Confirmar participante y expediente",
            "Confirm participant and case",
          )}
          close={() => setEditing(null)}
        >
          <p>
            {editing.email} ·{" "}
            {t(
              locale,
              "Las coincidencias de nombres son propuestas; tú confirmas la asociación.",
              "Name matches are suggestions; you confirm the association.",
            )}
          </p>
          {error && <div className="error-banner">{error}</div>}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await action(selectPayload(editing, true))) setEditing(null);
            }}
          >
            <label>
              {t(locale, "Nombre", "Name")}
              <input
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              {t(locale, "Empresa confirmada", "Confirmed company")}
              <input
                value={editing.company_name}
                onChange={(e) =>
                  setEditing({ ...editing, company_name: e.target.value })
                }
              />
            </label>
            <label>
              {t(locale, "Teléfono", "Phone")}
              <input
                value={editing.phone}
                onChange={(e) =>
                  setEditing({ ...editing, phone: e.target.value })
                }
              />
            </label>
            <label>
              {t(locale, "Participante", "Participant")}
              <select
                value={editing.participant_kind}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    participant_kind: e.target
                      .value as HistoryCandidate["participant_kind"],
                  })
                }
              >
                <option value="unknown">
                  {t(locale, "Pendiente", "Pending")}
                </option>
                <option value="client">
                  {t(
                    locale,
                    "Cliente / prospecto histórico",
                    "Historical customer / prospect",
                  )}
                </option>
                <option value="lender">Lender</option>
                <option value="broker">Broker</option>
                <option value="other">{t(locale, "Otro", "Other")}</option>
              </select>
            </label>
            <label>
              {t(locale, "Actividad del expediente", "Case activity")}
              <select
                value={editing.classification}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    classification: e.target
                      .value as HistoryCandidate["classification"],
                  })
                }
              >
                <option value="unknown">
                  {t(locale, "Pendiente de clasificar", "Unclassified")}
                </option>
                <option value="active">{t(locale, "Activo", "Active")}</option>
                <option value="inactive">
                  {t(locale, "Inactivo", "Inactive")}
                </option>
              </select>
            </label>
            <div className="gmail-connect-form">
              <input
                aria-label={t(locale, "Buscar expediente", "Search cases")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                type="button"
                className="button"
                onClick={() => findMatches(editing, search)}
              >
                {t(locale, "Buscar coincidencias", "Find matches")}
              </button>
            </div>
            <label>
              {t(locale, "Expediente existente", "Existing case")}
              <select
                value={editing.selected_opportunity_id || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    selected_opportunity_id: e.target.value || null,
                    selected_process_id: null,
                    submission_id: null,
                  })
                }
              >
                <option value="">
                  {t(
                    locale,
                    "Crear expediente principal o usar el de la empresa elegida",
                    "Create principal case or use selected company's case",
                  )}
                </option>
                {matches.cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company} · {c.stage} · {c.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            {!editing.selected_opportunity_id && (
              <label>
                {t(locale, "Empresa existente", "Existing company")}
                <select
                  value={editing.selected_company_id || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      selected_company_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">
                    {t(
                      locale,
                      "Empresa del contacto existente o crear una nueva",
                      "Contact's existing company or create a new one",
                    )}
                  </option>
                  {matches.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {t(locale, "Proceso de financiación", "Financing process")}
              <select
                value={editing.selected_process_id || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    selected_process_id: e.target.value || null,
                  })
                }
              >
                <option value="">
                  {t(
                    locale,
                    "Historial pendiente de separar en procesos",
                    "History awaiting process classification",
                  )}
                </option>
                {matches.processes
                  .filter(
                    (p) => p.opportunity_id === editing.selected_opportunity_id,
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sequence_number} · {p.label}
                    </option>
                  ))}
              </select>
            </label>
            {editing.participant_kind === "lender" && (
              <label>
                Lender submission
                <select
                  required
                  value={editing.submission_id || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      submission_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">
                    {t(
                      locale,
                      "Elegir evaluación del lender",
                      "Select lender evaluation",
                    )}
                  </option>
                  {matches.submissions
                    .filter(
                      (s) =>
                        s.opportunity_id === editing.selected_opportunity_id,
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {workspace.lenders.find((l) => l.id === s.lender_id)
                          ?.name || s.lender_id}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <details>
              <summary>
                {t(
                  locale,
                  "Correos que respaldan este candidato",
                  "Candidate evidence emails",
                )}
              </summary>
              {editing.evidence_ids.slice(0, evidenceLimit).map((id, i) => (
                <button
                  key={id}
                  type="button"
                  className="text-button"
                  onClick={() => setSource(id)}
                >
                  {t(locale, "Correo", "Email")} {i + 1}
                </button>
              ))}
              {editing.evidence_ids.length > evidenceLimit && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setEvidenceLimit(evidenceLimit + 20)}
                >
                  {t(locale, "Ver más correos", "Show more emails")}
                </button>
              )}
            </details>
            <div className="modal-footer">
              <button
                className="button primary"
                disabled={
                  busy ||
                  editing.classification === "unknown" ||
                  editing.participant_kind === "unknown"
                }
              >
                {t(locale, "Guardar y seleccionar", "Save and select")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {source && (
        <MailEvidence
          id={source}
          locale={locale}
          close={() => setSource(null)}
        />
      )}
    </section>
  );
}
