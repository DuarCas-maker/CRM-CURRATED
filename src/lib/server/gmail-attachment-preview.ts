import { serviceClient, checkDb, HttpError } from "./supabase";
import { decrypt } from "./crypto";
import { gmail } from "./google";
import type { MailSnapshot } from "../gmail-history";
export async function readArchiveAttachment(
  messageId: string,
  partId: string,
  storedPath?: string | null,
) {
  const service = serviceClient();
  const archive = checkDb(
    await service
      .from("gmail_archive_messages")
      .select("*")
      .eq("id", messageId)
      .single(),
  )!;
  const snapshot = JSON.parse(
    decrypt(archive.encrypted_payload),
  ) as MailSnapshot;
  const part = snapshot.attachments.find((f) => f.part_id === partId);
  if (!part) throw new HttpError(404, "Attachment not found");
  if (part.size > 20 * 1024 * 1024)
    throw new HttpError(
      413,
      "La vista previa admite hasta 20 MB. / Preview supports up to 20 MB.",
    );
  let bytes: Buffer;
  if (storedPath) {
    const blob = checkDb(
      await service.storage.from("gmail-documents").download(storedPath),
    )!;
    bytes = Buffer.from(decrypt(await blob.text()), "base64");
  } else {
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
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw new HttpError(413, "Attachment size invalid");
  return { bytes, name: part.name };
}
