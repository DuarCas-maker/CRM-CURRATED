import type { Conversation, Message, Opportunity } from "./domain";
import type { MailPeer } from "./mail-display";
import { readableMail } from "./mail-display";
import { lenderEmailResolver, lenderMessageIds } from "./lender-mail";

export type ThreadCategory = "client" | "team" | "lender" | "review";
export type ThreadHeader = Pick<
  Message,
  "id" | "conversation_id" | "sender" | "sent_at" | "direction"
> & {
  internet_message_id?: string | null;
  references_header?: string | null;
  participants?: MailPeer[];
  body?: string;
  nature?: string;
  reply_intent?: import("./mail-interest").ReplyIntent | null;
};
export type ThreadSummary = {
  id: string;
  conversation_ids: string[];
  opportunity_id: string;
  subject: string;
  sender: string;
  snippet: string;
  sent_at: string;
  category: ThreadCategory;
  lender_ids: string[];
  participants: MailPeer[];
  unread: boolean;
  search_matched?: boolean;
  process_id?: string | null;
  message_ids?: string[];
  message_conversations?: Record<string, string>;
};
export type CaseMailContext = {
  opportunity: Opportunity;
  client_emails: string[];
  last_client_message_at: string | null;
  documents: { required: number; approved: number; ready: boolean };
  followup: { title: string; at: string | null } | null;
};
export type MailChannels = {
  conversations: Conversation[];
  processes: { id: string; label: string; sequence_number: number }[];
  routes: { conversation_id: string; lender_id: string }[];
  lenders: { id: string; name: string; email: string }[];
  lender_contacts: { email: string; lender_id: string; name?: string }[];
  team_emails: string[];
  client_emails: string[];
  submissions?: { id: string; lender_id: string; process_id?: string | null }[];
  thread_summaries?: ThreadSummary[];
  context?: CaseMailContext;
  sender_account_ids?: string[];
  stats?: {
    sent: number;
    received: number;
    threads: number;
    lenders_contacted: number;
  };
};

