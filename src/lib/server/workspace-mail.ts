import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "../domain";
import { checkDb } from "./supabase";

// Keep UUID filters below proxy request-line limits, even for large mailboxes.
const ID_BATCH_SIZE = 50;
const MAIL_LIMIT = 1000;

export async function loadWorkspaceMail(
  db: SupabaseClient,
  conversationIds: string[],
) {
  const ids = [...new Set(conversationIds)];
  let messages: Workspace["messages"] = [];
  for (let offset = 0; offset < ids.length; offset += ID_BATCH_SIZE) {
    const rows =
      checkDb(
        await db
          .from("messages")
          .select("*")
          .in("conversation_id", ids.slice(offset, offset + ID_BATCH_SIZE))
          .order("sent_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(MAIL_LIMIT),
        "messages",
      ) || [];
    // Each batch can contain older mail. Apply the limit globally after merging.
    messages = [...messages, ...rows]
      .sort(
        (a, b) =>
          Date.parse(b.sent_at) - Date.parse(a.sent_at) ||
          b.id.localeCompare(a.id),
      )
      .slice(0, MAIL_LIMIT);
  }

  const attachments: Workspace["attachments"] = [];
  for (
    let offset = 0;
    offset < messages.length && attachments.length < MAIL_LIMIT;
    offset += ID_BATCH_SIZE
  ) {
    const remaining = MAIL_LIMIT - attachments.length;
    const rows =
      checkDb(
        await db
          .from("message_attachments")
          .select("*")
          .in(
            "message_id",
            messages.slice(offset, offset + ID_BATCH_SIZE).map((m) => m.id),
          )
          .order("id")
          .limit(remaining),
        "message_attachments",
      ) || [];
    attachments.push(...rows);
  }
  return { messages, attachments };
}
