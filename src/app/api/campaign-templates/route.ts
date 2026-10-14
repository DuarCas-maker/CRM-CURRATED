import { requireCrmExtensions } from "@/lib/server/crm-readiness";
import { z } from "zod";
import { campaignTemplateSchema } from "@/lib/campaign-templates";
import {
  requireUser,
  checkOrigin,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    await requireCrmExtensions(db);
    if (!["superadmin", "seller_admin"].includes(profile.role))
      throw new HttpError(403, "Administrator required");
    const body = JSON.parse(
      (await readBounded(request, 450000)).toString("utf8"),
    );
    const requestKey = z.uuid().parse(body.request_key);
    const p = campaignTemplateSchema.parse(body);
    const r = await db.rpc("save_campaign_template", {
      p,
      request_key: requestKey,
    });
    if (r.error)
      throw new HttpError(
        409,
        r.error.message.includes("Template changed")
          ? "La plantilla cambió. Recarga antes de guardar. / Reload the template."
          : "No se pudo guardar la plantilla. / Template could not be saved.",
      );
    return Response.json({ id: r.data });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: e.issues[0]?.message || "Invalid template" },
        { status: 400 },
      );
    return jsonError(e);
  }
}
