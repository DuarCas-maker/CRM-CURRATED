import { z } from "zod";
import { boundedForm } from "@/lib/server/body";
import {
  checkDb,
  checkOrigin,
  HttpError,
  jsonError,
  requireUser,
  serviceClient,
} from "@/lib/server/supabase";
import { documentBytes, documentSource } from "@/lib/server/document-review";
import { previewMime } from "@/lib/document-review";
import {
  extractApplication,
  type ExtractionFile,
} from "@/lib/server/application-extraction";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await requireUser();
    const form = await boundedForm(request, 41 * 1024 * 1024);
    const p = z
      .object({
        opportunity_id: z.uuid(),
        document_ids: z.array(z.uuid()).max(2),
        confirmed: z.string().max(8000),
      })
      .parse(JSON.parse(String(form.get("payload"))));
    if (!checkDb(await db.rpc("can_edit_case", { case_id: p.opportunity_id })))
      throw new HttpError(403, "Case is inaccessible or read-only");
    const uploads = form.getAll("files");
    if (
      !uploads.every((f) => f instanceof File) ||
      uploads.length + p.document_ids.length < 1 ||
      uploads.length + p.document_ids.length > 2 ||
      new Set(p.document_ids).size !== p.document_ids.length
    )
      throw new HttpError(
        400,
        "Selecciona uno o dos documentos en total / Select one or two documents in total",
      );
    // Check every selected document's case before reading any bytes via service role.
    for (const id of p.document_ids) {
      const source = await documentSource(db, "document", id);
      if (source.opportunityId !== p.opportunity_id)
        throw new HttpError(403, "Document belongs to another opportunity");
    }
    if (!process.env.OPENAI_API_KEY)
      throw new HttpError(
        503,
        "Configura OPENAI_API_KEY en el servicio web / Configure OPENAI_API_KEY in the web service",
      );
    const files: ExtractionFile[] = [];
    for (const id of p.document_ids) {
      const file = await documentBytes(db, "document", id);
      files.push({ name: file.name, bytes: file.bytes });
    }
    for (const file of uploads as File[]) {
      if (!file.size || file.size > 20 * 1024 * 1024)
        throw new HttpError(
          413,
          "Cada archivo debe tener entre 1 byte y 20 MB / Each file must be between 1 byte and 20 MB",
        );
      files.push({
        name: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
      });
    }
    if (files.some((file) => !previewMime(file.bytes)))
      throw new HttpError(
        400,
        "Solo se aceptan PDF, JPG y PNG / Only PDF, JPG and PNG files are accepted",
      );
    const settings = checkDb(
      await serviceClient()
        .from("underwriting_settings")
        .select("model")
        .eq("id", 1)
        .single(),
    );
    try {
      const result = await extractApplication(
        files,
        p.confirmed,
        settings!.model,
        process.env.OPENAI_API_KEY,
      );
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      throw new HttpError(
        502,
        "No se pudo completar la extracción. No se modificó ni guardó la aplicación. / Extraction could not complete. No application data was changed or saved.",
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json(
        { error: "Datos de extracción inválidos / Invalid extraction input" },
        { status: 400 },
      );
    return jsonError(error);
  }
}
