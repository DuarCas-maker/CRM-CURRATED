import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { AI_SERVICE_KEYS, type AiService } from "../src/lib/ai-usage";
import { aiApiKey } from "../src/lib/server/ai-usage";
import {
  callUnderwritingProvider,
  UnderwritingProviderError,
} from "../src/lib/server/openai-underwriting";
import { featureDatabase } from "./feature-database";

const body = { model: "fixture-model", input: [], store: false, text: {} };
function harness(provider: () => Response, failure?: "start" | "finish") {
  const entries: Record<string, unknown>[] = [],
    finishes: Record<string, unknown>[] = [];
  let providerCalls = 0;
  const headers: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init),
      url = new URL(request.url);
    if (url.hostname === "api.openai.com") {
      providerCalls++;
      headers.push(request.headers.get("authorization") || "");
      return provider();
    }
    assert.equal(url.hostname, "ai-usage-fixture.example.test");
    const value = await request.json();
    if (url.pathname.endsWith("ai_usage_events")) {
      if (failure === "start")
        return Response.json(
          { code: "42P01", message: "fixture missing table" },
          { status: 400 },
        );
      entries.push(value);
      return new Response(null, { status: 201 });
    }
    assert(url.pathname.endsWith("finish_ai_usage_event"));
    finishes.push(value);
    return failure === "finish"
      ? Response.json(
          { message: "fixture connection failure" },
          { status: 500 },
        )
      : Response.json(true);
  };
  const db = createClient(
    "https://ai-usage-fixture.example.test",
    "fixture-only",
    { global: { fetch: fetcher }, auth: { persistSession: false } },
  );
  const usage = (service: AiService) => ({
    db,
    service,
    actorId: randomUUID(),
    opportunityId: randomUUID(),
  });
  return {
    entries,
    finishes,
    headers,
    fetcher,
    usage,
    calls: () => providerCalls,
  };
}
const completed = () =>
  Response.json({
    id: "resp_fixture",
    status: "completed",
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      input_tokens_details: { cached_tokens: 25 },
      output_tokens_details: { reasoning_tokens: 10 },
    },
    output: [{ content: [{ type: "output_text", text: '{"ok":true}' }] }],
  });

