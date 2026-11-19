import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../domain";
import { isCloserRole, isSellerRole } from "../domain";
import type { CampaignContact } from "../campaign-center";
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
  for (const batch of batches)
    rows.push(
      ...(await readPipelinePages<T>(async (offset) => {
        let q = db.from(table).select(columns, { count: "exact" }).order("id");
        if (batch) q = q.in(key, batch);
        const result = await q.range(offset, offset + 499);
        return {
          rows: (checkDb(result, "pipeline_tasks." + table) ||
            []) as unknown as T[],
          total: result.count,
        };
      })),
    );
  return rows;
}

export async function loadTasksOverview(query: TaskOverviewQuery) {
  const { db, profile } = await requireUser();
  return readTasksOverview(db, profile, query);
}

export async function readTasksOverview(
  db: SupabaseClient,
  profile: Profile,
  query: TaskOverviewQuery,
) {
  const seller = isSellerRole(profile.role);
  const [board, profiles, accounts, campaigns, leads] = await Promise.all([
    readPipelineBoard(db, profile, { group: "files" }, 100000, false),
    readRows<Profile>(db, "profiles", "id,name,email,role,active"),
    readRows<TaskOverviewSource["accounts"][number]>(
      db,
      "mail_accounts",
      "id,email,owner_id",
    ),
    seller
      ? readRows<TaskOverviewSource["campaigns"][number]>(
          db,
          "campaigns",
          "id,seller_id,account_id",
        )
      : [],
    seller
      ? readRows<TaskOverviewSource["leads"][number]>(
          db,
          "lead_workspace",
          "id,contact_id,company,contact,email,seller_id,opportunity_id",
        )
      : [],
  ]);
  if (board.hasMore)
    throw new HttpError(
      503,
      "El catálogo supera el límite de esta vista / Catalog exceeds this view's limit",
    );
  // Use the same visible campaign groups as the current Campaign Control view.
  const groupCampaigns = seller
    ? await readPipelinePages<{ id: string }>(async (offset) => {
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
      })
    : [];
  const grouped = new Set(groupCampaigns.map((c) => c.id));
  const authorizedCampaigns = campaigns.filter(
    (c) =>
      grouped.has(c.id) &&
      (profile.role !== "seller" || c.seller_id === profile.id),
  );
  const facts: TaskOverviewSource["facts"] = [];
  // Campaign Control uses the same contact facts, deduplicated across groups.
  // Four bounded concurrent campaigns, each independently paged by PostgREST.
  for (let offset = 0; offset < authorizedCampaigns.length; offset += 4) {
    const batches = await Promise.all(
      authorizedCampaigns.slice(offset, offset + 4).map(async (c) => {
        const rows = await readPipelinePages<CampaignContact & { id: string }>(
          async (start) => {
            const result = await db
              .rpc(
                "campaign_contact_facts",
                { campaign: c.id },
                { count: "exact" },
              )
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
  return buildTasksOverview(
    {
      profile,
      profiles,
      accounts,
      campaigns: authorizedCampaigns,
      leads,
      cases: board.rows,
      facts,
      conversations,
      messages,
    },
    query,
  );
}
