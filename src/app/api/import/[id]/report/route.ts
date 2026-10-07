import {
  requireUser,
  checkDb,
  jsonError,
  HttpError,
} from "@/lib/server/supabase";
import { z } from "zod";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db, profile } = await requireUser();
    if (!["superadmin", "seller_admin"].includes(profile.role))
      throw new HttpError(403, "Import administrator required");
    const id = z.uuid().parse((await params).id);
    checkDb(await db.from("import_batches").select("id").eq("id", id).single());
    const encoder = new TextEncoder();
    let offset = 0;
    let header = false;
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          if (!header) {
            controller.enqueue(
              encoder.encode("row,result,contact_id,error\r\n"),
            );
            header = true;
          }
          const rows =
            checkDb(
              await db
                .from("import_rows")
                .select("row_number,result,contact_id,error")
                .eq("batch_id", id)
                .order("row_number")
                .range(offset, offset + 999),
            ) || [];
          // Only system-generated status codes and identifiers; no imported financial fields.
          const csv = rows
            .map((r) =>
              [r.row_number, r.result, r.contact_id || "", r.error || ""]
                .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
                .join(","),
            )
            .join("\r\n");
          if (csv) controller.enqueue(encoder.encode(csv + "\r\n"));
          offset += rows.length;
          if (rows.length < 1000) controller.close();
        } catch {
          controller.error(new Error("REPORT_FAILED"));
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-${id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
