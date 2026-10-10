import {
  requireUser,
  serviceClient,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { decrypt } from "@/lib/server/crypto";
import { gmail } from "@/lib/server/google";
import type { MailSnapshot } from "@/lib/gmail-history";
import { z } from "zod";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success)
      throw new HttpError(400, "Invalid file");
    const { db } = await requireUser();
    // RLS checks the case and message phase before any privileged download or Gmail call.
    const file = checkDb(
      await db
        .from("gmail_saved_attachments")
        .select("*")
        .eq("id", id)
        .single(),
    )!;
    const service = serviceClient();
    let bytes: Buffer;
    if (file.storage_path) {
      const blob = checkDb(
        await service.storage
          .from("gmail-documents")
          .download(file.storage_path),
      )!;
      bytes = Buffer.from(decrypt(await blob.text()), "base64");
    } else {
      if (file.size > 20 * 1024 * 1024)
        throw new HttpError(413, "File exceeds 20 MB");
      const archive = checkDb(
        await service
          .from("gmail_archive_messages")
          .select("*")
          .eq("id", file.archive_message_id)
          .single(),
      )!;
      const snapshot = JSON.parse(
        decrypt(archive.encrypted_payload),
      ) as MailSnapshot;
      const part = snapshot.attachments.find((f) => f.part_id === file.part_id);
      if (!part) throw new HttpError(404, "Attachment not found");
      const data =
        part.data ||
        (part.attachment_id
          ? (
              await gmail<{ data: string }>(
                archive.account_id,
                `messages/${archive.gmail_message_id}/attachments/${part.attachment_id}`,
              )
            ).data
          : "");
      bytes = Buffer.from(data, "base64url");
    }
    if (bytes.length > 20 * 1024 * 1024)
      throw new HttpError(413, "File exceeds 20 MB");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
