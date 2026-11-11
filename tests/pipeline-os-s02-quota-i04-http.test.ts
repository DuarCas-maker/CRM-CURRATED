import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as supabase from "../src/lib/server/supabase";
import {
  withBindingV2,
  type BindingV2Ports,
} from "../src/lib/server/mail-accounts/composio-binding-v2";
import { withMailQuota } from "../src/lib/server/mail-quota";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";

if (!process.execArgv.includes("--experimental-test-module-mocks"))
  test("I04 HTTP offline composition", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--import",
        "./.local/pipeline-os/s02-i01/offline.mjs",
        "--import",
        "tsx",
        "--test",
        "tests/pipeline-os-s02-quota-i04-http.test.ts",
      ],
      { env, encoding: "utf8", timeout: 60000 },
    );
    assert.match(output, /# fail 0/);
  });
else
  test("I04 HTTP: strict version, Origin, session/MFA/admin and fail-closed unavailable checks", async () => {
    const account = randomUUID(),
      origin = "http://localhost:3000";
    const old = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = origin;
    let mode = "normal",
      calls = 0,
      factories = 0;
    const db = {
      rpc: async () => {
        calls++;
        return { data: null, error: { message: "C_BINDING_UNAVAILABLE" } };
      },
    } as unknown as BindingV2Ports["human"];
    const m = mock.module("../src/lib/server/supabase.ts", {
      namedExports: {
        ...supabase,
        requireUser: async () => {
          if (mode === "session") throw new supabase.HttpError(401, "secret");
          if (mode === "mfa") throw new supabase.HttpError(403, "secret");
          return {
            db,
            profile: {
              role: mode === "seller" ? "seller" : "superadmin",
              active: true,
            },
          };
        },
      },
    });
    try {
      const route =
        await import("../src/app/api/mail/accounts/[id]/composio/route");
      const check =
        await import("../src/app/api/mail/accounts/[id]/composio/check/route");
      const context = { params: Promise.resolve({ id: account }) };
      const ports: BindingV2Ports = {
        enabled: true,
        checksEnabled: false,
        human: db,
        service: () => {
          factories++;
          throw Error("NO_FACTORY");
        },
        descriptor: () => {
          throw Error("NO_DESCRIPTOR");
        },
        apiKey: () => {
          throw Error("NO_KEY");
        },
        now: Date.now,
        fetchImpl: async () => {
          throw Error("NO_WIRE");
        },
      };
      const request = (body: unknown, o = origin) =>
        new Request(origin + "/api/mail/accounts/" + account + "/composio", {
          method: "POST",
          headers: { Origin: o, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      const run = <T>(f: () => Promise<T>) =>
        withMailQuota(quotaFixture().deps, () => withBindingV2(ports, f));
      const body = {
        contract_version: 2,
        binding_id: randomUUID(),
        expected: {
          expected_head_revision: 1,
          expected_account_revision: 1,
          expected_brand_revision: 1,
          expected_context_hash: "a".repeat(64),
        },
        idempotency_key: randomUUID(),
      };
      for (const [value, status] of [
        ["session", 401],
        ["mfa", 403],
        ["seller", 403],
      ] as const) {
        mode = value;
        assert.equal(
          (await run(() => check.POST(request(body), context))).status,
          status,
        );
        assert.equal(calls, 0);
      }
      mode = "normal";
      assert.equal(
        (
          await run(() =>
            check.POST(request(body, "https://other.example.test"), context),
          )
        ).status,
        403,
      );
      assert.equal(calls, 0);
      assert.equal(
        (await run(() => route.POST(request({ contract_version: 3 }), context)))
          .status,
        400,
      );
      assert.equal(calls, 0);
      assert.equal(
        (
          await run(() =>
            route.GET(new Request(origin + "/?contract_version=3"), context),
          )
        ).status,
        400,
      );
      assert.equal(calls, 0);
      const malformed = new Request(origin, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "{",
      });
      assert.equal(
        (await run(() => check.POST(malformed, context))).status,
        400,
      );
      const response = await run(() => check.POST(request(body), context));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(factories, 0);
      assert.equal(
        JSON.stringify(await response.json()).includes("secret"),
        false,
      );
    } finally {
      m.restore();
      if (old === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = old;
    }
  });
