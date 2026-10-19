import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument } from "pdf-lib";
import { compactFixture } from "./fixtures/compact-underwriting";
import {
  compactReportBlocks,
  compactUnderwritingSchema,
} from "../src/lib/underwriting-compact";
import {
  underwritingRequest,
  callUnderwritingProvider,
  UnderwritingProviderError,
} from "../src/lib/server/openai-underwriting";
import { prepareUnderwritingDraft } from "../src/lib/underwriting";
import { UnderwritingCompactReport } from "../src/components/underwriting-compact-report";
import { underwritingPdf } from "../src/lib/underwriting-pdf";

test("both languages use the same bank numbers, debts and lender identities while displaying the matching narrative", () => {
  const run = compactFixture(),
    report = run.report!;
  const spanish = compactReportBlocks(report, "es", run.document_snapshot),
    english = compactReportBlocks(report, "en", run.document_snapshot);
  assert(
    spanish.some(
      (b) => b.kind !== "table" && b.text.includes("Revisar una opción"),
    ),
  );
  assert(
    english.some(
      (b) => b.kind !== "table" && b.text.includes("Consider a longer-term"),
    ),
  );
  assert(
    spanish.some(
      (b) => b.kind === "table" && b.headers.includes("Ingreso real"),
    ),
  );
  assert(
    english.some(
      (b) => b.kind === "table" && b.headers.includes("True revenue"),
    ),
  );
  const esMarkup = renderToStaticMarkup(
    createElement(UnderwritingCompactReport, {
      report,
      locale: "es",
      documents: run.document_snapshot,
    }),
  );
  const enMarkup = renderToStaticMarkup(
    createElement(UnderwritingCompactReport, {
      report,
      locale: "en",
      documents: run.document_snapshot,
    }),
  );
  assert.match(esMarkup, /lang="es"/);
  assert.match(enMarkup, /lang="en"/);
  assert(esMarkup.includes(report.compact_report!.crm_notes.es));
  assert(enMarkup.includes(report.compact_report!.crm_notes.en));
  assert(!esMarkup.includes("Technical narrative should stay out"));
  assert(!enMarkup.includes("DEMO: informe pendiente"));
  report.compact_report!.debts[0].payment_amount = 1638.98;
  assert(
    compactReportBlocks(report, "en").some(
      (b) =>
        b.kind === "table" &&
        b.rows.some((row) => row.some((cell) => cell.includes("1,638.98"))),
    ),
  );
});
test("monthly average sums banks in the same month and never treats unknown figures as zero", () => {
  const run = compactFixture(),
    report = run.report!;
  report.monthly_financials.forEach((m, i) => {
    m.period = i < 2 ? "2026-06" : "2026-07";
  });
  report.calculated_metrics!.forEach((m, i) => {
    m.true_revenue = (i + 1) * 100;
  });
  const table = compactReportBlocks(report, "en").find(
    (b) => b.kind === "table" && b.headers.includes("True revenue"),
  );
  assert(table?.kind === "table");
  assert.equal(table.rows.at(-1)?.[1], "$500");
  report.calculated_metrics![0].true_revenue = null;
  const unknown = compactReportBlocks(report, "en").find(
    (b) => b.kind === "table" && b.headers.includes("True revenue"),
  );
  assert(unknown?.kind === "table");
  assert(!unknown.rows.some((row) => row[0] === "Monthly avg"));
});
test("the provider contract requires both complete language versions without changing model, budget or human authority", () => {
  const body = underwritingRequest({
    model: "gpt-6.1-sol",
    prompt: "Old prompt: Spanish except English pitch.",
    maxOutputTokens: 16000,
    documents: [],
    lenders: [],
    company: "Fictional",
  });
  assert.equal(body.model, "gpt-6.1-sol");
  assert.equal(body.max_output_tokens, 16000);
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  const schema = body.text.format.schema as {
    required?: string[];
    properties?: Record<string, unknown>;
  };
  assert(schema.required?.includes("compact_report"));
  const inspect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (object.type === "object" && object.properties) {
      assert.deepEqual(
        Object.keys(object.properties as object).sort(),
        [...(object.required as string[])].sort(),
      );
      assert.equal(object.additionalProperties, false);
    }
    for (const child of Object.values(object))
      if (Array.isArray(child)) child.forEach(inspect);
      else inspect(child);
  };
  inspect(schema);
  assert.match(body.instructions, /same facts, figures/);
  assert.match(body.instructions, /NEVER an approval/);
  assert.match(body.instructions, /weekly payment does NOT by itself mean MCA/);
  const run = compactFixture();
  assert(
    compactUnderwritingSchema.safeParse(run.report!.compact_report).success,
  );
  const invalid = structuredClone(run.report!.compact_report);
  invalid!.conclusion.en = null as never;
  assert(!compactUnderwritingSchema.safeParse(invalid).success);
});
test("compact lender and source mistakes remain visible as warnings, not automatic decisions", () => {
  const run = compactFixture(),
    value = structuredClone(run.report!);
  value.compact_report!.lenders = [
    {
      lender_id: "fictional",
      name: "Fictional lender",
      fit: "possible",
      contact: "not-supplied@example.test",
      reason: { es: "Por verificar", en: "To verify" },
    },
  ];
  const saved = prepareUnderwritingDraft(value, run.document_snapshot, [
    { id: "fictional", name: "Fictional lender" },
  ]);
  assert(saved.validation_warnings?.includes("UNVERIFIED_LENDER_CONTACT"));
  assert.equal(saved.compact_report!.lenders[0].reason.en, "To verify");
  assert.equal(run.status, "draft");
});
test("compact PDFs support Spanish and English and remain short for a four-statement memo", async () => {
  const run = compactFixture();
  for (const locale of ["es", "en"] as const) {
    const pdf = await PDFDocument.load(
      await underwritingPdf(run, "Fictional Training LLC", locale),
    );
    assert(pdf.getPageCount() <= 3);
    assert(pdf.getPageCount() > 0);
    assert(
      pdf.getTitle()?.includes(locale === "es" ? "Informe" : "Underwriting"),
    );
  }
});

test("an explicit exhausted balance inside HTTP-200 streaming is reported as quota, without retrying or exposing the message", async () => {
  let calls = 0;
  await assert.rejects(
    callUnderwritingProvider(
      { model: "fixture", input: [], store: false, stream: true, text: {} },
      "fixture-only",
      async () => {
        calls++;
        return new Response(
          'data: {"type":"response.created","response":{"id":"resp_fixture","status":"in_progress"}}\n\ndata: {"type":"error","error":{"type":"insufficient_quota","code":"credit_balance_exhausted","message":"private-provider-text"}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    ),
    (error) => {
      assert(error instanceof UnderwritingProviderError);
      assert.equal(error.code, "OPENAI_QUOTA_EXHAUSTED");
      assert.equal(error.uncertain, false);
      assert(!JSON.stringify(error).includes("private-provider-text"));
      return true;
    },
  );
  assert.equal(calls, 1);
});
