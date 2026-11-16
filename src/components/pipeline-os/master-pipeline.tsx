"use client";
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Mail,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import type { Locale, Workspace, Stage as CrmStage } from "@/lib/domain";
import { currency, stageLabels } from "@/lib/domain";
import { readableMail } from "@/lib/mail-display";
import {
  buildMasterPipeline,
  masterStages,
  masterTabs,
  parseMasterQuery,
  type MasterDashboard,
  type MasterRow,
  type MasterStage,
  type MasterTab,
} from "@/lib/pipeline-os/master-pipeline";
import { masterDemoSource } from "@/lib/pipeline-os/master-demo";
import type { PipelineProcess } from "@/lib/pipeline-os/module";
import { Modal, t } from "../ui";
import type { CaseSection } from "./board";
import "./master-pipeline.css";

export const masterTabLabels: Record<MasterTab, [string, string]> = {
  tasks: ["Tareas", "Tasks"],
  offers: ["Ofertas", "Offers"],
  pipeline: ["Pipeline", "Pipeline"],
  stats: ["Indicadores", "Stats"],
  comms: ["Comunicaciones", "Communications"],
  leads: ["Respuestas de leads", "Lead replies"],
};
export const masterStageLabels: Record<MasterStage, [string, string]> = {
  submitted: ["Enviado a lenders", "Submitted"],
  requirements: ["Requisitos solicitados", "Stips requested"],
  approved: ["Ofertas / aprobación registrada", "Approved / offers"],
  contracts_out: ["Contratos enviados", "Contracts out"],
  contracts_signed: ["Contratos firmados", "Contracts signed"],
  funded: ["Desembolsado", "Funded"],
  declined: ["Sin financiación", "Declined"],
  withdrawn: ["Cliente retirado", "Customer withdrew"],
  application: ["Aplicación y preparación", "Application / preparation"],
  paused: ["En pausa", "On hold"],
  unclassified: ["Por clasificar", "Unclassified"],
};
const milestoneLabels: Record<string, [string, string]> = {
  application_received: ["Aplicación recibida", "Application received"],
  contract_sent: ["Contrato enviado", "Contract sent"],
  contract_signed: ["Contrato firmado", "Contract signed"],
  disbursed: ["Desembolso registrado", "Recorded funding"],
};
const number = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("es-CO").format(n);
const date = (at: string | null | undefined, locale: Locale) =>
  at && Number.isFinite(Date.parse(at))
    ? new Intl.DateTimeFormat(locale === "es" ? "es-CO" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(at))
    : "—";
const safeError = (e: unknown) =>
  e instanceof Error ? e.message : "No se pudo cargar / Could not load";
type Props = {
  data: Workspace;
  processes: PipelineProcess[];
  locale: Locale;
  search: string;
  owner: string;
  onOwner(id: string): void;
  open(id: string, section?: CaseSection): void;
  mail(id?: string, conversation?: string): void;
};

