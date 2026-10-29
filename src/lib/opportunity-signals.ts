import type {
  Conversation,
  Document,
  Message,
  Opportunity,
  Submission,
  Workspace,
} from "./domain";
import { lenderEmailResolver } from "./lender-mail";

export interface OpportunitySignals {
  lastClientSentAt: string | null;
  lastLenderSentAt: string | null;
  documentCount: number;
  lenderCount: number;
}
export type SignalConversation = Pick<
  Conversation,
  "id" | "opportunity_id" | "submission_id" | "recipient_email"
>;
export type SignalMessage = Pick<
  Message,
  "conversation_id" | "direction" | "status" | "sent_at" | "participants"
>;
export type SignalDocument = Pick<Document, "opportunity_id" | "storage_path">;
export type SignalSubmission = Pick<
  Submission,
  "id" | "opportunity_id" | "lender_id" | "status"
>;

// Inputs may be narrow server projections; never depend on the truncated inbox.
export function summarizeOpportunities(
  opportunities: Pick<Opportunity, "id" | "email">[],
  data: {
    conversations: SignalConversation[];
    messages: SignalMessage[];
    documents: SignalDocument[];
    submissions: SignalSubmission[];
    lenders: Workspace["lenders"];
    lender_contacts?: Workspace["lender_contacts"];
    accounts: Workspace["accounts"];
    profiles: Workspace["profiles"];
  },
): Record<string, OpportunitySignals> {
  const result: Record<string, OpportunitySignals> = {};
  const firms = new Map<string, Set<string>>();
  const clients = new Map(
    opportunities.map((o) => [o.id, o.email.toLowerCase()]),
  );
  for (const o of opportunities) {
    result[o.id] = {
      lastClientSentAt: null,
      lastLenderSentAt: null,
      documentCount: 0,
      lenderCount: 0,
    };
    firms.set(o.id, new Set());
  }
  const team = new Set(
    [...data.accounts, ...data.profiles].map((p) => p.email.toLowerCase()),
  );
  const resolve = lenderEmailResolver({
    lenders: data.lenders,
    lender_contacts: data.lender_contacts || [],
    team_emails: [...team],
    client_emails: [...clients.values()],
  });
  const submissions = new Map(data.submissions.map((s) => [s.id, s]));
  for (const s of data.submissions)
    if (
      [
        "submitted",
        "reviewing",
        "requirements",
        "offer",
        "rejected",
        "withdrawn",
      ].includes(s.status)
    )
      firms.get(s.opportunity_id)?.add(s.lender_id);
  for (const d of data.documents)
    if (d.storage_path && result[d.opportunity_id])
      result[d.opportunity_id].documentCount++;
  const conversations = new Map(data.conversations.map((c) => [c.id, c]));
  for (const m of data.messages) {
    if (
      m.direction !== "outbound" ||
      m.status !== "sent" ||
      !Number.isFinite(Date.parse(m.sent_at))
    )
      continue;
    const c = conversations.get(m.conversation_id);
    const signal = c && result[c.opportunity_id];
    if (!c || !signal) continue;
    const explicit = (m.participants || [])
      .filter((p) => ["to", "cc", "bcc"].includes(p.role))
      .map((p) => p.email.toLowerCase());
    const recipients = explicit.length
      ? explicit
      : c.recipient_email
        ? [c.recipient_email.toLowerCase()]
        : [];
    const lenderIds = new Set(
      recipients.map(resolve).filter((id): id is string => !!id),
    );
    // Legacy sends have no participant list. Only then use the linked evaluation.
    const submission = c.submission_id && submissions.get(c.submission_id);
    if (!explicit.length && submission) lenderIds.add(submission.lender_id);
    for (const lender of lenderIds) firms.get(c.opportunity_id)?.add(lender);
    const routedClient = c.recipient_email?.trim().toLowerCase();
    const client =
      recipients.includes(clients.get(c.opportunity_id) || "") ||
      (!!routedClient &&
        !submission &&
        !resolve(routedClient) &&
        !team.has(routedClient) &&
        !routedClient.endsWith("@curatedfinancial.com") &&
        recipients.includes(routedClient)) ||
      (!explicit.length &&
        !submission &&
        !lenderIds.size &&
        (!recipients.length || recipients.some((email) => !team.has(email))));
    if (
      client &&
      (!signal.lastClientSentAt ||
        Date.parse(m.sent_at) > Date.parse(signal.lastClientSentAt))
    )
      signal.lastClientSentAt = m.sent_at;
    if (
      lenderIds.size &&
      (!signal.lastLenderSentAt ||
        Date.parse(m.sent_at) > Date.parse(signal.lastLenderSentAt))
    )
      signal.lastLenderSentAt = m.sent_at;
  }
  for (const [id, lenders] of firms) result[id].lenderCount = lenders.size;
  return result;
}

export function elapsedSend(
  value: string,
  locale: "es" | "en",
  now = Date.now(),
) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
  if (minutes < 1) return locale === "es" ? "Ahora" : "Just now";
  const [amount, unit] =
    minutes < 60
      ? ([minutes, "minute"] as const)
      : minutes < 1440
        ? ([Math.floor(minutes / 60), "hour"] as const)
        : ([Math.floor(minutes / 1440), "day"] as const);
  return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(
    -amount,
    unit,
  );
}
