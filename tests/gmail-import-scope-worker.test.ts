import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { reconcileImportAttachments } from "../worker/gmail-import-scope";

test("attachment counter repair only advances after a complete batch and deduplicates replayed pages", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://scope-fixture.supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-only",
  };
  const prior = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  try {
    const candidates = Array.from({ length: 50 }, () => ({ id: randomUUID() }));
    let fail = true,
      writes = 0;
    const jobs: { dedupe_key: string; payload: { after: string } }[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        assert.equal(
          url.hostname,
          "scope-fixture.supabase.test",
          "Repair never fetches Gmail files or uploads documents",
        );
        const resource = url.pathname.split("/").at(-1);
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (resource === "gmail_candidates") return Response.json(candidates);
        if (resource === "gmail_refresh_candidate_thread_stats") {
          assert(candidates.some((c) => c.id === body.candidate));
          if (fail && ++writes === 4)
            return Response.json(
              { message: "Interrupted fixture" },
              { status: 500 },
            );
          return Response.json(null);
        }
        if (resource === "jobs") {
          jobs.push(body);
          return Response.json(null);
        }
        throw Error(`Unexpected resource ${resource}`);
      },
    );
    await assert.rejects(
      reconcileImportAttachments({}),
      /DATABASE_OPERATION_FAILED/,
    );
    assert.equal(jobs.length, 0);
    fail = false;
    await reconcileImportAttachments({});
    await reconcileImportAttachments({});
    assert.equal(jobs[0].payload.after, candidates.at(-1)!.id);
    assert.equal(jobs[0].dedupe_key, jobs[1].dedupe_key);
  } finally {
    for (const key of Object.keys(env)) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
});
