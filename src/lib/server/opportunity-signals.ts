import type { SupabaseClient } from "@supabase/supabase-js";
import type { Opportunity, Workspace } from "../domain";
import {
  summarizeOpportunities,
  type SignalConversation,
  type SignalDocument,
  type SignalMessage,
  type SignalSubmission,
} from "../opportunity-signals";
import { checkDb } from "./supabase";

// Read metadata with the signed-in client's RLS. Page every batch so busy cases
// cannot hide another opportunity's last send or inflate an empty state.
export async function loadOpportunitySignals(
  db: SupabaseClient,
  opportunities: Pick<Opportunity, "id" | "email">[],
  directory: Pick<
    Workspace,
    "lenders" | "lender_contacts" | "accounts" | "profiles"
  >,
) {
  async function read<T>(
    table: string,
    columns: string,
    key: string,
    ids: string[],
    sentOnly = false,
  ): Promise<T[]> {
    const rows: T[] = [];
    const unique = [...new Set(ids)];
    for (let batch = 0; batch < unique.length; batch += 50) {
      for (let offset = 0; ; offset += 1000) {
        let query = db
          .from(table)
          .select(columns)
          .in(key, unique.slice(batch, batch + 50))
          .order("id");
        if (sentOnly)
          query = query.eq("direction", "outbound").eq("status", "sent");
        const page =
          checkDb(
            await query.range(offset, offset + 999),
            `opportunity_signals.${table}`,
          ) || [];
        rows.push(...(page as unknown as T[]));
        if (page.length < 1000) break;
      }
    }
    return rows;
  }
  const ids = opportunities.map((o) => o.id);
  const [conversations, documents, submissions] = await Promise.all([
    read<SignalConversation>(
      "conversations",
      "id,opportunity_id,submission_id,recipient_email",
      "opportunity_id",
      ids,
    ),
    read<SignalDocument>(
      "documents",
      "id,opportunity_id,storage_path",
      "opportunity_id",
      ids,
    ),
    read<SignalSubmission>(
      "submissions",
      "id,opportunity_id,lender_id,status",
      "opportunity_id",
      ids,
    ),
  ]);
  const messages = await read<SignalMessage>(
    "messages",
    "id,conversation_id,direction,status,sent_at,participants",
    "conversation_id",
    conversations.map((c) => c.id),
    true,
  );
  return summarizeOpportunities(opportunities, {
    ...directory,
    conversations,
    documents,
    submissions,
    messages,
  });
}
