import { z } from "zod";
import type { Locale } from "./domain";
import type { UnderwritingDraft, UnderwritingRun } from "./underwriting";

const bilingual = z.object({
  es: z.string().max(1800),
  en: z.string().max(1800),
});
export const compactUnderwritingSchema = z.object({
  conclusion: bilingual,
  file: z.array(z.object({ label: bilingual, value: bilingual })).max(8),
  file_notes: bilingual,
  bank_details: z
    .array(
      z.object({
        document_id: z.string(),
        nsf_count: z.number().int().min(0).nullable(),
        exclusions: bilingual,
      }),
    )
    .max(24),
  bank_notes: z.array(bilingual).max(4),
  debts: z
    .array(
      z.object({
        name: z.string(),
        kind: z.enum([
          "mca",
          "term",
          "sba",
          "credit_line",
          "personal",
          "other",
          "unconfirmed",
        ]),
        payment_amount: z.number().min(0).nullable(),
        payment_frequency: z.enum([
          "daily",
          "weekly",
          "biweekly",
          "monthly",
          "variable",
          "unknown",
        ]),
        status: bilingual,
        notes: bilingual,
      }),
    )
    .max(40),
  debt_summary: bilingual,
  risks: z.array(bilingual).max(6),
  tier_sba: bilingual,
  lenders: z
    .array(
      z.object({
        lender_id: z.string(),
        name: z.string(),
        fit: z.enum(["best", "possible", "exclude"]),
        reason: bilingual,
        contact: z.string().nullable(),
      }),
    )
    .max(10),
  pitch: bilingual,
  pending: z.array(bilingual).max(8),
  crm_notes: bilingual,
});
export type CompactUnderwriting = z.infer<typeof compactUnderwritingSchema>;
export type CompactBlock =
  | { kind: "heading" | "paragraph" | "bullet"; text: string }
  | { kind: "table"; headers: string[]; rows: string[][]; widths: number[] };
export const COMPACT_UNDERWRITING_INSTRUCTIONS = `
PRESENTATION CONTRACT (overrides any older language or report-length instructions in the configured prompt):
Produce compact_report with equivalent Spanish (es) and English (en) text in EVERY bilingual field. Both versions must preserve exactly the same facts, figures, conditions, names and uncertainty. Do not translate proper names, account suffixes or lender contacts. The UI selects a language from this single analysis; never perform a second underwriting for translation.
Write like a concise underwriting memo, normally 500-700 words per language for four statements: start with a direct 2-3 sentence advisory conclusion; a short business/application file; a bank snapshot; debt and positions; 3-6 material risks; conditional tier/SBA view; a short realistically relevant lender shortlist; pitch; and the questions still needed. Keep each finding brief. Do not repeat full transactions, boilerplate, the lender catalog or evidence excerpts in the memo. Keep the original structured evidence below it for inspection.
The recommendation is advice for the human reviewer, NEVER an approval, rejection or a completed CRM action. Do not claim a pipeline update, email, court search, lender acceptance or funding decision. Never assert settlement enrollment, default, fraud or personal-account ownership solely from a payee name or missing debits; state observed facts and the question to verify. Distinguish an apparent interruption from confirmed default.
file: up to 8 short label/value rows for legal business, DBA/entity, location, owner, industry, age, bank accounts (last four digits only), and missing application details. Do not reproduce full SSNs, DOBs or account numbers. file_notes: only meaningful mismatched dates/addresses, duplicate files or missing documents. Derive periods from statement content, not file names. A mislabeled bank statement is not a tax return.
bank_details: one entry per supplied bank statement, using its document_id. nsf_count is null unless established by the file. exclusions briefly identify funding, transfers or pass-through amounts excluded from operating revenue. bank_notes: up to four short observations on revenue trend, factoring, transfers or balance changes, with uncertainty where needed. Keep base monthly_financials numeric values complete and shared by both languages.
debts: include all detected debt types and explicitly distinguish MCA from term, SBA, line-of-credit, personal or unconfirmed debt. A weekly payment does NOT by itself mean MCA. Only MCA positions belong in base positions. Do not double-count a renewal as two active obligations. Payment amount/frequency are shared numerical fields; use null/unknown if not known and explain variable payments in notes. Include known funding amounts/dates, renewals, payment reductions and last observed payment dates in the brief status/notes. debt_summary: brief supported monthly service estimate and debt/revenue burden, specifying the period and uncertainty.
tier_sba: use conditional recommendations if credit, taxes or history are missing. An existing SBA loan is not proof of eligibility for another. Lenders: at most ten best/possible/excluded options total, only from the supplied catalog. Explain material exclusions briefly. Contact is null unless an email/portal is actually supplied in catalog data. Never invent contacts, state bans, rates, terms or lender policies from general knowledge. The supplied saved guidelines are the only source for specific lender requirements; disclose unverified or absent guidelines.
pitch and crm_notes: short and in BOTH languages (including the client pitch). pending: up to eight targeted questions or missing documents. All other narrative fields should remain concise, with the main narrative in English and compact_report carrying both final language versions. Return only the required JSON.`;

