import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  calculateUnderwritingMetrics,
  validateUnderwritingReport,
  DEFAULT_UNDERWRITING_PROMPT,
  DEFAULT_UNDERWRITING_RULES,
} from "../src/lib/underwriting";
import type {
  UnderwritingDocument,
  UnderwritingReport,
} from "../src/lib/underwriting";
import { hash } from "../src/lib/server/crypto";
import { emptyLenderGuidelines } from "../src/lib/lender-management";
import {
  callUnderwritingProvider,
  underwritingRequest,
} from "../src/lib/server/openai-underwriting";

function fixture(documents: UnderwritingDocument[]): UnderwritingReport {
  return {
    merchant: {
      name: "Fictional merchant",
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
        deposits: 100000,
        funding_deposits: 20000,
        internal_transfers: 10000,
        other_non_operating_deposits: 5000,
        operating_debits: 50000,
        debt_debits: 5000,
        ending_balance: 12000,
        minimum_balance: -2000,
        average_balance: 6000,
        negative_balance_days: 2,
        net_debit_days: 12,
        confidence: "confirmed",
        evidence: [
          {
            document_id: d.id,
            page: 1,
            excerpt: "Fictional statement totals for testing",
          },
        ],
      })),
    positions: [],
    risks: [],
    sba: {
      status: "not_confirmed",
      reasons: ["Credit and taxes not supplied"],
      missing_evidence: ["Credit report", "Taxes"],
    },
    suggested_tier: "not_confirmed",
    tier_reason: "Unconfirmed credit",
    lender_matches: [],
    reverse_consolidation: {
      consider: false,
      reason: "Positions not confirmed",
    },
    summary: "Fictional report",
    strategy: "Review missing evidence",
    client_pitch: "Please provide missing records.",
    crm_notes: "Fixture only",
    next_action: "Request credit and tax records",
    missing_information: ["Credit", "Taxes"],
  };
}
const bytes = Buffer.from("%PDF-1.7 fixture only");
const docs: UnderwritingDocument[] = [
  {
    id: randomUUID(),
    name: "Statement",
    kind: "bank_statement",
    period: "2026-09",
    content_hash: hash(bytes),
    storage_path: "fixture.pdf",
    required: true,
  },
];

test("underwriting calculates true revenue and affordability without counting financing or inventing absent amounts", () => {
  const report = fixture(docs),
    metrics = calculateUnderwritingMetrics(report)[0];
  assert.equal(metrics.true_revenue, 65000);
  assert.equal(metrics.available_cash_flow, 10000);
  assert.equal(metrics.debt_to_revenue, 5000 / 65000);
  assert.equal(metrics.revenue_to_debt, 13);
  report.monthly_financials[0].funding_deposits = null;
  assert.equal(calculateUnderwritingMetrics(report)[0].true_revenue, null);
  report.monthly_financials[0].funding_deposits = 100001;
  assert.throws(
    () => calculateUnderwritingMetrics(report),
    /INCONSISTENT_REVENUE/,
  );
});

