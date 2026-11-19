import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HttpError } from "../../supabase";
import { brandAction, brandPage, BrandError } from "../../brand-actions";
import type { BrandCollection, BrandRow } from "../../../brand-management";
import { stepKey } from "./service";
import type { MailConnectionInput } from "../../../mail-connections";

const accountSchema = z.object({
  id: z.uuid(),
  organization: z.string(),
  status: z.string(),
  operating_brand_id: z.uuid().nullable(),
  brand_revision: z.number().int().nonnegative(),
});
const brandSchema = z.object({ id: z.uuid() });
const reviewSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  status: z.string(),
  proposed_brand_id: z.uuid().nullable(),
  expected_account_revision: z.number().int().nonnegative(),
  evidence_reference: z.string().nullable(),
  history_approved: z.boolean(),
  history_from: z.string().nullable(),
  history_to: z.string().nullable(),
});
export type LegacyAccount = z.infer<typeof accountSchema>;
export type LegacyReview = z.infer<typeof reviewSchema>;
export type LegacyMailboxPorts = {
  account(email: string): Promise<LegacyAccount | null>;
  brand(): Promise<{ id: string } | null>;
  review(account: string): Promise<LegacyReview | null>;
  command(kind: string, payload: object, key: string): Promise<unknown>;
};
const resultSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  status: z.string(),
});
const reviewRequired = () =>
  new HttpError(409, "SIMPLE_LEGACY_REVIEW_REQUIRED");

// Keep the old account. Protected writes use the existing human commands,
// whose DB guards recheck MFA, impact, revisions and audited receipts.
export async function prepareLegacyMailbox(
  ports: LegacyMailboxPorts,
  input: MailConnectionInput,
  workspace: string,
) {
  const account = await ports.account(input.email);
  if (!account || account.operating_brand_id !== null) return;
  if (account.organization !== workspace || account.status !== "disconnected")
    throw reviewRequired();
  const brand = await ports.brand();
  if (!brand) throw new HttpError(503, "SIMPLE_NOT_CONFIGURED");
  let review = await ports.review(account.id);
  if (
    review &&
    (review.status !== "pending" ||
      review.history_approved ||
      review.history_from !== null ||
      review.history_to !== null ||
      (review.proposed_brand_id !== null &&
        review.proposed_brand_id !== brand.id) ||
      review.expected_account_revision !== account.brand_revision)
  )
    throw reviewRequired();
  try {
    if (!review || !review.proposed_brand_id || !review.evidence_reference) {
      const proposed = resultSchema.parse(
        await ports.command(
          "brand_mapping_propose",
          {
            account_id: account.id,
            proposed_brand_id: brand.id,
            evidence_reference: "simple-mail:" + input.idempotency_key,
            expected_account_revision: account.brand_revision,
            ...(review
              ? {
                  review_id: review.id,
                  expected_review_revision: review.revision,
                }
              : {}),
            history_approved: false,
            history_from: null,
            history_to: null,
          },
          stepKey(
            input.idempotency_key,
            "legacy-propose:" + account.id + ":" + account.brand_revision,
          ),
        ),
      );
      if (proposed.status !== "pending") throw reviewRequired();
      review = {
        ...proposed,
        proposed_brand_id: brand.id,
        expected_account_revision: account.brand_revision,
        evidence_reference: "simple-mail:" + input.idempotency_key,
        history_approved: false,
        history_from: null,
        history_to: null,
      };
    }
    const confirmed = resultSchema.parse(
      await ports.command(
        "brand_mapping_confirm",
        {
          review_id: review.id,
          expected_review_revision: review.revision,
          expected_account_revision: account.brand_revision,
          acknowledge_conflict: false,
        },
        stepKey(
          input.idempotency_key,
          "legacy-confirm:" + review.id + ":" + review.revision,
        ),
      ),
    );
    if (confirmed.status !== "confirmed") throw reviewRequired();
  } catch (e) {
    if (e instanceof BrandError) {
      if (e.code === "BRAND_FORBIDDEN")
        throw new HttpError(403, "SIMPLE_FORBIDDEN");
      if (e.code === "BRAND_UNAVAILABLE")
        throw new HttpError(503, "SIMPLE_UNAVAILABLE");
      throw reviewRequired();
    }
    throw e;
  }
}

export function legacyMailboxPorts(db: SupabaseClient): LegacyMailboxPorts {
  // Unbranded mail_accounts are intentionally hidden by table RLS. Use the
  // existing superadmin metadata RPC instead of bypassing RLS with service_role.
  const find = async (
    collection: BrandCollection,
    matches: (row: BrandRow) => boolean,
  ) => {
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      let result;
      try {
        result = await brandPage(db, collection, cursor, 100);
      } catch (error) {
        if (error instanceof BrandError && error.code === "BRAND_FORBIDDEN")
          throw new HttpError(403, "SIMPLE_FORBIDDEN");
        throw new HttpError(503, "SIMPLE_UNAVAILABLE");
      }
      const row = result.items.find(matches);
      if (row) return row;
      if (!result.next_cursor) return null;
      if (result.next_cursor === cursor)
        throw new HttpError(503, "SIMPLE_UNAVAILABLE");
      cursor = result.next_cursor;
    }
    throw new HttpError(503, "SIMPLE_UNAVAILABLE");
  };
  return {
    async account(email) {
      return accountSchema
        .nullable()
        .parse(await find("accounts", (row) => row.email === email));
    },
    async brand() {
      // Same explicit brand as simple_mail_begin; no brand inferred from a domain.
      return brandSchema
        .nullable()
        .parse(
          await find(
            "brands",
            (row) => row.code === "CURATED_FINANCIAL" && row.active === true,
          ),
        );
    },
    async review(account) {
      return reviewSchema
        .nullable()
        .parse(
          await find(
            "reviews",
            (row) =>
              row.account_id === account &&
              ["pending", "conflict"].includes(row.status ?? ""),
          ),
        );
    },
    command: (kind, payload, key) =>
      brandAction(db, "superadmin", kind, payload, key),
  };
}
