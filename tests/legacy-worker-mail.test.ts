import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import * as realDb from "../src/lib/server/supabase";
import * as realCrypto from "../src/lib/server/crypto";
import { withMailQuota } from "../src/lib/server/mail-quota";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";

if (!process.execArgv.includes("--experimental-test-module-mocks")) {
  test("legacy worker facade isolation", () => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = execFileSync(process.execPath, ["--import", "./tests/offline.mjs", "--import", "tsx", "--experimental-test-module-mocks", "--test", "tests/legacy-worker-mail.test.ts"], { env, encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.match(result, /# fail 0/);
  });
} else test("legacy worker real Gmail facade: scoped quota path, revocation and dispatch dedupe", async (t) => {
  const keys = ["SIMPLE_MAIL_ENABLED", "SIMPLE_MAIL_COMPOSIO_ENABLED", "MAIL_TRANSPORT_ROUTING_ENABLED", "MAIL_QUOTA_POLICY_ENABLED", "GOOGLE_OAUTH_ORGANIZATIONS"];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { SIMPLE_MAIL_ENABLED: "true", SIMPLE_MAIL_COMPOSIO_ENABLED: "false", MAIL_TRANSPORT_ROUTING_ENABLED: "false", MAIL_QUOTA_POLICY_ENABLED: "true", GOOGLE_OAUTH_ORGANIZATIONS: JSON.stringify([{ id: "fixture", domain: "example.test", clientId: "fixture-client", clientSecret: "fictional", projectId: "fixture-project" }]) });
  let f = quotaFixture(), allowed = true, sdk = 0, wires = 0, proofReads = 0;
  f.deps.uuid = randomUUID;
  const job = { id: randomUUID(), lease_token: randomUUID(), kind: "gmail_sending_usage", payload: { account_id: f.account } };
  const client = {
    from: (table: string) => {
      const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: table === "mail_accounts" ? { id: f.account, status: "connected", organization: "fixture" } : { encrypted_refresh_token: "fictional-not-a-token" }, error: null }) };
      return chain;
    },
    rpc: async (name: string, args: any) => {
      if (name === "simple_mail_managed") return { data: false, error: null };
      assert.equal(name, "legacy_worker_mail_context");
      assert.equal(args.account, f.account); proofReads++;
      return { data: allowed ? "a".repeat(64) : null, error: null };
    },
  };
  const dbMock = mock.module("../src/lib/server/supabase.ts", { namedExports: { ...realDb, serviceClient: () => client } });
  const cryptoMock = mock.module("../src/lib/server/crypto.ts", { namedExports: { ...realCrypto, decrypt: () => "synthetic-refresh" } });
  t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => { sdk++; return { token: "synthetic-access" }; });
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new URL(String(input)).origin, "https://gmail.googleapis.com");
    assert(["GET", "POST"].includes(init?.method || "GET")); wires++;
    return Response.json({ messages: [], id: "fixture-message", threadId: "fixture-thread" });
  });
  try {
    const { gmail } = await import("../src/lib/server/google");
    const { withLegacyWorkerJob, withLegacyWorkerDispatch, withLegacyWorkerReconciliation } = await import("../src/lib/server/mail-transport/legacy-worker-context");
    const scoped = <T>(fn: () => Promise<T>) => withMailQuota(f.deps, () => withLegacyWorkerJob(job, fn));
    await assert.rejects(withMailQuota(f.deps, () => gmail(f.account, "profile")), /QGR_DENIED/);
    assert.equal(sdk, 0); assert.equal(wires, 0);
    await scoped(() => gmail(f.account, "messages?q=in%3Asent&maxResults=50"));
    assert.equal(wires, 1); assert.equal(sdk, 1); assert(proofReads >= 3);
    assert(f.calls.some(x => x.name === "mail_quota_reserve"));
    assert(f.calls.some(x => x.name === "mail_quota_admit"));
    const before = wires;
    await assert.rejects(scoped(() => gmail(randomUUID(), "profile")), /QGR_DENIED/);
    await assert.rejects(scoped(() => gmail(f.account, "messages/send", { method: "POST", body: "{}" })), /QGR_DENIED/);
    await assert.rejects(scoped(() => gmail(f.account, "settings/sendAs/example%40example.test")), /QGR_DENIED/);
    assert.equal(wires, before);
    allowed = false;
    await assert.rejects(scoped(() => gmail(f.account, "profile")), /QGR_DENIED/);
    assert.equal(wires, before); assert.equal(sdk, 1);
    allowed = true;
    f.wait(10);
    f.afterSleep(async () => { allowed = false; });
    await assert.rejects(scoped(() => gmail(f.account, "profile")), /R06_DENIED/);
    assert.equal(wires, before);
    allowed = true; f.wait(0); f.afterSleep(async () => {});
    await withMailQuota(f.deps, () => withLegacyWorkerDispatch(f.account, randomUUID(), randomUUID(), async () => {
      await gmail(f.account, "settings/sendAs/fixture%40example.test");
      await gmail(f.account, "messages/send", { method: "POST", body: JSON.stringify({ raw: "ZmljdGlvbmFs" }) });
      await assert.rejects(gmail(f.account, "messages/send", { method: "POST", body: "{}" }), /QGR_DENIED/);
    }));
    assert.equal(wires, before + 2);
    await withMailQuota(f.deps, () => withLegacyWorkerReconciliation(f.account, randomUUID(), async () => {
      await gmail(f.account, "messages?q=in%3Asent");
      await assert.rejects(gmail(f.account, "messages/send", { method: "POST", body: "{}" }), /QGR_DENIED/);
    }));
    assert.equal(wires, before + 3);
    assert.equal(f.legacy, 0);
  } finally {
    dbMock.restore(); cryptoMock.restore();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
