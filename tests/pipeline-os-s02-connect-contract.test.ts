import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ConnectError,
  connectSnapshotSchema,
  type ConnectAttempt,
  type ConnectAuthority,
  type ConnectDependencies,
  type ConnectLease,
  type ConnectStore,
  type ConnectStoreCommand,
} from "../src/lib/composio-connect";
import {
  assertConnectBinding,
  connectDigest,
  currentConnectSession,
} from "../src/lib/server/mail-accounts/composio-connect/session";
import {
  ConnectNotEmitted,
  createComposioConnectOrchestrator,
} from "../src/lib/server/mail-accounts/composio-connect/orchestrator";

const originalFetch = globalThis.fetch;
let realFetchCalls = 0;
globalThis.fetch = (async () => {
  realFetchCalls++;
  throw new Error("Real fetch forbidden in T-003");
}) as typeof fetch;
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(realFetchCalls, 0);
});
const clone = <T>(value: T): T => structuredClone(value);
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail("Expected injected phase was not reached");
}
const code =
  (expected: string, extra?: (error: ConnectError) => void) =>
  (error: unknown) => {
    assert.ok(error instanceof ConnectError);
    assert.equal(error.code, expected);
    extra?.(error);
    return true;
  };

function fixture() {
  let time = 1_000_000,
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
  function advance(ms: number, fire = true) {
    time += ms;
    if (fire)
      for (const [id, timer] of [...timers])
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
  }
  const proof = randomUUID(),
    state = randomUUID();
  const session = {
    actor_id: randomUUID(),
    session_id: randomUUID(),
    role: "superadmin",
    active: true,
    aal: "aal2",
    authorization_revision: 1,
    expires_at_ms: time + 3_600_000,
  };
  let attempt: ConnectAttempt = {
    id: randomUUID(),
    revision: 0,
    state: "prepared",
    created_at_ms: time,
    deadline_ms: time + 600_000,
    account_id: randomUUID(),
    brand_id: randomUUID(),
    expected_mailbox_email: "mailbox@example.test",
    binding: {
      actor_id: session.actor_id,
      session_hash: connectDigest(session.session_id),
      authorization_revision: 1,
      browser_hash: connectDigest(proof),
      state_hash: connectDigest(state),
    },
    config: {
      generation: 1,
      project_id: "pr_fixture",
      auth_config_id: "ac_fixture",
      quota_project_id: "google_fixture",
      owner_id: "fixture_owner",
      callback_mode: "standard",
    },
    context_hash: connectDigest("context-initial"),
    phase: null,
    connection_id: null,
    navigation: null,
    binding_id: null,
    cleanup_required: false,
  };
  let currentContext = attempt.context_hash;
  const receipts = new Map<string, { fingerprint: string; command: string }>();
  const knownLeases = new Map<string, ConnectLease>();
  const counts = {
    load: 0,
    receipt: 0,
    claim: 0,
    create: 0,
    read: 0,
    save: 0,
    finish: 0,
    register: 0,
    cancel: 0,
    uncertain: 0,
    residual: 0,
    release: 0,
  };
  const faults = {
    load: false,
    claim: false,
    save: "" as "" | "before" | "after",
    uncertain: false,
    registerAfter: false,
    badClaim: false,
  };
  const hooks: {
    afterClaim?: () => void;
    beforeSave?: () => void;
    onReceipt?: () => void;
  } = {};
  const snapshot = () =>
    clone({ attempt, current_context_hash: currentContext });
  function guard(authority: ConnectAuthority) {
    const s = currentConnectSession(session, time);
    assertConnectBinding(s, attempt.binding, proof);
    assert.equal(authority.actor_id, s.actor_id);
    if (
      authority.session_hash !== connectDigest(s.session_id) ||
      authority.browser_hash !== attempt.binding.browser_hash
    )
      throw new ConnectError("CONNECT_FORBIDDEN");
    if (
      authority.authorization_revision !== session.authorization_revision ||
      currentContext !== attempt.context_hash
    )
      throw new ConnectError("CONNECT_STALE");
    if (time >= attempt.deadline_ms) throw new ConnectError("CONNECT_CLOSED");
  }
  function receipt(c: ConnectStoreCommand) {
    guard(c.authority);
    const r = receipts.get(c.idempotency_key);
    return {
      kind: !r
        ? "absent"
        : r.fingerprint === c.fingerprint && r.command === c.command
          ? "replay"
          : "conflict",
    } as const;
  }
  function guardCommand(c: ConnectStoreCommand) {
    guard(c.authority);
    if (
      c.attempt_id !== attempt.id ||
      c.expected_context_hash !== currentContext
    )
      throw new ConnectError("CONNECT_STALE");
  }
  function capability(lease: ConnectLease) {
    const known = knownLeases.get(lease.id);
    if (
      !known ||
      known.capability !== lease.capability ||
      known.fingerprint !== lease.fingerprint
    )
      throw new ConnectError("CONNECT_FORBIDDEN");
  }
  function leased(c: ConnectStoreCommand, lease: ConnectLease) {
    guardCommand(c);
    capability(lease);
    if (attempt.phase?.id !== lease.id || attempt.revision !== lease.revision)
      throw new ConnectError("CONNECT_STALE");
  }
  function remember(c: ConnectStoreCommand) {
    receipts.set(c.idempotency_key, {
      fingerprint: c.fingerprint,
      command: c.command,
    });
  }
  const store: ConnectStore = {
    async load() {
      counts.load++;
      if (faults.load) throw new Error("private-store-details");
      return snapshot();
    },
    async lookupReceipt(c) {
      counts.receipt++;
      const result = receipt(c);
      hooks.onReceipt?.();
      return result;
    },
    async claimPhase(c) {
      counts.claim++;
      if (faults.claim) throw new Error("private-claim-details");
      guardCommand(c);
      const prior = receipt(c);
      if (prior.kind !== "absent") return prior;
      const valid =
        c.phase === "link"
          ? attempt.state === "prepared"
          : c.phase === "identity"
            ? attempt.state === "awaiting_consent"
            : attempt.state === "ready_to_register";
      if (!valid || attempt.phase || c.expected_revision !== attempt.revision)
        return { kind: "conflict" };
      const lease: ConnectLease = {
        id: randomUUID(),
        kind: c.phase,
        fingerprint: c.fingerprint,
        revision: attempt.revision + 1,
        capability: randomUUID(),
        callback_state: c.phase === "link" ? state : null,
      };
      knownLeases.set(lease.id, clone(lease));
      attempt.phase = {
        id: lease.id,
        kind: lease.kind,
        fingerprint: lease.fingerprint,
      };
      attempt.revision = lease.revision;
      if (c.phase === "link") attempt.state = "link_pending";
      if (c.phase === "identity") attempt.state = "identity_checking";
      remember(c);
      hooks.afterClaim?.();
      return {
        kind: "claimed",
        snapshot: snapshot(),
        lease: faults.badClaim
          ? { ...lease, callback_state: randomUUID() }
          : clone(lease),
      };
    },
    async saveLink({ command: c, lease, link, deadline_ms }) {
      counts.save++;
      hooks.beforeSave?.();
      leased(c, lease);
      if (faults.save === "before") throw new Error("private-save-before");
      attempt.connection_id = link.connected_account_id;
      attempt.navigation = { url: link.url, expires_at_ms: link.expires_at_ms };
      attempt.deadline_ms = deadline_ms;
      attempt.state = "awaiting_consent";
      attempt.phase = null;
      attempt.revision++;
      if (faults.save === "after") throw new Error("private-save-after");
      return snapshot();
    },
    async finishIdentity({ command: c, lease }) {
      counts.finish++;
      leased(c, lease);
      attempt.state = "awaiting_brand";
      attempt.phase = null;
      attempt.navigation = null;
      attempt.revision++;
      return snapshot();
    },
    async releaseClaim({ command: c, lease }) {
      counts.release++;
      capability(lease);
      if (attempt.phase?.id !== lease.id) return;
      attempt.phase = null;
      attempt.state =
        lease.kind === "link"
          ? "prepared"
          : lease.kind === "identity"
            ? "awaiting_consent"
            : "ready_to_register";
      attempt.revision++;
      receipts.delete(c.idempotency_key);
    },
    async reject({ command: c, lease }) {
      if (lease) leased(c, lease);
      else guardCommand(c);
      attempt.cleanup_required = Boolean(attempt.connection_id);
      attempt.state = "rejected";
      attempt.phase = null;
      attempt.navigation = null;
      attempt.revision++;
      remember(c);
      return snapshot();
    },
    async cancel(c) {
      counts.cancel++;
      guardCommand(c);
      const old = receipt(c);
      if (old.kind === "replay") return snapshot();
      if (old.kind === "conflict" || c.expected_revision !== attempt.revision)
        throw new ConnectError("CONNECT_CONFLICT");
      if (attempt.state === "completed")
        throw new ConnectError("CONNECT_CLOSED");
      attempt.cleanup_required = Boolean(
        attempt.phase || attempt.connection_id,
      );
      attempt.state = "cancelled";
      attempt.phase = null;
      attempt.navigation = null;
      attempt.revision++;
      remember(c);
      return snapshot();
    },
    async registerCandidate({ command: c, lease }) {
      leased(c, lease);
      counts.register++;
      attempt.binding_id = randomUUID();
      attempt.state = "completed";
      attempt.phase = null;
      attempt.navigation = null;
      attempt.revision++;
      if (faults.registerAfter) throw new Error("private-register-after");
      return snapshot();
    },
    async markUncertain({ lease }) {
      counts.uncertain++;
      if (faults.uncertain) throw new Error("private-ledger-failure");
      capability(lease);
      attempt.cleanup_required = true;
      if (
        !["completed", "cancelled", "expired", "rejected"].includes(
          attempt.state,
        )
      ) {
        attempt.state = "uncertain";
        attempt.phase = null;
        attempt.navigation = null;
        attempt.revision++;
      }
    },
    async recordResidual({ lease }) {
      counts.residual++;
      capability(lease);
      attempt.cleanup_required = true;
    },
  };
  let linkResult: unknown = {
    url: "https://connect.composio.dev/link/ln_offline_fixture",
    expires_at_ms: time + 900_000,
    connected_account_id: "ca_fixture",
  };
  let identityResult: unknown = {
    connected_account_id: "ca_fixture",
    project_id: "pr_fixture",
    auth_config_id: "ac_fixture",
    owner_id: "fixture_owner",
    primary_email: "MAILBOX@example.test",
    toolkit: "gmail",
    active: true,
  };
  const behavior: {
    create?: (
      input: Parameters<ConnectDependencies["provider"]["createLink"]>[0],
    ) => Promise<unknown>;
    read?: (
      input: Parameters<ConnectDependencies["provider"]["readIdentity"]>[0],
    ) => Promise<unknown>;
  } = {};
  const deps: ConnectDependencies = {
    session: {
      async readCurrent() {
        return clone(session);
      },
    },
    store,
    clock,
    callbackOrigin: "https://crm.example.test",
    provider: {
      async createLink(input) {
        counts.create++;
        assert.ok(input.signal instanceof AbortSignal);
        assert.equal(
          new URL(input.callback_url).searchParams.get("state"),
          state,
        );
        return behavior.create ? behavior.create(input) : clone(linkResult);
      },
      async readIdentity(input) {
        counts.read++;
        assert.equal(input.connected_account_id, attempt.connection_id);
        return behavior.read ? behavior.read(input) : clone(identityResult);
      },
    },
  };
  const engine = createComposioConnectOrchestrator(deps);
  const input = () => ({
    attempt_id: attempt.id,
    expected_revision: attempt.revision,
    idempotency_key: randomUUID(),
    browser_proof: proof,
  });
  const callback = () => ({
    ...input(),
    state,
    status: "success" as const,
    connected_account_id: attempt.connection_id!,
  });
  const resume = () => ({ attempt_id: attempt.id, browser_proof: proof });
  function reviewBrand() {
    assert.equal(attempt.state, "awaiting_brand");
    attempt.state = "ready_to_register";
    attempt.revision++;
  }
  connectSnapshotSchema.parse(snapshot());
  return {
    deps,
    engine,
    session,
    counts,
    faults,
    hooks,
    behavior,
    clock,
    advance,
    timers,
    input,
    callback,
    resume,
    snapshot,
    reviewBrand,
    get attempt() {
      return attempt;
    },
    get linkResult() {
      return linkResult;
    },
    set linkResult(v: unknown) {
      linkResult = v;
    },
    get identityResult() {
      return identityResult;
    },
    set identityResult(v: unknown) {
      identityResult = v;
    },
    drift() {
      currentContext = connectDigest("context-changed");
    },
    malformedSnapshot() {
      attempt = { ...attempt, deadline_ms: attempt.created_at_ms + 600_001 };
    },
  };
}

