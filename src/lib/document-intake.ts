import { z } from "zod";
import type { Document } from "./domain";
export const intakeKindSchema = z.enum([
  "bank_statement",
  "application",
  "additional",
]);
export type IntakeKind = z.infer<typeof intakeKindSchema>;
export const documentSuggestionSchema = z.object({
  kind: z.enum(["bank_statement", "application", "additional", "unknown"]),
  name: z.string().max(200),
  confidence: z.enum(["high", "medium", "low"]),
  reason_es: z.string().max(400),
  reason_en: z.string().max(400),
});
export const receiveDocumentSchema = z
  .object({
    opportunity_id: z.uuid(),
    source: z.enum(["saved", "legacy", "upload"]),
    source_id: z.uuid(),
    kind: intakeKindSchema,
    bank_name: z.string().trim().max(120).default(""),
    name: z.string().trim().max(200).default(""),
    expected_source_hash: z.string().regex(/^[a-f0-9]{64}$/),
    approve: z.boolean().default(false),
    confirmed: z.boolean().default(false),
    replace_document_id: z.uuid().nullable().default(null),
    expected_target_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
  })
  .refine((p) => p.kind !== "bank_statement" || !!p.bank_name, {
    message: "Indica el banco / Enter the bank",
  })
  .refine((p) => p.kind !== "additional" || !!p.name, {
    message: "Indica el nombre del documento / Enter a document name",
  })
  .refine((p) => !p.approve || p.confirmed, {
    message:
      "Confirma que revisaste el archivo / Confirm you reviewed the file",
  });
export function hasDocumentFile(document: Document) {
  return !!document.storage_path;
}
export function intakeDestination(
  documents: Document[],
  kind: IntakeKind,
  bank = "",
) {
  const key = (value = "") => value.trim().toLowerCase();
  const empty = documents
    .filter((d) => d.kind === kind && !d.storage_path && !d.content_hash)
    .sort(
      (a, b) =>
        (a.statement_number || 0) - (b.statement_number || 0) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
  if (kind !== "bank_statement")
    return {
      document: kind === "application" ? empty[0] : undefined,
      number: null,
    };
  const sameBank = documents.filter(
    (d) => d.kind === kind && key(d.bank_name) === key(bank),
  );
  const matching = empty.find((d) => key(d.bank_name) === key(bank));
  return {
    document: matching || empty.find((d) => !key(d.bank_name)),
    number:
      matching?.statement_number ||
      Math.max(0, ...sameBank.map((d) => d.statement_number || 0)) + 1,
  };
}
export function suggestBankFromFilename(
  filename: string,
  documents: Document[],
) {
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const banks = [
    ...new Set(
      documents
        .filter((d) => d.kind === "bank_statement" && hasDocumentFile(d))
        .map((d) => d.bank_name?.trim())
        .filter((v): v is string => !!v),
    ),
  ];
  const normalized = ` ${normalize(filename)} `;
  const aliases: [string, string[]][] = [
    ["BMO", ["bmo"]],
    ["Texas First Bank", ["texas first", "tx first"]],
    ["Chase", ["chase"]],
    ["Bank of America", ["bank of america", "bofa"]],
    ["Wells Fargo", ["wells fargo"]],
    ["Capital One", ["capital one"]],
    ["Citibank", ["citibank"]],
    ["Truist", ["truist"]],
    ["U.S. Bank", ["us bank", "u s bank"]],
    ["PNC", ["pnc"]],
    ["TD Bank", ["td bank"]],
  ];
  const matches = new Set(
    banks.filter((b) => normalized.includes(` ${normalize(b)} `)),
  );
  for (const [bank, names] of aliases)
    if (names.some((name) => normalized.includes(` ${name} `)))
      matches.add(banks.find((b) => normalize(b) === normalize(bank)) || bank);
  if (matches.size === 1)
    return { bank: [...matches][0], source: "filename" as const };
  if (matches.size === 0 && banks.length === 1)
    return { bank: banks[0], source: "only_bank" as const };
  return { bank: "", source: null };
}
