import type { Lead } from "./domain";
import { getLeadTab, type LeadTab } from "./lead-tabs";

export type LeadSection = LeadTab | "verifications" | "imports";
export interface VerificationBatch {
  id: string;
  started_at: string;
  completed_at: string | null;
  total: number;
  completed: number;
  pending: number;
  errors: number;
  review: number;
  valid: number;
  invalid: number;
  uncertain: number;
}
export interface LeadPreparationOverview {
  counts: Record<LeadTab, number>;
  verification_total: number;
  imports_total: number;
  verifications: VerificationBatch[];
}
export function countLeadTabs(leads: Lead[]): Record<LeadTab, number> {
  const counts = { preparing: 0, converted: 0, risk: 0 };
  for (const lead of leads) counts[getLeadTab(lead)]++;
  return counts;
}
export function verificationProgress(batch: VerificationBatch) {
  return batch.total
    ? Math.min(100, Math.round((batch.completed / batch.total) * 100))
    : 0;
}
export function verificationBatchStatus(batch: VerificationBatch) {
  if (batch.completed === batch.total && batch.total > 0) return "completed";
  if (batch.errors || batch.review) return "review";
  return "running";
}