// Group only authoritative reply relationships within the same case and process.
// Neither a sender, a lender nor an identical subject is evidence of one thread.
export function summarizeOriginalThreads(
  context: MailChannels,
  headers: ThreadHeader[],
  replies: { conversation_id: string; reply_message_id: string }[] = [],
): ThreadSummary[] {
  const conversations = new Map(context.conversations.map((c) => [c.id, c]));
  const parents = new Map(context.conversations.map((c) => [c.id, c.id]));
  const groupProcess = new Map(
    context.conversations.map((c) => [c.id, c.process_id || null]),
  );
  const root = (id: string): string => {
    const parent = parents.get(id) || id;
    if (parent === id) return id;
    const result = root(parent);
    parents.set(id, result);
    return result;
  };
  const join = (a: string, b: string) => {
    const ca = conversations.get(a),
      cb = conversations.get(b);
    if (
      !ca ||
      !cb ||
      ca.opportunity_id !== cb.opportunity_id ||
      (ca.process_id && cb.process_id && ca.process_id !== cb.process_id)
    )
      return;
    const ra = root(a),
      rb = root(b);
    const pa = groupProcess.get(ra),
      pb = groupProcess.get(rb);
    if (pa && pb && pa !== pb) return;
    if (ra !== rb) {
      parents.set(rb, ra);
      groupProcess.set(ra, pa || pb || null);
    }
  };
  const ids = new Map<string, Set<string>>(),
    messageIds = new Map<string, string>();
  const scopedHeaders = headers.filter((m) =>
    conversations.has(m.conversation_id),
  );
  for (const m of scopedHeaders) {
    messageIds.set(m.id, m.conversation_id);
    for (const token of [
      m.internet_message_id || "",
      ...(m.references_header?.match(/<[^<>]+>/g) || []),
    ].filter(Boolean)) {
      const key = `${conversations.get(m.conversation_id)!.opportunity_id}:${token}`;
      const previous = ids.get(key) || new Set<string>();
      for (const id of previous) join(id, m.conversation_id);
      previous.add(m.conversation_id);
      ids.set(key, previous);
    }
  }
  for (const reply of replies) {
    const source = messageIds.get(reply.reply_message_id);
    if (source) join(reply.conversation_id, source);
  }
  const groups = new Map<string, Conversation[]>();
  for (const c of context.conversations) {
    const key = root(c.id);
    groups.set(key, [...(groups.get(key) || []), c]);
  }
  const groupedHeaders = new Map<string, ThreadHeader[]>();
  for (const m of scopedHeaders) {
    const key = root(m.conversation_id);
    const rows = groupedHeaders.get(key) || [];
    rows.push(m);
    groupedHeaders.set(key, rows);
  }
  const clients = new Set(context.client_emails.map((e) => e.toLowerCase()));
  const team = new Set(context.team_emails.map((e) => e.toLowerCase()));
  const result: ThreadSummary[] = [];
  for (const group of groups.values()) {
    const groupIds = group.map((c) => c.id).sort();
    const messages = (groupedHeaders.get(root(group[0].id)) || []).sort(
      (a, b) =>
        Date.parse(b.sent_at) - Date.parse(a.sent_at) ||
        b.id.localeCompare(a.id),
    );
    const latest = messages[0];
    const participants = [
      ...new Map(
        messages
          .flatMap((m) => [
            { email: m.sender, role: "from" },
            ...(m.participants || []).filter((p) => p.role !== "bcc"),
          ])
          .map((p) => [`${p.role}:${p.email.toLowerCase()}`, p]),
      ).values(),
    ];
    const lenderIds = [
      ...new Set([
        ...context.routes
          .filter((r) => groupIds.includes(r.conversation_id))
          .map((r) => r.lender_id),
        ...(context.submissions || [])
          .filter((s) => group.some((c) => c.submission_id === s.id))
          .map((s) => s.lender_id),
      ]),
    ];
    const addresses = participants.map((p) => p.email.toLowerCase());
    const category: ThreadCategory = lenderIds.length
      ? "lender"
      : addresses.some((e) => clients.has(e))
        ? "client"
        : addresses.length && addresses.every((e) => team.has(e))
          ? "team"
          : "review";
    const latestConversation =
      group.find((c) => c.id === latest?.conversation_id) || group[0];
    result.push({
      id: groupIds[0],
      conversation_ids: groupIds,
      opportunity_id: latestConversation.opportunity_id,
      subject: latestConversation.subject,
      sender: latest?.sender || latestConversation.recipient_email || "",
      snippet: readableMail(latest?.body || "").text.slice(0, 220),
      sent_at: latest?.sent_at || latestConversation.updated_at,
      category,
      lender_ids: lenderIds,
      participants,
      unread: group.some((c) => c.needs_attention),
    });
  }
  return result.sort(
    (a, b) =>
      Date.parse(b.sent_at) - Date.parse(a.sent_at) || a.id.localeCompare(b.id),
  );
}

