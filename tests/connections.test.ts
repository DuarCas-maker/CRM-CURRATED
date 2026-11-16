import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  connectionsAllowed,
  connectionTotals,
  connectionsInitialView,
  connectionsSchema,
  demoConnections,
} from "../src/lib/connections";
import { connectionsGet, readConnections } from "../src/lib/server/connections";
import { HttpError } from "../src/lib/server/supabase";
import { demoWorkspace } from "../src/lib/demo";

const ids: string[] = [randomUUID(), randomUUID()],
  user = randomUUID();
const accounts = ids.map((id, i) => ({
  id,
  email: `mail-${i}@example.invalid`,
  organization: "fixture",
  status: "connected",
  created_at: "2026-10-01T12:00:00Z",
}));
const snapshot = () => demoConnections(accounts);
function database(
  options: {
    duplicate?: boolean;
    noAccounts?: boolean;
    permissionsError?: boolean;
  } = {},
) {
  const ledger: {
    table: string;
    columns: string;
    count?: unknown;
    filters: Record<string, unknown>;
  }[] = [];
  const tables: Record<string, Record<string, unknown>[]> = {
    mail_accounts: options.noAccounts
      ? []
      : options.duplicate
        ? [accounts[0], accounts[0]]
        : accounts,
    mail_permissions: [{ account_id: ids[0], user_id: user, can_send: true }],
    profiles: [{ id: user, name: "Fictional person", active: true }],
    gmail_sync_state: [
      { account_id: ids[0], last_synced_at: "2026-11-15T13:00:00Z" },
    ],
  };
  const db = {
    from(table: string) {
      assert.ok(
        [
          "mail_accounts",
          "mail_permissions",
          "profiles",
          "gmail_sync_state",
          "gmail_archive_messages",
        ].includes(table),
      );
      let start = 0,
        end = 99;
      const entry = {
        table,
        columns: "",
        filters: {} as Record<string, unknown>,
        count: undefined as unknown,
      };
      const result = () => {
        if (table === "gmail_archive_messages")
          return entry.filters.account_id === ids[0]
            ? { data: null, error: null, count: 0 }
            : {
                data: null,
                error: { message: "private failure" },
                count: null,
              };
        if (options.permissionsError && table === "mail_permissions")
          return { data: null, error: { message: "private failure" } };
        const data = (tables[table] ?? []).filter((row) =>
          Object.entries(entry.filters).every(([key, value]) =>
            Array.isArray(value)
              ? value.includes(row[key])
              : value === row[key],
          ),
        );
        return { data: data.slice(start, end + 1), error: null };
      };
      const q = {
        select(columns: string, opts?: unknown) {
          entry.columns = columns;
          entry.count = opts;
          ledger.push(entry);
          return q;
        },
        range(a: number, b: number) {
          start = a;
          end = b;
          return q;
        },
        order() {
          return q;
        },
        in(key: string, value: unknown) {
          entry.filters[key] = value;
          return q;
        },
        eq(key: string, value: unknown) {
          entry.filters[key] = value;
          return q;
        },
        async maybeSingle() {
          const r = result();
          return { ...r, data: r.data?.[0] ?? null };
        },
        then(
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name: string, p: { account: string }) {
      if (name === "can_send") return { data: true, error: null };
      assert.equal(name, "composio_binding_page");
      const index = ids.indexOf(p.account),
        account = accounts[index];
      return {
        error: null,
        data: {
          account: {
            id: account.id,
            email: account.email,
            brand_id: user,
            brand_name: "Fixture brand",
            brand_revision: 1,
            account_revision: 1,
            context_hash: "a".repeat(64),
            ready: true,
          },
          head_revision: 1,
          transport: "gmail_oauth",
          composio_enabled: false,
          verification_available: false,
          can_confirm: false,
          current: {
            id: randomUUID(),
            revision: 1,
            status: index ? "candidate" : "verified",
            reason: null,
            stale: false,
            created_at: "2026-11-01T12:00:00Z",
            reviewed_at: index ? null : "2026-11-02T12:00:00Z",
            external_refs: {
              project: "…abcd",
              auth_config: "…abcd",
              connection: "…abcd",
              user: "…abcd",
              quota: "…abcd",
            },
          },
          history: [],
          cursor: null,
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, ledger };
}

test("CON-AC02/03: unknown data stays unknown and Gmail is separate from a confirmed Composio association", () => {
  const s = snapshot();
  assert.deepEqual(connectionTotals(s.accounts), {
    accounts: 2,
    gmailConnected: 2,
    confirmed: 1,
    messages: null,
  });
  s.accounts[1].messages = 0;
  assert.equal(connectionTotals(s.accounts).messages, 1250);
  s.accounts[1].association = "unavailable";
  assert.equal(connectionTotals(s.accounts).confirmed, null);
  s.accounts[0].association_stale = true;
  s.accounts[1].association = "candidate";
  assert.equal(connectionTotals(s.accounts).confirmed, 0);
});
test("CON-AC06: only active production superadmins access Connections; demo does not widen production permissions", () => {
  assert.equal(connectionsAllowed({ role: "superadmin", active: true }), true);
  for (const role of [
    "seller",
    "closer",
    "seller_admin",
    "closer_admin",
  ] as const)
    assert.equal(connectionsAllowed({ role, active: true }), false);
  assert.equal(
    connectionsAllowed({ role: "superadmin", active: false }, true),
    false,
  );
  assert.equal(connectionsAllowed({ role: "superadmin" }), false);
  assert.equal(connectionsInitialView("?module=connections", true), true);
  assert.equal(connectionsInitialView("?module=connections", false), false);
});
test("CON-AC06: HTTP denies before any reads and never caches account metadata", async () => {
  let reads = 0;
  const profile = { ...demoWorkspace().profile, active: true };
  const request = new Request("https://crm.example.invalid/api/connections");
  const read = async () => {
    reads++;
    return snapshot();
  };
  const anonymous = await connectionsGet(request, {
    authorize: async () => {
      throw new HttpError(401, "Sign in");
    },
    read,
  });
  assert.equal(anonymous.status, 401);
  for (const p of [
    { ...profile, role: "seller" as const },
    { ...profile, active: false },
  ]) {
    const r = await connectionsGet(request, {
      authorize: async () => ({ db: {} as SupabaseClient, profile: p }),
      read,
    });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  assert.equal(reads, 0);
  const r = await connectionsGet(request, {
    authorize: async () => ({ db: {} as SupabaseClient, profile }),
    read,
  });
  assert.equal(r.status, 200);
  assert.equal(reads, 1);
  assert.equal(r.headers.get("cache-control"), "no-store");
  connectionsSchema.parse(await r.json());
});
test("CON-AC06: unknown query and unexpected response fields fail closed", async () => {
  const profile = { ...demoWorkspace().profile, active: true };
  const deps = {
    authorize: async () => ({ db: {} as SupabaseClient, profile }),
    read: async () => ({ ...snapshot(), api_key: "never expose fixture" }),
  };
  assert.equal(
    (
      await connectionsGet(
        new Request("https://crm.example.invalid/api/connections?token=x"),
        deps,
      )
    ).status,
    400,
  );
  const r = await connectionsGet(
    new Request("https://crm.example.invalid/api/connections"),
    deps,
  );
  assert.equal(r.status, 500);
  assert.ok(!(await r.text()).includes("never expose"));
});
test("CON-AC02/03/06: real reader selects metadata only, exact counts by mailbox, and preserves partial failures", async () => {
  const { db, ledger } = database();
  const result = await readConnections(db);
  assert.equal(result.accounts[0].messages, 0);
  assert.equal(result.accounts[1].messages, null);
  assert.equal(result.accounts[0].association, "verified");
  assert.equal(result.accounts[1].association, "candidate");
  assert.equal(result.accounts[0].permissions?.[0].name, "Fictional person");
  assert.equal(result.accounts[1].synced_at, null);
  assert.equal(result.accounts[0].registered_at, "2026-10-01T12:00:00.000Z");
  assert.ok(
    ledger.every(
      (q) =>
        !/\*|encrypted|credential|payload|body|participants/.test(q.columns),
    ),
  );
  const counts = ledger.filter((q) => q.table === "gmail_archive_messages");
  assert.equal(counts.length, 2);
  assert.deepEqual(counts[0].count, { head: true, count: "exact" });
  assert.deepEqual(
    counts.map((q) => q.filters.account_id),
    ids,
  );
});
test("CON-AC03/06: missing permission catalog is unknown, while duplicate account catalogs fail explicitly", async () => {
  assert.equal(
    (await readConnections(database({ permissionsError: true }).db)).accounts[0]
      .permissions,
    null,
  );
  await assert.rejects(
    readConnections(database({ duplicate: true }).db),
    /CONNECTIONS_CATALOG_CHANGED/,
  );
  assert.deepEqual(
    (await readConnections(database({ noAccounts: true }).db)).accounts,
    [],
  );
});
