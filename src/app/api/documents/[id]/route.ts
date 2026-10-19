import {
  requireUser,
  serviceClient,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import {
  applicationPdfFilename,
  documentFilename,
} from "@/lib/server/document-filename";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await requireUser();
    const { id } = await params;
    const doc = checkDb(
      await db
        .from("documents")
        .select("storage_path,name,source")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!doc?.storage_path) throw new HttpError(404, "Document not found");
    const storage = serviceClient().storage.from("case-documents");
    let filename = documentFilename(doc.name, doc.storage_path);
    if (doc.source === "company_application") {
      const blob = checkDb(await storage.download(doc.storage_path))!;
      filename = await applicationPdfFilename(
        new Uint8Array(await blob.arrayBuffer()),
        filename,
      );
    }
    const signed = checkDb(
      await serviceClient()
        .storage.from("case-documents")
        .createSignedUrl(doc.storage_path, 60, { download: filename }),
    );
    return Response.redirect(signed!.signedUrl);
  } catch (e) {
    return jsonError(e);
  }
}
