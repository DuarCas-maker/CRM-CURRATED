"use client";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Download,
  Mail,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import type { Campaign, Locale, Workspace } from "@/lib/domain";
import {
  campaignLabels,
  campaignState,
  emptyMetrics,
  responseRate,
  type CampaignCenter,
  type CampaignContact,
  type CampaignMetrics,
} from "@/lib/campaign-center";
import type { SendingBudget } from "@/lib/campaign-delivery";
import type { EmailTemplate } from "@/lib/campaign-templates";
import type { Action } from "./crm";
import { CampaignTemplates } from "./campaign-templates";
import { Empty, t } from "./ui";
import "./campaign-center.css";

type Tab = "campaigns" | "details" | "templates" | "activity" | "account";
type Details = {
  campaign: Campaign;
  metrics: CampaignMetrics;
  rows: CampaignContact[];
  total: number;
};
type ActivityPage = {
  rows: {
    id: string;
    campaign_id: string;
    name: string;
    kind: string;
    occurred_at: string;
    email: string;
  }[];
  total: number;
};
const tabs: [Tab, string, string][] = [
  ["campaigns", "Campañas", "Campaigns"],
  ["details", "Datos de campaña", "Campaign data"],
  ["templates", "Plantillas", "Templates"],
  ["activity", "Actividad", "Activity"],
  ["account", "Cuenta y límites", "Account & limits"],
];
const filters = [
  ["all", "Todos", "All"],
  ["replied", "Respondieron", "Replied"],
  ["unanswered", "Sin respuesta", "No response"],
  ["pending", "Por enviar", "Pending"],
  ["attention", "Requieren contestación", "Need a reply"],
  ["errors", "Errores", "Errors"],
];

