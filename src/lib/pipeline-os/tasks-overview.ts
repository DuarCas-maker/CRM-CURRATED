import { z } from "zod";
import type { CampaignContact } from "../campaign-center";
import type { Conversation, Lead, Message, Profile } from "../domain";
import { isCloserRole, isSellerRole } from "../domain";
import { automatedSender } from "../mail-interest";
import { pipelineStages, type PipelineRow } from "./module";

export const taskLeadStatuses = [
  "all",
  "managed",
  "pending",
  "replied",
] as const;
const querySchema = z.strictObject({
  q: z.string().trim().max(200).default(""),
  owner: z.string().min(1).max(100).default("all"),
  account: z.string().min(1).max(100).default("all"),
  status: z.enum(taskLeadStatuses).default("all"),
  page: z.coerce.number().int().min(0).max(100000).default(0),
});
export type TaskOverviewQuery = z.infer<typeof querySchema>;
export const parseTaskOverviewQuery = (params: URLSearchParams) =>
  querySchema.parse(Object.fromEntries(params));
export type TaskStage = (typeof pipelineStages)[number];
export type TaskCounts = {
  leads: number;
  managed: number;
  sent: number | null;
  replied: number;
  stages: Record<TaskStage, number>;
};
export type TaskAccount = {
  id: string;
  email: string;
  sent: number | null;
  replied: number;
};
export type TaskRep = TaskCounts & {
  id: string;
  name: string;
  accounts: TaskAccount[];
};
export type TaskLead = {
  id: string;
  caseId: string | null;
  company: string;
  contact: string;
  email: string;
  ownerId: string;
  ownerName: string;
  accountIds: string[];
  managed: boolean;
  campaignSent: boolean;
  replied: boolean;
  lastSentAt: string | null;
  lastReplyAt: string | null;
  groups: TaskStage[];
};
export type TasksOverview = {
  asOf: string;
  byRep: TaskRep[];
  totals: TaskCounts;
  financial: boolean;
  campaignsAvailable: boolean;
  rows: TaskLead[];
  total: number;
  page: number;
  hasMore: boolean;
};
export type TaskOverviewSource = {
  profile: Profile;
  profiles: Profile[];
  accounts: { id: string; email: string; owner_id: string | null }[];
  cases: PipelineRow[];
  leads: Pick<
    Lead,
    | "id"
    | "contact_id"
    | "company"
    | "contact"
    | "email"
    | "seller_id"
    | "opportunity_id"
  >[];
  campaigns: { id: string; seller_id: string; account_id: string }[];
  facts: (CampaignContact & { campaignId: string })[];
  conversations: Pick<
    Conversation,
    | "id"
    | "opportunity_id"
    | "account_id"
    | "area"
    | "submission_id"
    | "recipient_email"
  >[];
  messages: Pick<
    Message,
    | "id"
    | "conversation_id"
    | "direction"
    | "sender"
    | "sent_at"
    | "status"
    | "nature"
    | "reply_intent"
    | "participants"
  >[];
};

const emailKey = (email: string) =>
  (email.match(/<([^<>]+)>/)?.[1] || email).trim().toLowerCase();
const stages = () =>
  Object.fromEntries(pipelineStages.map((s) => [s, 0])) as Record<
    TaskStage,
    number
  >;
const unique = <T extends { id: string }>(rows: T[]) => [
  ...new Map(rows.map((r) => [r.id, r])).values(),
];
const latest = (a: string | null, b: string | null) =>
  b && Number.isFinite(Date.parse(b)) && (!a || Date.parse(b) > Date.parse(a))
    ? b
    : a;

