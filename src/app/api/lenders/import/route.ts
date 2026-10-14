import { requireCrmExtensions } from "@/lib/server/crm-readiness";
import { z } from "zod";
import {
  requireUser,
  checkOrigin,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { boundedForm, readBounded } from "@/lib/server/body";
import { parseImport } from "@/lib/server/parse-import";
import {
  lenderImportRowSchema,
  planLenderImport,
} from "@/lib/lender-management";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    await requireCrmExtensions(db);
    if (!["superadmin", "closer_admin"].includes(profile.role))
      throw new HttpError(403, "Lender administrator required");
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await boundedForm(request, 6 * 1024 * 1024),
        file = form.get("file");
      if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
        throw new HttpError(400, "CSV / XLSX hasta 5 MB.");
      const parsed = await parseImport(file, String(form.get("sheet") || ""));
      if (parsed.total > 1000)
        throw new HttpError(400, "Máximo 1000 filas por importación.");
      return Response.json(parsed);
    }
    const input = JSON.parse(
      (await readBounded(request, 1048576)).toString("utf8"),
    );
    const rows = z
      .array(lenderImportRowSchema)
      .min(1)
      .max(1000)
      .parse(input.rows);
    if (input.mode === "preview") {
      const [lenders, contacts] = await Promise.all([
        allRows(db, "lenders", "id,name"),
        allRows(db, "lender_contacts", "email,lender_id"),
      ]);
      return Response.json(
        planLenderImport(
          rows,
          lenders as { id: string; name: string }[],
          contacts as { email: string; lender_id: string }[],
        ),
      );
    }
    const result = await db.rpc("import_lender_directory", {
      rows,
      request_key: z.uuid().parse(input.request_key),
    });
    if (result.error)
      throw new HttpError(
        409,
        "Conflicto de empresa o correo. Revisa la vista previa; no se importó ninguna fila.",
      );
    return Response.json(result.data);
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: e.issues[0]?.message || "Invalid lender rows" },
        { status: 400 },
      );
    return jsonError(e);
  }
}
async function allRows(
  db: Awaited<ReturnType<typeof requireUser>>["db"],
  table: string,
  fields: string,
) {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = db
      .from(table)
      .select(fields)
      .order(table === "lenders" ? "id" : "email");
    if (table === "lenders") query = query.is("archived_at", null);
    const chunk = checkDb(await query.range(offset, offset + 999)) || [];
    rows.push(...chunk);
    if (chunk.length < 1000) return rows;
  }
}
