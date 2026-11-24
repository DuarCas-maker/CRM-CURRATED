import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskOverviewSource } from "../pipeline-os/tasks-overview";
import { checkDb, HttpError } from "./supabase";

type TaskLead = TaskOverviewSource["leads"][number];

/** Complete metadata stream: COUNT on lead_workspace repeats expensive lateral/RLS reads. */
export async function readTaskLeadPages<T extends { id: string }>(
  read: (after?: string) => Promise<T[]>,
  maximumRows = 100000,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await read(cursor);
    if (!page.length) return rows;
    if (page.length > 1000 || rows.length + page.length > maximumRows)
      throw new HttpError(
        503,
        "El catálogo de leads supera el límite / Lead catalog exceeds the limit",
      );
    for (const row of page) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !row.id ||
        (cursor !== undefined && row.id <= cursor)
      )
        throw new HttpError(
          503,
          "El catálogo cambió durante la lectura / Catalog changed during the read",
        );
      cursor = row.id;
      rows.push(row);
    }
  }
}

export function readTaskLeads(db: SupabaseClient): Promise<TaskLead[]> {
  return readTaskLeadPages(async (after) => {
    let query = db
      .from("lead_workspace")
      .select("id,contact_id,company,contact,email,seller_id,opportunity_id")
      .order("id");
    if (after) query = query.gt("id", after);
    const result = await query.range(0, 999);
    return (checkDb(result, "pipeline_tasks.lead_workspace") ||
      []) as unknown as TaskLead[];
  });
}
