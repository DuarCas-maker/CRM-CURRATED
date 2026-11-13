import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
export const mailProposalSchema = z.strictObject({
  kind: z.enum(["offer", "requirement", "unknown"]),
  amount: z.number().positive().max(1e12).nullable(),
  product: text(100),
  term: text(1000),
  cost: text(1000),
  frequency: text(1000),
  fees: text(1000),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
  requirement: text(3000),
  summary: text(2000),
  task_title: text(300),
  evidence: z
    .array(z.strictObject({ field: text(50), quote: text(500).min(1) }))
    .max(20),
});
export type MailProposal = z.infer<typeof mailProposalSchema>;
export const mailApprovalSchema = mailProposalSchema
  .omit({ evidence: true })
  .extend({
    kind: z.enum(["offer", "requirement"]),
    summary: text(2000).min(1),
    task_title: text(300).min(1),
    owner_id: z.uuid(),
    due_at: z.iso.datetime({ offset: true }),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "offer" && (!v.amount || !v.product))
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message:
          "Indica producto e importe positivo / Enter product and positive amount",
      });
    if (
      v.kind === "offer" &&
      v.amount !== null &&
      Math.abs(v.amount * 100 - Math.round(v.amount * 100)) > 0.001
    )
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message:
          "Usa como máximo dos decimales / Use at most two decimal places",
      });
    if (v.kind === "requirement" && !v.requirement)
      ctx.addIssue({
        code: "custom",
        path: ["requirement"],
        message: "Indica el requisito / Enter the requirement",
      });
  });
export type MailApproval = z.infer<typeof mailApprovalSchema>;
export const mailReviewCommand = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("analyze"),
    message_id: z.uuid(),
    process_id: z.uuid(),
    submission_id: z.uuid(),
    request_key: z.uuid(),
    retry: z.boolean().default(false),
    revision: z.number().int().positive().optional(),
  }),
  z.strictObject({
    operation: z.literal("approve"),
    review_id: z.uuid(),
    revision: z.number().int().positive(),
    request_key: z.uuid(),
    value: mailApprovalSchema,
  }),
]);
export type MailReview = {
  id: string;
  message_id: string;
  opportunity_id: string;
  process_id: string;
  submission_id: string;
  revision: number;
  status: "analyzing" | "ready" | "failed" | "approved";
  proposal: MailProposal | null;
  approved_value: MailApproval | null;
  result: {
    offer_id: string | null;
    requirement_id: string | null;
    task_id: string;
    event_id: string;
  } | null;
  error_code: string | null;
};
export type MailReviewPage = {
  messages: {
    id: string;
    subject: string;
    sender: string;
    sent_at: string;
    body: string;
    process_id: string | null;
    submission_id: string | null;
    review: MailReview | null;
  }[];
  processes: { id: string; label: string }[];
  submissions: { id: string; process_id: string; lender_name: string }[];
  owners: { id: string; name: string }[];
  owner_id: string | null;
  next_cursor: string | null;
};

/** Only literal evidence from the text actually supplied is retained. No inferred amount is auto-approved. */
export function verifyMailProposal(
  value: unknown,
  source: string,
): MailProposal {
  const p = mailProposalSchema.parse(value);
  p.evidence = p.evidence.filter((e) => source.includes(e.quote));
  if (!p.evidence.length) {
    p.kind = "unknown";
    p.amount = null;
  }
  if (
    p.amount !== null &&
    !p.evidence.some(
      (e) => e.field === "amount" && quotedAmounts(e.quote).includes(p.amount!),
    )
  )
    p.amount = null;
  return p;
}
function quotedAmounts(quote: string) {
  const values: number[] = [];
  const bare = quote.trim();
  if (/^\d[\d,]*(?:\.\d{1,2})?$/.test(bare))
    values.push(Number(bare.replaceAll(",", "")));
  for (const m of quote.matchAll(
    /(?:USD|US\$|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*([kKmM])?|\b(\d+(?:\.\d{1,2})?)\s*([kKmM])\b/g,
  )) {
    const number = Number((m[1] || m[3]).replaceAll(",", ""));
    const unit = (m[2] || m[4] || "").toLowerCase();
    values.push(number * (unit === "k" ? 1000 : unit === "m" ? 1000000 : 1));
  }
  return values;
}
