import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentSource } from "../document-review";
import {
  incorporateDocumentSchema,
  documentReviewSchema,
} from "../document-review";
import { checkDb, HttpError, serviceClient } from "./supabase";
import { readArchiveAttachment } from "./gmail-attachment-preview";
import { gmail } from "./google";
import { uploadDocument } from "./documents";

export async function documentSource(
  db: SupabaseClient,
  source: DocumentSource,
  id: string,
) {
  if (source === "document") {
    const row = checkDb(
      await db.from("documents").select("*").eq("id", id).maybeSingle(),
    );
    if (!row) throw new HttpError(404, "Document not found");
    return {
      row,
      opportunityId: row.opportunity_id as string,
      name: row.name as string,
      documentId: id,
    };
  }
  const table =
    source === "saved" ? "gmail_saved_attachments" : "message_attachments";
  const row = checkDb(
    await db.from(table).select("*").eq("id", id).maybeSingle(),
  );
  if (!row) throw new HttpError(404, "Attachment not found");
  let opportunityId = row.opportunity_id;
  if (source === "legacy") {
    const msg = checkDb(
      await db
        .from("messages")
        .select("conversation_id")
        .eq("id", row.message_id)
        .single(),
    )!;
    const co = checkDb(
      await db
        .from("conversations")
        .select("opportunity_id")
        .eq("id", msg.conversation_id)
        .single(),
    )!;
    opportunityId = co.opportunity_id;
  }
  return {
    row,
    opportunityId: opportunityId as string,
    name: row.name as string,
    documentId: row.imported_document_id as string | null,
  };
}
export async function documentBytes(
  db: SupabaseClient,
  source: DocumentSource,
  id: string,
) {
  const context = await documentSource(db, source, id);
  const row = context.row;
  let bytes: Buffer;
  if (source === "document") {
    if (!row.storage_path) throw new HttpError(404, "Document file pending");
    const blob = checkDb(
      await serviceClient()
        .storage.from("case-documents")
        .download(row.storage_path),
    )!;
    bytes = Buffer.from(await blob.arrayBuffer());
  } else if (source === "saved") {
    bytes = (
      await readArchiveAttachment(
        row.archive_message_id,
        row.part_id,
        row.storage_path,
      )
    ).bytes;
  } else {
    if (row.size > 20 * 1024 * 1024)
      throw new HttpError(413, "Attachment exceeds 20 MB");
    const msg = checkDb(
      await db
        .from("messages")
        .select("gmail_message_id,conversation_id")
        .eq("id", row.message_id)
        .single(),
    )!;
    const co = checkDb(
      await db
        .from("conversations")
        .select("account_id")
        .eq("id", msg.conversation_id)
        .single(),
    )!;
    const file = await gmail<{ data: string }>(
      co.account_id,
      `messages/${msg.gmail_message_id}/attachments/${row.gmail_attachment_id}`,
    );
    bytes = Buffer.from(file.data, "base64url");
  }
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw new HttpError(413, "Document size invalid");
  return { ...context, bytes };
}
export async function documentAction(
  kind: string,
  payload: Record<string, unknown>,
  requestKey: string,
  db: SupabaseClient,
  actor: string,
) {
  let input: Record<string, unknown>;
  if (kind === "incorporate_document") {
    const p = incorporateDocumentSchema.parse(payload);
    const context = await documentSource(db, p.source, p.source_id);
    if (context.opportunityId !== p.opportunity_id)
      throw new HttpError(400, "Attachment belongs to another opportunity");
    if (!checkDb(await db.rpc("can_edit_case", { case_id: p.opportunity_id })))
      throw new HttpError(403, "Case is read-only");
    const doc = checkDb(
      await db
        .from("documents")
        .select("id")
        .eq("id", p.document_id)
        .eq("opportunity_id", p.opportunity_id)
        .maybeSingle(),
    );
    if (!doc)
      throw new HttpError(400, "Document belongs to another opportunity");
    const file = await documentBytes(db, p.source, p.source_id);
    const uploaded = await uploadDocument(
      new File([new Uint8Array(file.bytes)], context.name),
      p.document_id,
      p.opportunity_id,
    );
    input = {
      ...p,
      storage_path: uploaded.path,
      content_hash: uploaded.contentHash,
    };
  } else input = documentReviewSchema.parse(payload);
  const response =
    kind === "incorporate_document"
      ? await serviceClient().rpc("incorporate_case_document", {
          p: input,
          request_key: requestKey,
          acting_user: actor,
        })
      : await db.rpc("case_document_command", {
          kind,
          p: input,
          request_key: requestKey,
        });
  if (response.error) {
    const message = response.error.message;
    if (message.includes("Document changed"))
      throw new HttpError(
        409,
        "El archivo cambió. Cierra y vuelve a abrir la revisión. / Document changed; reopen the review.",
      );
    if (message.includes("already incorporated"))
      throw new HttpError(
        409,
        "El adjunto ya pertenece a otro documento. / Attachment already incorporated.",
      );
    if (message.includes("unique constraint"))
      throw new HttpError(
        409,
        "Ya existe un documento para ese período. / A document already exists for this period.",
      );
    if (message.includes("read-only"))
      throw new HttpError(403, "Case is inaccessible or read-only");
    throw new HttpError(
      400,
      "No se pudo guardar la revisión. Comprueba documento, período y notas. / Check the document, period and review notes.",
    );
  }
  return response.data;
}
