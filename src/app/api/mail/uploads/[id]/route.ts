import { z } from "zod";
import {
  requireUser,
  serviceClient,
  checkDb,
  jsonError,
} from "@/lib/server/supabase";
import { decrypt } from "@/lib/server/crypto";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await requireUser();
    const id = z.uuid().parse((await params).id);
    const file = checkDb(
      await db.from("mail_uploads").select("*").eq("id", id).single(),
    )!;
    const blob = checkDb(
      await serviceClient()
        .storage.from("gmail-documents")
        .download(file.storage_path),
    )!;
    return new Response(
      new Uint8Array(Buffer.from(decrypt(await blob.text()), "base64")),
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (e) {
    return jsonError(e);
  }
}
