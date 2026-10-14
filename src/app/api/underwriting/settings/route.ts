import { requireCrmExtensions } from "@/lib/server/crm-readiness";
import { z } from "zod";
import {
  checkOrigin,
  requireUser,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { underwritingRulesSchema } from "@/lib/underwriting";
const schema = z.object({
  expected_version: z.number().int().min(1),
  request_key: z.uuid(),
  prompt: z.string().trim().min(100).max(30000),
  model: z.enum(["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra"]),
  enabled: z.boolean(),
  max_output_tokens: z.number().int().min(2000).max(16000),
  daily_run_limit: z.number().int().min(1).max(500),
  rules: underwritingRulesSchema,
});
export async function GET() {
  try {
    const { db, profile } = await requireUser();
    await requireCrmExtensions(db);
    const settings = checkDb(
      await db.from("underwriting_settings").select("*").eq("id", 1).single(),
    );
    const versions =
      checkDb(
        await db
          .from("underwriting_setting_versions")
          .select("version,model,updated_by,updated_at")
          .order("version", { ascending: false })
          .limit(30),
      ) || [];
    return Response.json(
      {
        settings,
        versions,
        configured: !!process.env.OPENAI_API_KEY,
        editable: profile.role === "superadmin",
      },
      { headers: { "Cache-Control": "no-store" } },
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
    const { request_key, ...p } = schema.parse(
      JSON.parse((await readBounded(request, 60000)).toString("utf8")),
    );
    const r = await db.rpc("save_underwriting_settings", { p, request_key });
    if (r.error)
      throw new HttpError(
        409,
        r.error.message.includes("Settings changed")
          ? "La configuración cambió. Recarga antes de guardar. / Reload settings before saving."
          : "No se pudo guardar la configuración. / Settings could not be saved.",
      );
    return Response.json({ version: r.data });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Invalid underwriting settings" },
        { status: 400 },
      );
    return jsonError(e);
  }
}