test("T003-UT01: role/AAL/active/session guards reject before effects and protect replay", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.session.role = "seller";
    },
    (f: ReturnType<typeof fixture>) => {
      f.session.aal = "aal1";
    },
    (f: ReturnType<typeof fixture>) => {
      f.session.active = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.session.expires_at_ms = f.clock.now();
    },
    (f: ReturnType<typeof fixture>) => {
      f.session.session_id = randomUUID();
    },
    (f: ReturnType<typeof fixture>) => {
      f.session.actor_id = randomUUID();
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.engine.start(f.input()), code("CONNECT_FORBIDDEN"));
    assert.equal(f.counts.create, 0);
    assert.equal(f.counts.claim, 0);
  }
  const f = fixture(),
    request = f.input();
  await f.engine.start(request);
  f.session.session_id = randomUUID();
  await assert.rejects(f.engine.start(request), code("CONNECT_FORBIDDEN"));
  assert.equal(f.counts.create, 1);
});

test("T003-UT01: authorization revision and browser proof cannot be silently replaced", async () => {
  const f = fixture();
  f.session.authorization_revision++;
  await assert.rejects(f.engine.start(f.input()), code("CONNECT_STALE"));
  assert.equal(f.counts.claim, 0);
  const g = fixture();
  await assert.rejects(
    g.engine.start({ ...g.input(), browser_proof: randomUUID() }),
    code("CONNECT_FORBIDDEN"),
  );
  assert.equal(g.counts.create, 0);
});

