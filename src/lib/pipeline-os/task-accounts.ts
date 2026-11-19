import { automatedSender } from "../mail-interest";
import { pipelineStages } from "./module";
import type {
  TaskLead,
  TaskOverviewSource,
  TaskAccountSummary,
} from "./tasks-overview";

const emailKey = (email: string) =>
  (email.match(/<([^<>]+)>/)?.[1] || email).trim().toLowerCase();
type Activity = Pick<
  TaskLead,
  "managed" | "campaignSent" | "replied" | "lastSentAt" | "lastReplyAt"
>;
const blankActivity = (): Activity => ({
  managed: false,
  campaignSent: false,
  replied: false,
  lastSentAt: null,
  lastReplyAt: null,
});
const latest = (a: string | null, b: string | null) =>
  b && Number.isFinite(Date.parse(b)) && (!a || Date.parse(b) > Date.parse(a))
    ? b
    : a;

/** Account activity is independent of lead ownership and of activity on other accounts. */
export function summarizeTaskAccounts(input: {
  source: TaskOverviewSource;
  campaigns: Map<string, TaskOverviewSource["campaigns"][number]>;
  all: TaskLead[];
  byContact: Map<string, TaskLead>;
  byCase: Map<string, TaskLead>;
  byEmail: Map<string, TaskLead>;
  campaignsAvailable: boolean;
  admin: boolean;
  now: number;
}) {
  const {
    source,
    campaigns,
    all,
    byContact,
    byCase,
    byEmail,
    campaignsAvailable,
    admin,
    now,
  } = input;
  const accountsById = new Map(source.accounts.map((a) => [a.id, a]));
  const summaries = new Map<string, TaskAccountSummary>();
  const aliases = new Map<string, string>();
  const activity = new Map<string, Map<string, Activity>>();
  const sentContacts = new Map<string, Set<string>>();
  function register(id: string) {
    const record = accountsById.get(id);
    if (!record) return;
    const key = emailKey(record.email);
    if (!key) return;
    aliases.set(id, key);
    if (!summaries.has(key)) {
      summaries.set(key, {
        id: key,
        email: key,
        leads: 0,
        managed: 0,
        sent: campaignsAvailable ? 0 : null,
        replied: 0,
        stages: Object.fromEntries(
          pipelineStages.map((s) => [s, 0]),
        ) as TaskAccountSummary["stages"],
      });
    }
    return key;
  }
  for (const a of source.accounts)
    if (admin || a.owner_id === source.profile.id) register(a.id);
  for (const c of campaigns.values()) register(c.account_id);
  function link(accountId: string, row: TaskLead) {
    const key = register(accountId);
    if (!key) return;
    let own = activity.get(row.id);
    if (!own) {
      own = new Map();
      activity.set(row.id, own);
    }
    let value = own.get(key);
    if (!value) {
      value = blankActivity();
      own.set(key, value);
    }
    return { key, value };
  }
  function recipient(
    contactId: string,
    caseId?: string | null,
    email?: string,
  ) {
    return (
      byContact.get(contactId) ||
      (caseId ? byCase.get(caseId) : undefined) ||
      (email ? byEmail.get(emailKey(email)) : undefined)
    );
  }
  // Minimal campaign membership includes recipients which have not yet been sent.
  for (const member of source.audience || []) {
    const campaign = campaigns.get(member.campaignId);
    const row = recipient(member.contact_id, member.opportunity_id);
    if (campaign && row) link(campaign.account_id, row);
  }
  for (const fact of source.facts) {
    const campaign = campaigns.get(fact.campaignId);
    const row = recipient(fact.contact_id, fact.opportunity_id, fact.email);
    if (!campaign || !row) continue;
    const own = link(campaign.account_id, row);
    if (!own || fact.send_status !== "sent") continue;
    own.value.managed = true;
    own.value.campaignSent = true;
    own.value.lastSentAt = latest(own.value.lastSentAt, fact.sent_at);
    const sent = sentContacts.get(own.key) || new Set<string>();
    sent.add(fact.contact_id);
    sentContacts.set(own.key, sent);
    if (
      fact.reply_at &&
      Number.isFinite(Date.parse(fact.reply_at)) &&
      Date.parse(fact.reply_at) <= now
    ) {
      own.value.replied = true;
      own.value.lastReplyAt = latest(own.value.lastReplyAt, fact.reply_at);
    }
  }
  const eligibleCases = new Set(source.cases.map((c) => c.id));
  const conversations = new Map(source.conversations.map((c) => [c.id, c]));
  function clientRow(c: TaskOverviewSource["conversations"][number]) {
    if (!eligibleCases.has(c.opportunity_id) || c.submission_id) return;
    const row = byCase.get(c.opportunity_id);
    if (
      !row ||
      (c.recipient_email && emailKey(c.recipient_email) !== emailKey(row.email))
    )
      return;
    return row;
  }
  for (const conversation of conversations.values()) {
    const row = clientRow(conversation);
    if (row) link(conversation.account_id, row);
  }
  const seenMessages = new Set<string>();
  for (const message of source.messages) {
    if (seenMessages.has(message.id)) continue;
    seenMessages.add(message.id);
    const c = conversations.get(message.conversation_id);
    const row = c && clientRow(c);
    if (
      !c ||
      !row ||
      !Number.isFinite(Date.parse(message.sent_at)) ||
      Date.parse(message.sent_at) > now
    )
      continue;
    const recipients = (message.participants || []).filter(
      (p) => p.role === "to",
    );
    const sent =
      message.direction === "outbound" &&
      message.status === "sent" &&
      (!recipients.length ||
        recipients.some((p) => emailKey(p.email) === emailKey(row.email)));
    const replied =
      message.direction === "inbound" &&
      message.status === "received" &&
      message.nature === "personal" &&
      message.reply_intent !== "ignored" &&
      !automatedSender(emailKey(message.sender)) &&
      emailKey(message.sender) === emailKey(row.email);
    if (!sent && !replied) continue;
    const own = link(c.account_id, row);
    if (!own) continue;
    own.value.managed ||= sent;
    own.value.replied ||= replied;
    if (sent)
      own.value.lastSentAt = latest(own.value.lastSentAt, message.sent_at);
    if (replied)
      own.value.lastReplyAt = latest(own.value.lastReplyAt, message.sent_at);
  }
  for (const row of all) {
    for (const [key, value] of activity.get(row.id) || []) {
      const summary = summaries.get(key)!;
      summary.leads++;
      if (value.managed) summary.managed++;
      if (value.replied) summary.replied++;
      for (const stage of new Set(row.groups)) summary.stages[stage]++;
    }
  }
  for (const summary of summaries.values())
    summary.sent = campaignsAvailable
      ? sentContacts.get(summary.id)?.size || 0
      : null;
  const byAccount = [...summaries.values()].sort(
    (a, b) =>
      (b.sent || 0) - (a.sent || 0) ||
      b.leads - a.leads ||
      a.email.localeCompare(b.email),
  );
  function accountKey(id: string) {
    if (id === "all") return "all";
    return (
      aliases.get(id) || (summaries.has(emailKey(id)) ? emailKey(id) : null)
    );
  }
  function project(row: TaskLead, account: string) {
    const key = accountKey(account);
    const own = key && activity.get(row.id)?.get(key);
    if (account !== "all" && !own) return null;
    return {
      ...row,
      ...(own || {}),
      accountIds: [...(activity.get(row.id)?.keys() || [])].sort(),
    };
  }
  return { byAccount, accountKey, project };
}
