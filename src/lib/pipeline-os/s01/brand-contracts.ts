// I01 data contracts only. These types grant no case, sender or brand access.
export const brandReviewStatuses = [
  "pending",
  "confirmed",
  "conflict",
  "discarded",
] as const;

export type BrandReviewStatus = (typeof brandReviewStatuses)[number];
export type BrandRevision = number; // Safe integers; PostgreSQL uses bigint.

export interface OperatingBrand {
  id: string;
  code: string;
  name: string;
  active: boolean;
  revision: BrandRevision;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

export interface OperatingBrandMembership {
  brand_id: string;
  user_id: string;
  active: boolean;
  revision: BrandRevision;
  assigned_by: string;
  assigned_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
}

export interface BrandCreateInput {
  code: string;
  name: string;
  active: boolean;
}

export interface BrandMembershipInput {
  brand_id: string;
  user_id: string;
  active: boolean;
  expected_revision: BrandRevision;
}

export interface BrandReviewInput {
  account_id: string;
  proposed_brand_id: string | null;
  status: BrandReviewStatus;
  revision: BrandRevision;
  expected_account_revision: BrandRevision;
  evidence_reference: string | null;
  request_key: string;
  history_approved: boolean;
  history_from: string | null;
  history_to: string | null;
}

export interface MailAccountBrandReview extends BrandReviewInput {
  id: string;
  created_by: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface BrandInputIssue {
  field: string;
  code: "invalid_input" | "stale_revision";
}

export type BrandInputResult<T> =
  { ok: true; value: T } | { ok: false; issues: BrandInputIssue[] };
