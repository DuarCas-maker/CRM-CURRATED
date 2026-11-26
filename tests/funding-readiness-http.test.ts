import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { defaultReminders } from "../src/lib/campaign-sequence";
if (!process.execArgv.includes("--experimental-test-module-mocks")) {
  test("read-only review route preserves session, origin and bounded input gates", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = execFileSync(
      process.execPath,
      [
        "--import",
        "./tests/offline.mjs",
        "--import",
        "tsx",
        "--experimental-test-module-mocks",
        "--test",
        "tests/funding-readiness-http.test.ts",
      ],
      { env, encoding: "utf8", windowsHide: true, timeout: 30000 },
    );
    assert.match(r, /# fail 0/);
  });
} else {
  test("actual check endpoint is fail closed and calls only a review RPC", async () => {
    const real = await import("../src/lib/server/supabase");
    let status = 401,
      role = "superadmin",
      rpcCalls = 0,
      missing = false;
    const previous = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "https://crm.example.test";
    const session = mock.module("../src/lib/server/supabase.ts", {
      namedExports: {
        ...real,
        requireUser: async () => {
          if (status) throw new real.HttpError(status, "fixture");
          return {
            profile: { role },
            db: {
              rpc: async (name: string) => {
                rpcCalls++;
                assert.equal(name, "campaign_template_readiness");
                return missing
                  ? {
                      error: { code: "PGRST202", message: "missing" },
                      data: null,
                    }
                  : {
                      data: {
                        checked_count: 1,
                        ready_count: 0,
                        attention_count: 1,
                        rows: [],
                      },
                      error: null,
                    };
              },
            },
          };
        },
      },
    });
    try {
      const { POST } =
        await import("../src/app/api/campaigns/flow/check/route");
      const p = {
        account_id: randomUUID(),
        template_id: randomUUID(),
        template_version: 1,
        contact_ids: [randomUUID()],
        reminders: defaultReminders,
      };
      const req = (body: unknown = p, origin = "https://crm.example.test") =>
        new Request("https://crm.example.test/api/campaigns/flow/check", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      assert.equal((await POST(req(p, "https://evil.example"))).status, 403);
      assert.equal((await POST(req())).status, 401);
      assert.equal(rpcCalls, 0);
      status = 0;
      role = "seller";
      assert.equal((await POST(req())).status, 403);
      role = "superadmin";
      assert.equal((await POST(req())).status, 200);
      assert.equal(rpcCalls, 1);
      assert.equal(
        (
          await POST(
            req({ ...p, contact_ids: [p.contact_ids[0], p.contact_ids[0]] }),
          )
        ).status,
        400,
      );
      assert.equal(
        (await POST(req({ padding: "x".repeat(100001) }))).status,
        413,
      );
      missing = true;
      assert.equal((await POST(req())).status, 503);
      assert.equal(rpcCalls, 2);
    } finally {
      session.restore();
      if (previous === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = previous;
    }
  });
}
