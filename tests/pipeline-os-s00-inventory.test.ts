import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { featureDatabase } from "./feature-database";
import {
  inventoryUrlAllowed,
  runS00Inventory,
} from "../scripts/pipeline-os/s00-inventory";

const sentinel = "private-inventory-fixture";
const env = {
  COMPOSIO_API_KEY: sentinel,
  COMPOSIO_AUTH_CONFIG_ID: "ac_fixture",
  COMPOSIO_CONNECTED_ACCOUNT_1_ID: "ca_first",
  COMPOSIO_CONNECTED_ACCOUNT_2_ID: "ca_second",
  INSTANTLY_API_KEY: sentinel,
  INSTANTLY_WORKSPACE_ID: "workspace-fixture",
  TEXTTORRENT_API_SID: sentinel,
  TEXTTORRENT_API_PUBLIC_KEY: sentinel,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-ratelimit": "2000" },
  });
function fixture(url: URL, headers: Headers): unknown {
  if (url.pathname.includes("auth_configs"))
    return {
      id: "ac_fixture",
      credentials: {
        client_secret: sentinel,
        scopes:
          "https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send",
      },
    };
  if (url.pathname.includes("connected_accounts"))
    return {
      id: url.pathname.endsWith("ca_first") ? "ca_first" : "ca_second",
      auth_config: { id: "ac_fixture" },
      requested_scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      state: {
        val: {
          displayName: `${url.pathname.endsWith("ca_first") ? "first" : "second"}@${sentinel}.test`,
          refresh_token: sentinel,
        },
      },
    };
  if (url.pathname.includes("/tools/"))
    return {
      slug: url.pathname.split("/").at(-1),
      version: "20261018_00",
      scopes: ["https://www.googleapis.com/auth/gmail.send"],
      scope_requirements: {
        any_of: ["https://www.googleapis.com/auth/gmail.send"],
      },
      description: sentinel,
    };
  if (url.pathname.includes("triggers_types"))
    return {
      slug: "GMAIL_NEW_GMAIL_MESSAGE",
      type: "poll",
      version: "20261018_00",
    };
  if (url.pathname.includes("trigger_instances"))
    return { items: [], total_items: 0, next_cursor: null };
  if (url.pathname.endsWith("workspaces/current"))
    return { id: "workspace-fixture", name: sentinel };
  if (url.pathname.endsWith("plan-details"))
    return {
      subscriptions: {
        outreach: { total_lead_limit: 25000, base_lead_limit: 25000 },
        credits: { available_credits: 100 },
      },
    };
  if (url.pathname.endsWith("/accounts"))
    return {
      items: [
        {
          email: `first@${sentinel}.test`,
          status: 1,
          daily_limit: 25,
          daily_limit_max: 100,
          sending_gap: 60,
        },
      ],
      next_starting_after: null,
    };
  if (url.pathname.endsWith("api-keys"))
    return {
      items: [
        { key: sentinel, scopes: ["all:read"] },
        { key: "another-fixture", scopes: ["all:all"] },
      ],
    };
  if (url.pathname.endsWith("sub-account/list"))
    return {
      success: true,
      data: {
        current_page: 1,
        last_page: 1,
        total: 1,
        data: [
          {
            id: 2,
            parent_id: 1,
            type: "sub",
            email: `sub@${sentinel}.test`,
            status: 1,
            admin_approval: 1,
            daily_sms_limit: 0,
            permissions: ["send_messages"],
          },
        ],
      },
    };
  if (url.pathname.endsWith("numbers/active"))
    return {
      success: true,
      data: {
        current_page: 1,
        last_page: 1,
        total: 1,
        data: [
          {
            id: headers.has("x-act-as-user") ? 22 : 11,
            user_id: headers.has("x-act-as-user") ? 2 : 1,
            number: sentinel,
            status: 1,
            capabilities: { sms: true, mms: false },
          },
        ],
      },
    };
  throw new Error("Unexpected endpoint");
}
const check = (
  result: Awaited<ReturnType<typeof runS00Inventory>>,
  name: string,
) => result.checks.find((item) => item.check === name);

test("inventory is offline by default and has no implicit file loading", async () => {
  const result = await runS00Inventory(env, {
    fetchImpl: async () => {
      throw new Error("Must not run");
    },
  });
  assert.equal(result.networkCalls, 0);
  assert.equal(result.mode, "offline_no_network");
});

