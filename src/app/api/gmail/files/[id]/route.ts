import { requireUser, HttpError, jsonError } from "@/lib/server/supabase";
import { documentBytes } from "@/lib/server/document-review";
import { z } from "zod";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success)
      throw new HttpError(400, "Invalid file");
    const { db } = await requireUser();
    // Download, preview and classification share the same RLS-bound byte reader.
    const { bytes, name } = await documentBytes(db, "saved", id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
