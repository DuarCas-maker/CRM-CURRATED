import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { hash } from "../scripts/pipeline-os/s00-composio-common";
import { validateObservation } from "../scripts/pipeline-os/s00-composio-observer";
import { reconnectFiles } from "../scripts/pipeline-os/s00-composio-reconnect-files";
import {
  validateReconnect,
  type ReconnectState,
} from "../scripts/pipeline-os/s00-composio-reconnect";
import {
  runComposioCorrection,
  validateCorrection,
  validateReconnectLedger,
  correctionTargetCheck,
  type CorrectionState,
  type ReconnectLedger,
  type CorrectionStore,
  type CorrectionAction,
  type CorrectionOptions,
} from "../scripts/pipeline-os/s00-composio-correction";
import {
  base,
  secret,
  env,
  addresses,
  json,
  harness as oldHarness,
} from "./fixtures/pipeline-os-composio";

async function predecessorFixture() {
  const h = oldHarness();
  h.sources.observation = validateObservation(h.sources.observation);
  await h.prepare();
  h.fault = (op) => (op === "probe_old" ? json({}, 422) : undefined);
  await h.run("revoke");
  await h.run("reconcile");
  h.fault = undefined;
  await h.run("reconcile");
  h.clock.now += 600001;
  h.statuses = ["EXPIRED"];
  await h.run("recover", { recoveryConfirmed: true });
  h.oauth = true;
  h.wrongIdentity = true;
  await h.run("verify", { oauthCompleted: true });
  await h.run("inspect_identity", { identityDiagnosticAuthorized: true });
  const p = validateReconnect(h.store.value);
  assert.equal(p.calls, 21);
  assert.equal(p.identityDiagnostic, "M2");
  return { p, sources: h.sources, clock: h.clock };
}
class Memory implements CorrectionStore {
  writes = 0;
  deliveries: string[] = [];
  hook?: (s: CorrectionState) => void;
  deliveryError = false;
  constructor(public value: ReconnectLedger) {}
  async load() {
    return structuredClone(this.value);
  }
  async save(s: CorrectionState) {
    this.hook?.(s);
    this.writes++;
    this.value = structuredClone(s);
  }
  async deliver(url: string) {
    if (this.deliveryError) throw Error(secret);
    this.deliveries.push(url);
  }
}
async function harness() {
  const { p, sources, clock } = await predecessorFixture(),
    store = new Memory(p),
    calls: { op: string; path: string; body: any }[] = [],
    before = JSON.stringify(p);
  const h = {
    p,
    sources,
    clock,
    store,
    calls,
    before,
    statuses: [] as string[],
    address: addresses[0] as unknown,
    oauth: false,
    shortLink: false,
    newMessage: false,
    mutate: undefined as undefined | ((d: any, op: string) => void),
    fault: undefined as
      undefined | ((op: string, n: number) => Response | Error | undefined),
    fetchImpl: undefined as unknown as typeof fetch,
    run: (
      action: CorrectionAction = "correct_prepare",
      options: CorrectionOptions = {},
      target: string | undefined = addresses[0],
    ) =>
      runComposioCorrection(env, sources, store, action, target, {
        execute: true,
        authorizedTotal: 97,
        correctionAuthorized: true,
        managementAuthorized: true,
        includedCallsConfirmed: true,
        gates: {
          managementPermission: true,
          operatorReady: true,
          grantIsolated: true,
          noVerifier: true,
        },
        clock,
        fetchImpl: h.fetchImpl,
        ...options,
      }),
    async prepare() {
      const r = await h.run();
      assert.equal(r!.phase, "await_auth");
      return r!;
    },
    async complete() {
      await h.prepare();
      h.oauth = true;
      return (await h.run("correct_verify", { oauthCompleted: true }))!;
    },
  };
  h.fetchImpl = async (input, init) => {
    assert.equal(new URL(String(input)).origin, "https://backend.composio.dev");
    const s = validateCorrection(store.value),
      trace = s.requests.at(-1)!,
      op = trace.op,
      path = new URL(String(input)).pathname.replace("/api/v3.1/", "");
    assert.equal(trace.result, "IN_FLIGHT");
    assert.equal(s.calls, calls.length + 1);
    assert.ok(s.calls <= 16);
    assert.equal(JSON.stringify(s.predecessor), before);
    assert.equal(init!.redirect, "manual");
    assert.ok(init!.signal);
    assert.equal(new Headers(init!.headers).get("x-api-key"), secret);
    const b = init!.body ? JSON.parse(String(init!.body)) : undefined;
    calls.push({ op, path, body: b });
    clock.now += 5;
    const fault = h.fault?.(op, calls.length);
    if (fault instanceof Error) throw fault;
    if (fault) return fault;
    let d: any,
      status = 200;
    if (op.startsWith("usage_")) d = { instant_charge: "0" };
    else if (op === "config")
      d = {
        id: "ac_test",
        toolkit: { slug: "gmail" },
        is_composio_managed: false,
        credentials: {
          scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        },
      };
    else if (op === "old" || op.startsWith("candidate_")) {
      const isOld = op === "old";
      assert.equal(init!.method, "GET");
      assert.equal(
        path,
        "connected_accounts/" + (isOld ? "ca_one" : "ca_correct"),
      );
      d = {
        id: isOld ? "ca_one" : "ca_correct",
        status: isOld
          ? "REVOKED"
          : (h.statuses.shift() ?? (h.oauth ? "ACTIVE" : "INITIALIZING")),
        user_id: "shared-owner",
        auth_config: { id: "ac_test" },
        toolkit: { slug: "gmail" },
      };
    } else if (op === "link") {
      assert.equal(path, "connected_accounts/link");
      assert.equal(init!.method, "POST");
      assert.equal(b.user_id, "shared-owner");
      assert.deepEqual(Object.keys(b).sort(), [
        "alias",
        "auth_config_id",
        "user_id",
      ]);
      assert.equal(s.link.status, "in_flight");
      status = 201;
      d = {
        connected_account_id: "ca_correct",
        redirect_url: "https://connect.composio.dev/link/" + secret,
        link_token: secret,
        expires_at: new Date(
          clock.wallNow() + (h.shortLink ? 1000 : 600000),
        ).toISOString(),
      };
    } else if (op === "reconcile_link")
      d = {
        items: [
          {
            id: "ca_correct",
            alias: s.link.alias,
            user_id: "shared-owner",
            auth_config: { id: "ac_test" },
            toolkit: { slug: "gmail" },
          },
        ],
        next_cursor: null,
      };
    else {
      assert.equal(path, "tools/execute/proxy");
      assert.equal(b.method, "GET");
      assert.equal(b.user_id, "shared-owner");
      assert.equal(b.body, undefined);
      if (op === "m2_before" || op === "m2_after") {
        assert.equal(b.connected_account_id, "ca_two");
        d = { emailAddress: addresses[1] };
      } else if (op === "profile") {
        assert.equal(b.connected_account_id, "ca_correct");
        d = { emailAddress: h.address, messagesTotal: 4 };
      } else {
        assert.equal(b.connected_account_id, "ca_correct");
        const u = new URL(b.endpoint);
        assert.equal(u.searchParams.get("format"), "metadata");
        assert.equal(
          u.searchParams.get("fields"),
          "id,messages(id,threadId,internalDate,payload(headers))",
        );
        d = {
          id: "111aaa",
          messages: [
            "aa0",
            "cc0",
            "bb0",
            "dd0",
            ...(h.newMessage ? ["ee0"] : []),
          ].map((id) => ({
            id,
            threadId: "111aaa",
            internalDate: String(base - 5000),
            payload: {
              headers: [
                {
                  name: "From",
                  value: ["cc0", "dd0", "ee0"].includes(id)
                    ? env.S00_TEST_RECIPIENT_EMAIL
                    : addresses[0],
                },
                {
                  name: "To",
                  value: ["cc0", "dd0", "ee0"].includes(id)
                    ? addresses[0]
                    : env.S00_TEST_RECIPIENT_EMAIL,
                },
                {
                  name: "Subject",
                  value: "[S00 TEST] S00-COMPOSIO-" + sources.run.token + "-M1",
                },
                { name: "Message-ID", value: "<" + id + "@fictional.test>" },
              ],
            },
          })),
        };
      }
      h.mutate?.(d, op);
      return json({ status: 200, data: d });
    }
    h.mutate?.(d, op);
    return json(d, status);
  };
  return h;
}

