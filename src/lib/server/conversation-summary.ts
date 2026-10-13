import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDb, serviceClient } from "./supabase";
import { teamLabels } from "./gmail-team";
import {
  summarizeThreads,
  type MailChannels,
  type ThreadHeader,
} from "../conversation-threads";

// Every query remains bounded to the user's RLS-authorized case/conversations.
export async function conversationSummary(
  db: SupabaseClient,
  caseId: string,
  channels: MailChannels,
  search = "",
) {
  const headers: ThreadHeader[] = [];
  if (!channels.conversations.length)
    return { summaries: [], headers, teamEmails: channels.team_emails };
  const coIds = channels.conversations.map((c) => c.id);
  for (let i = 0; i < coIds.length; i += 100) {
    for (let page = 0; ; page++) {
      const rows =
        checkDb(
          await db
            .from("messages")
            .select(
              "id,conversation_id,sender,direction,sent_at,internet_message_id,references_header,participants",
            )
            .in("conversation_id", coIds.slice(i, i + 100))
            .order("id")
            .range(page * 1000, page * 1000 + 999),
        ) || [];
      headers.push(...rows);
      if (rows.length < 1000) break;
    }
  }
  const newest = new Map<string, ThreadHeader>();
  for (const m of headers)
    if (
      !newest.has(m.conversation_id) ||
      Date.parse(m.sent_at) >
        Date.parse(newest.get(m.conversation_id)!.sent_at) ||
      (Date.parse(m.sent_at) ===
        Date.parse(newest.get(m.conversation_id)!.sent_at) &&
        m.id.localeCompare(newest.get(m.conversation_id)!.id) > 0)
    )
      newest.set(m.conversation_id, m);
  const previewIds = [...newest.values()].map((m) => m.id);
  for (let i = 0; i < previewIds.length; i += 100) {
    const rows =
      checkDb(
        await db
          .from("messages")
          .select("id,body")
          .in("id", previewIds.slice(i, i + 100)),
      ) || [];
    for (const row of rows) {
      const h = headers.find((m) => m.id === row.id);
      if (h) h.body = row.body;
    }
  }
  const replies: { conversation_id: string; reply_message_id: string }[] = [];
  for (let page = 0; ; page++) {
    const rows =
      checkDb(
        await serviceClient()
          .from("outbox")
          .select("conversation_id,reply_message_id")
          .eq("opportunity_id", caseId)
          .not("conversation_id", "is", null)
          .not("reply_message_id", "is", null)
          .order("id")
          .range(page * 1000, page * 1000 + 999),
      ) || [];
    replies.push(...rows);
    if (rows.length < 1000) break;
  }
  const teams = await teamLabels(
    headers.flatMap((m) => [
      m.sender,
      ...(m.participants || [])
        .filter((p) => p.role !== "bcc")
        .map((p) => p.email),
    ]),
  );
  const teamEmails = [...new Set([...channels.team_emails, ...teams.keys()])];
  const summaries = summarizeThreads(
    { ...channels, team_emails: teamEmails },
    headers,
    replies,
  );
  if (search.trim()) {
    const matches = new Set<string>();
    const q = search
      .replace(/[%,()"\\]/g, " ")
      .slice(0, 150)
      .trim();
    if (q)
      for (let i = 0; i < coIds.length; i += 100)
        for (let page = 0; ; page++) {
          const rows =
            checkDb(
              await db
                .from("messages")
                .select("conversation_id,id")
                .in("conversation_id", coIds.slice(i, i + 100))
                .or(`body.ilike.%${q}%,sender.ilike.%${q}%`)
                .order("id")
                .range(page * 1000, page * 1000 + 999),
            ) || [];
          rows.forEach((r) => matches.add(r.conversation_id));
          if (rows.length < 1000) break;
        }
    for (const s of summaries)
      s.search_matched = s.conversation_ids.some((id) => matches.has(id));
  }
  return { summaries, headers, teamEmails };
}
