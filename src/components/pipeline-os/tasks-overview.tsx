"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, Mail, RefreshCw, X } from "lucide-react";
import type { Locale, Workspace } from "@/lib/domain";
import { WorkspaceReader } from "@/lib/workspace-reader";
import {
  buildPipelineBoard,
  pipelineStages,
  type PipelineProcess,
} from "@/lib/pipeline-os/module";
import {
  buildTasksOverview,
  taskLeadStatuses,
  type TaskOverviewQuery,
  type TaskAccountSummary,
  type TasksOverview,
  type TaskStage,
} from "@/lib/pipeline-os/tasks-overview";
import { t } from "../ui";
import "./tasks-overview.css";

const stageNames: Record<TaskStage, [string, string]> = {
  app: ["Aplicación pendiente", "Application pending"],
  need: ["Pendiente de lenders", "Pending lenders"],
  offers: ["Oferta y negociación", "Offer / negotiation"],
  docsout: ["Contratos enviados", "Contracts sent"],
  signed: ["Contratos firmados", "Contracts signed"],
};
const statusNames = {
  all: ["Todos", "All"],
  managed: ["Gestionados", "Managed"],
  pending: ["Sin gestionar", "Not contacted"],
  replied: ["Contestados", "Replied"],
} as const;
const number = (n: number | null, locale: Locale) =>
  n === null
    ? "—"
    : new Intl.NumberFormat(locale === "es" ? "es-CO" : "en-US").format(n);
type Props = {
  data: Workspace;
  processes: PipelineProcess[];
  locale: Locale;
  query: string;
  onSelect(): void;
  open(id: string): void;
  renderStages?(
    counts: Record<TaskStage, number> | null,
    selectStage: (stage: TaskStage) => void,
  ): ReactNode;
};