export function MasterPipeline({
  data,
  processes,
  locale,
  search,
  owner,
  onOwner,
  open,
  mail,
}: Props) {
  const [tab, setTab] = useState<MasterTab>("tasks"),
    [stage, setStage] = useState("all"),
    [priority, setPriority] = useState("all"),
    [days, setDays] = useState(30),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [dashboard, setDashboard] = useState<MasterDashboard | null>(null),
    [loadedKey, setLoadedKey] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const queryString = new URLSearchParams({
    tab,
    q: search,
    owner,
    stage,
    priority,
    days: String(days),
    page: String(page),
  }).toString();
  const requestId = useRef(0),
    tabId = useId();
  const [archive, setArchive] = useState<string | null>(null);
  useEffect(() => {
    setPage(0);
  }, [search, owner]);
  useEffect(() => {
    const controller = new AbortController(),
      id = ++requestId.current;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      async () => {
        try {
          let value: MasterDashboard;
          if (data.demo) {
            value = buildMasterPipeline(
              masterDemoSource(data, processes),
              parseMasterQuery(new URLSearchParams(queryString)),
            );
            value.rows = value.rows.map((r) => ({
              ...r,
              excerpt: readableMail(
                data.messages.find((m) => m.id === r.messageId)?.body || "",
              ).text.slice(0, 600),
            }));
          } else {
            const r = await fetch(`/api/pipeline-os/master?${queryString}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            const body = await r.json();
            if (!r.ok)
              throw Error(
                typeof body.error === "string"
                  ? body.error
                  : "No se pudo cargar Master Pipeline / Could not load Master Pipeline",
              );
            value = body;
          }
          if (!controller.signal.aborted && id === requestId.current) {
            setDashboard(value);
            setLoadedKey(queryString);
          }
        } catch (e) {
          if (!controller.signal.aborted && id === requestId.current)
            setError(safeError(e));
        } finally {
          if (!controller.signal.aborted && id === requestId.current)
            setLoading(false);
        }
      },
      data.demo ? 0 : 200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [queryString, revision, data, processes]);
  const current =
    dashboard && loadedKey === queryString && !error && !loading
      ? dashboard
      : null;
  const sectionRef = useRef<HTMLElement>(null),
    initialScroll = useRef(false);
  useEffect(() => {
    if (!current || initialScroll.current) return;
    initialScroll.current = true;
    if (new URLSearchParams(window.location.search).get("view") === "master")
      sectionRef.current
        ?.closest(".pos-level")
        ?.scrollIntoView({ block: "start" });
  }, [current]);
  const chooseTab = (next: MasterTab) => {
    setTab(next);
    setPage(0);
  };
  const reply = (r: MasterRow) =>
    r.archiveMessageId
      ? setArchive(r.archiveMessageId)
      : mail(r.caseId || undefined, r.conversationId);
  return (
    <section
      className="master-pipeline"
      ref={sectionRef}
      aria-label="Master Pipeline"
      aria-busy={loading}
    >
      <div className="pos-row mp-intro">
        <div>
          <div className="pos-caption">
            {data.demo
              ? t(locale, "DEMO · DATOS FICTICIOS", "DEMO · SAMPLE DATA")
              : t(locale, "OPERACIÓN ACTUAL DEL CRM", "CURRENT CRM WORKLOAD")}
          </div>
          <p className="pos-muted">
            {t(
              locale,
              "Cada asesor, cada expediente y el siguiente paso.",
              "Every rep, every file, and the next step.",
            )}
          </p>
        </div>
        <button
          className="pos-btn"
          onClick={() => setRevision((r) => r + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} />
          {t(locale, "Actualizar", "Refresh")}
        </button>
      </div>
      <div className="mp-controls">
        <SlidersHorizontal size={16} aria-hidden="true" />
        <label>
          {t(locale, "Responsable", "Rep")}
          <select
            value={owner}
            onChange={(e) => {
              onOwner(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">
              {t(locale, "Todos los visibles", "All visible")}
            </option>
            {(dashboard?.byRep || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.id === "unassigned"
                  ? t(locale, "Sin asignar", "Unassigned")
                  : r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t(locale, "Etapa equivalente", "Equivalent stage")}
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">
              {t(locale, "Todas las etapas", "All stages")}
            </option>
            {masterStages.map((s) => (
              <option key={s} value={s}>
                {t(locale, ...masterStageLabels[s])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t(locale, "Actividad", "Activity")}
          <select
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setPage(0);
            }}
          >
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {d} {t(locale, "días", "days")}
              </option>
            ))}
          </select>
        </label>
        {(owner !== "all" || stage !== "all") && (
          <button
            className="pos-text-btn"
            onClick={() => {
              onOwner("all");
              setStage("all");
              setPriority("all");
              setPage(0);
            }}
          >
            {t(locale, "Limpiar filtros", "Clear filters")}
          </button>
        )}
      </div>
      <p className="pos-small pos-muted">
        {t(
          locale,
          "Carga actual de tareas y expedientes. El período se aplica a actividad, correo y resultados diarios (UTC).",
          "Current task and case workload. The period applies to activity, mail and daily results (UTC).",
        )}
      </p>
      {error && (
        <div className="pos-card mp-error" role="alert">
          <p>{error}</p>
          <button className="pos-btn" onClick={() => setRevision((r) => r + 1)}>
            {t(locale, "Reintentar lectura", "Retry read")}
          </button>
        </div>
      )}
      {current ? (
        <>
          <MasterRepTable
            dashboard={current}
            locale={locale}
            owner={owner}
            onOwner={(id) => {
              onOwner(id === owner ? "all" : id);
              setPage(0);
            }}
          />
          <div className="mp-summary">
            {[
              [
                t(locale, "Tareas abiertas", "Open tasks"),
                current.counts.tasks,
              ],
              [
                "P1",
                current.byRep
                  .filter((r) => owner === "all" || r.id === owner)
                  .reduce((n, r) => n + r.p1, 0),
              ],
              [
                t(locale, "Casos activos", "Live deals"),
                current.byRep
                  .filter((r) => owner === "all" || r.id === owner)
                  .reduce((n, r) => n + r.live, 0),
              ],
              [
                t(locale, "Desembolsados", "Funded"),
                current.byRep
                  .filter((r) => owner === "all" || r.id === owner)
                  .reduce((n, r) => n + r.funded, 0),
              ],
            ].map(([label, value]) => (
              <div className="pos-card" key={label}>
                <span>{label}</span>
                <strong>{number(Number(value))}</strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        !error && (
          <div className="pos-card pos-empty" role="status">
            {t(
              locale,
              "Cargando el pipeline y sus conteos…",
              "Loading pipeline and counts…",
            )}
          </div>
        )
      )}
      <div
        className="mp-tablist"
        role="tablist"
        aria-label={t(
          locale,
          "Vistas de Master Pipeline",
          "Master Pipeline views",
        )}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          const i = masterTabs.indexOf(tab),
            next =
              e.key === "Home"
                ? masterTabs[0]
                : e.key === "End"
                  ? masterTabs.at(-1)!
                  : masterTabs[
                      (i +
                        (e.key === "ArrowRight" ? 1 : -1) +
                        masterTabs.length) %
                        masterTabs.length
                    ];
          chooseTab(next);
          requestAnimationFrame(() =>
            document.getElementById(`${tabId}-${next}`)?.focus(),
          );
        }}
      >
        {masterTabs.map((x) => (
          <button
            key={x}
            id={`${tabId}-${x}`}
            role="tab"
            aria-selected={tab === x}
            aria-controls={`${tabId}-panel`}
            tabIndex={tab === x ? 0 : -1}
            onClick={() => chooseTab(x)}
          >
            {t(locale, ...masterTabLabels[x])}
            {current && <span>{number(current.counts[x])}</span>}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-${tab}`}
        tabIndex={0}
      >
        {tab === "tasks" && (
          <div className="pos-row mp-task-filter">
            <label>
              {t(locale, "Prioridad operativa", "Operational priority")}
              <select
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">{t(locale, "Todas", "All")}</option>
                {[1, 2, 3].map((p) => (
                  <option key={p} value={p}>
                    P{p}
                  </option>
                ))}
              </select>
            </label>
            <p className="pos-small pos-muted">
              {t(
                locale,
                "Cada tarea abierta se cuenta una vez, por su responsable. P1/P2/P3 conserva la prioridad operativa de su expediente.",
                "Each open task is counted once, by its owner. P1/P2/P3 preserves the file's operational priority.",
              )}
            </p>
          </div>
        )}
        {current && tab === "stats" && (
          <MasterStats dashboard={current} locale={locale} owner={owner} />
        )}
        {current && (
          <MasterRows
            dashboard={current}
            locale={locale}
            open={open}
            mail={reply}
          />
        )}
        {!current && !error && (
          <p role="status">
            {t(locale, "Actualizando esta vista…", "Updating this view…")}
          </p>
        )}
        {current && (
          <div className="mp-pagination">
            <span>
              {number(current.total)} {t(locale, "registros", "records")} ·{" "}
              {t(locale, "Página", "Page")} {page + 1}
            </span>
            <div>
              <button
                className="pos-btn pos-sm"
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                {t(locale, "Anterior", "Previous")}
              </button>
              <button
                className="pos-btn pos-sm"
                disabled={!current.hasMore || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                {t(locale, "Siguiente", "Next")}
              </button>
            </div>
          </div>
        )}
      </div>
      {current && (
        <div className="mp-notes pos-small pos-muted">
          <p>
            {t(
              locale,
              "«Sin respuesta registrada» usa evidencia del hilo de la oferta. No incluye llamadas, SMS ni respuestas fuera del CRM. «—» indica falta de evidencia o acceso, no cero.",
              "“No recorded reply” uses evidence from the offer's thread. It excludes calls, SMS and replies outside the CRM. “—” means missing evidence or access, not zero.",
            )}
          </p>
          {current.coverage.bestWithoutEvidence > 0 && (
            <p>
              {number(current.coverage.bestWithoutEvidence)}{" "}
              {t(
                locale,
                "ofertas de mayor monto requieren vincular su correo de origen para comprobar respuesta.",
                "highest offers need their source mail linked before a reply can be checked.",
              )}
            </p>
          )}
          {!current.coverage.leadReplies && (
            <p>
              {t(
                locale,
                "Respuestas de leads: cobertura parcial según los permisos del archivo. Los pendientes sin cobertura no se contabilizan como cero.",
                "Lead replies: partial coverage under archive permissions. Uncovered pending replies are not counted as zero.",
              )}
            </p>
          )}
          <p>
            {t(locale, "Actualizado", "As of")} {date(current.asOf, locale)} ·
            UTC ·{" "}
            {t(
              locale,
              "Solo registros existentes; esta vista no consulta Gmail ni envía correos.",
              "Existing records only; this view does not scan Gmail or send mail.",
            )}
          </p>
        </div>
      )}
      {archive && (
        <ArchiveReader
          id={archive}
          locale={locale}
          demo={data.demo}
          close={() => setArchive(null)}
        />
      )}
    </section>
  );
}

export function MasterRepTable({
  dashboard: b,
  locale,
  owner,
  onOwner,
}: {
  dashboard: MasterDashboard;
  locale: Locale;
  owner: string;
  onOwner(id: string): void;
}) {
  const headers = [
    t(locale, "Asesor", "Rep"),
    t(locale, "Tareas", "Tasks"),
    "P1",
    t(locale, "Ofertas", "Offers"),
    t(locale, "Mayor oferta sin respuesta", "Best unanswered"),
    t(locale, "Casos activos", "Live deals"),
    t(locale, "Desembolsados", "Funded"),
    t(locale, "Correos", "Emails"),
    t(locale, "Leads pendientes", "Leads open"),
  ];
  return (
    <section className="pos-card mp-reps">
      <div className="mp-section-head">
        <div>
          <h3>{t(locale, "Por asesor", "By rep")}</h3>
          <p className="pos-muted">
            {t(
              locale,
              "Selecciona un asesor para filtrar todas las vistas de abajo.",
              "Select a rep to filter every view below.",
            )}
          </p>
        </div>
        {owner !== "all" && (
          <button className="pos-text-btn" onClick={() => onOwner("all")}>
            {t(locale, "Ver todos", "View all")}
          </button>
        )}
      </div>
      <div className="pos-scroll">
        <table className="pos-table">
          <caption className="pos-sr">
            {t(
              locale,
              "Carga actual por responsable y correo registrado en el período.",
              "Current workload by rep and mail recorded in the period.",
            )}
          </caption>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.byRep.map((r) => (
              <tr key={r.id} className={owner === r.id ? "mp-selected" : ""}>
                <th scope="row">
                  <button
                    className="pos-text-btn"
                    aria-pressed={owner === r.id}
                    onClick={() => onOwner(owner === r.id ? "all" : r.id)}
                  >
                    {r.id === "unassigned"
                      ? t(locale, "Sin asignar", "Unassigned")
                      : r.name}
                  </button>
                </th>
                {[
                  r.tasks,
                  r.p1,
                  r.offers,
                  r.unansweredBest,
                  r.live,
                  r.funded,
                  r.emails,
                  r.leadsOpen,
                ].map((value, i) => (
                  <td
                    key={i}
                    className={`mp-number ${i === 1 && value ? "mp-p1" : ""}`}
                  >
                    {number(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!b.byRep.length && (
        <p>
          {t(
            locale,
            "No hay asesores visibles en este ámbito.",
            "No visible reps in this scope.",
          )}
        </p>
      )}
    </section>
  );
}

function Stage({ row, locale }: { row: MasterRow; locale: Locale }) {
  return (
    <span className={`mp-stage mp-stage-${row.stage}`} title={row.sourceStage}>
      {t(locale, ...masterStageLabels[row.stage])}
      {row.stage === "unclassified" && row.sourceStage && (
        <small>
          CRM:{" "}
          {stageLabels[locale][row.sourceStage as CrmStage] || row.sourceStage}
        </small>
      )}
    </span>
  );
}
function Answer({
  value,
  locale,
}: {
  value: boolean | null | undefined;
  locale: Locale;
}) {
  return (
    <span className={value === false ? "mp-p1" : ""}>
      {value === true
        ? t(locale, "Respuesta registrada", "Reply recorded")
        : value === false
          ? t(locale, "Sin respuesta registrada", "No recorded reply")
          : t(locale, "Por verificar", "Not established")}
    </span>
  );
}
function Empty({ locale }: { locale: Locale }) {
  return (
    <div className="pos-empty">
      <Mail size={24} />
      <strong>
        {t(locale, "Sin registros en esta vista", "No records in this view")}
      </strong>
      <span>
        {t(
          locale,
          "Prueba otro asesor, período o búsqueda.",
          "Try another rep, period or search.",
        )}
      </span>
    </div>
  );
}

export function MasterRows({
  dashboard: b,
  locale,
  open,
  mail,
}: {
  dashboard: MasterDashboard;
  locale: Locale;
  open(id: string, section?: CaseSection): void;
  mail(row: MasterRow): void;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const tab = b.query.tab;
  const labels: Record<MasterTab, string[]> = {
    tasks: [
      "P",
      t(locale, "Asesor", "Rep"),
      t(locale, "Tarea", "Task"),
      t(locale, "Negocio / contacto", "Business / contact"),
      t(locale, "Qué dijeron", "What they said"),
      t(locale, "Vencimiento", "Due date"),
    ],
    offers: [
      t(locale, "Expediente", "File"),
      t(locale, "Asesor", "Rep"),
      t(locale, "Etapa", "Stage"),
      t(locale, "Mayor oferta vigente", "Highest active offer"),
      "Lender",
      t(locale, "Condiciones", "Terms"),
      t(locale, "Respuesta", "Reply"),
      t(locale, "Ofertas", "Offers"),
    ],
    pipeline: [
      t(locale, "Negocio", "Merchant"),
      t(locale, "Asesor", "Rep"),
      t(locale, "Etapa", "Stage"),
      t(locale, "Ofertas", "Offers"),
      t(locale, "Mayor oferta", "Highest offer"),
      "Lenders",
      t(locale, "Rechazos", "Declines"),
      t(locale, "Lender registrado", "Recorded lender"),
      t(locale, "Requisito registrado", "Recorded requirement"),
      t(locale, "Última actividad", "Last activity"),
      t(locale, "Sin actividad", "Quiet"),
    ],
    stats: [
      t(locale, "Fecha", "Date"),
      t(locale, "Asesor", "Rep"),
      t(locale, "Negocio", "Business"),
      t(locale, "Evento registrado", "Recorded milestone"),
    ],
    comms: [
      t(locale, "Fecha", "Date"),
      t(locale, "Asesor", "Rep"),
      t(locale, "Negocio / remitente", "Business / sender"),
      t(locale, "Dirección", "Direction"),
      t(locale, "Asunto / extracto", "Subject / excerpt"),
    ],
    leads: [
      t(locale, "Fecha", "Date"),
      t(locale, "Asesor", "Rep"),
      t(locale, "Negocio", "Business"),
      t(locale, "Interés registrado", "Recorded intent"),
      t(locale, "Qué dijeron", "What they said"),
      t(locale, "Correo", "Email"),
      t(locale, "Respuesta", "Answered"),
      t(locale, "Convertido", "Converted"),
    ],
  };
  const cells = (r: MasterRow): ReactNode[] => {
    if (tab === "tasks")
      return [
        <span className={`mp-priority mp-priority-${r.priority}`}>
          P{r.priority}
        </span>,
        r.ownerName,
        <strong>{r.title}</strong>,
        <>
          <b>{r.company}</b>
          <small>{r.contact}</small>
        </>,
        <span className="mp-excerpt">{r.excerpt || "—"}</span>,
        <>
          {date(r.at, locale)}
          {r.waitingDays !== null && r.waitingDays !== undefined && (
            <small>
              {r.waitingDays === 0
                ? t(locale, "Hoy", "Today")
                : `${r.waitingDays} ${t(locale, "días vencida", "days overdue")}`}
            </small>
          )}
        </>,
      ];
    if (tab === "offers")
      return [
        <strong>{r.company}</strong>,
        r.ownerName,
        <Stage row={r} locale={locale} />,
        r.best ? currency(r.best.amount, locale) : "—",
        r.best?.lender || "—",
        <>
          {r.best?.term || "—"}
          <small>
            {r.best?.cost} · {r.best?.frequency}
          </small>
        </>,
        <Answer value={r.best?.answered} locale={locale} />,
        <button
          className="pos-text-btn"
          aria-expanded={expanded.includes(r.id)}
          aria-controls={`master-offers-${r.id}`}
          onClick={() =>
            setExpanded((old) =>
              old.includes(r.id)
                ? old.filter((id) => id !== r.id)
                : [...old, r.id],
            )
          }
        >
          {number(r.offers?.length)} <ChevronDown size={12} />
        </button>,
      ];
    if (tab === "pipeline")
      return [
        <strong>{r.company}</strong>,
        r.ownerName,
        <Stage row={r} locale={locale} />,
        number(r.offers?.length),
        r.best ? currency(r.best.amount, locale) : "—",
        number(r.lenders),
        number(r.declines),
        r.fundedBy || "—",
        r.requirement || "—",
        date(r.at, locale),
        r.waitingDays === null ? "—" : `${r.waitingDays} d`,
      ];
    if (tab === "stats")
      return [
        date(r.at, locale),
        r.ownerName,
        <strong>{r.company}</strong>,
        milestoneLabels[r.title || ""]
          ? t(locale, ...milestoneLabels[r.title!])
          : r.title,
      ];
    if (tab === "comms")
      return [
        date(r.at, locale),
        r.ownerName,
        <>
          <strong>{r.company}</strong>
          <small>{r.email}</small>
        </>,
        r.direction === "inbound"
          ? t(locale, "Recibido", "Inbound")
          : t(locale, "Enviado / registrado", "Outbound / recorded"),
        <>
          <strong>{r.subject}</strong>
          <small className="mp-excerpt">
            {r.excerpt ||
              t(
                locale,
                "Abre el correo para consultar su contenido.",
                "Open the email to read its content.",
              )}
          </small>
        </>,
      ];
    return [
      date(r.at, locale),
      r.ownerName,
      <strong>{r.company}</strong>,
      r.intent === "positive"
        ? t(locale, "Positivo", "Positive")
        : t(locale, "Revisión pendiente", "Needs review"),
      <span className="mp-excerpt">{r.excerpt || r.subject || "—"}</span>,
      r.email,
      <Answer value={r.answered} locale={locale} />,
      r.converted ? t(locale, "Sí", "Yes") : t(locale, "No", "No"),
    ];
  };
  return (
    <section className="pos-card mp-data">
      <h3>{t(locale, ...masterTabLabels[tab])}</h3>
      {tab === "offers" && (
        <p className="pos-small pos-muted">
          {t(
            locale,
            "Mayor monto y oferta elegida son distintos. Revisa costo, plazo y requisitos antes de decidir.",
            "Highest amount and selected offer are different. Review cost, term and requirements before deciding.",
          )}
        </p>
      )}
      <div className="pos-scroll">
        <table className="pos-table">
          <thead>
            <tr>
              {[...labels[tab], t(locale, "Abrir", "Open")].map((h, i) => (
                <th key={i} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  {cells(r).map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                  <td>
                    <div className="pos-actions">
                      {r.caseId && (
                        <button
                          className="pos-btn pos-sm"
                          onClick={() =>
                            open(
                              r.caseId!,
                              tab === "offers" ? "lenders" : "activity",
                            )
                          }
                          aria-label={`${t(locale, "Abrir expediente", "Open file")} ${r.company}`}
                        >
                          <ArrowUpRight size={14} />
                          {t(locale, "Expediente", "File")}
                        </button>
                      )}
                      {(r.conversationId ||
                        r.archiveMessageId ||
                        r.messageId) && (
                        <button
                          className="pos-btn pos-sm"
                          onClick={() => mail(r)}
                          aria-label={t(locale, "Abrir correo", "Open email")}
                        >
                          <Mail size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {tab === "offers" && expanded.includes(r.id) && (
                  <tr id={`master-offers-${r.id}`}>
                    <td colSpan={labels[tab].length + 1}>
                      <div className="mp-offer-list">
                        {r.offers?.map((o) => (
                          <article key={o.id}>
                            <strong>
                              {o.lender} · {currency(o.amount, locale)}
                            </strong>
                            {o.selected && (
                              <span className="pos-pill pos-good">
                                {t(locale, "Elegida en CRM", "Selected in CRM")}
                              </span>
                            )}
                            <p>
                              {o.term} · {o.cost} · {o.frequency}
                            </p>
                            <p>
                              {o.fees ||
                                t(
                                  locale,
                                  "Comisiones no registradas",
                                  "Fees not recorded",
                                )}
                            </p>
                          </article>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!b.rows.length && <Empty locale={locale} />}
    </section>
  );
}

export function MasterStats({
  dashboard: b,
  locale,
  owner,
}: {
  dashboard: MasterDashboard;
  locale: Locale;
  owner: string;
}) {
  const reps = b.byRep.filter((r) => owner === "all" || r.id === owner);
  const graph = (kind: "applications" | "offers", label: string) => {
    const max = Math.max(1, ...b.daily.map((d) => d[kind]));
    return (
      <section className="pos-card mp-chart">
        <h3>{label}</h3>
        <p className="pos-small pos-muted">
          {t(
            locale,
            "Solo fechas registradas · UTC",
            "Recorded dates only · UTC",
          )}
        </p>
        {kind === "offers" && !b.coverage.financial ? (
          <p>
            {t(
              locale,
              "Sin acceso a datos de ofertas.",
              "Offer data is restricted.",
            )}
          </p>
        ) : (
          <>
            <div className="pos-scroll">
              <div
                className="mp-bars"
                role="img"
                aria-label={`${label}: ${b.daily.reduce((n, d) => n + d[kind], 0)}`}
                style={{
                  gridTemplateColumns: `repeat(${b.daily.length}, minmax(0, 1fr))`,
                }}
              >
                {b.daily.map((d, i) => (
                  <div key={d.day} title={`${d.day}: ${d[kind]}`}>
                    <span style={{ height: `${(d[kind] / max) * 100}%` }} />
                    {(i % Math.ceil(b.daily.length / 10) === 0 ||
                      i === b.daily.length - 1) && (
                      <small>{d.day.slice(8)}</small>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <details>
              <summary>
                {t(locale, "Ver datos del gráfico", "View chart data")}
              </summary>
              <table className="pos-table">
                <thead>
                  <tr>
                    <th scope="col">{t(locale, "Día", "Day")}</th>
                    <th scope="col">{label}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.daily.map((d) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      <td>{d[kind]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>
    );
  };
  return (
    <>
      <div className="mp-stats-grid">
        {graph(
          "applications",
          t(
            locale,
            "Aplicaciones recibidas por día",
            "New applications per day",
          ),
        )}
        {graph(
          "offers",
          t(locale, "Ofertas registradas por día", "Offers recorded per day"),
        )}
      </div>
      <section className="pos-card mp-results">
        <h3>
          {t(
            locale,
            "Resultados por asesor en el período",
            "Results by rep in the period",
          )}
        </h3>
        <div className="pos-scroll">
          <table className="pos-table">
            <thead>
              <tr>
                {[
                  t(locale, "Asesor", "Rep"),
                  t(locale, "Aplicaciones", "Applications"),
                  t(
                    locale,
                    "Casos con ofertas registradas",
                    "Files with recorded offers",
                  ),
                  t(locale, "Contratos enviados", "Contracts out"),
                  t(locale, "Firmados", "Signed"),
                  t(locale, "Desembolsos", "Fundings"),
                ].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.name}</th>
                  {[
                    r.applications,
                    r.offerFiles,
                    r.contractsOut,
                    r.signed,
                    r.fundings,
                  ].map((v, i) => (
                    <td key={i}>{number(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {b.coverage.undatedApplications > 0 && (
          <p className="pos-small pos-muted">
            {b.coverage.undatedApplications}{" "}
            {t(
              locale,
              "aplicaciones completas no tienen fecha de recepción acreditada y no se agregan a un día ficticio.",
              "complete applications have no evidenced receipt date and are not assigned to an invented day.",
            )}
          </p>
        )}
      </section>
    </>
  );
}

function ArchiveReader({
  id,
  locale,
  demo,
  close,
}: {
  id: string;
  locale: Locale;
  demo: boolean;
  close(): void;
}) {
  const [messages, setMessages] = useState<
      { archive_id: string; subject: string; body: string; sent_at: string }[]
    >([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [cursor, setCursor] = useState<{
      before: string;
      cursor: string;
    } | null>(null),
    [more, setMore] = useState(false),
    [page, setPage] = useState(0);
  const before = useRef<{ before: string; cursor: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (demo) {
      setMessages([
        {
          archive_id: id,
          subject: "Correo de demostración",
          body: "Datos ficticios. Esta vista no consulta proveedores.",
          sent_at: new Date().toISOString(),
        },
      ]);
      setLoading(false);
      return () => controller.abort();
    }
    const suffix = before.current
      ? "?" + new URLSearchParams(before.current).toString()
      : "";
    void fetch(`/api/gmail/archive/${encodeURIComponent(id)}/thread${suffix}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok)
          throw Error(
            typeof body.error === "string"
              ? body.error
              : "No se pudo leer el hilo / Could not read thread",
          );
        if (!controller.signal.aborted) {
          setMessages((old) =>
            page ? [...body.messages, ...old] : body.messages,
          );
          setMore(body.hasMore);
          setCursor(body.cursor);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(safeError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, page, demo]);
  return (
    <Modal
      title={t(
        locale,
        "Correo registrado · solo lectura",
        "Recorded email · read only",
      )}
      locale={locale}
      close={close}
      wide
    >
      <div className="mp-reader">
        {loading && (
          <p role="status">{t(locale, "Cargando correo…", "Loading email…")}</p>
        )}
        {error && <p role="alert">{error}</p>}
        {more && (
          <button
            className="pos-btn"
            disabled={loading}
            onClick={() => {
              before.current = cursor;
              setPage((p) => p + 1);
            }}
          >
            {t(locale, "Cargar anteriores", "Load older messages")}
          </button>
        )}
        {messages.map((m) => (
          <article key={m.archive_id}>
            <h3>{m.subject}</h3>
            <time>{date(m.sent_at, locale)}</time>
            <pre>{readableMail(m.body).text.slice(0, 50000)}</pre>
          </article>
        ))}
      </div>
    </Modal>
  );
}