test("C-AC01/05/08: correct Gmail restored in eleven requests with one link, predecessor unchanged", async () => {
  const h = await harness(),
    r = await h.complete();
  assert.equal(r.phase, "completed");
  assert.equal(r.newCalls, 11);
  assert.equal(r.totalCalls, 92);
  assert.equal(r.bindingVerified, true);
  assert.equal(r.closureComplete, true);
  assert.equal(r.operationallyPaused, true);
  assert.equal(r.apiMessagesSent, 0);
  assert.equal(r.attachmentsDownloaded, 0);
  assert.equal(h.store.deliveries.length, 1);
  assert.equal(
    JSON.stringify((h.store.value as CorrectionState).predecessor),
    h.before,
  );
  const n = h.calls.length,
    w = h.store.writes;
  await h.run("correct_verify", { oauthCompleted: true });
  assert.equal(h.calls.length, n);
  assert.equal(h.store.writes, w);
  const report = JSON.stringify(r);
  for (const value of [
    secret,
    addresses[0],
    addresses[1],
    "ca_correct",
    "https://connect.composio.dev",
  ])
    assert.equal(report.includes(value), false);
  assert.deepEqual(
    h.calls.map((c) => c.op),
    [
      "usage_before",
      "config",
      "old",
      "m2_before",
      "link",
      "candidate_1",
      "profile",
      "history",
      "recheck",
      "m2_after",
      "usage_after",
    ],
  );
});
test("normal thirteen and full reserve sixteen yield total97 with no seventeenth request", async () => {
  const h = await harness();
  h.statuses = ["INITIALIZING", "INITIALIZING", "ACTIVE"];
  const failed = new Set<string>();
  h.fault = (op) =>
    ["config", "m2_before", "usage_after"].includes(op) && !failed.has(op)
      ? (failed.add(op), json({}, 503))
      : undefined;
  const r = await h.complete();
  assert.equal(r.phase, "completed");
  assert.equal(r.newCalls, 16);
  assert.equal(r.totalCalls, 97);
  assert.deepEqual(r.budget, { normal: 13, retry: 3 });
  assert.equal(h.calls.filter((c) => c.op === "link").length, 1);
  assert.ok(h.clock.waits.filter((ms) => ms === 5000).length >= 3);
  await h.run("correct_prepare");
  assert.equal(h.calls.length, 16);
});
test("three status reads without retries produce thirteen, and unconfirmed OAuth never polls", async () => {
  const h = await harness();
  h.statuses = ["INITIATED", "INITIALIZING", "ACTIVE"];
  await h.prepare();
  await assert.rejects(h.run("correct_verify"), /OAUTH_CONFIRMATION_REQUIRED/);
  assert.equal(h.calls.length, 5);
  h.oauth = true;
  const r = await h.run("correct_verify", { oauthCompleted: true });
  assert.equal(r!.newCalls, 13);
  assert.equal(r!.totalCalls, 94);
});
test("final seventeenth/98th request is forbidden even when usage fails on the last slot", async () => {
  const h = await harness();
  h.statuses = ["INITIATED", "INITIALIZING", "ACTIVE"];
  const retried = new Set<string>();
  h.fault = (op) => {
    if (["config", "m2_before", "history"].includes(op) && !retried.has(op)) {
      retried.add(op);
      return json({}, 503);
    }
    return op === "usage_after" ? json({}, 503) : undefined;
  };
  const r = await h.complete();
  assert.equal(r.totalCalls, 97);
  assert.equal(h.calls.length, 16);
  assert.equal(r.closureComplete, false);
  assert.equal(r.bindingVerified, true);
  assert.equal(r.usageError, "HTTP_503");
  await h.run("correct_verify", { oauthCompleted: true });
  assert.equal(h.calls.length, 16);
});
test("three nonactive status reads stop without polling again or creating a fourth link", async () => {
  const h = await harness();
  await h.prepare();
  const r = await h.run("correct_verify", { oauthCompleted: true });
  assert.equal(r!.error, "OAUTH_NOT_ACTIVE");
  assert.equal(h.calls.filter((c) => c.op.startsWith("candidate_")).length, 3);
  const count = h.calls.length;
  await h.run("correct_verify", { oauthCompleted: true });
  assert.equal(h.calls.length, count);
  assert.equal(h.calls.filter((c) => c.op === "link").length, 1);
});
test("read success followed by disk interruption resumes within R without resetting N", async () => {
  const h = await harness();
  let crashed = false;
  h.store.hook = (s) => {
    if (s.checks.config) crashed = true;
    if (crashed) throw Error(secret);
  };
  await assert.rejects(h.run(), /JOURNAL_WRITE_FAILED/);
  assert.equal((h.store.value as CorrectionState).checks.config, false);
  assert.equal(
    (h.store.value as CorrectionState).requests.at(-1)!.result,
    "OK",
  );
  h.store.hook = undefined;
  const r = await h.run();
  assert.equal(r!.phase, "await_auth");
  assert.deepEqual(r!.budget, { normal: 5, retry: 1 });
  assert.equal(h.calls.filter((c) => c.op === "link").length, 1);
});
test("backoff longer than sixty seconds and cancellation stop before further HTTP", async () => {
  const h = await harness();
  h.fault = (op) =>
    op === "config" ? json({}, 429, { "retry-after": "61" }) : undefined;
  const r = await h.run();
  assert.equal(r!.error, "RETRY_WAIT_EXCEEDS_LIMIT");
  assert.equal(h.calls.length, 2);
  assert.equal(h.clock.waits.filter((ms) => ms > 60000).length, 0);
  const m = await harness(),
    abort = new AbortController();
  abort.abort();
  const stopped = await m.run("correct_prepare", { signal: abort.signal });
  assert.equal(stopped!.error, "CANCELLED");
  assert.equal(m.calls.length, 0);
});
test("C-AC02/03: missing authorization or wrong intended email blocks before writes and HTTP", async () => {
  for (const opts of [
    { authorizedTotal: 88 },
    { correctionAuthorized: false },
    { managementAuthorized: false },
    { includedCallsConfirmed: false },
    { gates: undefined },
  ]) {
    const h = await harness();
    await assert.rejects(
      h.run("correct_prepare", opts),
      /CORRECTION_AUTHORIZATION_REQUIRED/,
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.writes, 0);
  }
  for (const [text, err] of [
    [addresses[1], "M1_TARGET_IS_M2"],
    ["other@fictional.test", "M1_TARGET_NOT_ORIGINAL"],
    ["bad", "INVALID_M1_TARGET"],
    ["x".repeat(513), "M1_TARGET_REQUIRED_OR_TOO_LARGE"],
  ]) {
    const h = await harness();
    await assert.rejects(h.run("correct_prepare", {}, text), new RegExp(err));
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.writes, 0);
  }
  const h = await harness();
  assert.throws(
    () => correctionTargetCheck(undefined, h.p, h.sources),
    /M1_TARGET_REQUIRED/,
  );
  assert.equal(
    correctionTargetCheck("  ONE@fictional.test\r\n", h.p, h.sources).matchesM1,
    true,
  );
});
test("default status is offline and never upgrades v1 or requires target/config/source", async () => {
  const h = await harness();
  assert.equal(await runComposioCorrection({}, undefined, h.store), undefined);
  assert.equal(h.store.writes, 0);
  assert.equal(h.calls.length, 0);
  await h.prepare();
  const n = h.calls.length,
    w = h.store.writes;
  const r = await runComposioCorrection({}, undefined, h.store);
  assert.equal(r!.phase, "await_auth");
  assert.equal(h.calls.length, n);
  assert.equal(h.store.writes, w);
});
test("candidate M2, other or incomplete address never binds or creates another link", async () => {
  for (const address of [
    addresses[1],
    "other@fictional.test",
    undefined,
    null,
    4,
  ]) {
    const h = await harness();
    h.address = address;
    await h.prepare();
    h.oauth = true;
    const r = await h.run("correct_verify", { oauthCompleted: true });
    assert.equal(r!.phase, "recovery_required");
    assert.equal(r!.bindingVerified, false);
    assert.equal(
      r!.error,
      typeof address === "string"
        ? "PROFILE_IDENTITY_MISMATCH"
        : "INVALID_GMAIL_PROFILE",
    );
    assert.equal(h.calls.filter((c) => c.op === "history").length, 0);
    const count = h.calls.length;
    await h.run("correct_verify", { oauthCompleted: true });
    assert.equal(h.calls.length, count);
    assert.equal(h.calls.filter((c) => c.op === "link").length, 1);
  }
});
test("wrong candidate owner/config, original IDs and earlier candidates fail closed", async () => {
  for (const field of ["user_id", "auth_config", "toolkit"]) {
    const h = await harness();
    h.mutate = (d, op) => {
      if (op.startsWith("candidate_"))
        d[field] =
          field === "user_id" ? "wrong" : { id: "ac_wrong", slug: "other" };
    };
    const r = await h.complete();
    assert.equal(r.error, "ACCOUNT_IDENTITY_MISMATCH");
    assert.equal(r.bindingVerified, false);
  }
  for (const id of ["ca_one", "ca_two", "ca_new1", "ca_new2"]) {
    const h = await harness();
    h.mutate = (d, op) => {
      if (op === "link") d.connected_account_id = id;
    };
    const r = await h.run();
    assert.equal(r!.error, "INVALID_AUTH_LINK");
    assert.equal(r!.bindingVerified, false);
    assert.equal(h.calls.length, 5);
  }
});
test("preflight changed M1 state, M2 identity, managed config and missing scope block link", async () => {
  for (const scenario of ["old", "m2_before", "managed", "scope"]) {
    const h = await harness();
    h.mutate = (d, op) => {
      if (scenario === op) {
        if (op === "old") d.status = "ACTIVE";
        else d.emailAddress = addresses[0];
      }
      if (op === "config" && scenario === "managed")
        d.is_composio_managed = true;
      if (op === "config" && scenario === "scope") d.credentials.scopes = [];
    };
    const r = await h.run();
    assert.equal(r!.phase, "blocked");
    assert.equal(h.calls.filter((c) => c.op === "link").length, 0);
  }
});
test("C-AC07: legitimate new metadata is kept; baseline loss, bodies or unstable recheck fail", async () => {
  const good = await harness();
  good.newMessage = true;
  const r = await good.complete();
  assert.equal(r.phase, "completed");
  assert.ok((good.store.value as CorrectionState).history.includes("ee0"));
  for (const scenario of ["loss", "body", "header", "thread", "unstable"]) {
    const h = await harness();
    h.mutate = (d, op) => {
      if (op !== "history" && op !== "recheck") return;
      if (scenario === "loss")
        d.messages = d.messages.filter((m: any) => m.id !== "dd0");
      if (scenario === "body") d.messages[0].payload.body = { data: secret };
      if (scenario === "header")
        d.messages[0].payload.headers[0].value = "other@fictional.test";
      if (scenario === "thread") d.id = "222bbb";
      if (scenario === "unstable" && op === "recheck")
        d.messages.push({ ...d.messages[0], id: "ee0" });
    };
    const result = await h.complete();
    assert.equal(result.phase, "recovery_required");
    assert.equal(result.bindingVerified, false);
  }
});
test("M2 final failure prevents binding; final usage failure preserves restored identity", async () => {
  const h = await harness();
  h.fault = (op) => (op === "m2_after" ? json({}, 403) : undefined);
  const r = await h.complete();
  assert.equal(r.bindingVerified, false);
  assert.equal(r.phase, "recovery_required");
  const m = await harness();
  m.fault = (op) => (op === "usage_after" ? json({}, 403) : undefined);
  const result = await m.complete();
  assert.equal(result.bindingVerified, true);
  assert.equal(result.closureComplete, false);
  assert.equal(result.usageError, "HTTP_403");
  const count = m.calls.length;
  await m.run("correct_verify", { oauthCompleted: true });
  assert.equal(m.calls.length, count);
});
test("link timeout and persisted crash require explicit read reconciliation, never another POST", async () => {
  const h = await harness();
  h.fault = (op) => (op === "link" ? Error(secret) : undefined);
  const r = await h.run();
  assert.equal(r!.phase, "recovery_required");
  assert.equal((h.store.value as CorrectionState).link.status, "uncertain");
  await h.run("correct_prepare");
  assert.equal(h.calls.filter((c) => c.op === "link").length, 1);
  h.fault = undefined;
  const reconciled = await h.run("correct_reconcile");
  assert.equal(reconciled!.error, "AUTH_LINK_SECRET_UNAVAILABLE");
  assert.equal(reconciled!.budget.retry, 1);
  const count = h.calls.length;
  await h.run("correct_reconcile");
  assert.equal(h.calls.length, count);
  assert.equal(h.store.deliveries.length, 0);
});
test("uncertain link listing cannot accept a paginated/ambiguous/wrong owner result", async () => {
  for (const scenario of ["page", "duplicate", "owner"]) {
    const h = await harness();
    h.fault = (op) => (op === "link" ? Error(secret) : undefined);
    await h.run();
    h.fault = undefined;
    h.mutate = (d, op) => {
      if (op !== "reconcile_link") return;
      if (scenario === "page") d.next_cursor = "more";
      if (scenario === "duplicate") d.items.push(d.items[0]);
      if (scenario === "owner") d.items[0].user_id = "other";
    };
    const r = await h.run("correct_reconcile");
    assert.equal(r!.bindingVerified, false);
    assert.equal(h.store.deliveries.length, 0);
    assert.equal(h.calls.filter((c) => c.op === "link").length, 1);
  }
});
test("short/expired link and delivery failure do not trigger new links or OAuth", async () => {
  const h = await harness();
  h.shortLink = true;
  const r = await h.run();
  assert.equal(r!.error, "INVALID_AUTH_LINK");
  assert.equal(h.store.deliveries.length, 0);
  const m = await harness();
  m.store.deliveryError = true;
  const failed = await m.run();
  assert.equal(failed!.error, "PRIVATE_DELIVERY_FAILED");
  const count = m.calls.length;
  m.store.deliveryError = false;
  await m.run("correct_deliver");
  assert.equal(m.store.deliveries.length, 1);
  assert.equal(m.calls.length, count);
  const x = await harness();
  await x.prepare();
  x.clock.now += 600001;
  x.statuses = ["EXPIRED"];
  const expired = await x.run("correct_verify", { oauthCompleted: true });
  assert.equal(expired!.phase, "recovery_required");
  assert.equal(x.calls.filter((c) => c.op === "link").length, 1);
});
test("transient reads retry once; auth and POST failures never retry or leak text", async () => {
  const h = await harness();
  let attempts = 0;
  h.fault = (op) =>
    op === "config" && attempts++ === 0
      ? json({}, 429, { "retry-after": "7" })
      : undefined;
  const r = await h.run();
  assert.equal(r!.phase, "await_auth");
  assert.equal(r!.budget.retry, 1);
  assert.ok(h.clock.waits.includes(7000));
  for (const status of [401, 403, 422]) {
    const m = await harness();
    m.fault = (op) =>
      op === "config" ? json({ error: secret }, status) : undefined;
    const failed = await m.run();
    assert.equal(failed!.error, "HTTP_" + status);
    assert.equal(m.calls.filter((c) => c.op === "config").length, 1);
    const count = m.calls.length;
    await m.run();
    assert.equal(m.calls.length, count);
  }
  const post = await harness();
  post.fault = (op) => (op === "link" ? json({}, 503) : undefined);
  await post.run();
  assert.equal(post.calls.filter((c) => c.op === "link").length, 1);
});
test("changing the intended account after link delivery cannot trigger a single HTTP", async () => {
  const h = await harness();
  await h.prepare();
  const count = h.calls.length;
  await assert.rejects(
    h.run("correct_verify", { oauthCompleted: true }, addresses[1]),
    /M1_TARGET_IS_M2/,
  );
  assert.equal(h.calls.length, count);
});
test("permanent profile auth errors are not retried on a later verify command", async () => {
  const h = await harness();
  await h.prepare();
  h.oauth = true;
  h.fault = (op) =>
    op === "profile" ? json({ status: 403, data: {} }) : undefined;
  const r = await h.run("correct_verify", { oauthCompleted: true });
  assert.equal(r!.error, "UPSTREAM_403");
  const count = h.calls.length;
  await h.run("correct_verify", { oauthCompleted: true });
  assert.equal(h.calls.length, count);
  assert.equal(h.calls.filter((c) => c.op === "link").length, 1);
});
test("source/key/predecessor mutation, counters, binding and unknown fields are rejected", async () => {
  const h = await harness();
  await h.prepare();
  const state = h.store.value as CorrectionState;
  for (const mutate of [
    (s: any) => (s.calls = 0),
    (s: any) => (s.baseCalls = 0),
    (s: any) => (s.predecessor.calls = 0),
    (s: any) => (s.targetHash = secret),
    (s: any) => (s.extra = secret),
    (s: any) => (s.link.id = "ca_new2"),
    (s: any) =>
      (s.binding = {
        logicalAlias: 1,
        oldId: "ca_one",
        newId: "ca_correct",
        addressHash: s.targetHash,
        paused: true,
      }),
  ]) {
    const s = structuredClone(state);
    mutate(s);
    assert.throws(() => validateCorrection(s));
  }
  const options: CorrectionOptions = {
    execute: true,
    authorizedTotal: 97,
    correctionAuthorized: true,
    managementAuthorized: true,
    includedCallsConfirmed: true,
    gates: {
      managementPermission: true,
      operatorReady: true,
      grantIsolated: true,
      noVerifier: true,
    },
    fetchImpl: h.fetchImpl,
  };
  await assert.rejects(
    runComposioCorrection(
      { ...env, COMPOSIO_API_KEY: "rotated" },
      h.sources,
      h.store,
      "correct_prepare",
      addresses[0],
      options,
    ),
    /CONFIGURATION_CHANGED/,
  );
  h.sources.observation.clock.uncertaintyMs = 1;
  await assert.rejects(h.run(), /CONFIGURATION_CHANGED/);
});
test("disk failure before HTTP blocks it; crash after POST never repeats mutation", async () => {
  const h = await harness();
  h.store.hook = (s) => {
    if (s.link.status === "in_flight") throw Error(secret);
  };
  await assert.rejects(h.run(), /JOURNAL_WRITE_FAILED/);
  assert.equal(h.calls.filter((c) => c.op === "link").length, 0);
  const m = await harness();
  let crashed = false;
  m.store.hook = (s) => {
    if (s.requests.some((r) => r.op === "link" && r.result === "OK"))
      crashed = true;
    if (crashed) throw Error(secret);
  };
  await assert.rejects(m.run(), /JOURNAL_WRITE_FAILED/);
  assert.equal((m.store.value as CorrectionState).link.status, "in_flight");
  m.store.hook = undefined;
  await m.run();
  assert.equal(m.calls.filter((c) => c.op === "link").length, 1);
  assert.equal((m.store.value as CorrectionState).link.status, "uncertain");
});