test("inventory allowlist rejects message, execution, billing changes and injected URLs", () => {
  for (const url of [
    "https://api.texttorrent.com/api/v1/inbox",
    "https://api.texttorrent.com/api/v1/inbox/12",
    "https://backend.composio.dev/api/v3.1/tools/execute/GMAIL_SEND_EMAIL",
    "https://api.instantly.ai/api/v2/campaigns/12/activate",
    "https://api.texttorrent.com/api/v1/user/sub-account/store",
    "https://user:pass@api.instantly.ai/api/v2/accounts",
    "https://api.instantly.ai/api/v2/accounts?redirect=https://example.test",
    "http://api.instantly.ai/api/v2/accounts",
    "https://localhost/api/v2/accounts",
  ])
    assert.equal(inventoryUrlAllowed(url), false);
  assert.equal(
    inventoryUrlAllowed(
      "https://api.texttorrent.com/api/v1/inbox/numbers/active?limit=50&page=1",
    ),
    true,
  );
});

test("inventory uses GET metadata, scopes credentials and never emits PII or secrets", async () => {
  const calls: string[] = [];
  const result = await runS00Inventory(env, {
    executeReadonly: true,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      calls.push(url.origin + url.pathname);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "manual");
      assert.equal(init?.body, undefined);
      assert.equal(
        headers.has("x-api-key"),
        url.hostname === "backend.composio.dev",
      );
      assert.equal(
        headers.has("authorization"),
        url.hostname === "api.instantly.ai",
      );
      assert.equal(
        headers.has("x-api-sid"),
        url.hostname === "api.texttorrent.com",
      );
      return json(fixture(url, headers));
    },
  });
  assert.ok(calls.length < 40);
  assert.equal(result.sends, 0);
  assert.equal(result.toolExecutions, 0);
  assert.equal(result.paidOperations, 0);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(JSON.stringify(result).includes("ca_first"), false);
  assert.equal(check(result, "instantly_mailboxes_summary")?.count, 1);
  assert.equal(check(result, "texttorrent_subaccounts_summary")?.count, 1);
  const keyScopes = check(result, "instantly_current_key_scopes")
    ?.scopeFlags as Record<string, unknown>;
  assert.equal(keyScopes["all:read"], true);
  assert.equal(keyScopes["all:all"], false);
  const lines = result.checks.filter(
    (item) => item.check === "texttorrent_lines_summary",
  );
  assert.equal(lines.length, 2);
  assert.ok(
    lines.every(
      (item) => item.smsCapableLines === 1 && item.mismatchedOwnerRecords === 0,
    ),
  );
});

test("inventory distinguishes unreported line capabilities and explicit permissions from effective access", async () => {
  const result = await runS00Inventory(env, {
    executeReadonly: true,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const body = fixture(url, new Headers(init?.headers)) as any;
      if (url.pathname.endsWith("sub-account/list"))
        body.data.data[0].permissions = [];
      if (url.pathname.endsWith("numbers/active"))
        body.data.data[0].capabilities = [];
      return json(body);
    },
  });
  const accounts = check(result, "texttorrent_subaccounts_summary")
    ?.accounts as any[];
  assert.equal(accounts[0].explicitPermissionCount, 0);
  assert.equal(accounts[0].effectivePermissionsVerified, false);
  assert.equal(accounts[0].explicitPermissionFlags.send_messages, false);
  const lines = result.checks.filter(
    (item) => item.check === "texttorrent_lines_summary",
  );
  assert.ok(
    lines.every(
      (item) =>
        item.activeLines === 1 &&
        item.smsCapableLines === 0 &&
        item.smsCapabilityUnknownLines === 1 &&
        item.mmsCapabilityUnknownLines === 1,
    ),
  );
});

test("inventory keeps unreported scopes unknown and never borrows another API key's scopes", async () => {
  const result = await runS00Inventory(env, {
    executeReadonly: true,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes("auth_configs"))
        return json({
          id: "ac_fixture",
          credentials: { client_secret: sentinel },
        });
      if (url.pathname.endsWith("api-keys"))
        return json({ items: [{ key: "other", scopes: ["all:all"] }] });
      return json(fixture(url, new Headers(init?.headers)));
    },
  });
  assert.equal(
    (
      check(result, "composio_config_scopes")?.configuredScopeFlags as Record<
        string,
        unknown
      >
    ).read,
    null,
  );
  assert.equal(
    check(result, "instantly_current_key_scopes")?.currentKeyIdentified,
    false,
  );
  assert.equal(
    (
      check(result, "instantly_current_key_scopes")?.scopeFlags as Record<
        string,
        unknown
      >
    )["all:all"],
    null,
  );
});

test("inventory stops a provider on authentication failure or rate limit without retries", async () => {
  for (const code of [401, 429]) {
    let calls = 0;
    const result = await runS00Inventory(
      {
        COMPOSIO_API_KEY: sentinel,
        COMPOSIO_AUTH_CONFIG_ID: "ac_fixture",
        COMPOSIO_CONNECTED_ACCOUNT_1_ID: "ca_first",
        COMPOSIO_CONNECTED_ACCOUNT_2_ID: "ca_second",
      },
      {
        executeReadonly: true,
        fetchImpl: async () => {
          calls++;
          return json({ error: sentinel }, code);
        },
      },
    );
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes(sentinel), false);
  }
});

