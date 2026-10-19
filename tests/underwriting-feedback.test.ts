import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Document } from "../src/lib/domain";
import type { UnderwritingRun } from "../src/lib/underwriting";
import {
  underwritingReadiness,
  underwritingProgress,
} from "../src/lib/underwriting-status";
import {
  UnderwritingChecklist,
  UnderwritingProgressBar,
  UnderwritingFailure,
} from "../src/components/underwriting-readiness";
import {
  callUnderwritingProvider,
  UnderwritingProviderError,
} from "../src/lib/server/openai-underwriting";
import { featureDatabase } from "./feature-database";
import { processUnderwriting } from "../worker/underwriting";
import { hash } from "../src/lib/server/crypto";

function packet(): Document[] {
  return ["application", ...Array(4).fill("bank_statement")].map((kind, i) => ({
    id: randomUUID(),
    opportunity_id: "fixture",
    name: i ? `Bank Statement ${i}` : "Application",
    kind,
    period: "",
    bank_name: i < 3 ? "First Bank" : "Second Bank",
    statement_number: i || null,
    required: i === 0,
    status: "approved",
    storage_path: `fixture/${i}.pdf`,
    content_hash: `hash-${i}`,
    source: "upload",
    created_at: "2026-10-18",
  }));
}
function run(status: UnderwritingRun["status"]): UnderwritingRun {
  return {
    id: randomUUID(),
    opportunity_id: "fixture",
    status,
    requested_by: "fixture",
    created_at: "2026-10-18",
    model: "fixture",
    prompt_version: 1,
    document_snapshot: [],
    report: null,
    last_error: null,
    input_tokens: null,
    output_tokens: null,
    analysis_id: null,
  };
}
test("analysis checklist requires actual approved bytes, four distinct statements and all required additional documents", () => {
  const docs = packet();
  assert(underwritingReadiness(docs).ready);
  docs[1].status = "correction";
  assert(!underwritingReadiness(docs).ready);
  assert.equal(underwritingReadiness(docs).approvedBanks, 3);
  docs[1].status = "approved";
  docs[1].content_hash = docs[2].content_hash;
  assert(!underwritingReadiness(docs).ready);
  assert(underwritingReadiness(docs).bankRows.some((r) => r.duplicate));
  docs[1].content_hash = "distinct";
  docs[0].storage_path = undefined;
  assert(!underwritingReadiness(docs).ready);
  assert(underwritingReadiness(docs, true).ready);
  docs[0].storage_path = "application.pdf";
  docs.push({
    ...docs[1],
    id: randomUUID(),
    kind: "additional",
    required: true,
    status: "received",
  });
  assert(!underwritingReadiness(docs).ready);
  docs.at(-1)!.required = false;
  assert(underwritingReadiness(docs).ready);
  docs.push({
    ...docs[1],
    id: randomUUID(),
    content_hash: "optional",
    status: "received",
    required: false,
  });
  assert(
    underwritingReadiness(docs).ready,
    "unapproved optional bank does not block four approved distinct statements",
  );
  const empty = underwritingReadiness([]);
  assert(!empty.ready);
  assert.equal(empty.approvedBanks, 0);
  const html = renderToStaticMarkup(
    createElement(UnderwritingChecklist, { documents: [], locale: "es" }),
  );
  assert.match(html, /Extracto bancario 4/);
  assert.match(html, /Solicitud \/ aplicación/);
  assert.match(html, /is-missing/);
  const approved = renderToStaticMarkup(
    createElement(UnderwritingChecklist, { documents: packet(), locale: "es" }),
  );
  assert.match(approved, /Documentación lista/);
  assert.match(approved, /Second Bank/);
});
test("progress follows recorded stages, stops on failures and reaches 100 only for a saved draft", () => {
  const active = {
    ...run("running"),
    progress_stage: "analyzing",
    progress_percent: 50,
  };
  assert.equal(underwritingProgress(active, "es").percent, 50);
  const failed = {
    ...active,
    status: "failed" as const,
    progress_percent: 100,
    last_error: "OPENAI_OUTPUT_LIMIT_REACHED",
    output_tokens: 8000,
    provider_diagnostics: { max_output_tokens: 8000 },
  };
  assert.equal(underwritingProgress(failed, "es").percent, 95);
  assert(underwritingProgress(failed, "es").stopped);
  assert.equal(
    underwritingProgress({ ...active, status: "draft" }, "es").percent,
    100,
  );
  const markup = renderToStaticMarkup(
    createElement(UnderwritingProgressBar, { run: active, locale: "es" }),
  );
  assert.match(markup, /role="progressbar"/);
  assert.match(markup, /aria-valuenow="50"/);
  assert.match(markup, /no es un porcentaje de lectura interna/);
  const failure = renderToStaticMarkup(
    createElement(UnderwritingFailure, { run: failed, locale: "es" }),
  );
  assert.match(failure, /16.000/);
  assert.match(failure, /aumentar el consumo/);
  assert(!failure.includes("100%"));
});
test("OpenAI incomplete details and token usage survive without accepting partial JSON or retrying", async () => {
  const body = {
    model: "fixture",
    input: [],
    store: false,
    text: {},
    max_output_tokens: 8000,
  };
  let calls = 0;
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", async () => {
      calls++;
      return Response.json({
        id: "resp_fixture",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 2000, output_tokens: 8000 },
        output: [{ content: [{ type: "output_text", text: '{"partial":' }] }],
      });
    }),
    (e) => {
      assert(e instanceof UnderwritingProviderError);
      assert.equal(e.code, "OPENAI_OUTPUT_LIMIT_REACHED");
      assert.equal(e.diagnostics?.responseId, "resp_fixture");
      assert.equal(e.diagnostics?.outputTokens, 8000);
      assert.equal(e.diagnostics?.max_output_tokens, 8000);
      assert.equal(e.uncertain, false);
      return true;
    },
  );
  assert.equal(calls, 1);
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", async () =>
      Response.json({
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
      }),
    ),
    /OPENAI_CONTENT_FILTER/,
  );
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", async () =>
      Response.json({
        status: "incomplete",
        incomplete_details: { reason: "contains-private-text" },
      }),
    ),
    (e) => {
      assert(e instanceof UnderwritingProviderError);
      assert(!JSON.stringify(e).includes("contains-private-text"));
      return true;
    },
  );
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", async () =>
      Response.json(null),
    ),
    /OPENAI_INVALID_RESPONSE/,
  );
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", async () =>
      Response.json({
        status: "completed",
        output: {},
        usage: { input_tokens: 2, output_tokens: 3 },
      }),
    ),
    (e) => {
      assert(e instanceof UnderwritingProviderError);
      assert.equal(e.code, "OPENAI_INVALID_RESPONSE");
      assert.equal(e.diagnostics?.outputTokens, 3);
      return true;
    },
  );
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", async () =>
      Response.json({ status: "in_progress" }),
    ),
    (e) => {
      assert(e instanceof UnderwritingProviderError);
      assert.equal(e.code, "OPENAI_RESULT_UNCERTAIN");
      assert(e.uncertain);
      return true;
    },
  );
});
test("database progress is lease fenced, ordered, service-only and never completes a failed report", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const caseId = randomUUID(),
      contact = randomUUID(),
      runId = randomUUID(),
      jobId = randomUUID(),
      lease = randomUUID();
    await db.query(
      "insert into contacts(id,email,verification) values($1,'progress@fictional.test','valid')",
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
      await db.query<{
        id: string;
        kind: string;
        period: string;
        content_hash: string;
      }>(
        "select id,kind,period,content_hash from documents where opportunity_id=$1",
        [caseId],
      )
    ).rows;
    await db.query(
      "insert into underwriting_runs(id,opportunity_id,requested_by,request_key,model,prompt,prompt_version,max_output_tokens,document_snapshot,lender_snapshot) values($1,$2,$3,$4,'fixture','Fixture',1,8000,$5,'[]')",
      [runId, caseId, users.seller, randomUUID(), documents],
    );
    await db.query(
      "insert into jobs(id,kind,payload,status,lease_token,locked_at,dedupe_key) values($1,'underwriting',$2,'running',$3,now(),($1::uuid)::text)",
      [jobId, { run_id: runId }, lease],
    );
    const progress = (
      stage: string,
      processed: number | null = null,
      token = lease,
      diagnostic: unknown = null,
    ) =>
      db.query<{ ok: boolean }>(
        "select report_underwriting_progress($1,$2,$3,$4,$5,$6) ok",
        [runId, jobId, token, stage, processed, diagnostic],
      );
    await asUser(users.seller);
    await assert.rejects(progress("documents", 0), /permission denied/);
    await db.exec("reset role;set role service_role");
    await db.query("select begin_underwriting($1,$2,$3)", [
      runId,
      jobId,
      lease,
    ]);
    assert.equal(
      (await progress("documents", 1, randomUUID())).rows[0].ok,
      false,
    );
    await progress("documents", 2);
    await assert.rejects(progress("documents", 1), /Invalid document progress/);
    await db.query("select start_underwriting_api($1,$2,$3)", [
      runId,
      jobId,
      lease,
    ]);
    await progress("validating", 5);
    assert.equal((await progress("analyzing", 5)).rows[0].ok, false);
    await progress("saving", 5);
    await progress("diagnostics", null, lease, {
      status: "incomplete",
      incomplete_reason: "max_output_tokens",
      private_text: "never-store-this",
    });
    await db.query(
      "select complete_underwriting($1,$2,$3,null,'resp_fixture',2000,8000,'OPENAI_OUTPUT_LIMIT_REACHED',false)",
      [runId, jobId, lease],
    );
    const row = (
      await db.query<{
        progress_percent: number;
        status: string;
        provider_diagnostics: object;
        output_tokens: number;
      }>(
        "select progress_percent,status,provider_diagnostics,output_tokens from underwriting_runs where id=$1",
        [runId],
      )
    ).rows[0];
    assert.equal(row.status, "failed");
    assert.equal(row.progress_percent, 95);
    assert.equal(row.output_tokens, 8000);
    assert(
      !JSON.stringify(row.provider_diagnostics).includes("never-store-this"),
    );
    assert.equal((await progress("saving", 5)).rows[0].ok, false);
    await db.exec("reset role");
    await db.query(
      "update underwriting_runs set status='draft',report='{}' where id=$1",
      [runId],
    );
    assert.equal(
      (
        await db.query<{ progress_percent: number }>(
          "select progress_percent from underwriting_runs where id=$1",
          [runId],
        )
      ).rows[0].progress_percent,
      100,
    );
    await asUser(users.admin);
    const settings = (
      await db.query<Record<string, unknown>>(
        "select * from underwriting_settings",
      )
    ).rows[0];
    assert.equal(settings.max_output_tokens, 8000);
    const settingsInput = {
      ...settings,
      expected_version: settings.version,
      max_output_tokens: 32000,
    };
    await db.query("select save_underwriting_settings($1,$2)", [
      settingsInput,
      randomUUID(),
    ]);
    assert.equal(
      (
        await db.query<{ max_output_tokens: number }>(
          "select max_output_tokens from underwriting_setting_versions order by version desc limit 1",
        )
      ).rows[0].max_output_tokens,
      32000,
    );
    await assert.rejects(
      db.query("select save_underwriting_settings($1,$2)", [
        {
          ...settingsInput,
          expected_version: Number(settings.version) + 1,
          max_output_tokens: 32001,
        },
        randomUUID(),
      ]),
      /underwriting_settings_max_output_tokens_check/,
    );
    assert.equal(
      (
        await db.query<{ max_output_tokens: number }>(
          "select max_output_tokens from underwriting_runs where id=$1",
          [runId],
        )
      ).rows[0].max_output_tokens,
      8000,
    );
  } finally {
    await db.close();
  }
});
test("worker persists incomplete-response diagnostics and each downloaded file without resending to OpenAI", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://underwriting-fixture.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-only",
    R_OPENAI_API_KEY: "fixture-only",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, env);
  try {
    const bytes = Buffer.from("%PDF-1.7 fictional input"),
      snapshots = packet().map((d) => ({ ...d, content_hash: hash(bytes) }));
    const source = {
      id: randomUUID(),
      opportunity_id: randomUUID(),
      model: "fixture",
      prompt: "Fixture",
      max_output_tokens: 8000,
      document_snapshot: snapshots,
      lender_snapshot: [],
    };
    const progress: { stage: string; processed: number }[] = [];
    let completion: Record<string, unknown> | null = null,
      calls = 0;
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
            input instanceof Request ? input : new Request(input, init),
          url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : null;
        if (url.hostname === "api.openai.com") {
          calls++;
          return Response.json({
            id: "resp_worker_fixture",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            usage: { input_tokens: 2000, output_tokens: 8000 },
          });
        }
        assert.equal(url.hostname, "underwriting-fixture.example.test");
        if (url.pathname.includes("/storage/v1/")) return new Response(bytes);
        const path = url.pathname.split("/").pop();
        if (path === "begin_underwriting")
          return Response.json({ action: "prepare" });
        if (path === "underwriting_runs") return Response.json(source);
        if (path === "opportunities")
          return Response.json({ company: "Fictional" });
        if (path === "report_underwriting_progress") {
          progress.push(body);
          return Response.json(true);
        }
        if (path === "start_underwriting_api") return Response.json(true);
        if (path === "complete_underwriting") {
          completion = body;
          return Response.json(true);
        }
        throw new Error(`Unexpected fixture path: ${url.pathname}`);
      },
    );
    await processUnderwriting({
      id: randomUUID(),
      lease_token: randomUUID(),
      payload: { run_id: source.id },
    });
    assert.equal(calls, 1);
    assert.deepEqual(
      progress.filter((p) => p.stage === "documents").map((p) => p.processed),
      [0, 1, 2, 3, 4, 5],
    );
    assert.equal(
      (completion as Record<string, unknown> | null)?.failure,
      "OPENAI_OUTPUT_LIMIT_REACHED",
    );
    assert.equal(
      (completion as Record<string, unknown> | null)?.output_count,
      8000,
    );
    assert.equal(
      (completion as Record<string, unknown> | null)?.response,
      "resp_worker_fixture",
    );
    assert.equal((completion as Record<string, unknown> | null)?.value, null);
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
