import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument } from "pdf-lib";
import { prepareUnderwritingDraft } from "../src/lib/underwriting";
import type {
  UnderwritingDocument,
  UnderwritingReport,
  UnderwritingRun,
} from "../src/lib/underwriting";
import {
  UnderwritingObservations,
  UnderwritingOriginalOutput,
} from "../src/components/underwriting-observations";
import { underwritingPdf } from "../src/lib/underwriting-pdf";
import { underwritingDocumentLines } from "../src/lib/underwriting-document";
import { callUnderwritingProvider } from "../src/lib/server/openai-underwriting";
import { featureDatabase } from "./feature-database";
import { processUnderwriting } from "../worker/underwriting";
import { hash } from "../src/lib/server/crypto";

function fixture(documents: UnderwritingDocument[]): UnderwritingReport {
  return {
    merchant: {
      name: "Fictional review company",
      industry: null,
      credit_score: null,
      years_in_business: null,
      profitable_on_taxes: null,
      positions_last_12_months: null,
      evidence: [],
    },
    monthly_financials: documents
      .filter((d) => d.kind === "bank_statement")
      .map((d) => ({
        document_id: d.id,
        period: d.period || "2026-09",
        deposits: 100,
        funding_deposits: 200,
        internal_transfers: 0,
        other_non_operating_deposits: 0,
        operating_debits: 10,
        debt_debits: 5,
        ending_balance: 10,
        minimum_balance: 1,
        average_balance: 5,
        negative_balance_days: 2,
        net_debit_days: 1,
        confidence: "confirmed",
        evidence: [],
      })),
    positions: [],
    risks: [],
    sba: {
      status: "potential",
      reasons: ["AI suggestion awaiting human decision"],
      missing_evidence: [],
    },
    suggested_tier: "1",
    tier_reason: "Unverified AI suggestion",
    lender_matches: [],
    reverse_consolidation: {
      consider: false,
      reason: "No confirmed positions",
    },
    summary: "Fictional analysis retained despite warnings",
    strategy: "Human review is required",
    client_pitch: "Please provide missing records.",
    crm_notes: "Review the figures",
    next_action: "Human review",
    missing_information: ["Credit", "Taxes"],
  };
}
const document: UnderwritingDocument = {
  id: randomUUID(),
  name: "Fictional bank statement",
  kind: "bank_statement",
  period: "2026-09",
  bank_name: "Demo Bank",
  statement_number: 1,
  content_hash: "fixture",
  storage_path: "fixture.pdf",
  required: false,
};
function run(report: UnderwritingRun["report"]): UnderwritingRun {
  return {
    id: randomUUID(),
    opportunity_id: randomUUID(),
    status: "draft",
    requested_by: randomUUID(),
    created_at: "2026-10-19T12:00:00Z",
    model: "fixture",
    prompt_version: 2,
    document_snapshot: [document],
    report,
    last_error: null,
    input_tokens: 100,
    output_tokens: 100,
    analysis_id: null,
  };
}
test("inconsistent AI findings remain available with all review observations and the original response untouched", () => {
  const original = fixture([document]),
    before = structuredClone(original);
  const report = prepareUnderwritingDraft(original, [document], []);
  assert.deepEqual(original, before);
  assert.deepEqual(report.original_output, before);
  assert(report.validation_warnings?.includes("MISSING_EVIDENCE"));
  assert(report.validation_warnings?.includes("INCONSISTENT_DAILY_BALANCES"));
  assert(report.validation_warnings?.includes("INCONSISTENT_REVENUE"));
  assert(report.validation_warnings?.includes("UNSUPPORTED_SBA_SCREEN"));
  assert(report.validation_warnings?.includes("UNSUPPORTED_TIER_SCREEN"));
  assert.equal(report.monthly_financials[0].funding_deposits, 200);
  assert.equal(report.calculated_metrics?.[0].true_revenue, null);
  const markup = renderToStaticMarkup(
    createElement(UnderwritingObservations, { report, locale: "es" }),
  );
  assert.match(markup, /tú decides/);
  assert.match(markup, /Las exclusiones superan los depósitos/);
  assert.match(markup, /El informe está disponible/);
});
test("unexpected fields or plain text stay readable without inventing a replacement analysis or executing HTML", async () => {
  const value = {
    analysis: "The AI's actual text <script>ignore()</script>",
    totals: { revenue: -50 },
  };
  const draft = prepareUnderwritingDraft(value, [document], []);
  assert(draft.unstructured);
  assert.deepEqual(draft.original_output, value);
  const markup = renderToStaticMarkup(
    createElement(UnderwritingOriginalOutput, {
      output: draft.original_output,
      locale: "es",
    }),
  );
  assert.match(markup, /actual text/);
  assert(!markup.includes("<script>"));
  const body = { model: "fixture", input: [], store: false, text: {} };
  const fetcher = async () =>
    Response.json({
      status: "completed",
      output: [
        {
          content: [
            {
              type: "output_text",
              text: "Narrative analysis retained for the reviewer.",
            },
          ],
        },
      ],
    });
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", fetcher),
    /OPENAI_INVALID_REPORT/,
  );
  const result = await callUnderwritingProvider(body, "fixture-only", fetcher, {
    retainUnparsed: true,
  });
  assert.equal(
    prepareUnderwritingDraft(result.value, [], []).original_output,
    "Narrative analysis retained for the reviewer.",
  );
});
test("downloadable PDFs contain original findings, sources, warnings and the human's decision", async () => {
  const source = run(
    prepareUnderwritingDraft(fixture([document]), [document], []),
  );
  source.status = "rejected";
  source.review_notes = "Human discarded this draft; figures need correction.";
  const lines = underwritingDocumentLines(source, "Fictional company", "es");
  assert(lines.some((l) => l.text.includes("Descartado por el usuario")));
  assert(lines.some((l) => l.text.includes("Human discarded")));
  assert(lines.some((l) => l.text.includes("Fictional bank statement")));
  assert(lines.some((l) => l.text.includes("Fictional analysis retained")));
  assert(lines.some((l) => l.text.includes("INCONSISTENT_REVENUE")));
  const bytes = await underwritingPdf(source, "Fictional company");
  assert((await PDFDocument.load(bytes)).getPageCount() >= 2);
});
test("a saved draft with warnings remains readable; only an authorized human can approve or discard it", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const contact = randomUUID(),
      caseId = randomUUID();
    await db.query(
      "insert into contacts(id,email,verification) values($1,'human-review@fictional.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fictional',$3)",
      [caseId, contact, users.seller],
    );
    await db.query("select initialize_checklist($1,'MCA')", [caseId]);
    await db.query(
      "update documents set status='approved',storage_path=id::text||'.pdf',content_hash=id::text where opportunity_id=$1",
      [caseId],
    );
    const documents = (
      await db.query<UnderwritingDocument>(
        "select * from documents where opportunity_id=$1",
        [caseId],
      )
    ).rows;
    const draft = prepareUnderwritingDraft(fixture(documents), documents, []);
    async function savedDraft() {
      await db.exec("reset role;set role service_role");
      const id = randomUUID(),
        job = randomUUID(),
        lease = randomUUID();
      await db.query(
        "insert into underwriting_runs(id,opportunity_id,requested_by,request_key,model,prompt,prompt_version,max_output_tokens,document_snapshot,lender_snapshot) values($1,$2,$3,$4,'fixture','Fixture',1,16000,$5,'[]')",
        [id, caseId, users.seller, randomUUID(), documents],
      );
      await db.query(
        "insert into jobs(id,kind,payload,status,lease_token,locked_at,dedupe_key) values($1,'underwriting',$2,'running',$3,now(),($1::uuid)::text)",
        [job, { run_id: id }, lease],
      );
      await db.query("select begin_underwriting($1,$2,$3)", [id, job, lease]);
      await db.query("select start_underwriting_api($1,$2,$3)", [
        id,
        job,
        lease,
      ]);
      await db.query(
        "select complete_underwriting($1,$2,$3,$4,'resp_fixture',100,100,null,false)",
        [id, job, lease, draft],
      );
      return id;
    }
    const first = await savedDraft();
    await asUser(users.outsider);
    assert.equal(
      (await db.query("select id from underwriting_runs where id=$1", [first]))
        .rows.length,
      0,
    );
    await assert.rejects(
      db.query("select reject_underwriting($1,'Foreign case')", [first]),
      /inaccessible/,
    );
    await asUser(users.seller, "aal1");
    await assert.rejects(
      db.query("select reject_underwriting($1,'Missing MFA')", [first]),
      /inaccessible/,
    );
    await asUser(users.seller);
    const visible = (
      await db.query<{
        status: string;
        report: object;
        progress_percent: number;
      }>(
        "select status,report,progress_percent from underwriting_runs where id=$1",
        [first],
      )
    ).rows[0];
    assert.equal(visible.status, "draft");
    assert.equal(visible.progress_percent, 100);
    assert.deepEqual(visible.report, draft);
    await assert.rejects(
      db.query("select reject_underwriting($1,' ')", [first]),
      /Review note required/,
    );
    await db.query(
      "select reject_underwriting($1,'Figures need a second review')",
      [first],
    );
    await db.query(
      "select reject_underwriting($1,'Retry without duplicating activity')",
      [first],
    );
    const rejected = (
      await db.query<{
        status: string;
        report: object;
        reviewed_by: string;
        review_notes: string;
        progress_percent: number;
      }>(
        "select status,report,reviewed_by,review_notes,progress_percent from underwriting_runs where id=$1",
        [first],
      )
    ).rows[0];
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.reviewed_by, users.seller);
    assert.equal(rejected.review_notes, "Figures need a second review");
    assert.deepEqual(rejected.report, draft);
    assert.equal(rejected.progress_percent, 100);
    await assert.rejects(
      db.query(
        "select approve_underwriting($1,'Reviewed','Reviewed','','Reviewed')",
        [first],
      ),
      /Analysis draft required/,
    );
    const second = await savedDraft();
    await asUser(users.seller);
    await db.query(
      "select approve_underwriting($1,'Human reviewed','Proceed after corrections','Warnings reviewed by me','Verify lenders manually')",
      [second],
    );
    const approved = (
      await db.query<{ status: string; reviewed_by: string; report: object }>(
        "select status,reviewed_by,report from underwriting_runs where id=$1",
        [second],
      )
    ).rows[0];
    assert.equal(approved.status, "approved");
    assert.equal(approved.reviewed_by, users.seller);
    assert.deepEqual(approved.report, draft);
    const stored = (
      await db.query<{ structured_report: object; reviewer_id: string }>(
        "select structured_report,reviewer_id from analyses where underwriting_run_id=$1",
        [second],
      )
    ).rows[0];
    assert.deepEqual(stored.structured_report, draft);
    assert.equal(stored.reviewer_id, users.seller);
  } finally {
    await db.close();
  }
});
test("worker saves an inconsistent response as a viewable draft instead of discarding it", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://human-review-fixture.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-only",
    OPENAI_API_KEY: "fixture-only",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, env);
  try {
    const bytes = Buffer.from("%PDF-1.7 fictional source"),
      doc = { ...document, content_hash: hash(bytes) },
      value = fixture([doc]);
    const source = {
      id: randomUUID(),
      opportunity_id: randomUUID(),
      model: "fixture",
      prompt: "Fixture",
      max_output_tokens: 16000,
      document_snapshot: [doc],
      lender_snapshot: [],
    };
    let completion: Record<string, unknown> | null = null,
      calls = 0;
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
            input instanceof Request ? input : new Request(input, init),
          url = new URL(request.url),
          body = request.method === "POST" ? await request.json() : null;
        if (url.hostname === "api.openai.com") {
          calls++;
          return Response.json({
            status: "completed",
            id: "resp_review",
            usage: { input_tokens: 100, output_tokens: 100 },
            output: [
              {
                content: [{ type: "output_text", text: JSON.stringify(value) }],
              },
            ],
          });
        }
        assert.equal(url.hostname, "human-review-fixture.example.test");
        if (url.pathname.includes("/storage/v1/")) return new Response(bytes);
        const path = url.pathname.split("/").pop();
        if (path === "begin_underwriting")
          return Response.json({ action: "prepare" });
        if (path === "underwriting_runs") return Response.json(source);
        if (path === "opportunities")
          return Response.json({ company: "Fictional" });
        if (
          path === "report_underwriting_progress" ||
          path === "start_underwriting_api"
        )
          return Response.json(true);
        if (path === "complete_underwriting") {
          completion = body;
          return Response.json(true);
        }
        throw new Error("Unexpected fixture request");
      },
    );
    await processUnderwriting({
      id: randomUUID(),
      lease_token: randomUUID(),
      payload: { run_id: source.id },
    });
    const result = completion as Record<string, unknown> | null;
    assert(result);
    assert.equal(calls, 1);
    assert.equal(result.failure, null);
    const saved = result.value as ReturnType<typeof prepareUnderwritingDraft>;
    assert.equal(saved.summary, value.summary);
    assert(saved.validation_warnings?.includes("INCONSISTENT_REVENUE"));
    assert.deepEqual(saved.original_output, value);
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