export function compactReportBlocks(
  report: UnderwritingDraft,
  locale: Locale,
  documents: UnderwritingRun["document_snapshot"] = [],
): CompactBlock[] {
  const c = report.compact_report;
  if (!c) return [];
  const es = locale === "es",
    blocks: CompactBlock[] = [];
  const txt = (s: { es: string; en: string }) => s[locale];
  const heading = (a: string, b: string) =>
    blocks.push({ kind: "heading", text: es ? a : b });
  const paragraph = (text: string) => {
    if (text.trim()) blocks.push({ kind: "paragraph", text });
  };
  const money = (n: number | null | undefined) =>
    n == null
      ? "—"
      : new Intl.NumberFormat(es ? "es-US" : "en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(n);
  const frequency: Record<string, [string, string]> = {
    daily: ["diario", "daily"],
    weekly: ["semanal", "weekly"],
    biweekly: ["quincenal", "biweekly"],
    monthly: ["mensual", "monthly"],
    variable: ["variable", "variable"],
    unknown: ["sin confirmar", "unconfirmed"],
  };
  const kind: Record<string, [string, string]> = {
    mca: ["MCA", "MCA"],
    term: ["Préstamo a plazo", "Term loan"],
    sba: ["SBA", "SBA"],
    credit_line: ["Línea de crédito", "Credit line"],
    personal: ["Deuda personal", "Personal debt"],
    other: ["Otra deuda", "Other debt"],
    unconfirmed: ["Por confirmar", "Unconfirmed"],
  };
  heading("Conclusión sugerida", "Suggested conclusion");
  paragraph(txt(c.conclusion));
  heading("Ficha del negocio", "Business file");
  blocks.push({
    kind: "table",
    headers: es ? ["Campo", "Detalle"] : ["Field", "Details"],
    rows: c.file.map((r) => [txt(r.label), txt(r.value)]),
    widths: [112, 404],
  });
  paragraph(txt(c.file_notes));
  heading("Resumen bancario", "Bank snapshot");
  const months = new Map<string, number | null>();
  const rows = report.monthly_financials.map((m) => {
    const detail = c.bank_details.find((d) => d.document_id === m.document_id);
    const revenue =
      report.calculated_metrics?.find((d) => d.document_id === m.document_id)
        ?.true_revenue ?? null;
    if (m.period) {
      const previous = months.get(m.period);
      months.set(
        m.period,
        revenue === null || previous === null
          ? null
          : (previous || 0) + revenue,
      );
    }
    const exclusions = [
      m.funding_deposits,
      m.internal_transfers,
      m.other_non_operating_deposits,
    ];
    const excluded = exclusions.every((v) => v !== null)
      ? exclusions.reduce<number>((a, v) => a + v!, 0)
      : null;
    const bank = documents.find((d) => d.id === m.document_id)?.bank_name;
    return [
      (m.period || (es ? "Sin fecha" : "Undated")) + (bank ? " · " + bank : ""),
      money(revenue),
      money(excluded),
      money(m.average_balance),
      money(m.minimum_balance),
      money(m.ending_balance),
      `${m.negative_balance_days ?? "—"} / ${detail?.nsf_count ?? "—"}`,
    ];
  });
  const values = [...months.values()];
  if (values.length && values.every((v) => v !== null))
    rows.push([
      es ? "Prom. mensual" : "Monthly avg",
      money(values.reduce<number>((a, v) => a + v!, 0) / values.length),
      "",
      "",
      "",
      "",
      "",
    ]);
  blocks.push({
    kind: "table",
    headers: es
      ? [
          "Mes",
          "Ingreso real",
          "Excluido",
          "Saldo prom.",
          "Mínimo",
          "Final",
          "Neg. / NSF",
        ]
      : [
          "Month",
          "True revenue",
          "Excluded",
          "Avg balance",
          "Low",
          "Ending",
          "Neg. / NSF",
        ],
    rows,
    widths: [80, 76, 76, 72, 72, 72, 68],
  });
  for (const d of c.bank_details) {
    const m = report.monthly_financials.find(
      (m) => m.document_id === d.document_id,
    );
    if (txt(d.exclusions).trim())
      paragraph(`${m?.period || ""}: ${txt(d.exclusions)}`);
  }
  for (const note of c.bank_notes)
    blocks.push({ kind: "bullet", text: txt(note) });
  heading("Posiciones y deuda", "Positions and debt");
  if (!c.debts.length)
    paragraph(
      es
        ? "No se identificó deuda en la respuesta. Confirmar con los documentos."
        : "No debt identified in the response. Confirm against source files.",
    );
  else
    blocks.push({
      kind: "table",
      headers: es
        ? ["Acreedor / tipo", "Pago", "Estado / notas"]
        : ["Creditor / type", "Payment", "Status / notes"],
      rows: c.debts.map((d) => [
        `${d.name} · ${kind[d.kind][es ? 0 : 1]}`,
        `${money(d.payment_amount)} ${frequency[d.payment_frequency][es ? 0 : 1]}`,
        `${txt(d.status)} ${txt(d.notes)}`,
      ]),
      widths: [144, 110, 262],
    });
  paragraph(txt(c.debt_summary));
  heading("Riesgos principales", "Key risk flags");
  for (const risk of c.risks) blocks.push({ kind: "bullet", text: txt(risk) });
  heading("Tier y potencial SBA", "Tier and SBA potential");
  paragraph(txt(c.tier_sba));
  heading("Opciones de lenders", "Lender options");
  for (const l of c.lenders)
    blocks.push({
      kind: "bullet",
      text: `${l.name} (${l.fit === "best" ? (es ? "Mejor encaje" : "Best fit") : l.fit === "possible" ? (es ? "Posible" : "Possible") : es ? "Descartar de la selección" : "Exclude from shortlist"}): ${txt(l.reason)}${l.contact ? " · " + l.contact : ""}`,
    });
  if (!c.lenders.length)
    paragraph(
      es
        ? "Sin opciones confirmadas con el catálogo disponible."
        : "No confirmed options from the available catalog.",
    );
  heading("Estrategia y pitch", "Strategy and pitch");
  paragraph(txt(c.pitch));
  heading("Información pendiente", "Still needed");
  for (const item of c.pending)
    blocks.push({ kind: "bullet", text: txt(item) });
  heading("Notas para CRM", "CRM notes");
  paragraph(txt(c.crm_notes));
  return blocks;
}
