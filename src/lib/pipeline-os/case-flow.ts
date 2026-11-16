import { z } from "zod";
import type {
  Analysis,
  Conversation,
  Document,
  Message,
  Opportunity,
  Profile,
} from "../domain";

export const manualMilestones = [
  "application",
  "application-file",
  "statements",
  "additional-documents",
  "sources",
  "submissions",
  "contract-sent",
  "contract-signed",
  "final-approval",
] as const;
const uuid = z.uuid();
const money = z
  .number()
  .finite()
  .positive()
  .max(999999999999.99)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.0001,
    "Máximo dos decimales.",
  );
const evidence = {
  reason: z.string().trim().min(1).max(2000),
  archive_message_id: uuid.nullable(),
  document_id: uuid.nullable(),
};
export const caseFlowCommandSchema = z
  .discriminatedUnion("operation", [
    z
      .object({
        operation: z.literal("lender"),
        request_key: uuid,
        process_id: uuid.nullable(),
        expected_event_id: uuid.nullable(),
        lender_id: uuid,
        conversation_id: uuid.nullable(),
        state: z.enum([
          "offer",
          "selected",
          "requirements_pending",
          "requirements_resolved",
          "agreed_amount",
        ]),
        offered_amount: money.nullable(),
        agreed_amount: money.nullable(),
        ...evidence,
      })
      .strict(),
    z
      .object({
        operation: z.literal("confirmation"),
        request_key: uuid,
        process_id: uuid.nullable(),
        milestone: z.enum(manualMilestones),
        decision: z.enum(["confirmed", "pending", "automatic"]),
        expected_event_id: uuid.nullable(),
        ...evidence,
      })
      .strict(),
    z
      .object({
        operation: z.literal("report"),
        request_key: uuid,
        run_id: uuid,
        decision: z.enum(["approved", "rejected"]),
        locale: z.enum(["es", "en"]),
        reason: z.string().trim().max(2000),
      })
      .strict(),
    z
      .object({
        operation: z.literal("closing"),
        request_key: uuid,
        process_id: uuid.nullable(),
        state: z.enum([
          "contract_sent",
          "contract_signed",
          "final_approval",
          "disbursed",
        ]),
        funded_amount: money.nullable(),
        lender_id: uuid.nullable(),
        ...evidence,
      })
      .strict(),
  ])
  .superRefine((p, ctx) => {
    if (p.operation !== "report" && !p.archive_message_id && !p.document_id)
      ctx.addIssue({
        code: "custom",
        message: "Selecciona un correo o documento del expediente.",
        path: ["document_id"],
      });
    if (
      p.operation === "lender" &&
      p.state === "offer" &&
      p.offered_amount === null
    )
      ctx.addIssue({
        code: "custom",
        message: "Registra el monto ofrecido.",
        path: ["offered_amount"],
      });
    if (
      p.operation === "lender" &&
      p.state === "agreed_amount" &&
      p.agreed_amount === null
    )
      ctx.addIssue({
        code: "custom",
        message: "Registra el monto final acordado.",
        path: ["agreed_amount"],
      });
    if (
      p.operation === "closing" &&
      p.state === "disbursed" &&
      (!p.funded_amount || !p.lender_id)
    )
      ctx.addIssue({
        code: "custom",
        message: "El desembolso requiere monto real y lender.",
        path: ["funded_amount"],
      });
  });
export type CaseFlowCommand = z.infer<typeof caseFlowCommandSchema>;
export type CaseFlowInput = CaseFlowCommand extends infer C
  ? C extends CaseFlowCommand
    ? Omit<C, "request_key">
    : never
  : never;
export interface FlowReport {
  id: string;
  opportunity_id: string;
  status: string;
  analysis_id: string | null;
  reviewed_at?: string | null;
  created_at?: string;
}
export interface FlowValue {
  milestone?: string;
  decision?: "confirmed" | "pending" | "automatic";
  lender_id?: string;
  conversation_id?: string | null;
}
export interface FlowSignal {
  approved: boolean;
  ready?: boolean;
  sent: number;
  manualSent: boolean | null;
}
export interface FlowEvent {
  id: string;
  opportunity_id: string;
  process_id: string | null;
  kind: string;
  occurred_at: string;
  created_at?: string;
  archive_message_id: string | null;
  document_id: string | null;
  body?: string;
  workflow_value?: FlowValue | null;
}
export interface FlowSnapshot {
  caseId: string;
  processId: string | null;
  canManage: boolean;
  processes: {
    id: string;
    sequence_number: number;
    state: string;
    classification: string;
    is_unclassified_archive: boolean;
  }[];
  lenders: {
    id: string;
    name: string;
    submission_id: string | null;
    process_id: string | null;
    offered_amount: number | null;
    selected: boolean;
    requirements_state: "not_requested" | "pending" | "resolved";
    agreed_amount: number | null;
  }[];
  evidence: { id: string; type: "mail" | "document"; label: string }[];
  events: FlowEvent[];
}
export { canManageCaseFlow } from "../domain";
export function approvedReportIds(
  reports: FlowReport[],
  analyses: Pick<Analysis, "id" | "opportunity_id" | "is_current">[],
) {
  const current = new Map(
    analyses
      .filter((a) => a.is_current !== false)
      .map((a) => [a.id, a.opportunity_id]),
  );
  return new Set(
    reports
      .filter(
        (r) =>
          r.status === "approved" &&
          !!r.analysis_id &&
          current.get(r.analysis_id) === r.opportunity_id,
      )
      .map((r) => r.id),
  );
}
export function latestConfirmation(
  events: FlowEvent[],
  caseId: string,
  milestone: string,
  processId: string | null,
) {
  const financial = [
    "submissions",
    "contract-sent",
    "contract-signed",
    "final-approval",
  ].includes(milestone);
  return events
    .filter(
      (e) =>
        e.opportunity_id === caseId &&
        e.kind === "workflow_confirmation" &&
        e.workflow_value?.milestone === milestone &&
        e.process_id === (financial ? processId : null) &&
        !!(e.archive_message_id || e.document_id),
    )
    .sort(
      (a, b) =>
        Date.parse(b.created_at || b.occurred_at) -
          Date.parse(a.created_at || a.occurred_at) || b.id.localeCompare(a.id),
    )[0];
}

