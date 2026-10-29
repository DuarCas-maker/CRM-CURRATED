import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { setImmediate as turn } from "node:timers/promises";
import { S00RunError } from "../scripts/pipeline-os/s00-composio-common";
import {
  inspectInstantlyConfiguration,
  instantlyPhaseAUrlAllowed,
  instantlyReport,
  runInstantlyPhaseA,
  validateInstantlyState,
  assertInstantlyTransition,
  type InstantlyState,
  type InstantlyStore,
  type InstantlyClock,
} from "../scripts/pipeline-os/s00-instantly-runner";
import { instantlyFiles } from "../scripts/pipeline-os/s00-instantly-files";

// Every HTTP in this suite is injected. Accidental fallback cannot reach the network.
globalThis.fetch = async () => {
  throw Error("REAL_NETWORK_FORBIDDEN_BY_TEST");
};
const secret = "FICTIONAL_SECRET_SENTINEL",
  pii = "fictional-private@example.invalid";
const workspace = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const env = { INSTANTLY_API_KEY: secret, INSTANTLY_WORKSPACE_ID: workspace };
const id = (n: number) =>
  "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
class Memory implements InstantlyStore {
  value?: InstantlyState;
  writes = 0;
  failAt = -1;
  async load() {
    return this.value ? structuredClone(this.value) : undefined;
  }
  async save(s: InstantlyState) {
    this.writes++;
    if (this.writes === this.failAt) throw Error(secret);
    assertInstantlyTransition(this.value, s);
    this.value = structuredClone(s);
  }
}
class Clock implements InstantlyClock {
  time = 0;
  waits: number[] = [];
  now = () => this.time;
  async sleep(ms: number, signal?: AbortSignal) {
    assert.ok(ms >= 0);
    this.waits.push(ms);
    if (signal?.aborted) throw Error(secret);
    this.time += ms;
  }
}
function harness() {
  const store = new Memory(),
    clock = new Clock();
  const calls: {
    path: string;
    cursor: string | null;
    at: number;
    method: string;
  }[] = [];
  const h = {
    store,
    clock,
    calls,
    fullPages: false,
    alter: undefined as
      undefined | ((body: any, path: string, page: number) => void),
    fault: undefined as
      | undefined
      | ((
          path: string,
          page: number,
          attempt: number,
        ) => Response | Error | undefined),
    run: (
      options: Parameters<typeof runInstantlyPhaseA>[2] = {},
      config = env,
    ) =>
      runInstantlyPhaseA(config, store, {
        execute: true,
        phase: "A",
        authorizedNew: 12,
        includedCallsConfirmed: true,
        clock,
        fetchImpl,
        ...options,
      }),
  };
  const occurrences = new Map<string, number>();
  const fetchImpl: typeof fetch = async (raw, init) => {
    const u = new URL(String(raw)),
      path = u.pathname.split("/api/v2/")[1];
    assert.equal(init?.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer " + secret,
    );
    assert.equal(init.body, undefined);
    assert.ok(init.signal);
    const reserved = store.value!;
    assert.equal(reserved.requests.at(-1)?.result, "IN_FLIGHT");
    assert.equal(reserved.calls, calls.length + 1);
    assert.ok(instantlyPhaseAUrlAllowed(u.href, "GET", reserved.nonce));
    const cursor = u.searchParams.get("starting_after"),
      page = cursor ? Number(cursor.match(/page(\d+)/)?.[1] ?? 2) : 1;
    const key = path + "/" + page,
      attempt = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, attempt);
    calls.push({ path, cursor, at: clock.now(), method: "GET" });
    const fault = h.fault?.(path, page, attempt);
    if (fault instanceof Error) throw fault;
    if (fault) return fault;
    const pages = h.fullPages
      ? ({ "api-keys": 3, accounts: 2, campaigns: 2 }[path] ?? 1)
      : 1;
    let body: any;
    if (path === "workspaces/current") body = { id: workspace, name: pii };
    else if (path === "workspace-billing/plan-details")
      body = {
        organization_id: workspace,
        organization_name: pii,
        subscriptions: {
          outreach: {
            total_lead_limit: 25000,
            base_lead_limit: 25000,
            current_lead_count: 100,
          },
          credits: { available_credits: 0 },
        },
      };
    else if (path === "api-keys")
      body = {
        items: [
          {
            id: id(10 + page),
            organization_id: workspace,
            key: page === pages ? secret : "OTHER_PRIVATE_KEY_SENTINEL",
            scopes:
              page === pages
                ? ["all:read", "campaigns:create", "leads:update"]
                : ["all:all"],
            name: pii,
          },
        ],
        ...(page < pages
          ? { next_starting_after: "page" + (page + 1) + "&" + pii }
          : {}),
      };
    else if (path === "accounts")
      body = {
        items: [
          {
            email: "account" + page + "@example.invalid",
            organization: workspace,
            status: page === 1 ? 1 : -1,
            daily_limit: 30,
          },
        ],
        ...(page < pages
          ? { next_starting_after: "page" + (page + 1) + "&" + pii }
          : {}),
      };
    else if (path === "webhooks/event-types")
      body = {
        event_types: [
          "reply_received",
          "email_bounced",
          "lead_unsubscribed",
        ].map((id) => ({ id, label: pii, type: "standard" })),
      };
    else if (path === "campaigns")
      body = {
        items: h.fullPages
          ? [
              {
                id: id(50 + page),
                name: "unrelated-" + pii,
                organization: workspace,
              },
            ]
          : [],
        ...(page < pages ? { next_starting_after: "page" + (page + 1) } : {}),
      };
    else throw Error("UNEXPECTED_PATH");
    h.alter?.(body, path, page);
    return json(body);
  };
  return h;
}
function noPrivate(value: unknown) {
  const text = JSON.stringify(value);
  for (const s of [secret, pii, "OTHER_PRIVATE_KEY_SENTINEL", workspace])
    assert.ok(!text.includes(s), "private value absent");
  assert.ok(!text.includes("fingerprint"));
  assert.ok(!text.includes("nonce"));
}

