import { boundedForm } from "@/lib/server/body";
import { z } from "zod";
import {
  checkOrigin,
  requireUser,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { storeDocument } from "@/lib/server/documents";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    const form = await boundedForm(request, 51 * 1024 * 1024);
    const opportunityId = z.uuid().parse(form.get("opportunity_id"));
    const documentId = z.uuid().parse(form.get("document_id"));
    if (!checkDb(await db.rpc("can_edit_case", { case_id: opportunityId })))
      throw new HttpError(403, "Case is read-only");
    const doc = checkDb(
      await db
        .from("documents")
        .select("id")
        .eq("id", documentId)
        .eq("opportunity_id", opportunityId)
        .maybeSingle(),
    );
    if (!doc) throw new HttpError(404, "Document not found");
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "File required");
    return Response.json(
      await storeDocument(
        file,
        documentId,
        opportunityId,
        "team_upload",
        profile.id,
      ),
    );
  } catch (e) {
    return jsonError(e);
  }
}
