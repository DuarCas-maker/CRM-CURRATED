import { z } from "zod";
import type {
  Locale,
  Offer,
  Opportunity,
  Submission,
  Workspace,
} from "../domain";
import { canSeeArea, canSeeOpportunity, isCloserRole } from "../domain";
import { summarizeOpportunities } from "../opportunity-signals";
import { documentProgress } from "../document-labels";

export const pipelineGroups = [
  "files",
  "tasks",
  "app",
  "need",
  "offers",
  "docsout",
  "signed",
  "clients",
] as const;
export type PipelineGroup = (typeof pipelineGroups)[number];
export const pipelineLabels: Record<PipelineGroup, [string, string]> = {
  files: ["Expedientes", "Files"],
  tasks: ["Tareas abiertas", "Open tasks"],
  app: ["Aplicación pendiente", "App needed"],
  need: ["Oferta pendiente", "Offer needed"],
  offers: ["Ofertas", "Offers"],
  docsout: ["Contratos enviados", "Docs out"],
  signed: ["Contratos firmados", "Docs signed"],
  clients: ["Clientes", "Clients"],
};
export const pipelineStages = [
  "app",
  "need",
  "offers",
  "docsout",
  "signed",
] as const;
export type PipelineProcess = {
  id: string;
  opportunity_id: string;
  sequence_number: number;
  state: string;
  classification: string;
  is_unclassified_archive: boolean;
};
export type PipelineOffer = Offer & {
  lenderName: string;
  requirements: string;
};
export type PipelineRow = {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  industry: string;
  ownerId: string;
  ownerName: string;
  requestedAmount: number;
  stage: Opportunity["stage"];
  groups: PipelineGroup[];
  processId: string | null;
  processState: string | null;
  priority: 1 | 2 | 3;
  waitingDays: number | null;
  nextAction: string;
  nextActionAt: string | null;
  taskId: string | null;
  documentCount: number;
  requiredCount: number;
  approvedCount: number;
  lenderCount: number | null;
  offers: PipelineOffer[] | null;
  selectedOffer: PipelineOffer | null;
  highestOffer: PipelineOffer | null;
  fundedAmount: number | null;
  fundedAt: string | null;
  updatedAt: string;
  applicationComplete: boolean;
  applicationSigned: boolean;
};
const querySchema = z.object({
  q: z.string().max(200).default(""),
  owner: z.string().max(100).default("all"),
  group: z.enum(pipelineGroups).default("files"),
  page: z.coerce.number().int().min(0).max(100000).default(0),
  hours: z.coerce
    .number()
    .refine((n) => [24, 48, 168, 720].includes(n))
    .default(24),
});
export type PipelineQuery = z.infer<typeof querySchema>;
export function parsePipelineQuery(params: URLSearchParams): PipelineQuery {
  return querySchema.parse(Object.fromEntries(params));
}
export type PipelineBoard = {
  source: "crm";
  campaigns: { total: number; active: number; scheduled: number };
  asOf: string;
  hours: number;
  page: number;
  total: number;
  hasMore: boolean;
  rows: PipelineRow[];
  counts: Record<PipelineGroup, number>;
  byRep: {
    id: string;
    name: string;
    total: number;
    tasks: number;
    offers: number;
    funded: number;
  }[];
  summary: {
    active: number;
    urgent: number;
    offers: number | null;
    fundedAmount: number | null;
    fundedCount: number;
  };
  updates: {
    id: string;
    eventId?: string;
    sourceMessageId?: string;
    summary?: string;
    company: string;
    group: PipelineGroup;
    priority: number;
    nextAction: string;
    at: string;
  }[];
  priorities: Pick<PipelineRow, "id" | "company" | "nextAction" | "priority">[];
};
export type PipelineMailUpdate = {
  id: string;
  opportunity_id: string;
  message_id: string;
  approved_at: string;
  approved_value: {
    summary: string;
    task_title: string;
    kind: "offer" | "requirement";
  };
};
export type PipelineSource = Pick<
  Workspace,
  | "profile"
  | "profiles"
  | "opportunities"
  | "offers"
  | "submissions"
  | "documents"
  | "tasks"
  | "accounts"
  | "lenders"
  | "lender_contacts"
  | "conversations"
  | "messages"
  | "opportunity_signals"
