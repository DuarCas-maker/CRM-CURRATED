import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, Opportunity, Workspace } from "../domain";
import {
  canSeeOpportunity,
  canSeeArea,
  isSellerRole,
  isCloserRole,
} from "../domain";
import { readableMail } from "../mail-display";
import {
  buildMasterPipeline,
  type MasterQuery,
  type MasterSource,
  type MasterArchive,
  type MasterEvent,
} from "../pipeline-os/master-pipeline";
import { readPipelinePages } from "./pipeline-os-module";
import { checkDb, requireUser } from "./supabase";
import { campaignFlowCases } from "./campaign-flow-cases";
import {
  createPipelineReadQueue,
  type PipelineReadQueue,
} from "./pipeline-read-queue";

function masterRowReader(run: PipelineReadQueue) {
  return async function readRows<T>(
    db: SupabaseClient,
    table: string,
    columns: string,
    ids?: string[],
    key = "opportunity_id",
    since?: string,
    pageSize = 500,
  ): Promise<T[]> {
    if (ids && !ids.length) return [];
    const batches = ids
      ? Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) =>
          ids.slice(i * 50, i * 50 + 50),
        )
      : [undefined];
    const pages = await Promise.all(
      batches.map((batch) =>
        run(() =>
          readPipelinePages<T>(async (offset) => {
            let q = db
              .from(table)
              .select(columns, { count: "exact" })
              .order("id");
            if (batch) q = q.in(key, batch);
            if (table === "opportunity_workspace")
              q = q.is("archived_at", null);
            if (since) q = q.gte("sent_at", since);
            const result = await q.range(offset, offset + pageSize - 1);
            return {
              rows: (checkDb(result, "master_pipeline." + table) ||
                []) as unknown as T[],
              total: result.count,
            };
          }),
        ),
      ),
    );
    return pages.flat();
  };
}

