import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ConnectError,
  connectIdentitySchema,
} from "../src/lib/composio-connect";
import { ConnectNotEmitted } from "../src/lib/server/mail-accounts/composio-connect/orchestrator";
import { validateConnectProviderConfiguration } from "../src/lib/server/mail-accounts/composio-connect/config";
import {
  createConnectProvider,
  type ConnectProviderOptions,
} from "../src/lib/server/mail-accounts/composio-connect/provider";

// All payloads below are synthetic examples derived from t004-sources.json, never live observations.
const originalFetch = globalThis.fetch;
let realFetchCalls = 0;
globalThis.fetch = (async () => {
  realFetchCalls++;
  throw new Error("Real network forbidden");
}) as typeof fetch;
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(realFetchCalls, 0);
});
const clone = <T>(v: T): T => structuredClone(v);
const safe = (error: unknown) => {
  assert.ok(error instanceof ConnectError);
  assert.equal(error.code, "CONNECT_UNAVAILABLE");
  assert.equal(error.beforeEmission, false);
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(
    String(error) + JSON.stringify(error),
    /sensitive-fixture|ln_fixture|synthetic_test_key|mailbox@/,
  );
  return true;
};
const notEmitted = (error: unknown) => {
  assert.ok(error instanceof ConnectNotEmitted);
  assert.equal(error.cause, undefined);
  return true;
};
const unavailable = (error: unknown) => {
  assert.ok(error instanceof ConnectError);
  assert.equal(error.code, "CONNECT_UNAVAILABLE");
  return true;
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function until(fn: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await Promise.resolve();
  }
  assert.fail("Injected phase not reached");
}
function response(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fixture() {
  let time = 1_700_000_000_000,
    timerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock = {
    now: () => time,
    setTimer(callback: () => void, ms: number) {
      const id = ++timerId;
      timers.set(id, { at: time + ms, callback });
      return id;
    },
    clearTimer(handle: unknown) {
      timers.delete(handle as number);
    },
  };
  const advance = (ms: number, fire = true) => {
    time += ms;
    if (fire)
      for (const [id, t] of [...timers])
        if (t.at <= time) {
          timers.delete(id);
          t.callback();
        }
  };
  const configuration = {
    enabled: true as const,
    config: {
      generation: 1,
      project_id: "pr_fixture",
      auth_config_id: "ac_fixture",
      quota_project_id: "google_fixture",
      owner_id: "fixture_owner",
      callback_mode: "standard" as const,
    },
    context: {
      composio_project_id: "pr_fixture",
      credential_version: "fixture_v1",
      google_quota_project_id: "google_fixture",
      auth_config_revision: "fixture_r1",
      provenance_reference: "fixture_review",
      project_provenance: "server_reviewed" as const,
      quota_provenance: "oauth_client_reviewed" as const,
    },
    callback_origin: "https://crm.example.test",
  };
  const calls: { url: string; init: RequestInit }[] = [];
  const queue: Array<Response | (() => Response | Promise<Response>)> = [];
  const fetchImpl = (async (url, init) => {
    calls.push({ url: String(url), init: init! });
    const next = queue.shift();
    if (!next) throw new Error("sensitive-fixture-unexpected-request");
    return typeof next === "function" ? await next() : next;
  }) as typeof fetch;
  const options: ConnectProviderOptions = {
    configuration,
    expectedConfiguration: clone(configuration),
    credential: { version: "fixture_v1", api_key: "synthetic_test_key" },
    clock,
    fetchImpl,
  };
  const provider = createConnectProvider(options);
  const controller = new AbortController();
  const tuple = {
    project_id: "pr_fixture",
    auth_config_id: "ac_fixture",
    owner_id: "fixture_owner",
    signal: controller.signal,
  };
  const start = () => ({
    ...tuple,
    attempt_id: randomUUID(),
    callback_url:
      "https://crm.example.test/api/mail/composio/connect/callback?state=" +
      randomUUID(),
  });
  const identity = () => ({ ...tuple, connected_account_id: "ca_fixture" });
  const link = () => ({
    link_token: "sensitive-fixture-discard",
    redirect_url: "https://connect.composio.dev/link/ln_fixture",
    expires_at: new Date(time + 600_000).toISOString(),
    connected_account_id: "ca_fixture",
    experimental: { account_type: "PRIVATE" },
  });
  const connection = () => ({
    id: "ca_fixture",
    user_id: "fixture_owner",
    toolkit: { slug: "gmail" },
    authScheme: "OAUTH2",
    auth_config: {
      id: "ac_fixture",
      auth_scheme: "OAUTH2",
      is_disabled: false,
    },
    status: "ACTIVE",
    is_disabled: false,
    experimental: { account_type: "PRIVATE" },
    state: {
      val: {
        displayName: "sensitive-fixture-display",
        oauth_token: "sensitive-fixture-token",
      },
    },
    requested_scopes: ["sensitive-fixture-not-effective"],
  });
  const auth = () => ({
    id: "ac_fixture",
    toolkit: { slug: "gmail" },
    auth_scheme: "OAUTH2",
    status: "ENABLED",
    credentials: { client_secret: "sensitive-fixture-config" },
  });
  const profile = () => ({
    status: 200,
    data: {
      emailAddress: "MAILBOX@example.test",
      historyId: "sensitive-fixture-history",
    },
    headers: { "sensitive-fixture": "sensitive-fixture-header" },
  });
  const queueIdentity = () =>
    queue.push(response(connection()), response(auth()), response(profile()));
  return {
    configuration,
    clock,
    timers,
    advance,
    calls,
    queue,
    options,
    provider,
    controller,
    start,
    identity,
    link,
    connection,
    auth,
    profile,
    queueIdentity,
  };
}

test("T004-UT01: descriptor validation rejects missing/unknown provenance and inconsistent context before transport", () => {
  for (const mutate of [
    (c: any) => {
      c.enabled = false;
    },
    (c: any) => {
      delete c.context;
    },
    (c: any) => {
      c.config.callback_mode = "global_verifier";
    },
    (c: any) => {
      c.context.project_provenance = "unknown";
    },
    (c: any) => {
      c.context.quota_provenance = "requested_scopes";
    },
    (c: any) => {
      c.context.composio_project_id = "pr_other";
    },
    (c: any) => {
      c.config.quota_project_id = "other";
    },
    (c: any) => {
      c.callback_origin = "http://crm.example.test";
    },
    (c: any) => {
      c.callback_origin = "https://crm.example.test/path";
    },
    (c: any) => {
      c.extra = true;
    },
  ]) {
    const f = fixture(),
      c = clone(f.configuration);
    mutate(c);
    assert.throws(
      () => createConnectProvider({ ...f.options, configuration: c }),
      unavailable,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("T004-UT01: exact generation, credential/config revisions, provenance and callback snapshot are required", () => {
  for (const mutate of [
    (c: ReturnType<typeof fixture>["configuration"]) => {
      c.config.generation++;
    },
    (c: ReturnType<typeof fixture>["configuration"]) => {
      c.context.credential_version = "fixture_v2";
    },
    (c: ReturnType<typeof fixture>["configuration"]) => {
      c.context.auth_config_revision = "fixture_r2";
    },
    (c: ReturnType<typeof fixture>["configuration"]) => {
      c.context.provenance_reference = "other_review";
    },
    (c: ReturnType<typeof fixture>["configuration"]) => {
      c.callback_origin = "https://other.example.test";
    },
  ]) {
    const f = fixture(),
      expected = clone(f.configuration);
    mutate(expected);
    assert.throws(
      () =>
        createConnectProvider({
          ...f.options,
          expectedConfiguration: expected,
        }),
      (e: unknown) => e instanceof ConnectError && e.code === "CONNECT_STALE",
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.throws(
    () =>
      createConnectProvider({
        ...f.options,
        credential: { version: "wrong", api_key: "synthetic_test_key" },
      }),
    unavailable,
  );
  assert.throws(
    () =>
      createConnectProvider({
        ...f.options,
        credential: { version: "fixture_v1", api_key: "header\r\ninjection" },
      }),
    unavailable,
  );
  const value = validateConnectProviderConfiguration(
    f.configuration,
    clone(f.configuration),
  );
  assert.ok(Object.isFrozen(value.config));
  assert.ok(Object.isFrozen(value.context));
});

test("T004-UT02: link creation uses exactly one fixed POST and returns only normalized link fields", async () => {
  const f = fixture(),
    input = f.start(),
    wire = f.link();
  f.queue.push(response(wire, 201));
  const link = await f.provider.createLink(input);
  assert.deepEqual(link, {
    connected_account_id: "ca_fixture",
    url: wire.redirect_url,
    expires_at_ms: Date.parse(wire.expires_at),
  });
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(
    call.url,
    "https://backend.composio.dev/api/v3.1/connected_accounts/link",
  );
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.redirect, "manual");
  assert.deepEqual(JSON.parse(String(call.init.body)), {
    auth_config_id: "ac_fixture",
    user_id: "fixture_owner",
    callback_url: input.callback_url,
  });
  assert.deepEqual(Object.keys(call.init.headers!).sort(), [
    "accept",
    "content-type",
    "x-api-key",
  ]);
  assert.equal(
    new Headers(call.init.headers).get("x-api-key"),
    "synthetic_test_key",
  );
  assert.doesNotMatch(JSON.stringify(link), /token|experimental/);
  assert.equal(f.timers.size, 0);
});

test("T004-UT02: factory snapshots configuration and credentials without exposing them", async () => {
  const f = fixture();
  f.configuration.config.owner_id = "mutated";
  (f.options.credential as { api_key: string }).api_key = "mutated";
  f.queue.push(response(f.link(), 201));
  await f.provider.createLink(f.start());
  assert.equal(
    new Headers(f.calls[0].init.headers).get("x-api-key"),
    "synthetic_test_key",
  );
  assert.deepEqual(Object.keys(f.provider).sort(), [
    "createLink",
    "readIdentity",
  ]);
});

test("T004-UT03: invalid link shape, timestamp, expiry, sharing or navigation is rejected after one emission", async () => {
  for (const change of [
    { connected_account_id: "wrong" },
    { expires_at: "2026-02-30T12:00:00Z" },
    { expires_at: "not-a-date" },
    { expires_at: "2020-01-01T00:00:00Z" },
    { redirect_url: "https://evil.example.test/link/ln_fixture" },
    { redirect_url: "http://connect.composio.dev/link/ln_fixture" },
    {
      redirect_url:
        "https://connect.composio.dev/link/ln_fixture?secret=fixture",
    },
    {
      redirect_url:
        "https://user:password@connect.composio.dev/link/ln_fixture",
    },
    { experimental: { account_type: "SHARED" } },
  ]) {
    const f = fixture();
    f.queue.push(response({ ...f.link(), ...change }, 201));
    await assert.rejects(f.provider.createLink(f.start()), safe);
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  }
  const f = fixture(),
    wire = f.link() as Record<string, unknown>;
  delete wire.connected_account_id;
  f.queue.push(response(wire, 201));
  await assert.rejects(f.provider.createLink(f.start()), safe);
});

test("T004-UT04: HTTP failures and thrown transport errors are unknown outcomes, with no automatic retry", async () => {
  for (const status of [200, 302, 400, 401, 404, 422, 429, 500, 501]) {
    const f = fixture();
    f.queue.push(response({ error: "sensitive-fixture-provider" }, status));
    await assert.rejects(f.provider.createLink(f.start()), safe);
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  }
  const f = fixture();
  f.queue.push(() => {
    throw new Error("sensitive-fixture-network");
  });
  await assert.rejects(f.provider.createLink(f.start()), safe);
  assert.equal(f.calls.length, 1);
});

test("T004-UT04: header timeout aborts emitted creation and ignores a late acknowledgement", async () => {
  const f = fixture(),
    gate = deferred<Response>();
  f.queue.push(() => gate.promise);
  const pending = f.provider.createLink(f.start());
  const rejection = assert.rejects(pending, safe);
  await until(() => f.calls.length === 1);
  f.advance(10_000);
  await rejection;
  assert.equal(f.calls[0].init.signal?.aborted, true);
  assert.equal(f.timers.size, 0);
  gate.resolve(response(f.link(), 201));
  await Promise.resolve();
  assert.equal(f.calls.length, 1);
});

test("T004-UT05: invalid tuple, path injection, callback and pre-abort do not emit", async () => {
  for (const change of [
    { project_id: "pr_foreign" },
    { auth_config_id: "ac_other" },
    { owner_id: "other_owner" },
    { auth_config_id: "ac_fixture/../other" },
    {
      callback_url:
        "https://evil.example.test/api/mail/composio/connect/callback?state=" +
        randomUUID(),
    },
    {
      callback_url:
        "https://crm.example.test/api/mail/composio/connect/callback?state=short",
    },
    {
      callback_url:
        "https://crm.example.test/api/mail/composio/connect/callback?state=" +
        randomUUID() +
        "&state=" +
        randomUUID(),
    },
    {
      callback_url:
        "https://crm.example.test/api/mail/composio/connect/callback?state=" +
        randomUUID() +
        "#extra",
    },
    { callback_url: "https://crm.example.test/wrong?state=" + randomUUID() },
  ]) {
    const f = fixture();
    await assert.rejects(
      f.provider.createLink({ ...f.start(), ...change }),
      notEmitted,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.timers.size, 0);
  }
  const f = fixture();
  f.controller.abort();
  await assert.rejects(f.provider.createLink(f.start()), notEmitted);
  assert.equal(f.calls.length, 0);
  const g = fixture();
  await assert.rejects(
    g.provider.readIdentity({
      ...g.identity(),
      connected_account_id: "ca_fixture/other",
    }),
    safe,
  );
  assert.equal(g.calls.length, 0);
});

test("T004-UT05: timer/clock installation failures before emission are safe and leave no abort listener", async () => {
  const f = fixture();
  let added = 0,
    removed = 0;
  const signal = f.controller.signal,
    add = signal.addEventListener.bind(signal),
    remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((
    ...args: Parameters<typeof signal.addEventListener>
  ) => {
    added++;
    return add(...args);
  }) as typeof signal.addEventListener;
  signal.removeEventListener = ((
    ...args: Parameters<typeof signal.removeEventListener>
  ) => {
    removed++;
    return remove(...args);
  }) as typeof signal.removeEventListener;
  f.clock.setTimer = () => {
    throw new Error("sensitive-fixture-timer");
  };
  await assert.rejects(f.provider.createLink(f.start()), notEmitted);
  assert.equal(f.calls.length, 0);
  assert.equal(added, removed);
  const g = fixture();
  g.clock.now = () => {
    throw new Error("sensitive-fixture-clock");
  };
  await assert.rejects(g.provider.createLink(g.start()), notEmitted);
  assert.equal(g.calls.length, 0);
});

test("T004-UT06: identity reads connection/config/profile in order with exact account and owner", async () => {
  const f = fixture();
  f.queueIdentity();
  const facts = await f.provider.readIdentity(f.identity());
  assert.deepEqual(facts, {
    connected_account_id: "ca_fixture",
    project_id: "pr_fixture",
    auth_config_id: "ac_fixture",
    owner_id: "fixture_owner",
    toolkit: "gmail",
    active: true,
    primary_email: "MAILBOX@example.test",
  });
  assert.deepEqual(
    f.calls.map((c) => [c.url, c.init.method]),
    [
      [
        "https://backend.composio.dev/api/v3.1/connected_accounts/ca_fixture",
        "GET",
      ],
      ["https://backend.composio.dev/api/v3.1/auth_configs/ac_fixture", "GET"],
      ["https://backend.composio.dev/api/v3.1/tools/execute/proxy", "POST"],
    ],
  );
  assert.equal(f.calls[0].init.body, undefined);
  assert.equal(f.calls[1].init.body, undefined);
  assert.deepEqual(JSON.parse(String(f.calls[2].init.body)), {
    connected_account_id: "ca_fixture",
    user_id: "fixture_owner",
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    method: "GET",
  });
  assert.doesNotMatch(
    JSON.stringify(facts),
    /sensitive-fixture|scopes|credentials|quota|verified|can_send|state/,
  );
  assert.equal(f.timers.size, 0);
});

test("COMPAT01: OAuth2 auth config remains authoritative when root scheme is absent or null", async () => {
  for (const value of [undefined, null, "OAUTH2"]) {
    const f = fixture();
    const wire = f.connection() as Record<string, unknown>;
    if (value === undefined) delete wire.authScheme;
    else wire.authScheme = value;
    f.queue.push(response(wire), response(f.auth()), response(f.profile()));
    const identity = connectIdentitySchema.parse(
      await f.provider.readIdentity(f.identity()),
    );
    assert.equal(identity.primary_email, "MAILBOX@example.test");
    assert.equal(identity.active, true);
    assert.equal(f.calls.length, 3);
    assert.deepEqual(
      f.calls.map((c) => c.init.method),
      ["GET", "GET", "POST"],
    );
    assert(!f.calls.some((c) => c.url.endsWith("/link")));
  }
});

test("COMPAT02: missing root scheme never substitutes for valid nested OAuth2 metadata", async () => {
  for (const change of [
    (c: any) => {
      delete c.auth_config.auth_scheme;
    },
    (c: any) => {
      c.auth_config.auth_scheme = "API_KEY";
    },
    (c: any) => {
      c.auth_config.is_disabled = true;
    },
    (c: any) => {
      c.user_id = "foreign_owner";
    },
    (c: any) => {
      c.authScheme = "API_KEY";
    },
    (c: any) => {
      c.authScheme = {};
    },
  ]) {
    const f = fixture();
    const wire: any = f.connection();
    delete wire.authScheme;
    change(wire);
    f.queue.push(response(wire));
    await assert.rejects(f.provider.readIdentity(f.identity()), safe);
    assert.equal(f.calls.length, 1);
  }
});

test("T004-UT07: foreign connection metadata stops before config/profile", async () => {
  for (const mutate of [
    (c: any) => {
      c.id = "ca_other";
    },
    (c: any) => {
      c.user_id = "other_owner";
    },
    (c: any) => {
      c.auth_config.id = "ac_other";
    },
    (c: any) => {
      c.toolkit.slug = "github";
    },
    (c: any) => {
      c.status = "INITIATED";
    },
    (c: any) => {
      c.is_disabled = true;
    },
    (c: any) => {
      c.auth_config.is_disabled = true;
    },
    (c: any) => {
      c.auth_config.auth_scheme = "API_KEY";
    },
    (c: any) => {
      c.authScheme = "API_KEY";
    },
    (c: any) => {
      c.experimental.account_type = "SHARED";
    },
    (c: any) => {
      delete c.is_disabled;
    },
    (c: any) => {
      delete c.user_id;
    },
  ]) {
    const f = fixture(),
      wire = f.connection();
    mutate(wire);
    f.queue.push(response(wire));
    await assert.rejects(f.provider.readIdentity(f.identity()), safe);
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  }
});

test("T004-UT08: missing/foreign/disabled auth config stops before profile", async () => {
  for (const mutate of [
    (a: any) => {
      a.id = "ac_other";
    },
    (a: any) => {
      a.status = "DISABLED";
    },
    (a: any) => {
      a.toolkit.slug = "github";
    },
    (a: any) => {
      delete a.auth_scheme;
    },
    (a: any) => {
      a.auth_scheme = "API_KEY";
    },
  ]) {
    const f = fixture(),
      wire = f.auth();
    mutate(wire);
    f.queue.push(response(f.connection()), response(wire));
    await assert.rejects(f.provider.readIdentity(f.identity()), safe);
    assert.equal(f.calls.length, 2);
    assert.equal(f.timers.size, 0);
  }
});

test("T004-UT08: proxy outer/inner status and primary Gmail email must all be valid", async () => {
  for (const [status, wire] of [
    [500, { error: "sensitive-fixture" }],
    [200, { status: 403, data: { emailAddress: "mailbox@example.test" } }],
    [200, { status: 200, data: { displayName: "mailbox@example.test" } }],
    [200, { status: 200, data: { emailAddress: "not-an-email" } }],
    [200, { status: 200, data: null }],
  ] as const) {
    const f = fixture();
    f.queue.push(
      response(f.connection()),
      response(f.auth()),
      response(wire, status),
    );
    await assert.rejects(f.provider.readIdentity(f.identity()), safe);
    assert.equal(f.calls.length, 3);
  }
});

test("T004-UT09: non-JSON, redirects, empty/malformed bodies and declared oversize are rejected", async () => {
  for (const make of [
    () =>
      new Response("sensitive-fixture-html", {
        status: 201,
        headers: { "content-type": "text/html" },
      }),
    () =>
      new Response("not-json", {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    () =>
      new Response(null, {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    () =>
      new Response("", {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    () => response({}, 201, { "content-length": "262145" }),
    () => response({}, 201, { "content-length": "invalid" }),
    () => {
      const r = response({}, 201);
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    },
  ]) {
    const f = fixture();
    f.queue.push(make());
    await assert.rejects(f.provider.createLink(f.start()), safe);
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  }
});

test("T004-UT09: streamed oversize is bounded independently of Content-Length and the body is cancelled", async () => {
  const f = fixture();
  let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(262_145));
    },
    cancel() {
      cancelled++;
    },
  });
  f.queue.push(
    new Response(stream, {
      status: 201,
      headers: { "content-type": "application/json", "content-length": "1" },
    }),
  );
  await assert.rejects(f.provider.createLink(f.start()), safe);
  assert.equal(cancelled, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

test("T004-UT10: stalled body is cancelled on abort, without a late parse or follow-up", async () => {
  const f = fixture();
  let cancelled = 0,
    reading = false;
  f.queue.push(
    new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          reading = true;
        },
        cancel() {
          cancelled++;
        },
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    ),
  );
  const pending = f.provider.createLink(f.start()),
    rejection = assert.rejects(pending, safe);
  await until(() => reading && f.calls.length === 1);
  f.controller.abort();
  await rejection;
  assert.equal(cancelled, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

test("T004-UT10: elapsed time rejects delayed scheduler success and stops identity between steps", async () => {
  const f = fixture();
  f.queue.push(() => {
    f.advance(10_000, false);
    return response(f.link(), 201);
  });
  await assert.rejects(f.provider.createLink(f.start()), safe);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
  const g = fixture();
  g.queue.push(() => {
    g.controller.abort();
    return response(g.connection());
  });
  await assert.rejects(g.provider.readIdentity(g.identity()), safe);
  assert.equal(g.calls.length, 1);
});

test("T004-UT10: identity per-read timeout aborts pending second request and never reaches profile", async () => {
  const f = fixture(),
    gate = deferred<Response>();
  f.queue.push(response(f.connection()), () => gate.promise);
  const pending = f.provider.readIdentity(f.identity()),
    rejection = assert.rejects(pending, safe);
  await until(() => f.calls.length === 2);
  f.advance(10_000);
  await rejection;
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].init.signal?.aborted, true);
  assert.equal(f.timers.size, 0);
  gate.resolve(response(f.auth()));
});

test("T004-UT11: forged dependency exceptions never assert non-emission or leak private payloads", async () => {
  for (const error of [
    new ConnectNotEmitted(),
    new ConnectError("CONNECT_NEEDS_RECONCILIATION"),
    new Error("sensitive-fixture-network"),
  ]) {
    error.message = "sensitive-fixture-message";
    Object.assign(error, { payload: "sensitive-fixture-payload" });
    const f = fixture();
    f.queue.push(() => {
      throw error;
    });
    await assert.rejects(f.provider.createLink(f.start()), safe);
    assert.equal(f.calls.length, 1);
    const g = fixture();
    g.queue.push(() => {
      throw error;
    });
    await assert.rejects(g.provider.readIdentity(g.identity()), safe);
    assert.equal(g.calls.length, 1);
  }
});

test("T004-UT12: required injected dependencies have no global fallback or eager effect", () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  assert.equal(f.timers.size, 0);
  for (const change of [
    { fetchImpl: undefined },
    { clock: {} },
    { configuration: undefined },
  ])
    assert.throws(
      () =>
        createConnectProvider({
          ...f.options,
          ...change,
        } as ConnectProviderOptions),
      unavailable,
    );
  assert.equal(realFetchCalls, 0);
  assert.equal(f.calls.length, 0);
});

test("T004-UT10: a progressing body stops at deadline even while timer callbacks are delayed", async () => {
  const f = fixture();
  let pulls = 0,
    cancelled = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        pulls++;
        f.advance(6_000, false);
        c.enqueue(new TextEncoder().encode(" "));
        if (pulls === 5) c.close();
      },
      cancel() {
        cancelled++;
      },
    },
    { highWaterMark: 0 },
  );
  f.queue.push(
    new Response(stream, {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
  );
  await assert.rejects(f.provider.createLink(f.start()), safe);
  assert.equal(pulls, 2);
  assert.equal(cancelled, 1);
  assert.equal(f.timers.size, 0);
});

test("T004-UT10: three bounded identity reads can share the thirty-second phase without a ten-second global cutoff", async () => {
  const f = fixture(),
    started = f.clock.now();
  for (const data of [f.connection(), f.auth(), f.profile()])
    f.queue.push(() => {
      f.advance(9_000, false);
      return response(data);
    });
  const result = await f.provider.readIdentity(f.identity());
  assert.equal((result as { active: boolean }).active, true);
  assert.equal(f.clock.now() - started, 27_000);
  assert.equal(f.calls.length, 3);
  assert.equal(f.timers.size, 0);
});
