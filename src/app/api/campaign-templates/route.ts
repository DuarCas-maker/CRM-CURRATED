import { requireCrmExtensions } from "@/lib/server/crm-readiness";
import { z } from "zod";
import { campaignTemplateSchema } from "@/lib/campaign-templates";
import {
  requireUser,
  checkOrigin,
  HttpError,
  jsonError,
  checkDb,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
export async function GET(request: Request) {
  try {
    const { db } = await requireUser();
    const id = z.uuid().parse(new URL(request.url).searchParams.get("id"));
    return Response.json(
      checkDb(
        await db
          .from("email_template_versions")
          .select("*")
          .eq("template_id", id)
          .order("version", { ascending: false })
          .limit(100),
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
