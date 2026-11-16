import { z } from "zod";
import type {
  Area,
  Lead,
  Message,
  Offer,
  Opportunity,
  Profile,
} from "../domain";
import {
  canSeeArea,
  canSeeOpportunity,
  isCloserRole,
  isSellerRole,
} from "../domain";
import { automatedSender, MAIL_ENGAGEMENT_START } from "../mail-interest";
import {
  buildPipelineBoard,
  comparePipelineOffers,
  type PipelineProcess,
  type PipelineSource,
} from "./module";

export const masterTabs = [
  "tasks",
  "offers",
  "pipeline",
  "stats",
  "comms",
  "leads",
] as const;
export type MasterTab = (typeof masterTabs)[number];
export const masterStages = [
  "submitted",
  "requirements",
  "approved",
  "contracts_out",
  "contracts_signed",
  "funded",
  "declined",
  "withdrawn",
  "application",
  "paused",
  "unclassified",
] as const;
export type MasterStage = (typeof masterStages)[number];
const querySchema = z.strictObject({
  tab: z.enum(masterTabs).default("tasks"),
  q: z.string().trim().max(200).default(""),
  owner: z.string().min(1).max(100).default("all"),
  stage: z.enum(["all", ...masterStages]).default("all"),
  priority: z.enum(["all", "1", "2", "3"]).default("all"),
  days: z.coerce
    .number()
    .refine((n) => [7, 30, 90].includes(n))
    .default(30),
  page: z.coerce.number().int().min(0).max(100000).default(0),
});
export type MasterQuery = z.infer<typeof querySchema>;
export const parseMasterQuery = (params: URLSearchParams) =>
  querySchema.parse(Object.fromEntries(params));
export type MasterEvent = {
  id: string;
  opportunity_id: string;
  process_id: string | null;
  submission_id: string | null;
  archive_message_id?: string | null;
  kind: string;
  area: Area;
  evidence_type: string;
  occurred_at: string;
};
export type MasterArchive = {
  id: string;
  account_id: string;
  gmail_thread_id: string;
  subject: string;
  sent_at: string;
  direction: string;
  nature: string;
  reply_intent?: string | null;
  participants: { email: string; role: string }[];
};
export type MasterSource = Omit<PipelineSource, "offers"> & {
  offers: (Offer & { created_at?: string })[];
  processes: (PipelineProcess & {
    started_at?: string;
    actual_funded_amount?: number | null;
    funded_lender_id?: string | null;
  })[];
  events: MasterEvent[];
  offerEvidence: { offer_id: string; message_id: string }[];
  leads?: Lead[];
  archive: MasterArchive[];
  leadCoverage: boolean;
  accountOwners?: Record<string, string>;
};
export type MasterOffer = {
  id: string;
  submissionId: string;
  lender: string;
  amount: number;
  term: string;
  cost: string;
  fees: string;
  frequency: string;
  selected: boolean;
  date: string | null;
  answered: boolean | null;
};
export type MasterRow = {
  id: string;
  caseId: string | null;
  conversationId?: string;
  ownerId: string;
  ownerName: string;
  company: string;
  contact: string;
  email: string;
  stage: MasterStage;
  sourceStage?: string;
  priority?: 1 | 2 | 3;
  title?: string;
  at?: string | null;
  waitingDays?: number | null;
  offers?: MasterOffer[];
  best?: MasterOffer | null;
  lenders?: number;
  declines?: number;
  requirement?: string;
  fundedBy?: string;
  messageId?: string;
  archiveMessageId?: string;
  excerpt?: string;
  subject?: string;
  direction?: string;
  intent?: string;
  answered?: boolean | null;
  converted?: boolean;
};
export type MasterRep = {
  id: string;
  name: string;
  tasks: number;
  p1: number;
  offers: number | null;
  unansweredBest: number | null;
  live: number;
  funded: number;
  emails: number;
  leadsOpen: number | null;
  applications: number;
  offerFiles: number | null;
  contractsOut: number | null;
  signed: number | null;
  fundings: number | null;
};
export type MasterMilestone = {
  id: string;
  caseId: string;
  ownerId: string;
  ownerName: string;
  company: string;
  kind: string;
  at: string;
};
export type MasterDashboard = {
  source: "crm";
  asOf: string;
  query: MasterQuery;
  byRep: MasterRep[];
  rows: MasterRow[];
  total: number;
  hasMore: boolean;
  counts: Record<MasterTab, number>;
  daily: { day: string; applications: number; offers: number }[];
  events: MasterMilestone[];
  coverage: {
    financial: boolean;
    leadReplies: boolean;
    undatedApplications: number;
    bestWithoutEvidence: number;
  };
};
const unique = <T extends { id: string }>(rows: T[]) => [
  ...new Map(rows.map((r) => [r.id, r])).values(),
];
const lower = (s: string) => s.trim().toLowerCase();
const validAt = (s: string | undefined | null, now: number) =>
  !!s && Number.isFinite(Date.parse(s)) && Date.parse(s) <= now;