test("A-AC01 default status does not inspect env, save or fetch", async () => {
  const h = harness();
  const trap = new Proxy(
    {},
    {
      get() {
        throw Error("ENV_READ_FORBIDDEN");
      },
    },
  );
  const r = await runInstantlyPhaseA(trap, h.store, {
    fetchImpl: async () => {
      throw Error("NO_HTTP");
    },
  });
  assert.equal(r.status, "not_started");
  assert.equal(r.calls, 0);
  assert.equal(h.store.writes, 0);
  assert.equal(h.calls.length, 0);
});
test("A-AC01 configuration inspection exposes only presence/shape", () => {
  const r = inspectInstantlyConfiguration(env);
  assert.equal(r.keyHeaderSafe, true);
  assert.equal(r.workspaceUuidValid, true);
  noPrivate(r);
  assert.equal(inspectInstantlyConfiguration({}).workspaceUuidValid, false);
});
test("A-AC02 authorization gates and malformed config consume no calls", async () => {
  for (const options of [
    { phase: "B" },
    { phase: "C" },
    { phase: "A", authorizedNew: 13 },
    { includedCallsConfirmed: false },
    { authorizedNew: undefined },
  ]) {
    const h = harness();
    await assert.rejects(h.run(options), /INSTANTLY_A_AUTHORIZATION_REQUIRED/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.writes, 0);
  }
  for (const config of [
    { ...env, INSTANTLY_API_KEY: "bad\r\nkey" },
    { ...env, INSTANTLY_API_KEY: "" },
    { ...env, INSTANTLY_WORKSPACE_ID: "wrong" },
  ]) {
    const h = harness();
    await assert.rejects(h.run({}, config), /INVALID_CONFIGURATION/);
    assert.equal(h.calls.length, 0);
  }
});
test("A-AC03 workspace mismatch stops at exactly one request", async () => {
  const h = harness();
  h.alter = (b, p) => {
    if (p === "workspaces/current") b.id = other;
  };
  const r = await h.run();
  assert.equal(r.error, "WORKSPACE_MISMATCH");
  assert.equal(r.calls, 1);
  assert.equal(r.results?.workspaceMatched, false);
  noPrivate(r);
});
test("A-AC03 tenant mismatch in plan/key/account/campaign stops", async () => {
  for (const path of [
    "workspace-billing/plan-details",
    "api-keys",
    "accounts",
    "campaigns",
  ]) {
    const h = harness();
    h.fullPages = true;
    h.alter = (b, p) => {
      if (p === path) {
        if (b.items)
          b.items[0][p === "api-keys" ? "organization_id" : "organization"] =
            other;
        else b.organization_id = other;
      }
    };
    const r = await h.run();
    assert.equal(r.error, "WORKSPACE_MISMATCH");
    assert.equal(r.status, "failed");
    assert.equal(h.calls.at(-1)?.path, path);
  }
});
test("A-AC04/10 happy path is six GETs, exact-key scopes and no write authorization", async () => {
  const h = harness(),
    r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 6);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.results?.keys.scopes["all:all"], false);
  assert.equal(r.results?.keys.scopes["campaigns:create"], true);
  assert.equal(r.results?.plan.availableContactSlots, 24900);
  assert.equal(r.writesAuthorized, false);
  assert.equal(r.realResponseAndStoppingVerified, false);
  for (let i = 1; i < h.calls.length; i++)
    assert.ok(h.calls[i].at - h.calls[i - 1].at >= 1000);
  noPrivate(r);
  noPrivate({
    ...h.store.value,
    fingerprint: undefined,
    manifestHash: undefined,
    nonce: undefined,
  });
});
test("A-AC04/05 all pages honor 3/2/2 and encode cursors containing ampersands", async () => {
  const h = harness();
  h.fullPages = true;
  const r = await h.run();
  assert.equal(r.calls, 10);
  assert.equal(r.status, "completed");
  assert.equal(r.results?.accounts.count, 2);
  assert.equal(r.results?.keys.scopes["all:all"], false);
  assert.equal(h.calls.filter((c) => c.path === "api-keys").length, 3);
  assert.ok(h.calls.some((c) => c.cursor?.includes("&" + pii)));
  noPrivate(r);
});
test("A-AC04 only the exact current key is attributed; masked/notfound stay unknown", async () => {
  for (const masked of ["********", "a-different-key"]) {
    const h = harness();
    h.alter = (b, p) => {
      if (p === "api-keys") {
        b.items[0].key = masked;
        b.items[0].scopes = ["all:all"];
      }
    };
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(r.results?.keys.identified, false);
    assert.equal(r.results?.keys.reason, "not_found");
    assert.ok(Object.values(r.results!.keys.scopes).every((v) => v === null));
    assert.ok(r.blockers.includes("CURRENT_KEY_SCOPES_UNKNOWN"));
  }
});
test("A-AC04 key page limit and missing scopes remain explicit unknowns", async () => {
  for (const missing of [false, true]) {
    const h = harness();
    h.alter = (b, p) => {
      if (p === "api-keys") {
        if (missing) delete b.items[0].scopes;
        else {
          b.items[0].key = "other";
          b.next_starting_after =
            "page" + (h.calls.filter((c) => c.path === p).length + 1);
          b.items[0].id = id(100 + h.calls.length);
        }
      }
    };
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(
      r.results?.keys.reason,
      missing ? "scopes_missing" : "page_limit",
    );
    assert.equal(
      h.calls.filter((c) => c.path === "api-keys").length,
      missing ? 1 : 3,
    );
  }
});
test("A-AC04 optional key403 continues without retry, other403 stops", async () => {
  for (const path of ["api-keys", "accounts"]) {
    const h = harness();
    h.fault = (p) => (p === path ? json({ message: secret }, 403) : undefined);
    const r = await h.run();
    assert.equal(r.budget.retry, 0);
    if (path === "api-keys") {
      assert.equal(r.status, "completed");
      assert.equal(r.results?.keys.reason, "forbidden");
    } else {
      assert.equal(r.error, "HTTP_403");
      assert.equal(h.calls.at(-1)?.path, path);
    }
    noPrivate(r);
  }
});
test("A-AC05 accounts/campaigns exceeding pages stop, never claim completeness", async () => {
  for (const path of ["accounts", "campaigns"] as const) {
    const h = harness();
    h.fullPages = true;
    h.alter = (b, p, page) => {
      if (p === path) b.next_starting_after = "page" + (page + 1);
    };
    const r = await h.run();
    assert.equal(r.error, "PAGINATION_LIMIT");
    assert.equal(r.results?.[path].complete, false);
    assert.equal(h.calls.filter((c) => c.path === path).length, 2);
  }
});
test("A-AC05 cursor cycle, duplicate record and malformed lists fail closed", async () => {
  for (const kind of ["cursor", "duplicate", "schema"]) {
    const h = harness();
    h.fullPages = true;
    h.alter = (b, p, page) => {
      if (p !== "accounts") return;
      if (kind === "cursor") b.next_starting_after = "repeated";
      if (kind === "duplicate") b.items[0].email = "same@example.invalid";
      if (kind === "schema") b.items = { message: secret };
    };
    const r = await h.run();
    assert.equal(
      r.error,
      kind === "cursor"
        ? "CURSOR_REPEATED"
        : kind === "duplicate"
          ? "DUPLICATE_RECORD"
          : "INVALID_SCHEMA",
    );
    noPrivate(r);
  }
});
test("A-AC06 allowlist refuses all mutations, cross-origin, alternate query and path confusion", () => {
  const n = "a".repeat(24),
    base = "https://api.instantly.ai/api/v2/";
  assert.equal(
    instantlyPhaseAUrlAllowed(base + "accounts?limit=100", "GET", n),
    true,
  );
  for (const raw of [
    "https://evil.invalid/api/v2/accounts?limit=100",
    base + "campaigns/anything/activate",
    base + "accounts?limit=100&limit=100",
    base + "accounts?limit=100&search=anything",
    base + "accounts?limit=1",
    base + "workspaces/current?x=1",
    base + "accounts?limit=100#x",
    base + "%61ccounts?limit=100",
    base + "campaigns?limit=100&search=wrong",
    "https://user:pass@api.instantly.ai/api/v2/accounts?limit=100",
    base + "accounts/../accounts?limit=100",
  ])
    assert.equal(instantlyPhaseAUrlAllowed(raw, "GET", n), false);
  for (const method of ["POST", "PATCH", "DELETE", "HEAD"])
    assert.equal(
      instantlyPhaseAUrlAllowed(base + "accounts?limit=100", method, n),
      false,
    );
});
test("A-AC06 redirects, nonJSON, malformed JSON and excessive bodies are not retried", async () => {
  const replies = [
    new Response(null, {
      status: 302,
      headers: { location: "https://evil.invalid" },
    }),
    new Response(secret, { headers: { "content-type": "text/html" } }),
    new Response("{bad", { headers: { "content-type": "application/json" } }),
    json({}, 200, { "content-length": String(2 * 1024 * 1024 + 1) }),
    new Response(" ".repeat(2 * 1024 * 1024 + 1), {
      headers: { "content-type": "application/json" },
    }),
  ];
  for (const [i, response] of replies.entries()) {
    const h = harness();
    h.fault = () => response;
    const r = await h.run();
    assert.equal(r.calls, 1);
    assert.equal(r.budget.retry, 0);
    assert.equal(
      r.error,
      i === 0
        ? "BLOCKED_REDIRECT"
        : i >= 3
          ? "RESPONSE_LIMIT"
          : "INVALID_RESPONSE",
    );
    noPrivate(r);
  }
});
test("A-AC07 401/402/403/404 stop at one request without retry or raw error", async () => {
  for (const status of [401, 402, 403, 404]) {
    const h = harness();
    h.fault = () => json({ message: secret, email: pii }, status);
    const r = await h.run();
    assert.equal(r.calls, 1);
    assert.equal(r.budget.retry, 0);
    noPrivate(r);
  }
});
test("A-AC07 network/429/5xx retry once, each counted and backoff respected", async () => {
  for (const kind of ["network", "429", "503"]) {
    const h = harness();
    h.fault = (p, _, attempt) =>
      p === "workspaces/current" && attempt === 1
        ? kind === "network"
          ? Error(secret)
          : json({}, Number(kind), { "retry-after": "7" })
        : undefined;
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(r.calls, 7);
    assert.equal(r.budget.retry, 1);
    assert.ok(h.clock.waits.includes(kind === "network" ? 5000 : 7000));
    noPrivate(r);
  }
});
test("A-AC07 maximum ten normals plus two retries is exactly twelve", async () => {
  const h = harness();
  h.fullPages = true;
  h.fault = (p, _, a) =>
    ["workspaces/current", "workspace-billing/plan-details"].includes(p) &&
    a === 1
      ? json({}, 503)
      : undefined;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 12);
  assert.equal(r.budget.normal, 10);
  assert.equal(r.budget.retry, 2);
});
test("A-AC07 repeated transient or exhausted R cannot acquire another request", async () => {
  for (const all of [false, true]) {
    const h = harness();
    h.fault = (p, _, a) =>
      (all || p === "workspaces/current") && (all ? a === 1 : true)
        ? json({}, 503)
        : undefined;
    const r = await h.run();
    assert.equal(r.error, "RETRY_LIMIT");
    assert.equal(r.budget.retry, all ? 2 : 1);
    assert.equal(r.calls, all ? 5 : 2);
  }
});
test("A-AC07 Retry-After above60s or invalid value stops without sleeping/retry", async () => {
  for (const retry of ["61", "garbage"]) {
    const h = harness();
    h.fault = () => json({}, 429, { "retry-after": retry });
    const r = await h.run();
    assert.equal(r.error, "RETRY_WAIT_TOO_LONG");
    assert.equal(r.calls, 1);
    assert.deepEqual(h.clock.waits, []);
  }
});
test("A-AC06/07 cancel before call or during stalled stream is bounded and not retried", async () => {
  const controller = new AbortController();
  controller.abort();
  const before = harness();
  const r = await before.run({ signal: controller.signal });
  assert.equal(r.calls, 0);
  assert.equal(r.error, "CANCELLED");
  const h = harness(),
    inFlight = new AbortController();
  h.fault = () => {
    queueMicrotask(() => inFlight.abort());
    return new Response(new ReadableStream({ start() {} }), {
      headers: { "content-type": "application/json" },
    });
  };
  const after = await h.run({ signal: inFlight.signal });
  assert.equal(after.error, "CANCELLED");
  assert.equal(after.calls, 1);
  assert.equal(after.budget.retry, 0);
});
test("A-AC06 eight-second deadline bounds stalled fetch and stream with one retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    for (const stream of [false, true]) {
      const h = harness();
      let attempts = 0;
      const fetchImpl: typeof fetch = async () => {
        attempts++;
        return stream
          ? new Response(new ReadableStream({ start() {} }), {
              headers: { "content-type": "application/json" },
            })
          : new Promise<Response>(() => {});
      };
      const running = h.run({ fetchImpl });
      while (attempts < 1) await turn();
      t.mock.timers.tick(8000);
      while (attempts < 2) await turn();
      t.mock.timers.tick(8000);
      const result = await running;
      assert.equal(result.error, "RETRY_LIMIT");
      assert.equal(result.calls, 2);
      assert.equal(result.budget.retry, 1);
      assert.deepEqual(
        h.store.value?.requests.map((r) => r.result),
        ["NETWORK_OR_TIMEOUT", "NETWORK_OR_TIMEOUT"],
      );
    }
  } finally {
    t.mock.timers.reset();
  }
});

