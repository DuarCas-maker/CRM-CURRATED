import { z } from "zod";
import {
  requireUser,
  checkDb,
  jsonError,
  HttpError,
} from "@/lib/server/supabase";
import { readArchiveAttachment } from "@/lib/server/gmail-attachment-preview";
import { attachmentPreviewType } from "@/lib/gmail-attachments";
import { gmailHistoryEnabled } from "@/lib/gmail-feature";
export async function GET(request: Request) {
  try {
    if (!gmailHistoryEnabled())
      throw new HttpError(503, "Gmail history is not enabled");
    const p = new URL(request.url).searchParams,
      message = z.uuid().parse(p.get("message")),
      part = z.string().min(1).max(200).parse(p.get("part"));
    const { db, profile } = await requireUser();
    const files =
      checkDb(
        await db
          .from("gmail_saved_attachments")
          .select("storage_path")
          .eq("archive_message_id", message)
          .eq("part_id", part)
          .limit(1),
      ) || [];
    if (profile.role !== "superadmin" && !files.length)
      throw new HttpError(403, "Attachment access required");
    const { bytes, name } = await readArchiveAttachment(
      message,
      part,
      files[0]?.storage_path,
    );
    const type = attachmentPreviewType(bytes);
    if (!type)
      throw new HttpError(
        415,
        "Sin vista previa para este formato. Puedes abrir el correo original. / Preview is unavailable; open the original email.",
      );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
