"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  Mail,
  Send,
  ListTodo,
  Landmark,
  BarChart3,
  Settings,
  Bell,
  Search,
  Plus,
  Upload,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  Clock3,
  CircleCheck,
  Menu,
  X,
  LogOut,
  SlidersHorizontal,
  Download,
  ShieldCheck,
  AlertCircle,
  Check,
  Globe,
  FileText,
  RefreshCw,
} from "lucide-react";
import type { Workspace, Opportunity, Locale, Role, Stage } from "@/lib/domain";
import {
  currency,
  dateLabel,
  stages,
  stageLabels,
  roleLabels,
  canSeeOpportunity,
  canSeeArea,
} from "@/lib/domain";
import {
  Avatar,
  StageBadge,
  VerificationBadge,
  Empty,
  Modal,
  Field,
  SaveButton,
  t,
} from "./ui";
import { OpportunityDetail } from "./opportunity-detail";
import { ImportWizard } from "./import-wizard";
import { teamLabel } from "@/lib/gmail-team";
import { demoAction } from "@/lib/demo-actions";
import { Integrations } from "./integrations";
import { MailComposer } from "./mail-composer";
import { MailInbox } from "./mail-inbox";
import { LenderContacts } from "./lender-contacts";
import {
  getLeadTab,
  leadTabs,
  leadTabVerifications,
  type LeadTab,
} from "@/lib/lead-tabs";
type View =
  | "overview"
  | "pipeline"
  | "leads"
  | "inbox"
  | "campaigns"
  | "tasks"
  | "lenders"
  | "reports"
  | "settings";
