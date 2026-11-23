import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDb, HttpError } from "./supabase";
import type { PipelineReadQueue } from "./pipeline-read-queue";

type MailIdentity = { id: string; opportunity_id: string };

/** A short REST page is not proof of completion: follow its last ID until empty. */
export async function readMailMetadataPages<T extends MailIdentity>(
  read: (after?: string) => Promise<T[]>,
  caseIds: string[],
  maximumRows = 100000,
): Promise<T[]> {
  const eligible = new Set(caseIds);
  if (!eligible.size) return [];
  const rows: T[] = [];
  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    const page = await read(cursor);
    if (!page.length) return rows;
    if (page.length > 1000 || total + page.length > maximumRows)
      throw new HttpError(
        503,
        "El catálogo de correo supera el límite / Mail catalog exceeds the limit",
      );
    for (const row of page) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !row.id ||
        typeof row.opportunity_id !== "string" ||
        (cursor !== undefined && row.id <= cursor)
      )
        throw new HttpError(
          503,
          "El catálogo cambió durante la lectura / Catalog changed during the read",
        );
      cursor = row.id;
      if (eligible.has(row.opportunity_id)) rows.push(row);
    }
    total += page.length;
  }
}

/** One complete authorized metadata stream per reader; never request remote COUNT. */
export function readPipelineMailMetadata<T extends MailIdentity>(
  db: SupabaseClient,
  columns: string,
  caseIds: string[],
  run: PipelineReadQueue,
  operation: string,
): Promise<T[]> {
  if (!caseIds.length) return Promise.resolve([]);
  return run(() =>
    readMailMetadataPages<T>(async (after) => {
      let query = db
        .from("mail_conversations_visible")
        .select(columns)
        .order("id");
      if (after) query = query.gt("id", after);
      const result = await query.range(0, 999);
      return (checkDb(result, operation) || []) as unknown as T[];
    }, caseIds),
  );
}
