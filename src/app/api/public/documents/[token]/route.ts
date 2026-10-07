import { boundedForm } from "@/lib/server/body";
import { z } from "zod";
import { resolveApplicationLink } from "@/lib/server/application-links";
import {
  checkOrigin,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { storeDocument } from "@/lib/server/documents";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    checkOrigin(request);
    const { token } = await params;
    const { db, link } = await resolveApplicationLink(token);
    const form = await boundedForm(request, 51 * 1024 * 1024);
    const documentId = z.uuid().parse(form.get("document_id"));
    const doc = checkDb(
      await db
        .from("documents")
        .select("id,kind")
        .eq("id", documentId)
        .eq("opportunity_id", link.opportunity_id)
        .maybeSingle(),
    );
    if (!doc || doc.kind === "application")
      throw new HttpError(404, "Requested document not found");
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "File required");
    return Response.json(
      await storeDocument(
        file,
        documentId,
        link.opportunity_id,
        "public_form",
        null,
      ),
    );
  } catch (e) {
    return jsonError(e);
  }
}