export type Action = (
  kind: string,
  payload: Record<string, unknown>,
) => Promise<unknown>;
const leadTabLabels: Record<LeadTab, [string, string]> = {
  preparing: ["Bandeja de preparación", "Preparation inbox"],
  converted: ["Convertidos a oportunidades", "Converted to opportunities"],
  risk: ["Inválidos / en riesgo", "Invalid / at risk"],
};
const leadTabDescriptions: Record<LeadTab, [string, string]> = {
  preparing: [
    "Leads pendientes de validación. Los correos inválidos o inciertos están en la pestaña «Inválidos / en riesgo».",
    "Leads awaiting validation. Invalid or uncertain emails are in the Invalid / at risk tab.",
  ],
  converted: [
    "Leads que pasaron al flujo comercial después de validar su correo y tienen una oportunidad vinculada.",
    "Leads that entered the sales pipeline after email validation and have a linked opportunity.",
  ],
  risk: [
    "Los correos inválidos e inciertos están excluidos del flujo comercial. Los inciertos necesitan una verificación válida antes de pasar a oportunidades.",
    "Invalid and uncertain emails are excluded from the sales pipeline. Uncertain emails need a valid verification before becoming opportunities.",
  ],
};
const leadTabEmpty: Record<LeadTab, [string, string]> = {
  preparing: [
    "No hay leads en preparación con estos filtros",
    "No leads in preparation match these filters",
  ],
  converted: [
    "No hay leads convertidos con estos filtros",
    "No converted leads match these filters",
  ],
  risk: [
    "No hay leads inválidos o en riesgo con estos filtros",
    "No invalid or at-risk leads match these filters",
  ],
};
export default function CRM({ initial }: { initial: Workspace }) {
  const [data, setData] = useState(initial);
  const [locale, setLocale] = useState<Locale>(initial.preferences.locale);
  const [view, setView] = useState<View>("overview");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [owner, setOwner] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [period, setPeriod] = useState("all");
  const [leadStatus, setLeadStatus] = useState<LeadTab>("preparing");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [extraSteps, setExtraSteps] = useState<number[]>([]);
  const editingLender = data.lenders.find((l) => modal === `lender:${l.id}`);
  useEffect(() => {
    if (modal === "campaign") setExtraSteps([]);
  }, [modal]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [mobile, setMobile] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [role, setRole] = useState<Role>(initial.profile.role);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestKeys = useRef(new Map<string, string>());
  const requestParams = new URLSearchParams({
    q: query,
    stage,
    owner,
    campaign: campaignFilter,
    period,
    view,
    lead_status: leadStatus,
    page: String(selected ? 0 : page),
    ...(selected ? { case: selected } : {}),
  }).toString();
  useEffect(() => {
    if (initial.demo) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/workspace?${requestParams}`, {
          signal: abort.signal,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        if (!abort.signal.aborted) setData(body);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [requestParams, initial.demo]);
  useEffect(() => {
    setPage(0);
  }, [query, stage, owner, campaignFilter, period, view, leadStatus]);
  useEffect(() => {
    if (initial.demo) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/workspace?${requestParams}`, {
          signal: controller.signal,
        });
        if (response.ok) {
          const body = await response.json();
          if (!controller.signal.aborted) setData(body);
        }
      } catch {}
    }, 15000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [requestParams, initial.demo]);
  const profile = data.demo
    ? {
        ...data.profile,
        role,
        id:
          role === "seller" ? "u2" : role === "closer" ? "u4" : data.profile.id,
      }
    : data.profile;
  const visible = useMemo(
    () => data.opportunities.filter((o) => canSeeOpportunity(profile, o)),
    [data.opportunities, profile.id, profile.role],
  );
  const filtered = visible.filter(
    (o) =>
      `${o.company} ${o.contact} ${o.email}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (stage === "all" || o.stage === stage) &&
      (owner === "all" || o.seller_id === owner || o.closer_id === owner) &&
      (campaignFilter === "all" || o.campaign_id === campaignFilter) &&
      (period === "all" ||
        new Date(o.created_at).getTime() >=
          Date.now() - Number(period) * 86400000),
  );
  const filteredLeads = data.leads.filter(
    (l) =>
      (profile.role === "superadmin" ||
        profile.role === "seller_admin" ||
        (profile.role === "seller" && l.seller_id === profile.id)) &&
      `${l.company} ${l.contact} ${l.email}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (stage === "all" || l.verification === stage) &&
      (owner === "all" || l.seller_id === owner) &&
      getLeadTab(l) === leadStatus &&
      (period === "all" ||
        new Date(l.created_at).getTime() >=
          Date.now() - Number(period) * 86400000),
  );
  const verificationCandidates = filteredLeads.filter(
    (l) =>
      !l.suppressed &&
      ["pending", "uncertain"].includes(l.verification) &&
      !["queued", "submitted", "uncertain_request"].includes(
        l.verification_state || "",
      ),
  );
  const selectedVerificationCandidates = verificationCandidates.filter((l) =>
    selectedLeadIds.includes(l.contact_id),
  );
  const allVerifiableLeadsSelected =
    verificationCandidates.length > 0 &&
    selectedVerificationCandidates.length === verificationCandidates.length;
  useEffect(() => {
    setSelectedLeadIds([]);
  }, [
    query,
    stage,
    owner,
    period,
    view,
    leadStatus,
    page,
    profile.id,
    profile.role,
  ]);
  const toggleLeadSelection = (contactId: string, checked: boolean) => {
    setSelectedLeadIds((previous) =>
      checked
        ? [...new Set([...previous, contactId])]
        : previous.filter((id) => id !== contactId),
    );
  };
  const visibleIds = new Set(visible.map((o) => o.id));
  const tasks = data.tasks.filter(
    (task) =>
      visibleIds.has(task.opportunity_id) &&
      canSeeArea(
        profile,
        visible.find((o) => o.id === task.opportunity_id)!,
        task.area,
      ),
  );
  const overdue = tasks.filter(
    (task) => task.status === "open" && new Date(task.due_at) < new Date(),
  );
  const conversations = data.conversations.filter((c) =>
    visibleIds.has(c.opportunity_id),
  );
  const unread = conversations.filter((c) => c.needs_attention).length;
  const open = filtered.filter(
    (o) => !["funded", "lost", "paused"].includes(o.stage),
  );
  const isAdmin = ["superadmin", "seller_admin"].includes(profile.role);
  const canVerifyLeads = isAdmin && leadStatus !== "converted";
  const closerAdmin = ["superadmin", "closer_admin"].includes(profile.role);
  const ownerStats =
    data.stats?.owners ||
    data.profiles.map((p) => ({
      id: p.id,
      total: filtered.filter((o) => (o.closer_id || o.seller_id) === p.id)
        .length,
      amount: filtered
        .filter((o) => (o.closer_id || o.seller_id) === p.id)
        .reduce((sum, o) => sum + o.amount, 0),
    }));
  const name = (id: string | null) =>
    data.profiles.find((p) => p.id === id)?.name ||
    t(locale, "Sin asignar", "Unassigned");
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  async function refresh() {
    if (data.demo) return;
    const res = await fetch(`/api/workspace?${requestParams}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    setData(body);
  }
  const act: Action = async (kind, payload) => {
    let result: unknown;
    setBusy(true);
    setError("");
    try {
      if (data.demo) setData(demoAction(data, { ...profile }, kind, payload));
      else {
        const normalized = Object.fromEntries(
          Object.entries(payload).map(([key, value]) => [
            key,
            typeof value === "string" &&
            key.endsWith("_at") &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
              ? new Date(value).toISOString()
              : value,
          ]),
        );
        const fingerprint = JSON.stringify({ kind, payload: normalized });
        const key = requestKeys.current.get(fingerprint) || crypto.randomUUID();
        requestKeys.current.set(fingerprint, key);
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
        if (!res.ok) throw new Error(body.error || "Request failed");
        result = body.result;
        await refresh();
        requestKeys.current.delete(fingerprint);
      }
      if (kind === "verify_contacts") setSelectedLeadIds([]);
      setToast(
        data.demo
          ? t(
              locale,
              "Cambio aplicado en la demostración",
              "Change applied in this demo",
            )
          : ["compose_email", "compose_lenders", "reply", "mail_send"].includes(kind)
            ? t(
                locale,
                "Correo en cola. Consulta el estado de envíos.",
                "Email queued. Check sending status.",
              )
            : t(locale, "Cambios guardados", "Changes saved"),
      );
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Error";
      setError(message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  async function submit(
    e: FormEvent<HTMLFormElement>,
    kind: string,
    extra: Record<string, unknown> = {},
  ) {
    e.preventDefault();
    try {
      await act(kind, {
        ...Object.fromEntries(new FormData(e.currentTarget)),
        ...extra,
      });
      setModal(null);
    } catch {}
  }
  const navigate = (next: View) => {
    setView(next);
    setSelected(null);
    setMobile(false);
    setQuery("");
    setStage("all");
    setCampaignFilter("all");
  };
  const nav: {
    id: View;
    es: string;
    en: string;
    icon: typeof LayoutDashboard;
    count?: number;
  }[] = [
    { id: "overview", es: "Resumen", en: "Overview", icon: LayoutDashboard },
    {
      id: "leads",
      es: "Preparación de leads",
      en: "Lead preparation",
      icon: Users,
    },
    {
      id: "pipeline",
      es: "Oportunidades",
      en: "Opportunities",
      icon: KanbanSquare,
    },
    {
      id: "inbox",
      es: "Conversaciones",
      en: "Conversations",
      icon: Mail,
      count: unread,
    },
    { id: "campaigns", es: "Campañas", en: "Campaigns", icon: Send },
    {
      id: "tasks",
      es: "Tareas",
      en: "Tasks",
      icon: ListTodo,
      count: overdue.length,
    },
    { id: "lenders", es: "Lenders", en: "Lenders", icon: Landmark },
    { id: "reports", es: "Indicadores", en: "Reports", icon: BarChart3 },
    { id: "settings", es: "Configuración", en: "Settings", icon: Settings },
  ];
  const titles: Record<View, [string, string]> = {
    overview: [
      "Tu operación, en perspectiva.",
      "Your business, in perspective.",
    ],
    pipeline: ["Cada oportunidad cuenta.", "Every opportunity counts."],
    leads: ["El próximo paso empieza aquí.", "The next step starts here."],
    inbox: ["Conversaciones que avanzan.", "Conversations that move forward."],
    campaigns: [
      "Conecta con la próxima oportunidad.",
      "Connect with your next opportunity.",
    ],
    tasks: ["Enfócate en lo que sigue.", "Focus on what comes next."],
    lenders: ["Las conexiones correctas.", "The right connections."],
    reports: ["Resultados con contexto.", "Results in context."],
    settings: ["Un espacio a tu medida.", "Your workspace, your way."],
  };
  const activeOpportunity = visible.find((o) => o.id === selected);
  function cacheMailCase(
    scope?: Workspace,
    extra?: {
      attachment: NonNullable<Workspace["attachments"]>[number];
      message: Workspace["messages"][number];
      conversation: Workspace["conversations"][number];
    },
  ) {
    setData((previous) => {
      const result = { ...previous };
      const keys = [
        "opportunities",
        "documents",
        "analyses",
        "activities",
        "tasks",
        "submissions",
        "offers",
        "conversations",
        "messages",
        "attachments",
      ] as const;
      for (const key of keys) {
        const rows = [...(previous[key] || []), ...(scope?.[key] || [])];
        (result as unknown as Record<string, unknown>)[key] = [
          ...new Map(rows.map((row) => [row.id, row])).values(),
        ];
      }
      if (extra) {
        result.attachments = [
          ...new Map(
            [...(result.attachments || []), extra.attachment].map((a) => [
              a.id,
              a,
            ]),
          ).values(),
        ];
        result.messages = [
          ...new Map(
            [...result.messages, extra.message].map((m) => [m.id, m]),
          ).values(),
        ];
        result.conversations = [
          ...new Map(
            [...result.conversations, extra.conversation].map((c) => [c.id, c]),
          ).values(),
        ];
      }
      return result;
    });
  }
  async function openMailCase(id: string, scope?: Workspace) {
    try {
      if (!scope && !data.demo) {
        const response = await fetch(
          `/api/workspace?${new URLSearchParams({ case: id })}`,
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        scope = body;
      }
      cacheMailCase(scope);
      setSelected(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const table = (items: Opportunity[]) => (
    <div className="table-scroll">
      <table className="opportunity-table">
        <thead>
          <tr>
            <th>{t(locale, "Empresa / contacto", "Business / contact")}</th>
            <th>{t(locale, "Estado", "Stage")}</th>
            <th>{t(locale, "Monto solicitado", "Requested")}</th>
            <th>{t(locale, "Responsable", "Owner")}</th>
            <th>{t(locale, "Próxima acción", "Next action")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id} onClick={() => setSelected(o.id)}>
              <td>
                <button
                  className="company-link"
                  onClick={() => setSelected(o.id)}
                >
                  <span
                    className={`company-icon tone-${o.id.charCodeAt(o.id.length - 1) % 5}`}
                  >
                    {o.company
                      .split(" ")
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join("")}
                  </span>
                  <span>
                    <strong>{o.company}</strong>
                    <small>{o.contact}</small>
                  </span>
                </button>
              </td>
              <td>
                <StageBadge stage={o.stage} locale={locale} />
              </td>
              <td className="money">{currency(o.amount, locale)}</td>
              <td>
                <span className="person">
                  <Avatar name={name(o.closer_id || o.seller_id)} small />
                  <span>{name(o.closer_id || o.seller_id).split(" ")[0]}</span>
                </span>
              </td>
              <td className="next-action">
                <span>
                  {o.next_action ||
                    t(locale, "Sin próxima acción", "No next action")}
                </span>
                <small
                  className={
                    o.next_action_at &&
                    new Date(o.next_action_at) < new Date() &&
                    o.stage !== "funded"
                      ? "overdue"
                      : ""
                  }
                >
                  {dateLabel(o.next_action_at, locale)}
                </small>
              </td>
              <td>
                <ChevronRight size={16} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <Empty
          title={t(
            locale,
            "No hay oportunidades con estos filtros",
            "No opportunities match these filters",
          )}
        />
      )}
    </div>
  );
  const filters = (
    <div className="filters">
      <div className="input-icon">
        <Search size={17} />
        <input
          aria-label={
            view === "leads"
              ? t(locale, "Buscar leads", "Search leads")
              : t(locale, "Buscar oportunidades", "Search opportunities")
          }
          placeholder={t(
            locale,
            "Buscar empresa, contacto o correo…",
            "Search business, contact or email…",
          )}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <select
        aria-label="Stage"
        value={stage}
        onChange={(e) => setStage(e.target.value)}
      >
        <option value="all">
          {t(locale, "Todos los estados", "All stages")}
        </option>
        {view === "leads"
          ? leadTabVerifications[leadStatus].map((s) => (
              <option key={s} value={s}>
                {t(
                  locale,
                  {
                    pending: "Pendiente",
                    valid: "Válido",
                    invalid: "Inválido",
                    uncertain: "Incierto",
                  }[s]!,
                  {
                    pending: "Pending",
                    valid: "Valid",
                    invalid: "Invalid",
                    uncertain: "Uncertain",
                  }[s]!,
                )}
              </option>
            ))
          : stages.map((s) => (
              <option key={s} value={s}>
                {stageLabels[locale][s]}
              </option>
            ))}
      </select>
      <select
        aria-label="Owner"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
      >
        <option value="all">
          {t(locale, "Todos los responsables", "All owners")}
        </option>
        {data.profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        className={`button ${modal === "filters" ? "selected" : ""}`}
        onClick={() => setModal("filters")}
      >
        <SlidersHorizontal size={16} />
        {t(locale, "Filtros", "Filters")}
        {(campaignFilter !== "all" || period !== "all") && (
          <span className="filter-dot" />
        )}
      </button>
    </div>
  );
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href={data.demo ? "/demo" : "/"}>
          <img src="/icon.svg" alt="" width="38" height="38" />
          <span>
            curated<span>FINANCIAL</span>
          </span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>CF</span>
        </div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{t(locale, item.es, item.en)}</span>
              {!!item.count && <b>{item.count}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <ShieldCheck size={22} />
            <strong>
              {t(locale, "Todo en su lugar.", "Everything in its place.")}
            </strong>
            <p>
              {t(
                locale,
                "Personas, decisiones y próximos pasos conectados.",
                "People, decisions and next steps, connected.",
              )}
            </p>
          </div>
          <div className="sidebar-user">
            <Avatar name={profile.name} />
            <div>
              <strong>{profile.name}</strong>
              <span>{roleLabels[profile.role]}</span>
            </div>
            {!data.demo && (
              <button
                className="icon-button"
                title="Sign out"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  location.href = "/login";
                }}
              >
                <LogOut size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className={`main-shell ${view === "inbox" && !activeOpportunity ? "conversations-shell" : ""}`}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              onClick={() => setMobile(true)}
              aria-label="Menu"
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {view === "settings"
                ? t(locale, "Configuración", "Settings")
                : t(
                    locale,
                    nav.find((n) => n.id === view)!.es,
                    nav.find((n) => n.id === view)!.en,
                  )}
            </strong>
          </div>
          <div className="topbar-actions">
            <button
              className="language-button"
              onClick={() => setLocale(locale === "es" ? "en" : "es")}
            >
              <Globe size={16} />
              {locale.toUpperCase()}
              <ChevronDown size={12} />
            </button>
            <div className="notification-wrap">
              <button
                className="icon-button"
                aria-label={t(locale, "Notificaciones", "Notifications")}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={20} />
                {data.notifications.some((n) => !n.read_at) && (
                  <span className="notification-dot" />
                )}
              </button>
              {notifications && (
                <div className="notification-menu">
                  <h3>{t(locale, "Notificaciones", "Notifications")}</h3>
                  {data.notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        act("read_notification", { id: n.id }).catch(() => {});
                      }}
                    >
                      <span className={!n.read_at ? "unread-mark" : ""} />
                      <div>
                        <strong>{n.title}</strong>
                        <p>{n.body}</p>
                        <small>{dateLabel(n.created_at, locale, true)}</small>
                      </div>
                      {n.read_at && <Check size={14} />}
                    </button>
                  ))}
                  {!data.notifications.length && (
                    <Empty title={t(locale, "Todo al día", "All caught up")} />
                  )}
                </div>
              )}
            </div>
            <span className="topbar-divider" />
            <Avatar name={profile.name} small />
          </div>
        </header>
        {data.demo && (
          <div className="demo-banner">
            <span>
              <span className="demo-pill">DEMO</span>
              {t(
                locale,
                "Datos ficticios · los cambios se reinician al recargar",
                "Sample data · changes reset when you reload",
              )}
            </span>
            <select
              aria-label="Demo role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
                setSelected(null);
              }}
            >
              {Object.entries(roleLabels).map(([r, label]) => (
                <option key={r} value={r}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
        <main className={`content ${view === "inbox" && !activeOpportunity ? "conversations-content" : ""}`}>
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {activeOpportunity ? (
            <OpportunityDetail
              opportunity={activeOpportunity}
              data={data}
              profile={profile}
              locale={locale}
              act={act}
              busy={busy}
              back={() => setSelected(null)}
              refresh={refresh}
            />
          ) : (
            <>
              {view !== "inbox" && <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {view === "overview"
                      ? t(
                          locale,
                          "TU CENTRO DE OPERACIONES",
                          "YOUR OPERATIONS HUB",
                        )
                      : "CURATED FINANCIAL"}
                  </div>
                  <h1>{t(locale, ...titles[view])}</h1>
                  <p>
                    {view === "overview"
                      ? t(
                          locale,
                          `Tienes ${overdue.length} tareas vencidas y ${unread} respuesta pendiente de atención.`,
                          `You have ${overdue.length} overdue tasks and ${unread} reply awaiting attention.`,
                        )
                      : t(
                          locale,
                          "Cada caso, con un responsable y un próximo paso.",
                          "Every case, with an owner and a next step.",
                        )}
                  </p>
                </div>
                <div className="heading-actions">
                  {data.gmail_history_enabled &&
                    ["pipeline", "inbox"].includes(view) && (
                      <button
                        className="button primary"
                        onClick={() => setComposing(true)}
                      >
                        <Mail size={16} />
                        {t(locale, "Nuevo correo", "New email")}
                      </button>
                    )}
                  {["overview", "pipeline", "leads"].includes(view) && (
                    <>
                      {isAdmin && (
                        <button
                          className="button"
                          onClick={() => setModal("import")}
                        >
                          <Upload size={16} />
                          {t(locale, "Importar leads", "Import leads")}
                        </button>
                      )}
                      {["superadmin", "seller_admin", "seller"].includes(
                        profile.role,
                      ) && (
                        <button
                          className="button primary"
                          onClick={() =>
                            setModal(view === "leads" ? "lead" : "opportunity")
                          }
                        >
                          <Plus size={17} />
                          {view === "leads"
                            ? t(locale, "Nuevo lead", "New lead")
                            : t(locale, "Nueva oportunidad", "New opportunity")}
                        </button>
                      )}
                    </>
                  )}
                  {view === "campaigns" && isAdmin && (
                    <button
                      className="button primary"
                      onClick={() => setModal("campaign")}
                    >
                      <Plus size={17} />
                      {t(locale, "Crear campaña", "Create campaign")}
                    </button>
                  )}
                  {view === "lenders" && closerAdmin && (
                    <button
                      className="button primary"
                      onClick={() => setModal("lender")}
                    >
                      <Plus size={17} />
                      {t(locale, "Agregar lender", "Add lender")}
                    </button>
                  )}
                  {view === "tasks" && (
                    <button
                      className="button primary"
                      onClick={() => setModal("task")}
                    >
                      <Plus size={17} />
                      {t(locale, "Nueva tarea", "New task")}
                    </button>
                  )}
                </div>
              </div>
              }
              {["overview", "reports"].includes(view) && (
                <div className="metrics">
                  <Metric
                    label={t(locale, "Pipeline activo", "Active pipeline")}
                    value={currency(
                      data.stats?.active_amount ??
                        open.reduce((s, o) => s + o.amount, 0),
                      locale,
                    )}
                    note={`${data.stats?.active_count ?? open.length} ${t(locale, "oportunidades abiertas", "open opportunities")}`}
                    icon={<KanbanSquare size={18} />}
                  />
                  <Metric
                    label={t(locale, "Desembolsado", "Funded")}
                    value={currency(
                      data.stats?.funded_amount ??
                        filtered.reduce(
                          (s, o) => s + (o.funded_amount || 0),
                          0,
                        ),
                      locale,
                    )}
                    note={`${data.stats?.funded_count ?? filtered.filter((o) => o.stage === "funded").length} ${t(locale, "operaciones completadas", "completed deals")}`}
                    icon={<ArrowUpRight size={18} />}
                    featured
                  />
                  <Metric
                    label={t(locale, "En análisis", "Under review")}
                    value={String(
                      data.stats?.review_count ??
                        filtered.filter((o) =>
                          ["analysis", "documents_pending"].includes(o.stage),
                        ).length,
                    ).padStart(2, "0")}
                    note={t(
                      locale,
                      "Expedientes en preparación",
                      "Files being prepared",
                    )}
                    icon={<FileText size={18} />}
                  />
                  <Metric
                    label={t(locale, "Requieren atención", "Need attention")}
                    value={String(
                      data.stats
                        ? data.stats.overdue + data.stats.unread
                        : overdue.length + unread,
                    ).padStart(2, "0")}
                    note={t(
                      locale,
                      "Tareas vencidas y respuestas",
                      "Overdue tasks and replies",
                    )}
                    icon={<Clock3 size={18} />}
                  />
                </div>
              )}
              {view === "overview" && (
                <div className="overview-middle">
                  <section className="panel pipeline-summary">
                    <div className="section-heading">
                      <h2>
                        {t(
                          locale,
                          "El recorrido de tus oportunidades",
                          "Your opportunity journey",
                        )}
                      </h2>
                      <span>
                        {data.stats?.total ?? visible.length}{" "}
                        {t(locale, "en total", "total")}
                      </span>
                    </div>
                    <div className="stage-summary">
                      {[
                        {
                          label: t(locale, "Contacto", "Contact"),
                          stages: ["new", "contacting", "replied"],
                          color: "blue",
                        },
                        {
                          label: t(locale, "Preparación", "Preparation"),
                          stages: [
                            "application_pending",
                            "documents_pending",
                            "analysis",
                          ],
                          color: "purple",
                        },
                        {
                          label: "Closer",
                          stages: ["ready_for_closer", "unassigned", "lenders"],
                          color: "orange",
                        },
                        {
                          label: t(locale, "Negociación", "Negotiation"),
                          stages: [
                            "offers",
                            "negotiation",
                            "accepted",
                            "funding_pending",
                          ],
                          color: "teal",
                        },
                        {
                          label: t(locale, "Desembolsado", "Funded"),
                          stages: ["funded"],
                          color: "green",
                        },
                      ].map((group) => {
                        const count = data.stats
                          ? group.stages.reduce(
                              (sum, s) =>
                                sum +
                                (data.stats!.stage_counts[s as Stage] || 0),
                              0,
                            )
                          : visible.filter((o) =>
                              group.stages.includes(o.stage),
                            ).length;
                        return (
                          <button
                            key={group.label}
                            onClick={() => {
                              navigate("pipeline");
                              setStage(group.stages[0]);
                            }}
                          >
                            <span className={`stage-line ${group.color}`} />
                            <span>{group.label}</span>
                            <strong>
                              {String(count).padStart(2, "0")}
                              <ChevronRight size={15} />
                            </strong>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section className="focus-card">
                    <div className="focus-icon">
                      <Clock3 size={21} />
                    </div>
                    <div>
                      <span>
                        {t(
                          locale,
                          "QUE NADA SE QUEDE ATRÁS",
                          "KEEP THINGS MOVING",
                        )}
                      </span>
                      <h3>
                        {visible.filter((o) => !o.next_action).length}{" "}
                        {t(
                          locale,
                          "caso sin próxima acción",
                          "case without a next action",
                        )}
                      </h3>
                      <button
                        onClick={() => {
                          const o = visible.find((o) => !o.next_action);
                          if (o) setSelected(o.id);
                          else navigate("tasks");
                        }}
                      >
                        {t(locale, "Revisar seguimiento", "Review follow-up")}
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </section>
                </div>
              )}
              {["overview", "pipeline"].includes(view) && (
                <section className="panel">
                  <div className="section-heading">
                    <div className="section-tabs">
                      <button
                        className="active"
                        onClick={() => setStage("all")}
                      >
                        {t(locale, "Oportunidades", "Opportunities")}{" "}
                        <span>{filtered.length}</span>
                      </button>
                      <button
                        onClick={() => {
                          setStage("unassigned");
                        }}
                      >
                        {t(locale, "Por asignar", "Awaiting assignment")}{" "}
                        <span>
                          {
                            visible.filter((o) => o.stage === "unassigned")
                              .length
                          }
                        </span>
                      </button>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setModal("filters")}
                    >
                      {t(locale, "Personalizar vista", "Customize view")}
                      <SlidersHorizontal size={15} />
                    </button>
                  </div>
                  {filters}
                  {table(view === "overview" ? filtered.slice(0, 6) : filtered)}
                  <div className="table-footer">
                    <span>
                      {t(
                        locale,
                        `Mostrando ${Math.min(filtered.length, view === "overview" ? 6 : filtered.length)} de ${filtered.length} oportunidades`,
                        `Showing ${Math.min(filtered.length, view === "overview" ? 6 : filtered.length)} of ${filtered.length} opportunities`,
                      )}
                    </span>
                    {view === "overview" && (
                      <button
                        className="text-button"
                        onClick={() => navigate("pipeline")}
                      >
                        {t(
                          locale,
                          "Ver todas las oportunidades",
                          "View all opportunities",
                        )}
                        <ChevronRight size={15} />
                      </button>
                    )}
                  </div>
                </section>
              )}
              {view === "leads" && (
                <>
                  <div className="split-heading lead-heading">
                    <div
                      className="tabs lead-tabs"
                      role="group"
                      aria-label={t(
                        locale,
                        "Bandejas de leads",
                        "Lead inboxes",
                      )}
                    >
                      {leadTabs.map((tab) => (
                        <button
                          key={tab}
                          className={leadStatus === tab ? "active" : ""}
                          aria-pressed={leadStatus === tab}
                          onClick={() => {
                            setLeadStatus(tab);
                            setStage("all");
                            setPage(0);
                          }}
                        >
                          {t(locale, ...leadTabLabels[tab])}
                        </button>
                      ))}
                    </div>
                    {canVerifyLeads && (
                      <button
                        className="button"
                        onClick={() => setModal("verify")}
                        disabled={
                          busy ||
                          loading ||
                          selectedVerificationCandidates.length === 0
                        }
                      >
                        <ShieldCheck size={17} />
                        {t(
                          locale,
                          "Verificar seleccionados",
                          "Verify selected",
                        )}
                        {` (${selectedVerificationCandidates.length})`}
                      </button>
                    )}
                  </div>
                  <section className="panel">
                    <p className="muted">
                      {t(locale, ...leadTabDescriptions[leadStatus])}
                    </p>
                    {filters}
                    {canVerifyLeads && (
                      <div className="lead-selection-bar">
                        <div>
                          <strong aria-live="polite">
                            {t(
                              locale,
                              `${selectedVerificationCandidates.length} seleccionados · ${verificationCandidates.length} verificables en esta página`,
                              `${selectedVerificationCandidates.length} selected · ${verificationCandidates.length} verifiable on this page`,
                            )}
                          </strong>
                          <p className="muted">
                            {t(
                              locale,
                              "Marca algunos leads o usa la casilla del encabezado para seleccionar todos los verificables de esta página.",
                              "Choose individual leads or use the header checkbox to select all verifiable leads on this page.",
                            )}
                          </p>
                        </div>
                        <button
                          className="text-button"
                          disabled={
                            busy || selectedVerificationCandidates.length === 0
                          }
                          onClick={() => setSelectedLeadIds([])}
                        >
                          {t(locale, "Limpiar selección", "Clear selection")}
                        </button>
                      </div>
                    )}
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {canVerifyLeads && (
                              <th className="lead-selection-cell">
                                <input
                                  type="checkbox"
                                  className="lead-checkbox"
                                  aria-label={t(
                                    locale,
                                    "Seleccionar todos los leads verificables de esta página",
                                    "Select all verifiable leads on this page",
                                  )}
                                  title={t(
                                    locale,
                                    "Seleccionar todos los leads verificables de esta página",
                                    "Select all verifiable leads on this page",
                                  )}
                                  checked={allVerifiableLeadsSelected}
                                  ref={(input) => {
                                    if (input)
                                      input.indeterminate =
                                        selectedVerificationCandidates.length >
                                          0 && !allVerifiableLeadsSelected;
                                  }}
                                  disabled={
                                    busy ||
                                    loading ||
                                    verificationCandidates.length === 0
                                  }
                                  onChange={(event) =>
                                    setSelectedLeadIds(
                                      event.target.checked
                                        ? verificationCandidates.map(
                                            (l) => l.contact_id,
                                          )
                                        : [],
                                    )
                                  }
                                />
                              </th>
                            )}
                            <th>{t(locale, "Contacto", "Contact")}</th>
                            <th>{t(locale, "Empresa", "Business")}</th>
                            <th>Email</th>
                            <th>{t(locale, "Verificación", "Verification")}</th>
                            <th>{t(locale, "Responsable", "Owner")}</th>
                            <th>{t(locale, "Resultado", "Result")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLeads.map((o) => (
                            <tr key={o.id}>
                              {canVerifyLeads && (
                                <td className="lead-selection-cell">
                                  <input
                                    type="checkbox"
                                    className="lead-checkbox"
                                    aria-label={t(
                                      locale,
                                      `Seleccionar ${o.contact || o.company}`,
                                      `Select ${o.contact || o.company}`,
                                    )}
                                    checked={selectedVerificationCandidates.some(
                                      (l) => l.contact_id === o.contact_id,
                                    )}
                                    disabled={
                                      busy ||
                                      loading ||
                                      !verificationCandidates.some(
                                        (l) => l.contact_id === o.contact_id,
                                      )
                                    }
                                    title={
                                      !verificationCandidates.some(
                                        (l) => l.contact_id === o.contact_id,
                                      )
                                        ? t(
                                            locale,
                                            "Este lead ya fue verificado, está bloqueado o tiene una verificación en proceso o pendiente de revisión.",
                                            "This lead is already verified, suppressed, or has a verification in progress or awaiting review.",
                                          )
                                        : undefined
                                    }
                                    onChange={(event) =>
                                      toggleLeadSelection(
                                        o.contact_id,
                                        event.target.checked,
                                      )
                                    }
                                  />
                                </td>
                              )}
                              <td>{o.contact}</td>
                              <td>{o.company}</td>
                              <td>{o.email}</td>
                              <td>
                                <VerificationBadge
                                  status={o.verification}
                                  locale={locale}
                                />
                              </td>
                              <td>{name(o.seller_id)}</td>
                              <td>
                                {o.opportunity_id ? (
                                  <button
                                    className="text-button"
                                    onClick={() => {
                                      setSelected(o.opportunity_id);
                                      setView("pipeline");
                                    }}
                                  >
                                    {t(
                                      locale,
                                      "Ver oportunidad",
                                      "View opportunity",
                                    )}
                                  </button>
                                ) : o.suppressed ? (
                                  t(locale, "Bloqueado", "Suppressed")
                                ) : ["queued", "submitted"].includes(
                                    o.verification_state || "",
                                  ) ? (
                                  t(
                                    locale,
                                    "Verificación en proceso",
                                    "Verification in progress",
                                  )
                                ) : o.verification_state ===
                                  "uncertain_request" ? (
                                  t(
                                    locale,
                                    "Verificación requiere revisión",
                                    "Verification needs review",
                                  )
                                ) : o.verification_state ===
                                  "technical_error" ? (
                                  t(
                                    locale,
                                    "Error técnico; revisar",
                                    "Technical error; review",
                                  )
                                ) : o.verification === "invalid" ? (
                                  t(
                                    locale,
                                    "Correo inválido; excluido",
                                    "Invalid email; excluded",
                                  )
                                ) : o.verification === "uncertain" ? (
                                  t(locale, "Requiere revisión", "Needs review")
                                ) : (
                                  t(locale, "En preparación", "In preparation")
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  {!filteredLeads.length && (
                    <Empty title={t(locale, ...leadTabEmpty[leadStatus])} />
                  )}
                  <section className="panel spaced">
                    <div className="section-heading">
                      <h2>
                        {t(locale, "Lotes de importación", "Import batches")}
                      </h2>
                      <button
                        className="icon-button"
                        aria-label="Refresh imports"
                        onClick={() =>
                          refresh().catch((e) => setError(e.message))
                        }
                      >
                        <RefreshCw size={17} />
                      </button>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>{t(locale, "Archivo", "File")}</th>
                            <th>{t(locale, "Progreso", "Progress")}</th>
                            <th>{t(locale, "Importados", "Imported")}</th>
                            <th>{t(locale, "Duplicados", "Duplicates")}</th>
                            <th>
                              {t(
                                locale,
                                "Omitidos / errores",
                                "Skipped / errors",
                              )}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.imports.map((batch) => (
                            <tr key={batch.id}>
                              <td>
                                <strong>{batch.name}</strong>
                                <small className="block">
                                  {dateLabel(batch.created_at, locale)}
                                </small>
                                {!data.demo && (
                                  <a
                                    className="text-button"
                                    href={`/api/import/${batch.id}/report`}
                                  >
                                    {t(
                                      locale,
                                      "Descargar informe",
                                      "Download report",
                                    )}
                                  </a>
                                )}
                              </td>
                              <td>
                                <div className="progress">
                                  <i
                                    style={{
                                      width: `${batch.total ? (batch.processed / batch.total) * 100 : 0}%`,
                                    }}
                                  />
                                </div>
                                <small>
                                  {batch.processed.toLocaleString()} /{" "}
                                  {batch.total.toLocaleString()} ·{" "}
                                  {batch.status}
                                </small>
                              </td>
                              <td>{batch.imported.toLocaleString()}</td>
                              <td>{batch.duplicates}</td>
                              <td>
                                {batch.skipped} / {batch.errors}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!data.imports.length && (
                      <Empty
                        title={t(
                          locale,
                          "Todavía no hay importaciones",
                          "No imports yet",
                        )}
                      />
                    )}
                  </section>
                </>
              )}
              {view === "tasks" && (
                <section className="panel">
                  <div className="section-heading">
                    <h2>{t(locale, "Pendientes del equipo", "Team to-dos")}</h2>
                    <span>
                      {tasks.filter((task) => task.status === "open").length}{" "}
                      {t(locale, "pendientes", "open")}
                    </span>
                  </div>
                  {tasks
                    .sort((a, b) => a.due_at.localeCompare(b.due_at))
                    .map((task) => (
                      <div
                        className={`task-row ${task.status === "done" ? "done" : ""}`}
                        key={task.id}
                      >
                        <button
                          className="task-check"
                          disabled={busy || task.status === "done"}
                          aria-label={t(
                            locale,
                            "Completar tarea",
                            "Complete task",
                          )}
                          onClick={() =>
                            act("complete_task", { id: task.id }).catch(
                              () => {},
                            )
                          }
                        >
                          {task.status === "done" && <Check size={15} />}
                        </button>
                        <div>
                          <button
                            className="task-title"
                            onClick={() => setSelected(task.opportunity_id)}
                          >
                            {task.title}
                          </button>
                          <small>
                            {
                              visible.find((o) => o.id === task.opportunity_id)
                                ?.company
                            }
                          </small>
                        </div>
                        <span
                          className={`task-date ${new Date(task.due_at) < new Date() && task.status !== "done" ? "overdue" : ""}`}
                        >
                          <Clock3 size={14} />
                          {dateLabel(task.due_at, locale, true)}
                        </span>
                        <Avatar name={name(task.owner_id)} small />
                      </div>
                    ))}
                  {!tasks.length && (
                    <Empty
                      title={t(
                        locale,
                        "No hay tareas pendientes",
                        "No tasks yet",
                      )}
                    />
                  )}
                </section>
              )}
              {view === "inbox" && (
                <MailInbox
                  data={{ ...data, profile }}
                  locale={locale}
                  act={act}
                  busy={busy}
                  openCase={openMailCase}
                  onAttachment={(attachment, message, conversation, scope) => {
                    cacheMailCase(scope, { attachment, message, conversation });
                    setModal(`attachment:${attachment.id}`);
                  }}
                />
              )}
              {view === "campaigns" && (
                <div className="campaign-grid">
                  {data.campaigns.map((c) => (
                    <section className="panel campaign-card" key={c.id}>
                      <div className="card-top">
                        <span className="large-icon">
                          <Send size={22} />
                        </span>
                        <span
                          className={`badge ${c.status === "active" ? "stage-funded" : ""}`}
                        >
                          {c.status}
                        </span>
                      </div>
                      <h2>{c.name}</h2>
                      <p>
                        {
                          data.accounts.find((a) => a.id === c.account_id)
                            ?.email
                        }
                      </p>
                      <div className="campaign-meta">
                        <span>
                          {t(
                            locale,
                            "Seller responsable",
                            "Responsible seller",
                          )}
                          <strong>{name(c.seller_id)}</strong>
                        </span>
                        <span>
                          {t(locale, "Audiencia", "Audience")}
                          <strong>{c.audience_count} leads</strong>
                        </span>
                        <span>
                          {t(locale, "Límite diario", "Daily limit")}
                          <strong>{c.daily_limit}</strong>
                        </span>
                        <span>
                          {t(locale, "Horario", "Schedule")}
                          <strong>
                            {c.start_hour}:00–{c.end_hour}:00
                          </strong>
                        </span>
                      </div>
                      <small>
                        {c.timezone} · {c.steps.length + 1}{" "}
                        {t(locale, "paso(s)", "step(s)")}
                      </small>
                      <div className="card-actions">
                        <button
                          className="button"
                          onClick={() => setModal(`preview:${c.id}`)}
                        >
                          {t(locale, "Vista previa", "Preview")}
                        </button>
                        {isAdmin && (
                          <button
                            disabled={busy}
                            className="button primary"
                            onClick={() =>
                              act(
                                c.status === "active"
                                  ? "pause_campaign"
                                  : "activate_campaign",
                                { id: c.id },
                              ).catch(() => {})
                            }
                          >
                            {c.status === "active"
                              ? t(locale, "Pausar", "Pause")
                              : t(locale, "Activar", "Activate")}
                          </button>
                        )}
                      </div>
                    </section>
                  ))}
                  {!data.campaigns.length && (
                    <Empty
                      title={t(
                        locale,
                        "Crea tu primera campaña",
                        "Create your first campaign",
                      )}
                      body={t(
                        locale,
                        "Selecciona audiencia, cuenta y responsable por separado.",
                        "Choose an audience, sender account and owner independently.",
                      )}
                    />
                  )}
                </div>
              )}
              {view === "lenders" &&
                data.gmail_history_enabled &&
                !data.demo && (
                  <LenderContacts
                    data={data}
                    locale={locale}
                    act={act}
                    busy={busy}
                  />
                )}
              {view === "lenders" && (
                <div className="lender-grid">
                  {data.lenders.map((l) => (
                    <section className="panel lender-card" key={l.id}>
                      <div className="lender-logo">
                        <Landmark size={24} />
                      </div>
                      <h2>{l.name}</h2>
                      <div className="product-tags">
                        {l.products.map((p) => (
                          <span key={p}>{p}</span>
                        ))}
                      </div>
                      <dl>
                        <dt>
                          {t(
                            locale,
                            "Canal de presentación",
                            "Submission channel",
                          )}
                        </dt>
                        <dd>{l.channel}</dd>
                        <dt>{t(locale, "Contacto", "Contact")}</dt>
                        <dd>{l.email}</dd>
                      </dl>
                      <p>{l.notes}</p>
                      {closerAdmin && (
                        <button
                          className="button"
                          onClick={() => setModal(`lender:${l.id}`)}
                        >
                          {t(locale, "Editar lender", "Edit lender")}
                        </button>
                      )}
                    </section>
                  ))}
                </div>
              )}
              {view === "reports" && (
                <>
                  {filters}
                  <div className="reports-grid">
                    <section className="panel report-panel">
                      <h2>
                        {t(locale, "Conversión por etapa", "Stage conversion")}
                      </h2>
                      {[
                        {
                          label: t(locale, "Importados", "Imported"),
                          count:
                            data.stats?.imported ??
                            data.imports.reduce((s, b) => s + b.imported, 0),
                        },
                        {
                          label: t(locale, "Verificados", "Verified"),
                          count:
                            data.stats?.verified ??
                            filtered.filter((o) => o.verification === "valid")
                              .length,
                        },
                        {
                          label: t(locale, "Contactados", "Contacted"),
                          count:
                            data.stats?.contacted ??
                            filtered.filter((o) => o.last_contact).length,
                        },
                        {
                          label: t(
                            locale,
                            "Aplicaciones completas",
                            "Complete applications",
                          ),
                          count:
                            data.stats?.applications ??
                            filtered.filter((o) => o.application_complete)
                              .length,
                        },
                        {
                          label: t(locale, "Transferidos", "Handed off"),
                          count:
                            data.stats?.transferred ??
                            filtered.filter((o) => o.handed_off_at).length,
                        },
                        {
                          label: t(locale, "Con ofertas", "With offers"),
                          count:
                            data.stats?.offers ??
                            filtered.filter((o) =>
                              data.offers.some(
                                (f) => f.opportunity_id === o.id,
                              ),
                            ).length,
                        },
                        {
                          label: t(locale, "Desembolsados", "Funded"),
                          count:
                            data.stats?.funded_count ??
                            filtered.filter((o) => o.stage === "funded").length,
                        },
                      ].map((r, i) => (
                        <div className="funnel-row" key={r.label}>
                          <span>{r.label}</span>
                          <div>
                            <i
                              style={{
                                width: `${Math.min(100, Math.max(2, (r.count / Math.max(1, data.stats?.total ?? filtered.length)) * 100))}%`,
                                opacity: 1 - i * 0.08,
                              }}
                            />
                          </div>
                          <strong>{r.count.toLocaleString()}</strong>
                        </div>
                      ))}
                      <p className="muted">
                        {t(
                          locale,
                          "Métricas de las oportunidades filtradas y visibles para tu rol. Los tiempos incluyen las etapas en curso.",
                          "Metrics cover filtered opportunities visible to your role. Stage durations include stages in progress.",
                        )}
                      </p>
                    </section>
                    <section className="panel report-panel">
                      <h2>
                        {t(
                          locale,
                          "Distribución por responsable",
                          "Distribution by owner",
                        )}
                      </h2>
                      {data.profiles
                        .filter((p) =>
                          ownerStats.some(
                            (row) => row.id === p.id && row.total > 0,
                          ),
                        )
                        .map((p) => (
                          <div className="owner-report" key={p.id}>
                            <Avatar name={p.name} />
                            <div>
                              <strong>{p.name}</strong>
                              <small>
                                {ownerStats.find((row) => row.id === p.id)
                                  ?.total || 0}{" "}
                                {t(locale, "oportunidades", "opportunities")}
                              </small>
                            </div>
                            <strong>
                              {currency(
                                ownerStats.find((row) => row.id === p.id)
                                  ?.amount || 0,
                                locale,
                              )}
                            </strong>
                          </div>
                        ))}
                      {data.stats && (
                        <>
                          <h2>
                            {t(
                              locale,
                              "Tiempo medio por etapa",
                              "Average time by stage",
                            )}
                          </h2>
                          {Object.entries(data.stats.stage_days).map(
                            ([stage, days]) => (
                              <div className="owner-report" key={stage}>
                                <span>
                                  {stageLabels[locale][stage as Stage]}
                                </span>
                                <strong>
                                  {days} {t(locale, "días", "days")}
                                </strong>
                              </div>
                            ),
                          )}
                        </>
                      )}
                    </section>
                  </div>
                </>
              )}
              {view === "settings" && (
                <div className="settings-grid">
                  {profile.role === "superadmin" && (
                    <Integrations
                      data={data}
                      locale={locale}
                      act={act}
                      busy={busy}
                      openCase={(id) => {
                        setSelected(id);
                        setView("pipeline");
                      }}
                    />
                  )}
                  <section className="panel settings-panel">
                    <h2>{t(locale, "Cuentas de correo", "Email accounts")}</h2>
                    <p>
                      {t(
                        locale,
                        "El acceso al remitente es independiente del acceso a los casos.",
                        "Sender access is separate from case access.",
                      )}
                    </p>
                    {data.accounts.map((a) => (
                      <div className="account-row" key={a.id}>
                        <span className="gmail-icon">M</span>
                        <div>
                          <strong>{a.email}</strong>
                          <small>
                            {a.organization} · {a.sent_today}/{a.daily_limit}
                          </small>
                        </div>
                        <span
                          className={`badge ${a.status === "connected" ? "stage-funded" : "stage-documents_pending"}`}
                        >
                          {a.status}
                        </span>
                      </div>
                    ))}
                    {profile.role === "superadmin" &&
                      !data.gmail_history_enabled && (
                        <button
                          className="button"
                          onClick={() => setModal("google")}
                        >
                          <Plus size={16} />
                          {t(
                            locale,
                            "Conectar Google Workspace",
                            "Connect Google Workspace",
                          )}
                        </button>
                      )}
                  </section>
                  <section className="panel settings-panel">
                    <h2>
                      {t(locale, "Tus notificaciones", "Your notifications")}
                    </h2>
                    {(["internal", "email", "push"] as const).map((channel) => (
                      <label className="preference-row" key={channel}>
                        <span>
                          <strong>
                            {channel === "internal"
                              ? t(
                                  locale,
                                  "Dentro de la aplicación",
                                  "In-app notifications",
                                )
                              : channel === "email"
                                ? t(
                                    locale,
                                    "Correo electrónico",
                                    "Email notifications",
                                  )
                                : "Push"}
                          </strong>
                          <small>
                            {channel === "push"
                              ? t(
                                  locale,
                                  "En iPhone: instala la web en inicio y permite notificaciones.",
                                  "On iPhone: add the app to Home Screen and allow notifications.",
                                )
                              : t(
                                  locale,
                                  "Avisos sin información financiera sensible.",
                                  "Updates without sensitive financial information.",
                                )}
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={data.preferences[channel]}
                          onChange={async (e) => {
                            const enabled = e.target.checked;
                            if (channel === "push" && enabled && !data.demo) {
                              try {
                                if (
                                  !("Notification" in window) ||
                                  !("PushManager" in window)
                                )
                                  throw new Error(
                                    t(
                                      locale,
                                      "Este navegador no admite push.",
                                      "This browser does not support push.",
                                    ),
                                  );
                                const permission =
                                  await Notification.requestPermission();
                                if (permission !== "granted")
                                  throw new Error(
                                    t(
                                      locale,
                                      "No se concedió permiso para push.",
                                      "Push permission was not granted.",
                                    ),
                                  );
                                const res = await fetch("/api/push");
                                const config = await res.json();
                                if (!res.ok) throw new Error(config.error);
                                const registration =
                                  await navigator.serviceWorker.ready;
                                const subscription =
                                  await registration.pushManager.subscribe({
                                    userVisibleOnly: true,
                                    applicationServerKey: config.publicKey,
                                  });
                                await act("push_subscription", {
                                  subscription: subscription.toJSON(),
                                });
                              } catch (e) {
                                setError((e as Error).message);
                                return;
                              }
                            }
                            act("preferences", {
                              ...data.preferences,
                              [channel]: enabled,
                              locale,
                            }).catch(() => {});
                          }}
                        />
                      </label>
                    ))}
                  </section>
                  <section className="panel settings-panel">
                    <h2>
                      {t(locale, "Equipo y permisos", "Team and permissions")}
                    </h2>
                    {data.profiles.map((p) => (
                      <div className="team-row" key={p.id}>
                        <Avatar name={p.name} small />
                        <div>
                          <strong>{p.name}</strong>
                          <small>{p.email}</small>
                        </div>
                        <span className="badge">{roleLabels[p.role]}</span>
                      </div>
                    ))}
                    {profile.role === "superadmin" && (
                      <button
                        className="button"
                        onClick={() => setModal("invite")}
                      >
                        <Plus size={16} />
                        {t(locale, "Invitar usuario", "Invite user")}
                      </button>
                    )}
                  </section>
                  <section className="panel settings-panel">
                    <h2>
                      {t(
                        locale,
                        "Documentación por producto",
                        "Documents by product",
                      )}
                    </h2>
                    <p>
                      {t(
                        locale,
                        "El checklist inicial requiere la aplicación firmada y los cuatro últimos extractos. Cada documento debe revisarse antes del traspaso.",
                        "The initial checklist requires a signed application and the latest four bank statements. Each document must be reviewed before handoff.",
                      )}
                    </p>
                    {profile.role === "superadmin" && (
                      <button
                        className="button"
                        onClick={() => setModal("requirements")}
                      >
                        {t(
                          locale,
                          "Configurar checklist",
                          "Configure checklist",
                        )}
                      </button>
                    )}
                    <div className="security-note">
                      <ShieldCheck size={20} />
                      <span>
                        {t(
                          locale,
                          "Acceso por invitación · segundo factor · archivos privados",
                          "Invite-only access · second factor · private files",
                        )}
                      </span>
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          {!data.demo &&
            !selected &&
            ["pipeline", "leads", "tasks"].includes(view) && (
              <div className="table-footer">
                <span>
                  {loading
                    ? t(locale, "Cargando…", "Loading…")
                    : t(
                        locale,
                        `Página ${page + 1} · ${data.listTotal ?? (view === "leads" ? filteredLeads.length : visible.length)} ${view === "leads" ? "leads" : "oportunidades"} con estos filtros`,
                        `Page ${page + 1} · ${data.listTotal ?? (view === "leads" ? filteredLeads.length : visible.length)} ${view === "leads" ? "leads" : "opportunities"} matching these filters`,
                      )}
                </span>
                <div className="card-actions">
                  <button
                    className="button"
                    disabled={page === 0 || loading}
                    onClick={() => setPage(page - 1)}
                  >
                    {t(locale, "Anterior", "Previous")}
                  </button>
                  <button
                    className="button"
                    disabled={!data.hasMore || loading}
                    onClick={() => setPage(page + 1)}
                  >
                    {t(locale, "Siguiente", "Next")}
                  </button>
                </div>
              </div>
            )}
          <footer className="workspace-footer">
            <span>CURATED FINANCIAL</span>
            <span>
              {t(
                locale,
                "Financiación con seguimiento.",
                "Financing, thoughtfully managed.",
              )}
            </span>
            <span>
              <span className="connection-dot" />
              {data.demo
                ? t(locale, "Entorno de demostración", "Demo environment")
                : t(locale, "Espacio seguro", "Secure workspace")}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={18} />
          {toast}
        </div>
      )}
      {modal === "import" && (
        <ImportWizard
          locale={locale}
          close={() => setModal(null)}
          data={data}
          act={act}
          refresh={refresh}
        />
      )}
      {composing && (
        <MailComposer
          data={data}
          locale={locale}
          act={act}
          busy={busy}
          close={() => setComposing(false)}
        />
      )}
      {modal && modal !== "import" && (
        <Modal
          title={
            editingLender
              ? t(locale, "Editar lender", "Edit lender")
              : modal.startsWith("preview:")
                ? t(locale, "Vista previa del mensaje", "Message preview")
                : {
                    opportunity: t(
                      locale,
                      "Nueva oportunidad",
                      "New opportunity",
                    ),
                    lead: t(locale, "Nuevo lead", "New lead"),
                    task: t(locale, "Nueva tarea", "New task"),
                    campaign: t(locale, "Nueva campaña", "New campaign"),
                    lender: t(locale, "Nuevo lender", "New lender"),
                    verify: t(
                      locale,
                      "Verificación con Bouncer",
                      "Verify with Bouncer",
                    ),
                    filters: t(locale, "Filtros de la vista", "View filters"),
                    invite: t(
                      locale,
                      "Invitar al equipo",
                      "Invite to workspace",
                    ),
                    google: "Google Workspace",
                    requirements: t(
                      locale,
                      "Checklist del producto",
                      "Product checklist",
                    ),
                  }[modal] ||
                  (modal.startsWith("attachment:")
                    ? t(
                        locale,
                        "Incorporar adjunto al expediente",
                        "Import attachment to case",
                      )
                    : modal)
          }
          close={() => {
            setModal(null);
            setError("");
          }}
          wide={modal === "campaign"}
        >
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {["opportunity", "lead"].includes(modal) && (
            <form
              onSubmit={(e) =>
                submit(
                  e,
                  modal === "lead" ? "create_lead" : "create_opportunity",
                )
              }
            >
              <p className="muted">
                {modal === "lead"
                  ? t(
                      locale,
                      "Este contacto quedará en preparación hasta validar su correo con Bouncer.",
                      "This contact stays in preparation until Bouncer validates the email.",
                    )
                  : t(
                      locale,
                      "Una nueva solicitud requiere un cliente con correo ya verificado. Para un contacto nuevo, créalo primero en Preparación de leads.",
                      "A new request requires a customer with a verified email. Add new contacts in Lead preparation first.",
                    )}
              </p>
              <div className="form-grid">
                <Field
                  name="company"
                  label={t(locale, "Empresa", "Business")}
                  required
                />
                <Field
                  name="contact"
                  label={t(locale, "Contacto", "Contact")}
                  required
                />
                <Field name="email" label="Email" type="email" required />
                <Field name="phone" label={t(locale, "Teléfono", "Phone")} />
                <Field
                  name="amount"
                  label={t(
                    locale,
                    "Monto solicitado (USD)",
                    "Requested amount (USD)",
                  )}
                  type="number"
                  min={0}
                  required
                />
                <Field name="product" label={t(locale, "Producto", "Product")}>
                  {[
                    "Business loan",
                    "MCA",
                    "Line of credit",
                    "Equipment financing",
                  ].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Field>
                <Field name="seller_id" label="Seller" value={profile.id}>
                  {data.profiles
                    .filter(
                      (p) =>
                        ["seller", "seller_admin", "superadmin"].includes(
                          p.role,
                        ) &&
                        (isAdmin || p.id === profile.id),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Field>
                <Field
                  name="industry"
                  label={t(locale, "Industria", "Industry")}
                />
                <Field
                  name="next_action"
                  label={t(locale, "Próxima acción", "Next action")}
                  required
                />
                <Field
                  name="next_action_at"
                  label={t(locale, "Vencimiento", "Due date")}
                  type="datetime-local"
                  required
                />
              </div>
              <div className="modal-footer">
                <SaveButton locale={locale} busy={busy} />
              </div>
            </form>
          )}
          {modal === "task" && (
            <form onSubmit={(e) => submit(e, "create_task")}>
              <Field
                name="title"
                label={t(locale, "Qué hay que hacer", "What needs to happen")}
                required
              />
              <Field
                name="opportunity_id"
                label={t(locale, "Oportunidad", "Opportunity")}
              >
                {visible.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.company}
                  </option>
                ))}
              </Field>
              <Field name="owner_id" label={t(locale, "Responsable", "Owner")}>
                {data.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Field>
              <Field
                name="due_at"
                label={t(locale, "Vencimiento", "Due date")}
                type="datetime-local"
                required
              />
              <div className="modal-footer">
                <SaveButton locale={locale} busy={busy} />
              </div>
            </form>
          )}
          {modal.startsWith("attachment:") &&
            (() => {
              const attachment = data.attachments?.find(
                (a) => a.id === modal.split(":")[1],
              );
              const message = data.messages.find(
                (m) => m.id === attachment?.message_id,
              );
              const parent = data.conversations.find(
                (c) => c.id === message?.conversation_id,
              );
              return (
                <form
                  onSubmit={(e) =>
                    submit(e, "import_attachment", { id: attachment?.id })
                  }
                >
                  <p>{attachment?.name}</p>
                  <Field
                    name="document_id"
                    label={t(
                      locale,
                      "Documento correspondiente",
                      "Corresponding document",
                    )}
                  >
                    {data.documents
                      .filter(
                        (d) => d.opportunity_id === parent?.opportunity_id,
                      )
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </Field>
                  <p className="muted">
                    {t(
                      locale,
                      "Quedará recibido y pendiente de revisión, sin aprobación automática.",
                      "It will be marked received and pending review, without automatic approval.",
                    )}
                  </p>
                  <div className="modal-footer">
                    <SaveButton locale={locale} busy={busy} />
                  </div>
                </form>
              );
            })()}
          {(modal === "lender" || editingLender) && (
            <form
              onSubmit={(e) =>
                submit(
                  e,
                  editingLender ? "update_lender" : "create_lender",
                  editingLender ? { id: editingLender.id } : {},
                )
              }
            >
              <Field
                name="name"
                label={t(locale, "Nombre", "Name")}
                value={editingLender?.name}
                required
              />
              <Field
                name="email"
                label="Email"
                type="email"
                value={editingLender?.email}
                required
              />
              <Field
                name="products"
                value={editingLender?.products.join(", ")}
                label={t(
                  locale,
                  "Productos (separados por coma)",
                  "Products (comma separated)",
                )}
                required
              />
              <Field
                name="channel"
                label={t(locale, "Canal", "Channel")}
                value={editingLender?.channel}
              >
                <option value="email">Email</option>
                <option value="portal">Portal</option>
              </Field>
              <Field
                name="notes"
                value={editingLender?.notes}
                label={t(locale, "Referencias y notas", "References and notes")}
                type="textarea"
              />
              <div className="modal-footer">
                <SaveButton locale={locale} busy={busy} />
              </div>
            </form>
          )}
          {modal === "campaign" && (
            <form
              onSubmit={(e) => {
                const f = new FormData(e.currentTarget);
                const steps = [
                  ...(Number(f.get("followup_days")) > 0
                    ? [
                        {
                          subject: String(f.get("followup_subject")),
                          body: String(f.get("followup_body")),
                          wait_days: Number(f.get("followup_days")),
                        },
                      ]
                    : []),
                  ...extraSteps.map((id) => ({
                    subject: String(f.get(`step_${id}_subject`)),
                    body: String(f.get(`step_${id}_body`)),
                    wait_days: Number(f.get(`step_${id}_days`)),
                  })),
                ];
                submit(e, "create_campaign", { steps });
              }}
            >
              <div className="form-grid">
                <Field
                  name="name"
                  label={t(locale, "Nombre de campaña", "Campaign name")}
                  required
                />
                <Field
                  name="account_id"
                  label={t(locale, "Cuenta remitente", "Sender account")}
                >
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}
                    </option>
                  ))}
                </Field>
                <Field
                  name="seller_id"
                  label={t(locale, "Seller responsable", "Responsible seller")}
                >
                  {data.profiles
                    .filter((p) =>
                      ["seller", "seller_admin", "superadmin"].includes(p.role),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Field>
                <Field
                  name="batch_id"
                  label={t(locale, "Lote de leads", "Lead batch")}
                >
                  <option value="">
                    {t(locale, "Leads sin campaña", "Leads without a campaign")}
                  </option>
                  {data.imports.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Field>
                <Field
                  name="daily_limit"
                  label={t(locale, "Límite diario", "Daily limit")}
                  type="number"
                  value={100}
                  min={1}
                  max={2000}
                  required
                />
                <Field
                  name="timezone"
                  label={t(locale, "Zona horaria", "Time zone")}
                  value="America/New_York"
                >
                  {[
                    "America/New_York",
                    "America/Chicago",
                    "America/Denver",
                    "America/Los_Angeles",
                    "America/Bogota",
                  ].map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </Field>
                <Field
                  name="start_hour"
                  label={t(locale, "Hora de inicio", "Start hour")}
                  type="number"
                  min={0}
                  max={23}
                  value={9}
                  required
                />
                <Field
                  name="end_hour"
                  label={t(locale, "Hora de fin", "End hour")}
                  type="number"
                  min={1}
                  max={24}
                  value={17}
                  required
                />
              </div>
              <Field
                name="subject"
                label="Subject"
                value="Funding options for {{company}}"
                required
              />
              <Field
                name="body"
                label={t(locale, "Mensaje inicial", "Initial message")}
                type="textarea"
                value={
                  "Hi {{name}},\n\nLet’s explore financing options for {{company}}. Apply here: {{application_url}}\n\nCurated Financial\nUnsubscribe: {{unsubscribe_url}}"
                }
                required
              />
              <div className="form-grid">
                <Field
                  name="followup_days"
                  label={t(
                    locale,
                    "Espera para seguimiento (días, 0 = sin seguimiento)",
                    "Follow-up delay (days, 0 = no follow-up)",
                  )}
                  type="number"
                  value={3}
                  min={0}
                  max={90}
                />
                <Field
                  name="followup_subject"
                  label="Follow-up subject"
                  value="Following up · {{company}}"
                />
              </div>
              <Field
                name="followup_body"
                label={t(locale, "Mensaje de seguimiento", "Follow-up message")}
                type="textarea"
                value={
                  "Hi {{name}},\n\nDo you have any questions about your application? {{application_url}}\n\nUnsubscribe: {{unsubscribe_url}}"
                }
              />
              {extraSteps.map((id, index) => (
                <section className="analysis-card" key={id}>
                  <div className="split-heading">
                    <h3>
                      {t(
                        locale,
                        "Seguimiento adicional",
                        "Additional follow-up",
                      )}{" "}
                      {index + 1}
                    </h3>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setExtraSteps(extraSteps.filter((s) => s !== id))
                      }
                    >
                      {t(locale, "Quitar", "Remove")}
                    </button>
                  </div>
                  <Field
                    name={`step_${id}_days`}
                    type="number"
                    min={1}
                    max={90}
                    value={3}
                    label={t(
                      locale,
                      "Días desde el mensaje anterior",
                      "Days after previous message",
                    )}
                    required
                  />
                  <Field
                    name={`step_${id}_subject`}
                    label={t(locale, "Asunto", "Subject")}
                    value="Following up · {{company}}"
                    required
                  />
                  <Field
                    name={`step_${id}_body`}
                    label={t(locale, "Mensaje", "Message")}
                    type="textarea"
                    value={
                      "Hi {{name}},\n\nYour application link is {{application_url}}\n\nUnsubscribe: {{unsubscribe_url}}"
                    }
                    required
                  />
                </section>
              ))}
              <button
                type="button"
                className="button"
                disabled={extraSteps.length >= 19}
                onClick={() => setExtraSteps([...extraSteps, Date.now()])}
              >
                {t(locale, "Agregar paso a la secuencia", "Add sequence step")}
              </button>
              <p className="muted">
                {t(
                  locale,
                  "Solo se incluirán correos válidos, sin exclusiones ni otra secuencia activa. Una respuesta detiene el seguimiento.",
                  "Only valid, unsuppressed contacts without another active sequence are eligible. A reply stops follow-up.",
                )}
              </p>
              <div className="modal-footer">
                <SaveButton
                  locale={locale}
                  busy={busy}
                  label={t(locale, "Guardar borrador", "Save draft")}
                />
              </div>
            </form>
          )}
          {modal === "verify" && (
            <form
              onSubmit={(e) => {
                if (
                  busy ||
                  loading ||
                  selectedVerificationCandidates.length === 0
                ) {
                  e.preventDefault();
                  return;
                }
                return submit(e, "verify_contacts", {
                  contact_ids: selectedVerificationCandidates.map(
                    (o) => o.contact_id,
                  ),
                });
              }}
            >
              <div className="verification-estimate">
                <ShieldCheck size={34} />
                <strong>
                  {
                    new Set(
                      selectedVerificationCandidates.map((o) => o.contact_id),
                    ).size
                  }
                </strong>
                <span>
                  {t(
                    locale,
                    "verificaciones previstas",
                    "estimated verifications",
                  )}
                </span>
              </div>
              <p>
                {t(
                  locale,
                  "Se verificarán únicamente los leads seleccionados. Los reintentos técnicos no convierten un correo en inválido. La operación consumirá créditos de Bouncer.",
                  "Only the selected leads will be verified. Technical errors do not mark addresses invalid. This operation uses Bouncer credits.",
                )}
              </p>
              <div className="modal-footer">
                <SaveButton
                  locale={locale}
                  busy={busy}
                  disabled={
                    loading || selectedVerificationCandidates.length === 0
                  }
                  label={t(
                    locale,
                    "Iniciar verificación",
                    "Start verification",
                  )}
                />
              </div>
            </form>
          )}
          {modal === "filters" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setPeriod(String(f.get("period")));
                setCampaignFilter(
                  view === "leads" ? "all" : String(f.get("campaign")),
                );
                setModal(null);
              }}
            >
              <Field
                name="period"
                label={t(
                  locale,
                  view === "leads"
                    ? "Creación del lead"
                    : "Creación de oportunidad",
                  view === "leads" ? "Lead created" : "Opportunity created",
                )}
                value={period}
              >
                <option value="all">
                  {t(locale, "Todo el período", "All time")}
                </option>
                <option value="7">
                  {t(locale, "Últimos 7 días", "Last 7 days")}
                </option>
                <option value="30">
                  {t(locale, "Últimos 30 días", "Last 30 days")}
                </option>
                <option value="90">
                  {t(locale, "Últimos 90 días", "Last 90 days")}
                </option>
              </Field>
              {view !== "leads" && (
                <Field
                  name="campaign"
                  label={t(locale, "Campaña", "Campaign")}
                  value={campaignFilter}
                >
                  <option value="all">
                    {t(locale, "Todas", "All campaigns")}
                  </option>
                  {data.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Field>
              )}
              <div className="modal-footer">
                <SaveButton
                  locale={locale}
                  busy={false}
                  label={t(locale, "Aplicar filtros", "Apply filters")}
                />
              </div>
            </form>
          )}
          {modal === "invite" && (
            <form onSubmit={(e) => submit(e, "invite_user")}>
              <Field name="name" label={t(locale, "Nombre", "Name")} required />
              <Field name="email" label="Email" type="email" required />
              <Field name="role" label={t(locale, "Rol", "Role")}>
                {Object.entries(roleLabels).map(([r, label]) => (
                  <option value={r} key={r}>
                    {label}
                  </option>
                ))}
              </Field>
              <div className="modal-footer">
                <SaveButton
                  locale={locale}
                  busy={busy}
                  label={t(locale, "Enviar invitación", "Send invitation")}
                />
              </div>
            </form>
          )}
          {modal === "google" && (
            <form action="/api/gmail/connect" method="get">
              <p>
                {t(
                  locale,
                  "Autoriza una cuenta de una organización configurada por el administrador. La contraseña permanece en Google.",
                  "Authorize an account in an organization configured by the administrator. Your password stays with Google.",
                )}
              </p>
              <Field
                name="organization"
                label={t(
                  locale,
                  "ID de organización configurada",
                  "Configured organization ID",
                )}
                required
              />
              <div className="modal-footer">
                <button
                  type="submit"
                  className="button primary"
                  disabled={data.demo}
                >
                  {t(locale, "Continuar con Google", "Continue with Google")}
                </button>
              </div>
              {data.demo && (
                <p className="muted">
                  {t(
                    locale,
                    "Las conexiones externas no están habilitadas en la demostración.",
                    "External connections are not enabled in this demo.",
                  )}
                </p>
              )}
            </form>
          )}
          {modal === "requirements" && (
            <form onSubmit={(e) => submit(e, "requirements")}>
              <Field name="product" label={t(locale, "Producto", "Product")}>
                {[
                  "Business loan",
                  "MCA",
                  "Line of credit",
                  "Equipment financing",
                ].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Field>
              <Field
                name="bank_months"
                label={t(locale, "Meses de extractos", "Bank statement months")}
                type="number"
                min={1}
                max={24}
                value={4}
                required
              />
              <p className="muted">
                {t(
                  locale,
                  "Se aplicará a oportunidades nuevas. La aplicación firmada siempre es obligatoria.",
                  "Applies to new opportunities. A signed application is always required.",
                )}
              </p>
              <div className="modal-footer">
                <SaveButton locale={locale} busy={busy} />
              </div>
            </form>
          )}
          {modal.startsWith("preview:") &&
            (() => {
              const c = data.campaigns.find(
                (c) => c.id === modal.split(":")[1],
              )!;
              const replace = (s: string) =>
                s
                  .replaceAll("{{name}}", "Alex")
                  .replaceAll("{{company}}", "Example Business")
                  .replaceAll(
                    "{{application_url}}",
                    "[Individual secure application link]",
                  )
                  .replaceAll(
                    "{{unsubscribe_url}}",
                    "[Secure unsubscribe link]",
                  );
              const missing = (
                c.subject +
                c.body +
                c.steps.map((s) => s.subject + s.body).join("")
              ).match(
                /{{\s*(?!(?:name|company|application_url|unsubscribe_url)\s*}})[^}]+}}/g,
              );
              return (
                <div className="template-preview">
                  <small>
                    From:{" "}
                    {data.accounts.find((a) => a.id === c.account_id)?.email}
                  </small>
                  <h3>{replace(c.subject)}</h3>
                  <p>{replace(c.body)}</p>
                  {c.steps.map((step, index) => (
                    <section key={index} className="analysis-card">
                      <small>
                        {t(locale, "Seguimiento", "Follow-up")} {index + 1} ·{" "}
                        {step.wait_days}{" "}
                        {t(locale, "días después", "days later")}
                      </small>
                      <h3>{replace(step.subject)}</h3>
                      <p>{replace(step.body)}</p>
                    </section>
                  ))}
                  {missing && (
                    <div className="error-banner">
                      {t(
                        locale,
                        "Variables sin resolver",
                        "Unresolved variables",
                      )}
                      : {missing.join(", ")}
                    </div>
                  )}
                </div>
              );
            })()}
        </Modal>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  icon,
  featured = false,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <section className={`metric ${featured ? "featured" : ""}`}>
      <div>
        <span>{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>
        {featured && <CircleCheck size={13} />}
        {note}
      </small>
    </section>
  );
}
