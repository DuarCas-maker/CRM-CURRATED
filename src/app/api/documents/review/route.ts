import { z } from "zod";
import {
  requireUser,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { documentSource, documentBytes } from "@/lib/server/document-review";
import { documentSourceSchema, previewMime } from "@/lib/document-review";
import { hash } from "@/lib/server/crypto";

export async function GET(request: Request) {
  try {
    const { db } = await requireUser();
    const query = new URL(request.url).searchParams;
    const source = documentSourceSchema.parse(query.get("source"));
    const id = z.uuid().parse(query.get("id"));
    if (query.get("preview") === "true") {
      const file = await documentBytes(db, source, id);
      const mime = previewMime(file.bytes);
      if (!mime)
        throw new HttpError(
          415,
          "La revisión admite PDF, JPG y PNG. / Review supports PDF, JPG and PNG.",
        );
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          "Content-Type": mime,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Document-Hash": hash(file.bytes),
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        },
      });
    }
    const context = await documentSource(db, source, id);
    const opportunity = checkDb(
      await db
        .from("opportunity_workspace")
        .select("id,company,contact,created_at")
        .eq("id", context.opportunityId)
        .single(),
    );
    const documents =
      checkDb(
        await db
          .from("documents")
          .select("*")
          .eq("opportunity_id", context.opportunityId)
          .order("created_at"),
      ) || [];
    const versions = context.documentId
      ? checkDb(
          await db
            .from("document_versions")
            .select("*")
            .eq("document_id", context.documentId)
            .order("created_at", { ascending: false }),
        ) || []
      : [];
    const reviews = context.documentId
      ? checkDb(
          await db
            .from("document_reviews")
            .select("*")
            .eq("document_id", context.documentId)
            .order("reviewed_at", { ascending: false }),
        ) || []
      : [];
    return Response.json(
      {
        name: context.name,
        opportunity,
        documents,
        document_id: context.documentId,
        editable: !!checkDb(
          await db.rpc("can_edit_case", { case_id: context.opportunityId }),
        ),
        versions,
        reviews,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Invalid document selection" },
        { status: 400 },
      );
    return jsonError(e);
  }
}