async function temporary(work: (root: string) => Promise<void>) {
  await mkdir(resolve(".local"), { recursive: true });
  const root = await mkdtemp(resolve(".local", "s00-correction-test-"));
  try {
    await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("file migration is atomic in the same path, v1 sources immutable, old writes blocked", () =>
  temporary(async (root) => {
    const h = await harness(),
      files = reconnectFiles(root),
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
      await files.store.save(h.p);
      await writeFile(resolve(folder, "s00-m1-target-email.txt"), addresses[0]);
      const r = await runComposioCorrection(
        env,
        await files.sources(),
        files.ledgerStore,
        "correct_prepare",
        await files.targetText(),
        {
          execute: true,
          authorizedTotal: 97,
          correctionAuthorized: true,
          managementAuthorized: true,
          includedCallsConfirmed: true,
          gates: {
            managementPermission: true,
            operatorReady: true,
            grantIsolated: true,
            noVerifier: true,
          },
          clock: h.clock,
          fetchImpl: async (...args) => {
            h.store.value = (await files.ledgerStore.load())!;
            return h.fetchImpl(...args);
          },
        },
      );
      assert.equal(r!.phase, "await_auth");
      const s = await files.ledgerStore.load();
      assert.equal(s!.version, 2);
      assert.equal(
        await readFile(
          resolve(folder, "s00-composio-m1-correction-enlace.txt"),
          "utf8",
        ),
        "https://connect.composio.dev/link/" + secret + "\r\n",
      );
      await assert.rejects(files.store.load(), /CORRECTION_LEDGER_REQUIRES_V2/);
      await assert.rejects(
        files.store.save(h.p),
        /CORRECTION_HISTORY_IMMUTABLE/,
      );
      assert.deepEqual(await files.sources(), h.sources);
      assert.equal(await files.targetText(), addresses[0]);
      for (const name of [
        "s00-composio-run.json.lock",
        "s00-composio-observation.json.lock",
        "s00-composio-reconnect.json.lock",
      ])
        await stat(resolve(folder, name));
      const changed = structuredClone(s as CorrectionState);
      changed.calls = 0;
      changed.requests = [];
      changed.normal = 0;
      changed.retry = 0;
      changed.checks = {
        config: false,
        old: false,
        m2Before: false,
        active: false,
        profile: false,
        history: false,
        recheck: false,
        m2After: false,
      };
      delete changed.usageBefore;
      changed.link.status = "not_sent";
      delete changed.link.id;
      delete changed.link.url;
      delete changed.link.expiresAt;
      changed.link.delivered = false;
      await assert.rejects(files.ledgerStore.save(changed));
    });
    await assert.rejects(
      stat(resolve(folder, "s00-composio-reconnect.json.lock")),
    );
  }));