> & {
  campaigns?: Pick<Workspace["campaigns"][number], "id" | "status">[];
  mail_review_updates?: PipelineMailUpdate[];
};

export function comparePipelineOffers(
  opportunity: Pick<Opportunity, "amount">,
  offers: Offer[],
  submissions: Submission[],
  lenders: Workspace["lenders"],
  now = Date.now(),
) {
  const active: PipelineOffer[] = offers
    .filter((o) => {
      const expiry = o.expires_at ? Date.parse(o.expires_at) : Infinity;
      return (
        Number.isFinite(o.amount) &&
        o.amount > 0 &&
        ["received", "approved", "accepted", "offered", "active"].includes(
          o.status.toLowerCase(),
        ) &&
        expiry > now
      );
    })
    .map((o) => {
      const submission = submissions.find((s) => s.id === o.submission_id);
      return {
        ...o,
        lenderName:
          lenders.find((l) => l.id === submission?.lender_id)?.name || "—",
        requirements: submission?.next_action || "",
      };
    });
  // A closest-amount suggestion is never labelled an approved multi-factor choice.
  active.sort(
    (a, b) =>
      Number(b.status === "accepted") - Number(a.status === "accepted") ||
      Math.abs(a.amount - opportunity.amount) -
        Math.abs(b.amount - opportunity.amount) ||
      a.id.localeCompare(b.id),
  );
  return {
    active,
    selected: active.find((o) => o.status === "accepted") || null,
    highest:
      [...active].sort(
        (a, b) => b.amount - a.amount || a.id.localeCompare(b.id),
      )[0] || null,
  };
}

function indexByCase<T extends { opportunity_id: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.opportunity_id) || [];
    list.push(row);
    map.set(row.opportunity_id, list);
  }
  return map;
}

