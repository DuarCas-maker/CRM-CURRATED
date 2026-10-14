import { requireCrmExtensions } from "@/lib/server/crm-readiness";
import { z } from "zod";
import {
  requireUser,
  checkOrigin,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
export async function GET() {
  try {
    const { db } = await requireUser();
    await requireCrmExtensions(db);
    return Response.json(
      checkDb(
        await db.from("operational_settings").select("*").eq("id", 1).single(),
      ),
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    await requireCrmExtensions(db);
    if (profile.role !== "superadmin")
      throw new HttpError(403, "Superadmin required");
    const input = z
      .object({
        reply_hours: z.number().int().min(1).max(720),
        followup_hours: z.number().int().min(1).max(2160),
        offer_warning_hours: z.number().int().min(1).max(720),
        expected_version: z.number().int().min(1),
        request_key: z.uuid(),
      })
      .parse(JSON.parse((await readBounded(request, 2000)).toString("utf8")));
    const { request_key, ...p } = input;
    const result = await db.rpc("save_operational_settings", {
      p,
      request_key,
    });
    if (result.error)
      throw new HttpError(
        409,
        "Los plazos cambiaron. Recarga antes de guardar.",
      );
    return Response.json({ version: result.data });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: "Plazos inválidos." }, { status: 400 });
    return jsonError(e);
  }
}