test("inventory does not treat wrong workspace or cross-subaccount lines as valid", async () => {
  let instantCalls = 0;
  const result = await runS00Inventory(env, {
    executeReadonly: true,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      if (url.hostname === "api.instantly.ai") {
        instantCalls++;
        return json({ id: "other-workspace" });
      }
      if (
        url.pathname.endsWith("numbers/active") &&
        headers.has("x-act-as-user")
      )
        return json({
          success: true,
          data: {
            last_page: 1,
            data: [
              {
                id: 33,
                user_id: 1,
                number: sentinel,
                status: 1,
                capabilities: { sms: true },
              },
            ],
          },
        });
      return json(fixture(url, headers));
    },
  });
  assert.equal(instantCalls, 1);
  const sub = result.checks.find(
    (item) =>
      item.check === "texttorrent_lines_summary" &&
      item.accountAlias === "subaccount_1",
  );
  assert.equal(sub?.activeLines, 0);
  assert.equal(sub?.mismatchedOwnerRecords, 1);
});

test("inventory builds pagination locally and does not follow provider-supplied URLs", async () => {
  const calls: string[] = [];
  const result = await runS00Inventory(
    { TEXTTORRENT_API_SID: sentinel, TEXTTORRENT_API_PUBLIC_KEY: sentinel },
    {
      executeReadonly: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push(String(input));
        const body = fixture(url, new Headers(init?.headers)) as Record<
          string,
          unknown
        >;
        if (url.pathname.endsWith("sub-account/list"))
          return json({
            ...body,
            data: {
              ...(body.data as object),
              current_page: Number(url.searchParams.get("page")),
              last_page: 2,
              next_page_url: `https://${sentinel}.invalid/steal`,
            },
          });
        return json(body);
      },
    },
  );
  assert.ok(
    calls.every((url) => url.startsWith("https://api.texttorrent.com/")),
  );
  assert.equal(check(result, "texttorrent_subaccounts_summary")?.count, 1);
  assert.equal(
    check(result, "texttorrent_subaccounts_summary")?.complete,
    true,
  );
  assert.equal(JSON.stringify(result).includes(sentinel), false);
});

test("inventory bounds pagination and reports incomplete results", async () => {
  let calls = 0;
  const result = await runS00Inventory(
    { TEXTTORRENT_API_SID: sentinel, TEXTTORRENT_API_PUBLIC_KEY: sentinel },
    {
      executeReadonly: true,
      fetchImpl: async () => {
        calls++;
        return json({
          success: true,
          data: {
            last_page: 100,
            data: [{ id: 2, type: "sub", status: 0, parent_id: 1 }],
          },
        });
      },
    },
  );
  assert.ok(calls <= 10);
  assert.equal(
    check(result, "texttorrent_subaccounts_summary")?.complete,
    false,
  );
});

test("inventory rejects invalid and oversized responses without reflecting their content", async () => {
  for (const response of [
    () => new Response(sentinel, { headers: { "content-type": "text/html" } }),
    () => json({ data: sentinel.repeat(20000) }),
    () => json({ error: sentinel }, 403),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: `https://${sentinel}.invalid` },
      }),
  ]) {
    const result = await runS00Inventory(
      { TEXTTORRENT_API_SID: sentinel, TEXTTORRENT_API_PUBLIC_KEY: sentinel },
      { executeReadonly: true, fetchImpl: async () => response() },
    );
    assert.equal(JSON.stringify(result).includes(sentinel), false);
    assert.notEqual(
      check(result, "texttorrent_subaccounts_page")?.status,
      "ok",
    );
  }
});

test("database metadata inventory runs against all local migrations without customer rows", async () => {
  const files = (await readdir("supabase/migrations"))
    .filter((file) => /^\d{3}_.*\.sql$/.test(file))
    .sort();
  assert.equal(files.length, 46);
  assert.deepEqual(
    files.map((file) => Number(file.slice(0, 3))),
    Array.from({ length: 46 }, (_, index) => index + 1),
  );
  const { db } = await featureDatabase();
  try {
    const query = await readFile(
      "scripts/pipeline-os/s00-database-inventory.sql",
      "utf8",
    );
    const results = await db.exec(query);
    const inventory = results
      .flatMap((result) => result.rows)
      .find((row) => "s00_metadata_inventory" in row)
      ?.s00_metadata_inventory as Record<string, unknown>;
    assert.equal(
      inventory.inventory_kind,
      "catalog_only_not_migration_history",
    );
    assert.equal(inventory.migration_ledger_available, false);
    assert.ok(
      Object.values(inventory.markers as object).every(
        (value) => value === true,
      ),
    );
    assert.ok((inventory.public_tables as unknown[]).length > 0);
    assert.equal(JSON.stringify(inventory).includes("@team.test"), false);
  } finally {
    await db.close();
  }
});
