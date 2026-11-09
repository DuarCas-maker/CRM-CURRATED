import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  ConnectError,
  type ConnectAttempt,
  type ConnectAuthority,
  type ConnectStoreCommand,
} from "../src/lib/composio-connect";
import { connectDigest } from "../src/lib/server/mail-accounts/composio-connect/session";
import { createConnectSecrets } from "../src/lib/server/mail-accounts/composio-connect/secrets";
import {
  createConnectStore,
  type ConnectRpcClient,
} from "../src/lib/server/mail-accounts/composio-connect/store";
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls++;
  throw Error("Network forbidden");
}) as typeof fetch;
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(fetchCalls, 0);
});
const clone = <T>(v: T): T => structuredClone(v);
const failure = (e: unknown) => {
  assert.ok(e instanceof ConnectError);
  assert.doesNotMatch(
    String(e) + JSON.stringify(e),
    /private-fixture|browser_proof|ciphertext/,
  );
  assert.equal(e.cause, undefined);
  return true;
};
function fixture() {
  const key = randomBytes(32),
    keys = { fixture: key };
  const secrets = createConnectSecrets({
    activeKeyId: "fixture",
    keys,
    randomBytes,
  });
  const proof = randomUUID(),
    state = randomUUID(),
    actor = randomUUID(),
    sid = randomUUID(),
    attempt = randomUUID(),
    clock = 1_700_000_000_000;
  const session = {
    actor_id: actor,
    session_id: sid,
    role: "superadmin",
    active: true,
    aal: "aal2",
    authorization_revision: 1,
    expires_at_ms: clock + 600000,
  };
  const authority: ConnectAuthority = {
    actor_id: actor,
    session_hash: connectDigest(sid),
    browser_hash: connectDigest(proof),
    authorization_revision: 1,
  };
  const config = {
    generation: 2,
    project_id: "pr_fixture",
    auth_config_id: "ac_fixture",
    quota_project_id: "google_fixture",
    owner_id: "fixture_owner",
    callback_mode: "standard" as const,
  };
  const descriptor = {
    enabled: true as const,
    config,
    context: {
      composio_project_id: "pr_fixture",
      credential_version: "fixture_v1",
      google_quota_project_id: "google_fixture",
      auth_config_revision: "fixture_r1",
      provenance_reference: "fixture_ref",
      project_provenance: "server_reviewed",
      quota_provenance: "oauth_client_reviewed",
    },
    callback_origin: "https://crm.example.test",
  };
  const a: ConnectAttempt = {
    id: attempt,
    revision: 0,
    state: "prepared",
    created_at_ms: clock,
    deadline_ms: clock + 600000,
    account_id: randomUUID(),
    brand_id: randomUUID(),
    expected_mailbox_email: "mailbox@example.test",
    binding: { ...authority, state_hash: connectDigest(state) },
    config,
    context_hash: connectDigest("ctx"),
    phase: null,
    connection_id: null,
    navigation: null,
    binding_id: null,
    cleanup_required: false,
  };
  let raw: unknown = {
    snapshot: { attempt: a, current_context_hash: a.context_hash },
    descriptor: clone(descriptor),
    state_ciphertext: secrets.seal(state, {
      attempt_id: attempt,
      generation: 2,
      slot: "state",
    }),
    navigation_ciphertext: null,
    navigation_expires_ms: null,
    review_id: null,
  };
  const calls: {
    name: string;
    args: Record<string, unknown>;
    client: string;
  }[] = [];
  const faults = { human: false, service: false, error: null as unknown };
  const client = (kind: string): ConnectRpcClient => ({
    async rpc(name, args) {
      calls.push({ name, args: clone(args), client: kind });
      if (faults[kind as "human" | "service"])
        throw Error("private-fixture-transport");
      if (faults.error) return { data: null, error: faults.error };
      return {
        data: name.endsWith("authorize")
          ? { id: randomUUID(), proof: randomUUID() }
          : clone(raw),
        error: null,
      };
    },
  });
  const options = {
    human: client("human"),
    service: client("service"),
    secrets,
    session: async () => clone(session),
    now: () => clock,
    uuid: randomUUID,
    proof: () => randomBytes(32).toString("base64url"),
    configuration: () => clone(descriptor),
  };
  const api = createConnectStore(options);
  const command: ConnectStoreCommand = {
    attempt_id: attempt,
    authority,
    command: "start",
    expected_revision: 0,
    idempotency_key: randomUUID(),
    fingerprint: connectDigest("request"),
    expected_context_hash: a.context_hash,
  };
  return {
    key,
    keys,
    secrets,
    options,
    api,
    calls,
    faults,
    session,
    a,
    authority,
    proof,
    state,
    command,
    descriptor,
    get raw() {
      return raw;
    },
    set raw(value: unknown) {
      raw = value;
    },
  };
}