test("file input cap, absent target, locks and orphan temp are handled without overwrite", () =>
  temporary(async (root) => {
    const h = await harness(),
      files = reconnectFiles(root),
      folder = resolve(root, ".local/pipeline-os");
    await files.locked(async () => {});
    assert.equal(await files.targetText(), undefined);
    await writeFile(
      resolve(folder, "s00-m1-target-email.txt"),
      "x".repeat(513),
    );
    await assert.rejects(files.targetText(), /M1_TARGET_REQUIRED_OR_TOO_LARGE/);
    await files.store.save(h.p);
    const before = await readFile(
      resolve(folder, "s00-composio-reconnect.json"),
      "utf8",
    );
    await writeFile(resolve(folder, "s00-composio-reconnect.json.tmp"), secret);
    await h.prepare();
    await assert.rejects(
      files.ledgerStore.save(h.store.value as CorrectionState),
    );
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
    await writeFile(
      resolve(folder, "s00-composio-reconnect.json.lock"),
      secret,
    );
    await assert.rejects(
      files.locked(async () => {}),
      /JOURNAL_LOCKED/,
    );
    assert.equal(
      await readFile(
        resolve(folder, "s00-composio-reconnect.json.lock"),
        "utf8",
      ),
      secret,
    );
  }));
test("file ledger prevents changing delivered URLs/TTL, downgrading completion, and untrusted delivery hosts", () =>
  temporary(async (root) => {
    const h = await harness();
    await h.complete();
    const s = h.store.value as CorrectionState,
      files = reconnectFiles(root);
    await files.locked(async () => {});
    await files.store.save(h.p);
    await files.ledgerStore.save(s);
    for (const change of [
      (v: CorrectionState) =>
        (v.link.url = "https://connect.composio.dev/link/another"),
      (v: CorrectionState) => v.link.expiresAt!--,
      (v: CorrectionState) => (v.phase = "verifying"),
    ]) {
      const changed = structuredClone(s);
      change(changed);
      await assert.rejects(
        files.ledgerStore.save(changed),
        /CORRECTION_HISTORY_IMMUTABLE/,
      );
    }
    await assert.rejects(
      files.ledgerStore.deliver!("https://untrusted.test/link"),
      /INVALID_AUTH_LINK/,
    );
    assert.deepEqual(await files.ledgerStore.load(), validateCorrection(s));
  }));
