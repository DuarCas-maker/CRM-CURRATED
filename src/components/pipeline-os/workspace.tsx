"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  ChevronRight,
  CircleCheck,
  FileText,
  Filter,
  Folder,
  GitBranch,
  HeartHandshake,
  Home,
  Landmark,
  ListChecks,
  Mail,
  Megaphone,
  Moon,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import type { Campaign, Locale, Workspace } from "@/lib/domain";
import { currency, dateLabel, isSellerRole } from "@/lib/domain";
import { demoAction } from "@/lib/demo-actions";
import {
  buildPipelineBoard,
  pipelineLabel,
  pipelineStages,
  type PipelineBoard,
  type PipelineGroup,
  type PipelineProcess,
} from "@/lib/pipeline-os/module";
import type { Action } from "../crm";
import type { EmailTemplate } from "@/lib/campaign-templates";
import { Modal, t } from "../ui";
import { useLeaveConfirmation } from "../unsaved-changes";
import { OpportunityDetail } from "../opportunity-detail";
import { PipelineMailReview } from "./mail-review";
import { PipelineCaseProgress } from "./case-progress";
import { ConversationsWorkspace } from "../conversations-workspace";
import { CampaignCenterWorkspace } from "../campaign-center";
import { CampaignImportFlow } from "./campaign-import-flow";
import { CampaignReview } from "../campaign-review";
import { ImportWizard } from "../import-wizard";
import { LenderDirectory } from "../lender-directory";
import { LenderForm } from "../lender-form";
import { LenderGuidelinesEditor } from "../lender-management";
import {
  PipelineTable,
  PipelineStats,
  PipelineUpdates,
  type CaseSection,
} from "./board";
import { PipelineLeads } from "./leads";
import { MasterPipeline } from "./master-pipeline";
import "./workspace.css";

type Page =
  | "master"
  | "tasks"
  | "app"
  | "need"
  | "offers"
  | "docsout"
  | "signed"
  | "campaigns"
  | "scrub"
  | "build"
  | "stats"
  | "files"
  | "clients"
  | "conversations"
  | "updates"
  | "recap"
  | "lenders"
  | "settings";
const pageNames: Record<Page, [string, string]> = {
  master: ["Master Pipeline", "Master Pipeline"],
  tasks: ["Tareas abiertas", "Open tasks"],
  app: ["Aplicación pendiente", "App needed"],
  need: ["Oferta pendiente", "Offer needed"],
  offers: ["Ofertas", "Offers"],
  docsout: ["Contratos enviados", "Docs out"],
  signed: ["Contratos firmados", "Docs signed"],
  campaigns: ["Campañas", "Campaigns"],
  scrub: ["Preparar leads", "Scrub leads"],
  build: ["Crear campaña", "Build campaign"],
  stats: ["Indicadores", "Stats"],
  files: ["Expedientes", "Files"],
  clients: ["Clientes", "Clients"],
  conversations: ["Conversaciones", "Conversations"],
  updates: ["Updates", "Updates"],
  recap: ["Resumen del día", "Daily recap"],
  lenders: ["Directorio de lenders", "Lender directory"],
  settings: ["Parámetros", "Settings"],
};
const isGroup = (value: string): value is PipelineGroup =>
  ["tasks", ...pipelineStages, "files", "clients"].includes(value);
const noProcesses: PipelineProcess[] = [];

