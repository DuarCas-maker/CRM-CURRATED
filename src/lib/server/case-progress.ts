import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Opportunity, Profile } from "../domain";
import { canSeeArea, canSeeOpportunity } from "../domain";
import {
  buildCaseProgress,
  type CaseProgress,
  type CaseProgressSource,
} from "../pipeline-os/case-progress";
import { readPipelinePages } from "./pipeline-os-module";
import { checkDb, HttpError, jsonError, requireUser } from "./supabase";

export async function readCaseProgress(
  db: SupabaseClient,
  profile: Profile,
  id: string,
) {
  const opportunity = checkDb(
    await db
      .from("opportunity_workspace")
      .select(
        "id,stage,seller_id,closer_id,handed_off_at,application_complete,application_signed",
      )
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle(),
    "case_progress.opportunity",
  ) as Opportunity | null;
  if (!opportunity || !canSeeOpportunity(profile, opportunity))
    throw new HttpError(404, "Expediente no disponible / Case unavailable");
  async function rows<T>(table: string, columns: string): Promise<T[]> {
    return readPipelinePages<T>(async (offset) => {
      const result = await db
        .from(table)
        .select(columns, { count: "exact" })
        .eq("opportunity_id", id)
        .order("id")
        .range(offset, offset + 499);
      return {
        rows: (checkDb(result, `case_progress.${table}`) || []) as T[],
        total: result.count,
      };
    });
  }
  const closer = canSeeArea(profile, opportunity, "closer");
  const [documents, analyses, processes, submissions, offers, events] =
    await Promise.all([
      rows<CaseProgressSource["documents"][number]>(
        "documents",
        "id,opportunity_id,kind,status,required,storage_path,content_hash",
      ),
      rows<CaseProgressSource["analyses"][number]>(
        "analyses",
        "id,opportunity_id,summary,conclusion,recommendations,reviewer_id,reviewed_at,is_current",
      ),
      closer
        ? rows<CaseProgressSource["processes"][number]>(
            "financing_processes",
            "id,opportunity_id,sequence_number,state,classification,is_unclassified_archive,actual_funded_amount,funded_lender_id",
          )
        : [],
      closer
        ? rows<CaseProgressSource["submissions"][number]>(
            "submissions",
            "id,opportunity_id,process_id,lender_id,status,submitted_at",
          )
        : [],
      closer
        ? rows<CaseProgressSource["offers"][number]>(
            "offers",
            "id,opportunity_id,submission_id,amount,status,expires_at",
          )
        : [],
      closer
        ? rows<CaseProgressSource["events"][number]>(
            "case_events",
            "id,opportunity_id,process_id,kind,occurred_at,archive_message_id,document_id",
          )
        : [],
    ]);
  return buildCaseProgress({
    profile,
    opportunity,
    documents,
    analyses,
    processes,
    submissions,
    offers,
    events,
  });
}

export async function loadCaseProgress(id: string) {
  const { db, profile } = await requireUser();
  return readCaseProgress(db, profile, id);
}

export async function caseProgressResponse(
  request: Request,
  load: (id: string) => Promise<CaseProgress>,
) {
  let response: Response;
  try {
    const id = z.uuid().parse(new URL(request.url).searchParams.get("case"));
    response = Response.json(await load(id));
  } catch (error) {
    response =
      error instanceof z.ZodError
        ? Response.json(
            { error: "Expediente inválido / Invalid case" },
            { status: 400 },
          )
        : jsonError(error);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
