import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDb, serviceClient } from "./supabase";
import { teamLabels } from "./gmail-team";
import { readableMail } from "../mail-display";
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
              "id,conversation_id,sender,direction,sent_at,internet_message_id,references_header,participants,nature,reply_intent",
            )
            .in("conversation_id", coIds.slice(i, i + 100))
            .order("id")
            .range(page * 1000, page * 1000 + 999),
        ) || [];
      headers.push(...rows);
      if (rows.length < 1000) break;
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
  const previewIds = [
    ...new Set(
      summaries
        .map((s) => s.message_ids?.[0])
        .filter((id): id is string => !!id),
    ),
  ];
  for (let i = 0; i < previewIds.length; i += 100) {
    const rows =
      checkDb(
        await db
          .from("messages")
          .select("id,body")
          .in("id", previewIds.slice(i, i + 100)),
      ) || [];
    for (const s of summaries) {
      const body = rows.find((r) => r.id === s.message_ids?.[0])?.body;
      if (body !== undefined) s.snippet = readableMail(body).text.slice(0, 220);
    }
  }
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
          rows.forEach((r) => matches.add(r.id));
          if (rows.length < 1000) break;
        }
    for (const s of summaries)
      s.search_matched = (s.message_ids || []).some((id) => matches.has(id));
  }
  return { summaries, headers, teamEmails };
}
