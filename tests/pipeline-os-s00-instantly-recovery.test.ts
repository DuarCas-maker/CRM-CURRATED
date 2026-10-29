import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { setImmediate as turn } from "node:timers/promises";
import { hash } from "../scripts/pipeline-os/s00-composio-common";
import {
  runInstantlyPhaseA,
  assertInstantlyTransition,
  instantlyA,
  type InstantlyState,
  type InstantlyClock,
} from "../scripts/pipeline-os/s00-instantly-runner";
import {
  eligibleInstantlyRecovery,
  recoverInstantlyPagination,
  validateInstantlyRecovery,
  validateInstantlyLedger,
  assertInstantlyRecoveryTransition,
  inspectInstantlyKeyProbe,
  instantlyLedgerReport,
  type InstantlyLedger,
  type InstantlyLedgerStore,
  type InstantlyRecovery,
} from "../scripts/pipeline-os/s00-instantly-recovery";
import { instantlyFiles } from "../scripts/pipeline-os/s00-instantly-files";

globalThis.fetch = async () => {
  throw Error("REAL_NETWORK_FORBIDDEN");
};
const secret = "RECOVERY_PRIVATE_SENTINEL",
  pii = "recovery-private@example.invalid";
const workspace = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const env = { INSTANTLY_API_KEY: secret, INSTANTLY_WORKSPACE_ID: workspace };
const id = (n: number) =>
  "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
