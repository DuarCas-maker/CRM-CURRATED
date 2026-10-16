import { z } from "zod";
import {
  checkOrigin,
  requireUser,
  jsonError,
  HttpError,
} from "@/lib/server/supabase";
import { boundedForm } from "@/lib/server/body";
import { receiveDocument } from "@/lib/server/document-intake";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    const form = await boundedForm(request, 21 * 1024 * 1024),
      file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "File required");
    const payload = JSON.parse(String(form.get("payload"))),
      key = z.uuid().parse(form.get("request_key"));
    if (payload.source !== "upload")
      throw new HttpError(400, "Invalid upload source");
    return Response.json({
      result: await receiveDocument(payload, key, db, profile.id, file),
    });
  } catch (e) {
    return jsonError(e);
  }
}
