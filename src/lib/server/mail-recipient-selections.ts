import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecipientDirectory } from "../mail-recipient-selections";
import { checkDb } from "./supabase";

export async function readRecipientDirectory(
  db: SupabaseClient,
): Promise<RecipientDirectory> {
  async function read(table: "lenders" | "lender_contacts", sort: string) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const page =
        checkDb(
          await db
            .from(table)
            .select("*")
            .order(sort)
            .range(offset, offset + 999),
        ) || [];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }
  const [lenders, contacts] = await Promise.all([
    read("lenders", "id"),
    read("lender_contacts", "email"),
  ]);
  return { lenders, contacts };
}