test("different banks may share a month and their metrics remain tied to the correct document", () => {
  const overlapping = [
    { ...docs[0], period: "", bank_name: "First Bank" },
    { ...docs[0], id: randomUUID(), period: "", bank_name: "Second Bank" },
  ];
  const report = fixture(overlapping);
  report.monthly_financials[1].deposits = 200000;
  const validated = validateUnderwritingReport(report, overlapping, []);
  assert.notEqual(
    validated.calculated_metrics[0].document_id,
    validated.calculated_metrics[1].document_id,
  );
  assert.notEqual(
    validated.calculated_metrics[0].true_revenue,
    validated.calculated_metrics[1].true_revenue,
  );
  const unknown = fixture([{ ...docs[0], period: "" }]);
  unknown.monthly_financials[0].period = "";
  unknown.monthly_financials[0].confidence = "not_confirmed";
  assert.ok(
    validateUnderwritingReport(
      unknown,
      [{ ...docs[0], period: "" }],
      [],
    ).missing_information.some((v) => v.includes("período")),
  );
});
test("reports reject evidence from another case, duplicate periods, invented lenders and unsupported SBA conclusions", () => {
  assert.equal(
    validateUnderwritingReport(fixture(docs), docs, []).judicial_check,
    "pending_manual_review",
  );
  const report = fixture(docs);
  report.monthly_financials[0].evidence[0].document_id = randomUUID();
  assert.throws(
    () => validateUnderwritingReport(report, docs, []),
    /UNKNOWN_EVIDENCE/,
  );
  const duplicate = fixture(docs);
  duplicate.monthly_financials.push(duplicate.monthly_financials[0]);
  assert.throws(
    () => validateUnderwritingReport(duplicate, docs, []),
    /INVALID_STATEMENT_PERIOD/,
  );
  const lender = fixture(docs);
  lender.lender_matches = [
    {
      lender_id: "invented",
      name: "Invented lender",
      reason: "Fixture",
      missing_requirements: [],
    },
  ];
  assert.throws(
    () => validateUnderwritingReport(lender, docs, []),
    /UNKNOWN_LENDER/,
  );
  const sba = fixture(docs);
  sba.sba.status = "potential";
  assert.throws(
    () => validateUnderwritingReport(sba, docs, []),
    /UNSUPPORTED_SBA_SCREEN/,
  );
  const absent = fixture(docs);
  const match = fixture(docs);
  match.lender_matches = [
    {
      lender_id: "test",
      name: "Fictional lender",
      reason: "Fixture",
      missing_requirements: [],
    },
  ];
  match.merchant.credit_score = 620;
  match.merchant.evidence = [
    { document_id: docs[0].id, page: 1, excerpt: "Fictional credit evidence" },
  ];
  assert.throws(
    () =>
      validateUnderwritingReport(match, docs, [
        {
          id: "test",
          name: "Fictional lender",
          guidelines: {
            ...emptyLenderGuidelines,
            min_credit: 700,
            verified: true,
            source: "Fixture",
            as_of: "2026-10-14",
          },
        },
      ]),
    /LENDER_GUIDELINE_CONFLICT/,
  );
  absent.monthly_financials[0].evidence = [];
  assert.throws(
    () => validateUnderwritingReport(absent, docs, []),
    /MISSING_EVIDENCE/,
  );
});
test("Responses receives approved PDF bytes, strict structure, no stored response and never a key in its input", async () => {
  const body = underwritingRequest({
    model: "gpt-6.1-sol",
    prompt: DEFAULT_UNDERWRITING_PROMPT,
    maxOutputTokens: 8000,
    documents: docs.map((snapshot) => ({ snapshot, bytes })),
    lenders: [],
    company: "Fictional merchant",
  });
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.text.format.strict, true);
  assert.ok(body.input[0].content.some((c) => c.type === "input_file"));
  assert.throws(
    () =>
      underwritingRequest({
        model: "fixture",
        prompt: "fixture",
        maxOutputTokens: 8000,
        documents: docs.map((snapshot) => ({
          snapshot,
          bytes: Buffer.from("%PDF-altered"),
        })),
        lenders: [],
        company: "Fixture",
      }),
    /DOCUMENT_HASH_MISMATCH/,
  );
  let requests = 0;
  const result = await callUnderwritingProvider(
    body,
    "test-only-value",
    async (url, options) => {
      requests++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.ok(!String(options?.body).includes("test-only-value"));
      return Response.json({
        id: "fixture-response",
        status: "completed",
        usage: { input_tokens: 100, output_tokens: 50 },
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: JSON.stringify(fixture(docs)) },
            ],
          },
        ],
      });
    },
  );
  assert.equal(requests, 1);
  assert.equal(result.responseId, "fixture-response");
  assert.equal(result.inputTokens, 100);
  await assert.rejects(
    callUnderwritingProvider(body, "test-only-value", async () => {
      throw new Error("contains-sensitive-provider-detail");
    }),
    /OPENAI_RESULT_UNCERTAIN/,
  );
  await assert.rejects(
    callUnderwritingProvider(
      body,
      "test-only-value",
      async () =>
        new Response("contains-sensitive-provider-detail", { status: 401 }),
    ),
    /OPENAI_AUTH_FAILED/,
  );
});