/** Exact recipients / explicit evaluation links only. Queued and uncertain are never delivery proof. */
export function confirmedLenderSends(
  input: {
    opportunity: Pick<Opportunity, "id" | "funded_at">;
    process?: { id: string; started_at?: string };
    reports: FlowReport[];
    analyses: Pick<Analysis, "id" | "opportunity_id" | "is_current">[];
    conversations: Pick<
      Conversation,
      | "id"
      | "opportunity_id"
      | "process_id"
      | "submission_id"
      | "recipient_email"
    >[];
    messages: Pick<
      Message,
      | "id"
      | "conversation_id"
      | "direction"
      | "status"
      | "sent_at"
      | "participants"
    >[];
    submissions: {
      id: string;
      opportunity_id: string;
      process_id?: string | null;
      lender_id: string;
    }[];
    lenders: { id: string; email: string }[];
    lender_contacts?: { lender_id: string; email: string }[];
    events?: FlowEvent[];
  },
  now = Date.now(),
) {
  const approved = approvedReportIds(input.reports, input.analyses);
  const reviewedAt = Math.max(
    0,
    ...input.reports
      .filter((r) => approved.has(r.id))
      .map((r) => Date.parse(r.reviewed_at || r.created_at || "") || 0),
  );
  const cutoff = input.process
    ? Date.parse(input.process.started_at || "") || 0
    : Math.max(reviewedAt, Date.parse(input.opportunity.funded_at || "") || 0);
  if (!input.process && !reviewedAt) return [];
  const byAddress = new Map<string, Set<string>>();
  for (const l of [
    ...input.lenders.map((l) => ({ lender_id: l.id, email: l.email })),
    ...(input.lender_contacts || []),
  ]) {
    const address = l.email.trim().toLowerCase();
    if (address)
      byAddress.set(
        address,
        new Set([...(byAddress.get(address) || []), l.lender_id]),
      );
  }
  const conversations = new Map(
    input.conversations
      .filter((c) => c.opportunity_id === input.opportunity.id)
      .map((c) => [c.id, c]),
  );
  const submissions = new Map(
    input.submissions
      .filter((s) => s.opportunity_id === input.opportunity.id)
      .map((s) => [s.id, s]),
  );
  const bindings = (input.events || []).filter(
    (e) =>
      e.opportunity_id === input.opportunity.id &&
      e.process_id === input.process?.id &&
      e.workflow_value?.conversation_id &&
      e.workflow_value.lender_id,
  );
  const result: { message_id: string; lender_id: string }[] = [];
  for (const m of input.messages) {
    const c = conversations.get(m.conversation_id),
      at = Date.parse(m.sent_at);
    if (
      !c ||
      m.direction !== "outbound" ||
      m.status !== "sent" ||
      !Number.isFinite(at) ||
      at < cutoff ||
      at > now
    )
      continue;
    const submission = c.submission_id
      ? submissions.get(c.submission_id)
      : undefined;
    const bound = bindings.filter(
      (e) => e.workflow_value?.conversation_id === c.id,
    );
    if (
      input.process &&
      !bound.length &&
      ((c.process_id && c.process_id !== input.process.id) ||
        (submission?.process_id && submission.process_id !== input.process.id))
    )
      continue;
    const ids = new Set<string>();
    const recipients = (m.participants || [])
      .filter((p) => ["to", "cc", "bcc"].includes(p.role))
      .map((p) => p.email.toLowerCase());
    if (!recipients.length && c.recipient_email)
      recipients.push(c.recipient_email.toLowerCase());
    for (const email of recipients) {
      const known = byAddress.get(email);
      if (known?.size === 1) ids.add([...known][0]);
    }
    if (
      !recipients.length &&
      submission &&
      (!input.process || submission.process_id === input.process.id)
    )
      ids.add(submission.lender_id);
    for (const lender_id of ids) result.push({ message_id: m.id, lender_id });
  }
  return result;
}