test("T009-TEST04: AES-GCM envelopes use distinct nonces, copied keys and bind attempt/type/generation", () => {
  const f = fixture(),
    context = { attempt_id: f.a.id, generation: 2, slot: "state" as const };
  const first = f.secrets.seal(f.state, context),
    second = f.secrets.seal(f.state, context);
  assert.notEqual(first, second);
  assert.equal(f.secrets.open(first, context), f.state);
  f.key.fill(0);
  assert.equal(f.secrets.open(first, context), f.state);
  for (const change of [
    { attempt_id: randomUUID() },
    { generation: 3 },
    { slot: "navigation" as const },
  ])
    assert.throws(
      () => f.secrets.open(first, { ...context, ...change }),
      failure,
    );
  const pieces = first.split(".");
  pieces[3] = Buffer.alloc(16).toString("base64url");
  assert.throws(() => f.secrets.open(pieces.join("."), context), failure);
  assert.doesNotMatch(first, new RegExp(f.state));
  assert.throws(() => f.secrets.open("private-fixture", context), failure);
});
test("T009-TEST04: retained key ID reads old data; missing key, invalid sizes, RNG and oversized envelopes fail closed", () => {
  const old = randomBytes(32),
    current = randomBytes(32),
    ctx = { attempt_id: randomUUID(), generation: 1, slot: "state" as const };
  const one = createConnectSecrets({
      activeKeyId: "old",
      keys: { old },
      randomBytes,
    }),
    data = one.seal("fixture-state", ctx);
  const two = createConnectSecrets({
    activeKeyId: "new",
    keys: { old, new: current },
    randomBytes,
  });
  assert.equal(two.open(data, ctx), "fixture-state");
  assert.match(two.seal("fixture-state", ctx), /^1\.new\./);
  assert.throws(
    () =>
      createConnectSecrets({
        activeKeyId: "new",
        keys: { new: current },
        randomBytes,
      }).open(data, ctx),
    failure,
  );
  assert.throws(
    () =>
      createConnectSecrets({
        activeKeyId: "bad",
        keys: { bad: new Uint8Array(31) },
        randomBytes,
      }),
    failure,
  );
  assert.throws(
    () =>
      createConnectSecrets({
        activeKeyId: "old",
        keys: { old },
        randomBytes: () => new Uint8Array(1),
      }).seal("fixture", ctx),
    failure,
  );
  assert.throws(() => one.seal("x".repeat(8193), ctx), failure);
  assert.throws(() => one.open("x".repeat(12001), ctx), failure);
});
test("T009-TEST02: adapter obtains a human ticket then forwards the identical payload through service only", async () => {
  const f = fixture(),
    loaded = await f.api.store.load({
      attempt_id: f.a.id,
      authority: f.authority,
    });
  assert.deepEqual(loaded, (f.raw as { snapshot: unknown }).snapshot);
  assert.deepEqual(
    f.calls.map((c) => [c.client, c.name]),
    [
      ["human", "composio_connect_runtime_authorize"],
      ["service", "composio_connect_runtime_execute"],
    ],
  );
  assert.deepEqual(f.calls[0].args.p, f.calls[1].args.p);
  assert.ok(f.calls[1].args.ticket);
  assert.equal(fetchCalls, 0);
});
test("T009-TEST02: missing ticket or human failure never invokes service; provider errors are sanitized", async () => {
  const f = fixture();
  f.faults.human = true;
  await assert.rejects(
    f.api.store.load({ attempt_id: f.a.id, authority: f.authority }),
    failure,
  );
  assert.equal(f.calls.length, 1);
  const g = fixture();
  g.options.human.rpc = async () => ({
    data: { id: randomUUID() },
    error: null,
  });
  await assert.rejects(g.api.store.lookupReceipt(g.command), failure);
  assert.equal(g.calls.length, 0);
  const h = fixture();
  h.faults.error = {
    message: "private-fixture-database",
    details: "private-fixture",
  };
  await assert.rejects(
    h.api.store.load({ attempt_id: h.a.id, authority: h.authority }),
    failure,
  );
  const i = fixture();
  i.faults.error = { message: "CONNECT_STALE", details: "private-fixture" };
  await assert.rejects(
    i.api.store.load({ attempt_id: i.a.id, authority: i.authority }),
    (e: unknown) => {
      assert.ok(e instanceof ConnectError);
      assert.equal(e.code, "CONNECT_STALE");
      return failure(e);
    },
  );
});
test("T009-TEST03: descriptor generation/revisions mismatch is rejected without pretending a verified context", async () => {
  const f = fixture();
  f.descriptor.context.credential_version = "other_version";
  await assert.rejects(
    f.api.bindConfiguration({ attempt_id: f.a.id, authority: f.authority }),
    failure,
  );
  const g = fixture();
  g.raw = {
    ...(g.raw as object),
    snapshot: {
      attempt: { ...g.a, id: "invalid" },
      current_context_hash: g.a.context_hash,
    },
  };
  await assert.rejects(
    g.api.store.load({ attempt_id: g.a.id, authority: g.authority }),
    failure,
  );
});
test("T009-TEST04: encrypted navigation is decrypted only after authorized snapshot and validates URL/state consistency", async () => {
  const f = fixture(),
    url = "https://connect.composio.dev/link/ln_fixture";
  f.raw = {
    ...(f.raw as object),
    snapshot: {
      attempt: {
        ...f.a,
        state: "awaiting_consent",
        connection_id: "ca_fixture",
      },
      current_context_hash: f.a.context_hash,
    },
    navigation_ciphertext: f.secrets.seal(url, {
      attempt_id: f.a.id,
      generation: 2,
      slot: "navigation",
    }),
    navigation_expires_ms: f.a.deadline_ms,
  };
  assert.equal(
    (
      (await f.api.store.load({
        attempt_id: f.a.id,
        authority: f.authority,
      })) as { attempt: { navigation: { url: string } } }
    ).attempt.navigation.url,
    url,
  );
  const raw = f.raw as { navigation_ciphertext: string };
  raw.navigation_ciphertext = f.secrets.seal("https://evil.example.test", {
    attempt_id: f.a.id,
    generation: 2,
    slot: "navigation",
  });
  await assert.rejects(
    f.api.store.load({ attempt_id: f.a.id, authority: f.authority }),
    failure,
  );
});
test("T009-TEST06: claim replay returns no new capability; malformed winner/foreign state never escapes", async () => {
  const f = fixture();
  f.raw = { kind: "replay" };
  assert.deepEqual(
    await f.api.store.claimPhase({ ...f.command, phase: "link" }),
    { kind: "replay" },
  );
  assert.equal(f.calls.length, 2);
  const g = fixture();
  g.raw = {
    kind: "claimed",
    view: g.raw,
    lease: {
      id: randomUUID(),
      kind: "link",
      revision: 1,
      fingerprint: g.command.fingerprint,
    },
  };
  await assert.rejects(
    g.api.store.claimPhase({ ...g.command, phase: "link" }),
    failure,
  );
});
test("T009-TEST07: negative ledger only uses service with lease and cannot acquire a human positive ticket", async () => {
  const f = fixture(),
    lease = {
      id: randomUUID(),
      kind: "link" as const,
      revision: 1,
      fingerprint: f.command.fingerprint,
      capability: randomUUID(),
      callback_state: f.state,
    };
  f.raw = null;
  await f.api.store.markUncertain({
    attempt_id: f.a.id,
    lease,
    reason: "provider_unknown",
  });
  assert.deepEqual(
    f.calls.map((c) => [c.client, c.name]),
    [["service", "composio_connect_runtime_ledger"]],
  );
  assert.equal(f.calls[0].args.operation, "uncertain");
  assert.doesNotMatch(JSON.stringify(f.calls[0].args), new RegExp(f.state));
});
test("T009-TEST08: intent validation does not materialize provider identity or send state in plaintext to RPC", async () => {
  const f = fixture(),
    input = {
      attempt_id: f.a.id,
      idempotency_key: randomUUID(),
      browser_proof: f.proof,
      callback_state: f.state,
      mode: "new",
      email: "mailbox@example.test",
      organization: "fixture",
      brand_id: f.a.brand_id,
      expected_brand_revision: 1,
      expected_account_revision: 0,
      expected_head_revision: 0,
      expected_config_generation: 2,
    };
  await f.api.beginIntent(input);
  assert.equal(f.calls.length, 2);
  const payload = JSON.stringify(f.calls[0].args);
  assert.doesNotMatch(payload, new RegExp(f.proof));
  assert.doesNotMatch(payload, new RegExp(f.state));
  const g = fixture();
  await assert.rejects(
    g.api.beginIntent({ ...input, email: "Mailbox@example.test" }),
    failure,
  );
  assert.equal(g.calls.length, 0);
});
test("T009-TEST12: factory requires explicit clients, secrets and context and makes no eager calls", () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  assert.equal(fetchCalls, 0);
  assert.throws(
    () => createConnectStore({ ...f.options, human: {} as ConnectRpcClient }),
    failure,
  );
});

