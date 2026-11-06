import { z } from "zod";
import {
  brandReviewStatuses,
  type BrandCreateInput,
  type BrandInputResult,
  type BrandMembershipInput,
  type BrandReviewInput,
} from "./brand-contracts";

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveRevision = revision.min(1);
const reference = z
  .string()
  .trim()
  .min(1)
  .refine((value) => [...value].length <= 120);
const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());

const createSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/),
  name: reference,
  active: z.boolean().default(false),
});

const membershipSchema = z.strictObject({
  brand_id: z.uuid(),
  user_id: z.uuid(),
  active: z.boolean(),
  expected_revision: revision,
});

const reviewSchema = z
  .strictObject({
    account_id: z.uuid(),
    proposed_brand_id: z.uuid().nullable(),
    status: z.enum(brandReviewStatuses).default("pending"),
    revision: positiveRevision.default(1),
    expected_account_revision: revision,
    evidence_reference: reference.nullable().default(null),
    request_key: z.uuid(),
    history_approved: z.boolean().default(false),
    history_from: instant.nullable().default(null),
    history_to: instant.nullable().default(null),
  })
  .superRefine((input, context) => {
    function invalid(field: keyof BrandReviewInput) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: "Invalid input",
      });
    }
    if (input.status === "confirmed") {
      if (input.proposed_brand_id === null) invalid("proposed_brand_id");
      if (input.evidence_reference === null) invalid("evidence_reference");
    }
    const from = input.history_from;
    const to = input.history_to;
    if ((from === null) !== (to === null)) invalid("history_from");
    if (from !== null && to !== null && Date.parse(from) >= Date.parse(to))
      invalid("history_to");
    if (input.history_approved) {
      if (from === null || to === null) invalid("history_from");
      if (input.evidence_reference === null) invalid("evidence_reference");
    }
  });

function parse<T>(schema: z.ZodType<T>, input: unknown): BrandInputResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  // Never return Zod messages, unknown keys or offending values from input.
  const fields = new Set(
    result.error.issues.map((issue) => String(issue.path[0] ?? "input")),
  );
  return {
    ok: false,
    issues: [...fields].map((field) => ({ field, code: "invalid_input" })),
  };
}

export function parseBrandCreateInput(
  input: unknown,
): BrandInputResult<BrandCreateInput> {
  return parse(createSchema, input);
}

export function parseBrandMembershipInput(
  input: unknown,
): BrandInputResult<BrandMembershipInput> {
  return parse(membershipSchema, input);
}

export function parseBrandReviewInput(
  input: unknown,
): BrandInputResult<BrandReviewInput> {
  return parse(reviewSchema, input);
}

// A deterministic stale-input check, not an authorization or atomic DB update.
export function validateExpectedAccountRevision(
  expected: unknown,
  current: unknown,
): BrandInputResult<{ expected_account_revision: number }> {
  const proposed = revision.safeParse(expected);
  const actual = revision.safeParse(current);
  if (!proposed.success || !actual.success)
    return {
      ok: false,
      issues: [{ field: "expected_account_revision", code: "invalid_input" }],
    };
  if (proposed.data !== actual.data)
    return {
      ok: false,
      issues: [{ field: "expected_account_revision", code: "stale_revision" }],
    };
  return { ok: true, value: { expected_account_revision: proposed.data } };
}