class Clock implements InstantlyClock {
  time = 0;
  waits: number[] = [];
  now = () => this.time;
  async sleep(ms: number, signal?: AbortSignal) {
    assert.ok(ms >= 0);
    if (signal?.aborted) throw Error(secret);
    this.waits.push(ms);
    this.time += ms;
  }
}
// Characterize the original failure with real v1 code, never by resetting a real file.
async function baseline() {
  let value: InstantlyState | undefined;
  const store = {
    load: async () => (value ? structuredClone(value) : undefined),
    save: async (s: InstantlyState) => {
      assertInstantlyTransition(value, s);
      value = structuredClone(s);
    },
  };
  const r = await runInstantlyPhaseA(env, store, {
    execute: true,
    phase: "A",
    authorizedNew: 12,
    includedCallsConfirmed: true,
    clock: new Clock(),
    fetchImpl: async (raw) => {
      const path = new URL(String(raw)).pathname;
      if (path.endsWith("/workspaces/current")) return json({ id: workspace });
      if (path.endsWith("/plan-details"))
        return json({
          organization_id: workspace,
          subscriptions: {
            outreach: { total_lead_limit: 25000, current_lead_count: 24917 },
          },
        });
      if (path.endsWith("/api-keys"))
        return json({
          items: [
            {
              id: id(10),
              organization_id: workspace,
              key: "other-key",
              scopes: ["all:all"],
            },
          ],
          next_starting_after: id(10),
        });
      throw Error("BASELINE_UNEXPECTED_ROUTE");
    },
  });
  assert.equal(r.calls, 4);
  assert.equal(r.error, "DUPLICATE_RECORD");
  return eligibleInstantlyRecovery(value);
}
class Memory implements InstantlyLedgerStore {
  value: InstantlyLedger;
  writes = 0;
  failAt = -1;
  constructor(base: InstantlyState) {
    this.value = structuredClone(base);
  }
  async load() {
    return structuredClone(this.value);
  }
  async save(s: InstantlyLedger) {
    this.writes++;
    if (this.writes === this.failAt) throw Error(secret);
    assert.equal(s.version, 2);
    assertInstantlyRecoveryTransition(this.value, s as InstantlyRecovery);
    this.value = structuredClone(s);
  }
}
async function harness() {
  const base = await baseline(),
    store = new Memory(base),
    clock = new Clock(),
    calls: { op: string; page: number; time: number }[] = [],
    tries = new Map<string, number>();
  const h = {
    base,
    store,
    clock,
    calls,
    doublePages: false,
    alter: undefined as
      undefined | ((b: any, op: string, page: number) => void),
    fault: undefined as
      | undefined
      | ((
          op: string,
          page: number,
          attempt: number,
        ) => Response | Error | undefined),
    run: (
      options: Parameters<typeof recoverInstantlyPagination>[2] = {},
      config = env,
    ) =>
      recoverInstantlyPagination(config, store, {
        execute: true,
        phase: "A",
        authorizedNew: 8,
        authorizedTotal: 12,
        includedCallsConfirmed: true,
        clock,
        fetchImpl,
        ...options,
      }),
  };
  const fetchImpl: typeof fetch = async (raw, init) => {
    const u = new URL(String(raw)),
      op = u.pathname.endsWith("/workspaces/current")
        ? "workspace"
        : u.pathname.endsWith("/plan-details")
          ? "plan"
          : u.pathname.endsWith("/api-keys")
            ? "keys"
            : u.pathname.endsWith("/accounts")
              ? "accounts"
              : u.pathname.endsWith("/event-types")
                ? "events"
                : u.pathname.endsWith("/campaigns")
                  ? "campaigns"
                  : "bad";
    const cursor = u.searchParams.get("starting_after"),
      page = cursor ? 2 : 1;
    assert.equal(init?.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(init.body, undefined);
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer " + secret,
    );
    const state = store.value as InstantlyRecovery;
    assert.equal(state.calls, 4 + calls.length + 1);
    assert.equal(state.requests.at(-1)?.result, "IN_FLIGHT");
    assert.equal(
      hash(JSON.stringify(state.predecessor)),
      hash(JSON.stringify(base)),
    );
    if (op === "keys") assert.equal(cursor, null);
    if (op === "campaigns")
      assert.equal(u.searchParams.get("search"), "S00-INSTANTLY-" + base.nonce);
    if (cursor) assert.equal(cursor, "cursor&" + pii);
    const k = op + page,
      attempt = (tries.get(k) ?? 0) + 1;
    tries.set(k, attempt);
    calls.push({ op, page, time: clock.now() });
    const fault = h.fault?.(op, page, attempt);
    if (fault instanceof Error) throw fault;
    if (fault) return fault;
    let b: any;
    if (op === "workspace") b = { id: workspace };
    else if (op === "plan")
      b = {
        organization_id: workspace,
        subscriptions: {
          outreach: { total_lead_limit: 25000, current_lead_count: 24917 },
        },
      };
    else if (op === "keys")
      b = {
        items: [
          {
            id: id(11),
            organization_id: workspace,
            key: secret,
            scopes: ["all:read", "campaigns:create"],
          },
        ],
      };
    else if (op === "accounts")
      b = {
        items: [
          {
            email: `account${page}@example.invalid`,
            organization: workspace,
            status: 1,
            daily_limit: 30,
          },
        ],
        ...(h.doublePages && page === 1
          ? { next_starting_after: "cursor&" + pii }
          : {}),
      };
    else if (op === "events")
      b = {
        event_types: [
          "reply_received",
          "email_bounced",
          "lead_unsubscribed",
        ].map((id) => ({ id })),
      };
    else if (op === "campaigns")
      b = {
        items: [
          {
            id: id(40 + page),
            organization: workspace,
            name: "unrelated-" + pii,
          },
        ],
        ...(h.doublePages && page === 1
          ? { next_starting_after: "cursor&" + pii }
          : {}),
      };
    else throw Error("UNEXPECTED_ROUTE");
    h.alter?.(b, op, page);
    return json(b);
  };
  return h;
}
function noPrivate(value: unknown) {
  const s = JSON.stringify(value);
  for (const t of [secret, pii, workspace, "other-key"])
    assert.ok(!s.includes(t));
  for (const t of ["fingerprint", "predecessorHash", "manifestHash", "nonce"])
    assert.ok(!s.includes(t));
}