test("CLI default cannot read credentials, upgrade or create folders; correction execution needs97 gate", () =>
  temporary(async (root) => {
    const loader = pathToFileURL(
        resolve("node_modules/tsx/dist/loader.mjs"),
      ).href,
      cli = resolve("scripts/pipeline-os/s00-composio-reconnect-cli.ts");
    const run = (args: string[] = []) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          'data:text/javascript,globalThis.fetch=async()=>{throw Error("REAL_NETWORK_FORBIDDEN")}',
          "--import",
          loader,
          cli,
          ...args,
        ],
        { cwd: root, env: { NODE_ENV: "test" }, encoding: "utf8" },
      );
    const status = run();
    assert.equal(status.status, 0);
    assert.equal(JSON.parse(status.stdout).phase, "not_started");
    await assert.rejects(stat(resolve(root, ".local")));
    const rejected = run([
      "--execute",
      "--action=correct_prepare",
      "--authorized-total=88",
    ]);
    assert.equal(
      JSON.parse(rejected.stderr).error,
      "CORRECTION_AUTHORIZATION_REQUIRED",
    );
    await assert.rejects(stat(resolve(root, ".local")));
    const h = await harness();
    await h.prepare();
    const folder = resolve(root, ".local/pipeline-os");
    await mkdir(folder, { recursive: true });
    await writeFile(
      resolve(folder, "s00-composio-reconnect.json"),
      JSON.stringify(h.store.value),
    );
    const before = await readFile(
        resolve(folder, "s00-composio-reconnect.json"),
        "utf8",
      ),
      v2 = run();
    assert.equal(v2.status, 0);
    assert.equal(JSON.parse(v2.stdout).totalCalls, 86);
    assert.equal(v2.stdout.includes(secret), false);
    assert.equal(
      await readFile(resolve(folder, "s00-composio-reconnect.json"), "utf8"),
      before,
    );
    const legacy = run([
      "--execute",
      "--action=revoke",
      "--authorized-total=88",
      "--authorize-connection-management",
      "--included-calls-confirmed",
      "--gates-confirmed",
    ]);
    assert.equal(legacy.status, 2);
    assert.equal(
      JSON.parse(legacy.stderr).error,
      "CORRECTION_LEDGER_REQUIRES_V2",
    );
  }));
