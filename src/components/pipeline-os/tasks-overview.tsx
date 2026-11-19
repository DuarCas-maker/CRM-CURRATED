"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Mail, RefreshCw, Users, X } from "lucide-react";
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
  type TaskRep,
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
  owner: string;
  query: string;
  onOwner(id: string): void;
  open(id: string): void;
  onStage(owner: string, stage: TaskStage): void;
};

export function OpenTasksOverview({
  data,
  processes,
  locale,
  owner,
  query,
  onOwner,
  open,
  onStage,
}: Props) {
  const [account, setAccount] = useState("all"),
    [status, setStatus] = useState<TaskOverviewQuery["status"]>("all"),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState<TasksOverview | null>(null),
    [loadedKey, setLoadedKey] = useState(""),
    [error, setError] = useState("");
  const [reader] = useState(() => new WorkspaceReader<TasksOverview>());
  const key = new URLSearchParams({
    owner,
    q: query,
    account,
    status,
    page: String(page),
  }).toString();
  useEffect(() => {
    setPage(0);
  }, [owner, query]);
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
            { owner, q: query, account, status, page },
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
    owner,
    query,
    account,
    status,
    page,
    locale,
    reader,
  ]);
  function selectOwner(id: string, accountId = "all") {
    setAccount(accountId);
    setStatus("all");
    setPage(0);
    onOwner(id);
  }
  return (
    <TasksOverviewView
      overview={overview}
      locale={locale}
      owner={owner}
      account={account}
      status={status}
      loading={loadedKey !== key || !overview}
      error={error}
      selectOwner={selectOwner}
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
      onStage={onStage}
    />
  );
}

type ViewProps = {
  overview: TasksOverview | null;
  locale: Locale;
  owner: string;
  account: string;
  status: TaskOverviewQuery["status"];
  loading: boolean;
  error: string;
  selectOwner(id: string, account?: string): void;
  changeStatus(status: TaskOverviewQuery["status"]): void;
  changePage(page: number): void;
  refresh(): void;
  open(id: string): void;
  onStage(owner: string, stage: TaskStage): void;
};

export function TasksOverviewView({
  overview,
  locale,
  owner,
  account,
  status,
  loading,
  error,
  selectOwner,
  changeStatus,
  changePage,
  refresh,
  open,
  onStage,
}: ViewProps) {
  const selected = overview?.byRep.find((r) => r.id === owner);
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
  function summaryRow(rep: TaskRep, total = false) {
    const active = owner === rep.id && account === "all";
    return (
      <tr
        key={rep.id}
        className={`${active ? "pos-tasks-selected" : ""} ${total ? "pos-tasks-total" : ""}`}
      >
        <th scope="row">
          <button
            className="pos-tasks-owner"
            onClick={() => selectOwner(rep.id)}
            aria-pressed={active}
          >
            <span className="pos-tasks-avatar" aria-hidden="true">
              {total ? (
                <Users size={17} />
              ) : (
                rep.name
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((s) => s[0])
                  .join("")
              )}
            </span>
            <span>
              {total
                ? t(locale, "Todos los responsables", "All reps")
                : rep.name}
            </span>
            {active && <Check size={14} aria-hidden="true" />}
          </button>
          {!total && (
            <div className="pos-tasks-accounts">
              {rep.accounts.length ? (
                rep.accounts.map((a) => (
                  <button
                    key={a.id}
                    className="pos-tasks-account"
                    aria-pressed={owner === rep.id && account === a.id}
                    onClick={() => selectOwner(rep.id, a.id)}
                  >
                    <span>
                      <Mail size={12} aria-hidden="true" />
                      {a.email ||
                        t(
                          locale,
                          "Cuenta no disponible",
                          "Account unavailable",
                        )}
                    </span>
                    <small>
                      {metric(a.sent)} {t(locale, "enviados", "sent")} ·{" "}
                      {metric(a.replied)} {t(locale, "contestados", "replied")}
                    </small>
                  </button>
                ))
              ) : (
                <small className="pos-muted">
                  {t(locale, "Sin cuenta vinculada", "No linked account")}
                </small>
              )}
            </div>
          )}
        </th>
        <td>
          <button
            className="pos-tasks-number"
            onClick={() => selectOwner(rep.id)}
            aria-label={`${rep.name}: ${metric(rep.leads)} leads`}
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
                aria-label={`${rep.name}: ${t(locale, ...stageNames[s])}, ${metric(rep.stages[s])}`}
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
      aria-label={t(
        locale,
        "Resumen de responsables y correos",
        "Rep and email overview",
      )}
    >
      <div className="pos-tasks-heading">
        <div>
          <h3>
            {t(locale, "Responsables y correos", "Reps & email accounts")}
          </h3>
          <p>
            {t(
              locale,
              "Todo el historial · selecciona un responsable para ver sus leads.",
              "All recorded history · select a rep to view their leads.",
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
              "Cargando responsables, correos y leads…",
              "Loading reps, email accounts and leads…",
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
              aria-label={t(locale, "Tabla de responsables", "Rep table")}
            >
              <table className="pos-table pos-tasks-table">
                <caption className="pos-sr-only">
                  {t(
                    locale,
                    "Resumen de todo el historial por responsable y cuenta de correo",
                    "All recorded history by rep and email account",
                  )}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      {t(locale, "Responsable / correo", "Rep / email")}
                    </th>
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
                      name: t(locale, "Todos", "All"),
                      accounts: [],
                    },
                    true,
                  )}
                  {overview.byRep.map((r) => summaryRow(r))}
                  {!overview.byRep.length && (
                    <tr>
                      <td colSpan={9}>
                        {t(
                          locale,
                          "No hay responsables ni correos disponibles.",
                          "No reps or email accounts available.",
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
                "Enviados: leads únicos con envío confirmado en Campañas. Un lead en varias cuentas cuenta una vez en el total. Contestados: leads con respuesta recibida. Etapas: responsable actual del expediente.",
                "Sent: unique leads with a confirmed campaign send. A lead in multiple accounts counts once in the total. Replied: leads with a received reply. Stages: the file's current rep.",
              )}
            </p>
          </div>
          <div className="pos-tasks-detail" aria-busy={loading && !error}>
            <div className="pos-tasks-heading">
              <div>
                <h3>
                  {selected
                    ? `${t(locale, "Leads de", "Leads for")} ${selected.name}`
                    : t(locale, "Todos los leads", "All leads")}
                </h3>
                <p>
                  {account !== "all"
                    ? selected?.accounts.find((a) => a.id === account)?.email
                    : t(
                        locale,
                        "Gestionado = al menos un correo enviado registrado.",
                        "Managed = at least one recorded sent email.",
                      )}
                </p>
              </div>
              {(owner !== "all" || account !== "all") && (
                <button
                  className="pos-text-btn"
                  onClick={() => selectOwner("all")}
                >
                  {t(locale, "Ver todos", "View all")}
                  <X size={13} />
                </button>
              )}
            </div>
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
                      <th scope="col">{t(locale, "Responsable", "Rep")}</th>
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
                          {r.accountIds.length > 0 && (
                            <small className="pos-tasks-line pos-muted">
                              {r.accountIds
                                .map(
                                  (id) =>
                                    overview.byRep
                                      .flatMap((rep) => rep.accounts)
                                      .find((a) => a.id === id)?.email,
                                )
                                .filter(Boolean)
                                .join(" · ")}
                            </small>
                          )}
                        </td>
                        <td>{r.ownerName}</td>
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
                            "No hay leads con estos filtros. Prueba otro estado o responsable.",
                            "No leads match these filters. Try another status or rep.",
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
