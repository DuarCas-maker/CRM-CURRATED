import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  requireUser,
  serviceClient,
  checkDb,
  checkOrigin,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { encrypt, hash } from "@/lib/server/crypto";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    const caseId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("case"));
    if (!checkDb(await db.rpc("can_mail_case", { case_id: caseId })))
      throw new HttpError(403, "Case access required");
    const bytes = await readBounded(request, 18 * 1024 * 1024);
    if (!bytes.length) throw new HttpError(400, "Empty attachment");
    const name = z
      .string()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n\x00-\x1f]/.test(s))
      .parse(decodeURIComponent(request.headers.get("x-file-name") || ""));
    const mime = z
      .string()
      .max(150)
      .regex(/^[\w.+-]+\/[\w.+-]+$/)
      .parse(request.headers.get("content-type") || "application/octet-stream");
    const id = randomUUID(),
      path = `${caseId}/uploads/${id}`,
      contentHash = hash(bytes),
      service = serviceClient();
    checkDb(
      await service.storage
        .from("gmail-documents")
        .upload(path, Buffer.from(encrypt(bytes.toString("base64"))), {
          contentType: "application/octet-stream",
          upsert: false,
        }),
    );
    const inserted = await service
      .from("mail_uploads")
      .insert({
        id,
        opportunity_id: caseId,
        uploaded_by: profile.id,
        name,
        mime_type: mime,
        size: bytes.length,
        storage_path: path,
        content_hash: contentHash,
      });
    if (inserted.error) {
      await service.storage.from("gmail-documents").remove([path]);
      checkDb(inserted);
    }
    return Response.json({ id, name, size: bytes.length });
  } catch (e) {
    return jsonError(e);
  }
}