test("CLI target precheck is explicit, offline, sanitized and leaves the v1 predecessor unchanged", () =>
  temporary(async (root) => {
    const h = await harness(),
      files = reconnectFiles(root),
      folder = resolve(root, ".local/pipeline-os");
    await files.locked(async () => {});
    await files.store.save(h.p);
    await writeFile(
      resolve(folder, "s00-composio-run.json"),
      JSON.stringify(h.sources.run),
    );
    await writeFile(
      resolve(folder, "s00-composio-observation.json"),
      JSON.stringify(h.sources.observation),
    );
    await writeFile(resolve(folder, "s00-m1-target-email.txt"), addresses[0]);
    const before = await readFile(
        resolve(folder, "s00-composio-reconnect.json"),
        "utf8",
      ),
      loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
      cli = resolve("scripts/pipeline-os/s00-composio-reconnect-cli.ts");
    const run = () =>
      spawnSync(
        process.execPath,
        [
          "--import",
          'data:text/javascript,globalThis.fetch=async()=>{throw Error("REAL_NETWORK_FORBIDDEN")}',
          "--import",
          loader,
          cli,
          "--action=correct_precheck",
        ],
        { cwd: root, env: { NODE_ENV: "test" }, encoding: "utf8" },
      );
    const valid = run();
    assert.equal(valid.status, 0);
    assert.equal(JSON.parse(valid.stdout).matchesM1, true);
    await writeFile(resolve(folder, "s00-m1-target-email.txt"), addresses[1]);
    const invalid = run();
    assert.equal(invalid.status, 2);
    assert.equal(JSON.parse(invalid.stderr).error, "M1_TARGET_IS_M2");
    assert.equal(
      (valid.stdout + invalid.stderr).includes("@fictional.test"),
      false,
    );
    assert.equal(
      await readFile(resolve(folder, "s00-composio-reconnect.json"), "utf8"),
      before,
    );
    await assert.rejects(
      stat(resolve(folder, "s00-composio-reconnect.json.lock")),
    );
  }));
