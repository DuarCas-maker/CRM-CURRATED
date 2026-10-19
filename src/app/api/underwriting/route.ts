import { requireCrmExtensions } from "@/lib/server/crm-readiness";
import { z } from "zod";
import {
  checkOrigin,
  requireUser,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate"),
    opportunity_id: z.uuid(),
    request_key: z.uuid(),
  }),
  z.object({
    action: z.literal("reject"),
    run_id: z.uuid(),
    notes: z.string().trim().min(1).max(20000),
  }),
  z.object({
    action: z.literal("approve"),
    run_id: z.uuid(),
    summary: z.string().trim().min(1).max(20000),
    conclusion: z.string().trim().min(1).max(20000),
    observations: z.string().max(20000),
    recommendations: z.string().trim().min(1).max(20000),
  }),
]);
export async function GET(request: Request) {
  try {
    const { db } = await requireUser();
    await requireCrmExtensions(db);
    const caseId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("opportunity"));
    checkDb(
      await db.from("opportunities").select("id").eq("id", caseId).single(),
    );
    const runs =
      checkDb(
        await db
          .from("underwriting_runs")
          .select(
            "id,opportunity_id,status,requested_by,created_at,model,prompt_version,max_output_tokens,document_snapshot,report,last_error,input_tokens,output_tokens,analysis_id",
          )
          .eq("opportunity_id", caseId)
          .order("created_at", { ascending: false })
          .limit(20),
      ) || [];
    if (runs.length) {
      const progress = await db
        .from("underwriting_runs")
        .select(
          "id,progress_stage,progress_percent,documents_processed,progress_updated_at,provider_diagnostics,reviewed_by,reviewed_at,review_notes",
        )
        .in(
          "id",
          runs.map((r) => r.id),
        );
      if (
        progress.error &&
        !["PGRST204", "PGRST205", "42703"].includes(progress.error.code)
      )
        checkDb(progress);
      if (!progress.error)
        for (const run of runs)
          Object.assign(run, progress.data?.find((p) => p.id === run.id) || {});
    }
    return Response.json(
      { runs, configured: !!process.env.OPENAI_API_KEY },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: "Invalid case" }, { status: 400 });
    return jsonError(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await requireUser();
    await requireCrmExtensions(db);
    const p = inputSchema.parse(
      JSON.parse((await readBounded(request, 90000)).toString("utf8")),
    );
    if (p.action === "generate" && !process.env.OPENAI_API_KEY)
      throw new HttpError(
        503,
        "Configura OPENAI_API_KEY en la web y el trabajador. / Configure OpenAI for the web and worker.",
      );
    const r =
      p.action === "generate"
        ? await db.rpc("request_underwriting", {
            case_id: p.opportunity_id,
            request: p.request_key,
          })
        : p.action === "reject"
          ? await db.rpc("reject_underwriting", {
              run_id: p.run_id,
              notes: p.notes,
            })
          : await db.rpc("approve_underwriting", {
              run_id: p.run_id,
              summary_value: p.summary,
              conclusion_value: p.conclusion,
              observations_value: p.observations,
              recommendations_value: p.recommendations,
            });
    if (r.error) {
      const message = r.error.message;
      const known = [
        "read-only",
        "Daily analysis limit",
        "Analysis already",
        "Approve the application",
        "Latest four",
        "Underwriting is disabled",
        "Documents changed",
        "Analysis draft",
        "Complete the analysis",
        "Review note required",
        "ten approved",
      ];
      throw new HttpError(
        message.includes("read-only") ? 403 : 409,
        known.some((k) => message.includes(k))
          ? message
          : "No se pudo completar el análisis. / Analysis could not be completed.",
      );
    }
    return Response.json(
      { id: r.data },
      { status: p.action === "generate" ? 202 : 200 },
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Invalid analysis fields" },
        { status: 400 },
      );
    return jsonError(e);
  }
}
