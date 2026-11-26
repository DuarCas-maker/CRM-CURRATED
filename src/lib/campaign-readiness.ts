import { z } from "zod";
import type { Locale } from "./domain";
export const incomeFilterSchema = z.enum(["all", "with", "without"]);
export type IncomeFilter = z.infer<typeof incomeFilterSchema>;
export type IncomeCounts = { with_income: number; without_income: number };
export type IncomeSummary = { all: IncomeCounts; available: IncomeCounts };
export interface TemplateReadiness {
  template_version: number;
  checked_count: number;
  ready_count: number;
  attention_count: number;
  rows: {
    contact_id: string;
    name: string;
    email: string;
    company: string;
    monthly_income: number | null;
    ready: boolean;
    reason: string;
    missing_fields: string[];
  }[];
}
export function incomeLabel(value: number | null | undefined, locale: Locale) {
  if (value === undefined)
    return locale === "es" ? "Ingreso sin consultar" : "Income not loaded";
  if (value === null || value <= 0)
    return locale === "es" ? "Sin ingreso mensual" : "Monthly income missing";
  return (
    (locale === "es" ? "Ingreso mensual: " : "Monthly income: ") +
    Number(value).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    })
  );
}
export function missingFieldLabel(field: string, locale: Locale) {
  const names: Record<string, [string, string]> = {
    monthly_income: ["Ingreso mensual", "Monthly income"],
    name: ["Nombre del contacto", "Contact name"],
    company: ["Empresa", "Company"],
    amount: ["Monto solicitado", "Requested amount"],
    phone: ["Teléfono", "Phone"],
    industry: ["Industria", "Industry"],
  };
  return names[field]?.[locale === "es" ? 0 : 1] || field;
}
