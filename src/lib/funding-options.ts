import { z } from "zod";
import { normalizeEmail, validEmail } from "./domain";

const fundingOption = (months: number) =>
  z
    .object({
      months: z.literal(months),
      multiplier: z.number().min(0.01).max(100).multipleOf(0.01),
      factor: z.number().min(1).max(5).multipleOf(0.01),
      weeks: z.number().int().min(1).max(520),
    })
    .strict();
export const fundingModelSchema = z
  .object({
    version: z.literal(1),
    options: z.tuple([fundingOption(6), fundingOption(9), fundingOption(12)]),
  })
  .strict();
export type FundingOption = {
  months: number;
  multiplier: number;
  factor: number;
  weeks: number;
};
export type FundingModel = {
  version: 1;
  options: [FundingOption, FundingOption, FundingOption];
};
export const defaultFundingModel: FundingModel = {
  version: 1,
  options: [
    { months: 6, multiplier: 1, factor: 1.3, weeks: 26 },
    { months: 9, multiplier: 2, factor: 1.35, weeks: 39 },
    { months: 12, multiplier: 3, factor: 1.4, weeks: 52 },
  ],
};

// USD only. Do not silently reinterpret locale separators, ranges or formulas.
export function parseMonthlyIncome(value: unknown): number | null {
  const raw = String(value ?? "")
    .trim()
    .replace(/^USD\s*/i, "")
    .replace(/^\$\s*/, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw.replaceAll(",", ""));
  return Number.isFinite(n) && n > 0 && n <= 1_000_000_000 ? n : null;
}
const rounded = (n: bigint, d: bigint) => (n + d / 2n) / d;
const usd = (cents: bigint) =>
  "$" +
  (Number(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function fundingValues(
  model: unknown,
  income: unknown,
  senderEmail: string,
): Record<string, string> {
  const cfg = fundingModelSchema.parse(model);
  const monthly = parseMonthlyIncome(income);
  if (monthly === null)
    throw new Error("Falta un ingreso mensual USD válido para esta plantilla.");
  if (!/^[^\s<>?@]+@[^\s<>?@]+\.[^\s<>?@]+$/.test(senderEmail))
    throw new Error("Falta un remitente válido.");
  const cents = BigInt(Math.round(monthly * 100));
  const values: Record<string, string> = {
    monthly_income: usd(cents),
    sender_email: senderEmail,
  };
  for (const option of cfg.options) {
    const amount = rounded(
      cents * BigInt(Math.round(option.multiplier * 100)),
      100n,
    );
    const total = rounded(
      amount * BigInt(Math.round(option.factor * 100)),
      100n,
    );
    values[`funding_amount_${option.months}`] = usd(amount);
    values[`funding_payment_${option.months}`] = usd(
      rounded(total, BigInt(option.weeks)),
    );
    values[`funding_weeks_${option.months}`] = String(option.weeks);
  }
  return values;
}
export function withFundingValues(
  values: Record<string, string>,
  model: unknown,
  income: unknown,
  senderEmail: string,
) {
  return model
    ? { ...values, ...fundingValues(model, income, senderEmail) }
    : values;
}

export function groupIncomeRows(rows: { email: string; income: unknown }[]) {
  const grouped = new Map<string, Set<number>>();
  let invalid = 0;
  for (const row of rows) {
    const income = parseMonthlyIncome(row.income);
    if (income === null) {
      invalid++;
      continue;
    }
    const email = normalizeEmail(row.email);
    if (!validEmail(email)) {
      invalid++;
      continue;
    }
    const amounts = grouped.get(email) ?? new Set<number>();
    amounts.add(income);
    grouped.set(email, amounts);
  }
  const accepted: { email: string; monthly_income: number }[] = [];
  const conflicts: string[] = [];
  for (const [email, amounts] of grouped) {
    if (amounts.size !== 1) conflicts.push(email);
    else accepted.push({ email, monthly_income: [...amounts][0] });
  }
  return { accepted, conflicts, invalid };
}
