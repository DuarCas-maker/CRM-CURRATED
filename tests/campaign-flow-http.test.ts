import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { defaultReminders } from "../src/lib/campaign-flow";
if (!process.execArgv.includes("--experimental-test-module-mocks"))
  test("CF HTTP: real route rejects unauthorized origins and unavailable schema", () => {
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
        "tests/campaign-flow-http.test.ts",
      ],
      { env, encoding: "utf8", windowsHide: true, timeout: 30000 },
    );
    assert.match(result, /# fail 0/);
  });
else
  test("CF HTTP: session, MFA, exact origin, bounded body, merge fields, replay envelope and fail closed", async () => {
    const real = await import("../src/lib/server/supabase");
    let authStatus = 401,
      role = "superadmin",
      authCalls = 0,
      rpcCalls = 0,
      missing = false;
    const origin = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "https://crm.example.test";
    const account = randomUUID(),
      actor = randomUUID(),
      brand = randomUUID();
    const session = mock.module("../src/lib/server/supabase.ts", {
      namedExports: {
        ...real,
        requireUser: async () => {
          authCalls++;
          if (authStatus)
            throw new real.HttpError(authStatus, "Session fixture");
          return {
            profile: { role },
            db: {
              rpc: async (name: string) => {
                rpcCalls++;
                return missing
                  ? {
                      data: null,
                      error: { code: "PGRST202", message: "missing" },
                    }
                  : {
                      data:
                        name === "brand_prepare_context"
                          ? {
                              version: 1,
                              brand_id: brand,
                              brand_code: "fixture",
                              brand_name: "Fixture",
                              brand_revision: 1,
                              account_id: account,
                              account_revision: 1,
                              actor_id: actor,
                              purpose: "campaign",
                              authorization: "human_aal2",
                              prepared_at: "2026-11-17T12:00:00Z",
                            }
                          : { ok: true },
                      error: null,
                    };
              },
            },
          };
        },
      },
    });
    try {
      const route = await import("../src/app/api/campaigns/flow/route"),
        url = "https://crm.example.test/api/campaigns/flow";
      assert.equal((await route.GET(new Request(url))).status, 401);
      authStatus = 403;
      assert.equal((await route.GET(new Request(url))).status, 403);
      authStatus = 0;
      const body = {
        request_key: randomUUID(),
        payload: {
          account_id: account,
          brand_preparation: {
            brand_id: brand,
            brand_revision: 1,
            account_revision: 1,
          },
          template_id: randomUUID(),
          template_version: 1,
          contact_ids: [randomUUID()],
          scheduled_at: "2026-11-19T15:00:00Z",
          timezone: "America/Bogota",
          reminders: defaultReminders,
        },
      };
      const post = (
        from: string | null,
        text = JSON.stringify(body),
        type = "application/json",
      ) =>
        route.POST(
          new Request(url, {
            method: "POST",
            headers: {
              ...(from ? { origin: from } : {}),
              "content-type": type,
            },
            body: text,
          }),
        );
      const before = authCalls;
      assert.equal((await post("https://other.example.test")).status, 403);
      assert.equal((await post(null)).status, 403);
      assert.equal(authCalls, before);
      assert.equal((await post("https://crm.example.test", "{")).status, 400);
      assert.equal(
        (await post("https://crm.example.test", "x".repeat(100001))).status,
        413,
      );
      assert.equal(
        (
          await post(
            "https://crm.example.test",
            JSON.stringify(body),
            "text/plain",
          )
        ).status,
        400,
      );
      role = "seller";
      const count = rpcCalls;
      assert.equal((await post("https://crm.example.test")).status, 403);
      assert.equal(rpcCalls, count);
      role = "superadmin";
      assert.equal((await post("https://crm.example.test")).status, 200);
      missing = true;
      assert.equal((await route.GET(new Request(url))).status, 503);
    } finally {
      session.restore();
      if (origin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = origin;
    }
  });