// Lender views are client + financing process + company, regardless of Gmail thread/mailbox.
// Physical conversations and RFC reply relationships remain intact for actual email delivery.
export function summarizeThreads(
  context: MailChannels,
  headers: ThreadHeader[],
  replies: { conversation_id: string; reply_message_id: string }[] = [],
): ThreadSummary[] {
  const originals = summarizeOriginalThreads(context, headers, replies);
  const resolve = lenderEmailResolver(context);
  const coMap = new Map(context.conversations.map((c) => [c.id, c]));
  const originalMap = new Map(
    originals.flatMap((s) => s.conversation_ids.map((id) => [id, s] as const)),
  );
  const buckets = new Map<
    string,
    { template: ThreadSummary; messages: ThreadHeader[] }
  >();
  for (const m of headers) {
    const c = coMap.get(m.conversation_id),
      original = originalMap.get(m.conversation_id);
    if (!c || !original) continue;
    let firms = lenderMessageIds(m, resolve, context.team_emails);
    // Older records without recipient headers can still use an unambiguous evaluation route.
    if (
      !firms.length &&
      m.direction === "outbound" &&
      !(m.participants || []).some((p) => p.role !== "from")
    ) {
      const sub = context.submissions?.find((s) => s.id === c.submission_id);
      if (sub) firms = [sub.lender_id];
    }
    const sender = m.sender.toLowerCase();
    const peers = [
      sender,
      ...(m.participants || [])
        .filter((p) => p.role !== "bcc")
        .map((p) => p.email.toLowerCase()),
    ];
    const category: ThreadCategory =
      context.client_emails.includes(sender) ||
      ((m.direction === "outbound" || context.team_emails.includes(sender)) &&
        peers.some((e) => context.client_emails.includes(e)))
        ? "client"
        : peers.every((e) => context.team_emails.includes(e))
          ? "team"
          : "review";
    const process =
      c.process_id ||
      original.conversation_ids
        .map((id) => coMap.get(id)?.process_id)
        .find(Boolean) ||
      null;
    const keys = firms.length
      ? firms.map((id) => ({
          key: `lender:${c.opportunity_id}:${process || "unassigned"}:${id}`,
          firm: id,
        }))
      : [{ key: `${category}:${original.id}`, firm: "" }];
    for (const { key, firm } of keys) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          template: {
            ...original,
            id: key,
            process_id: process,
            category: firm ? "lender" : category,
            lender_ids: firm ? [firm] : [],
          },
          messages: [],
        };
        buckets.set(key, bucket);
      }
      bucket.messages.push(m);
    }
  }
  const result = [...buckets.values()].map(
    ({ template, messages }): ThreadSummary => {
      messages.sort(
        (a, b) =>
          Date.parse(b.sent_at) - Date.parse(a.sent_at) ||
          b.id.localeCompare(a.id),
      );
      const latest = messages[0];
      const ids = [...new Set(messages.map((m) => m.conversation_id))].sort();
      const participants = [
        ...new Map(
          messages
            .flatMap((m) => [
              { email: m.sender, role: "from" },
              ...(m.participants || []).filter((p) => p.role !== "bcc"),
            ])
            .map((p) => [`${p.role}:${p.email.toLowerCase()}`, p]),
        ).values(),
      ];
      const visibleParticipants =
        template.category === "lender"
          ? participants.filter(
              (p) =>
                resolve(p.email) === template.lender_ids[0] ||
                context.team_emails.includes(p.email.toLowerCase()),
            )
          : participants;
      return {
        ...template,
        conversation_ids: ids,
        message_ids: messages.map((m) => m.id),
        message_conversations: Object.fromEntries(
          messages.map((m) => [m.id, m.conversation_id]),
        ),
        subject: coMap.get(latest.conversation_id)!.subject,
        sender: latest.sender,
        snippet: readableMail(latest.body || "").text.slice(0, 220),
        sent_at: latest.sent_at,
        participants: visibleParticipants,
        unread: ids.some((id) => coMap.get(id)?.needs_attention),
      };
    },
  );
  // Preserve empty original records without creating inactive chats for every lender.
  for (const s of originals)
    if (!headers.some((m) => s.conversation_ids.includes(m.conversation_id)))
      result.push(s);
  // Case association determines history visibility; reply intent only drives commercial workflows.
  return result.sort(
    (a, b) =>
      Date.parse(b.sent_at) - Date.parse(a.sent_at) || a.id.localeCompare(b.id),
  );
}

export function filterThreads(
  threads: ThreadSummary[],
  category: "all" | ThreadCategory,
  unread = false,
  query = "",
) {
  const q = query.trim().toLowerCase();
  return threads.filter(
    (thread) =>
      (category === "all" || thread.category === category) &&
      (!unread || thread.unread) &&
      (!q ||
        thread.search_matched === true ||
        `${thread.sender} ${thread.subject} ${thread.snippet} ${thread.participants.map((p) => p.email).join(" ")}`
          .toLowerCase()
          .includes(q)),
  );
}

export function elapsedMailTime(
  value: string | null | undefined,
  locale: "es" | "en",
  now = Date.now(),
) {
  if (!value)
    return locale === "es" ? "Sin mensaje registrado" : "No recorded message";
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
  if (minutes < 1) return locale === "es" ? "Hace un momento" : "Just now";
  const amount =
    minutes < 60
      ? minutes
      : minutes < 1440
        ? Math.floor(minutes / 60)
        : Math.floor(minutes / 1440);
  const unit = minutes < 60 ? "minute" : minutes < 1440 ? "hour" : "day";
  return new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "short",
  }).format(-amount, unit);
}
