import { z } from "zod";
import { lenderTemplateSchema } from "@/lib/lender-templates";
import { readBounded } from "@/lib/server/body";
import {
  checkDb,
  checkOrigin,
  HttpError,
  jsonError,
  requireUser,
} from "@/lib/server/supabase";

export async function GET(request: Request) {
  try {
    const { db } = await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    if (id)
      return Response.json(
        {
          versions:
            checkDb(
              await db
                .from("lender_email_template_versions")
                .select("*")
                .eq("template_id", z.uuid().parse(id))
                .order("version", { ascending: false })
                .limit(100),
            ) || [],
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    async function read(table: string, columns: string) {
      const result = [];
      for (let n = 0; ; n += 1000) {
        const page =
          checkDb(
            await db
              .from(table)
              .select(columns)
              .is("archived_at", null)
              .order("id")
              .range(n, n + 999),
          ) || [];
        result.push(...page);
        if (page.length < 1000) return result;
      }
    }
    const [templates, campaigns] = await Promise.all([
      read("lender_email_templates", "*"),
      read(
        "email_templates",
        "id,name,subject,body,body_format,version,updated_at",
      ),
    ]);
    return Response.json(
      { templates, campaigns },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const response = jsonError(e);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    if (!["superadmin", "seller_admin"].includes(profile.role))
      throw new HttpError(403, "Administrator required");
    const body = JSON.parse(
      (await readBounded(request, 60000)).toString("utf8"),
    );
    const p = lenderTemplateSchema.parse(body);
    const result = await db.rpc("save_lender_email_template", {
      p,
      request_key: z.uuid().parse(body.request_key),
    });
    if (result.error)
      throw new HttpError(
        409,
        "La plantilla cambió o no pudo guardarse. Recarga antes de intentarlo de nuevo. / Reload the template before saving again.",
      );
    return Response.json(
      { template: result.data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: e.issues[0]?.message || "Invalid template" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    const response = jsonError(
      e instanceof SyntaxError
        ? new HttpError(400, "JSON inválido. / Invalid JSON.")
        : e,
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