const emailOf = (s: string) =>
  s
    .match(/<([^<>]+)>/)?.[1]
    ?.trim()
    .toLowerCase() || lower(s);
const age = (s: string | undefined | null, now: number) =>
  validAt(s, now) ? Math.floor((now - Date.parse(s!)) / 86400000) : null;
const dayOf = (at: string) => new Date(at).toISOString().slice(0, 10);
const group = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r),
      list = m.get(k) || [];
    list.push(r);
    m.set(k, list);
  }
  return m;
};
const newest = <T>(rows: T[], at: (r: T) => string) =>
  [...rows].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)))[0];
export function equivalentMasterStage(
  o: Opportunity,
  state: string | null,
  hasOffers: boolean,
  funded: boolean,
): MasterStage {
  if (funded) return "funded";
  if (state === "client_withdrew") return "withdrawn";
  if (state === "funding_declined") return "declined";
  if (o.stage === "paused") return "paused";
  if (["contract_signed", "final_approval"].includes(state || ""))
    return "contracts_signed";
  if (state === "contract_sent") return "contracts_out";
  if (state === "requirements") return "requirements";
  if (hasOffers || ["offers", "lender_selected"].includes(state || ""))
    return "approved";
  if (["submitted", "lender_evaluation"].includes(state || ""))
    return "submitted";
  if (
    [
      "new",
      "contacting",
      "replied",
      "application_pending",
      "documents_pending",
      "analysis",
      "ready_for_closer",
      "unassigned",
    ].includes(o.stage)
  )
    return "application";
  return "unclassified";
}

