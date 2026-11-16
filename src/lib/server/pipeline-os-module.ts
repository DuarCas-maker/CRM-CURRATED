import type { SupabaseClient } from "@supabase/supabase-js";
import { underwritingReadiness } from "../underwriting-status";
import type { Opportunity, Profile, Workspace } from "../domain";
import { canSeeOpportunity, canSeeArea } from "../domain";
import {
  buildPipelineBoard,
  type PipelineQuery,
  type PipelineProcess,
  type PipelineMailUpdate,
} from "../pipeline-os/module";
import { checkDb, HttpError, requireUser } from "./supabase";
import {
  approvedReportIds,
  confirmedLenderSends,
  latestConfirmation,
  type FlowReport,
  type FlowEvent,
  type FlowSignal,
} from "../pipeline-os/case-flow";
import {
  summarizeOpportunities,
  type SignalConversation,
  type SignalMessage,
} from "../opportunity-signals";

/** Follow the actual returned count, including installations with a smaller REST page cap. */
export async function readPipelinePages<T>(
  read: (offset: number) => Promise<{ rows: T[]; total: number | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let expectedTotal: number | undefined;
  const seen = new Set<string>();
  for (let offset = 0; ;) {
    const page = await read(offset);
    if (
      page.total === null ||
      !Number.isSafeInteger(page.total) ||
      page.total < 0
    )
      throw new HttpError(
        503,
        "No se pudo comprobar el total del catálogo / Catalog count unavailable",
      );
    if (!page.rows.length && offset < page.total)
      throw new HttpError(
        503,
        "Lectura incompleta del catálogo / Incomplete catalog read",
      );
    if (expectedTotal !== undefined && page.total !== expectedTotal)
      throw new HttpError(
        503,
        "El catálogo cambió durante la lectura; actualiza / Catalog changed during the read; refresh",
      );
    expectedTotal = page.total;
    for (const row of page.rows) {
      const key =
        row && typeof row === "object"
          ? "id" in row
            ? String(row.id)
            : "email" in row
              ? String(row.email)
              : undefined
          : undefined;
      if (key && seen.has(key))
        throw new HttpError(
          503,
          "El catálogo cambió durante la lectura; actualiza / Catalog changed during the read; refresh",
        );
      if (key) seen.add(key);
    }
    rows.push(...page.rows);
    offset += page.rows.length;
    if (offset >= page.total) return rows;
    if (offset >= 100000)
      throw new HttpError(
        503,
        "El catálogo supera el límite de esta vista; contacta al administrador / Catalog exceeds this view's limit; contact the administrator",
      );
  }
}

async function readTable<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  ids?: string[],
  key = "opportunity_id",
  sentOnly = false,
) {
  if (ids && !ids.length) return [] as T[];
  const batches: (string[] | undefined)[] = ids
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
        if (sentOnly) q = q.eq("direction", "outbound").eq("status", "sent");
        if (table === "opportunity_workspace") q = q.is("archived_at", null);
        if (table === "lenders") q = q.is("archived_at", null);
        const result = await q.range(offset, offset + 499);
        const data = checkDb(result, `pipeline_os.${table}`) || [];
        return { rows: data as unknown as T[], total: result.count };
      })),
    );
  return rows;
}

export async function loadPipelineBoard(query: Partial<PipelineQuery> = {}) {
  const { db, profile } = await requireUser();
  return readPipelineBoard(db, profile, query);
}

