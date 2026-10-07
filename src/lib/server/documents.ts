import { hash } from "./crypto";
import { checkDb, HttpError, serviceClient } from "./supabase";
export async function storeDocument(
  file: File,
  documentId: string,
  opportunityId: string,
  source: string,
  actor: string | null,
) {
  if (file.size === 0 || file.size > 20 * 1024 * 1024)
    throw new HttpError(413, "File must be between 1 byte and 20 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind =
    bytes.subarray(0, 5).toString() === "%PDF-"
      ? "pdf"
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        ? "jpg"
        : bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "png"
          : null;
  if (!kind)
    throw new HttpError(400, "Only PDF, JPG and PNG files are accepted");
  const contentHash = hash(bytes);
  const path = `${opportunityId}/${documentId}/${contentHash}.${kind}`;
  const db = serviceClient();
  const upload = await db.storage.from("case-documents").upload(path, bytes, {
    contentType:
      kind === "pdf"
        ? "application/pdf"
        : `image/${kind === "jpg" ? "jpeg" : "png"}`,
    upsert: false,
  });
  if (upload.error && !upload.error.message.toLowerCase().includes("exist"))
    throw new HttpError(500, "Document upload failed");
  checkDb(
    await db.rpc("register_document", {
      document_id: documentId,
      path,
      content_hash: contentHash,
      source,
      actor,
    }),
  );
  return { received: true };
}
