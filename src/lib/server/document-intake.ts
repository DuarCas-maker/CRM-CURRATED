import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { receiveDocumentSchema, intakeDestination } from "../document-intake";
import { documentSource, documentBytes } from "./document-review";
import { checkDb, HttpError, serviceClient } from "./supabase";
import { uploadDocument } from "./documents";
import { hash } from "./crypto";
import type { Document } from "../domain";
export async function receiveDocument(
  payload: unknown,
  key: string,
  db: SupabaseClient,
  actor: string,
  upload?: File,
) {
  const p = receiveDocumentSchema.parse(payload);
  if (!checkDb(await db.rpc("can_edit_case", { case_id: p.opportunity_id })))
    throw new HttpError(403, "Case is read-only");
  if (p.source === "upload" && !upload)
    throw new HttpError(400, "File required");
  const source =
    p.source === "upload"
      ? {
          opportunityId: p.opportunity_id,
          documentId: null,
          name: upload!.name,
        }
      : await documentSource(db, p.source, p.source_id);
  if (source.opportunityId !== p.opportunity_id)
    throw new HttpError(403, "Attachment belongs to another opportunity");
  const documents = (checkDb(
    await db
      .from("documents")
      .select("*")
      .eq("opportunity_id", p.opportunity_id),
  ) || []) as Document[];
  const destination = intakeDestination(documents, p.kind, p.bank_name);
  const receipt = checkDb(
    await serviceClient()
      .from("command_receipts")
      .select("kind,result")
      .eq("user_id", actor)
      .eq("request_key", key)
      .maybeSingle(),
  );
  if (receipt && receipt.kind !== "receive_document")
    throw new HttpError(409, "Idempotency key reused");
  const target =
    receipt?.result?.document_id ||
    p.replace_document_id ||
    source.documentId ||
    destination.document?.id ||
    randomUUID();
  const file =
    p.source === "upload"
      ? { bytes: Buffer.from(await upload!.arrayBuffer()) }
      : await documentBytes(db, p.source, p.source_id);
  if (hash(file.bytes) !== p.expected_source_hash)
    throw new HttpError(
      409,
      "El archivo cambió; vuelve a abrirlo. / File changed; reopen it.",
    );
  const uploaded = await uploadDocument(
    new File([new Uint8Array(file.bytes)], source.name),
    target,
    p.opportunity_id,
  );
  const result = await serviceClient().rpc("receive_case_document", {
    p: {
      ...p,
      document_id: target,
      content_hash: uploaded.contentHash,
      storage_path: uploaded.path,
    },
    request_key: key,
    acting_user: actor,
  });
  if (result.error && ["PGRST202", "42883"].includes(result.error.code))
    throw new HttpError(
      503,
      "Aplica 036_document_intake.sql en Supabase. / Apply 036_document_intake.sql in Supabase.",
    );
  if (result.error?.message.includes("changed"))
    throw new HttpError(
      409,
      "Los documentos cambiaron; cierra y vuelve a abrir esta ventana. / Documents changed; reopen this window.",
    );
  return checkDb(result);
}