test("T003-UT02: concurrent starts/callbacks share a durable claim and one provider effect", async () => {
  const f = fixture(),
    gate = deferred<unknown>(),
    input = f.input();
  f.behavior.create = () => gate.promise;
  const first = f.engine.start(input);
  await until(() => f.counts.create === 1);
  const second = await f.engine.start(input);
  assert.equal(second.state, "link_pending");
  await assert.rejects(
    f.engine.start({ ...input, idempotency_key: randomUUID() }),
    code("CONNECT_CONFLICT"),
  );
  gate.resolve(f.linkResult);
  assert.equal((await first).state, "awaiting_consent");
  assert.equal(f.counts.create, 1);
  const identityGate = deferred<unknown>();
  f.behavior.read = () => identityGate.promise;
  const cb = f.callback(),
    reading = f.engine.callback(cb);
  await until(() => f.counts.read === 1);
  assert.equal((await f.engine.callback(cb)).state, "identity_checking");
  identityGate.resolve(f.identityResult);
  assert.equal((await reading).state, "awaiting_brand");
  assert.equal(f.counts.read, 1);
});

test("T003-UT03: load/claim unavailable never emits and pending persistence is not a success", async () => {
  const f = fixture();
  f.faults.claim = true;
  await assert.rejects(
    f.engine.start(f.input()),
    code("CONNECT_UNAVAILABLE", (e) => assert.equal(e.beforeEmission, true)),
  );
  assert.equal(f.counts.create, 0);
  assert.equal(f.counts.uncertain, 0);
  const g = fixture();
  g.faults.load = true;
  await assert.rejects(g.engine.start(g.input()), code("CONNECT_UNAVAILABLE"));
  assert.equal(g.counts.claim, 0);
  const h = fixture();
  h.faults.badClaim = true;
  await assert.rejects(h.engine.start(h.input()), code("CONNECT_UNAVAILABLE"));
  assert.equal(h.counts.create, 0);
});

