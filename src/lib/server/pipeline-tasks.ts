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
import {
  readPipelineBoard,
  readPipelinePages,
  type PipelineBoardMail,
} from "./pipeline-os-module";
import { checkDb, HttpError, requireUser } from "./supabase";
import { observeTasksRead } from "./pipeline-tasks-observation";

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
  return observeTasksRead(async (fetchImpl) => {
    const { db, profile } = await requireUser({ fetchImpl });
    return readTasksOverview(db, profile, query);
  });
}

async function readVisibleCampaigns(db: SupabaseClient, profile: Profile) {
  if (!isSellerRole(profile.role)) return [];
  // Use the same visible campaign groups as the current Campaign Control view.
  const [campaigns, groupCampaigns] = await Promise.all([
    readRows<TaskOverviewSource["campaigns"][number]>(
      db,
      "campaigns",
      "id,seller_id,account_id,first_contact,selected_contact_ids",
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

async function readTaskAudience(
  db: SupabaseClient,
  campaigns: TaskOverviewSource["campaigns"],
) {
  // Membership only. Keep the expensive contact-facts RPC restricted to sent evidence.
  const enrollments = await readRows<{
    id: string;
    campaign_id: string;
    contact_id: string;
    opportunity_id: string;
  }>(
    db,
    "campaign_enrollments",
    "id,campaign_id,contact_id,opportunity_id",
    campaigns.map((c) => c.id),
    "campaign_id",
  );
  return [
    ...enrollments.map((e) => ({
      campaignId: e.campaign_id,
      contact_id: e.contact_id,
      opportunity_id: e.opportunity_id,
    })),
    ...campaigns.flatMap((c) =>
      c.first_contact
        ? (c.selected_contact_ids || []).map((contact_id) => ({
            campaignId: c.id,
            contact_id,
            opportunity_id: null,
          }))
        : [],
    ),
  ];
}

function visibleCaseMail(
  profile: Profile,
  board: PipelineBoard,
  mail: PipelineBoardMail,
) {
  if (board.hasMore)
    throw new HttpError(
      503,
      "El catálogo supera el límite de esta vista / Catalog exceeds this view's limit",
    );
  const visibleCases = new Set(board.rows.map((r) => r.id));
  const conversations = mail.conversations.filter(
    (c) =>
      visibleCases.has(c.opportunity_id) &&
      (c.area !== "closer" || isCloserRole(profile.role)),
  );
  const conversationIds = new Set(conversations.map((c) => c.id));
  const messages = mail.messages.filter((m) =>
    conversationIds.has(m.conversation_id),
  );
  return { conversations, messages };
}

export async function readTasksOverview(
  db: SupabaseClient,
  profile: Profile,
  query: TaskOverviewQuery,
) {
  let mailSnapshot: PipelineBoardMail | undefined;
  const boardRead = readPipelineBoard(
    db,
    profile,
    { group: "files" },
    100000,
    false,
    (mail) => {
      mailSnapshot = mail;
    },
  );
  const campaignsRead = readVisibleCampaigns(db, profile);
  const factsRead = campaignsRead.then((campaigns) =>
    readCampaignFacts(db, campaigns),
  );
  const audienceRead = campaignsRead.then((campaigns) =>
    readTaskAudience(db, campaigns),
  );
  const mailRead = boardRead.then((board) => {
    if (!mailSnapshot)
      throw new HttpError(
        503,
        "No se pudo comprobar el correo / Mail snapshot unavailable",
      );
    return visibleCaseMail(profile, board, mailSnapshot);
  });
  const [board, profiles, accounts, leads, campaigns, facts, mail, audience] =
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
      audienceRead,
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
      audience,
      ...mail,
    },
    query,
  );
}