test("R-AC01 reproduces base4 with v1; accepts only the exact failed pattern", async () => {
  const b = await baseline();
  assert.equal(eligibleInstantlyRecovery(b).calls, 4);
  for (const change of [
    (s: any) => (s.error = "CURSOR_REPEATED"),
    (s: any) => (s.status = "running"),
    (s: any) => (s.calls = 0),
    (s: any) => (s.checkpoint = 1),
    (s: any) => (s.requests[3].page = 3),
  ]) {
    const c = structuredClone(b);
    change(c);
    assert.throws(() => eligibleInstantlyRecovery(c));
  }
});
test("R-AC02 preview of eligible base never reads env, writes or uses HTTP", async () => {
  const h = await harness(),
    r = await recoverInstantlyPagination(
      new Proxy(
        {},
        {
          get() {
            throw Error("NO_ENV");
          },
        },
      ),
      h.store,
      {
        fetchImpl: async () => {
          throw Error("NO_HTTP");
        },
      },
    );
  assert.equal(r.calls, 4);
  assert.equal(r.recoveryEligible, true);
  assert.equal(h.store.writes, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.store.value.version, 1);
  noPrivate(r);
});
test("R-AC02 missing or wrong gates/config/base consume zero HTTP and no migration", async () => {
  for (const option of [
    { phase: "B" },
    { authorizedNew: 12 },
    { authorizedTotal: 20 },
    { includedCallsConfirmed: false },
  ]) {
    const h = await harness();
    await assert.rejects(
      h.run(option),
      /INSTANTLY_RECOVERY_AUTHORIZATION_REQUIRED/,
    );
    assert.equal(h.store.writes, 0);
    assert.equal(h.calls.length, 0);
  }
  const h = await harness();
  await assert.rejects(
    h.run({}, { ...env, INSTANTLY_API_KEY: "changed" }),
    /INSTANTLY_BINDING_CHANGED/,
  );
  assert.equal(h.store.writes, 0);
  await assert.rejects(
    recoverInstantlyPagination(
      env,
      {
        load: async () => undefined,
        save: async () => {
          throw Error("NO_SAVE");
        },
      },
      {
        execute: true,
        phase: "A",
        authorizedNew: 8,
        authorizedTotal: 12,
        includedCallsConfirmed: true,
      },
    ),
    /INSTANTLY_RECOVERY_BASE_REQUIRED/,
  );
});
test("R-AC01/04 minimal recovery is six new reads and ten accumulated, predecessor intact", async () => {
  const h = await harness(),
    r = await h.run(),
    s = validateInstantlyRecovery(h.store.value);
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 10);
  assert.equal(s.requests.length, 6);
  assert.equal(s.normal, 10);
  assert.equal(s.retry, 0);
  assert.equal(s.results.plan.availableContactSlots, 83);
  assert.deepEqual(s.predecessor, h.base);
  assert.equal(s.predecessor.error, "DUPLICATE_RECORD");
  assert.equal(s.predecessor.calls, 4);
  assert.equal(s.results.keys.identified, true);
  assert.equal(h.calls.filter((c) => c.op === "keys").length, 1);
  assert.ok(
    "historicalPaginationAnomaly" in r && r.historicalPaginationAnomaly,
  );
  assert.equal(r.writesAuthorized, false);
  noPrivate(r);
});
test("R-AC03 duplicate identical or conflicting keys remain unknown; diagnostic does not grant scopes", async () => {
  for (const conflict of [false, true]) {
    const h = await harness();
    h.alter = (b, op) => {
      if (op === "keys")
        b.items.push({
          ...b.items[0],
          scopes: conflict ? ["all:all"] : b.items[0].scopes,
        });
    };
    const r = await h.run(),
      s = validateInstantlyRecovery(h.store.value);
    assert.equal(r.status, "completed");
    assert.equal(s.diagnostic.duplicateIds, 1);
    assert.equal(s.diagnostic.conflictingIds, conflict ? 1 : 0);
    assert.equal(s.results.keys.identified, false);
    assert.ok(Object.values(s.results.keys.scopes).every((v) => v === null));
    assert.ok(r.blockers.includes("CURRENT_KEY_SCOPES_UNKNOWN"));
    noPrivate(r);
  }
});
test("R-AC03 masked, missing, multiple matches, absent scopes and cursor remain explicit", async () => {
  for (const kind of ["masked", "missing", "multiple", "scopes"]) {
    const h = await harness();
    h.alter = (b, op) => {
      if (op !== "keys") return;
      if (kind === "masked" || kind === "missing")
        b.items[0].key = kind === "masked" ? "***" : "other-key";
      if (kind === "multiple") b.items.push({ ...b.items[0], id: id(12) });
      if (kind === "scopes") delete b.items[0].scopes;
      b.next_starting_after = id(12);
    };
    const r = await h.run(),
      s = validateInstantlyRecovery(h.store.value);
    assert.equal(r.status, "completed");
    assert.equal(s.results.keys.identified, false);
    assert.equal(s.diagnostic.cursorPresent, true);
    assert.equal(h.calls.filter((c) => c.op === "keys").length, 1);
    noPrivate(r);
  }
});
test("R-AC03 matching exact key does not adopt broader scopes of another key", async () => {
  const h = await harness();
  h.alter = (b, op) => {
    if (op === "keys")
      b.items.push({
        id: id(15),
        organization_id: workspace,
        key: "other-key",
        scopes: ["all:all"],
      });
  };
  await h.run();
  const s = validateInstantlyRecovery(h.store.value);
  assert.equal(s.results.keys.scopes["all:all"], false);
  assert.equal(s.results.keys.scopes["campaigns:create"], true);
});
test("R-AC03 optional keys403 continues unknown without retry; other auth failures stop", async () => {
  for (const [op, status] of [
    ["keys", 403],
    ["keys", 401],
    ["plan", 402],
    ["accounts", 403],
  ] as const) {
    const h = await harness();
    h.fault = (p) => (p === op ? json({ message: secret }, status) : undefined);
    const r = await h.run(),
      s = validateInstantlyRecovery(h.store.value);
    assert.equal(s.retry, 0);
    if (op === "keys" && status === 403) {
      assert.equal(r.status, "completed");
      assert.equal(s.diagnostic.reason, "forbidden");
    } else {
      assert.equal(r.status, "failed");
      assert.equal(h.calls.at(-1)?.op, op);
    }
    noPrivate(r);
  }
});
test("R-AC04 workspace, plan and record tenant/schema mismatch fail closed", async () => {
  for (const op of ["workspace", "plan", "keys", "accounts", "campaigns"]) {
    const h = await harness();
    h.alter = (b, p) => {
      if (p !== op) return;
      if (op === "workspace") b.id = other;
      else if (op === "plan") b.organization_id = other;
      else
        b.items[0][op === "keys" ? "organization_id" : "organization"] = other;
    };
    const r = await h.run();
    assert.equal(r.error, "WORKSPACE_MISMATCH");
    assert.equal(h.calls.at(-1)?.op, op);
  }
  const h = await harness();
  h.alter = (b, op) => {
    if (op === "keys") b.items[0].id = "bad";
  };
  assert.equal((await h.run()).error, "INVALID_SCHEMA");
});
test("R-AC04 missing Outreach subscription stops before probe", async () => {
  const h = await harness();
  h.alter = (b, op) => {
    if (op === "plan") b.subscriptions = {};
  };
  const r = await h.run();
  assert.equal(r.error, "OUTREACH_PLAN_UNCONFIRMED");
  assert.equal(r.calls, 6);
  assert.equal(h.calls.length, 2);
});
test("R-AC05 both extra list pages use R: eight new, twelve accumulated, no transfer", async () => {
  const h = await harness();
  h.doublePages = true;
  const r = await h.run(),
    s = validateInstantlyRecovery(h.store.value);
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 12);
  assert.equal(s.normal, 10);
  assert.equal(s.retry, 2);
  assert.deepEqual(
    s.requests
      .filter((r) => r.bucket === "R")
      .map((r) => [r.op, r.page, r.purpose]),
    [
      ["accounts", 2, "page"],
      ["campaigns", 2, "page"],
    ],
  );
  for (let i = 1; i < h.calls.length; i++)
    assert.ok(h.calls[i].time - h.calls[i - 1].time >= 1000);
});
test("R-AC05 two transient retries share R and can reach exactly twelve", async () => {
  const h = await harness();
  h.fault = (op, _, attempt) =>
    ["workspace", "plan"].includes(op) && attempt === 1
      ? json({}, 503)
      : undefined;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 12);
  assert.equal(h.clock.waits.filter((ms) => ms === 5000).length, 2);
});
test("R-AC05 retry plus pagination cannot spend a third reserve or exceed total", async () => {
  const h = await harness();
  h.doublePages = true;
  h.fault = (op, _, attempt) =>
    op === "workspace" && attempt === 1 ? json({}, 429) : undefined;
  const r = await h.run(),
    s = validateInstantlyRecovery(h.store.value);
  assert.equal(r.error, "BUDGET_EXHAUSTED");
  assert.equal(r.calls, 12);
  assert.equal(s.retry, 2);
  assert.equal(h.calls.filter((c) => c.op === "campaigns").length, 1);
});
test("R-AC04 repeated cursor, duplicate accounts/campaigns and incomplete pages are not hidden", async () => {
  for (const kind of ["cursor", "duplicate", "incomplete"]) {
    const h = await harness();
    h.doublePages = true;
    h.alter = (b, op, page) => {
      if (op !== "accounts") return;
      if (kind === "cursor") b.next_starting_after = "cursor&" + pii;
      if (kind === "duplicate") b.items[0].email = "same@example.invalid";
      if (kind === "incomplete" && page === 2)
        b.next_starting_after = "third-page";
    };
    const r = await h.run();
    assert.equal(
      r.error,
      kind === "cursor"
        ? "CURSOR_REPEATED"
        : kind === "duplicate"
          ? "DUPLICATE_RECORD"
          : "PAGINATION_LIMIT",
    );
    assert.equal(h.calls.filter((c) => c.op === "accounts").length, 2);
    noPrivate(r);
  }
  const h = await harness();
  h.doublePages = true;
  h.alter = (b, op) => {
    if (op === "campaigns") b.items[0].id = id(99);
  };
  assert.equal((await h.run()).error, "DUPLICATE_RECORD");
});
test("R-AC05 excessive Retry-After stops, nonretryable responses and redirects do not retry", async () => {
  for (const status of [401, 402, 403, 302, 429]) {
    const h = await harness();
    h.fault = () =>
      json({ message: secret }, status, {
        "retry-after": "61",
        location: "https://evil.invalid",
      });
    const r = await h.run();
    assert.equal(r.calls, 5);
    assert.equal(h.calls.length, 1);
    assert.equal(validateInstantlyRecovery(h.store.value).retry, 0);
    if (status === 429) assert.equal(r.error, "RETRY_WAIT_TOO_LONG");
    noPrivate(r);
  }
});
test("R-AC05 reservation/store errors before or after HTTP never retry the write", async () => {
  for (const failAt of [1, 2, 3]) {
    const h = await harness();
    h.store.failAt = failAt;
    await assert.rejects(h.run());
    assert.equal(h.calls.length, failAt === 3 ? 1 : 0);
    assert.equal(h.store.value.calls, failAt === 3 ? 5 : 4);
    if (failAt === 3)
      assert.equal(
        (h.store.value as InstantlyRecovery).requests[0].result,
        "IN_FLIGHT",
      );
  }
});
test("R-AC06 completed, failed, interrupted and uncertain v2 replay HTTP0/save0", async () => {
  for (const mode of ["complete", "failed", "interrupted", "uncertain"]) {
    const h = await harness();
    if (mode === "failed") h.fault = () => json({}, 401);
    if (mode === "interrupted") h.store.failAt = 2;
    if (mode === "uncertain") h.store.failAt = 3;
    try {
      await h.run();
    } catch {
      assert.ok(["interrupted", "uncertain"].includes(mode));
    }
    const before = JSON.stringify(h.store.value),
      writes = h.store.writes,
      calls = h.calls.length;
    await h.run();
    assert.equal(JSON.stringify(h.store.value), before);
    assert.equal(h.store.writes, writes);
    assert.equal(h.calls.length, calls);
  }
});
test("R-AC01 journal tampering, counter reset, predecessor edits and downgraded history rejected", async () => {
  const h = await harness();
  await h.run();
  const state = validateInstantlyRecovery(h.store.value);
  for (const change of [
    (s: any) => (s.calls = 4),
    (s: any) => (s.predecessor.calls = 0),
    (s: any) => (s.predecessorHash = "0".repeat(64)),
    (s: any) => (s.manifestHash = "0".repeat(64)),
    (s: any) => (s.normal = 4),
    (s: any) => (s.requests[0].purpose = "page"),
    (s: any) => (s.results.keys.identified = false),
    (s: any) => (s.diagnostic.duplicateIds = 1),
  ]) {
    const c = structuredClone(state);
    change(c);
    assert.throws(() => validateInstantlyRecovery(c));
  }
  const c = structuredClone(state);
  c.results.accounts.configuredDailyLimitSum++;
  assert.throws(
    () => assertInstantlyRecoveryTransition(state, c),
    /INSTANTLY_RECOVERY_HISTORY_IMMUTABLE/,
  );
  assert.throws(
    () => assertInstantlyRecoveryTransition(undefined, state),
    /INSTANTLY_RECOVERY_BASE_REQUIRED/,
  );
});
test("R-AC02 binding changes cannot reuse v2 after completion", async () => {
  const h = await harness();
  await h.run();
  const calls = h.calls.length;
  for (const config of [
    { ...env, INSTANTLY_API_KEY: "changed" },
    { ...env, INSTANTLY_WORKSPACE_ID: other },
  ])
    await assert.rejects(h.run({}, config), /INSTANTLY_BINDING_CHANGED/);
  assert.equal(h.calls.length, calls);
});
test("R-AC05 eight-second timeout and cancellation use bounded shared transport", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const h = await harness();
    let attempts = 0;
    const running = h.run({
      fetchImpl: async () => {
        attempts++;
        return new Promise<Response>(() => {});
      },
    });
    while (attempts < 1) await turn();
    t.mock.timers.tick(8000);
    while (attempts < 2) await turn();
    t.mock.timers.tick(8000);
    const r = await running;
    assert.equal(r.error, "RETRY_LIMIT");
    assert.equal(r.calls, 6);
  } finally {
    t.mock.timers.reset();
  }
  const h = await harness(),
    controller = new AbortController();
  controller.abort();
  const r = await h.run({ signal: controller.signal });
  assert.equal(r.calls, 4);
  assert.equal(r.error, "CANCELLED");
  assert.equal(h.calls.length, 0);
});
test("R-AC06 body limits and unknown fields/scopes cannot leak or produce business authorization", async () => {
  const h = await harness();
  h.fault = () =>
    json({}, 200, { "content-length": String(2 * 1024 * 1024 + 1) });
  assert.equal((await h.run()).error, "RESPONSE_LIMIT");
  const probe = inspectInstantlyKeyProbe(
    {
      items: [
        {
          id: id(1),
          organization_id: workspace,
          key: secret,
          scopes: [secret, "all:read"],
          private: pii,
        },
      ],
    },
    secret,
    workspace,
  );
  noPrivate(probe);
  assert.equal(probe.keys.scopes["all:read"], true);
  const sample = await harness();
  sample.alter = (b, op) => {
    if (op === "events") b.event_types = [];
    if (op === "campaigns")
      b.items[0].name = "S00-INSTANTLY-" + sample.base.nonce;
  };
  const r = await sample.run();
  assert.ok(r.blockers.includes("TRIAL_NAME_ALREADY_EXISTS"));
  assert.ok(r.blockers.includes("REQUIRED_EVENT_TYPES_NOT_CONFIRMED"));
  assert.equal(r.writesAuthorized, false);
  noPrivate(r);
});

