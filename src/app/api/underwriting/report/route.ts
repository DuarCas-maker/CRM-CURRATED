import { z } from "zod";
import {
  requireUser,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { underwritingPdf } from "@/lib/underwriting-pdf";
import type { UnderwritingRun } from "@/lib/underwriting";
export async function GET(request: Request) {
  try {
    const { db } = await requireUser();
    const query = new URL(request.url).searchParams;
    const runId = z.uuid().parse(query.get("run"));
    const run = checkDb(
      await db
        .from("underwriting_runs")
        .select(
          "id,opportunity_id,status,created_at,model,prompt_version,document_snapshot,report",
        )
        .eq("id", runId)
        .maybeSingle(),
    ) as UnderwritingRun | null;
    if (!run?.report) throw new HttpError(404, "Analysis report not found");
    const company = checkDb(
      await db
        .from("opportunities")
        .select("company")
        .eq("id", run.opportunity_id)
        .single(),
    );
    if (!company) throw new HttpError(404, "Opportunity not found");
    // Extra review columns are optional during a rolling deployment before 038.
    const review = await db
      .from("underwriting_runs")
      .select("reviewed_by,reviewed_at,review_notes")
      .eq("id", runId)
      .single();
    if (review.error && !["42703", "PGRST204"].includes(review.error.code))
      checkDb(review);
    if (!review.error) Object.assign(run, review.data);
    const bytes = await underwritingPdf(
      run,
      company.company,
      query.get("locale") === "en" ? "en" : "es",
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="analysis-${runId}-${query.get("locale") === "en" ? "en" : "es"}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: "Invalid analysis selection" },
        { status: 400 },
      );
    return jsonError(error);
  }
}
