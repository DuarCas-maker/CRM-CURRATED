import { z } from "zod";
import {
  adultBirthDate,
  entityTypes,
  formatTaxId,
  secondOwnerAnswer,
  usStates,
  type CompanyApplication,
} from "./company-application";

const business = [
  "legal_name",
  "entity_type",
  "ein",
  "incorporation_state",
  "inception_date",
  "business_address",
  "business_city",
  "business_state",
  "business_zip",
] as const;
const owner = [
  "name",
  "email",
  "ssn",
  "date_of_birth",
  "phone",
  "address",
  "city",
  "state",
  "zip",
  "ownership",
] as const;
export const extractionFields = [
  ...business,
  ...owner.map((k) => `owners.0.${k}` as const),
  ...owner.map((k) => `owners.1.${k}` as const),
  "second_owner",
] as const;
export type ExtractionField = (typeof extractionFields)[number];
export const extractionSchema = z.object({
  fields: z
    .array(
      z.object({
        field: z.enum(extractionFields),
        value: z.string().max(250).nullable(),
        status: z.enum(["found", "not_found", "needs_review", "conflict"]),
        evidence: z
          .array(
            z.object({
              source: z.enum(["document_1", "document_2", "user"]),
              page: z.number().int().min(1).nullable(),
              quote: z.string().max(300),
            }),
          )
          .max(4),
      }),
    )
    .length(extractionFields.length),
});
export type ExtractionItem = z.infer<typeof extractionSchema>["fields"][number];
export type ExtractionNotice = ExtractionItem & {
  reason: "missing" | "review" | "conflict" | "different" | "invalid";
};

export function normalizeExtractionValue(
  field: ExtractionField,
  value: string | null,
): string | number | null {
  if (!value || /^(not found|unknown|null|n\/a)$/i.test(value.trim()))
    return null;
  value = value.trim();
  if (field === "second_owner")
    return ["yes", "no"].includes(value.toLowerCase())
      ? value.toLowerCase()
      : null;
  if (field === "ein" || field.endsWith(".ssn")) {
    // Never repair a masked or incomplete identifier by removing arbitrary characters.
    if (!/^[\d -]+$/.test(value) || value.replace(/\D/g, "").length !== 9)
      return null;
    return formatTaxId(value, field === "ein" ? "ein" : "ssn");
  }
  if (field === "inception_date" || field.endsWith(".date_of_birth")) {
    const match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value);
    const iso = match ? `${match[3]}-${match[1]}-${match[2]}` : value;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
      Number.isNaN(Date.parse(iso)) ||
      new Date(iso).toISOString().slice(0, 10) !== iso ||
      iso > new Date().toISOString().slice(0, 10)
    )
      return null;
    if (field.endsWith(".date_of_birth") && iso > adultBirthDate()) return null;
    return iso;
  }
  if (field.endsWith(".ownership")) {
    if (!/^\d+(\.\d+)?%?$/.test(value)) return null;
    const number = Number(value.replace("%", ""));
    return number >= 0 && number <= 100 ? number : null;
  }
  if (field.endsWith(".email") && !z.email().safeParse(value).success)
    return null;
  if (field === "entity_type")
    return (
      entityTypes.find((e) => e.toLowerCase() === value.toLowerCase()) || null
    );
  if (
    ["incorporation_state", "business_state"].includes(field) ||
    field.endsWith(".state")
  )
    return (
      usStates.find(
        ([code, name]) =>
          code.toLowerCase() === value.toLowerCase() ||
          name.toLowerCase() === value.toLowerCase(),
      )?.[0] || null
    );
  return value;
}
export function applicationFieldValue(
  data: CompanyApplication,
  field: ExtractionField,
): string | number {
  if (field === "second_owner")
    return secondOwnerAnswer(data) === "unknown" ? "" : secondOwnerAnswer(data);
  if (field.startsWith("owners.")) {
    const [, index, key] = field.split(".");
    return (
      data.owners[Number(index)]?.[key as keyof (typeof data.owners)[number]] ??
      ""
    );
  }
  return data[field as (typeof business)[number]];
}
export function setApplicationField(
  data: CompanyApplication,
  field: ExtractionField,
  value: string | number,
): CompanyApplication {
  const next = structuredClone(data);
  if (field.startsWith("owners.")) {
    const [, index, key] = field.split(".");
    if (!next.owners[Number(index)]) return next;
    Object.assign(next.owners[Number(index)], { [key]: value });
  } else if (field === "second_owner") {
    next.second_owner = value as "yes" | "no";
    if (value === "yes" && next.owners.length === 1)
      next.owners.push({
        name: "",
        email: "",
        ssn: "",
        date_of_birth: "",
        phone: "",
        address: "",
        city: "",
        state: "",
        zip: "",
        ownership: "",
      });
    // Never erase an existing second owner's data based on extraction.
    if (value === "no" && next.owners.length === 2) return data;
  } else Object.assign(next, { [field]: value });
  return next;
}
export function mergeApplicationExtraction(
  data: CompanyApplication,
  items: ExtractionItem[],
) {
  let next = structuredClone(data);
  const notices: ExtractionNotice[] = [];
  const ordered = [...items].sort(
    (a, b) =>
      Number(b.field === "second_owner") - Number(a.field === "second_owner"),
  );
  for (const item of ordered) {
    const normalized = normalizeExtractionValue(item.field, item.value);
    const old = applicationFieldValue(next, item.field);
    if (item.status === "not_found" || !item.evidence.length) {
      if (old === "" && !item.field.startsWith("owners.1."))
        notices.push({ ...item, reason: "missing" });
      continue;
    }
    if (item.status === "conflict") {
      notices.push({ ...item, reason: "conflict" });
      continue;
    }
    if (normalized === null) {
      notices.push({ ...item, reason: "invalid" });
      continue;
    }
    if (old !== "") {
      if (
        String(old).trim().toLowerCase() !==
        String(normalized).trim().toLowerCase()
      )
        notices.push({ ...item, reason: "different" });
      continue;
    }
    if (
      item.status === "needs_review" ||
      (item.field.startsWith("owners.1.") && next.owners.length === 1)
    ) {
      notices.push({ ...item, reason: "review" });
      continue;
    }
    if (
      item.field.endsWith(".ownership") &&
      next.owners.reduce((sum, o) => sum + Number(o.ownership), 0) +
        Number(normalized) >
        100
    ) {
      notices.push({ ...item, reason: "conflict" });
      continue;
    }
    next = setApplicationField(next, item.field, normalized);
  }
  return { data: next, notices };
}