test("each service uses its dedicated key, with no fallback, and journals only safe usage metadata", async () => {
  const env = {
    OPENAI_API_KEY: "general-fixture-do-not-use",
    R_OPENAI_API_KEY: "risk-fixture",
    A_OPENAI_API_KEY: " application-fixture ",
    D_OPENAI_API_KEY: "document-fixture",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  try {
    const h = harness(completed);
    for (const service of Object.keys(AI_SERVICE_KEYS) as AiService[]) {
      const key = aiApiKey(service)!;
      assert(key && key !== env.OPENAI_API_KEY);
      await callUnderwritingProvider(body, key, h.fetcher, {
        usage: h.usage(service),
      });
      assert.equal(
        h.headers.at(-1),
        `Bearer ${env[AI_SERVICE_KEYS[service]].trim()}`,
      );
      const entry = h.entries.at(-1)!;
      assert.equal(entry.service, service);
      assert.equal(entry.model, body.model);
      const finish = h.finishes.at(-1)!;
      assert.equal(finish.event_id, entry.id);
      assert.deepEqual(
        { ...(finish.result as object), duration_ms: 0 },
        {
          status: "completed",
          provider_response_id: "resp_fixture",
          input_tokens: 100,
          output_tokens: 20,
          cached_input_tokens: 25,
          reasoning_tokens: 10,
          duration_ms: 0,
          error_code: null,
        },
      );
      delete process.env[AI_SERVICE_KEYS[service]];
      assert.equal(aiApiKey(service), undefined);
      process.env[AI_SERVICE_KEYS[service]] = "   ";
      assert.equal(aiApiKey(service), undefined);
    }
    const recorded = JSON.stringify({
      entries: h.entries,
      finishes: h.finishes,
    });
    assert(!recorded.includes("fixture-do-not-use"));
    assert(!recorded.includes("application-fixture"));
    assert(!recorded.includes("Bearer"));
    assert.equal(h.calls(), 3);
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("incomplete and invalid responses keep known usage; interrupted streams remain unknown, never zero or resent", async () => {
  const cases = [
    {
      provider: () =>
        Response.json({
          id: "resp_incomplete",
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
      code: "OPENAI_OUTPUT_LIMIT_REACHED",
      status: "failed",
      input: 100,
    },
    {
      provider: () =>
        Response.json({
          status: "completed",
          usage: { input_tokens: 80, output_tokens: 30 },
          output: [
            { content: [{ type: "output_text", text: "invalid json" }] },
          ],
        }),
      code: "OPENAI_INVALID_REPORT",
      status: "failed",
      input: 80,
    },
    {
      provider: () =>
        new Response(
          'data: {"type":"response.created","response":{"id":"resp_uncertain","status":"in_progress"}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
      code: "OPENAI_STREAM_INTERRUPTED",
      status: "uncertain",
      input: null,
    },
  ];
  for (const fixture of cases) {
    const h = harness(fixture.provider);
    await assert.rejects(
      callUnderwritingProvider(body, "fixture-only", h.fetcher, {
        usage: h.usage("document_classification"),
      }),
      (error) =>
        error instanceof UnderwritingProviderError &&
        error.code === fixture.code,
    );
    assert.equal(h.calls(), 1);
    assert.equal(h.entries.length, 1);
    assert.equal(h.finishes.length, 1);
    const outcome = h.finishes[0].result as Record<string, unknown>;
    assert.equal(outcome.status, fixture.status);
    assert.equal(outcome.input_tokens, fixture.input);
  }
});

test("accounting must start before OpenAI; a failed final write keeps a durable attempt without discarding or resending the result", async (t) => {
  const noLedger = harness(completed, "start");
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", noLedger.fetcher, {
      usage: noLedger.usage("application_extraction"),
    }),
    /OPENAI_USAGE_UNAVAILABLE/,
  );
  assert.equal(noLedger.calls(), 0);
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logs.push(args));
  const noFinish = harness(completed, "finish");
  const result = await callUnderwritingProvider(
    body,
    "private-key-fixture",
    noFinish.fetcher,
    { usage: noFinish.usage("risk_analysis") },
  );
  assert.deepEqual(result.value, { ok: true });
  assert.equal(noFinish.entries.length, 1);
  assert.equal(noFinish.calls(), 1);
  assert.equal(logs[0][0], "AI_USAGE_FINALIZATION_PENDING");
  assert(!JSON.stringify(logs).includes("private-key-fixture"));
});

test("usage ledger enforces service-only writes, MFA superadmin reads, immutable finalization and full-period totals", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const id = randomUUID();
    await db.exec("set role service_role");
    await db.query(
      "insert into ai_usage_events(id,service,model,actor_id) values($1,'application_extraction','fixture',$2)",
      [id, users.admin],
    );
    const final = {
      status: "completed",
      input_tokens: 100,
      output_tokens: 20,
      cached_input_tokens: 30,
      reasoning_tokens: 10,
      duration_ms: 5,
    };
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select finish_ai_usage_event($1,$2) ok",
          [id, final],
        )
      ).rows[0].ok,
      true,
    );
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select finish_ai_usage_event($1,$2) ok",
          [id, { ...final, input_tokens: 200 }],
        )
      ).rows[0].ok,
      false,
    );
    assert.equal(
      (
        await db.query<{ input_tokens: number }>(
          "select input_tokens from ai_usage_events where id=$1",
          [id],
        )
      ).rows[0].input_tokens,
      100,
    );
    await assert.rejects(
      db.query("update ai_usage_events set input_tokens=500 where id=$1", [id]),
      /permission denied/,
    );
    const invalid = randomUUID();
    await db.query(
      "insert into ai_usage_events(id,service,model) values($1,'risk_analysis','fixture')",
      [invalid],
    );
    await assert.rejects(
      db.query("select finish_ai_usage_event($1,$2)", [
        invalid,
        { ...final, cached_input_tokens: 101 },
      ]),
      /check constraint/,
    );
    for (let i = 0; i < 60; i++) {
      await db.query(
        "insert into ai_usage_events(id,service,model) values($1,'document_classification','fixture')",
        [randomUUID()],
      );
    }
    await db.query(
      "insert into ai_usage_events(id,service,model,started_at) values($1,'document_classification','old',now()-interval '100 days')",
      [randomUUID()],
    );
    await asUser(users.seller);
    assert.equal(
      (await db.query("select * from ai_usage_events")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select ai_usage_summary(30)"),
      /Superadmin required/,
    );
    await assert.rejects(
      db.query(
        "insert into ai_usage_events(id,service,model) values($1,'risk_analysis','fixture')",
        [randomUUID()],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select finish_ai_usage_event($1,$2)", [id, final]),
      /permission denied/,
    );
    await asUser(users.admin, "aal1");
    assert.equal(
      (await db.query("select * from ai_usage_events")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select ai_usage_summary(30)"),
      /Superadmin required/,
    );
    await asUser(users.admin);
    const result = (
      await db.query<{
        result: {
          summary: {
            service: string;
            calls: number;
            unknown_usage: number;
            input_tokens: number;
          }[];
          events: unknown[];
        };
      }>("select ai_usage_summary(30) result")
    ).rows[0].result;
    assert.equal(result.events.length, 50);
    assert.equal(
      result.summary.find((row) => row.service === "document_classification")
        ?.calls,
      60,
    );
    assert.equal(
      result.summary.find((row) => row.service === "document_classification")
        ?.unknown_usage,
      60,
    );
    assert.equal(
      result.summary.find((row) => row.service === "application_extraction")
        ?.input_tokens,
      100,
    );
    await assert.rejects(
      db.query("select ai_usage_summary(91)"),
      /Invalid date range/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select * from ai_usage_events"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