export function buildPipelineBoard(
  data: PipelineSource,
  processes: PipelineProcess[] = [],
  input: Partial<PipelineQuery> = {},
  now = Date.now(),
  pageSize = 50,
): PipelineBoard {
  const q = querySchema.parse(input);
  const allowed = data.opportunities.filter((o) =>
    canSeeOpportunity(data.profile, o),
  );
  const offers = indexByCase(data.offers),
    submissions = indexByCase(data.submissions);
  const docs = indexByCase(data.documents),
    tasks = indexByCase(data.tasks),
    processMap = indexByCase(processes);
  const signals =
    data.opportunity_signals || summarizeOpportunities(allowed, data);
  const rows: PipelineRow[] = allowed
    .map((o) => {
      const closer = canSeeArea(data.profile, o, "closer");
      const process = closer
        ? (processMap.get(o.id) || [])
            .filter(
              (p) =>
                p.classification === "active" && !p.is_unclassified_archive,
            )
            .sort((a, b) => b.sequence_number - a.sequence_number)[0]
        : undefined;
      const state = process?.state || null;
      const caseSubmissions = submissions.get(o.id) || [];
      const currentSubmissions = process
        ? caseSubmissions.filter((s) => s.process_id === process.id)
        : caseSubmissions;
      const currentSubmissionIds = new Set(currentSubmissions.map((s) => s.id));
      const comparison = closer
        ? comparePipelineOffers(
            o,
            (offers.get(o.id) || []).filter(
              (f) => !process || currentSubmissionIds.has(f.submission_id),
            ),
            currentSubmissions,
            data.lenders,
            now,
          )
        : null;
      const documents = docs.get(o.id) || [];
      const documentStatus = documentProgress(
        documents.filter((d) => d.kind !== "analysis_report"),
      );
      const openTasks = (tasks.get(o.id) || [])
        .filter(
          (t) => t.status === "open" && canSeeArea(data.profile, o, t.area),
        )
        .sort(
          (a, b) =>
            (Date.parse(a.due_at) || Infinity) -
            (Date.parse(b.due_at) || Infinity),
        );
      const next = openTasks[0];
      const ownerId = o.closer_id || o.seller_id;
      const funded =
        !!o.funded_at &&
        o.funded_amount !== null &&
        Number.isFinite(o.funded_amount);
      const renewal =
        funded &&
        process &&
        !["disbursed", "funding_declined", "client_withdrew"].includes(
          process.state,
        );
      const groups: PipelineGroup[] = ["files"];
      if (funded) groups.push("clients");
      if ((!funded || renewal) && !["lost", "paused"].includes(o.stage)) {
        let bucket: (typeof pipelineStages)[number];
        if (["contract_signed", "final_approval"].includes(state || ""))
          bucket = "signed";
        else if (state === "contract_sent") bucket = "docsout";
        else if (comparison?.active.length) bucket = "offers";
        else if (
          [
            "prepared",
            "submitted",
            "lender_evaluation",
            "offers",
            "lender_selected",
            "requirements",
          ].includes(state || "") ||
          ([
            "analysis",
            "ready_for_closer",
            "unassigned",
            "lenders",
            "offers",
            "negotiation",
            "accepted",
            "funding_pending",
          ].includes(o.stage) &&
            !renewal)
        )
          bucket = "need";
        else bucket = "app";
        groups.push("tasks", bucket);
      }
      const due = next?.due_at || o.next_action_at;
      const overdue = !!due && Date.parse(due) < now;
      const priority: 1 | 2 | 3 =
        groups.includes("signed") ||
        groups.includes("docsout") ||
        comparison?.selected ||
        overdue
          ? 1
          : comparison?.active.length || next
            ? 2
            : 3;
      const updated = Date.parse(o.updated_at);
      return {
        id: o.id,
        company: o.company,
        contact: o.contact,
        email: o.email,
        phone: o.phone,
        industry: o.industry,
        ownerId,
        ownerName: data.profiles.find((p) => p.id === ownerId)?.name || "—",
        requestedAmount: o.amount,
        stage: o.stage,
        groups,
        processId: process?.id || null,
        processState: state,
        priority,
        waitingDays:
          Number.isFinite(updated) && updated <= now
            ? Math.floor((now - updated) / 86400000)
            : null,
        nextAction: next?.title || o.next_action || "",
        nextActionAt: due,
        taskId: next?.id || null,
        documentCount:
          signals[o.id]?.documentCount ??
          documents.filter((d) => !!d.storage_path).length,
        requiredCount: documentStatus.total,
        approvedCount: documentStatus.approved,
        lenderCount: closer ? (signals[o.id]?.lenderCount ?? 0) : null,
        offers: comparison?.active ?? null,
        selectedOffer: comparison?.selected || null,
        highestOffer: comparison?.highest || null,
        fundedAmount: closer && funded ? o.funded_amount : null,
        fundedAt: o.funded_at,
        updatedAt: o.updated_at,
        applicationComplete: o.application_complete,
        applicationSigned: o.application_signed,
      };
    })
    .filter(
      (r) =>
        (q.owner === "all" || r.ownerId === q.owner) &&
        `${r.company} ${r.contact} ${r.email} ${r.phone} ${r.industry} ${r.ownerName} ${(r.offers || []).map((o) => o.lenderName).join(" ")}`
          .toLocaleLowerCase()
          .includes(q.q.trim().toLocaleLowerCase()),
    );
  rows.sort(
    (a, b) =>
      a.priority - b.priority ||
      (b.waitingDays ?? -1) - (a.waitingDays ?? -1) ||
      a.company.localeCompare(b.company) ||
      a.id.localeCompare(b.id),
  );
  const counts = Object.fromEntries(
    pipelineGroups.map((g) => [
      g,
      rows.filter((r) => r.groups.includes(g)).length,
    ]),
  ) as PipelineBoard["counts"];
  const filtered = rows.filter((r) => r.groups.includes(q.group));
  const byRep = [...new Set(rows.map((r) => r.ownerId))]
    .map((id) => {
      const own = rows.filter((r) => r.ownerId === id);
      return {
        id,
        name: own[0].ownerName,
        total: own.length,
        tasks: own.filter((r) => r.groups.includes("tasks")).length,
        offers: own.reduce((s, r) => s + (r.offers?.length || 0), 0),
        funded: own.filter((r) => r.groups.includes("clients")).length,
      };
    })
    .sort((a, b) => b.tasks - a.tasks || a.name.localeCompare(b.name));
  const inWindow = (at: string) =>
    Date.parse(at) <= now && Date.parse(at) >= now - q.hours * 3600000;
  const reviewed: PipelineBoard["updates"] = (
    data.mail_review_updates || []
  ).flatMap((event) => {
    const row = rows.find((r) => r.id === event.opportunity_id);
    if (
      !row ||
      !canSeeArea(
        data.profile,
        allowed.find((o) => o.id === row.id)!,
        "closer",
      ) ||
      !event.approved_value ||
      !inWindow(event.approved_at)
    )
      return [];
    return [
      {
        id: row.id,
        eventId: event.id,
        sourceMessageId: event.message_id,
        company: row.company,
        group: event.approved_value.kind === "offer" ? "offers" : "need",
        priority: row.priority,
        summary: event.approved_value.summary,
        nextAction: event.approved_value.task_title,
        at: event.approved_at,
      },
    ];
  });
  const edited: PipelineBoard["updates"] = rows
    .filter(
      (r) => inWindow(r.updatedAt) && !reviewed.some((e) => e.id === r.id),
    )
    .map((r) => ({
      id: r.id,
      company: r.company,
      group:
        r.groups.find((g) =>
          pipelineStages.includes(g as (typeof pipelineStages)[number]),
        ) || (r.groups.includes("clients") ? "clients" : "files"),
      priority: r.priority,
      nextAction: r.nextAction,
      at: r.updatedAt,
    }));
  return {
    source: "crm",
    campaigns: {
      total: data.campaigns?.length || 0,
      active: data.campaigns?.filter((c) => c.status === "active").length || 0,
      scheduled:
        data.campaigns?.filter((c) => c.status === "scheduled").length || 0,
    },
    asOf: new Date(now).toISOString(),
    hours: q.hours,
    page: q.page,
    total: filtered.length,
    hasMore: (q.page + 1) * pageSize < filtered.length,
    rows: filtered.slice(q.page * pageSize, q.page * pageSize + pageSize),
    counts,
    byRep,
    summary: {
      active: counts.tasks,
      urgent: rows.filter((r) => r.groups.includes("tasks") && r.priority === 1)
        .length,
      offers: isCloserRole(data.profile.role)
        ? rows.reduce((s, r) => s + (r.offers?.length || 0), 0)
        : null,
      fundedAmount: isCloserRole(data.profile.role)
        ? rows.reduce((s, r) => s + (r.fundedAmount || 0), 0)
        : null,
      fundedCount: counts.clients,
    },
    updates: [...reviewed, ...edited]
      .sort(
        (a, b) =>
          Date.parse(b.at) - Date.parse(a.at) ||
          (a.eventId || a.id).localeCompare(b.eventId || b.id),
      )
      .slice(0, 50),
    priorities: rows
      .filter((r) => r.groups.includes("tasks"))
      .slice(0, 3)
      .map(({ id, company, nextAction, priority }) => ({
        id,
        company,
        nextAction,
        priority,
      })),
  };
}

export function pipelineLabel(group: PipelineGroup, locale: Locale) {
  return pipelineLabels[group][locale === "es" ? 0 : 1];
}