export function buildTasksOverview(
  source: TaskOverviewSource,
  input: Partial<TaskOverviewQuery> = {},
  now = Date.now(),
  pageSize = 50,
): TasksOverview {
  const query = querySchema.parse(input);
  const campaignsAvailable = isSellerRole(source.profile.role);
  const financial = isCloserRole(source.profile.role);
  const admin = ["superadmin", "seller_admin", "closer_admin"].includes(
    source.profile.role,
  );
  const allowedOwner = (id: string) => admin || id === source.profile.id;
  const name = (id: string) =>
    source.profiles.find((p) => p.id === id)?.name || "Sin responsable";
  const visibleCaseIds = new Set(source.cases.map((c) => c.id));
  const leads = new Map<string, TaskLead>();
  const byCase = new Map<string, TaskLead>();
  const byContact = new Map<string, TaskLead>();
  const byEmail = new Map<string, TaskLead>();
  for (const l of unique(source.leads)) {
    if (!campaignsAvailable || !allowedOwner(l.seller_id)) continue;
    const key = l.contact_id || l.id;
    if (byContact.has(key)) continue;
    const row: TaskLead = {
      id: key,
      caseId:
        l.opportunity_id && visibleCaseIds.has(l.opportunity_id)
          ? l.opportunity_id
          : null,
      company: l.company,
      contact: l.contact,
      email: l.email,
      ownerId: l.seller_id,
      ownerName: name(l.seller_id),
      accountIds: [],
      managed: false,
      campaignSent: false,
      replied: false,
      lastSentAt: null,
      lastReplyAt: null,
      groups: [],
    };
    leads.set(row.id, row);
    byContact.set(key, row);
    if (l.opportunity_id) byCase.set(l.opportunity_id, row);
    byEmail.set(emailKey(l.email), row);
  }
  const cases = unique(source.cases);
  for (const c of cases) {
    let row = byCase.get(c.id) || byEmail.get(emailKey(c.email));
    if (!row && allowedOwner(c.ownerId)) {
      row = {
        id: "case:" + c.id,
        caseId: c.id,
        company: c.company,
        contact: c.contact,
        email: c.email,
        ownerId: c.ownerId,
        ownerName: c.ownerName,
        accountIds: [],
        managed: false,
        campaignSent: false,
        replied: false,
        lastSentAt: null,
        lastReplyAt: null,
        groups: [],
      };
      leads.set(row.id, row);
      byEmail.set(emailKey(c.email), row);
    }
    if (row) {
      byCase.set(c.id, row);
      if (!row.caseId) row.caseId = c.id;
      row.groups = [
        ...new Set([
          ...row.groups,
          ...pipelineStages.filter((s) => c.groups.includes(s)),
        ]),
      ];
    }
  }
  const reps = new Map<string, TaskRep>();
  function rep(id: string) {
    let value = reps.get(id);
    if (!value) {
      value = {
        id,
        name: name(id),
        accounts: [],
        leads: 0,
        managed: 0,
        sent: campaignsAvailable ? 0 : null,
        replied: 0,
        stages: stages(),
      };
      reps.set(id, value);
    }
    return value;
  }
  for (const p of source.profiles)
    if (
      allowedOwner(p.id) &&
      p.active !== false &&
      (admin || p.id === source.profile.id)
    )
      rep(p.id);
  const accountReplies = new Map<string, Set<string>>();
  function account(owner: string, id: string) {
    const ownerRep = rep(owner);
    let value = ownerRep.accounts.find((a) => a.id === id);
    if (!value) {
      value = {
        id,
        email: source.accounts.find((a) => a.id === id)?.email || "",
        sent: campaignsAvailable ? 0 : null,
        replied: 0,
      };
      ownerRep.accounts.push(value);
    }
    return value;
  }
  for (const a of source.accounts) {
    const owner = a.owner_id || "unassigned";
    if (admin || owner === source.profile.id) account(owner, a.id);
  }
  const campaigns = new Map(
    unique(source.campaigns)
      .filter((c) => campaignsAvailable && allowedOwner(c.seller_id))
      .map((c) => [c.id, c]),
  );
  for (const c of campaigns.values()) account(c.seller_id, c.account_id);
  const factsSeen = new Set<string>();
  const sentContacts = new Set<string>();
  const repSentContacts = new Map<string, Set<string>>();
  const accountSentContacts = new Map<string, Set<string>>();
  for (const f of source.facts) {
    const campaign = campaigns.get(f.campaignId);
    const key = `${f.campaignId}:${f.contact_id}`;
    if (!campaign || factsSeen.has(key)) continue;
    factsSeen.add(key);
    // Campaign Control counts unique contacts across its visible campaigns.
    const sent = f.send_status === "sent";
    if (!sent) continue;
    const owner = rep(campaign.seller_id);
    sentContacts.add(f.contact_id);
    const ownContacts =
      repSentContacts.get(campaign.seller_id) || new Set<string>();
    ownContacts.add(f.contact_id);
    repSentContacts.set(campaign.seller_id, ownContacts);
    owner.sent = ownContacts.size;
    const senderKey = `${campaign.seller_id}:${campaign.account_id}`;
    const senderContacts =
      accountSentContacts.get(senderKey) || new Set<string>();
    senderContacts.add(f.contact_id);
    accountSentContacts.set(senderKey, senderContacts);
    account(campaign.seller_id, campaign.account_id).sent = senderContacts.size;
    let row =
      byContact.get(f.contact_id) ||
      (f.opportunity_id ? byCase.get(f.opportunity_id) : undefined) ||
      byEmail.get(emailKey(f.email));
    if (!row) {
      row = {
        id: f.contact_id,
        caseId:
          f.opportunity_id && visibleCaseIds.has(f.opportunity_id)
            ? f.opportunity_id
            : null,
        company: f.company,
        contact: f.name,
        email: f.email,
        ownerId: campaign.seller_id,
        ownerName: name(campaign.seller_id),
        accountIds: [],
        managed: false,
        campaignSent: false,
        replied: false,
        lastSentAt: null,
        lastReplyAt: null,
        groups: [],
      };
      leads.set(row.id, row);
      byContact.set(f.contact_id, row);
      if (f.opportunity_id) byCase.set(f.opportunity_id, row);
    }
    byContact.set(f.contact_id, row);
    row.managed = true;
    row.campaignSent = true;
    row.lastSentAt = latest(row.lastSentAt, f.sent_at);
    row.lastReplyAt = latest(row.lastReplyAt, f.reply_at);
    row.replied ||= !!f.reply_at;
    if (!row.accountIds.includes(campaign.account_id))
      row.accountIds.push(campaign.account_id);
    if (f.reply_at) {
      const accountKey = `${campaign.seller_id}:${campaign.account_id}`;
      const set = accountReplies.get(accountKey) || new Set<string>();
      set.add(row.id);
      accountReplies.set(accountKey, set);
    }
  }
  const conversations = new Map(source.conversations.map((c) => [c.id, c]));
  for (const m of unique(source.messages)) {
    const c = conversations.get(m.conversation_id);
    if (
      !c ||
      !visibleCaseIds.has(c.opportunity_id) ||
      c.submission_id ||
      !Number.isFinite(Date.parse(m.sent_at)) ||
      Date.parse(m.sent_at) > now
    )
      continue;
    const row = byCase.get(c.opportunity_id);
    if (
      !row ||
      (c.recipient_email && emailKey(c.recipient_email) !== emailKey(row.email))
    )
      continue;
    const recipients = (m.participants || []).filter((p) => p.role === "to");
    const sent =
      m.direction === "outbound" &&
      m.status === "sent" &&
      (!recipients.length ||
        recipients.some((p) => emailKey(p.email) === emailKey(row.email)));
    const replied =
      m.direction === "inbound" &&
      m.status === "received" &&
      m.nature === "personal" &&
      m.reply_intent !== "ignored" &&
      !automatedSender(emailKey(m.sender)) &&
      emailKey(m.sender) === emailKey(row.email);
    if (!sent && !replied) continue;
    row.managed ||= sent;
    row.replied ||= replied;
    if (sent) row.lastSentAt = latest(row.lastSentAt, m.sent_at);
    if (replied) row.lastReplyAt = latest(row.lastReplyAt, m.sent_at);
    if (!row.accountIds.includes(c.account_id))
      row.accountIds.push(c.account_id);
    if (replied) {
      const key = `${row.ownerId}:${c.account_id}`;
      const set = accountReplies.get(key) || new Set<string>();
      set.add(row.id);
      accountReplies.set(key, set);
      account(row.ownerId, c.account_id);
    }
  }
  const all = [...leads.values()];
  for (const row of all) {
    const owner = rep(row.ownerId);
    owner.leads++;
    if (row.managed) owner.managed++;
    if (row.replied) owner.replied++;
  }
  for (const c of cases)
    if (allowedOwner(c.ownerId))
      for (const s of pipelineStages)
        if (c.groups.includes(s)) rep(c.ownerId).stages[s]++;
  for (const r of reps.values()) {
    for (const a of r.accounts)
      a.replied = accountReplies.get(`${r.id}:${a.id}`)?.size || 0;
    r.accounts.sort((a, b) => a.email.localeCompare(b.email));
  }
  const byRep = [...reps.values()].sort(
    (a, b) =>
      b.leads - a.leads ||
      (b.sent || 0) - (a.sent || 0) ||
      a.name.localeCompare(b.name, "es") ||
      a.id.localeCompare(b.id),
  );
  const totals: TaskCounts = {
    leads: all.length,
    managed: all.filter((r) => r.managed).length,
    sent: campaignsAvailable ? sentContacts.size : null,
    replied: all.filter((r) => r.replied).length,
    stages: stages(),
  };
  for (const r of byRep)
    for (const s of pipelineStages) totals.stages[s] += r.stages[s];
  const filtered = all
    .filter(
      (r) =>
        (query.owner === "all" || r.ownerId === query.owner) &&
        (query.account === "all" || r.accountIds.includes(query.account)) &&
        (query.status === "all" ||
          (query.status === "managed"
            ? r.managed
            : query.status === "pending"
              ? !r.managed
              : r.replied)) &&
        `${r.company} ${r.contact} ${r.email} ${r.ownerName}`
          .toLowerCase()
          .includes(query.q.toLowerCase()),
    )
    .sort(
      (a, b) =>
        a.company.localeCompare(b.company, "es") || a.id.localeCompare(b.id),
    );
  return {
    asOf: new Date(now).toISOString(),
    byRep,
    totals,
    financial,
    campaignsAvailable,
    rows: filtered.slice(query.page * pageSize, (query.page + 1) * pageSize),
    total: filtered.length,
    page: query.page,
    hasMore: (query.page + 1) * pageSize < filtered.length,
  };
}