/** A read model only: no writes, provider access, environment or HTML snapshot records. */
export function buildMasterPipeline(
  source: MasterSource,
  input: Partial<MasterQuery> = {},
  now = Date.now(),
): MasterDashboard {
  const q = querySchema.parse(input),
    finance = isCloserRole(source.profile.role);
  const profiles = new Map(source.profiles.map((p) => [p.id, p]));
  profiles.set(source.profile.id, source.profile);
  const name = (id: string) =>
    id === "unassigned" ? "—" : profiles.get(id)?.name || "—";
  const opportunities = unique(source.opportunities).filter((o) =>
    canSeeOpportunity(source.profile, o),
  );
  const allowed = new Map(opportunities.map((o) => [o.id, o]));
  const tasks = unique(source.tasks).filter(
    (t) =>
      t.status === "open" &&
      allowed.has(t.opportunity_id) &&
      canSeeArea(source.profile, allowed.get(t.opportunity_id)!, t.area),
  );
  const submissions = source.submissions.filter(
    (s) =>
      allowed.has(s.opportunity_id) &&
      canSeeArea(source.profile, allowed.get(s.opportunity_id)!, "closer"),
  );
  const processes = source.processes.filter(
    (p) =>
      allowed.has(p.opportunity_id) &&
      canSeeArea(source.profile, allowed.get(p.opportunity_id)!, "closer"),
  );
  const processByCase = group(processes, (p) => p.opportunity_id),
    subByCase = group(submissions, (s) => s.opportunity_id);
  const conv = source.conversations.filter(
    (c) =>
      allowed.has(c.opportunity_id) &&
      canSeeArea(source.profile, allowed.get(c.opportunity_id)!, c.area),
  );
  const convMap = new Map(conv.map((c) => [c.id, c]));
  const messages = unique(source.messages).filter((m) => {
    const c = convMap.get(m.conversation_id);
    return (
      c &&
      canSeeArea(
        source.profile,
        allowed.get(c.opportunity_id)!,
        m.area || c.area,
      ) &&
      validAt(m.sent_at, now) &&
      ((m.direction === "outbound" && m.status === "sent") ||
        (m.direction === "inbound" && m.status === "received"))
    );
  });
  const messageMap = new Map(messages.map((m) => [m.id, m])),
    mailByConversation = group(messages, (m) => m.conversation_id);
  const caseMail = group(
    messages,
    (m) => convMap.get(m.conversation_id)!.opportunity_id,
  );
  const mappedOffers = unique(source.offers).map((o) =>
    o.status === "selected" ? { ...o, status: "accepted" } : o,
  );
  // Preserve the legacy board's priority and classification. Its public routes still page by50.
  const baseline = buildPipelineBoard(
    {
      ...source,
      opportunities,
      tasks,
      offers: mappedOffers,
      conversations: [],
      messages: [],
    },
    processes,
    { group: "files" },
    now,
    100000,
  );
  const priorityByCase = new Map(baseline.rows.map((r) => [r.id, r.priority]));
  const goodEvents = unique(source.events).filter((e) => {
    const o = allowed.get(e.opportunity_id);
    return (
      o &&
      canSeeArea(source.profile, o, e.area) &&
      ["manual", "explicit"].includes(e.evidence_type) &&
      validAt(e.occurred_at, now) &&
      (!e.process_id ||
        e.area !== "closer" ||
        processes.some(
          (p) =>
            p.id === e.process_id &&
            p.opportunity_id === o.id &&
            !p.is_unclassified_archive,
        ))
    );
  });
  const eventsByCase = group(goodEvents, (e) => e.opportunity_id);
  const caseRows: MasterRow[] = opportunities.map((o) => {
    const process = (processByCase.get(o.id) || [])
      .filter(
        (p) => p.classification === "active" && !p.is_unclassified_archive,
      )
      .sort((a, b) => b.sequence_number - a.sequence_number)[0];
    const subs = (subByCase.get(o.id) || []).filter(
        (s) => !process || s.process_id === process.id,
      ),
      subIds = new Set(subs.map((s) => s.id));
    const compared = finance
      ? comparePipelineOffers(
          o,
          mappedOffers.filter(
            (f) => f.opportunity_id === o.id && subIds.has(f.submission_id),
          ),
          subs,
          source.lenders,
          now,
        )
      : null;
    const offers: MasterOffer[] = (compared?.active || []).map((f) => {
      const evidence = source.offerEvidence.find((e) => e.offer_id === f.id),
        message = evidence ? messageMap.get(evidence.message_id) : undefined;
      const c = message ? convMap.get(message.conversation_id) : undefined;
      const anchored =
        message?.direction === "inbound" &&
        c?.submission_id === f.submission_id &&
        c.opportunity_id === o.id;
      const answered = anchored
        ? (mailByConversation.get(c!.id) || []).some(
            (m) =>
              m.direction === "outbound" &&
              Date.parse(m.sent_at) > Date.parse(message!.sent_at),
          )
        : null;
      return {
        id: f.id,
        submissionId: f.submission_id,
        lender: f.lenderName,
        amount: f.amount,
        term: f.term,
        cost: f.cost,
        fees: f.fees,
        frequency: f.frequency,
        selected: f.status === "accepted",
        date: source.offers.find((x) => x.id === f.id)?.created_at || null,
        answered,
      };
    });
    const best =
      [...offers].sort(
        (a, b) => b.amount - a.amount || a.id.localeCompare(b.id),
      )[0] || null;
    const funded = Boolean(
      ((!process || process.state === "disbursed") &&
        validAt(o.funded_at, now) &&
        o.funded_amount !== null &&
        o.funded_amount > 0) ||
      (process?.state === "disbursed" &&
        (process.actual_funded_amount || 0) > 0 &&
        process.funded_lender_id &&
        (eventsByCase.get(o.id) || []).some(
          (e) => e.process_id === process.id && e.kind === "disbursed",
        )),
    );
    const ownerId = o.closer_id || o.seller_id || "unassigned",
      last = newest(caseMail.get(o.id) || [], (m) => m.sent_at);
    const chosen = offers.find((f) => f.selected),
      fundedLender = source.lenders.find(
        (l) =>
          l.id === process?.funded_lender_id || l.id === o.funded_lender_id,
      );
    return {
      id: o.id,
      caseId: o.id,
      ownerId,
      ownerName: name(ownerId),
      company: o.company,
      contact: o.contact,
      email: o.email,
      stage: equivalentMasterStage(
        o,
        process?.state || null,
        offers.length > 0,
        funded,
      ),
      sourceStage: process?.state || o.stage,
      priority: priorityByCase.get(o.id) || 3,
      offers: finance ? offers : undefined,
      best: finance ? best : undefined,
      lenders: finance ? new Set(subs.map((s) => s.lender_id)).size : undefined,
      declines: finance
        ? subs.filter((s) => s.status === "rejected").length
        : undefined,
      requirement: finance
        ? newest(
            subs.filter((s) => s.status === "requirements"),
            (s) => s.submitted_at,
          )?.next_action || ""
        : undefined,
      fundedBy: finance
        ? (funded ? fundedLender?.name : chosen?.lender) || ""
        : undefined,
      at: last?.sent_at || o.updated_at,
      waitingDays: age(last?.sent_at || o.updated_at, now),
      messageId: last?.id,
    };
  });
  const caseMap = new Map(caseRows.map((r) => [r.id, r]));
  const search = q.q.toLocaleLowerCase();
  const matches = (r: MasterRow) =>
    (q.stage === "all" || r.stage === q.stage) &&
    (!search ||
      `${r.company} ${r.contact} ${r.email} ${r.ownerName} ${r.title || ""} ${r.subject || ""} ${(r.offers || []).map((o) => o.lender).join(" ")}`
        .toLocaleLowerCase()
        .includes(search));
  const ownerMatches = (r: { ownerId: string }) =>
    q.owner === "all" || r.ownerId === q.owner;
  const cases = caseRows.filter(matches),
    caseIds = new Set(cases.map((r) => r.id));
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - q.days + 1);
  const inWindow = (at: string | undefined | null) =>
    validAt(at, now) && Date.parse(at!) >= start.getTime();
  // Registration is historical activity; expiry and the current process only affect live workload.
  const submissionIds = new Set(submissions.map((s) => s.id));
  const recordedOffers = finance
    ? unique(source.offers).filter(
        (f) =>
          caseIds.has(f.opportunity_id) &&
          submissionIds.has(f.submission_id) &&
          Number.isFinite(f.amount) &&
          f.amount > 0 &&
          [
            "received",
            "approved",
            "accepted",
            "selected",
            "offered",
            "active",
            "expired",
            "rejected",
            "withdrawn",
          ].includes(f.status.toLowerCase()) &&
          inWindow(f.created_at),
      )
    : [];
  const taskRows: MasterRow[] = tasks
    .map((t) => ({
      ...caseMap.get(t.opportunity_id)!,
      id: t.id,
      ownerId: t.owner_id || "unassigned",
      ownerName: name(t.owner_id || "unassigned"),
      title: t.title,
      at: t.due_at,
      waitingDays: age(t.due_at, now),
      messageId: newest(
        (caseMail.get(t.opportunity_id) || []).filter(
          (m) => m.direction === "inbound",
        ),
        (m) => m.sent_at,
      )?.id,
    }))
    .filter(
      (r) =>
        matches(r) &&
        (q.priority === "all" || r.priority === Number(q.priority)),
    );
  const commRows: MasterRow[] = messages
    .filter((m) => inWindow(m.sent_at))
    .map((m) => {
      const c = convMap.get(m.conversation_id)!,
        r = caseMap.get(c.opportunity_id)!;
      return {
        ...r,
        id: m.id,
        messageId: m.id,
        conversationId: c.id,
        subject: c.subject,
        direction: m.direction,
        at: m.sent_at,
        email: m.sender,
        offers: undefined,
        best: undefined,
      };
    })
    .filter(matches);
  const eligibleLead = (l: Lead) =>
    !l.suppressed &&
    (source.profile.role === "superadmin" ||
      source.profile.role === "seller_admin" ||
      (source.profile.role === "seller" && l.seller_id === source.profile.id));
  const leads = (source.leads || []).filter(eligibleLead),
    leadByEmail = new Map(leads.map((l) => [lower(l.email), l]));
  const archiveEvidence = new Set([
    ...messages.flatMap((m) =>
      m.archive_message_id ? [m.archive_message_id] : [],
    ),
    ...goodEvents.flatMap((e) =>
      e.archive_message_id ? [e.archive_message_id] : [],
    ),
  ]);
  const visibleArchive = unique(source.archive).filter(
    (m) => source.profile.role === "superadmin" || archiveEvidence.has(m.id),
  );
  const incorporatedArchives = new Set(
    messages.flatMap((m) =>
      m.archive_message_id ? [m.archive_message_id] : [],
    ),
  );
  for (const m of visibleArchive) {
    if (!inWindow(m.sent_at) || incorporatedArchives.has(m.id)) continue;
    const sender = m.participants.find((p) => p.role === "from")?.email || "",
      lead = leadByEmail.get(lower(sender));
    const linked = goodEvents.find((e) => e.archive_message_id === m.id),
      r = linked ? caseMap.get(linked.opportunity_id) : undefined;
    const ownerId =
      r?.ownerId || source.accountOwners?.[m.account_id] || "unassigned";
    const row: MasterRow = {
      id: "archive:" + m.id,
      caseId: r?.caseId || null,
      archiveMessageId: m.id,
      ownerId,
      ownerName: name(ownerId),
      company: r?.company || lead?.company || "—",
      contact: r?.contact || lead?.contact || "",
      email: sender,
      stage: r?.stage || "unclassified",
      at: m.sent_at,
      subject: m.subject,
      direction: m.direction,
    };
    if (matches(row)) commRows.push(row);
  }
  const replyRows: MasterRow[] = [];
  for (const c of conv) {
    const o = allowed.get(c.opportunity_id)!,
      r = caseMap.get(o.id)!;
    const latest = newest(
      (mailByConversation.get(c.id) || []).filter(
        (m) =>
          m.direction === "inbound" &&
          m.nature === "personal" &&
          !automatedSender(emailOf(m.sender)) &&
          emailOf(m.sender) === lower(o.email),
      ),
      (m) => m.sent_at,
    );
    if (
      !latest ||
      !["positive", "review"].includes(latest.reply_intent || "") ||
      !inWindow(latest.sent_at) ||
      Date.parse(latest.sent_at) < Date.parse(MAIL_ENGAGEMENT_START)
    )
      continue;
    const answered = (mailByConversation.get(c.id) || []).some(
      (m) =>
        m.direction === "outbound" &&
        Date.parse(m.sent_at) > Date.parse(latest.sent_at),
    );
    replyRows.push({
      ...r,
      id: latest.id,
      messageId: latest.id,
      conversationId: c.id,
      at: latest.sent_at,
      intent: latest.reply_intent!,
      answered,
      converted: true,
      subject: c.subject,
      offers: undefined,
      best: undefined,
    });
  }
  if (source.profile.role === "superadmin") {
    const archivedByThread = group(
      visibleArchive,
      (m) => m.account_id + ":" + m.gmail_thread_id,
    );
    const incorporated = new Set(
      messages.flatMap((m) =>
        m.archive_message_id ? [m.archive_message_id] : [],
      ),
    );
    for (const thread of archivedByThread.values()) {
      const latest = newest(
        thread.filter(
          (m) =>
            m.direction === "inbound" &&
            m.nature === "personal" &&
            validAt(m.sent_at, now),
        ),
        (m) => m.sent_at,
      );
      if (
        !latest ||
        incorporated.has(latest.id) ||
        !["positive", "review"].includes(latest.reply_intent || "") ||
        !inWindow(latest.sent_at) ||
        Date.parse(latest.sent_at) < Date.parse(MAIL_ENGAGEMENT_START)
      )
        continue;
      const sender = latest.participants.find((p) => p.role === "from")?.email,
        lead = sender ? leadByEmail.get(lower(sender)) : undefined;
      if (
        !lead ||
        automatedSender(sender!) ||
        (lead.opportunity_id && !allowed.has(lead.opportunity_id))
      )
        continue;
      const answered = thread.some(
        (m) =>
          m.direction === "outbound" &&
          validAt(m.sent_at, now) &&
          Date.parse(m.sent_at) > Date.parse(latest.sent_at),
      );
      const row: MasterRow = {
        id: "archive:" + latest.id,
        caseId: lead.opportunity_id,
        archiveMessageId: latest.id,
        ownerId: lead.seller_id || "unassigned",
        ownerName: name(lead.seller_id || "unassigned"),
        company: lead.company,
        contact: lead.contact,
        email: lead.email,
        stage: lead.opportunity_id
          ? caseMap.get(lead.opportunity_id)?.stage || "unclassified"
          : "application",
        at: latest.sent_at,
        intent: latest.reply_intent!,
        answered,
        converted: !!lead.opportunity_id,
        subject: latest.subject,
        excerpt: "",
        messageId: undefined,
      };
      if (matches(row)) replyRows.push(row);
    }
  }
  const milestones: MasterMilestone[] = [];
  const seenMilestones = new Set<string>();
  for (const e of [...goodEvents].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  )) {
    if (
      ![
        "application_received",
        "contract_sent",
        "contract_signed",
        "disbursed",
      ].includes(e.kind) ||
      !caseIds.has(e.opportunity_id)
    )
      continue;
    const key = `${e.opportunity_id}:${e.process_id || "case"}:${e.kind}`;
    if (seenMilestones.has(key)) continue;
    seenMilestones.add(key);
    if (inWindow(e.occurred_at)) {
      const r = caseMap.get(e.opportunity_id)!;
      milestones.push({
        id: e.id,
        caseId: r.id,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        company: r.company,
        kind: e.kind,
        at: e.occurred_at,
      });
    }
  }
  // Legacy files can already record an actual amount/date without a case_event.
  // Do not add a second milestone when process evidence exists for the same file.
  if (finance)
    for (const o of opportunities) {
      if (
        !caseIds.has(o.id) ||
        !inWindow(o.funded_at) ||
        !(o.funded_amount && o.funded_amount > 0) ||
        goodEvents.some(
          (e) => e.opportunity_id === o.id && e.kind === "disbursed",
        )
      )
        continue;
      const r = caseMap.get(o.id)!;
      milestones.push({
        id: "recorded-funding:" + o.id,
        caseId: o.id,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        company: r.company,
        kind: "disbursed",
        at: o.funded_at!,
      });
    }
  const docs = source.documents.filter(
    (d) =>
      d.kind === "application" &&
      ["received", "approved"].includes(d.status) &&
      d.storage_path &&
      allowed.has(d.opportunity_id) &&
      canSeeArea(source.profile, allowed.get(d.opportunity_id)!, "seller"),
  );
  for (const [caseId, list] of group(docs, (d) => d.opportunity_id)) {
    if (
      goodEvents.some(
        (e) => e.opportunity_id === caseId && e.kind === "application_received",
      )
    )
      continue;
    const first = [...list]
        .filter((d) => validAt(d.created_at, now))
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0],
      r = caseMap.get(caseId)!;
    if (first && caseIds.has(caseId) && inWindow(first.created_at))
      milestones.push({
        id: "document:" + first.id,
        caseId,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        company: r.company,
        kind: "application_received",
        at: first.created_at,
      });
  }
  const permittedRepIds = new Set([
    source.profile.id,
    ...caseRows.map((r) => r.ownerId),
    ...tasks.map((t) => t.owner_id),
  ]);
  if (
    ["superadmin", "seller_admin", "closer_admin"].includes(source.profile.role)
  )
    for (const p of source.profiles)
      if (p.active !== false) permittedRepIds.add(p.id);
  const repIds = [...permittedRepIds].filter(Boolean);
  const byRep: MasterRep[] = repIds
    .map((id) => {
      const own = cases.filter((r) => r.ownerId === id),
        ownTasks = taskRows.filter((r) => r.ownerId === id),
        best = own.filter((r) => r.best);
      const ownEvents = milestones.filter((e) => e.ownerId === id),
        ownMail = commRows.filter((r) => r.ownerId === id);
      return {
        id,
        name: name(id),
        tasks: ownTasks.length,
        p1: ownTasks.filter((r) => r.priority === 1).length,
        offers: finance
          ? own.reduce((n, r) => n + (r.offers?.length || 0), 0)
          : null,
        unansweredBest:
          finance && !best.some((r) => r.best!.answered === null)
            ? best.filter((r) => r.best!.answered === false).length
            : null,
        live: own.filter(
          (r) =>
            !["funded", "declined", "withdrawn", "paused"].includes(r.stage),
        ).length,
        funded: own.filter((r) => r.stage === "funded").length,
        emails: new Set(
          ownMail.map((r) => messageMap.get(r.id)?.archive_message_id || r.id),
        ).size,
        leadsOpen:
          source.leadCoverage && isSellerRole(source.profile.role)
            ? replyRows.filter(
                (r) => r.ownerId === id && !r.converted && r.answered === false,
              ).length
            : null,
        applications: ownEvents.filter((e) => e.kind === "application_received")
          .length,
        offerFiles: finance
          ? new Set(
              recordedOffers
                .filter((f) => caseMap.get(f.opportunity_id)?.ownerId === id)
                .map((f) => f.opportunity_id),
            ).size
          : null,
        contractsOut: finance
          ? ownEvents.filter((e) => e.kind === "contract_sent").length
          : null,
        signed: finance
          ? ownEvents.filter((e) => e.kind === "contract_signed").length
          : null,
        fundings: finance
          ? ownEvents.filter((e) => e.kind === "disbursed").length
          : null,
      };
    })
    .sort(
      (a, b) =>
        b.tasks - a.tasks ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  const selectedCases = cases.filter(ownerMatches),
    selectedEvents = milestones
      .filter(ownerMatches)
      .sort(
        (a, b) =>
          Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id),
      );
  const daily = Array.from({ length: q.days }, (_, i) => {
    const day = new Date(start.getTime() + i * 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      day,
      applications: selectedEvents.filter(
        (e) => e.kind === "application_received" && dayOf(e.at) === day,
      ).length,
      offers: recordedOffers.filter(
        (f) =>
          ownerMatches(caseMap.get(f.opportunity_id)!) &&
          dayOf(f.created_at!) === day,
      ).length,
    };
  });
  const allRows: Record<MasterTab, MasterRow[]> = {
    tasks: taskRows
      .filter(ownerMatches)
      .sort(
        (a, b) =>
          (a.priority || 3) - (b.priority || 3) ||
          (Date.parse(a.at || "") || Infinity) -
            (Date.parse(b.at || "") || Infinity) ||
          a.id.localeCompare(b.id),
      ),
    offers: selectedCases.filter((r) => r.offers?.length),
    pipeline: selectedCases,
    stats: selectedEvents.map((e) => ({
      id: e.id,
      caseId: e.caseId,
      ownerId: e.ownerId,
      ownerName: e.ownerName,
      company: e.company,
      contact: "",
      email: "",
      stage: caseMap.get(e.caseId)!.stage,
      title: e.kind,
      at: e.at,
    })),
    comms: commRows
      .filter(ownerMatches)
      .sort(
        (a, b) =>
          Date.parse(b.at!) - Date.parse(a.at!) || a.id.localeCompare(b.id),
      ),
    leads: replyRows
      .filter(ownerMatches)
      .sort(
        (a, b) =>
          Date.parse(b.at!) - Date.parse(a.at!) || a.id.localeCompare(b.id),
      ),
  };
  const list = allRows[q.tab],
    counts = Object.fromEntries(
      masterTabs.map((t) => [t, allRows[t].length]),
    ) as Record<MasterTab, number>;
  return {
    source: "crm",
    asOf: new Date(now).toISOString(),
    query: q,
    byRep,
    rows: list.slice(q.page * 50, q.page * 50 + 50),
    total: list.length,
    hasMore: (q.page + 1) * 50 < list.length,
    counts,
    daily,
    events: selectedEvents.slice(q.page * 50, q.page * 50 + 50),
    coverage: {
      financial: finance,
      leadReplies: source.leadCoverage && isSellerRole(source.profile.role),
      undatedApplications: selectedCases.filter(
        (r) =>
          allowed.get(r.id)!.application_complete &&
          !goodEvents.some(
            (e) =>
              e.opportunity_id === r.id && e.kind === "application_received",
          ) &&
          !docs.some(
            (d) => d.opportunity_id === r.id && validAt(d.created_at, now),
          ),
      ).length,
      bestWithoutEvidence: selectedCases.filter(
        (r) => r.best?.answered === null,
      ).length,
    },
  };
}
