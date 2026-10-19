import { randomUUID } from "node:crypto";
import { prepareUnderwritingDraft } from "../../src/lib/underwriting";
import type {
  UnderwritingDocument,
  UnderwritingReport,
  UnderwritingRun,
} from "../../src/lib/underwriting";
import { demoCompactUnderwriting } from "../../src/lib/underwriting-compact-demo";
export function compactFixture(): UnderwritingRun {
  const documents: UnderwritingDocument[] = Array.from(
    { length: 4 },
    (_, i) => ({
      id: randomUUID(),
      name: `Fictional statement ${i + 1}`,
      bank_name: "Demo Bank",
      kind: "bank_statement",
      period: `2026-0${i + 6}`,
      statement_number: i + 1,
      content_hash: `fixture-${i}`,
      storage_path: `fixture-${i}.pdf`,
      required: false,
    }),
  );
  const report: UnderwritingReport = {
    compact_report: demoCompactUnderwriting(
      "Fictional Training LLC",
      documents,
    ),
    merchant: {
      name: "Fictional Training LLC",
      industry: "Training",
      credit_score: null,
      years_in_business: null,
      profitable_on_taxes: null,
      positions_last_12_months: null,
      evidence: [],
    },
    monthly_financials: documents.map((d, i) => ({
      document_id: d.id,
      period: d.period,
      deposits: [120000, 115000, 110000, 108000][i],
      funding_deposits: i === 1 ? 20000 : 0,
      internal_transfers: 5000,
      other_non_operating_deposits: 0,
      operating_debits: 60000,
      debt_debits: 5000,
      ending_balance: 25000,
      minimum_balance: 15000,
      average_balance: 30000,
      negative_balance_days: 0,
      net_debit_days: null,
      confidence: "estimated",
      evidence: [],
    })),
    positions: [],
    risks: [],
    sba: {
      status: "not_confirmed",
      reasons: ["Missing credit and taxes"],
      missing_evidence: ["Credit", "Taxes"],
    },
    suggested_tier: "not_confirmed",
    tier_reason: "Subject to review",
    lender_matches: [],
    reverse_consolidation: { consider: false, reason: "No confirmed MCAs" },
    summary: "Technical narrative should stay out of the compact PDF",
    strategy: "Review first",
    client_pitch: "Request supporting documents",
    crm_notes: "Legacy technical note",
    next_action: "Review",
    missing_information: ["Credit", "Taxes"],
  };
  return {
    id: randomUUID(),
    opportunity_id: randomUUID(),
    requested_by: randomUUID(),
    status: "draft",
    created_at: "2026-10-19T13:00:00Z",
    model: "gpt-6.1-sol",
    prompt_version: 2,
    document_snapshot: documents,
    report: prepareUnderwritingDraft(report, documents, []),
    last_error: null,
    input_tokens: null,
    output_tokens: null,
    analysis_id: null,
  };
}