test("T003-UT03: a proven non-emission releases the claim; only a new explicit call can issue", async () => {
  const f = fixture();
  f.behavior.create = async () => {
    throw new ConnectNotEmitted();
  };
  await assert.rejects(
    f.engine.start(f.input()),
    code("CONNECT_UNAVAILABLE", (e) => assert.equal(e.beforeEmission, true)),
  );
  assert.equal(f.attempt.state, "prepared");
  assert.equal(f.counts.uncertain, 0);
  assert.equal(f.counts.create, 1);
  f.behavior.create = undefined;
  await f.engine.start(f.input());
  assert.equal(f.counts.create, 2);
  assert.equal(f.attempt.state, "awaiting_consent");
});

test("T003-UT04: creation timeout aborts and persists uncertainty, never retries", async () => {
  const f = fixture(),
    gate = deferred<unknown>();
  let signal: AbortSignal | undefined;
  f.behavior.create = async (input) => {
    signal = input.signal;
    return gate.promise;
  };
  const pending = f.engine.start(f.input());
  const rejection = assert.rejects(
    pending,
    code("CONNECT_NEEDS_RECONCILIATION", (e) =>
      assert.equal(e.ledgerRecorded, true),
    ),
  );
  await until(() => f.counts.create === 1);
  f.advance(10_000);
  await rejection;
  assert.equal(signal?.aborted, true);
  assert.equal(f.attempt.state, "uncertain");
  assert.equal(f.counts.create, 1);
  assert.equal(f.timers.size, 0);
  await assert.rejects(
    f.engine.start(f.input()),
    code("CONNECT_NEEDS_RECONCILIATION"),
  );
  assert.equal(f.counts.create, 1);
  gate.resolve(f.linkResult);
  await Promise.resolve();
  assert.equal(f.attempt.state, "uncertain");
});

