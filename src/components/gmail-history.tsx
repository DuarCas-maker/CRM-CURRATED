"use client";
import { ProtectedForm } from "./unsaved-changes";
import { useEffect, useRef, useState } from "react";
import type { Workspace, Locale } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import { MailThreadEvidence as MailEvidence } from "./mail-evidence";
import { gmailRunErrorMessage } from "@/lib/gmail-errors";
import {
  defaultCandidateFilters,
  type CandidateFilters,
} from "@/lib/gmail-candidate-filters";
import {
  historyRefreshMessage,
  initialHistoryRun,
  startHistoryPolling,
} from "@/lib/gmail-history-refresh";
import { Modal, t } from "./ui";
import { GmailAnalysisProgress } from "./gmail-analysis-progress";
import { GmailAttachments } from "./gmail-attachments";
import { teamLabel, type TeamIdentity } from "@/lib/gmail-team";
import {
  GmailTeamDirectory,
  GmailTeamForm,
  GmailTeamThreads,
} from "./gmail-team";

export interface HistoryCandidate {
  inbox_approved_at?: string | null;
  run_id?: string;
  run_status?: string;
  last_received_at?: string | null;
  latest_reply_intent?: "positive" | "negative" | "review" | "ignored" | null;
  result_opportunity_id?: string | null;
  import_requested_at?: string | null;
  imported_at: string | null;
  id: string;
  email: string;
  name: string;
  company_name: string;
  phone: string;
  classification: "unknown" | "active" | "inactive";
  participant_kind:
    "unknown" | "client" | "lender" | "broker" | "other" | "team";
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
  is_live_directory?: boolean;
  id: string;
  account_id: string;
  purpose: string;
  status: string;
  resume_status?: string | null;
  phase: string;
  scanned: number;
  estimated_messages: number;
  skipped: number;
  imported: number;
  last_error: string | null;
  retry_at: string | null;
  created_at: string;
  finished_at: string | null;
}
interface HistoryData {
  directory_counts?: { pending: number; incorporated: number };
  team_members?: TeamIdentity[];
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
export { MailEvidence };

export function GmailHistory({
  workspace,
  locale,
  openCase,
}: {
  workspace: Workspace;
  locale: Locale;
  openCase?: (id: string) => void;
}) {
  const [data, setData] = useState<HistoryData>({ accounts: [], runs: [] });
  const [runId, setRunId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [listing, setListing] = useState({
    ...defaultCandidateFilters,
    tab: "pending" as "pending" | "incorporated",
    page: 0,
  });
  const [candidateSearch, setCandidateSearch] = useState("");
  const [loadedListingKey, setLoadedListingKey] = useState("");
  const page = listing.page;
  const listingKey = new URLSearchParams({
    ...listing,
    page: String(page),
    ...(runId ? { run: runId } : {}),
  }).toString();
  const candidatesReady = loadedListingKey === listingKey;
  function setPage(next: number) {
    setListing((current) => ({ ...current, page: next }));
  }
  function setFilter<Key extends keyof CandidateFilters>(
    key: Key,
    value: CandidateFilters[Key],
  ) {
    setListing((current) => ({ ...current, [key]: value, page: 0 }));
  }
  function clearCandidateFilters() {
    setCandidateSearch("");
    setListing((current) => ({
      ...defaultCandidateFilters,
      tab: current.tab,
      page: 0,
    }));
  }
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setListing((current) =>
          current.q === candidateSearch.trim()
            ? current
            : { ...current, q: candidateSearch.trim(), page: 0 },
        ),
      350,
    );
    return () => clearTimeout(timer);
  }, [candidateSearch]);
  const [editing, setEditing] = useState<HistoryCandidate | null>(null),
    [source, setSource] = useState<string | null>(null);
  const [evidenceLimit, setEvidenceLimit] = useState(20);
  const [attachmentScope, setAttachmentScope] = useState<{
    runId: string;
    runStatus?: string;
    candidateId?: string;
    confirmImport?: boolean;
    confirmCandidateId?: string;
  } | null>(null);
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
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const poll = useRef<ReturnType<
    typeof startHistoryPolling<HistoryData>
  > | null>(null);
  const restoredProfile = useRef<string | null>(null);
  const selectionKey = `gmail-history-run:${workspace.profile.id}`;
  function selectRun(id: string) {
    restoredProfile.current = workspace.profile.id;
    try {
      sessionStorage.setItem(selectionKey, id);
    } catch {
      /* Storage can be disabled. */
    }
    setRunId(id);
    clearCandidateFilters();
  }
  const [organizations, setOrganizations] = useState<
    { id: string; domain: string }[]
  >([]);
  useEffect(() => {
    if (workspace.demo) return;
    const polling = startHistoryPolling<HistoryData>(
      `/api/gmail/history?${listingKey}`,
      {
        data: (body) => {
          setData(body);
          setLoadedListingKey(listingKey);
          setRefreshError(null);
          const lastPage = Math.max(0, Math.ceil((body.total || 0) / 50) - 1);
          if (page > lastPage) setPage(lastPage);
          if (restoredProfile.current !== workspace.profile.id) {
            let saved: string | null = null;
            try {
              saved = sessionStorage.getItem(selectionKey);
            } catch {
              /* Storage can be disabled. */
            }
            selectRun(initialHistoryRun(body.runs, saved));
          }
        },
        error: setRefreshError,
      },
    );
    poll.current = polling;
    return () => {
      polling.stop();
      if (poll.current === polling) poll.current = null;
    };
    // Each change of run/page cancels the previous request and polling closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingKey, workspace.demo, workspace.profile.id]);
  useEffect(() => {
    if (workspace.demo) return;
    fetch("/api/gmail/config")
      .then((r) => r.json())
      .then((body) => setOrganizations(body.organizations || []))
      .catch(() => {});
  }, [workspace.demo]);
  const run = data.runs.find((r) => r.id === runId),
    stats = data.stats;
  async function action(input: Record<string, unknown>, propagate = false) {
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
      if (body.id && body.id !== runId) {
        selectRun(body.id);
      } else poll.current?.refresh();
      // A successful mutation stays successful even if the following status read
      // fails. Refresh only the GET; never repeat an import or account action.
      return true;
    } catch (e) {
      setError((e as Error).message);
      if (propagate) throw e;
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
      run_id: c.run_id || runId,
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
          "El historial se conserva y los correos nuevos se sincronizan automáticamente. Las respuestas humanas con interés recibidas desde el 13 de octubre de 2026, 00:00 (Colombia), incorporan al lead a Conversaciones y Oportunidades. Las respuestas ambiguas quedan pendientes de revisión.",
          "History is retained and new mail syncs automatically. Human replies showing interest received since October 13, 2026, 00:00 (Colombia), add the lead to Conversations and Opportunities. Unclear replies await review.",
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
          {!!refreshError && (
            <div className="info-banner" role="status">
              <span>{historyRefreshMessage(refreshError, locale)}</span>
              <button
                type="button"
                className="button"
                onClick={() => poll.current?.refresh()}
              >
                {t(locale, "Actualizar estado", "Refresh status")}
              </button>
            </div>
          )}
          <ProtectedForm
            busy={busy}
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
            <button
              type="submit"
              className="button"
              disabled={!organizations.length}
            >
              {t(locale, "Autorizar con Google", "Authorize with Google")}
            </button>
          </ProtectedForm>
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
                    ? t(
                        locale,
                        "Histórico: importación confirmada",
                        "History: import confirmed",
                      )
                    : t(
                        locale,
                        "Histórico: pendiente de importación",
                        "History: awaiting import",
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
                selectRun(e.target.value);
              }}
            >
              <option value="">
                {t(locale, "Seleccionar análisis", "Select analysis")}
              </option>
              {data.runs
                .filter(
                  (r) =>
                    r.purpose === "historical" ||
                    r.status === "review" ||
                    r.is_live_directory,
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
                <GmailAnalysisProgress run={run} locale={locale} />
                {run.last_error && (
                  <div
                    className={
                      ["analyzing", "importing"].includes(run.status) &&
                      run.retry_at
                        ? "info-banner"
                        : "error-banner"
                    }
                  >
                    <div>
                      <p>{gmailRunErrorMessage(run.last_error, locale)}</p>
                      <small>{run.last_error}</small>
                      {["analyzing", "importing"].includes(run.status) &&
                        run.retry_at && (
                          <p>
                            {t(
                              locale,
                              "Próximo reintento previsto",
                              "Next retry scheduled",
                            )}
                            : {dateLabel(run.retry_at, locale, true)}
                          </p>
                        )}
                    </div>
                  </div>
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
                {["review", "completed", "importing"].includes(run.status) && (
                  <button
                    className="button primary"
                    disabled={busy || !stats?.selected}
                    onClick={() =>
                      setAttachmentScope({ runId: run.id, confirmImport: true })
                    }
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
                    {t(
                      locale,
                      "se copiarán únicamente los adjuntos seleccionados",
                      "only selected attachments will be copied",
                    )}
                  </p>
                  <button
                    className="button"
                    onClick={() => setAttachmentScope({ runId: run.id })}
                  >
                    {t(
                      locale,
                      "Revisar adjuntos de la importación",
                      "Review import attachments",
                    )}
                  </button>
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
              <div
                className="card-actions"
                role="tablist"
                aria-label={t(
                  locale,
                  "Incorporación de contactos",
                  "Contact incorporation",
                )}
              >
                {(["pending", "incorporated"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={listing.tab === tab}
                    className={`button${listing.tab === tab ? " primary" : ""}`}
                    onClick={() =>
                      setListing((current) => ({
                        ...current,
                        tab,
                        import_state: "all",
                        page: 0,
                      }))
                    }
                  >
                    {tab === "pending"
                      ? t(locale, "Pendientes", "Pending")
                      : t(locale, "Incorporados", "Incorporated")}
                    {data.directory_counts
                      ? ` (${data.directory_counts[tab]})`
                      : ""}
                  </button>
                ))}
              </div>
              <p className="muted">
                {t(
                  locale,
                  "Todos los contactos de esta cuenta, ordenados por el último correo recibido. Los envíos propios no cambian el orden. Los históricos pendientes requieren aprobación manual o una nueva respuesta con interés.",
                  "All contacts in this mailbox, ordered by latest received email. Your outgoing mail does not change the order. Pending historical contacts require manual approval or a new reply showing interest.",
                )}
              </p>
              <div className="gmail-candidate-filters">
                <label className="gmail-candidate-search">
                  <span>
                    {t(locale, "Buscar participantes", "Search participants")}
                  </span>
                  <input
                    type="search"
                    maxLength={200}
                    value={candidateSearch}
                    placeholder={t(
                      locale,
                      "Nombre, correo o empresa…",
                      "Name, email or company…",
                    )}
                    onChange={(e) => setCandidateSearch(e.target.value)}
                  />
                </label>
                <label>
                  <span>
                    {t(locale, "Tipo de participante", "Participant type")}
                  </span>
                  <select
                    value={listing.kind}
                    onChange={(e) =>
                      setFilter(
                        "kind",
                        e.target.value as CandidateFilters["kind"],
                      )
                    }
                  >
                    <option value="all">
                      {t(locale, "Todos los tipos", "All types")}
                    </option>
                    <option value="client">
                      {t(locale, "Clientes", "Customers")}
                    </option>
                    <option value="lender">Lenders</option>
                    <option value="broker">
                      {t(
                        locale,
                        "Brokers / intermediarios",
                        "Brokers / intermediaries",
                      )}
                    </option>
                    <option value="team">{t(locale, "Equipo", "Team")}</option>
                    <option value="other">{t(locale, "Otros", "Other")}</option>
                    <option value="unknown">
                      {t(locale, "Sin clasificar", "Unclassified")}
                    </option>
                  </select>
                </label>
                <label>
                  <span>{t(locale, "Clasificación", "Classification")}</span>
                  <select
                    value={listing.classification}
                    onChange={(e) =>
                      setFilter(
                        "classification",
                        e.target.value as CandidateFilters["classification"],
                      )
                    }
                  >
                    <option value="all">
                      {t(
                        locale,
                        "Todas las clasificaciones",
                        "All classifications",
                      )}
                    </option>
                    <option value="active">
                      {t(locale, "Activos", "Active")}
                    </option>
                    <option value="inactive">
                      {t(locale, "Inactivos", "Inactive")}
                    </option>
                    <option value="unknown">
                      {t(
                        locale,
                        "Pendiente de clasificación",
                        "Awaiting classification",
                      )}
                    </option>
                  </select>
                </label>
                <label>
                  <span>
                    {t(locale, "Estado de importación", "Import status")}
                  </span>
                  <select
                    value={listing.import_state}
                    onChange={(e) =>
                      setFilter(
                        "import_state",
                        e.target.value as CandidateFilters["import_state"],
                      )
                    }
                  >
                    <option value="all">
                      {t(locale, "Todos los estados", "All statuses")}
                    </option>
                    {listing.tab === "pending" && (
                      <option value="pending">
                        {t(
                          locale,
                          "Pendientes de incorporar",
                          "Awaiting import",
                        )}
                      </option>
                    )}
                    {listing.tab === "pending" && (
                      <option value="selected">
                        {t(
                          locale,
                          "Seleccionados por confirmar",
                          "Selected, awaiting confirmation",
                        )}
                      </option>
                    )}
                    {listing.tab === "pending" && (
                      <option value="queued">
                        {t(
                          locale,
                          "En cola / incorporación en curso",
                          "Queued / importing",
                        )}
                      </option>
                    )}
                    {listing.tab === "incorporated" && (
                      <option value="imported">
                        {t(locale, "Incorporados", "Imported")}
                      </option>
                    )}
                    <option value="errors">
                      {t(locale, "Con errores por revisar", "Errors to review")}
                    </option>
                  </select>
                </label>
                <label>
                  <span>
                    {t(locale, "Coincidencia por correo", "Email match")}
                  </span>
                  <select
                    value={listing.match}
                    onChange={(e) =>
                      setFilter(
                        "match",
                        e.target.value as CandidateFilters["match"],
                      )
                    }
                  >
                    <option value="all">
                      {t(locale, "Todos los contactos", "All contacts")}
                    </option>
                    <option value="existing">
                      {t(locale, "Con contacto existente", "Existing contact")}
                    </option>
                    <option value="new">
                      {t(
                        locale,
                        "Sin contacto previo detectado",
                        "No prior contact detected",
                      )}
                    </option>
                  </select>
                </label>
                <button className="button" onClick={clearCandidateFilters}>
                  {t(locale, "Limpiar filtros", "Clear filters")}
                </button>
              </div>
              <p role="status" aria-live="polite">
                {candidatesReady
                  ? `${t(locale, "Resultados", "Results")}: ${data.total || 0}`
                  : t(
                      locale,
                      "Buscando participantes…",
                      "Searching participants…",
                    )}
              </p>
              <p className="muted">
                {t(
                  locale,
                  "Los filtros cambian la lista; las selecciones se conservan. Confirmar importación incluye todos los participantes seleccionados del análisis.",
                  "Filters change the list; selections are preserved. Confirm import includes all selected participants in this analysis.",
                )}
              </p>
              <div className="table-scroll" aria-busy={!candidatesReady}>
                <table>
                  <thead>
                    <tr>
                      <th>{t(locale, "Incorporar", "Import")}</th>
                      <th>
                        {t(locale, "Contacto / empresa", "Contact / company")}
                      </th>
                      <th>{t(locale, "Evidencia", "Evidence")}</th>
                      <th>{t(locale, "Clasificación", "Classification")}</th>
                      <th>{t(locale, "Último recibido", "Last received")}</th>
                      <th>{t(locale, "Revisión", "Review")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidatesReady &&
                      (data.candidates || []).map((c) => (
                        <tr key={c.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${t(locale, "Seleccionar", "Select")} ${c.email}`}
                              checked={c.selected}
                              disabled={
                                busy ||
                                c.participant_kind === "team" ||
                                !!c.imported_at ||
                                !!c.import_requested_at ||
                                ![
                                  "review",
                                  "completed",
                                  "importing",
                                  "failed",
                                ].includes(c.run_status || run.status)
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
                              {c.participant_kind === "team"
                                ? t(
                                    locale,
                                    "Asociación por conversación",
                                    "Associate each conversation",
                                  )
                                : c.company_name ||
                                  t(
                                    locale,
                                    "Empresa pendiente de confirmar",
                                    "Confirm company",
                                  )}
                            </small>
                          </td>
                          <td>
                            {c.inbound_count}{" "}
                            {t(locale, "recibidos", "received")} /{" "}
                            {c.outbound_count} {t(locale, "enviados", "sent")}
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
                            <button
                              className="text-button"
                              onClick={() =>
                                setAttachmentScope({
                                  runId: c.run_id || run.id,
                                  runStatus: c.run_status || run.status,
                                  candidateId: c.id,
                                })
                              }
                            >
                              {t(
                                locale,
                                "Revisar adjuntos",
                                "Review attachments",
                              )}
                            </button>
                          </td>
                          <td>
                            {c.participant_kind === "team"
                              ? data.team_members?.find(
                                  (m) => m.email === c.email,
                                )
                                ? teamLabel(
                                    data.team_members.find(
                                      (m) => m.email === c.email,
                                    )!,
                                    locale,
                                  )
                                : t(locale, "Equipo", "Team")
                              : `${c.participant_kind} · ${c.classification}`}
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
                            {c.last_received_at
                              ? dateLabel(c.last_received_at, locale, true)
                              : t(
                                  locale,
                                  "Sin correos recibidos",
                                  "No received email",
                                )}
                            <small>
                              {c.latest_reply_intent === "review"
                                ? t(
                                    locale,
                                    "Interés por revisar",
                                    "Interest needs review",
                                  )
                                : c.latest_reply_intent === "positive"
                                  ? t(locale, "Con interés", "Interested")
                                  : c.latest_reply_intent === "negative"
                                    ? t(locale, "Sin interés", "Not interested")
                                    : c.latest_reply_intent === "ignored"
                                      ? t(
                                          locale,
                                          "Mensaje automático",
                                          "Automatic message",
                                        )
                                      : ""}
                            </small>
                          </td>
                          <td>
                            <small>
                              {c.participant_kind === "team"
                                ? t(locale, "Miembro del equipo", "Team member")
                                : c.existing_contact_id
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
                                (c.participant_kind !== "team" &&
                                  (!!c.imported_at ||
                                    !!c.import_requested_at)) ||
                                ![
                                  "review",
                                  "completed",
                                  "importing",
                                  "failed",
                                  ...(c.participant_kind === "team"
                                    ? ["completed"]
                                    : []),
                                ].includes(c.run_status || run.status)
                              }
                              onClick={() => {
                                setEditing(c);
                                setSearch(c.company_name || c.name);
                                findMatches(c);
                              }}
                            >
                              {t(locale, "Revisar", "Review")}
                            </button>
                            {c.participant_kind !== "team" &&
                              (c.imported_at ? (
                                <>
                                  <small>
                                    {t(locale, "Incorporado", "Imported")}
                                  </small>
                                  {c.latest_reply_intent === "review" &&
                                    !c.inbox_approved_at &&
                                    ["client", "unknown"].includes(
                                      c.participant_kind,
                                    ) && (
                                      <button
                                        type="button"
                                        className="button"
                                        disabled={busy}
                                        onClick={() =>
                                          action({
                                            operation: "approve_interest",
                                            run_id: c.run_id || run.id,
                                            candidate_id: c.id,
                                          })
                                        }
                                      >
                                        {t(
                                          locale,
                                          "Confirmar interés revisado",
                                          "Confirm reviewed interest",
                                        )}
                                      </button>
                                    )}
                                  {c.result_opportunity_id && openCase && (
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        openCase(c.result_opportunity_id!)
                                      }
                                    >
                                      {t(locale, "Ver expediente", "View case")}
                                    </button>
                                  )}
                                </>
                              ) : c.import_requested_at ? (
                                <small role="status">
                                  {t(
                                    locale,
                                    "Incorporación en curso",
                                    "Import in progress",
                                  )}
                                </small>
                              ) : (
                                <button
                                  className="button primary"
                                  disabled={
                                    busy ||
                                    !c.selected ||
                                    ![
                                      "review",
                                      "completed",
                                      "importing",
                                    ].includes(c.run_status || run.status)
                                  }
                                  onClick={() =>
                                    setAttachmentScope({
                                      runId: c.run_id || run.id,
                                      runStatus: c.run_status || run.status,
                                      candidateId: c.id,
                                      confirmCandidateId: c.id,
                                      confirmImport: true,
                                    })
                                  }
                                >
                                  {t(
                                    locale,
                                    "Importar este registro",
                                    "Import this record",
                                  )}
                                </button>
                              ))}
                          </td>
                        </tr>
                      ))}
                    {candidatesReady && !data.candidates?.length && (
                      <tr>
                        <td colSpan={6}>
                          {t(
                            locale,
                            "No hay participantes que coincidan con esta búsqueda y filtros.",
                            "No participants match this search and filters.",
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="card-actions">
                <button
                  className="button"
                  disabled={!candidatesReady || page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  {t(locale, "Anterior", "Previous")}
                </button>
                <span>
                  {page + 1} / {Math.max(1, Math.ceil((data.total || 0) / 50))}
                </span>
                <button
                  className="button"
                  disabled={
                    !candidatesReady || (page + 1) * 50 >= (data.total || 0)
                  }
                  onClick={() => setPage(page + 1)}
                >
                  {t(locale, "Siguiente", "Next")}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {!workspace.demo && (
        <GmailTeamDirectory
          members={data.team_members || []}
          workspace={workspace}
          locale={locale}
          onSaved={() => poll.current?.refresh()}
        />
      )}
      {editing && (
        <Modal
          locale={locale}
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
          <label>
            {t(locale, "Participante", "Participant")}
            <select
              value={editing.participant_kind}
              disabled={
                !!data.team_members?.some((m) => m.email === editing.email)
              }
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
              <option value="team">
                {t(locale, "Miembro del equipo", "Team member")}
              </option>
            </select>
          </label>
          {editing.participant_kind === "team" ? (
            <>
              {editing.imported_at && (
                <p className="info-banner">
                  {t(
                    locale,
                    "Este participante ya tenía una incorporación anterior. Sus registros se conservan; revisa cualquier expediente creado antes de clasificarlo como equipo.",
                    "This participant was previously imported. Existing records are preserved; review cases created before classifying it as team.",
                  )}
                </p>
              )}
              <GmailTeamForm
                key={editing.email}
                email={editing.email}
                name={editing.name}
                member={data.team_members?.find(
                  (m) => m.email === editing.email,
                )}
                workspace={workspace}
                locale={locale}
                onSaved={() => {
                  poll.current?.refresh();
                  setEditing({ ...editing, participant_kind: "team" });
                }}
              />
              {data.team_members?.some((m) => m.email === editing.email) && (
                <GmailTeamThreads
                  openCase={(id) => {
                    setEditing(null);
                    openCase?.(id);
                  }}
                  candidateId={editing.id}
                  runId={editing.run_id || runId}
                  workspace={workspace}
                  locale={locale}
                  openSource={setSource}
                />
              )}
            </>
          ) : (
            <ProtectedForm
              busy={busy}
              onSubmit={async (e) => {
                e.preventDefault();
                if (await action(selectPayload(editing, true)))
                  setEditing(null);
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
                  <option value="active">
                    {t(locale, "Activo", "Active")}
                  </option>
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
                      (p) =>
                        p.opportunity_id === editing.selected_opportunity_id,
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
            </ProtectedForm>
          )}
        </Modal>
      )}
      {attachmentScope && (
        <GmailAttachments
          {...attachmentScope}
          locale={locale}
          editable={["review", "completed", "importing"].includes(
            attachmentScope.runStatus ||
              data.runs.find((r) => r.id === attachmentScope.runId)?.status ||
              "",
          )}
          close={() => setAttachmentScope(null)}
          openSource={setSource}
          saved={async () => {
            if (attachmentScope.confirmCandidateId)
              await action(
                {
                  operation: "confirm_candidate",
                  run_id: attachmentScope.runId,
                  candidate_id: attachmentScope.confirmCandidateId,
                },
                true,
              );
            else if (attachmentScope.confirmImport)
              await action(
                {
                  operation: "confirm",
                  run_id: attachmentScope.runId,
                },
                true,
              );
            else poll.current?.refresh();
          }}
        />
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