export function CampaignCenterWorkspace({
  data,
  locale,
  act,
  changed,
  create,
  review,
  openConversation,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  changed: () => Promise<void>;
  create: (template?: EmailTemplate) => void;
  review: (c: Campaign) => void;
  openConversation: (opportunity: string, conversation: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("campaigns");
  const [center, setCenter] = useState<CampaignCenter | null>(null),
    [budgets, setBudgets] = useState<SendingBudget[]>([]);
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [state, setState] = useState("all");
  const [selected, setSelected] = useState(""),
    [details, setDetails] = useState<Details | null>(null);
  const [contactQuery, setContactQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [contactPage, setContactPage] = useState(0);
  const [activity, setActivity] = useState<ActivityPage | null>(null),
    [activityPage, setActivityPage] = useState(0);
  const [error, setError] = useState(""),
    [detailError, setDetailError] = useState(""),
    [accountError, setAccountError] = useState(""),
    [pending, setPending] = useState(false),
    [revision, setRevision] = useState(0);
  const manage = ["superadmin", "seller_admin"].includes(data.profile.role);
  const label = (value: string) =>
    (campaignLabels[value] || [value, value])[locale === "es" ? 0 : 1];
  const date = (value: string | null | undefined) =>
    value
      ? new Date(value).toLocaleString(locale === "es" ? "es-CO" : "en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setRevision((n) => n + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (data.demo) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void fetch(
        "/api/campaigns/center?" +
          new URLSearchParams({
            search: query,
            page: String(page),
            status: tab === "details" ? "all" : state,
          }),
        { signal: abort.signal },
      )
        .then(async (r) => {
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          setCenter(result);
          setError("");
          setSelected((s) => s || result.campaigns[0]?.id || "");
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        });
    }, 200);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [data.demo, data.campaigns, query, page, state, tab, revision]);
  useEffect(() => {
    if (data.demo || !manage) return;
    const abort = new AbortController();
    void fetch("/api/campaigns", { signal: abort.signal })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        setBudgets(result.budgets);
        setAccountError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setAccountError(e.message);
      });
    return () => abort.abort();
  }, [data.demo, manage, data.accounts, revision]);
  useEffect(() => {
    setDetailError("");
    if (tab !== "details" || !selected || data.demo) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void fetch(
        "/api/campaigns/center?" +
          new URLSearchParams({
            mode: "details",
            campaign: selected,
            search: contactQuery,
            filter,
            page: String(contactPage),
          }),
        { signal: abort.signal },
      )
        .then(async (r) => {
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          setDetails(result);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setDetailError(e.message);
        });
    }, 200);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [
    tab,
    selected,
    contactQuery,
    filter,
    contactPage,
    data.demo,
    data.campaigns,
    revision,
  ]);
  useEffect(() => {
    if (tab !== "activity" || data.demo) return;
    const abort = new AbortController();
    void fetch(`/api/campaigns/center?mode=activity&page=${activityPage}`, {
      signal: abort.signal,
    })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        setActivity(result);
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [tab, activityPage, data.demo, data.campaigns, revision]);
  const campaigns = data.demo
    ? data.campaigns.map((c) => ({ ...c, metrics: emptyMetrics }))
    : center?.campaigns || [];
  const choose = (id: string) => {
    setSelected(id);
    setFilter("all");
    setContactQuery("");
    setContactPage(0);
    setTab("details");
  };
  async function pause(c: Campaign) {
    setPending(true);
    try {
      await act("pause_campaign", { id: c.id });
      setRevision((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  const metric = (value: number | undefined) =>
    data.demo || value === undefined ? "—" : value.toLocaleString(locale);
  const kpis = [
    ["Campañas activas", "Active campaigns", center?.summary.active, Send],
    ["Correos enviados", "Emails sent", center?.summary.sent, Mail],
    [
      "Contactos que respondieron",
      "Contacts who replied",
      center?.summary.replied,
      MessageSquare,
    ],
    [
      "Contactos que aún no responden",
      "Contacts awaiting a reply",
      center?.summary.unanswered,
      ArrowUpRight,
    ],
  ] as const;
  const c = details?.campaign,
    m = details?.metrics;
  const list = campaigns.filter(
    (c) => state === "all" || campaignState(c) === state,
  );
  const authorizedAccounts = data.accounts.filter(
    (a) =>
      manage &&
      (data.profile.role === "superadmin" ||
        data.sender_account_ids?.includes(a.id)),
  );
  const selectedOption = campaigns.some((c) => c.id === selected)
    ? null
    : c || data.campaigns.find((c) => c.id === selected);
  return (
    <div className="campaign-center">
      {data.demo && (
        <p className="campaign-note">
          {t(
            locale,
            "Demostración · Las métricas de envío y respuesta solo se muestran con datos reales de Supabase.",
            "Demo · Sending and response metrics require real Supabase data.",
          )}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="campaign-kpis">
        {kpis.map(([es, en, value, Icon], index) => (
          <div className={`campaign-kpi ${index === 2 ? "dark" : ""}`} key={es}>
            <span>
              {t(locale, es, en)}
              <Icon size={17} />
            </span>
            <strong>{metric(value)}</strong>
            <small>
              {index === 0
                ? t(
                    locale,
                    "Primer contacto comercial",
                    "Business first contact",
                  )
                : index === 1
                  ? t(
                      locale,
                      "Mensajes iniciales aceptados por Gmail",
                      "Initial messages accepted by Gmail",
                    )
                  : index === 2
                    ? t(
                        locale,
                        "Contactos únicos · respuesta confirmada",
                        "Unique contacts · confirmed response",
                      )
                    : t(
                        locale,
                        "Con envío inicial confirmado",
                        "With confirmed initial send",
                      )}
            </small>
          </div>
        ))}
      </div>
      <div className="campaign-ribbon">
        <ShieldCheck size={16} />
        <strong>Gmail</strong>
        <span>
          {budgets.length
            ? budgets
                .map(
                  (b) =>
                    `${data.accounts.find((a) => a.id === b.account_id)?.email || "Gmail"} · ${b.campaign_remaining}/${b.campaign_limit} ${t(locale, "disponibles", "available")}`,
                )
                .join(" · ")
            : t(
                locale,
                "Cupos compartidos y reserva operativa",
                "Shared budgets and operational reserve",
              )}
        </span>
        <button onClick={() => setTab("account")}>
          {t(locale, "Ver cuenta y límites", "View account & limits")} →
        </button>
      </div>
      <div
        className="campaign-tabs"
        role="tablist"
        aria-label={t(locale, "Secciones de Campañas", "Campaign sections")}
      >
        {tabs.map(([id, es, en]) => (
          <button
            id={`campaign-tab-${id}`}
            aria-controls={`campaign-panel-${id}`}
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {t(locale, es, en)}
            {id === "campaigns" && (
              <small>
                {data.demo ? data.campaigns.length : (center?.total ?? "—")}
              </small>
            )}
          </button>
        ))}
      </div>
      <div
        id={`campaign-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`campaign-tab-${tab}`}
      >
        {tab === "campaigns" && (
          <>
            <div className="campaign-section-head">
              <div>
                <h2>
                  {t(
                    locale,
                    "Campañas de primer contacto",
                    "First-contact campaigns",
                  )}
                </h2>
                <p>
                  {t(
                    locale,
                    "Inicia conversaciones con leads validados y sigue sus respuestas.",
                    "Start conversations with validated leads and track their replies.",
                  )}
                </p>
              </div>
            </div>
            <div className="campaign-tools">
              <label className="campaign-search">
                <Search size={15} />
                <input
                  aria-label={t(locale, "Buscar campaña", "Search campaigns")}
                  value={query}
                  placeholder={t(
                    locale,
                    "Buscar campaña…",
                    "Search campaigns…",
                  )}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <select
                aria-label={t(locale, "Estado de campaña", "Campaign status")}
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setPage(0);
                }}
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
            <div className="campaign-panel campaign-table-scroll">
              <table className="campaign-table">
                <thead>
                  <tr>
                    {[
                      ["Campaña", "Campaign"],
                      ["Estado", "Status"],
                      ["Leads", "Leads"],
                      ["Enviados", "Sent"],
                      ["Respondieron", "Replied"],
                      ["Sin respuesta", "No response"],
                      ["Tasa de respuesta", "Response rate"],
                      ["Acciones", "Actions"],
                    ].map(([es, en]) => (
                      <th key={es}>{t(locale, es, en)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <button
                          className="campaign-name"
                          onClick={() => choose(c.id)}
                        >
                          {c.name}
                        </button>
                        <small>
                          {data.profiles.find((p) => p.id === c.seller_id)
                            ?.name || "—"}{" "}
                          · {date(c.created_at)}
                        </small>
                      </td>
                      <td>
                        <span className={`campaign-badge ${campaignState(c)}`}>
                          {label(campaignState(c))}
                        </span>
                        {!c.first_contact && (
                          <small>{t(locale, "Histórica", "Historical")}</small>
                        )}
                      </td>
                      <td>{metric(c.metrics.enrolled)}</td>
                      <td>{metric(c.metrics.sent)}</td>
                      <td>{metric(c.metrics.replied)}</td>
                      <td>{metric(c.metrics.unanswered)}</td>
                      <td>
                        <strong>
                          {data.demo ? "—" : `${responseRate(c.metrics)}%`}
                        </strong>
                        <div className="campaign-rate">
                          <span
                            style={{ width: `${responseRate(c.metrics)}%` }}
                          />
                        </div>
                      </td>
                      <td>
                        <div className="card-actions">
                          <button
                            className="button"
                            onClick={() => choose(c.id)}
                          >
                            {t(locale, "Ver datos", "View data")}
                          </button>
                          {manage && c.status !== "completed" && (
                            <button
                              className="button"
                              disabled={pending || data.demo}
                              onClick={() =>
                                c.status === "active"
                                  ? void pause(c)
                                  : review(c)
                              }
                            >
                              {c.status === "active"
                                ? t(locale, "Pausar", "Pause")
                                : t(locale, "Revisar", "Review")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.length && (
                <>
                  <Empty
                    title={
                      center?.total
                        ? t(
                            locale,
                            "No hay campañas en este estado",
                            "No campaigns in this state",
                          )
                        : t(
                            locale,
                            "Crea tu primera campaña",
                            "Create your first campaign",
                          )
                    }
                    body={t(
                      locale,
                      "Selecciona una plantilla, una cuenta autorizada y leads desde Preparación.",
                      "Choose a template, an authorized account and leads from Preparation.",
                    )}
                  />
                  {manage && (
                    <div className="campaign-empty-action">
                      <button
                        className="button primary"
                        onClick={() => create()}
                      >
                        {t(locale, "Nueva campaña", "New campaign")}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            <Pager
              page={page}
              size={25}
              total={center?.total || campaigns.length}
              change={setPage}
              locale={locale}
            />
          </>
        )}
        {tab === "details" && (
          <>
            <div className="campaign-section-head">
              <div>
                <h2>{t(locale, "Datos de campaña", "Campaign data")}</h2>
                <p>
                  {t(
                    locale,
                    "Resultados del correo inicial, contacto a contacto.",
                    "Initial email results, contact by contact.",
                  )}
                </p>
              </div>
              <select
                aria-label={t(locale, "Seleccionar campaña", "Select campaign")}
                value={selected}
                onChange={(e) => choose(e.target.value)}
              >
                <option value="">
                  {t(locale, "Selecciona una campaña", "Select a campaign")}
                </option>
                {selectedOption && (
                  <option value={selectedOption.id}>
                    {selectedOption.name}
                  </option>
                )}
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <details className="campaign-selector-search">
              <summary>
                {t(locale, "Buscar otra campaña", "Find another campaign")}
              </summary>
              <div className="campaign-tools">
                <input
                  aria-label={t(
                    locale,
                    "Buscar por nombre de campaña",
                    "Search campaign name",
                  )}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder={t(locale, "Buscar por nombre", "Search by name")}
                />
                <Pager
                  page={page}
                  size={25}
                  total={center?.total || 0}
                  change={setPage}
                  locale={locale}
                />
              </div>
            </details>
            {detailError && (
              <p className="error" role="alert">
                {detailError}
              </p>
            )}
            {!selected ? (
              <Empty
                title={t(
                  locale,
                  "Selecciona o crea una campaña",
                  "Select or create a campaign",
                )}
              />
            ) : !details || details.campaign.id !== selected ? (
              <p role="status">
                {data.demo
                  ? t(
                      locale,
                      "Los resultados reales estarán disponibles al conectar Supabase.",
                      "Real results will be available after connecting Supabase.",
                    )
                  : t(locale, "Consultando resultados…", "Loading results…")}
              </p>
            ) : (
              <>
                <div className="campaign-detail-grid">
                  <div className="campaign-panel campaign-pad">
                    <div className="campaign-section-head">
                      <div>
                        <span className="campaign-eyebrow">
                          {t(locale, "CORREO INICIAL", "INITIAL EMAIL")}
                        </span>
                        <h2>{c!.name}</h2>
                      </div>
                      <span className={`campaign-badge ${campaignState(c!)}`}>
                        {label(campaignState(c!))}
                      </span>
                    </div>
                    <div className="campaign-detail-kpis">
                      {[
                        ["Leads inscritos", "Enrolled leads", m!.enrolled],
                        ["Correos enviados", "Emails sent", m!.sent],
                        [
                          "Contactos que respondieron",
                          "Contacts who replied",
                          m!.replied,
                        ],
                        ["Sin respuesta", "No response", m!.unanswered],
                        ["Por enviar", "Pending send", m!.pending],
                        [
                          "Pendientes de atención",
                          "Need team attention",
                          m!.attention,
                        ],
                        [
                          "Tasa de respuesta",
                          "Response rate",
                          `${responseRate(m!)}%`,
                        ],
                        [
                          "Errores / bloqueados",
                          "Errors / blocked",
                          m!.failed + m!.uncertain + m!.cancelled + m!.blocked,
                        ],
                      ].map(([es, en, n]) => (
                        <div key={es}>
                          <span>{t(locale, String(es), String(en))}</span>
                          <strong>{n}</strong>
                        </div>
                      ))}
                    </div>
                    <div
                      className="campaign-distribution"
                      role="img"
                      aria-label={`${m!.replied} ${t(locale, "respondieron", "replied")}, ${m!.unanswered} ${t(locale, "sin respuesta", "no response")}, ${m!.pending} ${t(locale, "por enviar", "pending")}`}
                    >
                      <span
                        className="replied"
                        style={{
                          width: `${m!.enrolled ? (m!.replied / m!.enrolled) * 100 : 0}%`,
                        }}
                      />
                      <span
                        className="unanswered"
                        style={{
                          width: `${m!.enrolled ? (m!.unanswered / m!.enrolled) * 100 : 0}%`,
                        }}
                      />
                      <span
                        className="pending"
                        style={{
                          width: `${m!.enrolled ? (m!.pending / m!.enrolled) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="campaign-legend">
                      <span>
                        ● {t(locale, "Respondieron", "Replied")} {m!.replied}
                      </span>
                      <span>
                        ● {t(locale, "Sin respuesta", "No response")}{" "}
                        {m!.unanswered}
                      </span>
                      <span>
                        ● {t(locale, "Por enviar", "Pending")} {m!.pending}
                      </span>
                    </div>
                    <p className="campaign-note">
                      {t(
                        locale,
                        "Enviado significa que Gmail aceptó el mensaje inicial; no confirma entrega ni apertura. La tasa usa contactos únicos que respondieron / contactos con envío confirmado.",
                        "Sent means Gmail accepted the initial message; it does not confirm delivery or opening. Response rate uses unique contacts who replied / contacts with confirmed send.",
                      )}
                    </p>
                  </div>
                  <aside className="campaign-panel campaign-pad">
                    <span className="campaign-eyebrow">
                      {t(locale, "RESUMEN COMERCIAL", "BUSINESS SUMMARY")}
                    </span>
                    <dl className="campaign-facts">
                      {[
                        [
                          t(locale, "Responsable", "Owner"),
                          data.profiles.find((p) => p.id === c!.seller_id)
                            ?.name || "—",
                        ],
                        [
                          t(locale, "Cuenta emisora", "Sender account"),
                          data.accounts.find((a) => a.id === c!.account_id)
                            ?.email || "—",
                        ],
                        [t(locale, "Creación", "Created"), date(c!.created_at)],
                        [
                          t(locale, "Activación", "Activated"),
                          date(c!.activated_at),
                        ],
                        [
                          t(locale, "Programación", "Scheduled"),
                          date(c!.scheduled_at),
                        ],
                        [
                          t(locale, "Plantilla", "Template"),
                          c!.template_version ? `v${c!.template_version}` : "—",
                        ],
                        [t(locale, "Fallidos", "Failed"), m!.failed],
                        [t(locale, "Inciertos", "Uncertain"), m!.uncertain],
                        [t(locale, "Cancelados", "Cancelled"), m!.cancelled],
                        [
                          t(
                            locale,
                            "Bloqueados / bajas",
                            "Blocked / suppressed",
                          ),
                          m!.blocked,
                        ],
                      ].map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <button
                      className="button primary"
                      onClick={() => {
                        setFilter("attention");
                        setContactPage(0);
                      }}
                    >
                      {t(
                        locale,
                        "Ver respuestas por atender",
                        "View replies needing attention",
                      )}{" "}
                      ({m!.attention})
                    </button>
                  </aside>
                </div>
                <div className="campaign-tools">
                  <div className="campaign-filters">
                    {filters.map(([key, es, en]) => (
                      <button
                        key={key}
                        aria-pressed={filter === key}
                        className={filter === key ? "active" : ""}
                        onClick={() => {
                          setFilter(key);
                          setContactPage(0);
                        }}
                      >
                        {t(locale, es, en)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="campaign-tools">
                  <label className="campaign-search">
                    <Search size={15} />
                    <input
                      aria-label={t(
                        locale,
                        "Buscar contacto de campaña",
                        "Search campaign contacts",
                      )}
                      value={contactQuery}
                      placeholder={t(
                        locale,
                        "Empresa, contacto o correo…",
                        "Company, contact or email…",
                      )}
                      onChange={(e) => {
                        setContactQuery(e.target.value);
                        setContactPage(0);
                      }}
                    />
                  </label>
                  <a
                    className="button"
                    href={
                      "/api/campaigns/center?" +
                      new URLSearchParams({
                        mode: "csv",
                        campaign: selected,
                        search: contactQuery,
                        filter,
                        locale,
                      })
                    }
                  >
                    <Download size={14} />
                    {t(locale, "Exportar CSV", "Export CSV")}
                  </a>
                </div>
                <div className="campaign-panel campaign-table-scroll">
                  <table className="campaign-table">
                    <thead>
                      <tr>
                        {[
                          ["Empresa", "Company"],
                          ["Contacto", "Contact"],
                          ["Correo", "Email"],
                          ["Estado del envío", "Send status"],
                          ["Estado de respuesta", "Response status"],
                          ["Última interacción", "Last interaction"],
                          ["Atención pendiente", "Needs attention"],
                          ["Conversación", "Conversation"],
                        ].map(([es, en]) => (
                          <th key={es}>{t(locale, es, en)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {details.rows.map((r) => (
                        <tr key={r.contact_id}>
                          <td>
                            <strong>{r.company}</strong>
                          </td>
                          <td>{r.name || "—"}</td>
                          <td>{r.email}</td>
                          <td>
                            <span className={`campaign-badge ${r.send_status}`}>
                              {label(r.send_status)}
                            </span>
                          </td>
                          <td>
                            {r.reply_at
                              ? t(locale, "Respondió", "Replied")
                              : r.send_status === "sent"
                                ? t(locale, "Sin respuesta", "No response")
                                : "—"}
                          </td>
                          <td>{date(r.last_interaction)}</td>
                          <td>
                            {r.needs_attention ? (
                              <span className="campaign-badge failed">
                                {t(locale, "Responder", "Reply needed")}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {r.conversation_id && r.opportunity_id ? (
                              <button
                                className="button"
                                onClick={() =>
                                  openConversation(
                                    r.opportunity_id!,
                                    r.conversation_id!,
                                  )
                                }
                              >
                                {t(locale, "Abrir", "Open")}{" "}
                                <ArrowUpRight size={13} />
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!details.rows.length && (
                    <Empty
                      title={t(
                        locale,
                        "No hay contactos en este filtro",
                        "No contacts match this filter",
                      )}
                    />
                  )}
                </div>
                <Pager
                  page={contactPage}
                  size={50}
                  total={details.total}
                  change={setContactPage}
                  locale={locale}
                />
              </>
            )}
          </>
        )}
        {tab === "templates" && (
          <CampaignTemplates
            data={data}
            locale={locale}
            act={act}
            changed={changed}
            useTemplate={(template) => create(template)}
          />
        )}
        {tab === "activity" && (
          <>
            <div className="campaign-section-head">
              <div>
                <h2>
                  {t(locale, "Actividad de campañas", "Campaign activity")}
                </h2>
                <p>
                  {t(
                    locale,
                    "Historial real de campañas, envíos aceptados y respuestas confirmadas.",
                    "Actual campaign history, accepted sends and confirmed replies.",
                  )}
                </p>
              </div>
            </div>
            <div className="campaign-panel">
              {activity?.rows.map((e) => (
                <div
                  className="campaign-activity"
                  key={`${e.campaign_id}:${e.id}`}
                >
                  <span>
                    <Mail size={16} />
                  </span>
                  <div>
                    <strong>{label(e.kind)}</strong>
                    <p>
                      <button
                        className="campaign-name"
                        onClick={() => choose(e.campaign_id)}
                      >
                        {e.name}
                      </button>
                      {e.email && ` · ${e.email}`}
                    </p>
                    <small>{date(e.occurred_at)}</small>
                  </div>
                </div>
              ))}
              {!activity?.rows.length && (
                <Empty
                  title={t(
                    locale,
                    "Aún no hay actividad registrada",
                    "No activity recorded yet",
                  )}
                />
              )}
            </div>
            <Pager
              page={activityPage}
              size={50}
              total={activity?.total || 0}
              change={setActivityPage}
              locale={locale}
            />
          </>
        )}
        {tab === "account" && (
          <>
            <div className="campaign-section-head">
              <div>
                <h2>{t(locale, "Cuenta y límites", "Account & limits")}</h2>
                <p>
                  {t(
                    locale,
                    "Uso compartido de Gmail en las últimas 24 horas.",
                    "Shared Gmail usage over the last 24 hours.",
                  )}
                </p>
              </div>
            </div>
            {accountError && (
              <p className="error" role="alert">
                {accountError}
              </p>
            )}
            <div className="campaign-account-grid">
              {authorizedAccounts.map((a) => {
                const b = budgets.find((b) => b.account_id === a.id);
                return (
                  <section className="campaign-panel campaign-pad" key={a.id}>
                    <span className="campaign-eyebrow">
                      {t(locale, "CUENTA EMISORA", "SENDER ACCOUNT")}
                    </span>
                    <h2>{a.email}</h2>
                    <span
                      className={`campaign-badge ${a.status === "connected" ? "sent" : "failed"}`}
                    >
                      {a.status === "connected"
                        ? t(locale, "Conectada", "Connected")
                        : t(locale, "Requiere conexión", "Connection required")}
                    </span>
                    <div className="campaign-detail-kpis">
                      {[
                        [
                          "Uso últimas 24 h",
                          "Last 24h usage",
                          b?.total_messages,
                        ],
                        [
                          "Cupo para campañas",
                          "Campaign budget",
                          b?.campaign_limit,
                        ],
                        ["Disponible", "Available", b?.campaign_remaining],
                        [
                          "Reserva operativa",
                          "Operational reserve",
                          b?.reserve,
                        ],
                      ].map(([es, en, n]) => (
                        <div key={es}>
                          <span>{t(locale, String(es), String(en))}</span>
                          <strong>{n ?? "—"}</strong>
                        </div>
                      ))}
                    </div>
                    <p>
                      {t(locale, "Última sincronización", "Last sync")}:{" "}
                      {date(b?.synced_at)}
                    </p>
                    {b?.send_retry_at &&
                      Date.parse(b.send_retry_at) > Date.now() && (
                        <p className="error">
                          {t(
                            locale,
                            "Pausada por Google hasta",
                            "Paused by Google until",
                          )}{" "}
                          {date(b.send_retry_at)}
                        </p>
                      )}
                    {(!b?.synced_at ||
                      Date.parse(b.synced_at) < Date.now() - 900000) && (
                      <p className="campaign-note">
                        {t(
                          locale,
                          "Las campañas esperan una sincronización de uso reciente (máximo 15 minutos).",
                          "Campaigns wait for a recent usage sync (maximum 15 minutes).",
                        )}
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
            {!authorizedAccounts.length && (
              <Empty
                title={t(
                  locale,
                  "No hay cuentas remitentes autorizadas para tu usuario",
                  "No authorized sender accounts for your user",
                )}
              />
            )}
            <p className="campaign-note">
              {t(
                locale,
                "Las campañas comparten cupo con los demás envíos de la cuenta y respetan la reserva operativa, las pausas y las restricciones de Google.",
                "Campaigns share the account budget with other sends and honor operational reserve, cooldowns and Google restrictions.",
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
function Pager({
  page,
  size,
  total,
  change,
  locale,
}: {
  page: number;
  size: number;
  total: number;
  change: (n: number) => void;
  locale: Locale;
}) {
  return (
    <div className="campaign-pagination">
      <small>
        {total.toLocaleString(locale)} {t(locale, "resultados", "results")} ·{" "}
        {page + 1}/{Math.max(1, Math.ceil(total / size))}
      </small>
      <button
        className="button"
        disabled={page === 0}
        aria-label={t(locale, "Página anterior", "Previous page")}
        onClick={() => change(page - 1)}
      >
        ←
      </button>
      <button
        className="button"
        disabled={(page + 1) * size >= total}
        aria-label={t(locale, "Página siguiente", "Next page")}
        onClick={() => change(page + 1)}
      >
        →
      </button>
    </div>
  );
}