export function PipelineOSWorkspace({
  initial,
  initialBoard,
  processes = noProcesses,
}: {
  initial: Workspace;
  initialBoard: PipelineBoard;
  processes?: PipelineProcess[];
}) {
  const [data, setData] = useState(initial),
    [board, setBoard] = useState(initialBoard);
  const [locale, setLocale] = useState<Locale>(initial.preferences.locale);
  const [ready, setReady] = useState(false);
  const [path, setPath] = useState<Page[]>([]),
    [tree, setTree] = useState(false),
    [dark, setDark] = useState(false);
  const [query, setQuery] = useState(""),
    [owner, setOwner] = useState("all"),
    [page, setPage] = useState(0),
    [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [caseId, setCaseId] = useState<string | null>(null),
    [caseData, setCaseData] = useState<Workspace | null>(null),
    [caseLoading, setCaseLoading] = useState(false);
  const [caseSection, setCaseSection] = useState<CaseSection>("activity");
  const caseContent = useRef<HTMLDivElement>(null);
  const [mailCase, setMailCase] = useState<string | undefined>(),
    [mailThread, setMailThread] = useState<string | undefined>();
  const [importing, setImporting] = useState(false),
    [composer, setComposer] = useState<{
      template: EmailTemplate | null;
    } | null>(null);
  const [review, setReview] = useState<Campaign | null>(null),
    [lender, setLender] = useState<string | null>(null),
    [guideline, setGuideline] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>()),
    acting = useRef(false),
    caseRequest = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { requestLeave, confirmation } = useLeaveConfirmation(locale);
  const current = path.at(-1),
    group: PipelineGroup = current && isGroup(current) ? current : "files";
  const params = new URLSearchParams({
    q: query,
    owner,
    group,
    page: String(page),
    hours: String(hours),
  }).toString();
  const [boardKey, setBoardKey] = useState(params);
  const boardReady = data.demo || boardKey === params;
  const l = (p: Page) => pageNames[p][locale === "es" ? 0 : 1];
  const manageCampaigns = ["superadmin", "seller_admin"].includes(
    data.profile.role,
  );
  const manageLenders = ["superadmin", "closer_admin"].includes(
    data.profile.role,
  );
  const crmHref = data.demo ? "/demo" : "/";

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pipeline-os-ui") || "{}");
      setTree(saved.tree === true);
      setDark(saved.dark === true);
    } catch {}
    if (new URLSearchParams(window.location.search).get("view") === "master") {
      setPath(["master"]);
    }
    setReady(true);
  }, []);
  function appearance(nextTree: boolean, nextDark: boolean) {
    setTree(nextTree);
    setDark(nextDark);
    try {
      localStorage.setItem(
        "pipeline-os-ui",
        JSON.stringify({ tree: nextTree, dark: nextDark }),
      );
    } catch {}
  }
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => () => caseRequest.current?.abort(), []);
  useEffect(() => {
    if (initial.demo) {
      setBoard(
        buildPipelineBoard(data, processes, {
          q: query,
          owner,
          group,
          page,
          hours,
        }),
      );
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/pipeline-os?${params}`, {
          signal: abort.signal,
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        if (!abort.signal.aborted) {
          setBoard(body);
          setBoardKey(params);
        }
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [params, initial.demo, data, processes, query, owner, group, page, hours]);

  async function readWorkspace(id?: string) {
    const res = await fetch(
      `/api/workspace?${new URLSearchParams({ view: "pipeline", ...(id ? { case: id } : {}) })}`,
      { cache: "no-store" },
    );
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    return body as Workspace;
  }
  async function refresh() {
    if (data.demo) {
      setBoard(
        buildPipelineBoard(data, processes, {
          q: query,
          owner,
          group,
          page,
          hours,
        }),
      );
      return;
    }
    const result = await Promise.all([
      fetch(`/api/pipeline-os?${params}`, { cache: "no-store" }).then(
        async (r) => {
          const b = await r.json();
          if (!r.ok) throw new Error(b.error);
          return b as PipelineBoard;
        },
      ),
      readWorkspace(),
      caseId ? readWorkspace(caseId) : Promise.resolve(null),
    ]);
    setBoard(result[0]);
    setBoardKey(params);
    setData(result[1]);
    if (result[2]) setCaseData(result[2]);
  }
  async function manualRefresh() {
    setLoading(true);
    setError("");
    try {
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const act: Action = async (kind, payload) => {
    if (acting.current)
      throw new Error(
        t(locale, "Hay una operación en curso", "An operation is in progress"),
      );
    acting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (data.demo) {
        const next = demoAction(data, data.profile, kind, payload);
        setData(next);
        if (caseId) setCaseData(next);
        setNotice(
          t(locale, "Cambio aplicado en la demo", "Change applied in the demo"),
        );
        return kind === "add_document"
          ? {
              document_id: next.documents.find(
                (d) => !data.documents.some((old) => old.id === d.id),
              )?.id,
            }
          : undefined;
      }
      const normalized = Object.fromEntries(
        Object.entries(payload).map(([k, v]) => [
          k,
          typeof v === "string" &&
          k.endsWith("_at") &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)
            ? new Date(v).toISOString()
            : v,
        ]),
      );
      const fingerprint = JSON.stringify({ kind, payload: normalized });
      const key = keys.current.get(fingerprint) || crypto.randomUUID();
      keys.current.set(fingerprint, key);
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          payload: normalized,
          idempotency_key: key,
        }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(
          body.error ||
            t(
              locale,
              "No se pudo completar la acción",
              "Could not complete the action",
            ),
        );
      // A confirmed command must not become a failed send just because the following GET failed.
      keys.current.delete(fingerprint);
      setNotice(
        [
          "compose_email",
          "compose_lenders",
          "reply",
          "lender_reply",
          "mail_send",
        ].includes(kind)
          ? t(
              locale,
              "Correo en cola. Revisa su estado en Conversaciones.",
              "Email queued. Check its status in Conversations.",
            )
          : t(locale, "Cambios guardados", "Changes saved"),
      );
      try {
        await refresh();
      } catch {
        setError(
          t(
            locale,
            "La acción se guardó; no se pudo actualizar la vista. Actualiza sin repetir el envío.",
            "The action was saved; refreshing failed. Refresh without repeating the send.",
          ),
        );
      }
      return body.result ?? body;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  function go(next: Page[]) {
    if (acting.current) return;
    requestLeave(() => {
      setPath(next);
      setPage(0);
      setNotice("");
      requestAnimationFrame(() =>
        root.current
          ?.querySelector(`[data-pos-level="${next.length}"]`)
          ?.scrollIntoView({
            block: "start",
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
          }),
      );
    });
  }
  function push(next: Page, level: number) {
    go([...path.slice(0, level), next]);
  }
  function open(id: string, section: CaseSection = "activity") {
    if (acting.current) return;
    requestLeave(() => {
      caseRequest.current?.abort();
      setCaseId(id);
      setCaseSection(section);
      setCaseData(null);
      setError("");
      if (data.demo) {
        setCaseData(data);
        return;
      }
      const abort = new AbortController();
      caseRequest.current = abort;
      setCaseLoading(true);
      void fetch(
        `/api/workspace?${new URLSearchParams({ case: id, view: "pipeline" })}`,
        { signal: abort.signal, cache: "no-store" },
      )
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok) throw new Error(b.error);
          if (!b.opportunities?.some((o: { id: string }) => o.id === id))
            throw new Error(
              t(
                locale,
                "Expediente no disponible para este usuario",
                "File not available to this user",
              ),
            );
          if (!abort.signal.aborted) setCaseData(b);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setCaseLoading(false);
        });
    });
  }
  function closeCase() {
    caseRequest.current?.abort();
    setCaseId(null);
    setCaseData(null);
    setCaseLoading(false);
  }
  function mail(id?: string, conversation?: string) {
    setMailCase(id);
    setMailThread(conversation);
    go(["conversations"]);
  }
  function changeOwner(id: string) {
    setOwner(id);
    setPage(0);
  }
  function create(template?: EmailTemplate) {
    setComposer({ template: template || null });
    go(["campaigns", "build"]);
  }
  async function saveLender(
    e: FormEvent<HTMLFormElement>,
    extras: Record<string, unknown>,
  ) {
    e.preventDefault();
    await act(lender === "new" ? "create_lender" : "update_lender", {
      ...extras,
      ...(lender !== "new" ? { id: lender } : {}),
    });
    setLender(null);
  }
  function complete(id: string) {
    void act("complete_task", { id }).catch(() => {});
  }
  const rowOpen = (id: string, section?: CaseSection) => open(id, section);

  function tile(
    icon: typeof Home,
    title: string,
    desc: string,
    value: string | number,
    unit: string,
    target: Page,
    level: number,
  ) {
    const Icon = icon;
    return (
      <button
        className={`pos-tile ${path[level] === target ? "pos-chosen" : ""}`}
        onClick={() => push(target, level)}
      >
        <span className="pos-tile-icon">
          <Icon size={22} />
        </span>
        <span className="pos-tile-title">
          {title}
          <ArrowUpRight size={16} />
        </span>
        <span className="pos-tile-description">{desc}</span>
        <span className="pos-tile-number">
          {value}
          <small>{unit}</small>
        </span>
      </button>
    );
  }
  function stageStrip() {
    return (
      <div className="pos-stage-strip">
        {pipelineStages.map((g) => (
          <button
            key={g}
            className={current === g ? "pos-chosen" : ""}
            onClick={() => go(["tasks", g])}
          >
            <b>{board.counts[g]}</b>
            <span>{pipelineLabel(g, locale)}</span>
          </button>
        ))}
      </div>
    );
  }
  function filters() {
    return (
      <div className="pos-filters">
        <span>
          <Filter size={14} />
          {t(locale, "Filtrar", "Filter")}
        </span>
        <label>
          <span className="pos-sr-only">{t(locale, "Responsable", "Rep")}</span>
          <select
            value={owner}
            disabled={busy}
            onChange={(e) => changeOwner(e.target.value)}
          >
            <option value="all">
              {t(locale, "Todos los responsables", "All reps")}
            </option>
            {data.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {(query || owner !== "all") && (
          <button
            className="pos-text-btn"
            onClick={() => {
              setQuery("");
              setOwner("all");
              setPage(0);
            }}
          >
            {t(locale, "Limpiar filtros", "Clear filters")}
            <X size={13} />
          </button>
        )}
        <span className="pos-small pos-muted pos-filter-end">
          {t(locale, "CRM · observado", "CRM · observed")}{" "}
          {dateLabel(board.asOf, locale, true)}
        </span>
      </div>
    );
  }
  function pagination() {
    return (
      <div className="pos-pagination">
        <span>
          {board.total
            ? `${page * 50 + 1}–${Math.min((page + 1) * 50, board.total)} / ${board.total}`
            : `0 / 0`}
        </span>
        <button
          className="pos-btn pos-sm"
          disabled={!page || loading || busy}
          onClick={() => setPage((p) => p - 1)}
        >
          {t(locale, "Anterior", "Previous")}
        </button>
        <button
          className="pos-btn pos-sm"
          disabled={!board.hasMore || loading || busy}
          onClick={() => setPage((p) => p + 1)}
        >
          {t(locale, "Siguiente", "Next")}
        </button>
      </div>
    );
  }
  function pageBody(p: Page, level: number) {
    if (p === "master")
      return (
        <MasterPipeline
          data={data}
          processes={processes}
          locale={locale}
          search={query}
          owner={owner}
          onOwner={changeOwner}
          open={rowOpen}
          mail={mail}
        />
      );
    if (
      !boardReady &&
      (isGroup(p) || ["stats", "updates", "recap"].includes(p))
    )
      return (
        <>
          {filters()}
          <div className="pos-card pos-empty" role="status">
            {error
              ? t(
                  locale,
                  "No se pudo cargar esta vista. Reintenta la lectura.",
                  "Could not load this view. Retry the read.",
                )
              : t(
                  locale,
                  "Cargando la vista con los filtros seleccionados…",
                  "Loading the view with the selected filters…",
                )}
          </div>
        </>
      );
    if (p === "tasks")
      return (
        <>
          {stageStrip()}
          <div className="pos-tiles">
            {tile(
              FileText,
              l("app"),
              t(
                locale,
                "Aplicación y documentación por completar",
                "Application and documents to complete",
              ),
              board.counts.app,
              t(locale, "expedientes", "files"),
              "app",
              level,
            )}
            {tile(
              Landmark,
              l("need"),
              t(
                locale,
                "Revisar UW y buscar financiación",
                "Review UW and find financing",
              ),
              board.counts.need,
              t(locale, "expedientes", "files"),
              "need",
              level,
            )}
            {tile(
              Sparkles,
              l("offers"),
              t(
                locale,
                "Comparar y presentar opciones",
                "Compare and present options",
              ),
              board.counts.offers,
              t(locale, "expedientes", "files"),
              "offers",
              level,
            )}
            {tile(
              Send,
              l("docsout"),
              t(
                locale,
                "Contratos enviados con evidencia",
                "Contracts sent with evidence",
              ),
              board.counts.docsout,
              t(locale, "expedientes", "files"),
              "docsout",
              level,
            )}
            {tile(
              CircleCheck,
              l("signed"),
              t(
                locale,
                "Firma confirmada, preparar fondeo",
                "Signature confirmed, prepare funding",
              ),
              board.counts.signed,
              t(locale, "expedientes", "files"),
              "signed",
              level,
            )}
          </div>
        </>
      );
    if (isGroup(p))
      return (
        <>
          {pipelineStages.includes(p as (typeof pipelineStages)[number]) &&
            stageStrip()}
          {filters()}
          <PipelineTable
            board={board}
            group={p}
            locale={locale}
            open={rowOpen}
            mail={mail}
            complete={complete}
            busy={busy}
          />
          {pagination()}
          {p === "clients" && (
            <div className="pos-info">
              <HeartHandshake size={17} />
              <span>
                {t(
                  locale,
                  "Las renovaciones y el porcentaje pagado se registran con evidencia en el expediente. Los recordatorios son tareas internas; no se envían campañas de fidelización automáticamente.",
                  "Record renewals and paid percentage with evidence in the file. Reminders are internal tasks; loyalty campaigns are not sent automatically.",
                )}
              </span>
            </div>
          )}
        </>
      );
    if (p === "updates" || p === "recap")
      return (
        <>
          {filters()}
          <div className="pos-row pos-report-controls">
            <label>
              {t(locale, "Ventana del reporte", "Report window")}{" "}
              <select
                value={hours}
                onChange={(e) => {
                  setHours(Number(e.target.value));
                  setPage(0);
                }}
              >
                {[24, 48, 168, 720].map((h) => (
                  <option key={h} value={h}>
                    {h < 72
                      ? `${h} h`
                      : `${h / 24} ${t(locale, "días", "days")}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="pos-btn pos-sm"
              onClick={() => void manualRefresh()}
              disabled={loading || busy}
            >
              <RefreshCw size={14} />
              {t(locale, "Actualizar reporte", "Refresh report")}
            </button>
          </div>
          <PipelineUpdates
            board={board}
            locale={locale}
            open={rowOpen}
            mode={p}
          />
        </>
      );
    if (p === "stats")
      return (
        <>
          {filters()}
          <div className="pos-metrics">
            <Metric
              label={t(locale, "Expedientes activos", "Active files")}
              value={board.summary.active}
            />
            <Metric
              label={t(locale, "Urgentes", "Urgent")}
              value={board.summary.urgent}
            />
            <Metric
              label={t(locale, "Ofertas vigentes", "Active offers")}
              value={board.summary.offers ?? "—"}
            />
            <Metric
              label={t(locale, "Fondeado registrado", "Recorded funding")}
              value={
                board.summary.fundedAmount === null
                  ? "—"
                  : currency(board.summary.fundedAmount, locale)
              }
            />
          </div>
          <PipelineStats board={board} locale={locale} owner={changeOwner} />
        </>
      );
    if (p === "campaigns")
      return (
        <>
          <div className="pos-card">
            <h2>
              {t(
                locale,
                "Crear campañas desde tu Excel",
                "Create campaigns from your spreadsheet",
              )}
            </h2>
            <p className="pos-muted">
              {t(
                locale,
                "Carga tu base, revisa la clasificación de Bouncer y activa el correo cuando estés listo. Después sigue los envíos y las respuestas aquí.",
                "Upload your list, review Bouncer classification and activate when ready. Then track sends and replies here.",
              )}
            </p>
          </div>
          <div className="pos-row pos-module-actions">
            {isSellerRole(data.profile.role) && (
              <button className="pos-btn" onClick={() => push("scrub", level)}>
                <Filter size={15} />
                {l("scrub")}
              </button>
            )}
            {manageCampaigns && (
              <button className="pos-btn pos-primary" onClick={() => create()}>
                <Megaphone size={15} />
                {l("build")}
              </button>
            )}
          </div>
          <div className="pos-existing">
            <CampaignCenterWorkspace
              data={data}
              locale={locale}
              act={act}
              changed={refresh}
              create={create}
              review={setReview}
              openConversation={mail}
            />
          </div>
        </>
      );
    if (p === "scrub")
      return (
        <PipelineLeads
          data={data}
          locale={locale}
          act={act}
          busy={busy}
          importing={() => setImporting(true)}
          open={rowOpen}
        />
      );
    if (p === "build")
      return (
        <CampaignImportFlow
          data={data}
          locale={locale}
          act={act}
          refresh={refresh}
          initialTemplate={composer?.template || null}
          close={() => {
            setComposer(null);
            go(["campaigns"]);
          }}
        />
      );
    if (p === "conversations")
      return (
        <div className="pos-existing pos-mail-module">
          <ConversationsWorkspace
            key={`${mailCase || "all"}:${mailThread || ""}`}
            data={data}
            locale={locale}
            act={act}
            busy={busy}
            initialCaseId={mailCase}
            initialConversationId={mailThread}
            openCase={(id) => open(id)}
          />
        </div>
      );
    if (p === "lenders")
      return (
        <div className="pos-existing">
          <LenderDirectory
            data={data}
            locale={locale}
            canEdit={manageLenders}
            edit={setLender}
            guidelines={setGuideline}
          >
            {manageLenders && (
              <button
                className="pos-btn pos-primary"
                onClick={() => setLender("new")}
              >
                <Landmark size={15} />
                {t(locale, "Nuevo lender", "New lender")}
              </button>
            )}
          </LenderDirectory>
        </div>
      );
    return (
      <div className="pos-grid2">
        <section className="pos-card">
          <h3>
            <Settings size={17} />
            {t(locale, "Parámetros vigentes", "Current settings")}
          </h3>
          <dl className="pos-settings">
            <dt>{t(locale, "Idioma de esta vista", "View language")}</dt>
            <dd>
              <select
                aria-label={t(locale, "Idioma", "Language")}
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </dd>
            <dt>{t(locale, "Apariencia", "Appearance")}</dt>
            <dd>
              <button
                className="pos-btn pos-sm"
                onClick={() => appearance(tree, !dark)}
              >
                {dark
                  ? t(locale, "Oscuro", "Dark")
                  : t(locale, "Claro", "Light")}
              </button>
            </dd>
            <dt>{t(locale, "Envíos", "Sending")}</dt>
            <dd>
              {t(
                locale,
                "Aprobación humana · envío separado por lender",
                "Human approval · separate send per lender",
              )}
            </dd>
            <dt>{t(locale, "Bajas", "Opt-outs")}</dt>
            <dd>
              {t(
                locale,
                "Globales · todas las marcas y canales",
                "Global · all brands and channels",
              )}
            </dd>
          </dl>
        </section>
        <section className="pos-card">
          <h3>
            <ShieldCheck size={17} />
            {t(locale, "Cuentas y límites", "Accounts and limits")}
          </h3>
          <p className="pos-muted">
            {t(
              locale,
              "Las cuentas y proveedores se administran en Conexiones. Los roles y las marcas permanecen en Configuración del CRM.",
              "Manage accounts and providers in Connections. Roles and brands remain in CRM Settings.",
            )}
          </p>
          <button
            className="pos-btn"
            onClick={() =>
              requestLeave(() =>
                window.location.assign(
                  `${crmHref}${crmHref.includes("?") ? "&" : "?"}module=connections`,
                ),
              )
            }
          >
            {t(locale, "Abrir Conexiones", "Open Connections")}
            <ArrowUpRight size={14} />
          </button>
        </section>
      </div>
    );
  }

  const nav = [
    { id: "master" as Page, icon: BarChart3 },
    { id: "tasks" as Page, icon: ListChecks },
    { id: "campaigns" as Page, icon: Megaphone },
    { id: "conversations" as Page, icon: Mail },
    { id: "stats" as Page, icon: BarChart3 },
    { id: "files" as Page, icon: Folder },
    { id: "clients" as Page, icon: HeartHandshake },
  ];
  return (
    <div
      className="pipeline-os"
      data-pos-theme={dark ? "dark" : "light"}
      ref={root}
    >
      <a className="pos-skip" href="#pos-main">
        {t(locale, "Ir al contenido", "Skip to content")}
      </a>
      <header className="pos-top">
        <button className="pos-brand" onClick={() => go([])}>
          <span className="pos-mark">P</span>
          <span>
            <b>Pipeline OS</b>
            <small>Curated Financial</small>
          </span>
        </button>
        {data.demo && (
          <span className="pos-demo">
            {t(locale, "Demo · datos ficticios", "Demo · sample data")}
          </span>
        )}
        <div className="pos-search">
          <Search size={16} />
          <input
            type="search"
            aria-label={t(locale, "Buscar expedientes", "Search files")}
            placeholder={t(
              locale,
              "Buscar negocio, contacto o lender…",
              "Search business, contact or lender…",
            )}
            value={query}
            disabled={busy || !ready}
            maxLength={200}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
              if (current !== "master" && (!current || !isGroup(current)))
                setPath(["files"]);
            }}
          />
        </div>
        <button
          className={`pos-btn pos-sm ${tree ? "pos-chosen" : ""}`}
          aria-expanded={tree}
          aria-controls="pos-tree"
          onClick={() => appearance(!tree, dark)}
        >
          <GitBranch size={15} />
          <span>{t(locale, "Árbol", "Tree")}</span>
        </button>
        <button
          className="pos-icon-btn"
          onClick={() => appearance(tree, !dark)}
          aria-label={t(locale, "Cambiar tema", "Toggle theme")}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          className="pos-icon-btn"
          disabled={loading || busy}
          onClick={() => void manualRefresh()}
          aria-label={t(locale, "Actualizar datos", "Refresh data")}
        >
          <RefreshCw size={17} className={loading ? "pos-spin" : ""} />
        </button>
        <button
          className="pos-btn pos-sm pos-return"
          onClick={() => requestLeave(() => window.location.assign(crmHref))}
        >
          <ArrowLeft size={14} />
          CRM
        </button>
      </header>
      <div className={`pos-shell ${tree ? "pos-tree-open" : ""}`}>
        {tree && (
          <aside id="pos-tree" className="pos-side">
            <div className="pos-caption">
              {t(locale, "TU OPERACIÓN", "YOUR WORKSPACE")}
            </div>
            <nav
              aria-label={t(locale, "Árbol de navegación", "Navigation tree")}
            >
              <button
                className={`pos-node ${!current ? "pos-chosen" : ""}`}
                onClick={() => go([])}
              >
                <Home size={15} />
                {t(locale, "Inicio", "Home")}
              </button>
              {nav.map(({ id, icon: Icon }) =>
                id === "tasks" || id === "campaigns" ? (
                  <details key={id} open>
                    <summary>
                      <Icon size={15} />
                      {l(id)}
                      <span>
                        {id === "tasks"
                          ? board.counts.tasks
                          : board.campaigns.total}
                      </span>
                    </summary>
                    <button
                      className={`pos-node ${current === id ? "pos-chosen" : ""}`}
                      onClick={() => go([id])}
                    >
                      {t(locale, "Ver todo", "View all")}
                      <ChevronRight size={13} />
                    </button>
                    <div className="pos-tree-children">
                      {(id === "tasks"
                        ? pipelineStages
                        : isSellerRole(data.profile.role)
                          ? (["scrub", "build"] as const)
                          : (["build"] as const)
                      ).map((p) => (
                        <button
                          className={`pos-node ${current === p ? "pos-chosen" : ""}`}
                          key={p}
                          onClick={() => go([id, p])}
                        >
                          {l(p)}
                          {isGroup(p) && <span>{board.counts[p]}</span>}
                        </button>
                      ))}
                    </div>
                  </details>
                ) : (
                  <button
                    key={id}
                    className={`pos-node ${current === id ? "pos-chosen" : ""}`}
                    onClick={() => (id === "conversations" ? mail() : go([id]))}
                  >
                    <Icon size={15} />
                    {l(id)}
                    {isGroup(id) && <span>{board.counts[id]}</span>}
                  </button>
                ),
              )}
              <div className="pos-tree-divider" />
              {(["updates", "lenders", "settings"] as Page[]).map((p) => (
                <button
                  className={`pos-node ${current === p ? "pos-chosen" : ""}`}
                  key={p}
                  onClick={() => go([p])}
                >
                  {p === "updates" ? (
                    <Bell size={15} />
                  ) : p === "lenders" ? (
                    <Landmark size={15} />
                  ) : (
                    <Settings size={15} />
                  )}{" "}
                  {l(p)}
                </button>
              ))}
            </nav>
            <div className="pos-side-note">
              <ShieldCheck size={16} />
              {t(
                locale,
                "Revisión humana antes de enviar",
                "Human review before sending",
              )}
            </div>
          </aside>
        )}
        <main id="pos-main" className="pos-main" aria-busy={loading}>
          <nav
            className="pos-crumbs"
            aria-label={t(locale, "Ruta actual", "Breadcrumb")}
          >
            <button onClick={() => go([])}>
              {t(locale, "Inicio", "Home")}
            </button>
            {path.map((p, i) => (
              <FragmentCrumb
                key={i}
                label={l(p)}
                current={i === path.length - 1}
                click={() => go(path.slice(0, i + 1))}
              />
            ))}
          </nav>
          {error && (
            <div className="pos-alert" role="alert">
              <span>{error}</span>
              <button
                className="pos-text-btn"
                onClick={() => void manualRefresh()}
              >
                {t(locale, "Reintentar lectura", "Retry read")}
              </button>
              <button
                className="pos-icon-btn"
                onClick={() => setError("")}
                aria-label={t(locale, "Cerrar error", "Dismiss error")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="pos-notice" role="status">
              {notice}
            </div>
          )}
          <section data-pos-level="0" className="pos-home">
            <div className="pos-heading">
              <div>
                <div className="pos-caption">
                  {t(
                    locale,
                    "TU DÍA, EN PERSPECTIVA",
                    "YOUR DAY, IN PERSPECTIVE",
                  )}
                </div>
                <h1>
                  {t(
                    locale,
                    "Tu operación, en un solo lugar.",
                    "Your operation, in one place.",
                  )}
                </h1>
                <p className="pos-subtitle">
                  <time dateTime={board.asOf}>
                    {ready
                      ? new Intl.DateTimeFormat(
                          locale === "es" ? "es-CO" : "en-US",
                          { weekday: "long", month: "long", day: "numeric" },
                        ).format(new Date(board.asOf))
                      : "—"}
                  </time>{" "}
                  ·{" "}
                  {t(
                    locale,
                    "Cada negocio. Cada conversación. El siguiente paso.",
                    "Every business. Every conversation. The next step.",
                  )}
                </p>
              </div>
              <button
                className="pos-btn pos-primary"
                onClick={() => go(["updates"])}
              >
                <Sparkles size={15} />
                Updates
              </button>
            </div>
            <div className="pos-tiles">
              {tile(
                BarChart3,
                l("master"),
                t(
                  locale,
                  "Por asesor: tareas, ofertas, pipeline y resultados",
                  "By rep: tasks, offers, pipeline and results",
                ),
                board.counts.files,
                t(locale, "expedientes visibles", "visible files"),
                "master",
                0,
              )}
              {tile(
                ListChecks,
                l("tasks"),
                t(
                  locale,
                  "De la aplicación al contrato firmado",
                  "From application through signed contracts",
                ),
                board.counts.tasks,
                t(locale, "expedientes activos", "active files"),
                "tasks",
                0,
              )}
              {tile(
                Megaphone,
                l("campaigns"),
                t(
                  locale,
                  "Marcas, audiencias y seguimiento",
                  "Brands, audiences and follow-up",
                ),
                board.campaigns.active + board.campaigns.scheduled,
                t(locale, "activas / programadas", "active / scheduled"),
                "campaigns",
                0,
              )}
              {tile(
                BarChart3,
                l("stats"),
                t(
                  locale,
                  "Actividad, ofertas y resultados",
                  "Activity, offers and results",
                ),
                board.summary.fundedAmount === null
                  ? "—"
                  : currency(board.summary.fundedAmount, locale),
                t(locale, "fondeo registrado", "recorded funding"),
                "stats",
                0,
              )}
              {tile(
                Folder,
                l("files"),
                t(
                  locale,
                  "Un expediente, todo su historial",
                  "One file, its complete history",
                ),
                board.counts.files,
                t(locale, "negocios", "businesses"),
                "files",
                0,
              )}
              {tile(
                HeartHandshake,
                l("clients"),
                t(
                  locale,
                  "Relación, tareas y renovaciones",
                  "Relationships, tasks and renewals",
                ),
                board.counts.clients,
                t(locale, "clientes fondeados", "funded clients"),
                "clients",
                0,
              )}
            </div>
            {!current && (
              <div className="pos-home-bottom">
                <section className="pos-card">
                  <div className="pos-card-head">
                    <h2>
                      {t(locale, "Para avanzar hoy", "Move forward today")}
                    </h2>
                    <button
                      className="pos-text-btn"
                      onClick={() => go(["recap"])}
                    >
                      {t(locale, "Ver resumen", "View recap")}
                      <ArrowUpRight size={13} />
                    </button>
                  </div>
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
                            t(
                              locale,
                              "Revisar próximo paso",
                              "Review next step",
                            )}
                        </span>
                      </span>
                      <span className={`pos-pill pos-p${r.priority}`}>
                        P{r.priority}
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                  {!board.priorities.length && (
                    <div className="pos-empty">
                      <CircleCheck size={22} />
                      {t(
                        locale,
                        "Sin acciones pendientes en esta vista",
                        "No pending actions in this view",
                      )}
                    </div>
                  )}
                </section>
                <section className="pos-home-callout">
                  <Mail size={24} />
                  <h2>
                    {t(
                      locale,
                      "La conversación sigue aquí.",
                      "Keep the conversation going.",
                    )}
                  </h2>
                  <p>
                    {t(
                      locale,
                      "Clientes, equipo y lenders con el historial completo del expediente.",
                      "Customers, team and lenders with the file's full conversation history.",
                    )}
                  </p>
                  <button className="pos-btn" onClick={() => mail()}>
                    {l("conversations")}
                    <ArrowUpRight size={14} />
                  </button>
                </section>
              </div>
            )}
          </section>
          {path.map((p, i) => (
            <section
              className="pos-level"
              data-pos-level={i + 1}
              key={`${i}:${p}`}
            >
              <div className="pos-level-label">
                <ChevronRight size={13} />
                {t(locale, "Nivel", "Level")} {i + 1} · {l(p)}
              </div>
              <h2>{l(p)}</h2>
              <p className="pos-subtitle">
                {p === "conversations"
                  ? t(
                      locale,
                      "El mismo historial y los mismos permisos del CRM.",
                      "The same conversation history and CRM permissions.",
                    )
                  : p === "lenders"
                    ? t(
                        locale,
                        "Criterios y contactos del directorio vigente.",
                        "Criteria and contacts from the current directory.",
                      )
                    : t(
                        locale,
                        "Abre un expediente para continuar sin perder esta vista.",
                        "Open a file to continue without losing this view.",
                      )}
              </p>
              {pageBody(p, i + 1)}
            </section>
          ))}
          <footer className="pos-footer">
            <span>Pipeline OS · Curated Financial</span>
            <span>
              {data.demo
                ? t(locale, "Demo sin envíos reales", "Demo with no real sends")
                : t(
                    locale,
                    "Fuente: registros autorizados del CRM",
                    "Source: authorized CRM records",
                  )}
            </span>
          </footer>
        </main>
      </div>
      {caseId && (
        <div className="pos-case-dialog">
          <Modal
            title={
              caseData?.opportunities.find((o) => o.id === caseId)?.company ||
              t(locale, "Expediente", "Business file")
            }
            wide
            locale={locale}
            busy={busy}
            close={closeCase}
          >
            <div className="pos-existing">
              {error && (
                <p className="pos-alert" role="alert">
                  {error}
                </p>
              )}
              {caseLoading ? (
                <p role="status">
                  {t(locale, "Cargando expediente…", "Loading file…")}
                </p>
              ) : caseData?.opportunities.find((o) => o.id === caseId) ? (
                <>
                  <PipelineCaseProgress
                    key={`progress:${caseId}`}
                    data={caseData}
                    caseId={caseId}
                    processes={processes}
                    locale={locale}
                    open={(section) =>
                      requestLeave(() => {
                        setCaseSection(section);
                        requestAnimationFrame(() => {
                          caseContent.current?.focus({ preventScroll: true });
                          caseContent.current?.scrollIntoView({
                            block: "start",
                            behavior: "instant",
                          });
                        });
                      })
                    }
                  />
                  <div className="pos-row pos-file-tools">
                    <button
                      className="pos-btn"
                      onClick={() =>
                        requestLeave(() => {
                          closeCase();
                          mail(caseId);
                        })
                      }
                    >
                      <Mail size={15} />
                      {l("conversations")}
                    </button>
                    <span className="pos-small pos-muted">
                      {t(
                        locale,
                        "La lista permanece abierta detrás de este panel.",
                        "Your list stays open behind this panel.",
                      )}
                    </span>
                  </div>
                  {caseSection === "analysis" && (
                    <div className="pos-info">
                      <Sparkles size={17} />
                      <span>
                        {t(
                          locale,
                          "Revisa datos de la aplicación, flujo de caja y pagos a RAM, lenders compatibles, pitch y próximo paso. Solicita AR aging y valida los faltantes antes de aprobar la presentación.",
                          "Review application data, cash flow and RAM payments, lender matches, pitch and next step. Request AR aging and validate missing information before approving a submission.",
                        )}
                      </span>
                    </div>
                  )}
                  {["superadmin", "closer_admin", "closer"].includes(
                    caseData.profile.role,
                  ) && (
                    <PipelineMailReview
                      key={caseId}
                      caseId={caseId}
                      locale={locale}
                      demo={data.demo}
                      changed={refresh}
                      leave={requestLeave}
                    />
                  )}
                  <div
                    ref={caseContent}
                    className="pos-case-content"
                    tabIndex={-1}
                    aria-label={t(
                      locale,
                      "Acciones del expediente",
                      "Case actions",
                    )}
                  >
                    <OpportunityDetail
                      key={`${caseId}:${caseSection}`}
                      data={caseData}
                      opportunity={caseData.opportunities.find(
                        (o) => o.id === caseId,
                      )!}
                      profile={caseData.profile}
                      locale={locale}
                      act={act}
                      busy={busy}
                      back={() => requestLeave(closeCase)}
                      refresh={refresh}
                      initialTab={caseSection}
                    />
                  </div>
                </>
              ) : (
                <div className="pos-empty">
                  {t(
                    locale,
                    "No se pudo cargar el expediente. Cierra el panel y vuelve a intentarlo.",
                    "Could not load the file. Close the panel and try again.",
                  )}
                </div>
              )}
            </div>
          </Modal>
        </div>
      )}
      {importing && (
        <ImportWizard
          data={data}
          locale={locale}
          act={act}
          refresh={refresh}
          close={() => setImporting(false)}
        />
      )}
      {review && (
        <Modal
          title={review.name}
          wide
          locale={locale}
          close={() => setReview(null)}
        >
          <div className="pos-existing">
            {error && (
              <p className="pos-alert" role="alert">
                {error}
              </p>
            )}
            <CampaignReview
              campaign={review}
              data={data}
              locale={locale}
              act={act}
              close={() => setReview(null)}
            />
          </div>
        </Modal>
      )}
      {lender && (
        <Modal
          title={
            lender === "new"
              ? t(locale, "Nuevo lender", "New lender")
              : t(locale, "Editar lender", "Edit lender")
          }
          locale={locale}
          busy={busy}
          close={() => setLender(null)}
        >
          <div className="pos-existing">
            {error && (
              <p className="pos-alert" role="alert">
                {error}
              </p>
            )}
            <LenderForm
              lender={data.lenders.find((l) => l.id === lender)}
              locale={locale}
              busy={busy}
              submit={(e, x) => {
                void saveLender(e, x).catch(() => {});
              }}
            />
          </div>
        </Modal>
      )}
      {guideline && data.lenders.some((l) => l.id === guideline) && (
        <LenderGuidelinesEditor
          lender={data.lenders.find((l) => l.id === guideline)!}
          data={data}
          locale={locale}
          act={act}
          refresh={refresh}
          close={() => setGuideline(null)}
        />
      )}
      {confirmation}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="pos-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
function FragmentCrumb({
  label,
  current,
  click,
}: {
  label: string;
  current: boolean;
  click: () => void;
}) {
  return (
    <>
      <ChevronRight size={13} />
      {current ? (
        <span aria-current="page">{label}</span>
      ) : (
        <button onClick={click}>{label}</button>
      )}
    </>
  );
}
