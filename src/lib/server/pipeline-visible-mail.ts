import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDb, HttpError } from "./supabase";
import type { PipelineReadQueue } from "./pipeline-read-queue";

/** Reuse one complete authorized projection; never expose rows outside eligible cases. */
export async function readVisiblePipelineMail<
  T extends { id: string; opportunity_id: string },
>(
  db: SupabaseClient,
  columns: string,
  caseIds: string[],
  run: PipelineReadQueue,
  scopedRead: () => Promise<T[]>,
): Promise<T[]> {
  if (caseIds.length <= 100 || caseIds.length > 1000) return scopedRead();
  const { rows, total } = await run(async () => {
    const response = await db
      .from("mail_conversations_visible")
      .select(columns, { count: "exact" })
      .order("id")
      .range(0, 999);
    const rows = (checkDb(response, "pipeline_os.mail_metadata") ||
      []) as unknown as T[];
    const total = response.count;
    if (total === null || !Number.isSafeInteger(total) || total < 0)
      throw new HttpError(
        503,
        "No se pudo comprobar el total del catálogo / Catalog count unavailable",
      );
    if ((!rows.length && total > 0) || rows.length > total)
      throw new HttpError(
        503,
        "Lectura incompleta del catálogo / Incomplete catalog read",
      );
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new HttpError(
        503,
        "El catálogo cambió durante la lectura; actualiza / Catalog changed during the read; refresh",
      );
    return { rows, total };
  });
  // A smaller REST cap or a large mailbox retains the existing paginated, ID-scoped reader.
  if (rows.length < total || total > 1000) return scopedRead();
  const eligible = new Set(caseIds);
  return rows.filter((row) => eligible.has(row.opportunity_id));
}
