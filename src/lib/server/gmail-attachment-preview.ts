import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, checkDb, HttpError } from "./supabase";
import { decrypt } from "./crypto";
import { readAuthorizedGmailAttachment } from "./authorized-gmail-attachment";
import type { MailSnapshot } from "../gmail-history";
export async function readArchiveAttachment(
  db: SupabaseClient,
  messageId: string,
  partId: string,
  storedPath?: string | null,
  authorize?: () => Promise<void>,
) {
  const service = serviceClient();
  const archive = checkDb(
    await db
      .from("mail_archive_visible")
      .select("*")
      .eq("id", messageId)
      .single(),
  )!;
  if (storedPath) {
    const file =
      checkDb(
        await db
          .from("gmail_saved_attachments")
          .select("id")
          .eq("archive_message_id", messageId)
          .eq("part_id", partId)
          .eq("storage_path", storedPath)
          .limit(1),
      ) || [];
    if (!file.length) throw new HttpError(404, "Attachment not found");
  }
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
            await readAuthorizedGmailAttachment(
              archive.account_id,
              archive.gmail_message_id,
              part.attachment_id,
              async () => {
                await authorize?.();
                const current = checkDb(
                  await db
                    .from("mail_archive_visible")
                    .select("account_id,gmail_message_id,encrypted_payload")
                    .eq("id", messageId)
                    .maybeSingle(),
                );
                if (!current) throw new HttpError(404, "Attachment not found");
                if (
                  current.account_id !== archive.account_id ||
                  current.gmail_message_id !== archive.gmail_message_id ||
                  current.encrypted_payload !== archive.encrypted_payload
                )
                  throw new HttpError(409, "Attachment changed; reopen it.");
              },
            )
          ).data
        : "");
    bytes = Buffer.from(data, "base64url");
  }
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw new HttpError(413, "Attachment size invalid");
  return { bytes, name: part.name };
}