async function temporary(work: (dir: string) => Promise<void>) {
  await mkdir(resolve(".local"), { recursive: true });
  const dir = await mkdtemp(resolve(".local", "s00-ins-recovery-test-"));
  try {
    await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("R-AC01/06 filesystem migration preserves full predecessor; v1 writer cannot downgrade v2", () =>
  temporary(async (dir) => {
    const files = instantlyFiles(dir),
      base = await baseline(),
      path = resolve(dir, ".local/pipeline-os/s00-instantly-run.json");
    await mkdir(resolve(dir, ".local/pipeline-os"), { recursive: true });
    await writeFile(path, JSON.stringify(base));
    const h = await harness();
    h.base = base;
    h.store.value = structuredClone(base);
    h.store.failAt = 2;
    await assert.rejects(h.run());
    const initial = validateInstantlyRecovery(h.store.value);
    await files.locked(() => files.ledgerStore.save(initial));
    assert.deepEqual(
      ((await files.ledgerStore.load()) as InstantlyRecovery).predecessor,
      base,
    );
    await assert.rejects(
      files.store.load(),
      /INSTANTLY_RECOVERY_LEDGER_SUPERSEDES_V1/,
    );
    await assert.rejects(
      files.store.save(base),
      /INSTANTLY_RECOVERY_LEDGER_SUPERSEDES_V1/,
    );
    assert.deepEqual(
      (await readdir(resolve(dir, ".local/pipeline-os"))).sort(),
      ["s00-instantly-run.json"],
    );
    await writeFile(path + ".lock", "foreign");
    await assert.rejects(
      files.locked(async () => {}),
      /INSTANTLY_JOURNAL_LOCKED/,
    );
    assert.equal(await readFile(path + ".lock", "utf8"), "foreign");
    await rm(path + ".lock");
    await writeFile(path + ".tmp", "foreign");
    await assert.rejects(files.ledgerStore.save(initial));
    assert.equal(await readFile(path + ".tmp", "utf8"), "foreign");
  }));
test("R-AC02 CLI preview/invalid gates are offline, no autoload, no migration", () =>
  temporary(async (dir) => {
    const base = await baseline(),
      folder = resolve(dir, ".local/pipeline-os"),
      path = resolve(folder, "s00-instantly-run.json");
    await mkdir(folder, { recursive: true });
    await writeFile(path, JSON.stringify(base));
    const before = await readFile(path, "utf8");
    const guard = resolve(dir, "guard.mjs");
    await writeFile(guard, "globalThis.fetch=()=>{throw Error('NO_HTTP')};");
    await writeFile(resolve(dir, ".env.local"), "PRIVATE=NOT_TO_LOAD\n");
    const loader = pathToFileURL(
        resolve("node_modules/tsx/dist/loader.mjs"),
      ).href,
      cli = resolve("scripts/pipeline-os/s00-instantly-runner-cli.ts");
    for (const flags of [
      ["--recover-pagination"],
      ["--execute", "--recover-pagination"],
      [
        "--execute",
        "--recover-pagination",
        "--phase",
        "A",
        "--authorized-new",
        "12",
        "--authorized-total",
        "12",
        "--included-calls-confirmed",
      ],
      ["--check-config", "--recover-pagination"],
    ]) {
      const p = spawnSync(
        process.execPath,
        [
          "--import",
          loader,
          "--import",
          pathToFileURL(guard).href,
          cli,
          ...flags,
        ],
        {
          cwd: dir,
          encoding: "utf8",
          env: { SystemRoot: process.env.SystemRoot, NODE_ENV: "test" },
        },
      );
      assert.equal(p.status, flags.length === 1 ? 0 : 2);
      assert.ok(!(p.stderr + p.stdout).includes("NOT_TO_LOAD"));
      if (flags.length === 1) {
        const r = JSON.parse(p.stdout);
        assert.equal(r.calls, 4);
        assert.equal(r.recoveryEligible, true);
        noPrivate(r);
      }
    }
    assert.equal(await readFile(path, "utf8"), before);
    assert.deepEqual(await readdir(folder), ["s00-instantly-run.json"]);
  }));
test("R-AC01/05 CLI fixture-only execution migrates once, finishes10, and replay adds no HTTP", () =>
  temporary(async (dir) => {
    const base = await baseline(),
      folder = resolve(dir, ".local/pipeline-os"),
      path = resolve(folder, "s00-instantly-run.json");
    await mkdir(folder, { recursive: true });
    await writeFile(path, JSON.stringify(base));
    const guard = resolve(dir, "fixture.mjs");
    await writeFile(
      guard,
      `
import {appendFileSync} from 'node:fs';
globalThis.fetch=async(raw,init)=>{const u=new URL(String(raw));if(u.origin!=='https://api.instantly.ai'||init.method!=='GET')throw Error('BAD_ROUTE');appendFileSync('calls.txt','GET\\n');const w=process.env.INSTANTLY_WORKSPACE_ID;
const b=u.pathname.endsWith('/current')?{id:w}:u.pathname.endsWith('/plan-details')?{organization_id:w,subscriptions:{outreach:{total_lead_limit:25000,current_lead_count:24917}}}:u.pathname.endsWith('/api-keys')?{items:[],next_starting_after:'still-unreliable'}:u.pathname.endsWith('/event-types')?{event_types:['reply_received','email_bounced','lead_unsubscribed'].map(id=>({id}))}:{items:[]};
return new Response(JSON.stringify(b),{headers:{'content-type':'application/json'}});};
`,
    );
    const loader = pathToFileURL(
        resolve("node_modules/tsx/dist/loader.mjs"),
      ).href,
      cli = resolve("scripts/pipeline-os/s00-instantly-runner-cli.ts");
    const run = (flags: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          loader,
          "--import",
          pathToFileURL(guard).href,
          cli,
          ...flags,
        ],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: 20000,
          env: {
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: "test",
            INSTANTLY_API_KEY: secret,
            INSTANTLY_WORKSPACE_ID: workspace,
          },
        },
      );
    const flags = [
      "--execute",
      "--recover-pagination",
      "--phase",
      "A",
      "--authorized-new",
      "8",
      "--authorized-total",
      "12",
      "--included-calls-confirmed",
    ];
    const first = run(flags);
    assert.equal(first.status, 2, first.stderr);
    const r = JSON.parse(first.stdout);
    assert.equal(r.calls, 10);
    assert.equal(r.status, "completed");
    assert.ok(r.blockers.includes("CURRENT_KEY_SCOPES_UNKNOWN"));
    noPrivate(r);
    const before = await readFile(path, "utf8"),
      s = validateInstantlyRecovery(JSON.parse(before));
    assert.deepEqual(s.predecessor, base);
    assert.equal(s.predecessor.calls, 4);
    const status = run([]),
      replay = run(flags),
      legacy = run([
        "--execute",
        "--phase",
        "A",
        "--authorized-new",
        "12",
        "--included-calls-confirmed",
      ]);
    assert.equal(status.status, 0);
    assert.equal(replay.status, 2);
    assert.equal(legacy.status, 2);
    assert.equal(await readFile(path, "utf8"), before);
    assert.equal(
      (await readFile(resolve(dir, "calls.txt"), "utf8")).trim().split("\n")
        .length,
      6,
    );
    assert.deepEqual(await readdir(folder), ["s00-instantly-run.json"]);
  }));