test("T003-UT04: elapsed deadline is enforced even if a scheduler callback is delayed", async () => {
  const f = fixture();
  f.behavior.create = async () => {
    f.advance(10_000, false);
    return f.linkResult;
  };
  await assert.rejects(
    f.engine.start(f.input()),
    code("CONNECT_NEEDS_RECONCILIATION"),
  );
  assert.equal(f.counts.create, 1);
  assert.equal(f.timers.size, 0);
});

test("T003-UT04: failed uncertainty ledger is surfaced without exposing provider details", async () => {
  const f = fixture();
  f.faults.uncertain = true;
  f.behavior.create = async () => {
    throw new Error("private-provider-details");
  };
  await assert.rejects(
    f.engine.start(f.input()),
    code("CONNECT_NEEDS_RECONCILIATION", (e) => {
      assert.equal(e.ledgerRecorded, false);
      assert.doesNotMatch(String(e) + JSON.stringify(e), /private-provider/);
      assert.equal(e.cause, undefined);
    }),
  );
  assert.equal(f.counts.create, 1);
});

test("T003-UT05: save-before-commit loss requires reconciliation; save-after-commit loss recovers durable result", async () => {
  const before = fixture();
  before.faults.save = "before";
  await assert.rejects(
    before.engine.start(before.input()),
    code("CONNECT_NEEDS_RECONCILIATION"),
  );
  assert.equal(before.attempt.navigation, null);
  assert.equal(before.counts.create, 1);
  const after = fixture();
  after.faults.save = "after";
  const request = after.input();
  assert.equal((await after.engine.start(request)).state, "awaiting_consent");
  assert.equal(after.counts.create, 1);
  assert.equal(after.counts.uncertain, 0);
  assert.equal((await after.engine.start(request)).state, "awaiting_consent");
  assert.equal(after.counts.create, 1);
});

test("T003-UT06: resume uses saved link, clamps expiry and never extends original deadline", async () => {
  const f = fixture(),
    original = f.attempt.deadline_ms;
  f.linkResult = {
    ...(f.linkResult as object),
    expires_at_ms: f.clock.now() + 60_000,
  };
  const result = await f.engine.start(f.input());
  assert.equal(result.deadline_ms, original - 540_000);
  assert.equal("url" in result, false);
  const first = await f.engine.resume(f.resume());
  assert.equal(first.kind, "server_navigation");
  f.advance(59_999);
  const second = await f.engine.resume(f.resume());
  assert.equal(second.url, first.url);
  assert.equal(f.counts.create, 1);
  f.advance(1);
  await assert.rejects(f.engine.resume(f.resume()), code("CONNECT_CLOSED"));
  assert.equal(f.counts.create, 1);
});

