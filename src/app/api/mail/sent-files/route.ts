import { z } from "zod";
import {
  requireUser,
  serviceClient,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { decrypt, hash } from "@/lib/server/crypto";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const messageId = z.uuid().parse(p.get("message")),
      fileId = z.uuid().parse(p.get("file"));
    const { db } = await requireUser();
    const message = checkDb(
      await db
        .from("messages")
        .select("internet_message_id,conversation_id")
        .eq("id", messageId)
        .single(),
    )!;
    const conversation = checkDb(
      await db
        .from("conversations")
        .select("opportunity_id")
        .eq("id", message.conversation_id)
        .single(),
    )!;
    const service = serviceClient();
    const sent = checkDb(
      await service
        .from("outbox")
        .select("attachment_snapshot,upload_ids,gmail_file_ids")
        .eq("message_id_header", message.internet_message_id)
        .eq("opportunity_id", conversation.opportunity_id)
        .eq("status", "sent")
        .single(),
    )!;
    const snapshot = (sent.attachment_snapshot || []).find(
      (f: { id: string }) => f.id === fileId,
    );
    if (!snapshot)
      throw new HttpError(404, "This file was not attached to this message");
    const bucket =
      snapshot.bucket ||
      ((sent.upload_ids || []).includes(fileId) ||
      (sent.gmail_file_ids || []).includes(fileId)
        ? "gmail-documents"
        : "case-documents");
    if (
      !["case-documents", "gmail-documents", "campaign-assets"].includes(bucket)
    )
      throw new HttpError(409, "Invalid attachment snapshot");
    const encrypted = bucket === "gmail-documents";
    const blob = checkDb(
      await service.storage.from(bucket).download(snapshot.storage_path),
    )!;
    const bytes = encrypted
      ? Buffer.from(decrypt(await blob.text()), "base64")
      : Buffer.from(await blob.arrayBuffer());
    if (hash(bytes) !== snapshot.content_hash)
      throw new HttpError(409, "Attachment integrity check failed");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(snapshot.name || "Attachment")}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