export async function readMasterPipeline(
  db: SupabaseClient,
  profile: Profile,
  query: MasterQuery,
  now = Date.now(),
) {
  const run = createPipelineReadQueue();
  const readRows = masterRowReader(run);
  const raw = (
    await readRows<Opportunity>(
      db,
      "opportunity_workspace",
      "id,company,contact,email,phone,industry,amount,stage,seller_id,closer_id,next_action,next_action_at,created_at,updated_at,application_complete,application_signed,funded_at,funded_amount,funded_lender_id,handed_off_at",
    )
  ).filter((o) => canSeeOpportunity(profile, o));
  const opportunities = await run(() => campaignFlowCases(db, raw));
  const ids = opportunities.map((o) => o.id),
    closerIds = opportunities
      .filter((o) => canSeeArea(profile, o, "closer"))
      .map((o) => o.id);
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - query.days + 1);
  const mailRead = (async () => {
    const conversations = await readRows<Workspace["conversations"][number]>(
      db,
      "mail_conversations_visible",
      "id,opportunity_id,submission_id,process_id,account_id,subject,area,needs_attention,updated_at",
      ids,
    );
    const visibleConversations = conversations.filter((c) => {
      const o = opportunities.find((o) => o.id === c.opportunity_id);
      return !!o && canSeeArea(profile, o, c.area);
    });
    const messages = await readRows<Workspace["messages"][number]>(
      db,
      "messages",
      "id,conversation_id,direction,sender,sent_at,status,area,nature,reply_intent,archive_message_id",
      visibleConversations.map((c) => c.id),
      "conversation_id",
    );
    return { conversations: visibleConversations, messages };
  })();
  const [
    profiles,
    accounts,
    lenders,
    tasks,
    offers,
    submissions,
    processes,
    documents,
    events,
    mail,
    leads,
    archive,
    reviewed,
  ] = await Promise.all([
    readRows<Profile>(db, "profiles", "id,name,email,role,active"),
    readRows<Workspace["accounts"][number] & { owner_id: string | null }>(
      db,
      "mail_accounts",
      "id,email,owner_id",
    ),
    isCloserRole(profile.role)
      ? readRows<Workspace["lenders"][number]>(db, "lenders", "id,name,email")
      : Promise.resolve([]),
    readRows<Workspace["tasks"][number]>(
      db,
      "tasks",
      "id,opportunity_id,owner_id,title,due_at,status,area",
      ids,
    ),
    readRows<MasterSource["offers"][number]>(
      db,
      "offers",
      "id,opportunity_id,submission_id,product,amount,term,cost,frequency,fees,expires_at,status,created_at",
      closerIds,
    ),
    readRows<Workspace["submissions"][number]>(
      db,
      "submissions",
      "id,opportunity_id,process_id,lender_id,closer_id,status,submitted_at,next_action,next_action_at",
      closerIds,
    ),
    readRows<MasterSource["processes"][number]>(
      db,
      "financing_processes",
      "id,opportunity_id,sequence_number,state,classification,is_unclassified_archive,started_at,actual_funded_amount,funded_lender_id",
      closerIds,
    ),
    readRows<Workspace["documents"][number]>(
      db,
      "documents",
      "id,opportunity_id,kind,status,storage_path,created_at,required,content_hash",
      ids,
    ),
    readRows<MasterEvent>(
      db,
      "case_events",
      "id,opportunity_id,process_id,submission_id,archive_message_id,kind,area,evidence_type,occurred_at",
      ids,
    ),
    mailRead,
    isSellerRole(profile.role)
      ? readRows<Workspace["leads"][number]>(
          db,
          "lead_workspace",
          "id,contact_id,company,contact,email,seller_id,suppressed,opportunity_id,verification,created_at",
        )
      : Promise.resolve([]),
    // The raw archive's existing RLS grants only superadmin access. It lets PostgreSQL
    // filter/page metadata without materializing the security-definer view on every page.
    // Other roles retain that view's original case visibility. Never read encrypted_payload.
    readRows<MasterArchive>(
      db,
      profile.role === "superadmin"
        ? "gmail_archive_messages"
        : "mail_archive_visible",
      "id,account_id,gmail_thread_id,subject,sent_at,direction,nature,reply_intent,participants",
      undefined,
      undefined,
      start.toISOString(),
      profile.role === "superadmin" ? 1000 : 500,
    ),
    readRows<{
      message_id: string;
      status: string;
      result: { offer_id?: string } | null;
    }>(
      db,
      "pipeline_mail_reviews",
      "id,opportunity_id,message_id,status,result",
      closerIds,
    ),
  ]);
  const source: MasterSource = {
    profile,
    profiles,
    opportunities,
    tasks,
    offers,
    submissions,
    processes,
    documents,
    events,
    ...mail,
    accounts,
    lenders,
    lender_contacts: [],
    leads,
    archive,
    leadCoverage: profile.role === "superadmin",
    accountOwners: Object.fromEntries(
      accounts.map((a) => [a.id, a.owner_id || "unassigned"]),
    ),
    offerEvidence: reviewed.flatMap((r) =>
      r.status === "approved" && r.result?.offer_id
        ? [{ offer_id: r.result.offer_id, message_id: r.message_id }]
        : [],
    ),
  };
  const dashboard = buildMasterPipeline(source, query, now);
  // Page first, bodies second. The client receives text excerpts only, never a whole mailbox payload.
  const bodyIds = [
    ...new Set(
      dashboard.rows.flatMap((r) => (r.messageId ? [r.messageId] : [])),
    ),
  ];
  const bodies = await readRows<{ id: string; body: string }>(
    db,
    "messages",
    "id,body",
    bodyIds,
    "id",
  );
  const excerpts = new Map(
    bodies.map((m) => [m.id, readableMail(m.body).text.slice(0, 600)]),
  );
  dashboard.rows = dashboard.rows.map((r) =>
    r.messageId ? { ...r, excerpt: excerpts.get(r.messageId) || "" } : r,
  );
  return dashboard;
}

export async function loadMasterPipeline(query: MasterQuery) {
  const { db, profile } = await requireUser();
  return readMasterPipeline(db, profile, query);
}