test("T003-UT06: completing registration purges navigation and a prior resume cannot reopen OAuth", async () => {
  const f = fixture();
  await f.engine.start(f.input());
  await f.engine.callback(f.callback());
  f.reviewBrand();
  await f.engine.register(f.input());
  await assert.rejects(f.engine.resume(f.resume()), code("CONNECT_NOT_READY"));
  assert.equal(f.attempt.navigation, null);
  assert.equal(f.counts.create, 1);
});

test("T003-UT07: invalid callback/foreign correlation or connection never calls identity provider", async () => {
  const f = fixture();
  await f.engine.start(f.input());
  await assert.rejects(
    f.engine.callback({ ...f.callback(), unexpected: true }),
    code("CONNECT_INVALID_INPUT"),
  );
  await assert.rejects(
    f.engine.callback({ ...f.callback(), state: randomUUID() }),
    code("CONNECT_FORBIDDEN"),
  );
  await assert.rejects(
    f.engine.callback({ ...f.callback(), connected_account_id: "ca_foreign" }),
    code("CONNECT_IDENTITY_MISMATCH"),
  );
  assert.equal(f.counts.read, 0);
  assert.equal(f.attempt.state, "awaiting_consent");
});

test("T003-UT07: actual primary identity/tuple mismatches reject without creating a candidate", async () => {
  for (const change of [
    { primary_email: "wrong@example.test" },
    { owner_id: "wrong_owner" },
    { project_id: "pr_other" },
    { auth_config_id: "ac_other" },
    { active: false },
    { toolkit: "github" },
  ]) {
    const f = fixture();
    await f.engine.start(f.input());
    f.identityResult = { ...(f.identityResult as object), ...change };
    await assert.rejects(
      f.engine.callback(f.callback()),
      code("CONNECT_IDENTITY_MISMATCH"),
    );
    assert.equal(f.attempt.state, "rejected");
    assert.equal(f.counts.finish, 0);
    assert.equal(f.counts.register, 0);
    assert.equal(f.attempt.cleanup_required, true);
  }
});

test("T003-UT07: failed consent rejects locally without a profile read or revoke operation", async () => {
  const f = fixture();
  await f.engine.start(f.input());
  const result = await f.engine.callback({
    ...f.callback(),
    status: "failed",
    connected_account_id: undefined,
  });
  assert.equal(result.state, "rejected");
  assert.equal(f.counts.read, 0);
  assert.equal(f.counts.register, 0);
});

test("T003-UT08: cancellation wins over a late creation result and records residual only", async () => {
  const f = fixture(),
    gate = deferred<unknown>();
  f.behavior.create = () => gate.promise;
  const start = f.engine.start(f.input());
  const rejection = assert.rejects(start, code("CONNECT_NEEDS_RECONCILIATION"));
  await until(() => f.counts.create === 1);
  const cancel = f.input();
  assert.equal((await f.engine.cancel(cancel)).state, "cancelled");
  gate.resolve(f.linkResult);
  await rejection;
  assert.equal(f.attempt.state, "cancelled");
  assert.equal(f.attempt.navigation, null);
  assert.equal(f.counts.register, 0);
  assert.equal((await f.engine.cancel(cancel)).state, "cancelled");
  assert.equal(f.counts.cancel, 1);
});

test("T003-UT08: cancellation wins over a late identity result without resetting terminal state", async () => {
  const f = fixture();
  await f.engine.start(f.input());
  const gate = deferred<unknown>();
  f.behavior.read = () => gate.promise;
  const reading = f.engine.callback(f.callback());
  const rejection = assert.rejects(reading, code("CONNECT_CLOSED"));
  await until(() => f.counts.read === 1);
  await f.engine.cancel(f.input());
  gate.resolve(f.identityResult);
  await rejection;
  assert.equal(f.attempt.state, "cancelled");
  assert.equal(f.counts.finish, 0);
  assert.ok(f.counts.residual > 0);
});

