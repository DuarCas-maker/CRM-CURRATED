import {
  requireUser,
  serviceClient,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
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
        .select("storage_path")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!doc?.storage_path) throw new HttpError(404, "Document not found");
    const signed = checkDb(
      await serviceClient()
        .storage.from("case-documents")
        .createSignedUrl(doc.storage_path, 60, { download: true }),
    );
    return Response.redirect(signed!.signedUrl);
  } catch (e) {
    return jsonError(e);
  }
}
