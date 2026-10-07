import { boundedForm } from "@/lib/server/body";
import {
  demoEnabled,
  requireUser,
  checkOrigin,
  jsonError,
  HttpError,
} from "@/lib/server/supabase";
import { parseImport } from "@/lib/server/parse-import";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (!(
      new URL(request.url).searchParams.get("demo") === "1" && demoEnabled()
    )) {
      const { profile } = await requireUser();
      if (!["superadmin", "seller_admin"].includes(profile.role))
        throw new HttpError(403, "Access denied");
    }
    const form = await boundedForm(request, 51 * 1024 * 1024);
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "File required");
    const parsed = await parseImport(file, String(form.get("sheet") || ""));
    return Response.json({ ...parsed, rows: parsed.rows.slice(0, 10) });
  } catch (e) {
    return jsonError(e);
  }
}
