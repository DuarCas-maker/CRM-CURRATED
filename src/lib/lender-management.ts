import { z } from "zod";
import { lenderDirectorySchema } from "./lender-directory";
export const lenderGuidelinesSchema = z
  .object({
    tier: z.enum(["1", "2", "3", "4", "5", "6", "reverse", "unknown"]),
    min_credit: z.number().int().min(300).max(850).nullable(),
    min_months_in_business: z.number().int().min(0).max(1200).nullable(),
    max_positions: z.number().int().min(0).max(100).nullable(),
    industries: z.array(z.string().trim().min(1).max(100)).max(50),
    excluded_industries: z.array(z.string().trim().min(1).max(100)).max(50),
    accepts_defaults: z.boolean().nullable(),
    accepts_non_us_citizens: z.boolean().nullable(),
    reverse: z.boolean().nullable(),
    notes: z.string().max(10000),
    source: z.string().trim().max(1000),
    as_of: z.iso.date().nullable(),
    verified: z.boolean(),
  })
  .superRefine((g, ctx) => {
    if (g.verified && (!g.source || !g.as_of))
      ctx.addIssue({
        code: "custom",
        message: "Para confirmar guidelines indica fuente y fecha.",
      });
  });
export type LenderGuidelines = z.infer<typeof lenderGuidelinesSchema>;
export const emptyLenderGuidelines: LenderGuidelines = {
  tier: "unknown",
  min_credit: null,
  min_months_in_business: null,
  max_positions: null,
  industries: [],
  excluded_industries: [],
  accepts_defaults: null,
  accepts_non_us_citizens: null,
  reverse: null,
  notes: "",
  source: "",
  as_of: null,
  verified: false,
};
export const lenderImportRowSchema = z
  .object({
    company: z.string().trim().min(1).max(200),
    email: z.string().trim().toLowerCase().max(254).default(""),
    contact: z.string().trim().max(200).default(""),
    channel: z.enum(["email", "portal"]).default("email"),
    portal_url: z.string().trim().max(1000).default(""),
    products: z.string().max(2000).default(""),
    notes: z.string().max(10000).default(""),
  })
  .superRefine((r, ctx) => {
    const parsed = lenderDirectorySchema.safeParse({ ...r, name: r.company });
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({ code: "custom", message: issue.message });
  });
export type LenderImportRow = z.infer<typeof lenderImportRowSchema>;
export function planLenderImport(
  rows: LenderImportRow[],
  lenders: { id: string; name: string }[],
  contacts: { lender_id: string; email: string }[],
) {
  const companies = new Map<string, string>();
  const errors: { row: number; message: string }[] = [],
    duplicates: number[] = [];
  let newContacts = 0;
  const seen = new Map<string, string>();
  rows.forEach((row, i) => {
    const key = row.company.trim().toLowerCase(),
      matches = lenders.filter((l) => l.name.trim().toLowerCase() === key);
    if (matches.length > 1)
      errors.push({
        row: i + 1,
        message: "Nombre de empresa ambiguo; corrige el directorio.",
      });
    const owner = contacts.find(
      (c) => c.email.toLowerCase() === row.email.toLowerCase(),
    );
    if (row.email && owner && owner.lender_id !== matches[0]?.id)
      errors.push({
        row: i + 1,
        message: "El correo pertenece a otra empresa.",
      });
    if (row.email && seen.has(row.email) && seen.get(row.email) !== key)
      errors.push({
        row: i + 1,
        message: "El archivo asigna el mismo correo a dos empresas.",
      });
    if (row.email && seen.get(row.email) === key) duplicates.push(i + 1);
    else if (row.email && !owner) newContacts++;
    if (row.email) seen.set(row.email, key);
    companies.set(key, matches[0]?.id || "");
  });
  return {
    companies: companies.size,
    new_companies: [...companies.values()].filter((v) => !v).length,
    existing_companies: [...companies.values()].filter(Boolean).length,
    new_contacts: newContacts,
    duplicate_rows: duplicates.length,
    errors,
  };
}
