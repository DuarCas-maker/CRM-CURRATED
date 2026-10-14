import { requireCrmExtensions } from "@/lib/server/crm-readiness";
import { z } from "zod";
import { lenderGuidelinesSchema } from "@/lib/lender-management";
import {
  requireUser,
  checkOrigin,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
export async function GET(request: Request) {
  try {
    const { db } = await requireUser();
    await requireCrmExtensions(db);
    const lender = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("lender"));
    return Response.json(
      checkDb(
        await db
          .from("lender_guideline_versions")
          .select("*")
          .eq("lender_id", lender)
          .order("version", { ascending: false }),
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
    if (!["superadmin", "closer_admin"].includes(profile.role))
      throw new HttpError(403, "Lender administrator required");
    const p = z
      .object({
        lender: z.uuid(),
        g: lenderGuidelinesSchema,
        expected_version: z.number().int().min(0),
        request_key: z.uuid(),
      })
      .parse(JSON.parse((await readBounded(request, 30000)).toString("utf8")));
    const result = await db.rpc("save_lender_guidelines", p);
    if (result.error)
      throw new HttpError(
        409,
        "Los guidelines cambiaron. Recarga antes de guardar.",
      );
    return Response.json({ version: result.data });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: e.issues[0]?.message }, { status: 400 });
    return jsonError(e);
  }
}