test("A-AC07 Retry-After HTTP date uses server clock and synchronous network failures retry", async () => {
  const h = harness();
  h.fault = (p, _, a) =>
    p === "workspaces/current" && a === 1
      ? json({}, 429, {
          date: "Mon, 26 Oct 2026 12:00:00 GMT",
          "retry-after": "Mon, 26 Oct 2026 12:00:08 GMT",
        })
      : undefined;
  assert.equal((await h.run()).status, "completed");
  assert.ok(h.clock.waits.includes(8000));
  const synchronous = harness();
  let attempts = 0;
  const r = await synchronous.run({
    fetchImpl: (() => {
      attempts++;
      throw Error(secret);
    }) as typeof fetch,
  });
  assert.equal(r.error, "RETRY_LIMIT");
  assert.equal(attempts, 2);
  noPrivate(r);
});

test("A-AC07 storage failures before HTTP and after HTTP never cause retry", async () => {
  for (const failAt of [1, 2, 3]) {
    const h = harness();
    h.store.failAt = failAt;
    await assert.rejects(h.run());
    assert.equal(h.calls.length, failAt === 3 ? 1 : 0);
    if (failAt === 3)
      assert.equal(h.store.value?.requests[0].result, "IN_FLIGHT");
  }
});
test("A-AC08 completed, failed and IN_FLIGHT journals replay with zero HTTP/save", async () => {
  for (const mode of ["completed", "failed", "uncertain"]) {
    const h = harness();
    if (mode === "failed") h.fault = () => json({}, 401);
    if (mode === "uncertain") h.store.failAt = 3;
    try {
      await h.run();
    } catch {
      assert.equal(mode, "uncertain");
    }
    const calls = h.calls.length,
      writes = h.store.writes;
    const r = await h.run();
    assert.equal(h.calls.length, calls);
    assert.equal(h.store.writes, writes);
    if (mode === "uncertain") assert.equal(r.lastAttemptUncertain, true);
  }
});
test("A-AC08 key/workspace/manifest changes cannot reuse journal or reset counter", async () => {
  const h = harness();
  await h.run();
  const count = h.calls.length;
  for (const config of [
    { ...env, INSTANTLY_API_KEY: "changed" },
    { ...env, INSTANTLY_WORKSPACE_ID: other },
  ])
    await assert.rejects(h.run({}, config), /INSTANTLY_BINDING_CHANGED/);
  const mutated = structuredClone(h.store.value!);
  mutated.manifestHash = "0".repeat(64);
  assert.throws(
    () => validateInstantlyState(mutated),
    /INVALID_INSTANTLY_JOURNAL/,
  );
  assert.equal(h.calls.length, count);
});
test("A-AC09 journal schemas and transitions reject resets/downgrades/injected values", async () => {
  const h = harness();
  await h.run();
  const s = h.store.value!;
  for (const change of [
    (s: any) => (s.calls = 0),
    (s: any) => (s.version = 0),
    (s: any) => (s.phase = "B"),
    (s: any) => (s.results.keys.scopes["arbitrary-private"] = true),
    (s: any) => (s.normal = 11),
    (s: any) => (s.requests[0].op = "accounts"),
    (s: any) => (s.results.workspaceMatched = false),
  ]) {
    const copy = structuredClone(s);
    change(copy);
    assert.throws(() => validateInstantlyState(copy));
  }
  const copy = structuredClone(s);
  copy.results.accounts.configuredDailyLimitSum++;
  assert.throws(
    () => assertInstantlyTransition(s, copy),
    /INSTANTLY_HISTORY_IMMUTABLE/,
  );
});
test("A-AC10 unknown status/limits/event types and existing nonce remain explicit", async () => {
  const h = harness();
  h.alter = (b, p) => {
    if (p === "accounts") {
      b.items[0].status = 999;
      delete b.items[0].daily_limit;
    }
    if (p === "workspace-billing/plan-details")
      delete b.subscriptions.outreach.current_lead_count;
    if (p === "webhooks/event-types") b.event_types = [];
    if (p === "campaigns")
      b.items = [
        {
          id: id(99),
          organization: workspace,
          name: "S00-INSTANTLY-" + h.store.value!.nonce,
        },
      ];
  };
  const r = await h.run();
  assert.equal(r.results?.accounts.unknownStatus, 1);
  assert.equal(r.results?.accounts.dailyLimitsKnown, 0);
  assert.ok(r.blockers.includes("CONTACT_CAPACITY_UNKNOWN"));
  assert.ok(r.blockers.includes("TRIAL_NAME_ALREADY_EXISTS"));
  assert.ok(r.blockers.includes("REQUIRED_EVENT_TYPES_NOT_CONFIRMED"));
  assert.equal(r.writesAuthorized, false);
  for (const current of [24999, 25000, 25001]) {
    const capacity = harness();
    capacity.alter = (body, path) => {
      if (path === "workspace-billing/plan-details")
        body.subscriptions.outreach.current_lead_count = current;
    };
    const report = await capacity.run();
    assert.ok(
      report.blockers.includes(
        current > 25000
          ? "CONTACT_CAPACITY_UNKNOWN"
          : "CONTACT_CAPACITY_BELOW_TWO",
      ),
    );
    assert.equal(report.writesAuthorized, false);
  }
});