test("T003-UT09: changed context blocks before emission and after a claim", async () => {
  const f = fixture();
  f.drift();
  await assert.rejects(f.engine.start(f.input()), code("CONNECT_STALE"));
  assert.equal(f.counts.create, 0);
  const g = fixture();
  g.hooks.afterClaim = () => g.drift();
  await assert.rejects(g.engine.start(g.input()), code("CONNECT_STALE"));
  assert.equal(g.counts.create, 0);
  assert.equal(g.counts.release, 1);
});

test("T003-UT09: session/config changes during provider work cannot finish a positive operation", async () => {
  const f = fixture();
  f.behavior.create = async () => {
    f.session.active = false;
    return f.linkResult;
  };
  await assert.rejects(
    f.engine.start(f.input()),
    code("CONNECT_NEEDS_RECONCILIATION"),
  );
  assert.equal(f.counts.save, 0);
  assert.equal(f.attempt.state, "uncertain");
  const g = fixture();
  await g.engine.start(g.input());
  g.behavior.read = async () => {
    g.drift();
    return g.identityResult;
  };
  await assert.rejects(g.engine.callback(g.callback()), code("CONNECT_STALE"));
  assert.equal(g.counts.finish, 0);
  assert.ok(g.counts.residual > 0);
});

test("T003-UT10: exact receipt replays without effects; different fingerprint conflicts", async () => {
  const f = fixture(),
    input = f.input();
  await f.engine.start(input);
  await f.engine.start(input);
  assert.equal(f.counts.create, 1);
  await assert.rejects(
    f.engine.start({
      ...input,
      expected_revision: input.expected_revision + 1,
    }),
    code("CONNECT_CONFLICT"),
  );
  f.hooks.onReceipt = () => {
    f.session.active = false;
  };
  await assert.rejects(f.engine.start(input), code("CONNECT_FORBIDDEN"));
  assert.equal(f.counts.create, 1);
});

test("T003-UT11: successful lifecycle yields one candidate and no transport/evidence grant", async () => {
  const f = fixture();
  const account = f.attempt.account_id;
  await f.engine.start(f.input());
  const cb = f.callback();
  const observed = await f.engine.callback(cb);
  assert.equal(observed.state, "awaiting_brand");
  await f.engine.callback(cb);
  assert.equal(f.counts.read, 1);
  await assert.rejects(f.engine.register(f.input()), code("CONNECT_NOT_READY"));
  f.reviewBrand();
  const input = f.input();
  const registered = await f.engine.register(input);
  assert.equal(registered.state, "completed");
  assert.equal(registered.account_id, account);
  assert.equal(registered.composio_enabled, false);
  assert.equal(registered.next, "none");
  assert.ok(registered.binding_id);
  assert.equal(
    (await f.engine.register(input)).binding_id,
    registered.binding_id,
  );
  assert.equal(f.counts.register, 1);
  assert.doesNotMatch(
    JSON.stringify(registered),
    /can_send|verified|access_token|refresh_token|owner_id|ca_fixture|\/link\//,
  );
});

test("T003-UT11: committed registration with lost acknowledgement is recovered through receipt only", async () => {
  const f = fixture();
  await f.engine.start(f.input());
  await f.engine.callback(f.callback());
  f.reviewBrand();
  const input = f.input();
  f.faults.registerAfter = true;
  await assert.rejects(f.engine.register(input), code("CONNECT_UNAVAILABLE"));
  const recovered = await f.engine.register(input);
  assert.equal(recovered.state, "completed");
  assert.equal(f.counts.register, 1);
  assert.equal(f.counts.create, 1);
});

test("T003-UT12: malformed dependencies/snapshots and hostile redirects fail closed", async () => {
  const f = fixture();
  assert.throws(
    () =>
      createComposioConnectOrchestrator({
        ...f.deps,
        store: {} as ConnectStore,
      }),
    code("CONNECT_UNAVAILABLE"),
  );
  assert.throws(
    () =>
      createComposioConnectOrchestrator({
        ...f.deps,
        callbackOrigin: "https://crm.example.test/?returnTo=evil",
      }),
    code("CONNECT_UNAVAILABLE"),
  );
  f.malformedSnapshot();
  await assert.rejects(f.engine.start(f.input()), code("CONNECT_UNAVAILABLE"));
  assert.equal(f.counts.create, 0);
  for (const url of [
    "http://connect.composio.dev/link/fixture",
    "https://evil.example.test/link/fixture",
    "https://user:password@connect.composio.dev/link/fixture",
    "https://connect.composio.dev/link/fixture?secret=private",
  ]) {
    const g = fixture();
    g.linkResult = { ...(g.linkResult as object), url };
    await assert.rejects(
      g.engine.start(g.input()),
      code("CONNECT_NEEDS_RECONCILIATION"),
    );
    assert.equal(g.counts.save, 0);
  }
});

test("T003-UT12: only explicit navigation exposes the capability URL; status/errors stay minimal", async () => {
  const f = fixture();
  const result = await f.engine.start(f.input());
  assert.doesNotMatch(
    JSON.stringify(result),
    /ln_offline|ca_fixture|fixture_owner|state_hash|browser_hash|capability/,
  );
  const navigation = await f.engine.resume(f.resume());
  assert.equal(navigation.url, (f.linkResult as { url: string }).url);
  await assert.rejects(
    f.engine.start({ ...f.input(), actor_id: randomUUID() }),
    code("CONNECT_INVALID_INPUT"),
  );
  assert.equal(realFetchCalls, 0);
});

test("T003-UT12: dependency errors cannot smuggle a reconciliation result or private details", async () => {
  const f = fixture();
  const forged = new ConnectError("CONNECT_NEEDS_RECONCILIATION");
  forged.message = "private-provider-details";
  Object.assign(forged, { private_payload: "private-provider-details" });
  f.behavior.create = async () => {
    throw forged;
  };
  await assert.rejects(
    f.engine.start(f.input()),
    code("CONNECT_NEEDS_RECONCILIATION", (e) => {
      assert.notEqual(e, forged);
      assert.equal(e.ledgerRecorded, true);
      assert.doesNotMatch(String(e) + JSON.stringify(e), /private-provider/);
    }),
  );
  assert.equal(f.counts.uncertain, 1);
  assert.equal(f.attempt.state, "uncertain");
  const g = fixture();
  g.deps.clock.now = () => {
    throw new Error("private-clock-details");
  };
  await assert.rejects(
    g.engine.start(g.input()),
    code("CONNECT_UNAVAILABLE", (e) => {
      assert.doesNotMatch(String(e) + JSON.stringify(e), /private-clock/);
    }),
  );
  assert.equal(g.counts.claim, 0);
});

test("T003-UT12: inconsistent persisted states cannot trigger a second link creation", async () => {
  for (const change of [
    { connection_id: "ca_preexisting" },
    { binding_id: randomUUID() },
    {
      navigation: {
        url: "https://connect.composio.dev/link/existing",
        expires_at_ms: 1_900_000,
      },
      connection_id: "ca_preexisting",
    },
  ]) {
    const f = fixture();
    Object.assign(f.attempt, change);
    await assert.rejects(
      f.engine.start(f.input()),
      code("CONNECT_UNAVAILABLE"),
    );
    assert.equal(f.counts.claim, 0);
    assert.equal(f.counts.create, 0);
  }
});

test("T003-UT10: omitted optional callback fields and undefined have the same receipt fingerprint", async () => {
  const f = fixture();
  await f.engine.start(f.input());
  const { connected_account_id: _connection, ...callback } = f.callback();
  const failed = { ...callback, status: "failed" };
  assert.equal((await f.engine.callback(failed)).state, "rejected");
  assert.equal(
    (await f.engine.callback({ ...failed, connected_account_id: undefined }))
      .state,
    "rejected",
  );
  assert.equal(f.counts.read, 0);
});

test("T003-UT03: timer installation failure prevents provider emission and releases the claim", async () => {
  const f = fixture();
  f.deps.clock.setTimer = () => {
    throw new Error("private-scheduler-details");
  };
  await assert.rejects(
    f.engine.start(f.input()),
    code("CONNECT_UNAVAILABLE", (e) => {
      assert.equal(e.beforeEmission, true);
      assert.doesNotMatch(String(e) + JSON.stringify(e), /private-scheduler/);
    }),
  );
  assert.equal(f.counts.create, 0);
  assert.equal(f.counts.release, 1);
  assert.equal(f.counts.uncertain, 0);
  assert.equal(f.attempt.state, "prepared");
});
