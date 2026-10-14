import { requireCrmExtensions } from "@/lib/server/crm-readiness";
import { z } from "zod";
import {
  requireUser,
  checkDb,
  serviceClient,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import type { UnderwritingDocument } from "@/lib/underwriting";
export async function GET(request: Request) {
  try {
    const { db } = await requireUser();
    await requireCrmExtensions(db);
    const query = new URL(request.url).searchParams;
    const runId = z.uuid().parse(query.get("run")),
      documentId = z.uuid().parse(query.get("document"));
    const run = checkDb(
      await db
        .from("underwriting_runs")
        .select("document_snapshot")
        .eq("id", runId)
        .maybeSingle(),
    );
    const file = (
      run?.document_snapshot as UnderwritingDocument[] | undefined
    )?.find((d) => d.id === documentId);
    if (!file) throw new HttpError(404, "Document not found");
    const signed = checkDb(
      await serviceClient()
        .storage.from("case-documents")
        .createSignedUrl(file.storage_path, 60, { download: file.name }),
    )!;
    return Response.redirect(signed.signedUrl);
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Invalid document selection" },
        { status: 400 },
      );
    return jsonError(e);
  }
}
