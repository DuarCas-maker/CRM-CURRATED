import { boundedForm } from "@/lib/server/body";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  checkOrigin,
  requireUser,
  serviceClient,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { parseImport } from "@/lib/server/parse-import";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { profile } = await requireUser();
    if (!["superadmin", "seller_admin"].includes(profile.role))
      throw new HttpError(403, "Administrator required");
    const form = await boundedForm(request, 51 * 1024 * 1024);
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "File required");
    const requestKey = z.uuid().parse(form.get("idempotency_key"));
    const mapping = z
      .object({
        email: z.string().min(1),
        contact: z.string(),
        company: z.string(),
        phone: z.string(),
        industry: z.string(),
      })
      .parse(JSON.parse(String(form.get("mapping"))));
    const service = serviceClient();
    const prior = checkDb(
      await service
        .from("import_batches")
        .select("id")
        .eq("request_key", requestKey)
        .maybeSingle(),
    );
    if (prior) return Response.json(prior);
    const parsed = await parseImport(file, String(form.get("sheet") || ""));
    if (!parsed.headers.includes(mapping.email))
      throw new HttpError(400, "Email column required");
    const id = randomUUID();
    const path = `${profile.id}/${requestKey}.${file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx"}`;
    const upload = await service.storage.from("imports").upload(path, file, {
      contentType: file.name.endsWith(".csv")
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
    if (
      upload.error &&
      !String(upload.error.message).toLowerCase().includes("exist")
    )
      throw new HttpError(500, "Import upload failed");
    checkDb(
      await service.rpc("register_import", {
        batch_id: id,
        file_name: file.name,
        storage_path: path,
        mapping,
        sheet: parsed.sheet,
        total: parsed.total,
        actor: profile.id,
        request_key: requestKey,
      }),
    );
    return Response.json({ id, status: "queued" }, { status: 202 });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Invalid import mapping" },
        { status: 400 },
      );
    return jsonError(e);
  }
}