export function OpenTasksOverview({
  data,
  processes,
  locale,
  query,
  onSelect,
  open,
  renderStages,
}: Props) {
  const [account, setAccount] = useState("all"),
    [status, setStatus] = useState<TaskOverviewQuery["status"]>("all"),
    [stage, setStage] = useState<TaskOverviewQuery["stage"]>("all"),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState<TasksOverview | null>(null),
    [loadedKey, setLoadedKey] = useState(""),
    [error, setError] = useState("");
  const [reader] = useState(() => new WorkspaceReader<TasksOverview>());
  const key = new URLSearchParams({
    owner: "all",
    q: query,
    account,
    status,
    stage,
    page: String(page),
  }).toString();
  useEffect(() => {
    setPage(0);
  }, [query]);
  useEffect(() => {
    let disposed = false;
    setError("");
    const timer = setTimeout(async () => {
      try {
        let result: TasksOverview;
        if (data.demo) {
          const board = buildPipelineBoard(
            data,
            processes,
            { group: "files" },
            Date.now(),
            100000,
          );
          result = buildTasksOverview(
            {
              profile: data.profile,
              profiles: data.profiles,
              cases: board.rows,
              leads: data.leads,
              campaigns: data.campaigns,
              facts: [],
              conversations: data.conversations,
              messages: data.messages,
              accounts: data.accounts.map((a) => ({
                ...a,
                owner_id:
                  data.campaigns.find((c) => c.account_id === a.id)
                    ?.seller_id || null,
              })),
            },
            { q: query, account, status, stage, page },
          );
        } else {
          const body = await reader.read(`/api/pipeline-os/tasks?${key}`, true);
          if (!body) return;
          result = body;
        }
        if (!disposed) {
          setOverview(result);
          setLoadedKey(key);
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      disposed = true;
      reader.cancel();
    };
  }, [
    key,
    revision,
    data,
    processes,
    query,
    account,
    status,
    stage,
    page,
    locale,
    reader,
  ]);
  function selectAccount(id: string) {
    setAccount(id);
    setStatus("all");
    setStage("all");
    setPage(0);
    onSelect();
  }
  function selectStage(id: string, value: TaskStage) {
    setAccount(id);
    setStage(value);
    setStatus("all");
    setPage(0);
    onSelect();
  }
  return (
    <>
      <TasksOverviewView
        overview={overview}
        locale={locale}
        account={account}
        status={status}
        stage={stage}
        loading={loadedKey !== key || !overview}
        error={error}
        selectAccount={selectAccount}
        changeStage={(value) => {
          setStage(value);
          setPage(0);
        }}
        changeStatus={(value) => {
          setStatus(value);
          setPage(0);
        }}
        changePage={setPage}
        refresh={() => {
          setLoadedKey("");
          setRevision((n) => n + 1);
        }}
        open={open}
        onStage={selectStage}
      />
      {!error &&
        renderStages?.(
          !error && loadedKey === key && overview
            ? account === "all"
              ? overview.totals.stages
              : overview.byAccount.find((r) => r.id === account)?.stages || null
            : null,
          (value) => selectStage(account, value),
        )}
    </>
  );
}

type ViewProps = {
  overview: TasksOverview | null;
  locale: Locale;
  account: string;
  status: TaskOverviewQuery["status"];
  stage: TaskOverviewQuery["stage"];
  loading: boolean;
  error: string;
  selectAccount(id: string): void;
  changeStage(stage: TaskOverviewQuery["stage"]): void;
  changeStatus(status: TaskOverviewQuery["status"]): void;
  changePage(page: number): void;
  refresh(): void;
  open(id: string): void;
  onStage(account: string, stage: TaskStage): void;
};

export function TasksOverviewView({
  overview,
  locale,
  account,
  status,
  stage,
  loading,
  error,
  selectAccount,
  changeStage,
  changeStatus,
  changePage,
  refresh,
  open,
  onStage,
}: ViewProps) {
  const selected = overview?.byAccount.find((r) => r.id === account);
  const metric = (n: number | null) => number(n, locale);
  const date = (at: string | null) =>
    at
      ? new Intl.DateTimeFormat(locale === "es" ? "es-CO" : "en-US", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(at))
      : "—";
  function summaryRow(rep: TaskAccountSummary, total = false) {
    const active = account === rep.id;
    return (
      <tr
        key={rep.id}
        className={`${active ? "pos-tasks-selected" : ""} ${total ? "pos-tasks-total" : ""}`}
      >
        <th scope="row">
          <button
            className="pos-tasks-email"
            onClick={() => selectAccount(rep.id)}
            aria-pressed={active}
          >
            <span className="pos-tasks-avatar" aria-hidden="true">
              <Mail size={17} />
            </span>
            <span>
              {total
                ? t(locale, "Todos los correos", "All email accounts")
                : rep.email}
            </span>
            {active && <Check size={14} aria-hidden="true" />}
          </button>
        </th>
        <td>
          <button
            className="pos-tasks-number"
            onClick={() => selectAccount(rep.id)}
            aria-label={`${rep.email}: ${metric(rep.leads)} leads`}
          >
            {metric(rep.leads)}
          </button>
        </td>
        <td>
          <b>{metric(rep.sent)}</b>
        </td>
        <td>
          <b>{metric(rep.replied)}</b>
        </td>
        {pipelineStages.map((s) => (
          <td key={s}>
            {!overview?.financial && s !== "app" ? (
              <span
                title={t(
                  locale,
                  "No disponible para este rol",
                  "Unavailable for this role",
                )}
              >
                —
              </span>
            ) : (
              <button
                className="pos-tasks-number"
                onClick={() => onStage(rep.id, s)}
                aria-label={`${rep.email}: ${t(locale, ...stageNames[s])}, ${metric(rep.stages[s])}`}
              >
                {metric(rep.stages[s])}
              </button>
            )}
          </td>
        ))}
      </tr>
    );
  }
  return (
    <section
      className="pos-tasks-overview"
      aria-label={t(locale, "Resumen por correo", "Email account overview")}
    >
      <div className="pos-tasks-heading">
        <div>
          <h3>{t(locale, "Correos del CRM", "CRM email accounts")}</h3>
          <p>
            {t(
              locale,
              "Todo el historial · selecciona un correo para ver sus leads.",
              "All recorded history · select an email account to view its leads.",
            )}
          </p>
        </div>
        <button
          className="pos-btn pos-sm"
          onClick={refresh}
          disabled={loading && !error}
        >
          <RefreshCw size={14} />
          {t(locale, "Actualizar", "Refresh")}
        </button>
      </div>
      {error && (
        <div className="pos-alert" role="alert">
          {t(
            locale,
            "No se pudo actualizar el resumen. Reintenta la lectura.",
            "Could not refresh the overview. Retry the read.",
          )}
          <button className="pos-btn pos-sm" onClick={refresh}>
            {t(locale, "Reintentar", "Retry")}
          </button>
        </div>
      )}
      {!overview ? (
        !error && (
          <div className="pos-card pos-empty" role="status">
            {t(
              locale,
              "Cargando correos y leads…",
              "Loading email accounts and leads…",
            )}
          </div>
        )
      ) : (
        <>
          <div className="pos-card pos-tasks-summary">
            <div
              className="pos-scroll"
              tabIndex={0}
              role="region"
              aria-label={t(locale, "Tabla de correos", "Email account table")}
            >
              <table className="pos-table pos-tasks-table">
                <caption className="pos-sr-only">
                  {t(
                    locale,
                    "Resumen de todo el historial por dirección de correo, sin duplicados",
                    "All recorded history by unique email address",
                  )}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t(locale, "Correo", "Email account")}</th>
                    <th scope="col">Leads</th>
                    <th scope="col">
                      {t(locale, "Enviados · campañas", "Sent · campaigns")}
                    </th>
                    <th scope="col">{t(locale, "Contestados", "Replied")}</th>
                    {pipelineStages.map((s) => (
                      <th scope="col" key={s}>
                        {t(locale, ...stageNames[s])}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summaryRow(
                    {
                      ...overview.totals,
                      id: "all",
                      email: t(
                        locale,
                        "Todos los correos",
                        "All email accounts",
                      ),
                    },
                    true,
                  )}
                  {overview.byAccount.map((r) => summaryRow(r))}
                  {!overview.byAccount.length && (
                    <tr>
                      <td colSpan={9}>
                        {t(
                          locale,
                          "No hay correos disponibles.",
                          "No email accounts available.",
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="pos-tasks-note">
              {t(
                locale,
                "Leads: enviados y pendientes vinculados a cada correo. Enviados: leads únicos enviados en Campañas. Contestados: leads que respondieron a ese correo. Un lead compartido cuenta una vez por correo y una vez en el total general; los leads aún sin correo vinculado solo aparecen en el total.",
                "Leads: sent and pending recipients linked to each email account. Sent: unique leads sent in Campaigns. Replied: leads that replied to that account. Shared leads count once per account and once overall; leads without an account link appear only in the overall total.",
              )}
            </p>
          </div>
          <div className="pos-tasks-detail" aria-busy={loading && !error}>
            <div className="pos-tasks-heading">
              <div>
                <h3>
                  {selected
                    ? `${t(locale, "Leads de", "Leads for")} ${selected.email}`
                    : t(locale, "Todos los leads", "All leads")}
                </h3>
                <p>
                  {account !== "all"
                    ? t(
                        locale,
                        "Actividad registrada en este correo.",
                        "Activity recorded on this email account.",
                      )
                    : t(
                        locale,
                        "Gestionado = al menos un correo enviado registrado.",
                        "Managed = at least one recorded sent email.",
                      )}
                </p>
              </div>
              {account !== "all" && (
                <button
                  className="pos-text-btn"
                  onClick={() => selectAccount("all")}
                >
                  {t(locale, "Ver todos", "View all")}
                  <X size={13} />
                </button>
              )}
            </div>
            {stage !== "all" && (
              <button
                className="pos-text-btn pos-tasks-stage-filter"
                onClick={() => changeStage("all")}
              >
                {t(locale, ...stageNames[stage])} ·{" "}
                {t(locale, "Ver todas las etapas", "View all stages")}{" "}
                <X size={13} />
              </button>
            )}
            <div
              className="pos-tasks-status"
              role="group"
              aria-label={t(
                locale,
                "Filtrar leads por gestión",
                "Filter leads by management status",
              )}
            >
              {taskLeadStatuses.map((s) => (
                <button
                  key={s}
                  className="pos-btn pos-sm"
                  aria-pressed={s === status}
                  onClick={() => changeStatus(s)}
                >
                  {t(locale, statusNames[s][0], statusNames[s][1])}
                </button>
              ))}
              <span className="pos-small pos-muted" role="status">
                {loading
                  ? t(locale, "Actualizando…", "Updating…")
                  : `${metric(overview.total)} leads`}
              </span>
            </div>
            {error ? (
              <div className="pos-card pos-empty">
                {t(
                  locale,
                  "Actualiza para consultar los leads con estos filtros.",
                  "Refresh to view leads with these filters.",
                )}
              </div>
            ) : loading ? (
              <div className="pos-card pos-empty" role="status">
                {t(
                  locale,
                  "Cargando leads con los filtros seleccionados…",
                  "Loading leads with the selected filters…",
                )}
              </div>
            ) : (
              <div
                className="pos-card pos-scroll pos-tasks-leads"
                tabIndex={0}
                role="region"
                aria-label={t(locale, "Lista de leads", "Lead list")}
              >
                <table className="pos-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        {t(locale, "Lead / empresa", "Lead / business")}
                      </th>
                      <th scope="col">
                        {t(
                          locale,
                          "Correos vinculados",
                          "Linked email accounts",
                        )}
                      </th>
                      <th scope="col">{t(locale, "Gestión", "Management")}</th>
                      <th scope="col">
                        {t(locale, "Último envío", "Last sent")}
                      </th>
                      <th scope="col">
                        {t(locale, "Respuesta recibida", "Reply received")}
                      </th>
                      <th scope="col">
                        {t(locale, "Etapa actual", "Current stage")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.caseId ? (
                            <button
                              className="pos-text-btn"
                              onClick={() => open(r.caseId!)}
                            >
                              {r.company || r.contact}
                              <ArrowUpRight size={13} />
                            </button>
                          ) : (
                            <b>{r.company || r.contact}</b>
                          )}
                          <span className="pos-tasks-line">{r.contact}</span>
                          <span className="pos-tasks-line pos-muted">
                            {r.email}
                          </span>
                        </td>
                        <td>
                          {r.accountIds.length
                            ? r.accountIds
                                .map(
                                  (id) =>
                                    overview.byAccount.find((a) => a.id === id)
                                      ?.email,
                                )
                                .filter(Boolean)
                                .join(" · ")
                            : t(
                                locale,
                                "Sin correo vinculado",
                                "No linked email account",
                              )}
                        </td>
                        <td>
                          <span
                            className={`pos-pill ${r.replied ? "pos-tasks-replied" : ""}`}
                          >
                            {r.replied
                              ? t(locale, "Contestó", "Replied")
                              : r.managed
                                ? t(locale, "Gestionado", "Managed")
                                : t(locale, "Sin gestionar", "Not contacted")}
                          </span>
                          {r.campaignSent && (
                            <small className="pos-tasks-line pos-muted">
                              {t(
                                locale,
                                "Enviado en campaña",
                                "Sent in campaign",
                              )}
                            </small>
                          )}
                        </td>
                        <td>{date(r.lastSentAt)}</td>
                        <td>{date(r.lastReplyAt)}</td>
                        <td>
                          {r.groups
                            .map((s) => t(locale, ...stageNames[s]))
                            .join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                    {!overview.rows.length && (
                      <tr>
                        <td colSpan={6} className="pos-empty">
                          {t(
                            locale,
                            "No hay leads con estos filtros. Prueba otro estado o correo.",
                            "No leads match these filters. Try another status or email account.",
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pos-pagination">
              <span>
                {loading || error
                  ? "—"
                  : overview.total
                    ? `${overview.page * 50 + 1}–${Math.min((overview.page + 1) * 50, overview.total)} / ${metric(overview.total)}`
                    : "0 / 0"}
              </span>
              <button
                className="pos-btn pos-sm"
                disabled={loading || !!error || !overview.page}
                onClick={() => changePage(overview.page - 1)}
              >
                {t(locale, "Anterior", "Previous")}
              </button>
              <button
                className="pos-btn pos-sm"
                disabled={loading || !!error || !overview.hasMore}
                onClick={() => changePage(overview.page + 1)}
              >
                {t(locale, "Siguiente", "Next")}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
