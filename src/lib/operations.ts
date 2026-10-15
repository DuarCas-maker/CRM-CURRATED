import type { Workspace, Opportunity } from "./domain";
import { canSeeArea } from "./domain";
export type OperationalSettings = {
  id: number;
  version: number;
  reply_hours: number;
  followup_hours: number;
  offer_warning_hours: number;
};
export const defaultOperationalSettings: OperationalSettings = {
  id: 1,
  version: 1,
  reply_hours: 24,
  followup_hours: 120,
  offer_warning_hours: 48,
};
export type OperationalRow = {
  id: string;
  company: string;
  contact: string;
  email: string;
  stage: Opportunity["stage"];
  owner_id: string | null;
  owner_name: string;
  priority: string;
  needs_attention: boolean;
  overdue: boolean;
  negotiation: boolean;
  waiting_for: "team" | "client" | "lender" | null;
  reply_count: number;
  reply_since: string | null;
  reply_due_at: string | null;
  followup_due_at: string | null;
  due_at: string | null;
  next_action: string;
  next_action_at: string | null;
  next_task: string | null;
  next_task_at: string | null;
  next_lender_action: string | null;
  next_lender_action_at: string | null;
  overdue_tasks: number;
  document_review_count: number;
  missing_document_count: number;
  analysis_status: string | null;
  analysis_pending: boolean;
  waiting_lender_count: number;
  waiting_client_count: number;
  expiring_offer_count: number;
  next_offer_expiry: string | null;
  lenders: {
    id: string;
    name: string;
    status: string;
    next_action: string;
    next_action_at: string;
  }[];
  waits: {
    conversation_id: string;
    waiting_for: string;
    since_at: string;
    due_at: string;
  }[];
  handed_off_at: string | null;
};
export type OperationalData = {
  rows: OperationalRow[];
  total: number;
  counts: Record<string, number>;
  settings: OperationalSettings;
};
export function operationalMatches(row: OperationalRow, filter: string) {
  switch (filter) {
    case "attention":
      return row.needs_attention;
    case "reply":
      return row.reply_count > 0;
    case "overdue":
      return row.overdue;
    case "documents":
      return row.document_review_count + row.missing_document_count > 0;
    case "analysis":
      return (
        row.analysis_pending ||
        ["draft", "failed", "uncertain", "outdated"].includes(
          row.analysis_status || "",
        )
      );
    case "lender":
      return row.waiting_lender_count > 0 || row.lenders.length > 0;
    case "negotiation":
      return row.negotiation;
    case "offers":
      return row.expiring_offer_count > 0;
    default:
      return true;
  }
}
export function demoOperationalDashboard(
  data: Workspace,
  opportunities: Opportunity[],
  filter = "all",
  page = 0,
  now = Date.now(),
): OperationalData {
  const settings = data.operational?.settings || defaultOperationalSettings;
  const rows = opportunities
    .filter((o) => !["funded", "lost", "paused"].includes(o.stage))
    .map((o) => {
      const tasks = data.tasks
        .filter(
          (t) =>
            t.opportunity_id === o.id &&
            t.status === "open" &&
            canSeeArea(data.profile, o, t.area),
        )
        .sort((a, b) => a.due_at.localeCompare(b.due_at));
      const conversations = data.conversations.filter(
        (c) =>
          c.opportunity_id === o.id &&
          c.needs_attention &&
          canSeeArea(data.profile, o, c.area),
      );
      const inbound = conversations
        .map(
          (c) =>
            data.messages
              .filter(
                (m) =>
                  m.conversation_id === c.id &&
                  ["received", "sent"].includes(m.status),
              )
              .sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0],
        )
        .filter((m) => m?.direction === "inbound");
      const replySince = inbound.map((m) => m.sent_at).sort()[0] || null;
      const replyDue = replySince
        ? new Date(
            Date.parse(replySince) + settings.reply_hours * 3600000,
          ).toISOString()
        : null;
      const docs = data.documents.filter(
        (d) => d.opportunity_id === o.id && d.kind !== "analysis_report",
      );
      const submissions = data.submissions
        .filter(
          (s) =>
            s.opportunity_id === o.id &&
            canSeeArea(data.profile, o, "closer") &&
            !["draft", "rejected", "withdrawn"].includes(s.status),
        )
        .sort((a, b) => a.next_action_at.localeCompare(b.next_action_at));
      const lenders = submissions.map((s) => ({
        id: s.lender_id,
        name: data.lenders.find((l) => l.id === s.lender_id)?.name || "",
        status: s.status,
        next_action: s.next_action,
        next_action_at: s.next_action_at,
      }));
      const offers = data.offers
        .filter(
          (f) =>
            f.opportunity_id === o.id &&
            canSeeArea(data.profile, o, "closer") &&
            f.status === "received" &&
            f.expires_at,
        )
        .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
      const overdueTasks = tasks.filter(
        (t) => Date.parse(t.due_at) < now,
      ).length;
      const overdue =
        overdueTasks > 0 ||
        !!(replyDue && Date.parse(replyDue) <= now) ||
        !!(
          !o.handed_off_at &&
          o.next_action_at &&
          Date.parse(o.next_action_at) < now
        ) ||
        submissions.some((s) => Date.parse(s.next_action_at) < now);
      const review = docs.filter(
          (d) => !!d.storage_path && d.status !== "approved",
        ).length,
        missing =
          docs.filter(
            (d) =>
              d.kind !== "bank_statement" &&
              d.required !== false &&
              !d.storage_path,
          ).length +
          Math.max(
            0,
            4 -
              new Set(
                docs
                  .filter((d) => d.kind === "bank_statement" && d.storage_path)
                  .map((d) => d.content_hash || d.id),
              ).size,
          ),
        expiring = offers.filter(
          (f) =>
            Date.parse(f.expires_at) <=
            now + settings.offer_warning_hours * 3600000,
        ).length;
      const ownerId = o.handed_off_at ? o.closer_id : o.seller_id;
      const row: OperationalRow = {
        id: o.id,
        company: o.company,
        contact: o.contact,
        email: o.email,
        stage: o.stage,
        owner_id: ownerId,
        owner_name: data.profiles.find((p) => p.id === ownerId)?.name || "",
        handed_off_at: o.handed_off_at,
        reply_count: inbound.length,
        reply_since: replySince,
        reply_due_at: replyDue,
        followup_due_at: null,
        next_task: tasks[0]?.title || null,
        next_task_at: tasks[0]?.due_at || null,
        overdue_tasks: overdueTasks,
        next_action: o.next_action,
        next_action_at: o.next_action_at,
        next_lender_action: submissions[0]?.next_action || null,
        next_lender_action_at: submissions[0]?.next_action_at || null,
        lenders,
        waits: [],
        waiting_for: inbound.length ? "team" : null,
        waiting_lender_count: 0,
        waiting_client_count: 0,
        document_review_count: review,
        missing_document_count: missing,
        analysis_status: null,
        analysis_pending:
          ["analysis", "documents_pending"].includes(o.stage) &&
          !data.analyses.some(
            (a) => a.opportunity_id === o.id && a.is_current !== false,
          ),
        negotiation: [
          "offers",
          "negotiation",
          "accepted",
          "funding_pending",
        ].includes(o.stage),
        next_offer_expiry: offers[0]?.expires_at || null,
        expiring_offer_count: expiring,
        overdue,
        needs_attention:
          inbound.length > 0 ||
          overdue ||
          review > 0 ||
          expiring > 0 ||
          !ownerId,
        due_at: null,
        priority: "scheduled",
      };
      row.due_at =
        [
          replyDue,
          row.next_task_at,
          o.handed_off_at ? null : o.next_action_at,
          row.next_lender_action_at,
          row.next_offer_expiry,
        ]
          .filter((s): s is string => !!s)
          .sort()[0] || null;
      row.priority = inbound.length
        ? "reply"
        : overdue
          ? "overdue"
          : expiring
            ? "offers"
            : !ownerId
              ? "unassigned"
              : review
                ? "documents"
                : row.negotiation
                  ? "negotiation"
                  : lenders.length
                    ? "lender"
                    : "scheduled";
      return row;
    });
  rows.sort(
    (a, b) =>
      Number(b.needs_attention) - Number(a.needs_attention) ||
      (a.priority === "reply" ? -1 : 0) - (b.priority === "reply" ? -1 : 0) ||
      (a.due_at || "9999").localeCompare(b.due_at || "9999") ||
      a.company.localeCompare(b.company),
  );
  const counts = Object.fromEntries(
    [
      "attention",
      "reply",
      "overdue",
      "documents",
      "analysis",
      "lender",
      "negotiation",
      "offers",
    ].map((f) => [f, rows.filter((r) => operationalMatches(r, f)).length]),
  );
  counts.active = rows.length;
  const selected = rows.filter((r) => operationalMatches(r, filter));
  return {
    rows: selected.slice(page * 50, page * 50 + 50),
    total: selected.length,
    counts,
    settings,
  };
}
