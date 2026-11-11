import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import * as originalDb from "../src/lib/server/supabase";
import * as originalCrypto from "../src/lib/server/crypto";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";
import { withMailQuota } from "../src/lib/server/mail-quota";
import { withMailboxScope } from "../src/lib/server/mail-transport/mailbox-context";
import {
  withMailRuntime,
  type RuntimeDependencies,
} from "../src/lib/server/mail-transport/runtime-context";
if (!process.execArgv.includes("--experimental-test-module-mocks")) {
  test("QGR-I03 facade integration in an isolated process", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--experimental-test-module-mocks",
        "--test",
        "tests/pipeline-os-s02-quota-facade.test.ts",
      ],
      { env, encoding: "utf8", timeout: 30000, windowsHide: true },
    );
    assert.match(output, /# fail 0/);
  });
} else
  test("QGR-I03 real gmail facade with mocked clients only", async (t) => {
    const oldOrg = process.env.GOOGLE_OAUTH_ORGANIZATIONS,
      oldRouting = process.env.MAIL_TRANSPORT_ROUTING_ENABLED;
    process.env.MAIL_TRANSPORT_ROUTING_ENABLED = "false";
    process.env.GOOGLE_OAUTH_ORGANIZATIONS = JSON.stringify([
      {
        id: "fixture",
        domain: "example.test",
        clientId: "fixture-client",
        clientSecret: "fictional-secret",
        projectId: "fixture-project",
      },
    ]);
    let f = quotaFixture(),
      dbReads = 0,
      sdk = 0,
      wires = 0,
      legacy = 0,
      revoked = false,
      wireFailure = false;
    const client = {
      from: (table: string) => {
        dbReads++;
        const q = {
          select: () => q,
          eq: () => q,
          single: async () => ({
            data:
              table === "mail_accounts"
                ? {
                    id: f.account,
                    status: "connected",
                    organization: "fixture",
                  }
                : { encrypted_refresh_token: "fictional-not-a-token" },
            error: null,
          }),
        };
        return q;
      },
      rpc: async (name: string) => {
        assert.equal(name, "reserve_gmail_api");
        legacy++;
        return { data: 0, error: null };
      },
    };
    const dbMock = mock.module("../src/lib/server/supabase.ts", {
      namedExports: { ...originalDb, serviceClient: () => client },
    });
    const cryptoMock = mock.module("../src/lib/server/crypto.ts", {
      namedExports: { ...originalCrypto, decrypt: () => "synthetic-refresh" },
    });
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => {
      sdk++;
      return { token: "synthetic-token" };
    });
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
      assert.equal(
        new URL(String(input)).origin,
        "https://gmail.googleapis.com",
      );
      wires++;
      if (wireFailure) throw Error("fixture network failure");
      return Response.json({ historyId: "1" });
    });
    const reset = () => {
      f = quotaFixture();
      dbReads = 0;
      sdk = 0;
      wires = 0;
      legacy = 0;
      revoked = false;
      wireFailure = false;
    };
    const scoped = <T>(fn: () => Promise<T>) =>
      withMailQuota(f.deps, () =>
        withMailboxScope(
          { account: f.account, revision: 1, validate: async () => !revoked },
          fn,
        ),
      );
    try {
      const { gmail } = await import("../src/lib/server/google.ts");
      await t.test(
        "flag off retains one legacy reservation and direct emission",
        async () => {
          reset();
          f.deps.enabled = false;
          await scoped(() => gmail(f.account, "profile"));
          assert.equal(legacy, 1);
          assert.equal(wires, 1);
          assert.equal(f.calls.length, 0);
        },
      );
      await t.test(
        "v2 uses the common RPC once with exact cost; no legacy double charge",
        async () => {
          reset();
          await scoped(() => gmail(f.account, "messages/a1/attachments/part"));
          assert.equal(legacy, 0);
          assert.equal(wires, 1);
          const r = f.calls.filter((c) => c.name === "mail_quota_reserve");
          assert.equal(r.length, 1);
          assert.equal(r[0].input.units, 20);
          assert.equal(r[0].input.direct_project, "fixture-project");
        },
      );
      await t.test(
        "missing server authority blocks before token/DB/HTTP",
        async () => {
          reset();
          await withMailQuota(f.deps, () =>
            assert.rejects(gmail(f.account, "profile"), /QGR_DENIED/),
          );
          assert.deepEqual([dbReads, sdk, wires], [0, 0, 0]);
        },
      );
      await t.test(
        "permission revoked while waiting cancels before wire",
        async () => {
          reset();
          f.wait(10);
          f.afterSleep(async () => {
            revoked = true;
          });
          await scoped(() => assert.rejects(gmail(f.account, "profile")));
          assert.equal(wires, 0);
        },
      );
      await t.test(
        "final caller guard can invalidate a policy before emission",
        async () => {
          reset();
          await scoped(() =>
            assert.rejects(
              gmail(f.account, "profile", {}, async () => {
                f.policy = { ...f.policy, generation: 2 };
              }),
              /QGR_STALE/,
            ),
          );
          assert.equal(wires, 0);
        },
      );
      await t.test(
        "routed facade reserves against the actual runtime attempt",
        async () => {
          reset();
          const id = randomUUID();
          const deps: RuntimeDependencies = {
            composioEnabled: false,
            configuration: () => null,
            fetchImpl: async () => {
              throw Error("unexpected proxy");
            },
            now: () => Date.now(),
            rpc: async (name, p) => {
              if (name === "mail_transport_snapshot")
                return {
                  account_id: f.account,
                  provider: "gmail_oauth",
                  revision: 1,
                  verification_context_hash: null,
                  config_generation: 0,
                  project_id: null,
                  auth_config_id: null,
                  quota_project_id: null,
                };
              if (name === "mail_transport_acquire")
                return {
                  id,
                  account_id: f.account,
                  provider: "gmail_oauth",
                  revision: 1,
                  operation: p.operation,
                  resource: p.resource,
                  deadline: new Date(Date.now() + 30000).toISOString(),
                  binding: null,
                };
              if (name === "mail_transport_validate_context") return true;
              if (name === "mail_transport_finish") return null;
              throw Error("unexpected RPC");
            },
          };
          await withMailQuota(f.deps, () =>
            withMailRuntime(deps, () => gmail(f.account, "profile")),
          );
          assert.equal(
            f.calls.find((c) => c.name === "mail_quota_reserve")!.input
              .request_key,
            id,
          );
          assert.equal(legacy, 0);
          assert.equal(wires, 1);
        },
      );
      await t.test(
        "uncertain direct emission never retries or switches provider",
        async () => {
          reset();
          wireFailure = true;
          await scoped(() =>
            assert.rejects(
              gmail(f.account, "messages/send", { method: "POST", body: "{}" }),
            ),
          );
          assert.equal(wires, 1);
          assert.equal(legacy, 0);
        },
      );
    } finally {
      dbMock.restore();
      cryptoMock.restore();
      if (oldOrg === undefined) delete process.env.GOOGLE_OAUTH_ORGANIZATIONS;
      else process.env.GOOGLE_OAUTH_ORGANIZATIONS = oldOrg;
      if (oldRouting === undefined)
        delete process.env.MAIL_TRANSPORT_ROUTING_ENABLED;
      else process.env.MAIL_TRANSPORT_ROUTING_ENABLED = oldRouting;
    }
  });
