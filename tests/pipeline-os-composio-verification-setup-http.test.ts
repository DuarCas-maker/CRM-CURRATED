import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as supabase from "../src/lib/server/supabase";
import {
  withVerificationSetup,
  verificationSetupPage,
} from "../src/lib/server/mail-accounts/composio-verification-setup";
import { setupFixture } from "./fixtures/composio-verification-setup";

if (!process.execArgv.includes("--experimental-test-module-mocks"))
  test("CT HTTP offline composition", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--import",
        "./tests/offline.mjs",
        "--import",
        "tsx",
        "--test",
        "tests/pipeline-os-composio-verification-setup-http.test.ts",
      ],
      { env, encoding: "utf8", timeout: 60000 },
    );
    assert.match(output, /# fail 0/);
  });
else
  test("CT HTTP session/MFA/admin/Origin, bounded strict requests, no-store and successful human write", async () => {
    const origin = "http://localhost:3000",
      old = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = origin;
    const f = setupFixture();
    let mode = "normal",
      sessions = 0;
    const m = mock.module("../src/lib/server/supabase.ts", {
      namedExports: {
        ...supabase,
        requireUser: async () => {
          sessions++;
          if (mode === "session") throw new supabase.HttpError(401, "SECRET");
          if (mode === "mfa") throw new supabase.HttpError(403, "SECRET");
          return {
            db: f.ports.binding.human,
            profile: {
              role: mode === "seller" ? "seller" : "superadmin",
              active: mode !== "inactive",
            },
          };
        },
      },
    });
    try {
      const route =
        await import("../src/app/api/mail/accounts/[id]/composio/verification-setup/route");
      const ctx = { params: Promise.resolve({ id: f.account }) },
        url =
          origin +
          "/api/mail/accounts/" +
          f.account +
          "/composio/verification-setup";
      const run = <T>(action: () => Promise<T>) =>
        withVerificationSetup(f.ports, action);
      const request = (
        body: string,
        o = origin,
        type = "application/json",
        suffix = "",
      ) =>
        new Request(url + suffix, {
          method: "POST",
          headers: { Origin: o, "Content-Type": type },
          body,
        });
      f.ports.enabled = false;
      assert.equal(
        (await run(() => route.GET(new Request(url), ctx))).status,
        404,
      );
      assert.equal(sessions, 0);
      f.ports.enabled = true;
      for (const [value, status] of [
        ["session", 401],
        ["mfa", 403],
        ["seller", 403],
        ["inactive", 403],
      ] as const) {
        mode = value;
        const r = await run(() => route.GET(new Request(url), ctx));
        assert.equal(r.status, status);
        assert.equal(JSON.stringify(await r.json()).includes("SECRET"), false);
        assert.equal(f.events.length, 0);
      }
      mode = "normal";
      for (const [req, status] of [
        [request("{}", "https://other.example.test"), 403],
        [request("{}", origin, "text/plain"), 400],
        [request("{"), 400],
        [request("{}", origin, "application/json", "?x=1"), 400],
        [request(JSON.stringify({ x: "x".repeat(9000) })), 413],
        [request(JSON.stringify({ action: "unknown" })), 400],
      ] as const) {
        assert.equal((await run(() => route.POST(req, ctx))).status, status);
        assert.equal(f.events.length, 0);
      }
      assert.equal(
        (
          await run(() =>
            route.GET(new Request(url), {
              params: Promise.resolve({ id: randomUUID() }),
            }),
          )
        ).status,
        404,
      );
      assert.equal(f.events.length, 0);
      const r = await run(() => route.GET(new Request(url), ctx));
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "no-store");
      const page = await r.json();
      assert.equal(f.writes.length, 0);
      const b = {
        action: "publish_policy",
        setup_revision: page.setup_revision,
        expected_generation: 0,
        quiescent: true,
        idempotency_key: randomUUID(),
      };
      const saved = await run(() =>
        route.POST(request(JSON.stringify(b)), ctx),
      );
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), {
        action: "publish_policy",
        saved: true,
        transport: "gmail_oauth",
        composio_enabled: false,
      });
      assert.equal(f.writes[0].role, "human");
    } finally {
      m.restore();
      if (old === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = old;
    }
  });
