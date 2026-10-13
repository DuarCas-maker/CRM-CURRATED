import { z } from "zod";

export const candidateKinds = [
  "all",
  "client",
  "lender",
  "broker",
  "team",
  "other",
  "unknown",
] as const;
export const candidateClassifications = [
  "all",
  "active",
  "inactive",
  "unknown",
] as const;
export const candidateImportStates = [
  "all",
  "pending",
  "selected",
  "queued",
  "imported",
  "errors",
] as const;
export const candidateMatchStates = ["all", "existing", "new"] as const;
const schema = z.object({
  q: z.string().trim().max(200).default(""),
  kind: z.enum(candidateKinds).default("all"),
  classification: z.enum(candidateClassifications).default("all"),
  import_state: z.enum(candidateImportStates).default("all"),
  match: z.enum(candidateMatchStates).default("all"),
});
export type CandidateFilters = z.infer<typeof schema>;
export const defaultCandidateFilters: CandidateFilters = {
  q: "",
  kind: "all",
  classification: "all",
  import_state: "all",
  match: "all",
};
export function parseCandidateFilters(params: URLSearchParams) {
  return schema.parse(
    Object.fromEntries(
      Object.keys(defaultCandidateFilters).map((key) => [
        key,
        params.get(key) ?? undefined,
      ]),
    ),
  );
}
export function candidateSearchPattern(value: string) {
  return `%${value
    .replace(/\\/g, "\\\\")
    .replace(/[%_]/g, "\\$&")
    .replace(/\*/g, " ")
    .replace(/[\u0000-\u001f]/g, " ")}%`;
}
type CandidateQuery<Query> = {
  eq(column: string, value: string | boolean): Query;
  is(column: string, value: null): Query;
  not(column: string, operator: string, value: null): Query;
  or(filters: string): Query;
};
export function filterGmailCandidates<Query extends CandidateQuery<Query>>(
  query: Query,
  filters: CandidateFilters,
): Query {
  let result = query;
  if (filters.q) {
    // Quote PostgREST reserved characters, then let the SDK encode the URL.
    const pattern = candidateSearchPattern(filters.q)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    result = result.or(
      ["name", "email", "company_name"]
        .map((column) => `${column}.ilike."${pattern}"`)
        .join(","),
    );
  }
  if (filters.kind !== "all")
    result = result.eq("participant_kind", filters.kind);
  if (filters.classification !== "all")
    result = result.eq("classification", filters.classification);
  if (
    filters.import_state === "pending" ||
    filters.import_state === "selected"
  ) {
    result = result.is("imported_at", null).is("import_requested_at", null);
    if (filters.import_state === "selected")
      result = result.eq("selected", true);
  }
  if (filters.import_state === "queued")
    result = result
      .is("imported_at", null)
      .not("import_requested_at", "is", null);
  if (filters.import_state === "imported")
    result = result.not("imported_at", "is", null);
  if (filters.import_state === "errors")
    result = result.not("last_error", "is", null);
  if (filters.match === "existing")
    result = result.not("existing_contact_id", "is", null);
  if (filters.match === "new") result = result.is("existing_contact_id", null);
  return result;
}