test("queued underwriting freezes inputs, requires human approval, fences workers and never automatically repeats an uncertain API call", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
   grant usage on schema public,auth,storage to authenticated,anon,service_role;`);
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const admin = randomUUID(),
      seller = randomUUID(),
      outsider = randomUUID(),
      contact = randomUUID(),
      caseId = randomUUID();
    for (const id of [seller, outsider]) {
      await db.query("insert into auth.users values($1,$2)", [
        id,
        `${id}@team.test`,
      ]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,'Seller',$2,'seller')",
        [id, `${id}@team.test`],
      );
    }
    await db.query("insert into auth.users values($1,'admin@team.test')", [
      admin,
    ]);
    await db.query(
      "insert into profiles(id,name,email,role) values($1,'Admin','admin@team.test','superadmin')",
      [admin],
    );
    await db.query(
      "insert into contacts(id,email,verification) values($1,'fictional@customer.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id,application_signed,application_complete) values($1,$2,'Fictional merchant',$3,true,true)",
      [caseId, contact, seller],
    );
    await db.query("select initialize_checklist($1,'MCA')", [caseId]);
    async function asUser(id: string, aal = "aal2") {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, aal }),
      ]);
      await db.exec("set role authenticated");
    }
    const requestKey = randomUUID();
    const request = () =>
      db.query<{ id: string }>("select request_underwriting($1,$2) id", [
        caseId,
        requestKey,
      ]);
    await asUser(outsider);
    await assert.rejects(request(), /read-only/);
    await asUser(seller, "aal1");
    await assert.rejects(request(), /MFA/);
    await asUser(seller);
    await assert.rejects(request(), /Approve the application/);
    await db.exec("reset role");
    await db.query(
      "update documents set status='approved',content_hash=repeat(md5(id::text),2),storage_path='fixture.pdf' where opportunity_id=$1",
      [caseId],
    );
    await asUser(seller);
    const run = (await request()).rows[0].id;
    assert.equal((await request()).rows[0].id, run);
    const original = (
      await db.query<{
        document_snapshot: UnderwritingDocument[];
        model: string;
        prompt_version: number;
      }>(
        "select document_snapshot,model,prompt_version from underwriting_runs where id=$1",
        [run],
      )
    ).rows[0];
    assert.equal(original.document_snapshot.length, 5);
    assert.equal(original.model, "gpt-6.1-sol");
    await assert.rejects(
      db.query(
        "select approve_underwriting($1,'Summary','Conclusion','','Lenders')",
        [run],
      ),
      /draft required/,
    );
    await db.exec("reset role");
    const job = (
      await db.query<{ id: string }>(
        "select id from jobs where dedupe_key=$1",
        [`underwriting:${run}`],
      )
    ).rows[0].id;
    const lease = randomUUID();
    await db.query(
      "update jobs set status='running',lease_token=$2,locked_at=now() where id=$1",
      [job, lease],
    );
    await db.exec("set role service_role");
    assert.equal(
      (
        await db.query<{ value: { action: string } }>(
          "select begin_underwriting($1,$2,$3) value",
          [run, job, lease],
        )
      ).rows[0].value.action,
      "prepare",
    );
    assert.equal(
      (
        await db.query<{ value: boolean }>(
          "select start_underwriting_api($1,$2,$3) value",
          [run, job, lease],
        )
      ).rows[0].value,
      true,
    );
    assert.equal(
      (
        await db.query<{ value: boolean }>(
          "select start_underwriting_api($1,$2,$3) value",
          [run, job, lease],
        )
      ).rows[0].value,
      false,
    );
    const report = validateUnderwritingReport(
      fixture(original.document_snapshot),
      original.document_snapshot,
      [],
    );
    assert.equal(
      (
        await db.query<{ value: boolean }>(
          "select complete_underwriting($1,$2,$3,$4,'fixture-response',100,50,null,false) value",
          [run, job, lease, JSON.stringify(report)],
        )
      ).rows[0].value,
      true,
    );
    await asUser(seller);
    assert.equal(
      (
        await db.query("select * from analyses where opportunity_id=$1", [
          caseId,
        ])
      ).rows.length,
      0,
    );
    const analysis = (
      await db.query<{ id: string }>(
        "select approve_underwriting($1,'Reviewed summary','Reviewed conclusion','NYSCEF pending','Reviewed lenders') id",
        [run],
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select approve_underwriting($1,'Retry','','','') id",
          [run],
        )
      ).rows[0].id,
      analysis,
    );
    await db.exec("reset role");
    await db.query("update documents set status='correction' where id=$1", [
      original.document_snapshot[0].id,
    ]);
    await asUser(seller);
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from underwriting_runs where id=$1",
          [run],
        )
      ).rows[0].status,
      "outdated",
    );
    assert.equal(
      (
        await db.query<{ is_current: boolean }>(
          "select is_current from analyses where id=$1",
          [analysis],
        )
      ).rows[0].is_current,
      false,
    );
    await db.exec("reset role");
    await db.query("update documents set status='approved' where id=$1", [
      original.document_snapshot[0].id,
    ]);
    await asUser(seller);
    await assert.rejects(
      db.query("select crm_command('handoff',$1,$2)", [
        JSON.stringify({ opportunity_id: caseId }),
        randomUUID(),
      ]),
      /Current reviewed analysis/,
    );
    const second = (
      await db.query<{ id: string }>("select request_underwriting($1,$2) id", [
        caseId,
        randomUUID(),
      ])
    ).rows[0].id;
    await db.exec("reset role");
    const secondJob = (
      await db.query<{ id: string }>(
        "select id from jobs where dedupe_key=$1",
        [`underwriting:${second}`],
      )
    ).rows[0].id;
    const staleLease = randomUUID(),
      replacementLease = randomUUID();
    await db.query(
      "update jobs set status='running',lease_token=$2,locked_at=now() where id=$1",
      [secondJob, staleLease],
    );
    await db.exec("set role service_role");
    await db.query("select begin_underwriting($1,$2,$3)", [
      second,
      secondJob,
      staleLease,
    ]);
    await db.query("select start_underwriting_api($1,$2,$3)", [
      second,
      secondJob,
      staleLease,
    ]);
    await db.exec("reset role");
    await db.query(
      "update jobs set lease_token=$2,locked_at=now() where id=$1",
      [secondJob, replacementLease],
    );
    await db.exec("set role service_role");
    assert.equal(
      (
        await db.query<{ value: boolean }>(
          "select complete_underwriting($1,$2,$3,$4,'fixture-response',100,50,null,false) value",
          [second, secondJob, staleLease, JSON.stringify(report)],
        )
      ).rows[0].value,
      false,
    );
    assert.equal(
      (
        await db.query<{ value: { action: string } }>(
          "select begin_underwriting($1,$2,$3) value",
          [second, secondJob, replacementLease],
        )
      ).rows[0].value.action,
      "stop",
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from underwriting_runs where id=$1",
          [second],
        )
      ).rows[0].status,
      "uncertain",
    );
    await asUser(outsider);
    assert.equal(
      (await db.query("select * from underwriting_runs")).rows.length,
      0,
    );
    const settingsInput = {
      expected_version: 1,
      prompt: DEFAULT_UNDERWRITING_PROMPT + "\nAdditional review instruction.",
      model: "gpt-6.1-sol",
      enabled: true,
      max_output_tokens: 8000,
      daily_run_limit: 20,
      rules: {
        ...DEFAULT_UNDERWRITING_RULES,
        sba: { ...DEFAULT_UNDERWRITING_RULES.sba, min_credit_score: 680 },
      },
    };
    await assert.rejects(
      db.query("select save_underwriting_settings($1,$2)", [
        JSON.stringify(settingsInput),
        randomUUID(),
      ]),
      /Superadmin/,
    );
    await asUser(admin);
    const settingsKey = randomUUID();
    assert.equal(
      (
        await db.query<{ v: number }>(
          "select save_underwriting_settings($1,$2) v",
          [JSON.stringify(settingsInput), settingsKey],
        )
      ).rows[0].v,
      2,
    );
    assert.equal(
      (
        await db.query<{ v: number }>(
          "select save_underwriting_settings($1,$2) v",
          [JSON.stringify(settingsInput), settingsKey],
        )
      ).rows[0].v,
      2,
    );
    assert.equal(
      (await db.query("select * from underwriting_setting_versions")).rows
        .length,
      2,
    );
    await assert.rejects(
      db.query("select save_underwriting_settings($1,$2)", [
        JSON.stringify(settingsInput),
        randomUUID(),
      ]),
      /Settings changed/,
    );
    const noRules = {
      ...settingsInput,
      expected_version: 2,
      rules: { sba: {}, tier1: {}, tier23: {} },
    };
    await assert.rejects(
      db.query("select save_underwriting_settings($1,$2)", [
        JSON.stringify(noRules),
        randomUUID(),
      ]),
      /Invalid screening rules/,
    );
    await asUser(seller);
    const updatedRun = (
      await db.query<{ id: string }>("select request_underwriting($1,$2) id", [
        caseId,
        randomUUID(),
      ])
    ).rows[0].id;
    const snapshot = (
      await db.query<{
        rules: typeof DEFAULT_UNDERWRITING_RULES;
        prompt_version: number;
      }>("select rules,prompt_version from underwriting_runs where id=$1", [
        updatedRun,
      ])
    ).rows[0];
    assert.equal(snapshot.rules.sba.min_credit_score, 680);
    assert.equal(snapshot.prompt_version, 2);
    assert.equal(
      (
        await db.query<{ prompt_version: number }>(
          "select prompt_version from underwriting_runs where id=$1",
          [run],
        )
      ).rows[0].prompt_version,
      1,
    );
    await asUser(admin);
    await db.query("select save_underwriting_settings($1,$2)", [
      JSON.stringify({ ...settingsInput, expected_version: 2, enabled: false }),
      randomUUID(),
    ]);
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from underwriting_runs where id=$1",
          [updatedRun],
        )
      ).rows[0].status,
      "failed",
    );
    await asUser(seller);
    await assert.rejects(
      db.query("select request_underwriting($1,$2)", [caseId, randomUUID()]),
      /disabled/,
    );
  } finally {
    await db.close();
  }
});