test("A-AC09 filesystem default creates nothing; lock/temp/corrupt journal preserved", async () => {
  await mkdir(resolve(".local"), { recursive: true });
  const dir = await mkdtemp(resolve(".local", "s00-ins-files-"));
  try {
    const files = instantlyFiles(dir);
    assert.equal((await runInstantlyPhaseA({}, files.store)).calls, 0);
    assert.deepEqual(await readdir(dir), []);
    const folder = resolve(dir, ".local/pipeline-os"),
      path = resolve(folder, "s00-instantly-run.json");
    await mkdir(folder, { recursive: true });
    await writeFile(path + ".lock", "foreign");
    await assert.rejects(
      files.locked(async () => {}),
      /INSTANTLY_JOURNAL_LOCKED/,
    );
    assert.equal(await readFile(path + ".lock", "utf8"), "foreign");
    await rm(path + ".lock");
    const h = harness();
    await h.run();
    const final = h.store.value!;
    await writeFile(path, "{bad");
    await assert.rejects(files.store.load(), /INVALID_INSTANTLY_JOURNAL_JSON/);
    await rm(path);
    // Obtain a genuine initial state rather than resetting any real journal.
    const initHarness = harness();
    initHarness.store.failAt = 2;
    await assert.rejects(initHarness.run());
    const initial = initHarness.store.value!;
    await writeFile(path + ".tmp", "foreign");
    await assert.rejects(files.store.save(initial));
    assert.equal(await readFile(path + ".tmp", "utf8"), "foreign");
    await rm(path + ".tmp");
    await files.locked(() => files.store.save(initial));
    assert.deepEqual(await files.store.load(), initial);
    await assert.rejects(
      files.store.save(final),
      /INSTANTLY_HISTORY_IMMUTABLE/,
    );
    assert.deepEqual(await files.store.load(), initial);
    await writeFile(path, " ".repeat(65537));
    await assert.rejects(files.store.load());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("A-AC01/02 CLI offline and invalid phases cannot load env files or use network", async () => {
  await mkdir(resolve(".local"), { recursive: true });
  const dir = await mkdtemp(resolve(".local", "s00-ins-cli-"));
  try {
    const cli = resolve("scripts/pipeline-os/s00-instantly-runner-cli.ts"),
      tsx = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
    const preload = resolve(dir, "guard.mjs");
    await writeFile(
      preload,
      'globalThis.fetch=()=>{throw new Error("NO_NETWORK_SENTINEL")};\n',
    );
    await writeFile(
      resolve(dir, ".env.local"),
      "INSTANTLY_API_KEY=SHOULD_NOT_LOAD\n",
    );
    for (const flags of [
      [],
      ["--check-config"],
      ["--execute"],
      [
        "--execute",
        "--phase",
        "B",
        "--authorized-new",
        "12",
        "--included-calls-confirmed",
      ],
      [
        "--execute",
        "--phase",
        "A",
        "--authorized-new",
        "13",
        "--included-calls-confirmed",
      ],
      ["--unknown-private-flag"],
    ]) {
      const p = spawnSync(
        process.execPath,
        [
          "--import",
          tsx,
          "--import",
          pathToFileURL(preload).href,
          cli,
          ...flags,
        ],
        {
          cwd: dir,
          encoding: "utf8",
          env: {
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: "test",
            INSTANTLY_API_KEY: secret,
            INSTANTLY_WORKSPACE_ID: workspace,
          },
        },
      );
      const output = p.stdout + p.stderr;
      assert.ok(!output.includes(secret));
      assert.ok(!output.includes("SHOULD_NOT_LOAD"));
      assert.ok(!output.includes("unknown-private-flag"));
      assert.equal(
        p.status,
        flags.includes("--execute") || flags.includes("--unknown-private-flag")
          ? 2
          : 0,
      );
    }
    assert.deepEqual(
      (await readdir(dir)).sort(),
      [".env.local", "guard.mjs"].sort(),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("A-AC09/10 CLI completes against a fixture-only transport, then replays with zero HTTP", async () => {
  await mkdir(resolve(".local"), { recursive: true });
  const dir = await mkdtemp(resolve(".local", "s00-ins-e2e-"));
  try {
    const guard = resolve(dir, "fixture.mjs"),
      cli = resolve("scripts/pipeline-os/s00-instantly-runner-cli.ts");
    const loader = pathToFileURL(
      resolve("node_modules/tsx/dist/loader.mjs"),
    ).href;
    await writeFile(
      guard,
      `
import {appendFileSync} from 'node:fs';
globalThis.fetch = async (raw, options) => {
 const u=new URL(String(raw));
 if(u.origin!=='https://api.instantly.ai'||options.method!=='GET'||options.redirect!=='manual')throw Error('FIXTURE_GUARD');
 appendFileSync('calls.txt','GET\\n');
 const w=process.env.INSTANTLY_WORKSPACE_ID;
 const body=u.pathname.endsWith('/workspaces/current')?{id:w}:
 u.pathname.endsWith('/plan-details')?{organization_id:w,subscriptions:{outreach:{total_lead_limit:100,current_lead_count:2}}}:
 u.pathname.endsWith('/api-keys')?{items:[{id:'00000000-0000-4000-8000-000000000010',organization_id:w,key:process.env.INSTANTLY_API_KEY,scopes:['all:read']}]}:
 u.pathname.endsWith('/accounts')?{items:[]}:
 u.pathname.endsWith('/event-types')?{event_types:['reply_received','email_bounced','lead_unsubscribed'].map(id=>({id}))}:
 u.pathname.endsWith('/campaigns')?{items:[]}:null;
 if(!body)throw Error('UNEXPECTED_FIXTURE_ROUTE');
 return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
};
`,
    );
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
          timeout: 20_000,
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
      "--phase",
      "A",
      "--authorized-new",
      "12",
      "--included-calls-confirmed",
    ];
    const first = run(flags);
    assert.equal(first.status, 0, first.stderr);
    const report = JSON.parse(first.stdout);
    assert.equal(report.calls, 6);
    assert.equal(report.status, "completed");
    noPrivate(report);
    const path = resolve(dir, ".local/pipeline-os/s00-instantly-run.json"),
      before = await readFile(path, "utf8");
    const status = run([]),
      replay = run(flags);
    assert.equal(status.status, 0);
    assert.equal(replay.status, 0);
    assert.equal(await readFile(path, "utf8"), before);
    assert.equal(
      (await readFile(resolve(dir, "calls.txt"), "utf8")).trim().split("\n")
        .length,
      6,
    );
    assert.equal(
      (await readdir(resolve(dir, ".local/pipeline-os"))).some((p) =>
        /\.tmp$|\.lock$/.test(p),
      ),
      false,
    );
    noPrivate(JSON.parse(status.stdout));
    noPrivate(JSON.parse(replay.stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
