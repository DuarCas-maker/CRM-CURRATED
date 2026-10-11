import { requireUser, checkDb } from "./supabase";
import type { Workspace } from "../domain";
import { stages } from "../domain";
import { filterLeadTab, parseLeadTab } from "../lead-tabs";
import { z } from "zod";
import { gmailHistoryEnabled } from "../gmail-feature";
import { teamLabels } from "./gmail-team";
export async function loadWorkspace(
  params = new URLSearchParams(),
): Promise<Workspace> {
  const { db, profile } = await requireUser();
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
  const preparing = !caseId && params.get("view") === "leads";
  let leadResponse: { data: Workspace["leads"] | null; count: number | null } =
    { data: [], count: 0 };
  if (preparing) {
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
    leadResponse = { data: checkDb(result) || [], count: result.count };
  }
  let query = db
    .from(
      !caseId && params.get("view") === "tasks"
        ? "opportunity_tasks"
        : !caseId && params.get("view") === "inbox"
          ? "opportunity_inbox"
          : "opportunity_workspace",
    )
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
  const opportunities = preparing ? [] : checkDb(response) || [];
  const caseIds = opportunities.map((o) => o.id);
  if (gmailHistoryEnabled() && caseIds.length) {
    const metadata =
      checkDb(
        await db
          .from("opportunities")
          .select("id,primary_account_id,historical_approved_at")
          .in("id", caseIds),
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
  );
  const preferences = checkDb(
    await db
      .from("notification_preferences")
      .select("internal,email,push,locale")
      .eq("user_id", profile.id)
      .maybeSingle(),
  ) || { internal: true, email: false, push: false, locale: "es" };
  const queries = [
    ["profiles", "profiles"],
    ["tasks", "tasks"],
    ["activities", "activities"],
    ["documents", "documents"],
    ["analyses", "analyses"],
    ["lenders", "lenders"],
    ["submissions", "submissions"],
    ["offers", "offers"],
    ["accounts", "mail_accounts"],
    ["campaigns", "campaign_workspace"],
    ["imports", "import_batches"],
    ["conversations", "conversations"],
    ["notifications", "notifications"],
    ["mail_review", "mail_review"],
  ];
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
      return [key, checkDb(await q) || []] as const;
    }),
  );
  const data = Object.fromEntries(entries) as unknown as Workspace;
  if (gmailHistoryEnabled()) {
    data.lender_contacts =
      checkDb(await db.from("lender_contacts").select("email,lender_id")) || [];
    const permissions =
      checkDb(
        await db
          .from("mail_permissions")
          .select("account_id")
          .eq("user_id", profile.id)
          .eq("can_send", true),
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
      checkDb(await db.rpc("mail_send_status", { cases: caseIds })) || [];
  }
  const conversations = data.conversations as Workspace["conversations"];
  const messages =
    checkDb(
      await db
        .from("messages")
        .select("*")
        .in(
          "conversation_id",
          conversations.map((c) => c.id),
        )
        .order("sent_at", { ascending: false })
        .limit(1000),
    ) || [];
  const attachments =
    checkDb(
      await db
        .from("message_attachments")
        .select("*")
        .in(
          "message_id",
          messages.map((m) => m.id),
        )
        .limit(1000),
    ) || [];
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
    messages: messages.reverse(),
    attachments,
    preferences,
    notifications: preferences.internal ? data.notifications : [],
    demo: false,
    gmail_history_enabled: gmailHistoryEnabled(),
    page,
    listTotal: (preparing ? leadResponse.count : response.count) || 0,
    hasMore:
      ((preparing ? leadResponse.count : response.count) || 0) >
      (page + 1) * 100,
    stats,
  } as Workspace;
}
