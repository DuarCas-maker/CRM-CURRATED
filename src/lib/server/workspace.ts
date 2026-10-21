import { requireUser, checkDb } from "./supabase";
import type { Workspace } from "../domain";
import { stages } from "../domain";
import { filterLeadTab, parseLeadTab } from "../lead-tabs";
import { z } from "zod";
import { gmailHistoryEnabled } from "../gmail-feature";
import { teamLabels } from "./gmail-team";
import { crmExtensionsReady } from "./crm-readiness";
import { loadWorkspaceMail } from "./workspace-mail";
import { loadWorkspaceMailFiles } from "./workspace-mail-files";
export async function loadWorkspace(
  params = new URLSearchParams(),
): Promise<Workspace> {
  const { db, profile } = await requireUser();
  const extensionsReady = await crmExtensionsReady(db);
  const page = Math.max(
    0,
    Math.min(100000, Math.floor(Number(params.get("page")) || 0)),
  );
  const search = (params.get("q") || "")
    .slice(0, 200)
    .replace(/[(),.%\\]/g, " ");
  const stage = stages.includes(params.get("stage") as (typeof stages)[number])
    ? params.get("stage")
    : null;
  const uuid = (key: string) =>
    z.uuid().safeParse(params.get(key)).success ? params.get(key) : null;
  const owner = uuid("owner");
  const campaign = uuid("campaign");
  const caseId = uuid("case");
  const days = Number(params.get("period"));
  const since =
    days > 0
      ? new Date(Date.now() - Math.min(days, 36500) * 86400000).toISOString()
      : null;
  let financingControl: Workspace["financing_control"];
  if (extensionsReady && (params.get("view") || "overview") === "overview") {
    const control = await db.rpc("financing_control_dashboard", {
      search_text: search,
      owner_filter: owner,
      stage_filter: stage,
      campaign_filter: campaign,
      since_filter: since,
      attention_filter: params.get("attention") || "all",
      cursor_offset: page * 50,
      process_state_filter: params.get("process_state") || null,
      stalled_days: [3, 5, 7, 14].includes(Number(params.get("stalled")))
        ? Number(params.get("stalled"))
        : null,
    });
    // A missing v2 migration preserves the original overview. Other failures surface.
    if (!control.error || !["PGRST202", "42883"].includes(control.error.code))
      financingControl = checkDb(control, "financing_control_dashboard");
  }
  const preparing = !caseId && params.get("view") === "leads";
  const leadSection = params.get("lead_section") || "preparing";
  let leadPreparation: Workspace["lead_preparation"];
  if (preparing) {
    const result = await db.rpc("lead_preparation_overview", {
      search_text: search,
      owner_filter: owner,
      since_filter: since,
      verification_filter: [
        "pending",
        "valid",
        "invalid",
        "uncertain",
      ].includes(params.get("stage") || "")
        ? params.get("stage")
        : null,
      cursor_offset: leadSection === "verifications" ? page * 50 : 0,
    });
    // Preserve the existing inbox while migration 044 awaits activation.
    if (!result.error || !["PGRST202", "42883"].includes(result.error.code))
      leadPreparation = checkDb(result, "lead_preparation_overview");
  }
  let leadResponse: { data: Workspace["leads"] | null; count: number | null } =
    { data: [], count: 0 };
  if (preparing && !["verifications", "imports"].includes(leadSection)) {
    let leadQuery = db
      .from("lead_workspace")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    leadQuery = filterLeadTab(
      leadQuery,
      parseLeadTab(params.get("lead_status")),
    );
    if (search)
      leadQuery = leadQuery.or(
        `company.ilike.%${search}%,contact.ilike.%${search}%,email.ilike.%${search}%`,
      );
    if (owner) leadQuery = leadQuery.eq("seller_id", owner);
    if (since) leadQuery = leadQuery.gte("created_at", since);
    if (
      ["pending", "valid", "invalid", "uncertain"].includes(
        params.get("stage") || "",
      )
    )
      leadQuery = leadQuery.eq("verification", params.get("stage"));
    const result = await leadQuery.range(page * 100, page * 100 + 99);
    leadResponse = {
      data: checkDb(result, "lead_workspace") || [],
      count: result.count,
    };
  }
  const opportunityView =
    !caseId && params.get("view") === "tasks"
      ? "opportunity_tasks"
      : "opportunity_workspace";
  let query = db
    .from(opportunityView)
    .select("*", { count: "exact" })
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (caseId) query = query.eq("id", caseId);
  else {
    if (search)
      query = query.or(
        `company.ilike.%${search}%,contact.ilike.%${search}%,email.ilike.%${search}%`,
      );
    if (stage && !preparing) query = query.eq("stage", stage);
    if (owner) query = query.or(`seller_id.eq.${owner},closer_id.eq.${owner}`);
    if (campaign) query = query.eq("campaign_id", campaign);
    if (since) query = query.gte("created_at", since);
  }
  const response = await query.range(page * 100, page * 100 + 99);
  const opportunities = preparing
    ? []
    : checkDb(response, opportunityView) || [];
  const caseIds = opportunities.map((o) => o.id);
  if (gmailHistoryEnabled() && caseIds.length) {
    const metadata =
      checkDb(
        await db
          .from("opportunities")
          .select("id,primary_account_id,historical_approved_at")
          .in("id", caseIds),
        "opportunities.gmail_metadata",
      ) || [];
    for (const o of opportunities)
      Object.assign(o, metadata.find((m) => m.id === o.id) || {});
  }
  const stats = checkDb(
    await db.rpc("workspace_stats", {
      search_text: search,
      stage_filter: preparing ? null : stage,
      owner_filter: owner,
      campaign_filter: campaign,
      since_filter: since,
    }),
    "workspace_stats",
  );
  const preferences = checkDb(
    await db
      .from("notification_preferences")
      .select("internal,email,push,locale")
      .eq("user_id", profile.id)
      .maybeSingle(),
    "notification_preferences",
  ) || { internal: true, email: false, push: false, locale: "es" };
  const queries = [
    ["profiles", "profiles"],
    ["tasks", "tasks"],
    ["activities", "activities"],
    ["documents", "documents"],
    ["analyses", "analyses"],
    ["submissions", "submissions"],
    ["offers", "offers"],
    ["accounts", "mail_accounts"],
    ["campaigns", "campaign_workspace"],
    ["imports", "import_batches"],
    ["conversations", "conversations"],
    ["notifications", "notifications"],
    ["mail_review", "mail_review"],
  ];
  if (extensionsReady)
    queries.push(
      ["email_templates", "email_templates"],
      ["campaign_assets", "campaign_assets"],
    );
  if (profile.role === "superadmin")
    queries.push(["integration_jobs", "jobs"], ["outbox_status", "outbox"]);
  if (gmailHistoryEnabled())
    queries.push(["gmail_files", "gmail_saved_attachments"]);
  const related = new Set([
    "tasks",
    "activities",
    "documents",
    "analyses",
    "submissions",
    "offers",
    "conversations",
    "gmail_files",
  ]);
  const entries = await Promise.all(
    queries.map(async ([key, table]) => {
      const sort = [
        "imports",
        "activities",
        "notifications",
        "campaigns",
        "integration_jobs",
      ].includes(key)
        ? "created_at"
        : key === "conversations"
          ? "updated_at"
          : "id";
      let q = db
        .from(table)
        .select(
          key === "outbox_status"
            ? "id,status,account_id"
            : key === "integration_jobs"
              ? "id,kind,status,attempts,created_at"
              : "*",
        )
        .order(sort, { ascending: false })
        .limit(related.has(key) ? 3000 : 500);
      if (related.has(key)) q = q.in("opportunity_id", caseIds);
      if (key === "imports" && preparing)
        q = q.range(
          leadSection === "imports" ? page * 100 : 0,
          leadSection === "imports" ? page * 100 + 99 : 99,
        );
      if (key === "lenders") q = q.is("archived_at", null);
      return [key, checkDb(await q, table) || []] as const;
    }),
  );
  const data = Object.fromEntries(entries) as unknown as Workspace;
  const [lenders, lenderContacts] = await Promise.all([
    readDirectory("lenders", "id"),
    readDirectory("lender_contacts", "email"),
  ]);
  data.lenders = lenders as Workspace["lenders"];
  data.lender_contacts = lenderContacts as Workspace["lender_contacts"];
  async function readDirectory(table: string, sort: string) {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      let q = db.from(table).select("*").order(sort);
      if (table === "lenders") q = q.is("archived_at", null);
      const chunk = checkDb(await q.range(offset, offset + 999), table) || [];
      rows.push(...chunk);
      if (chunk.length < 1000) return rows;
    }
  }
  if (gmailHistoryEnabled()) {
    const permissions =
      checkDb(
        await db
          .from("mail_permissions")
          .select("account_id")
          .eq("user_id", profile.id)
          .eq("can_send", true),
        "mail_permissions",
      ) || [];
    data.sender_account_ids = data.accounts
      .filter(
        (a) =>
          a.status === "connected" &&
          (profile.role === "superadmin" ||
            permissions.some((p) => p.account_id === a.id)),
      )
      .map((a) => a.id);
    data.mail_sends =
      checkDb(
        await db.rpc("mail_send_status", { cases: caseIds }),
        "mail_send_status",
      ) || [];
  }
  const conversations = data.conversations as Workspace["conversations"];
  const { messages, attachments } = await loadWorkspaceMail(
    db,
    conversations.map((c) => c.id),
  );
  const mailFiles =
    caseId && gmailHistoryEnabled()
      ? await loadWorkspaceMailFiles(db, messages, attachments)
      : { files: [], attachments };
  if (gmailHistoryEnabled()) {
    const labels = await teamLabels(messages.map((m) => m.sender));
    for (const message of messages)
      message.sender_team = labels.get(message.sender.toLowerCase());
  }
  if (["superadmin", "closer_admin", "closer"].includes(profile.role)) {
    for (const o of opportunities) {
      if (!o.handed_off_at) continue;
      const task = (data.tasks as Workspace["tasks"])
        .filter(
          (t) =>
            t.opportunity_id === o.id &&
            t.status === "open" &&
            t.area === "closer",
        )
        .sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
      if (task) {
        o.next_action = task.title;
        o.next_action_at = task.due_at;
      }
    }
  }
  return {
    ...data,
    profile,
    opportunities,
    leads: leadResponse.data || [],
    lead_preparation: leadPreparation,
    messages: messages.reverse(),
    attachments: mailFiles.attachments,
    mail_files: mailFiles.files,
    preferences,
    notifications: preferences.internal ? data.notifications : [],
    demo: false,
    gmail_history_enabled: gmailHistoryEnabled(),
    page,
    listTotal:
      (preparing
        ? leadSection === "verifications"
          ? leadPreparation?.verification_total
          : leadSection === "imports"
            ? leadPreparation?.imports_total
            : leadResponse.count
        : response.count) || 0,
    hasMore:
      ((preparing
        ? leadSection === "verifications"
          ? leadPreparation?.verification_total
          : leadSection === "imports"
            ? leadPreparation?.imports_total
            : leadResponse.count
        : response.count) || 0) >
      (page + 1) * (preparing && leadSection === "verifications" ? 50 : 100),
    stats,
    crm_extensions_ready: extensionsReady,
    financing_control: financingControl,
    ...(extensionsReady && (params.get("view") || "overview") === "overview"
      ? {
          operational: checkDb(
            await db.rpc("operational_dashboard", {
              search_text: search,
              owner_filter: owner,
              stage_filter: stage,
              campaign_filter: campaign,
              since_filter: since,
              attention_filter:
                financingControl ||
                ![
                  "all",
                  "attention",
                  "reply",
                  "overdue",
                  "documents",
                  "analysis",
                  "lender",
                  "negotiation",
                  "offers",
                ].includes(params.get("attention") || "all")
                  ? "all"
                  : params.get("attention") || "all",
              cursor_offset: page * 50,
            }),
            "operational_dashboard",
          ),
        }
      : {}),
  } as Workspace;
}