test("T009-TEST04: forged dependency error codes cannot expose private data through auxiliary methods", async () => {
  const f = fixture(),
    error = new ConnectError("CONNECT_UNAVAILABLE");
  Object.defineProperty(error, "code", { value: "private-fixture-code" });
  f.options.session = async () => {
    throw error;
  };
  await assert.rejects(
    f.api.beginIntent({
      attempt_id: f.a.id,
      idempotency_key: randomUUID(),
      browser_proof: f.proof,
      callback_state: f.state,
      mode: "new",
      email: "mailbox@example.test",
      organization: "fixture",
      brand_id: f.a.brand_id,
      expected_brand_revision: 1,
      expected_account_revision: 0,
      expected_head_revision: 0,
      expected_config_generation: 2,
    }),
    failure,
  );
  const g = fixture();
  g.options.configuration = () => {
    throw error;
  };
  await assert.rejects(
    g.api.bindConfiguration({ attempt_id: g.a.id, authority: g.authority }),
    failure,
  );
});

test("T009-TEST09: registration requires a service-issued grant before calling the human C1 facade", async () => {
  const f = fixture(),
    events: string[] = [];
  f.options.human.rpc = async (name) => {
    events.push(name);
    return {
      data: name.endsWith("authorize")
        ? { id: randomUUID(), proof: randomUUID() }
        : f.raw,
      error: null,
    };
  };
  f.options.service.rpc = async (name) => {
    events.push(name);
    return { data: { id: randomUUID(), proof: randomUUID() }, error: null };
  };
  const lease = {
    id: randomUUID(),
    kind: "registration" as const,
    revision: 1,
    fingerprint: f.command.fingerprint,
    capability: randomUUID(),
    callback_state: null,
  };
  await f.api.store.registerCandidate({
    command: { ...f.command, command: "register" },
    lease,
  });
  assert.deepEqual(events, [
    "composio_connect_runtime_authorize",
    "composio_connect_runtime_execute",
    "composio_connect_runtime_register",
  ]);
});
