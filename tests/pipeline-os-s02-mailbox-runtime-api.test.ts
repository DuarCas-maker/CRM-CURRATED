import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as supabase from "../src/lib/server/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commandTransportSelection,
  reviewTransportSelection,
} from "../src/lib/server/mail-accounts/transport-selection";
const account = randomUUID();
const fixture = () => ({
  selection: {
    account_id: account,
    provider: "gmail_oauth",
    state: "ready",
    revision: 1,
    target_provider: null,
    binding_id: null,
  },
  expected: {
    expected_revision: 1,
    expected_head_revision: 0,
    expected_account_revision: 1,
    expected_brand_revision: 1,
    expected_config_generation: 0,
    expected_context_hash: "a".repeat(64),
  },
  receive_enabled: true,
  unresolved: false,
  current: true,
  eligible_direct: true,
  binding_verified: false,
});
test("R06-I03 safe review helper rejects unexpected DB fields and wrong account", async () => {
  const db = (data: unknown) =>
    ({ rpc: async () => ({ data, error: null }) }) as unknown as SupabaseClient;
  const good = await reviewTransportSelection(db(fixture()), account, false);
  assert.equal(good.composio_enabled, false);
  await assert.rejects(
    reviewTransportSelection(
      db({ ...fixture(), api_key: "private" }),
      account,
      false,
    ),
    /R06_UNAVAILABLE/,
  );
  await assert.rejects(
    reviewTransportSelection(
      db({
        ...fixture(),
        selection: { ...fixture().selection, account_id: randomUUID() },
      }),
      account,
      false,
    ),
    /R06_UNAVAILABLE/,
  );
});
test("R06-I03 disabled Composio permits safe pause/cancel but refuses activating commands", async () => {
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return {
        data: {
          ...fixture().selection,
          provider: "composio",
          state: "paused",
          binding_id: randomUUID(),
        },
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  for (const kind of ["pause", "cancel_transition"]) {
    await commandTransportSelection(
      db,
      account,
      {
        kind,
        payload: { ...fixture().expected, target_provider: "composio" },
        idempotency_key: randomUUID(),
      },
      false,
    );
  }
  assert.equal(calls, 2);
  for (const kind of ["prepare_transition", "commit_transition"]) {
    await assert.rejects(
      commandTransportSelection(
        db,
        account,
        {
          kind,
          payload: { ...fixture().expected, target_provider: "composio" },
          idempotency_key: randomUUID(),
        },
        false,
      ),
      /R06_NOT_READY/,
    );
  }
  assert.equal(calls, 2);
});
if (!process.execArgv.includes("--experimental-test-module-mocks"))
  test("R06-I03 API test isolated mock process", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const imports = process.execArgv.flatMap((a, i) =>
      a === "--import" && process.execArgv[i + 1]?.endsWith("offline.mjs")
        ? ["--import", process.execArgv[i + 1]]
        : [],
    );
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        ...imports,
        "--import",
        "tsx",
        "--test",
        "tests/pipeline-os-s02-mailbox-runtime-api.test.ts",
      ],
      { env, encoding: "utf8", timeout: 90000 },
    );
    assert.match(output, /# fail 0/);
  });
else
  test("R06-I03 review route is MFA/admin only, disabled by default, no service writer", async (t) => {
    let session = true,
      aal = true,
      admin = true,
      calls = 0;
    const old = process.env.MAIL_TRANSPORT_ROUTING_ENABLED;
    const mocked = mock.module("../src/lib/server/supabase.ts", {
      namedExports: {
        ...supabase,
        requireUser: async () => {
          if (!session) throw new supabase.HttpError(401, "PRIVATE_SESSION");
          if (!aal) throw new supabase.HttpError(403, "PRIVATE_MFA");
          return {
            profile: { active: true, role: admin ? "superadmin" : "seller" },
            db: {
              rpc: async (name: string) => {
                calls++;
                assert.equal(name, "mail_transport_review");
                return { data: fixture(), error: null };
              },
            },
          };
        },
        serviceClient: () => {
          throw Error("NO_SERVICE_APPROVAL");
        },
      },
    });
    try {
      const route =
        await import("../src/app/api/mail/accounts/[id]/transport/review/route");
      const request = (suffix = "") =>
        route.GET(
          new Request(
            `http://localhost:3000/api/mail/accounts/${account}/transport/review${suffix}`,
          ),
          { params: Promise.resolve({ id: account }) },
        );
      await t.test("flag off makes zero RPCs", async () => {
        process.env.MAIL_TRANSPORT_ROUTING_ENABLED = "false";
        assert.equal((await request()).status, 503);
        assert.equal(calls, 0);
      });
      process.env.MAIL_TRANSPORT_ROUTING_ENABLED = "true";
      await t.test(
        "no session, MFA or role gives no DB access or private error",
        async () => {
          session = false;
          let response = await request();
          assert.equal(response.status, 401);
          assert(!JSON.stringify(await response.json()).includes("PRIVATE"));
          session = true;
          aal = false;
          assert.equal((await request()).status, 403);
          aal = true;
          admin = false;
          assert.equal((await request()).status, 403);
          admin = true;
          assert.equal(calls, 0);
        },
      );
      await t.test("bounded query and sanitized no-store result", async () => {
        assert.equal((await request("?extra=yes")).status, 400);
        assert.equal(calls, 0);
        const response = await request();
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal((await response.json()).composio_enabled, false);
        assert.equal(calls, 1);
      });
    } finally {
      mocked.restore();
      if (old === undefined) delete process.env.MAIL_TRANSPORT_ROUTING_ENABLED;
      else process.env.MAIL_TRANSPORT_ROUTING_ENABLED = old;
    }
  });
