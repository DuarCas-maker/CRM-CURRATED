import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { encrypt } from "../src/lib/server/crypto";
import {
  reconcileEngagement,
  linkEngagementThread,
} from "../worker/gmail-engagement";

test("classification backfill and full-thread linking retain their durable cursor on failure and paginate idempotently", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://engagement.supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
  };
  const prior = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  try {
    const rows = Array.from({ length: 25 }, () => ({
      id: randomUUID(),
      encrypted_payload: encrypt(
        JSON.stringify({
          body: "Envíame información",
          direction: "inbound",
          nature: "personal",
          participants: [{ email: "client@example.test", role: "from" }],
        }),
      ),
    }));
    let failure = true,
      writes = 0;
    const jobs: {
      kind: string;
      payload: { phase?: string; after?: string };
      dedupe_key: string;
    }[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        assert.equal(
          url.hostname,
          "engagement.supabase.test",
          "No classifier or Gmail call is needed for stored evidence",
        );
        const resource = url.pathname.split("/").at(-1);
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (resource === "gmail_archive_messages") return Response.json(rows);
        if (resource === "gmail_record_reply") {
          assert.equal(body.intent, "positive");
          if (failure && ++writes === 4)
            return Response.json(
              { message: "Write interrupted" },
              { status: 500 },
            );
          return Response.json(null);
        }
        if (
          [
            "gmail_associate_continuous",
            "gmail_link_message",
            "gmail_process_live_reply",
          ].includes(resource || "")
        )
          return Response.json(null);
        if (resource === "jobs") {
          jobs.push(body);
          return Response.json(null);
        }
        throw Error(`Unexpected fixture resource: ${resource}`);
      },
    );
    await assert.rejects(
      reconcileEngagement({ phase: "archive" }),
      /DATABASE_OPERATION_FAILED/,
    );
    assert.equal(
      jobs.length,
      0,
      "A failed batch must not enqueue the next cursor",
    );
    failure = false;
    await reconcileEngagement({ phase: "archive" });
    await reconcileEngagement({ phase: "archive" });
    assert.equal(jobs[0].payload.after, rows.at(-1)!.id);
    assert.equal(
      jobs[0].dedupe_key,
      jobs[1].dedupe_key,
      "A replay uses the same next-job identity",
    );
    const thread = {
      account_id: randomUUID(),
      thread_id: "old-thread",
      opportunity_id: randomUUID(),
    };
    await linkEngagementThread(thread);
    await linkEngagementThread(thread);
    assert.equal(jobs[2].payload.after, rows.at(-1)!.id);
    assert.equal(jobs[2].dedupe_key, jobs[3].dedupe_key);
  } finally {
    for (const key of Object.keys(env)) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
});
