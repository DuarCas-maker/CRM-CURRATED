import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import * as realDb from "../src/lib/server/supabase";
import * as realCrypto from "../src/lib/server/crypto";
import { withMailQuota } from "../src/lib/server/mail-quota";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";
if (!process.execArgv.includes("--experimental-test-module-mocks"))
  test("campaign signature HTTP and real quota facade isolation", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = execFileSync(
      process.execPath,
      [
        "--import",
        "./tests/offline.mjs",
        "--import",
        "tsx",
        "--experimental-test-module-mocks",
        "--test",
        "tests/campaign-signature.test.ts",
      ],
      { env, encoding: "utf8", timeout: 30000, windowsHide: true },
    );
    assert.match(result, /# fail 0/);
  });
else
  test("signature preview: fixed read, current human scope, quotas and revocation, no send", async (t) => {
    const keys = [
      "SIMPLE_MAIL_ENABLED",
      "MAIL_TRANSPORT_ROUTING_ENABLED",
      "MAIL_QUOTA_POLICY_ENABLED",
      "GOOGLE_OAUTH_ORGANIZATIONS",
      "APP_ORIGIN",
    ];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    Object.assign(process.env, {
      SIMPLE_MAIL_ENABLED: "true",
      MAIL_TRANSPORT_ROUTING_ENABLED: "false",
      MAIL_QUOTA_POLICY_ENABLED: "true",
      APP_ORIGIN: "https://crm.example.test",
      GOOGLE_OAUTH_ORGANIZATIONS: JSON.stringify([
        {
          id: "fixture",
          domain: "example.test",
          clientId: "synthetic",
          clientSecret: "fictional",
          projectId: "fixture-project",
        },
      ]),
    });
    const f = quotaFixture();
    f.deps.uuid = randomUUID;
    const prep = {
        brand_id: randomUUID(),
        brand_revision: 1,
        account_revision: 1,
      },
      account = f.account;
    let authorized = true,
      authStatus = 0,
      role = "superadmin",
      reads = 0,
      wires = 0,
      sdk = 0;
    const scope = {
      account_id: account,
      email: "sender@example.test",
      actor_id: randomUUID(),
      ...prep,
      route_exists: false,
      revision: 0,
      provider: "gmail_oauth",
      managed: false,
    };
    const userDb = {
      rpc: async (name: string) => {
        assert.equal(name, "campaign_signature_scope");
        reads++;
        return authorized
          ? { data: scope, error: null }
          : { data: null, error: { message: "BRAND_DELIVERY_FORBIDDEN" } };
      },
    };
    const service = {
      from: (table: string) => {
        const q = {
          select: () => q,
          eq: () => q,
          single: async () => ({
            data:
              table === "mail_accounts"
                ? { id: account, status: "connected", organization: "fixture" }
                : { encrypted_refresh_token: "synthetic" },
            error: null,
          }),
        };
        return q;
      },
      rpc: async (name: string) => {
        assert.equal(name, "simple_mail_managed");
        return { data: false, error: null };
      },
    };
    const dbMock = mock.module("../src/lib/server/supabase.ts", {
      namedExports: {
        ...realDb,
        serviceClient: () => service,
        requireUser: async () => {
          if (authStatus)
            throw new realDb.HttpError(authStatus, "Session fixture");
          return { db: userDb, profile: { role } };
        },
      },
    });
    const cryptoMock = mock.module("../src/lib/server/crypto.ts", {
      namedExports: { ...realCrypto, decrypt: () => "synthetic-refresh" },
    });
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => {
      sdk++;
      return { token: "synthetic-access" };
    });
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        assert.equal(url.origin, "https://gmail.googleapis.com");
        assert(url.pathname.endsWith("/settings/sendAs/sender%40example.test"));
        assert.equal(init?.method || "GET", "GET");
        wires++;
        return Response.json({
          signature: "<b>Sender Example</b><br>sender@example.test",
          displayName: "Sender Example",
        });
      },
    );
    try {
      const { POST } = await import("../src/app/api/campaigns/signature/route");
      const payload = { account_id: account, brand_preparation: prep };
      const call = (
        body: unknown = payload,
        origin = "https://crm.example.test",
      ) =>
        withMailQuota(f.deps, () =>
          POST(
            new Request("https://crm.example.test/api/campaigns/signature", {
              method: "POST",
              headers: { origin, "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
          ),
        );
      authStatus = 401;
      assert.equal((await call()).status, 401);
      authStatus = 403;
      assert.equal((await call()).status, 403);
      authStatus = 0;
      assert.equal(
        (await call(payload, "https://external.example.test")).status,
        403,
      );
      assert.equal(reads, 0);
      role = "seller";
      assert.equal((await call()).status, 403);
      role = "superadmin";
      assert.equal(wires, 0);
      const ok = await call();
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("cache-control"), "no-store");
      assert.equal((await ok.json()).email, scope.email);
      assert.equal(wires, 1);
      assert.equal(sdk, 1);
      assert(f.calls.some((x) => x.name === "mail_quota_reserve"));
      assert(f.calls.some((x) => x.name === "mail_quota_admit"));
      authorized = false;
      assert.equal((await call()).status, 403);
      assert.equal(wires, 1);
      assert.equal(sdk, 1);
      authorized = true;
      f.wait(10);
      f.afterSleep(async () => {
        authorized = false;
      });
      assert.notEqual((await call()).status, 200);
      assert.equal(wires, 1);
      authorized = true;
      f.wait(0);
      f.afterSleep(async () => {});
      scope.route_exists = true;
      assert.equal((await call()).status, 409);
      assert.equal(wires, 1);
      scope.route_exists = false;
      assert.equal(
        (await call({ ...payload, account_id: randomUUID() })).status,
        409,
      );
      assert.equal(wires, 1);
    } finally {
      dbMock.restore();
      cryptoMock.restore();
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });
