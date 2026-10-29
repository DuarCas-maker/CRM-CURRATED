import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  composioConfiguration,
  hash,
  boundedComposioJson,
} from "../scripts/pipeline-os/s00-composio-common";
import { type RunState } from "../scripts/pipeline-os/s00-composio-runner";
import { type ObservationState } from "../scripts/pipeline-os/s00-composio-observer";
import {
  runComposioReconnect,
  validateReconnect,
  reconnectReport,
  type ReconnectState,
  type ReconnectSources,
  type ReconnectStore,
  type ReconnectOptions,
  type ReconnectAction,
} from "../scripts/pipeline-os/s00-composio-reconnect";
import { reconnectFiles } from "../scripts/pipeline-os/s00-composio-reconnect-files";

import {
  base,
  secret,
  env,
  addresses,
  threads,
  json,
  sourceFixture,
  Memory,
  Clock,
  harness,
} from "./fixtures/pipeline-os-composio";

test("reconnect defaults offline without source, env, mutation, timer or writes", async () => {
  const h = harness(),
    r = await runComposioReconnect({}, undefined, h.store, "prepare", {
      clock: h.clock,
      fetchImpl: async () => {
        throw Error(secret);
      },
    });
  assert.equal(r.phase, "not_started");
  assert.equal(r.totalCalls, 60);
  assert.equal(h.store.writes, 0);
  assert.equal(h.calls.length, 0);
});
test("management, budget, included usage and operator gates are mandatory", async () => {
  for (const option of [
    { authorizedTotal: 77 },
    { managementAuthorized: false },
    { includedCallsConfirmed: false },
    { gates: undefined },
  ]) {
    const h = harness();
    await assert.rejects(
      h.run("prepare", option),
      /RECONNECT_AUTHORIZATION_REQUIRED/,
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.writes, 0);
  }
});
test("source must be final 60 and target identity cannot change", async () => {
  for (const alter of [
    (s: ReconnectSources) => {
      s.observation.calls = 22;
    },
    (s: ReconnectSources) => {
      s.run.boxes[0].addressHash = s.run.boxes[1].addressHash;
    },
    (s: ReconnectSources) => {
      s.run.targetFingerprint = hash("wrong");
    },
  ]) {
    const h = harness();
    alter(h.sources);
    await assert.rejects(h.run());
    assert.equal(h.calls.length, 0);
  }
});
test("B-AC01 prepare targets exact M1 despite shared owner and creates link first", async () => {
  const h = harness(),
    before = structuredClone(h.sources),
    r = await h.prepare();
  assert.equal(r.newCalls, 8);
  assert.equal(r.linkPrepared, true);
  assert.equal(h.revoked, false);
  assert.equal(h.calls.at(-1)!.op, "link");
  assert.equal(h.calls.filter((c) => c.op === "revoke").length, 0);
  assert.deepEqual(h.sources, before);
});
test("B-AC02/03/05/07/08 full roundtrip is 18 requests, M2 intact and binding paused", async () => {
  const h = harness(),
    r = await h.complete();
  assert.equal(r.phase, "completed");
  assert.equal(r.newCalls, 18);
  assert.equal(r.totalCalls, 78);
  assert.equal(r.bindingVerified, true);
  assert.equal(r.operationallyPaused, true);
  assert.ok(Object.values(r.checks!).every(Boolean));
  assert.equal(h.calls.filter((c) => c.op === "revoke").length, 1);
  assert.equal(
    h.calls.filter((c) =>
      ["profile_m2", "control_m2", "control_final"].includes(c.op),
    ).length,
    3,
  );
  assert.equal(h.store.value!.binding!.newId, "ca_new1");
  assert.equal(h.store.value!.binding!.oldId, "ca_one");
  assert.equal(r.apiMessagesSent, 0);
  assert.equal(r.attachmentsDownloaded, 0);
  for (const value of [
    secret,
    "shared-owner",
    "fictional.test",
    "ca_one",
    "ca_two",
    "ca_new1",
    "111aaa",
    "aabbcc001122",
  ]) {
    assert.ok(!JSON.stringify(r).includes(value));
  }
  assert.ok(!JSON.stringify(h.store.value).includes("link_token"));
  assert.ok(!JSON.stringify(h.store.value).includes("headers"));
});
test("normal maximum is 21 with four candidate status reads after human consent", async () => {
  const h = harness();
  await h.revoke();
  h.statuses = ["INITIALIZING", "INITIATED", "INITIATED", "ACTIVE"];
  const r = await h.run("verify", { oauthCompleted: true });
  assert.equal(r.phase, "completed");
  assert.equal(r.newCalls, 21);
  assert.deepEqual(h.clock.waits, [14995, 14995, 29995]);
});
test("human confirmation and phase gates do not trigger OAuth or revoke implicitly", async () => {
  const h = harness();
  await h.prepare();
  const n = h.calls.length;
  await assert.rejects(h.run("verify"), /OAUTH_CONFIRMATION_REQUIRED/);
  assert.equal(h.calls.length, n);
  const r = await h.run("verify", { oauthCompleted: true });
  assert.equal(r.error, "REVOKE_REQUIRED");
  assert.equal(h.calls.length, n);
  assert.equal(h.revoked, false);
});
test("prepared link and revoke actions cannot be replayed into extra POSTs", async () => {
  const h = harness();
  await h.prepare();
  const n = h.calls.length,
    w = h.store.writes;
  await h.run("prepare");
  assert.equal(h.calls.length, n);
  assert.equal(h.store.writes, w);
  await h.run("revoke");
  const after = h.calls.length;
  await h.run("revoke");
  assert.equal(h.calls.length, after);
  assert.equal(h.calls.filter((c) => c.op === "revoke").length, 1);
});
test("invalid link hosts, candidate ids, 200 instead of 201 and short TTL prevent cutoff", async () => {
  for (const mutate of [
    (v: any) => {
      v.redirect_url = "https://evil.invalid/";
    },
    (v: any) => {
      v.connected_account_id = "ca_two";
    },
    (v: any) => {
      v.expires_at = new Date(base + 100).toISOString();
    },
  ]) {
    const h = harness();
    h.alter = (v, op) => {
      if (op === "link") mutate(v);
    };
    const r = await h.run();
    assert.equal(r.phase, "blocked");
    assert.equal(h.revoked, false);
    assert.equal(r.linkPrepared, false);
  }
  const h = harness();
  h.fault = (op) => (op === "link" ? json({}, 200) : undefined);
  const r = await h.run();
  assert.equal(r.phase, "blocked");
  assert.equal(h.revoked, false);
});
test("link expires before revoke: no POST revoke and no automatic new link", async () => {
  const h = harness();
  await h.prepare();
  h.clock.now += 500000;
  const r = await h.run("revoke");
  assert.equal(r.error, "VALID_PREPARED_LINK_REQUIRED");
  assert.equal(h.revoked, false);
  assert.equal(h.linkCount, 1);
});
test("uncertain link creation is never retried or followed by revocation", async () => {
  const h = harness();
  h.fault = (op) => (op === "link" ? Error(secret) : undefined);
  const r = await h.run();
  assert.equal(r.revokeStatus, "not_sent");
  assert.equal(h.store.value!.links[0].status, "uncertain");
  await h.run("prepare");
  await h.run("revoke");
  assert.equal(h.calls.filter((c) => c.op === "link").length, 1);
  assert.equal(h.revoked, false);
});
test("uncertain link can be reconciled once without exposing or guessing its URL", async () => {
  const h = harness();
  h.fault = (op) => (op === "link" ? Error(secret) : undefined);
  await h.run();
  h.fault = undefined;
  const r = await h.run("reconcile");
  assert.equal(r.error, "AUTH_LINK_SECRET_UNAVAILABLE");
  assert.equal(r.budget.retry, 1);
  assert.equal(h.store.value!.links[0].reconciled, true);
  const n = h.calls.length;
  await h.run("reconcile");
  assert.equal(h.calls.length, n);
  assert.equal(h.linkCount, 0);
  assert.equal(h.revoked, false);
});
test("paginated or ambiguous reconciliation cannot select M2 by shared user_id", async () => {
  for (const variant of ["cursor", "multiple", "m2"]) {
    const h = harness();
    h.fault = (op) => (op === "link" ? Error(secret) : undefined);
    await h.run();
    h.fault = undefined;
    h.alter = (v, op) => {
      if (op === "reconcile_link") {
        if (variant === "cursor") v.next_cursor = "more";
        if (variant === "multiple")
          v.items.push({ ...v.items[0], id: "ca_other" });
        if (variant === "m2") v.items[0].id = "ca_two";
      }
    };
    const r = await h.run("reconcile");
    assert.equal(r.phase, "blocked");
    assert.equal(h.revoked, false);
    assert.equal(h.calls.filter((c) => c.op === "revoke").length, 0);
  }
});
test("revoke timeout with effective revocation reconciles without another POST", async () => {
  const h = harness();
  await h.prepare();
  h.fault = (op) => {
    if (op === "revoke") {
      h.revoked = true;
      return Error(secret);
    }
  };
  const r = await h.run("revoke");
  assert.equal(r.phase, "await_auth");
  assert.equal(r.revocationReconciled, true);
  assert.equal(r.revokeStatus, "confirmed");
  assert.equal(h.calls.filter((c) => c.op === "revoke").length, 1);
});
test("a revoke response without conclusive state is pending until explicit reconciliation", async () => {
  const h = harness();
  await h.prepare();
  h.revocationEffective = false;
  const r = await h.run("revoke");
  assert.equal(r.error, "REVOCATION_NOT_CONFIRMED");
  assert.equal(r.phase, "recovery_required");
  assert.equal(r.recoveryRequired, true);
  h.revoked = true;
  const reconciled = await h.run("reconcile");
  assert.equal(reconciled.phase, "await_auth");
  assert.equal(h.calls.filter((c) => c.op === "revoke").length, 1);
});
test("uncertain revoke not yet effective requires explicit GET reconciliation, never repeats POST", async () => {
  const h = harness();
  await h.prepare();
  h.fault = (op) => (op === "revoke" ? Error(secret) : undefined);
  const r = await h.run("revoke");
  assert.equal(r.phase, "revocation_uncertain");
  const n = h.calls.length;
  await h.run("revoke");
  assert.equal(h.calls.length, n);
  h.fault = undefined;
  h.revoked = true;
  const recovered = await h.run("reconcile");
  assert.equal(recovered.phase, "await_auth");
  assert.equal(recovered.budget.retry, 1);
  assert.equal(h.calls.filter((c) => c.op === "revoke").length, 1);
});
test("old connection still usable and M2 failure do not pass revocation acceptance", async () => {
  const h = harness();
  await h.prepare();
  h.fault = (op) =>
    op === "probe_old"
      ? json({ status: 200, data: { emailAddress: addresses[0] } })
      : undefined;
  const r = await h.run("revoke");
  assert.equal(r.error, "OLD_CONNECTION_STILL_USABLE");
  assert.equal(r.phase, "recovery_required");
  const m = harness();
  await m.prepare();
  m.fault = (op) => (op === "control_m2" ? json({}, 403) : undefined);
  const bad = await m.run("revoke");
  assert.equal(bad.phase, "recovery_required");
  assert.equal(bad.checks!.m2During, false);
  assert.equal(bad.bindingVerified, false);
});
test("project auth errors are not confused with account-specific denial", async () => {
  const h = harness();
  await h.prepare();
  h.fault = (op) => (op === "probe_old" ? json({}, 401) : undefined);
  const r = await h.run("revoke");
  assert.equal(r.error, "HTTP_401");
  assert.equal(r.checks!.denied, false);
  assert.equal(r.bindingVerified, false);
});
test("explicit revoked connected account 422 is recognized only for the old probe", async () => {
  const h = harness();
  await h.prepare();
  h.fault = (op) =>
    op === "probe_old"
      ? json({ error: { message: "Connected account is revoked" } }, 422)
      : undefined;
  const r = await h.run("revoke");
  assert.equal(r.phase, "await_auth");
  assert.equal(r.checks!.denied, true);
  assert.equal(r.checks!.m2During, true);
  assert.equal(h.calls.filter((c) => c.op === "revoke").length, 1);
});
test("generic 422 and revoked text on M2 do not authorize recovery proofs", async () => {
  for (const message of [
    "Validation failed",
    "Key revoked",
    "Connection invalid",
    "Connected account is not revoked",
    "Connected account isn't revoked",
  ]) {
    const h = harness();
    await h.prepare();
    h.fault = (op) =>
      op === "probe_old" ? json({ error: { message } }, 422) : undefined;
    const r = await h.run("revoke");
    assert.equal(r.error, "HTTP_422");
    assert.equal(r.checks!.denied, false);
  }
  const h = harness();
  await h.prepare();
  h.fault = (op) =>
    op === "control_m2"
      ? json({ error: { message: "Connected account is revoked" } }, 422)
      : undefined;
  const r = await h.run("revoke");
  assert.equal(r.error, "HTTP_422");
  assert.equal(r.checks!.m2During, false);
});
test("wrong Gmail ACTIVE under same owner is rejected and never bound or revoked automatically", async () => {
  const h = harness();
  await h.revoke();
  h.oauth = true;
  h.wrongIdentity = true;
  const r = await h.run("verify", { oauthCompleted: true });
  assert.equal(r.error, "PROFILE_IDENTITY_MISMATCH");
  assert.equal(r.bindingVerified, false);
  assert.equal(r.phase, "recovery_required");
  await h.run("recover", { recoveryConfirmed: true, oauthCompleted: true });
  assert.equal(h.linkCount, 1);
  assert.equal(h.calls.filter((c) => c.op === "revoke").length, 1);
});
test("missing or malformed Gmail profile is distinguished from an identity mismatch", async () => {
  for (const address of [undefined, null, 7, "not-an-email"]) {
    const h = harness();
    await h.revoke();
    h.oauth = true;
    h.alter = (data, op) => {
      if (op === "profile_candidate") {
        data.emailAddress = address;
        data.messagesTotal = 0;
      }
    };
    const r = await h.run("verify", { oauthCompleted: true });
    assert.equal(r.error, "INVALID_GMAIL_PROFILE");
    assert.equal(r.bindingVerified, false);
  }
});
async function mismatchedRecovery() {
  const h = harness();
  await h.revoke();
  h.clock.now += 600001;
  h.statuses = ["EXPIRED"];
  await h.run("recover", { recoveryConfirmed: true });
  h.oauth = true;
  h.wrongIdentity = true;
  const r = await h.run("verify", { oauthCompleted: true });
  assert.equal(r.error, "PROFILE_IDENTITY_MISMATCH");
  assert.equal(r.budget.recovery, 4);
  return h;
}
test("one authorized identity diagnostic classifies valid and missing profiles without recovery", async () => {
  for (const [address, expected] of [
    [addresses[0], "M1"],
    [addresses[1], "M2"],
    ["other@fictional.test", "OTHER"],
    [undefined, "INVALID"],
  ]) {
    const h = await mismatchedRecovery();
    const before = h.calls.length,
      checks = structuredClone(h.store.value!.checks),
      links = h.linkCount;
    h.alter = (data, op) => {
      if (op === "identity_diagnostic") {
        data.emailAddress = address;
        data.messagesTotal = 0;
      }
    };
    const r = await h.run("inspect_identity", {
      identityDiagnosticAuthorized: true,
    });
    assert.equal(r.identityDiagnostic, expected);
    assert.equal(r.phase, "recovery_required");
    assert.deepEqual(r.checks, checks);
    assert.equal(r.bindingVerified, false);
    assert.equal(r.budget.recovery, 4);
    assert.equal(h.calls.length, before + 1);
    assert.equal(h.linkCount, links);
    assert.equal(h.calls.at(-1)!.body.connected_account_id, "ca_new2");
    assert.equal(JSON.stringify(r).includes("@fictional.test"), false);
    await h.run("inspect_identity", { identityDiagnosticAuthorized: true });
    assert.equal(h.calls.length, before + 1);
  }
});
test("identity diagnostic requires its own gate and cannot run before recovery mismatch", async () => {
  const h = await mismatchedRecovery(),
    before = h.calls.length;
  await assert.rejects(
    h.run("inspect_identity"),
    /IDENTITY_DIAGNOSTIC_AUTHORIZATION_REQUIRED/,
  );
  assert.equal(h.calls.length, before);
  const normal = harness();
  await normal.prepare();
  const count = normal.calls.length;
  const r = await normal.run("inspect_identity", {
    identityDiagnosticAuthorized: true,
  });
  assert.equal(r.error, "IDENTITY_DIAGNOSTIC_NOT_AVAILABLE");
  assert.equal(normal.calls.length, count);
});
test("identity diagnostic reserves once and never retries an ambiguous failed read", async () => {
  const h = await mismatchedRecovery(),
    before = h.calls.length;
  h.fault = (op) => (op === "identity_diagnostic" ? Error(secret) : undefined);
  const r = await h.run("inspect_identity", {
    identityDiagnosticAuthorized: true,
  });
  assert.equal(r.error, "NETWORK_OR_TIMEOUT");
  assert.equal(r.identityDiagnostic, null);
  assert.equal(h.calls.length, before + 1);
  await h.run("inspect_identity", { identityDiagnosticAuthorized: true });
  assert.equal(h.calls.length, before + 1);
  assert.equal(h.store.value!.recovery, 4);
  const bad = structuredClone(h.store.value!);
  bad.identityDiagnostic = "M1";
  assert.throws(() => validateReconnect(bad), /INVALID_RECONNECT_JOURNAL/);
});
test("candidate metadata wrong owner/config is rejected before profile/history", async () => {
  for (const field of ["user_id", "auth_config"]) {
    const h = harness();
    await h.revoke();
    h.oauth = true;
    h.alter = (v, op) => {
      if (op === "candidate")
        v[field] = field === "user_id" ? "wrong-owner" : { id: "ac_other" };
    };
    const r = await h.run("verify", { oauthCompleted: true });
    assert.equal(r.error, "ACCOUNT_IDENTITY_MISMATCH");
    assert.equal(r.bindingVerified, false);
  }
});
test("historical message loss, changed thread and full payload cannot pass", async () => {
  for (const change of [
    (v: any) => {
      v.messages.pop();
    },
    (v: any) => {
      v.id = "dead";
    },
    (v: any) => {
      v.messages[0].payload.body = { data: secret };
    },
  ]) {
    const h = harness();
    await h.revoke();
    h.oauth = true;
    h.alter = (v, op) => {
      if (op === "history") change(v);
    };
    const r = await h.run("verify", { oauthCompleted: true });
    assert.equal(r.phase, "recovery_required");
    assert.equal(r.bindingVerified, false);
    assert.equal(r.checks!.history, false);
  }
});
test("OAuth status polling is bounded at four and cannot reset on replay", async () => {
  const h = harness();
  await h.revoke();
  const r = await h.run("verify", { oauthCompleted: true });
  assert.equal(r.error, "OAUTH_NOT_ACTIVE");
  assert.equal(h.store.value!.links[0].statusChecks, 4);
  const n = h.calls.length;
  await h.run("verify", { oauthCompleted: true });
  assert.equal(h.calls.length, n);
  assert.equal(h.linkCount, 1);
});
test("late completion may use existing ACTIVE candidate via protected recovery without creating another link", async () => {
  const h = harness();
  await h.revoke();
  await h.run("verify", { oauthCompleted: true });
  h.oauth = true;
  const r = await h.run("recover", {
    recoveryConfirmed: true,
    oauthCompleted: true,
  });
  assert.equal(r.phase, "completed");
  assert.equal(r.budget.recovery, 2);
  assert.equal(h.linkCount, 1);
});
test("expired OAuth can obtain one recovery link and recover same mailbox within H4", async () => {
  const h = harness();
  await h.revoke();
  h.statuses = ["EXPIRED"];
  await h.run("verify", { oauthCompleted: true });
  h.statuses = ["EXPIRED"];
  const prepared = await h.run("recover", { recoveryConfirmed: true });
  assert.equal(prepared.phase, "await_auth");
  assert.equal(h.linkCount, 2);
  assert.equal(prepared.budget.recovery, 2);
  h.oauth = true;
  const r = await h.run("verify", { oauthCompleted: true });
  assert.equal(r.phase, "completed");
  assert.equal(r.budget.recovery, 4);
  assert.equal(h.store.value!.binding!.newId, "ca_new2");
});
test("recovery cannot create links while first session is valid or retry forever", async () => {
  const h = harness();
  await h.revoke();
  const r = await h.run("recover", { recoveryConfirmed: true });
  assert.equal(r.error, "RECOVERY_LINK_NOT_EXPIRED");
  assert.equal(h.linkCount, 1);
  await assert.rejects(h.run("recover"), /RECOVERY_CONFIRMATION_REQUIRED/);
});
test("preflight transient retry preserves strict pre-cut recovery reserve by aborting before link", async () => {
  const h = harness();
  let once = false;
  h.fault = (op) => {
    if (op === "config" && !once) {
      once = true;
      return json({}, 503);
    }
  };
  const r = await h.run();
  assert.equal(r.error, "PROTECTED_RESERVE_BEFORE_LINK");
  assert.equal(r.budget.retry, 1);
  assert.equal(h.linkCount, 0);
  assert.equal(h.revoked, false);
});
test("read retries are bounded, observe Retry-After, and mutations never retry", async () => {
  const h = harness();
  await h.revoke();
  h.oauth = true;
  let once = false;
  h.fault = (op) => {
    if (op === "profile_candidate" && !once) {
      once = true;
      return json({}, 429, { "retry-after": "7" });
    }
  };
  const r = await h.run("verify", { oauthCompleted: true });
  assert.equal(r.phase, "completed");
  assert.equal(r.budget.retry, 1);
  assert.ok(h.clock.waits.includes(7000));
  const m = harness();
  m.fault = (op) => (op === "link" ? json({}, 503) : undefined);
  await m.run();
  assert.equal(m.calls.filter((c) => c.op === "link").length, 1);
});
test("recovery slots retain a profile check and cannot overrun four or total28", async () => {
  const h = harness();
  await h.revoke();
  h.statuses = ["EXPIRED"];
  await h.run("verify", { oauthCompleted: true });
  h.statuses = ["EXPIRED"];
  await h.run("recover", { recoveryConfirmed: true });
  const r = await h.run("verify", { oauthCompleted: true });
  assert.equal(r.error, "RECOVERY_IDENTITY_SLOT_RESERVED");
  assert.equal(r.budget.recovery, 3);
  assert.equal(r.bindingVerified, false);
  assert.ok(r.newCalls <= 28);
});
test("completed replay, including restart, has zero HTTP, writes or OAuth actions", async () => {
  const h = harness();
  const r = await h.complete(),
    calls = h.calls.length,
    writes = h.store.writes,
    old = structuredClone(h.store.value);
  const again = await h.run("verify", {
    oauthCompleted: true,
    fetchImpl: async () => {
      throw Error("UNEXPECTED_NETWORK");
    },
  });
  assert.deepEqual(again, r);
  assert.equal(h.calls.length, calls);
  assert.equal(h.store.writes, writes);
  assert.deepEqual(h.store.value, old);
});
test("disk failure before revoke prevents HTTP and a crash reservation cannot re-POST", async () => {
  const h = harness();
  await h.prepare();
  h.store.hook = (s) => {
    if (s.revoke.status === "in_flight") throw Error(secret);
  };
  await assert.rejects(h.run("revoke"), /JOURNAL_WRITE_FAILED/);
  assert.equal(h.revoked, false);
  const m = harness();
  await m.prepare();
  m.store.hook = (s) => {
    if (
      s.requests.at(-1)?.op === "revoke" &&
      s.requests.at(-1)?.result !== "IN_FLIGHT"
    )
      throw Error(secret);
  };
  await assert.rejects(m.run("revoke"), /JOURNAL_WRITE_FAILED/);
  assert.equal(m.revoked, true);
  assert.equal(m.store.value!.revoke.status, "in_flight");
  m.store.hook = undefined;
  const n = m.calls.length;
  await m.run("revoke");
  assert.equal(m.calls.length, n);
  assert.equal(m.store.value!.revoke.status, "uncertain");
  const r = await m.run("reconcile");
  assert.equal(r.phase, "await_auth");
  assert.equal(m.calls.filter((c) => c.op === "revoke").length, 1);
});
test("cancellation after cutoff keeps access recovery pending, without implicit POST or reset", async () => {
  const h = harness();
  await h.revoke();
  const abort = new AbortController();
  abort.abort();
  const r = await h.run("verify", {
    oauthCompleted: true,
    signal: abort.signal,
  });
  assert.equal(r.phase, "recovery_required");
  assert.equal(r.recoveryRequired, true);
  assert.equal(r.error, "CANCELLED");
  assert.equal(h.linkCount, 1);
});
test("counter/journal corruption, changed source and midrun key rotation are rejected", async () => {
  const h = harness();
  await h.prepare();
  for (const change of [
    (s: any) => {
      s.calls = 0;
    },
    (s: any) => {
      s.baseCalls = 0;
    },
    (s: any) => {
      s.normal = 22;
    },
    (s: any) => {
      s.extra = secret;
    },
  ]) {
    const s = structuredClone(h.store.value);
    change(s);
    assert.throws(() => validateReconnect(s), /INVALID_RECONNECT_JOURNAL/);
  }
  await assert.rejects(
    runComposioReconnect(
      { ...env, COMPOSIO_API_KEY: "rotated-after-prepare" },
      h.sources,
      h.store,
      "revoke",
      {
        execute: true,
        authorizedTotal: 88,
        managementAuthorized: true,
        includedCallsConfirmed: true,
        gates: {
          managementPermission: true,
          operatorReady: true,
          grantIsolated: true,
          noVerifier: true,
        },
      },
    ),
    /CONFIGURATION_CHANGED/,
  );
  h.sources.observation.clock.uncertaintyMs = 1;
  await assert.rejects(h.run("revoke"), /CONFIGURATION_CHANGED/);
});
test("missing final usage is separate from restored identity, without resending on replay", async () => {
  const h = harness();
  await h.revoke();
  h.oauth = true;
  h.fault = (op) => (op === "usage_after" ? json({}, 403) : undefined);
  const r = await h.run("verify", { oauthCompleted: true });
  assert.equal(r.phase, "completed");
  assert.equal(r.bindingVerified, true);
  assert.equal(r.usageError, "HTTP_403");
  const n = h.calls.length;
  await h.run("verify", { oauthCompleted: true });
  assert.equal(h.calls.length, n);
});

async function temporary(work: (root: string) => Promise<void>) {
  await mkdir(resolve(".local"), { recursive: true });
  const root = await mkdtemp(resolve(".local", "s00-reconnect-test-"));
  try {
    await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("file store is atomic, holds three locks and never touches source journals", () =>
  temporary(async (root) => {
    const h = harness();
    await h.prepare();
    const files = reconnectFiles(root),
      folder = resolve(root, ".local/pipeline-os");
    await files.locked(async () => {
      await writeFile(
        resolve(folder, "s00-composio-run.json"),
        JSON.stringify(h.sources.run),
      );
      await writeFile(
        resolve(folder, "s00-composio-observation.json"),
        JSON.stringify(h.sources.observation),
      );
      await files.store.save(h.store.value!);
      assert.deepEqual(
        await files.store.load(),
        JSON.parse(JSON.stringify(h.store.value)),
      );
      assert.deepEqual(await files.sources(), h.sources);
      for (const name of [
        "s00-composio-run.json.lock",
        "s00-composio-observation.json.lock",
        "s00-composio-reconnect.json.lock",
      ])
        await stat(resolve(folder, name));
      await assert.rejects(
        files.locked(async () => {}),
        /JOURNAL_LOCKED/,
      );
    });
    await assert.rejects(
      stat(resolve(folder, "s00-composio-reconnect.json.lock")),
    );
    const before = await readFile(
      resolve(folder, "s00-composio-reconnect.json"),
      "utf8",
    );
    await writeFile(resolve(folder, "s00-composio-reconnect.json.tmp"), secret);
    await assert.rejects(files.locked(() => files.store.save(h.store.value!)));
    assert.equal(
      await readFile(resolve(folder, "s00-composio-reconnect.json"), "utf8"),
      before,
    );
    assert.equal(
      await readFile(
        resolve(folder, "s00-composio-reconnect.json.tmp"),
        "utf8",
      ),
      secret,
    );
  }));
test("existing reconnect lock is not deleted and other locks are released on failure", () =>
  temporary(async (root) => {
    const files = reconnectFiles(root);
    await files.locked(async () => {});
    const folder = resolve(root, ".local/pipeline-os"),
      lock = resolve(folder, "s00-composio-reconnect.json.lock");
    await writeFile(lock, secret);
    await assert.rejects(
      files.locked(async () => {}),
      /JOURNAL_LOCKED/,
    );
    assert.equal(await readFile(lock, "utf8"), secret);
    for (const name of [
      "s00-composio-run.json.lock",
      "s00-composio-observation.json.lock",
    ])
      await assert.rejects(stat(resolve(folder, name)));
  }));
test("reconnect CLI is offline by default, no env autoload/mkdir and errors are redacted", () =>
  temporary(async (root) => {
    const loader = pathToFileURL(
        resolve("node_modules/tsx/dist/loader.mjs"),
      ).href,
      cli = resolve("scripts/pipeline-os/s00-composio-reconnect-cli.ts");
    await writeFile(resolve(root, ".env.local"), "SECRET=" + secret);
    await writeFile(
      resolve(root, "guard.mjs"),
      'globalThis.fetch=()=>{throw Error("NETWORK_FORBIDDEN")};',
    );
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          loader,
          "--import",
          pathToFileURL(resolve(root, "guard.mjs")).href,
          cli,
          ...args,
        ],
        { cwd: root, encoding: "utf8" },
      );
    const r = run([]);
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).phase, "not_started");
    await assert.rejects(stat(resolve(root, ".local")));
    for (const args of [
      ["--" + secret],
      ["--execute", "--action=prepare"],
      ["--execute", "--action=prepare", "--authorized-total=77"],
    ]) {
      const result = run(args);
      assert.equal(result.status, 2);
      assert.ok(!result.stdout.includes(secret));
      assert.ok(!result.stderr.includes(secret));
    }
    await assert.rejects(stat(resolve(root, ".local")));
  }));
test("observer CLI refuses an obsolete budget when reconnect ledger exists", () =>
  temporary(async (root) => {
    const folder = resolve(root, ".local/pipeline-os");
    await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, "s00-composio-reconnect.json"), "{}");
    const loader = pathToFileURL(
      resolve("node_modules/tsx/dist/loader.mjs"),
    ).href;
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        loader,
        resolve("scripts/pipeline-os/s00-composio-observer-cli.ts"),
        "--execute",
        "--authorized-total=77",
        "--included-calls-confirmed",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(r.status, 2);
    assert.equal(
      JSON.parse(r.stderr).error,
      "RECONNECT_LEDGER_SUPERSEDES_OBSERVER",
    );
  }));
test("bounded shared transport rejects deletion, arbitrary status mutation and malformed management JSON", async () => {
  for (const [path, method] of [
    ["connected_accounts/ca_two/status", "POST"],
    ["connected_accounts/ca_two", "POST"],
    ["tools/execute/proxy", "GET"],
  ] as const) {
    await assert.rejects(
      boundedComposioJson(
        async () => {
          throw Error("NO_FETCH");
        },
        secret,
        path,
        method,
        undefined,
        100,
        undefined,
        200,
      ),
      /BLOCKED_ROUTE/,
    );
  }
  await assert.rejects(
    boundedComposioJson(
      async () =>
        new Response("bad", {
          headers: { "content-type": "application/json" },
        }),
      secret,
      "connected_accounts/link",
      "POST",
      {},
      100,
      undefined,
      201,
    ),
    /HTTP_200/,
  );
});

async function maximumRecovery(failClosing = false) {
  const h = harness();
  await h.prepare();
  const failures: Record<string, number> = { control_m2: 1, control_final: 2 };
  h.fault = (op) => {
    if (failures[op] > 0) {
      failures[op]--;
      return json({}, op === "control_final" && failures[op] === 0 ? 403 : 503);
    }
  };
  await h.run("revoke");
  h.oauth = true;
  const failed = await h.run("verify", { oauthCompleted: true });
  assert.equal(failed.phase, "recovery_required");
  assert.equal(h.store.value!.checks.history, true);
  assert.equal(h.store.value!.checks.recheck, true);
  h.statuses = ["EXPIRED"];
  await h.run("recover", { recoveryConfirmed: true });
  assert.equal(h.store.value!.checks.history, false);
  assert.equal(h.store.value!.checks.recheck, false);
  let retryHistory = true;
  h.fault = (op) => {
    if (op === "history" && retryHistory) {
      retryHistory = false;
      return json({}, 503);
    }
    if (failClosing && op === "usage_after") return json({}, 503);
  };
  return { h, result: await h.run("verify", { oauthCompleted: true }) };
}
test("all reserves reach exactly 28/88 and a new binding repeats historical checks", async () => {
  const { h, result: r } = await maximumRecovery();
  assert.equal(r.phase, "completed");
  assert.equal(r.newCalls, 28);
  assert.equal(r.totalCalls, 88);
  assert.deepEqual(r.budget, { normal: 21, retry: 3, recovery: 4 });
  assert.equal(h.calls.length, 28);
  assert.equal(h.calls.filter((c) => c.op === "revoke").length, 1);
  assert.equal(
    h.calls.filter((c) => c.op === "link" || c.op === "recovery_link").length,
    2,
  );
  assert.equal(h.calls.filter((c) => c.op === "recheck").length, 2);
  assert.equal(h.store.value!.binding!.newId, "ca_new2");
});
test("failure on final slot never sends a twenty-ninth request or repeats a mutation", async () => {
  const { h, result: r } = await maximumRecovery(true);
  assert.equal(r.phase, "completed");
  assert.equal(r.newCalls, 28);
  assert.equal(r.usageError, "HTTP_503");
  assert.equal(r.closureComplete, false);
  const n = h.calls.length;
  await h.run("verify", { oauthCompleted: true });
  assert.equal(h.calls.length, n);
  assert.equal(h.calls.length, 28);
});
test("provider 400/409/401/403 management rejection never retries or cuts access by fallback", async () => {
  for (const status of [400, 409, 401, 403]) {
    const h = harness();
    h.fault = (op) =>
      op === "link" ? json({ private: secret }, status) : undefined;
    const r = await h.run();
    assert.equal(r.phase, "blocked");
    assert.equal(r.error, "HTTP_" + status);
    assert.equal(h.revoked, false);
    assert.equal(h.calls.filter((c) => c.op === "link").length, 1);
    assert.equal(r.budget.retry, 0);
    assert.ok(!JSON.stringify(r).includes(secret));
  }
});
test("corrupted mutation reservations or candidate=M2 are rejected before HTTP", async () => {
  const h = harness();
  await h.revoke();
  const bad = structuredClone(h.store.value!);
  bad.revoke.status = "not_sent";
  assert.throws(() => validateReconnect(bad), /INVALID_RECONNECT_JOURNAL/);
  h.store.value!.links[0].id = "ca_two";
  const calls = h.calls.length;
  await assert.rejects(
    h.run("verify", { oauthCompleted: true }),
    /INVALID_RECONNECT_JOURNAL/,
  );
  assert.equal(h.calls.length, calls);
  const completed = harness();
  await completed.complete();
  completed.store.value!.binding!.oldId = "ca_two";
  const before = completed.calls.length;
  await assert.rejects(
    completed.run("verify", { oauthCompleted: true }),
    /INVALID_RECONNECT_JOURNAL/,
  );
  assert.equal(completed.calls.length, before);
});
test("missing baseline message and mismatched second read cannot activate binding", async () => {
  for (const op of ["baseline", "recheck"]) {
    const h = harness();
    h.alter = (v, k) => {
      if (k === op) v.messages.pop();
    };
    const r = op === "baseline" ? await h.run() : await h.complete();
    assert.notEqual(r.phase, "completed");
    assert.equal(r.bindingVerified, false);
  }
});
test("recovery link timeout remains uncertain across restart without a third link", async () => {
  const h = harness();
  await h.revoke();
  h.statuses = ["EXPIRED"];
  await h.run("verify", { oauthCompleted: true });
  h.statuses = ["EXPIRED"];
  h.fault = (op) => (op === "recovery_link" ? Error(secret) : undefined);
  const r = await h.run("recover", { recoveryConfirmed: true });
  assert.equal(r.phase, "recovery_required");
  assert.equal(h.store.value!.links.length, 2);
  assert.equal(h.store.value!.links[1].status, "uncertain");
  const n = h.calls.length;
  await h.run("recover", { recoveryConfirmed: true });
  await h.run("verify", { oauthCompleted: true });
  assert.equal(h.calls.length, n);
});
test("original runner refuses reconnect ledger even when older observation file is absent", () =>
  temporary(async (root) => {
    const folder = resolve(root, ".local/pipeline-os");
    await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, "s00-composio-reconnect.json"), "{}");
    const loader = pathToFileURL(
      resolve("node_modules/tsx/dist/loader.mjs"),
    ).href;
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        loader,
        resolve("scripts/pipeline-os/s00-composio-runner-cli.ts"),
        "--execute",
        "--action=usage",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(r.status, 2);
    assert.equal(
      JSON.parse(r.stderr).error,
      "RECONNECT_LEDGER_SUPERSEDES_RUNNER",
    );
  }));
