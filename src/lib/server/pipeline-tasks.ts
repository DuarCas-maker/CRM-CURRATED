import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../domain";
import { isCloserRole, isSellerRole } from "../domain";
import type { CampaignContact } from "../campaign-center";
import type { PipelineBoard } from "../pipeline-os/module";
import {
  buildTasksOverview,
  type TaskOverviewQuery,
  type TaskOverviewSource,
} from "../pipeline-os/tasks-overview";
import { readPipelineBoard, readPipelinePages } from "./pipeline-os-module";
import { checkDb, HttpError, requireUser } from "./supabase";

async function readRows<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  ids?: string[],
  key = "opportunity_id",
) {
  const batches = ids
    ? Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) =>
        ids.slice(i * 50, i * 50 + 50),
      )
    : [undefined];
  const rows: T[] = [];
  for (let start = 0; start < batches.length; start += 4) {
    const pages = await Promise.all(
      batches.slice(start, start + 4).map((batch) =>
        readPipelinePages<T>(async (offset) => {
          let q = db
            .from(table)
            .select(columns, { count: "exact" })
            .order("id");
          if (batch) q = q.in(key, batch);
          const result = await q.range(offset, offset + 499);
          return {
            rows: (checkDb(result, "pipeline_tasks." + table) ||
              []) as unknown as T[],
            total: result.count,
          };
        }),
      ),
    );
    rows.push(...pages.flat());
  }
  return rows;
}

export async function loadTasksOverview(query: TaskOverviewQuery) {
  const started = performance.now();
  const reads = new Map<string, { calls: number; max_ms: number; total_ms: number }>();
  try {
    const { db, profile } = await requireUser({
      fetchImpl: async (input, init) => {
        const url = new URL(
          typeof input === "string" || input instanceof URL ? input : input.url,
        );
        // Fixed resource names and durations only: never IDs, filters, URLs or bodies.
        const resource = url.pathname.split("/").at(-1) || "unknown";
        const operation = /^[a-z_]+$/.test(resource) ? resource : "other";
        const before = performance.now();
        try {
          return await fetch(input, init);
        } finally {
          const ms = Math.round(performance.now() - before);
          const sample = reads.get(operation) || { calls: 0, max_ms: 0, total_ms: 0 };
          sample.calls++;
          sample.max_ms = Math.max(sample.max_ms, ms);
          sample.total_ms += ms;
          reads.set(operation, sample);
        }
      },
    });
    return await readTasksOverview(db, profile, query);
  } finally {
    const duration_ms = Math.round(performance.now() - started);
    if (duration_ms >= 1500)
      console.info("pipeline_tasks_read", JSON.stringify({ duration_ms, reads: Object.fromEntries(reads) }));
  }
}

async function readVisibleCampaigns(db: SupabaseClient, profile: Profile) {
  if (!isSellerRole(profile.role)) return [];
  // Use the same visible campaign groups as the current Campaign Control view.
  const [campaigns, groupCampaigns] = await Promise.all([
    readRows<TaskOverviewSource["campaigns"][number]>(
      db,
      "campaigns",
      "id,seller_id,account_id",
    ),
    readPipelinePages<{ id: string }>(async (offset) => {
      const result = await db
        .from("campaign_group_members")
        .select("campaign_id", { count: "exact" })
        .order("campaign_id")
        .range(offset, offset + 499);
      const rows = checkDb(result, "pipeline_tasks.campaign_groups") as
        { campaign_id: string }[] | null;
      return {
        rows: (rows || []).map((r) => ({ id: r.campaign_id })),
        total: result.count,
      };
    }),
  ]);
  const grouped = new Set(groupCampaigns.map((c) => c.id));
  return campaigns.filter(
    (c) =>
      grouped.has(c.id) &&
      (profile.role !== "seller" || c.seller_id === profile.id),
  );
}

async function readCampaignFacts(
  db: SupabaseClient,
  campaigns: TaskOverviewSource["campaigns"],
) {
  const facts: TaskOverviewSource["facts"] = [];
  // Campaign Control uses the same contact facts, deduplicated across groups.
  // Four bounded concurrent campaigns, each independently paged by PostgREST.
  for (let offset = 0; offset < campaigns.length; offset += 4) {
    const batches = await Promise.all(
      campaigns.slice(offset, offset + 4).map(async (c) => {
        const rows = await readPipelinePages<CampaignContact & { id: string }>(
          async (start) => {
            const result = await db
              .rpc(
                "campaign_contact_facts",
                { campaign: c.id },
                { count: "exact" },
              )
              // Pending facts are discarded by the aggregator; never page them.
              .eq("send_status", "sent")
              .order("contact_id")
              .range(start, start + 499);
            const page = checkDb(result, "pipeline_tasks.campaign_facts") as
              CampaignContact[] | null;
            return {
              rows: (page || []).map((r) => ({ ...r, id: r.contact_id })),
              total: result.count,
            };
          },
        );
        return rows.map((r) => ({ ...r, campaignId: c.id }));
      }),
    );
    facts.push(...batches.flat());
  }
  return facts;
}

async function readCaseMail(
  db: SupabaseClient,
  profile: Profile,
  board: PipelineBoard,
) {
  if (board.hasMore)
    throw new HttpError(
      503,
      "El catálogo supera el límite de esta vista / Catalog exceeds this view's limit",
    );
  const conversations = (
    await readRows<TaskOverviewSource["conversations"][number]>(
      db,
      "mail_conversations_visible",
      "id,opportunity_id,account_id,area,submission_id,recipient_email",
      board.rows.map((r) => r.id),
    )
  ).filter((c) => c.area !== "closer" || isCloserRole(profile.role));
  const messages = await readRows<TaskOverviewSource["messages"][number]>(
    db,
    "messages",
    "id,conversation_id,direction,sender,sent_at,status,nature,reply_intent,participants",
    conversations.map((c) => c.id),
    "conversation_id",
  );
  return { conversations, messages };
}

export async function readTasksOverview(
  db: SupabaseClient,
  profile: Profile,
  query: TaskOverviewQuery,
) {
  const boardRead = readPipelineBoard(
    db,
    profile,
    { group: "files" },
    100000,
    false,
  );
  const campaignsRead = readVisibleCampaigns(db, profile);
  const factsRead = campaignsRead.then((campaigns) =>
    readCampaignFacts(db, campaigns),
  );
  const mailRead = boardRead.then((board) => readCaseMail(db, profile, board));
  const [board, profiles, accounts, leads, campaigns, facts, mail] =
    await Promise.all([
      boardRead,
      readRows<Profile>(db, "profiles", "id,name,email,role,active"),
      readRows<TaskOverviewSource["accounts"][number]>(
        db,
        "mail_accounts",
        "id,email,owner_id",
      ),
      isSellerRole(profile.role)
        ? readRows<TaskOverviewSource["leads"][number]>(
            db,
            "lead_workspace",
            "id,contact_id,company,contact,email,seller_id,opportunity_id",
          )
        : [],
      campaignsRead,
      factsRead,
      mailRead,
    ]);
  return buildTasksOverview(
    {
      profile,
      profiles,
      accounts,
      campaigns,
      leads,
      cases: board.rows,
      facts,
      ...mail,
    },
    query,
  );
}
