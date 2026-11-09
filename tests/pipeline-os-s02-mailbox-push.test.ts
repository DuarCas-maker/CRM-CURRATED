import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as supabase from "../src/lib/server/supabase";
import {
  withMailRuntime,
  type RuntimeDependencies,
} from "../src/lib/server/mail-transport/runtime-context";
if (!process.execArgv.includes("--experimental-test-module-mocks"))
  test("R06-I03 push test isolated mock process", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const imports = process.execArgv.flatMap((a, i) =>
      a === "--import" && process.execArgv[i + 1]?.endsWith("offline.mjs")
        ? ["--import", process.execArgv[i + 1]]
        : [],
    );
    assert.match(
      execFileSync(
        process.execPath,
        [
          "--experimental-test-module-mocks",
          ...imports,
          "--import",
          "tsx",
          "--test",
          "tests/pipeline-os-s02-mailbox-push.test.ts",
        ],
        { env, encoding: "utf8", timeout: 90000 },
      ),
      /# fail 0/,
    );
  });
else
  test("R06-I03 authenticated old push does not enqueue for proxy, paused or stale route", async (t) => {
    const names = [
      "GMAIL_SYNC_MODE",
      "GOOGLE_PUBSUB_AUDIENCE",
      "GOOGLE_PUBSUB_SERVICE_ACCOUNT",
      "GMAIL_HISTORY_ENABLED",
    ];
    const prior = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    process.env.GMAIL_SYNC_MODE = "pubsub";
    process.env.GOOGLE_PUBSUB_AUDIENCE = "https://fixture.test/api/gmail/push";
    process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT = "pubsub@fiction.test";
    process.env.GMAIL_HISTORY_ENABLED = "true";
    const account = randomUUID(),
      jobs: Record<string, unknown>[] = [],
      calls: string[] = [];
    let revision: number | null = null;
    const deps: RuntimeDependencies = {
      composioEnabled: false,
      configuration: () => null,
      fetchImpl: async () => {
        throw Error("NO_PROVIDER");
      },
      now: Date.now,
      rpc: async (name, p) => {
        calls.push(name);
        assert.equal(p.account, account);
        return revision;
      },
    };
    const auth = mock.module("google-auth-library", {
      namedExports: {
        OAuth2Client: class {
          async verifyIdToken() {
            return {
              getPayload: () => ({
                email: "pubsub@fiction.test",
                email_verified: true,
              }),
            };
          }
        },
      },
    });
    const dbmock = mock.module("../src/lib/server/supabase.ts", {
      namedExports: {
        ...supabase,
        serviceClient: () => ({
          from: (table: string) => {
            if (table === "jobs")
              return {
                upsert: async (job: Record<string, unknown>) => {
                  jobs.push(job);
                  return { data: null, error: null };
                },
              };
            assert.equal(table, "mail_accounts");
            const query = {
              select() {
                return query;
              },
              eq() {
                return query;
              },
              maybeSingle: async () => ({ data: { id: account }, error: null }),
            };
            return query;
          },
        }),
      },
    });
    try {
      const { POST } = await import("../src/app/api/gmail/push/route");
      const request = () =>
        new Request("https://fixture.test/api/gmail/push", {
          method: "POST",
          headers: { Authorization: "Bearer fixture" },
          body: JSON.stringify({
            message: {
              messageId: randomUUID(),
              data: Buffer.from(
                JSON.stringify({
                  emailAddress: "mailbox@fiction.test",
                  historyId: "12345678901234567890",
                }),
              ).toString("base64"),
            },
          }),
        });
      await t.test("non-direct route acknowledged without jobs", async () => {
        const r = await withMailRuntime(deps, () => POST(request()));
        assert.equal(r.status, 204);
        assert.equal(jobs.length, 0);
        assert.deepEqual(calls, ["mail_direct_job"]);
      });
      await t.test("direct route stamps current revision on job", async () => {
        revision = 9;
        const r = await withMailRuntime(deps, () => POST(request()));
        assert.equal(r.status, 204);
        assert.equal(jobs.length, 1);
        assert.deepEqual(jobs[0].payload, {
          account_id: account,
          route_revision: 9,
        });
      });
      await t.test("store failure cannot enqueue a fallback job", async () => {
        const fail = {
          ...deps,
          rpc: async () => {
            throw Error("fixture failure");
          },
        };
        const r = await withMailRuntime(fail, () => POST(request()));
        assert.equal(r.status, 500);
        assert.equal(jobs.length, 1);
      });
    } finally {
      auth.restore();
      dbmock.restore();
      for (const n of names) {
        if (prior[n] === undefined) delete process.env[n];
        else process.env[n] = prior[n];
      }
    }
  });
