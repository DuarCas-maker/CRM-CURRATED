import { requireCrmExtensions } from "@/lib/server/crm-readiness";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  requireUser,
  checkOrigin,
  checkDb,
  serviceClient,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { boundedForm } from "@/lib/server/body";
import { previewMime } from "@/lib/document-review";
import { hash } from "@/lib/server/crypto";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    await requireCrmExtensions(db);
    if (!["superadmin", "seller_admin"].includes(profile.role))
      throw new HttpError(403, "Administrator required");
    const form = await boundedForm(request, 11 * 1024 * 1024);
    const requestKey = z.uuid().parse(form.get("request_key"));
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)
      throw new HttpError(413, "PDF/JPG/PNG up to 10 MB required");
    const bytes = Buffer.from(await file.arrayBuffer()),
      mime = previewMime(bytes);
    if (!mime) throw new HttpError(415, "PDF, JPG and PNG required");
    const contentHash = hash(bytes),
      service = serviceClient();
    const prior = checkDb(
      await service
        .from("campaign_assets")
        .select("*")
        .eq("created_by", profile.id)
        .eq("request_key", requestKey)
        .maybeSingle(),
    );
    if (prior) {
      if (prior.content_hash !== contentHash)
        throw new HttpError(409, "Upload request already used");
      return Response.json(prior);
    }
    const id = randomUUID(),
      path = `${profile.id}/${requestKey}/${contentHash}.${mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg"}`;
    const uploaded = await service.storage
      .from("campaign-assets")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (
      uploaded.error &&
      !uploaded.error.message.toLowerCase().includes("already exists")
    )
      throw new HttpError(500, "Upload failed");
    const asset = {
      id,
      created_by: profile.id,
      request_key: requestKey,
      name: file.name.slice(0, 200).replace(/[\r\n]/g, " "),
      mime_type: mime,
      size: file.size,
      content_hash: contentHash,
      storage_path: path,
    };
    const recorded = await service.from("campaign_assets").upsert(asset, {
      onConflict: "created_by,request_key",
      ignoreDuplicates: true,
    });
    checkDb(recorded);
    const saved = checkDb(
      await service
        .from("campaign_assets")
        .select("*")
        .eq("created_by", profile.id)
        .eq("request_key", requestKey)
        .single(),
    );
    if (saved?.content_hash !== contentHash)
      throw new HttpError(409, "Upload request already used");
    return Response.json(saved, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Invalid upload request" },
        { status: 400 },
      );
    return jsonError(e);
  }
}