export async function readPipelineBoard(
  db: SupabaseClient,
  profile: Profile,
  query: Partial<PipelineQuery> = {},
) {
  const raw = await readTable<Opportunity>(
    db,
    "opportunity_workspace",
    "id,company,contact,email,phone,industry,amount,stage,seller_id,closer_id,next_action,next_action_at,created_at,updated_at,application_complete,application_signed,funded_at,funded_amount,handed_off_at",
  );
  const opportunities = raw.filter((o) => canSeeOpportunity(profile, o));
  const ids = opportunities.map((o) => o.id);
  const closerIds = opportunities
    .filter((o) => canSeeArea(profile, o, "closer"))
    .map((o) => o.id);
  const [
    profiles,
    accounts,
    lenders,
    lender_contacts,
    tasks,
    documents,
    offers,
    submissions,
    processes,
    campaigns,
  ] = await Promise.all([
    readTable<Workspace["profiles"][number]>(
      db,
      "profiles",
      "id,name,email,role,active",
    ),
    readTable<Workspace["accounts"][number]>(db, "mail_accounts", "id,email"),
    readTable<Workspace["lenders"][number]>(db, "lenders", "id,name,email"),
    // lender_contacts has no id; readContacts uses its stable unique email key.
    readContacts(db),
    readTable<Workspace["tasks"][number]>(
      db,
      "tasks",
      "id,opportunity_id,owner_id,title,due_at,status,area",
      ids,
    ),
    readTable<Workspace["documents"][number]>(
      db,
      "documents",
      "id,opportunity_id,kind,status,required,storage_path,content_hash",
      ids,
    ),
    readTable<Workspace["offers"][number]>(
      db,
      "offers",
      "id,opportunity_id,submission_id,product,amount,term,cost,frequency,fees,expires_at,status",
      closerIds,
    ),
    readTable<Workspace["submissions"][number]>(
      db,
      "submissions",
      "id,opportunity_id,process_id,lender_id,status,next_action,next_action_at",
      closerIds,
    ),
    readTable<PipelineProcess>(
      db,
      "financing_processes",
      "id,opportunity_id,sequence_number,state,classification,is_unclassified_archive,started_at",
      closerIds,
    ),
    readTable<Pick<Workspace["campaigns"][number], "id" | "status">>(
      db,
      "campaign_workspace",
      "id,status",
    ),
  ]);
  const directory = { profiles, accounts, lenders, lender_contacts };
  // Reuse the CRM's evidence rules, but page metadata with the catalog's exact-count reader.
  const conversations = await readTable<SignalConversation>(
    db,
    "mail_conversations_visible",
    "id,opportunity_id,submission_id,recipient_email,process_id",
    ids,
  );
  const messages = await readTable<SignalMessage>(
    db,
    "messages",
    "id,conversation_id,direction,status,sent_at,participants",
    conversations.map((c) => c.id),
    "conversation_id",
    true,
  );
  const opportunity_signals = summarizeOpportunities(opportunities, {
    ...directory,
    documents,
    submissions,
    conversations,
    messages,
  });
  const [reports, analyses, flowEvents] = await Promise.all([
    readTable<FlowReport>(
      db,
      "underwriting_runs",
      "id,opportunity_id,status,analysis_id,reviewed_at,created_at",
      ids,
    ),
    readTable<Workspace["analyses"][number]>(
      db,
      "analyses",
      "id,opportunity_id,is_current",
      ids,
    ),
    readTable<FlowEvent>(
      db,
      "case_events",
      "id,opportunity_id,process_id,kind,occurred_at,created_at,archive_message_id,document_id,workflow_value",
      closerIds,
    ),
  ]);
  const approved = approvedReportIds(reports, analyses),
    flow_signals: Record<string, FlowSignal> = {};
  for (const opportunity of opportunities) {
    const process = processes
      .filter(
        (p) =>
          p.opportunity_id === opportunity.id &&
          p.classification === "active" &&
          !p.is_unclassified_archive,
      )
      .sort((a, b) => b.sequence_number - a.sequence_number)[0];
    const confirmation = latestConfirmation(
      flowEvents,
      opportunity.id,
      "submissions",
      process?.id || null,
    );
    const sourceCorrection = latestConfirmation(
      flowEvents,
      opportunity.id,
      "sources",
      null,
    );
    const delivered = confirmedLenderSends({
      opportunity,
      process,
      reports: reports.filter((r) => r.opportunity_id === opportunity.id),
      analyses,
      conversations: conversations as Workspace["conversations"],
      messages: messages as Workspace["messages"],
      submissions,
      lenders,
      lender_contacts,
      events: flowEvents,
    });
    const sourceDecision = sourceCorrection?.workflow_value?.decision;
    flow_signals[opportunity.id] = {
      approved: reports.some(
        (r) => r.opportunity_id === opportunity.id && approved.has(r.id),
      ),
      ready:
        sourceDecision === "confirmed" ||
        (sourceDecision !== "pending" &&
          underwritingReadiness(
            documents.filter((d) => d.opportunity_id === opportunity.id),
          ).ready),
      sent: new Set(delivered.map((m) => m.message_id)).size,
      manualSent:
        confirmation?.workflow_value?.decision === "automatic" || !confirmation
          ? null
          : confirmation.workflow_value?.decision === "confirmed",
    };
  }
  const mail_review_updates: PipelineMailUpdate[] = [];
  for (let offset = 0; offset < closerIds.length; offset += 50) {
    const batch = closerIds.slice(offset, offset + 50);
    const events = await readPipelinePages<PipelineMailUpdate>(
      async (start) => {
        const r = await db
          .from("pipeline_mail_reviews")
          .select("id,opportunity_id,message_id,approved_at,approved_value", {
            count: "exact",
          })
          .eq("status", "approved")
          .in("opportunity_id", batch)
          .order("id")
          .range(start, start + 499);
        // Existing installations retain their board until the additive migration is applied.
        if (r.error && ["42P01", "PGRST205"].includes(r.error.code || ""))
          return { rows: [], total: 0 };
        return {
          rows: checkDb(r, "pipeline_os.mail_reviews") || [],
          total: r.count,
        };
      },
    );
    mail_review_updates.push(...events);
  }
  return buildPipelineBoard(
    {
      ...directory,
      profile,
      opportunities,
      tasks,
      documents,
      offers,
      submissions,
      campaigns,
      opportunity_signals,
      mail_review_updates,
      flow_signals,
      conversations: [],
      messages: [],
    },
    processes,
    query,
  );
}

async function readContacts(
  db: SupabaseClient,
): Promise<NonNullable<Workspace["lender_contacts"]>> {
  return readPipelinePages(async (offset) => {
    const r = await db
      .from("lender_contacts")
      .select("lender_id,email,name", { count: "exact" })
      .order("email")
      .range(offset, offset + 499);
    return {
      rows: checkDb(r, "pipeline_os.lender_contacts") || [],
      total: r.count,
    };
  });
}
