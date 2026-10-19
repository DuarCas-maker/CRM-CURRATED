import { z } from "zod";
import {
  checkOrigin,
  requireUser,
  checkDb,
  HttpError,
  jsonError,
  serviceClient,
} from "@/lib/server/supabase";
import { readBounded, boundedForm } from "@/lib/server/body";
import { documentBytes, documentSource } from "@/lib/server/document-review";
import { hash } from "@/lib/server/crypto";
import { classifyDocument } from "@/lib/server/document-classification";
import { aiApiKey } from "@/lib/server/ai-usage";
import { UnderwritingProviderError } from "@/lib/server/openai-underwriting";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, user } = await requireUser();
    let upload: File | undefined;
    let input: unknown;
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const form = await boundedForm(request, 21 * 1024 * 1024),
        file = form.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "File required");
      upload = file;
      input = JSON.parse(String(form.get("payload")));
    } else
      input = JSON.parse((await readBounded(request, 4096)).toString("utf8"));
    const p = z
      .object({
        source: z.enum(["saved", "legacy", "upload"]),
        opportunity_id: z.uuid().optional(),
        id: z.uuid(),
        expected_hash: z.string().regex(/^[a-f0-9]{64}$/),
        retry: z.boolean().default(false),
      })
      .parse(input);
    if (p.source === "upload" && (!upload || !p.opportunity_id))
      throw new HttpError(400, "File and opportunity required");
    const source =
      p.source === "upload"
        ? { opportunityId: p.opportunity_id! }
        : await documentSource(db, p.source, p.id);
    if (
      !checkDb(await db.rpc("can_edit_case", { case_id: source.opportunityId }))
    )
      throw new HttpError(403, "Case is read-only");
    const service = serviceClient();
    const query = () =>
      service
        .from("document_classifications")
        .select("status,suggestion")
        .eq("opportunity_id", source.opportunityId)
        .eq("source", p.source)
        .eq("source_id", p.id)
        .eq("content_hash", p.expected_hash);
    const cached = await query().maybeSingle();
    if (cached.error && ["PGRST205", "42P01"].includes(cached.error.code))
      throw new HttpError(
        503,
        "Aplica 036_document_intake.sql para activar las sugerencias. / Apply 036_document_intake.sql to enable suggestions.",
      );
    checkDb(cached);
    if (cached.data?.status === "ready")
      return Response.json(
        { suggestion: cached.data.suggestion },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (cached.data && !p.retry)
      throw new HttpError(
        409,
        "La identificación no terminó. Puedes elegir el tipo manualmente o reintentar. / Identification did not complete. Choose the type manually or retry.",
      );
    const apiKey = aiApiKey("document_classification");
    if (!apiKey)
      throw new HttpError(
        503,
        "Configura D_OPENAI_API_KEY en Runtime del servicio web. / Configure D_OPENAI_API_KEY at runtime on the web service.",
      );
    const file =
      p.source === "upload"
        ? { bytes: Buffer.from(await upload!.arrayBuffer()) }
        : await documentBytes(db, p.source, p.id);
    if (hash(file.bytes) !== p.expected_hash)
      throw new HttpError(
        409,
        "El archivo cambió; vuelve a abrirlo. / File changed; reopen it.",
      );
    if (cached.data) {
      let claimQuery = service
        .from("document_classifications")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("opportunity_id", source.opportunityId)
        .eq("source", p.source)
        .eq("source_id", p.id)
        .eq("content_hash", p.expected_hash)
        .eq("status", cached.data.status);
      if (cached.data.status === "processing")
        claimQuery = claimQuery.lt(
          "updated_at",
          new Date(Date.now() - 180000).toISOString(),
        );
      const claimed = checkDb(await claimQuery.select("source_id"));
      if (!claimed?.length)
        throw new HttpError(
          409,
          "Espera a que termine el intento anterior (hasta 3 minutos) o elige el tipo manualmente. / Wait for the previous attempt (up to 3 minutes) or choose the type manually.",
        );
    } else {
      const claim = await service.from("document_classifications").insert({
        opportunity_id: source.opportunityId,
        source: p.source,
        source_id: p.id,
        content_hash: p.expected_hash,
        status: "processing",
      });
      if (claim.error)
        throw new HttpError(
          409,
          "Otro intento está identificando este archivo. / Another attempt is identifying this file.",
        );
    }
    const update = (value: Record<string, unknown>) =>
      service
        .from("document_classifications")
        .update({ ...value, updated_at: new Date().toISOString() })
        .eq("opportunity_id", source.opportunityId)
        .eq("source", p.source)
        .eq("source_id", p.id)
        .eq("content_hash", p.expected_hash);
    try {
      const settings = checkDb(
        await service
          .from("underwriting_settings")
          .select("model")
          .eq("id", 1)
          .single(),
      );
      const suggestion = await classifyDocument(
        file.bytes,
        settings!.model,
        apiKey,
        fetch,
        {
          db: service,
          service: "document_classification",
          opportunityId: source.opportunityId,
          actorId: user.id,
        },
      );
      checkDb(await update({ status: "ready", suggestion }));
      return Response.json(
        { suggestion },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      await update({ status: "failed" });
      if (
        error instanceof UnderwritingProviderError &&
        error.code === "OPENAI_USAGE_UNAVAILABLE"
      )
        throw new HttpError(
          503,
          "Registro de consumo no disponible. Aplica 041_ai_service_usage.sql o revisa la conexión. / Usage recording unavailable. Apply 041_ai_service_usage.sql or check the connection.",
        );
      throw new HttpError(
        502,
        "No se pudo identificar el contenido. Elige el tipo manualmente; el archivo no se guardó ni aprobó. / Content identification failed. Choose the type manually; no file was saved or approved.",
      );
    }
  } catch (error) {
    return jsonError(error);
  }
}
