import type { Lead, Verification } from "./domain";

export const leadTabs = ["preparing", "converted", "risk"] as const;
export type LeadTab = (typeof leadTabs)[number];

export const leadTabVerifications: Record<LeadTab, readonly Verification[]> = {
  preparing: ["pending", "valid"],
  converted: ["pending", "valid"],
  risk: ["invalid", "uncertain"],
};

export function parseLeadTab(value: string | null): LeadTab {
  return leadTabs.find((tab) => tab === value) || "preparing";
}

export function getLeadTab(
  lead: Pick<Lead, "verification" | "opportunity_id">,
): LeadTab {
  if (leadTabVerifications.risk.includes(lead.verification)) return "risk";
  return lead.opportunity_id === null ? "preparing" : "converted";
}

type LeadTabQuery<Query> = {
  in(column: string, values: readonly Verification[]): Query;
  is(column: string, value: null): Query;
  not(column: string, operator: string, value: null): Query;
};

export function filterLeadTab<Query extends LeadTabQuery<Query>>(
  query: Query,
  tab: LeadTab,
): Query {
  const filtered = query.in("verification", leadTabVerifications[tab]);
  if (tab === "risk") return filtered;
  return tab === "converted"
    ? filtered.not("opportunity_id", "is", null)
    : filtered.is("opportunity_id", null);
}
