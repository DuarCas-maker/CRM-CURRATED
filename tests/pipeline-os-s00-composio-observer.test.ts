import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  stat,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  composioConfiguration,
  hash,
  composioJson,
} from "../scripts/pipeline-os/s00-composio-common";
import {
  observeComposio,
  observationReport,
  validateObservation,
  type ObservationState,
  type ObservationStore,
  type ObservationClock,
} from "../scripts/pipeline-os/s00-composio-observer";
import { observationFiles } from "../scripts/pipeline-os/s00-composio-observer-files";
import { type RunState } from "../scripts/pipeline-os/s00-composio-runner";

const sentinel = "private-observer-sentinel",
  base = Date.UTC(2026, 9, 26, 12);
const env = {
  COMPOSIO_API_KEY: sentinel,
  COMPOSIO_AUTH_CONFIG_ID: "ac_fixture",
  COMPOSIO_CONNECTED_ACCOUNT_1_ID: "ca_first",
  COMPOSIO_CONNECTED_ACCOUNT_2_ID: "ca_second",
  S00_TEST_RECIPIENT_EMAIL: "recipient@fictional.test",
};
const addresses = ["first@fictional.test", "second@fictional.test"],
  threads = ["111aaa", "222bbb"];
const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
function sourceFixture(): RunState {
  const c = composioConfiguration(env),
    attachments = [
      { bytes: 5, sha256: hash("%PDF-") },
      { bytes: 6, sha256: hash("%PDF-x") },
    ];
  return {
    version: 1,
    phase: "prepared",
    fingerprint: c.fingerprint,
    targetFingerprint: c.targetFingerprint,
    token: "aabbcc001122",
    calls: 33,
    priorDiagnosticCalls: 4,
    profilesVerified: true,
    includedCallsConfirmed: true,
    attachmentPolicy: "provided_pdfs_10mb",
    boxes: ([1, 2] as const).map((alias, i) => ({
      alias,
      owner: "owner-" + i,
      addressHash: hash(addresses[i]),
      polls: 3,
      initial: { status: "sent", id: "aa" + i, threadId: threads[i] },
      confirmation: { status: "sent", id: "bb" + i, threadId: threads[i] },
      confirmationVerified: true,
      response: {
        id: "cc" + i,
        attachmentHash: hash(JSON.stringify(attachments)),
        detectedAt: new Date(base - 1000).toISOString(),
        receivedAt: base - 2000,
        verification: "provided_pdfs",
        attachments,
      },
    })),
  };
}
class Memory implements ObservationStore {
  value?: ObservationState;
  writes = 0;
  hook?: (s: ObservationState) => void;
  async load() {
    return this.value ? structuredClone(this.value) : undefined;
  }
  async save(s: ObservationState) {
    this.hook?.(s);
    this.value = structuredClone(s);
    this.writes++;
  }
}
class Clock implements ObservationClock {
  mono = 0;
  skew = 0;
  oversleep = 0;
  waits: number[] = [];
  afterSleep?: () => void;
  wallNow = () => base + this.mono + this.skew;
  monoNow = () => this.mono;
  async sleep(ms: number, signal?: AbortSignal) {
    assert.ok(ms >= 0);
    if (signal?.aborted) throw Error(sentinel);
    this.waits.push(ms);
    this.mono += ms + this.oversleep;
    this.afterSleep?.();
  }
}
function harness() {
  const source = sourceFixture(),
    store = new Memory(),
    clock = new Clock();
  const arrivals: (number | undefined)[] = [undefined, undefined],
    calls: { kind: string; alias: number | undefined; body: any }[] = [];
  let ready = 0;
  const h = {
    source,
    store,
    clock,
    arrivals,
    calls,
    ready: () => ready,
    fault: undefined as
      | undefined
      | ((
          kind: string,
          alias: number | undefined,
          n: number,
        ) => Response | Error | undefined),
    alter: undefined as
      | undefined
      | ((data: any, kind: string, alias: number | undefined) => void),
    onReady: () => {
      for (let i = 0; i < 2; i++) arrivals[i] = clock.wallNow() + 20_000;
    },
    fetchImpl: undefined as unknown as typeof fetch,
    run: (opts: Parameters<typeof observeComposio>[3] = {}) =>
      observeComposio(env, source, store, {
        execute: true,
        authorizedTotal: 77,
        includedCallsConfirmed: true,
        clock,
        clockEvidence: { synchronized: true, uncertaintyMs: 1 },
        fetchImpl: h.fetchImpl,
        onReady: () => {
          ready++;
          h.onReady();
        },
        ...opts,
      }),
  };
  const subject = (i: number) =>
    "[S00 TEST] S00-COMPOSIO-" + source.token + "-M" + (i + 1);
  function message(i: number, id: string, inbound: boolean, at: number) {
    return {
      id,
      threadId: threads[i],
      internalDate: String(at),
      payload: {
        headers: [
          {
            name: "From",
            value: inbound ? env.S00_TEST_RECIPIENT_EMAIL : addresses[i],
          },
          {
            name: "To",
            value: inbound ? addresses[i] : env.S00_TEST_RECIPIENT_EMAIL,
          },
          { name: "Subject", value: (inbound ? "Re: " : "") + subject(i) },
          { name: "Message-ID", value: "<" + id + "@fictional.test>" },
        ],
      },
    };
  }
  h.fetchImpl = async (input, init) => {
    const url = String(input),
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const trace = store.value!.requests.at(-1)!;
    assert.equal(trace.result, "IN_FLIGHT");
    assert.equal(store.value!.calls, calls.length + 1);
    assert.ok(store.value!.calls <= 40);
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get("x-api-key"), sentinel);
    const { op: kind, alias } = trace;
    calls.push({ kind, alias, body });
    clock.mono += 5;
    const fault = h.fault?.(kind, alias, calls.length);
    if (fault instanceof Error) throw fault;
    if (fault) return fault;
    let data: any;
    if (url.endsWith("project/usage/summary")) {
      assert.equal(init?.method, "POST");
      assert.deepEqual(body, {});
      data = { instant_charge: "0" };
    } else if (url.endsWith("auth_configs/ac_fixture"))
      data = {
        id: "ac_fixture",
        toolkit: { slug: "gmail" },
        credentials: {
          scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        },
      };
    else if (url.includes("connected_accounts/")) {
      assert.equal(init?.method, "GET");
      const i = alias! - 1;
      data = {
        id: i ? "ca_second" : "ca_first",
        toolkit: { slug: "gmail" },
        status: "ACTIVE",
        user_id: "owner-" + i,
        auth_config: { id: "ac_fixture" },
        state: { val: { displayName: addresses[i] } },
      };
    } else {
      assert.equal(
        url,
        "https://backend.composio.dev/api/v3.1/tools/execute/proxy",
      );
      assert.equal(init?.method, "POST");
      assert.equal(body.method, "GET");
      assert.equal(body.user_id, "owner-" + (alias! - 1));
      assert.equal(
        body.connected_account_id,
        alias === 1 ? "ca_first" : "ca_second",
      );
      assert.equal(body.body, undefined);
      const endpoint = new URL(body.endpoint),
        i = alias! - 1;
      assert.equal(endpoint.origin, "https://gmail.googleapis.com");
      if (endpoint.pathname.endsWith("/profile"))
        data = { emailAddress: addresses[i] };
      else {
        assert.equal(
          endpoint.pathname,
          "/gmail/v1/users/me/threads/" + threads[i],
        );
        assert.equal(endpoint.searchParams.get("format"), "metadata");
        assert.equal(
          endpoint.searchParams.get("fields"),
          "id,messages(id,threadId,internalDate,payload(headers))",
        );
        assert.deepEqual(endpoint.searchParams.getAll("metadataHeaders"), [
          "From",
          "To",
          "Subject",
          "Message-ID",
          "In-Reply-To",
          "References",
        ]);
        data = {
          id: threads[i],
          messages: [
            message(i, "aa" + i, false, base - 5000),
            message(i, "cc" + i, true, base - 4000),
            message(i, "bb" + i, false, base - 3000),
          ],
        };
        if (
          kind !== "baseline" &&
          arrivals[i] !== undefined &&
          clock.wallNow() >= arrivals[i]!
        )
          data.messages.push(message(i, "dd" + i, true, arrivals[i]!));
      }
      h.alter?.(data, kind, alias);
      return json({ status: 200, data });
    }
    h.alter?.(data, kind, alias);
    return json(data);
  };
  return h;
}

test("observer defaults offline with no config, source, writes, timer or network", async () => {
  const h = harness();
  const report = await observeComposio({}, undefined, h.store, {
    fetchImpl: async () => {
      throw Error(sentinel);
    },
    clock: h.clock,
  });
  assert.equal(report.phase, "not_started");
  assert.equal(report.totalCalls, 37);
  assert.equal(h.store.writes, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.clock.waits.length, 0);
});
test("explicit expanded budget and included calls are required before config or writes", async () => {
  for (const opts of [
    { authorizedTotal: 40 },
    { authorizedTotal: 76 },
    { includedCallsConfirmed: false },
  ]) {
    const h = harness();
    await assert.rejects(h.run(opts), /OBSERVATION_AUTHORIZATION_REQUIRED/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.writes, 0);
  }
});
test("completed source, historic total, config and destination cannot change", async () => {
  for (const alter of [
    (s: RunState) => {
      s.calls = 32;
    },
    (s: RunState) => {
      s.boxes[0].confirmationVerified = false;
    },
    (s: RunState) => {
      s.fingerprint = hash("other");
    },
  ]) {
    const h = harness();
    alter(h.source);
    await assert.rejects(h.run());
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.writes, 0);
  }
});
test("A-AC01/02/03: two metadata-only responses detected by same timer without ACK or attachments", async () => {
  const h = harness(),
    before = structuredClone(h.source);
  const r = await h.run();
  assert.equal(r.phase, "completed");
  assert.equal(h.ready(), 1);
  assert.equal(r.samples, 2);
  assert.equal(r.newCalls, 15);
  assert.equal(r.totalCalls, 52);
  assert.ok(
    r.mailboxes.every(
      (b) =>
        b.eventCount === 1 &&
        b.duplicateCheck &&
        b.latencyAcceptance === "pass",
    ),
  );
  assert.equal(r.p50Ms, 10_005);
  assert.equal(r.p95Ms, 10_010);
  assert.equal(r.maxMs, r.p95Ms);
  assert.equal(h.clock.waits.length, 1);
  assert.equal(r.apiMessagesSent, 0);
  assert.equal(r.attachmentsDownloaded, 0);
  assert.equal(r.crmReceptionProven, false);
  assert.deepEqual(h.source, before);
  const report = JSON.stringify(r),
    journal = JSON.stringify(h.store.value);
  for (const secret of [
    sentinel,
    "fictional.test",
    "owner-",
    "ca_first",
    "aa0",
    "111aaa",
    "aabbcc001122",
  ]) {
    assert.ok(!report.includes(secret));
  }
  assert.ok(!journal.includes(sentinel));
  assert.ok(!journal.includes("fictional.test"));
  assert.ok(!journal.includes("headers"));
});
test("13 request minimum, without hidden send or extra profile calls", async () => {
  const h = harness();
  h.onReady = () => {
    h.arrivals.fill(h.clock.wallNow());
  };
  const r = await h.run();
  assert.equal(r.newCalls, 13);
  assert.deepEqual(
    h.calls.map((c) => c.kind),
    [
      "usage_before",
      "config",
      "connection",
      "profile",
      "connection",
      "profile",
      "baseline",
      "baseline",
      "poll",
      "poll",
      "recheck",
      "recheck",
      "usage_after",
    ],
  );
});
test("35 normal maximum and 40 including five shared transient retries", async () => {
  const h = harness();
  h.onReady = () => h.arrivals.fill(h.clock.wallNow() + 329_000);
  const faults: Record<string, number> = {
    usage_before: 2,
    config: 2,
    connection: 1,
  };
  h.fault = (kind) => {
    if (faults[kind] > 0) {
      faults[kind]--;
      return json({}, 503);
    }
    return undefined;
  };
  const r = await h.run();
  assert.equal(r.phase, "completed");
  assert.equal(r.newCalls, 40);
  assert.equal(r.totalCalls, 77);
  assert.equal(r.retries, 5);
  assert.ok(r.mailboxes.every((b) => b.polls === 12));
  assert.equal(h.calls.length, 40);
});
test("one detected mailbox stops polling independently of the other", async () => {
  const h = harness();
  h.onReady = () => {
    h.arrivals[0] = h.clock.wallNow();
    h.arrivals[1] = h.clock.wallNow() + 95_000;
  };
  const r = await h.run();
  assert.equal(r.phase, "completed");
  assert.deepEqual(
    r.mailboxes.map((b) => b.polls),
    [1, 5],
  );
});
test("no response means bounded twelve rounds, no duplicate checks and explicit failure", async () => {
  const h = harness();
  h.onReady = () => {};
  const r = await h.run();
  assert.equal(r.phase, "blocked");
  assert.equal(r.error, "RESPONSES_NOT_OBSERVED");
  assert.equal(r.newCalls, 33);
  assert.equal(r.samples, 0);
  assert.deepEqual(
    r.mailboxes.map((b) => b.polls),
    [12, 12],
  );
  assert.equal(h.calls.filter((c) => c.kind === "recheck").length, 0);
});
test("latency exceeding 60s fails target while still proving functional reception", async () => {
  const h = harness();
  h.onReady = () => h.arrivals.fill(h.clock.wallNow());
  let delayed = false;
  h.store.hook = (s) => {
    if (s.boxes[0].event && !delayed) {
      h.clock.mono += 60_000;
      delayed = true;
    }
  };
  const r = await h.run();
  assert.equal(r.samples, 2);
  assert.ok(r.mailboxes.every((b) => b.latencyAcceptance === "fail"));
  assert.ok(r.mailboxes.every((b) => b.latencyMs! > 60_000));
});
test("clock evidence missing or uncertain prevents latency acceptance", async () => {
  for (const evidence of [
    { synchronized: false, uncertaintyMs: null },
    { synchronized: true, uncertaintyMs: 2001 },
  ]) {
    const h = harness();
    const r = await h.run({ clockEvidence: evidence });
    assert.equal(r.samples, 2);
    assert.ok(
      r.mailboxes.every((b) => b.latencyAcceptance === "indeterminate"),
    );
  }
});
test("a slightly future provider timestamp cannot pass as negative latency", async () => {
  const h = harness();
  h.onReady = () => h.arrivals.fill(h.clock.wallNow());
  h.alter = (v, kind) => {
    if (kind === "poll" || kind === "recheck")
      v.messages.at(-1).internalDate = String(h.store.value!.armedAt! + 1000);
  };
  const r = await h.run();
  assert.equal(r.samples, 2);
  assert.ok(
    r.mailboxes.every(
      (b) => b.latencyMs! < 0 && b.latencyAcceptance === "indeterminate",
    ),
  );
});
test("upstream throttling honors Retry-After and upstream auth is not retried", async () => {
  const h = harness();
  let once = false;
  h.fault = (kind) => {
    if (kind === "poll" && !once) {
      once = true;
      return json({ status: 429, headers: { "Retry-After": "9" }, data: {} });
    }
  };
  const r = await h.run();
  assert.equal(r.phase, "completed");
  assert.equal(r.retries, 1);
  assert.ok(h.clock.waits.includes(9000));
  const auth = harness();
  auth.fault = (kind) =>
    kind === "profile" ? json({ status: 401, data: {} }) : undefined;
  const bad = await auth.run();
  assert.equal(bad.error, "UPSTREAM_401");
  assert.equal(bad.retries, 0);
  assert.equal(bad.usageAfter, null);
});
test("exhausted retry reserve cannot consume a forty-first call for final usage", async () => {
  const h = harness(),
    faults: Record<string, number> = {
      usage_before: 2,
      config: 2,
      connection: 1,
    };
  h.onReady = () => h.arrivals.fill(h.clock.wallNow() + 329_000);
  h.fault = (kind) => {
    if (faults[kind] > 0) {
      faults[kind]--;
      return json({}, 503);
    }
    if (kind === "usage_after") return json({}, 503);
  };
  const r = await h.run();
  assert.equal(r.newCalls, 40);
  assert.equal(h.calls.length, 40);
  assert.equal(r.totalCalls, 77);
  assert.equal(r.usageError, "HTTP_503");
  assert.equal(r.samples, 2);
});
test("poll retry cannot pass the six-minute deadline", async () => {
  const h = harness();
  h.onReady = () => {};
  h.fault = (kind) =>
    kind === "poll" && h.store.value!.rounds === 12
      ? json({}, 429, { "retry-after": "30" })
      : undefined;
  const r = await h.run();
  assert.equal(r.error, "RETRY_EXCEEDS_DEADLINE");
  assert.equal(r.retries, 0);
  assert.equal(r.samples, 0);
  assert.equal(h.calls.at(-1)!.kind, "usage_after");
});
test("closing reads can finish after observation window without restarting polling", async () => {
  const h = harness();
  h.onReady = () => h.arrivals.fill(h.clock.wallNow());
  let delayed = false;
  h.fault = (kind) => {
    if (kind === "recheck" && !delayed) {
      delayed = true;
      h.clock.mono += 361_000;
      return json({}, 503);
    }
  };
  const r = await h.run();
  assert.equal(r.phase, "completed");
  assert.equal(r.retries, 1);
  assert.deepEqual(
    r.mailboxes.map((b) => b.polls),
    [1, 1],
  );
});
test("clock skew and suspended scheduler are reported indeterminate, not catch-up bursts", async () => {
  const h = harness();
  h.clock.oversleep = 65_000;
  h.clock.afterSleep = () => {
    h.clock.skew = 5000;
  };
  const r = await h.run();
  assert.equal(r.samples, 2);
  assert.ok(r.mailboxes.every((b) => b.latencyAcceptance === "indeterminate"));
  assert.equal(r.rounds, 4);
  assert.ok(r.mailboxes.every((b) => b.polls === 2));
});
test("wrong thread, headers, metadata body or missing internalDate cannot yield samples", async () => {
  for (const change of [
    (v: any) => {
      v.id = "dead";
    },
    (v: any) => {
      v.messages[0].threadId = "dead";
    },
    (v: any) => {
      v.messages[0].payload.headers[0].value = "other@fictional.test";
    },
    (v: any) => {
      v.messages[0].payload.body = { data: sentinel };
    },
    (v: any) => {
      delete v.messages[0].internalDate;
    },
    (v: any) => {
      v.snippet = sentinel;
    },
    (v: any) => {
      v.messages.push(v.messages[0]);
    },
  ]) {
    const h = harness();
    h.alter = (v, kind) => {
      if (kind === "baseline") change(v);
    };
    const r = await h.run();
    assert.equal(r.phase, "blocked");
    assert.equal(r.samples, 0);
    assert.equal(h.ready(), 0);
    assert.ok(!JSON.stringify(r).includes(sentinel));
  }
});
test("new reply wrong recipient, subject or two candidates is rejected", async () => {
  for (const change of [
    (v: any) => {
      v.messages.at(-1).payload.headers[1].value = addresses[1];
    },
    (v: any) => {
      v.messages.at(-1).payload.headers[2].value = "different";
    },
    (v: any) => {
      v.messages.push({ ...v.messages.at(-1), id: "ee0" });
    },
  ]) {
    const h = harness();
    h.alter = (v, kind, alias) => {
      if (kind === "poll" && alias === 1 && v.messages.length === 4) change(v);
    };
    const r = await h.run();
    assert.equal(r.phase, "blocked");
    assert.equal(r.samples, 0);
  }
});
test("a new response dated before READY is not substituted for a new sample", async () => {
  const h = harness();
  h.onReady = () => h.arrivals.fill(h.clock.wallNow() - 1);
  const r = await h.run();
  assert.equal(r.error, "REPLY_TIME_OUTSIDE_WINDOW");
  assert.equal(r.samples, 0);
});
test("connection ownership and effective profile mismatch stop before READY", async () => {
  for (const kind of ["connection", "profile", "config"]) {
    const h = harness();
    h.alter = (v, k) => {
      if (k === kind) {
        v.user_id = "other";
        v.emailAddress = "other@fictional.test";
        v.enabled = false;
      }
    };
    const r = await h.run();
    assert.equal(r.phase, "blocked");
    assert.equal(h.ready(), 0);
    assert.equal(h.calls.filter((c) => c.kind === "baseline").length, 0);
  }
});
test("A-AC05 completed replay including restart has zero writes, timers or HTTP", async () => {
  const h = harness();
  const first = await h.run(),
    snapshot = structuredClone(h.store.value),
    writes = h.store.writes,
    calls = h.calls.length;
  const second = await h.run({
    fetchImpl: async () => {
      throw Error("REPLAY_NETWORK");
    },
  });
  assert.deepEqual(second, first);
  assert.deepEqual(h.store.value, snapshot);
  assert.equal(h.store.writes, writes);
  assert.equal(h.calls.length, calls);
});
test("A-AC06 interrupted active state cannot rearm, reset budget or implicitly resume", async () => {
  const h = harness();
  await h.run();
  h.store.value!.phase = "armed";
  const previous = structuredClone(h.store.value!);
  const r = await h.run();
  assert.equal(r.phase, "interrupted");
  assert.equal(r.error, "INTERRUPTED_REQUIRES_REVIEW");
  assert.equal(r.newCalls, previous.calls);
  assert.equal(h.ready(), 1);
  assert.deepEqual(h.store.value!.boxes, previous.boxes);
});
test("disk failure before a request prevents HTTP; commit failure never reports success", async () => {
  const h = harness();
  h.store.hook = (s) => {
    if (s.calls === 1) throw Error(sentinel);
  };
  await assert.rejects(h.run(), /JOURNAL_WRITE_FAILED/);
  assert.equal(h.calls.length, 0);
  const second = harness();
  second.store.hook = (s) => {
    if (s.boxes[0].event) throw Error(sentinel);
  };
  await assert.rejects(second.run(), /JOURNAL_WRITE_FAILED/);
  assert.equal(second.store.value!.boxes[0].event, undefined);
  const third = harness();
  third.store.hook = (s) => {
    if (s.boxes[0].event?.persistedAt) throw Error(sentinel);
  };
  await assert.rejects(third.run(), /JOURNAL_WRITE_FAILED/);
  assert.equal(observationReport(third.store.value).samples, 0);
});
test("401/403 are never retried and do not trigger final usage after invalid authentication", async () => {
  for (const status of [401, 403]) {
    const h = harness();
    h.fault = () => json({ secret: sentinel }, status);
    const r = await h.run();
    assert.equal(r.newCalls, 1);
    assert.equal(r.retries, 0);
    assert.equal(r.error, "HTTP_" + status);
  }
});
test("Retry-After is honored and bounded; 404 is not retried", async () => {
  const h = harness();
  let failed = false;
  h.fault = (kind) => {
    if (kind === "poll" && !failed) {
      failed = true;
      return json({}, 429, { "retry-after": "7" });
    }
  };
  const r = await h.run();
  assert.equal(r.phase, "completed");
  assert.equal(r.retries, 1);
  assert.ok(h.clock.waits.includes(7000));
  const late = harness();
  late.fault = (kind) =>
    kind === "poll" ? json({}, 429, { "retry-after": "999" }) : undefined;
  const lr = await late.run();
  assert.equal(lr.error, "RETRY_EXCEEDS_DEADLINE");
  assert.equal(lr.retries, 0);
  const missing = harness();
  missing.fault = (kind) => (kind === "baseline" ? json({}, 404) : undefined);
  const mr = await missing.run();
  assert.equal(mr.retries, 0);
  assert.equal(mr.error, "HTTP_404");
});
test("network retries count every attempt and stop after two per operation", async () => {
  const h = harness();
  h.fault = () => Error(sentinel);
  const r = await h.run();
  assert.equal(r.phase, "blocked");
  assert.equal(r.retries, 4);
  assert.equal(r.newCalls, 6); // Three attempts initial + three final usage.
  assert.equal(r.error, "NETWORK_OR_TIMEOUT");
  assert.equal(r.usageError, "NETWORK_OR_TIMEOUT");
  assert.ok(!JSON.stringify(r).includes(sentinel));
});
test("cancellation terminates waits, preserves counters and does not call final usage", async () => {
  const h = harness(),
    controller = new AbortController();
  h.clock.afterSleep = () => controller.abort();
  const r = await h.run({ signal: controller.signal });
  assert.equal(r.phase, "interrupted");
  assert.equal(r.error, "CANCELLED");
  assert.equal(h.calls.filter((c) => c.kind === "usage_after").length, 0);
});
test("recheck mismatch fails without changing the first observation times", async () => {
  const h = harness();
  h.alter = (v, kind) => {
    if (kind === "recheck")
      v.messages.at(-1).internalDate = String(
        Number(v.messages.at(-1).internalDate) + 1,
      );
  };
  const r = await h.run();
  assert.equal(r.error, "RECHECK_MISMATCH");
  assert.equal(r.samples, 2);
  assert.ok(r.mailboxes.every((b) => !b.duplicateCheck));
});
test("missing final usage is reported separately from successful reception", async () => {
  const h = harness();
  h.fault = (kind) => (kind === "usage_after" ? json({}, 403) : undefined);
  const r = await h.run();
  assert.equal(r.phase, "completed");
  assert.equal(r.samples, 2);
  assert.equal(r.usageAfter, null);
  assert.equal(r.usageError, "HTTP_403");
});
test("journal corruption and changed source are rejected without exposing values", async () => {
  const h = harness();
  await h.run();
  for (const change of [
    (s: any) => {
      s.calls = 0;
    },
    (s: any) => {
      s.historicalCalls = 0;
    },
    (s: any) => {
      s.boxes[0].event.id = "aa0";
    },
    (s: any) => {
      s.private = sentinel;
    },
  ]) {
    const s = structuredClone(h.store.value);
    change(s);
    assert.throws(() => validateObservation(s), /INVALID_OBSERVATION_JOURNAL/);
  }
  h.source.boxes[0].polls = 4;
  await assert.rejects(h.run(), /CONFIGURATION_CHANGED/);
});
test("shared transport is bounded, fixed-host and refuses redirect or malformed JSON", async () => {
  await assert.rejects(
    composioJson(
      async () => {
        throw Error("MUTATION_MUST_NOT_FETCH");
      },
      sentinel,
      "auth_configs/ac_fixture",
      "POST",
      {},
    ),
    /BLOCKED_ROUTE/,
  );
  for (const response of [
    new Response("secret", { status: 302 }),
    new Response("not json", {
      headers: { "content-type": "application/json" },
    }),
    json({ pad: "x".repeat(2_100_001) }),
  ]) {
    await assert.rejects(
      composioJson(
        async () => response,
        sentinel,
        "project/usage/summary",
        "POST",
        {},
      ),
    );
  }
  await assert.rejects(
    composioJson(
      async () => {
        throw Error("SHOULD_NOT_FETCH");
      },
      sentinel,
      "https://other.invalid/",
      "GET",
    ),
    /BLOCKED_ROUTE/,
  );
});

// AppContainer temp denies rename; workspace fixtures exercise real atomic writes.
async function temporary(run: (root: string) => Promise<void>) {
  await mkdir(resolve(".local"), { recursive: true });
  const root = await mkdtemp(resolve(".local", "s00-observer-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("file store atomic save, source lock and existing orphan temp are guarded", () =>
  temporary(async (root) => {
    const h = harness();
    await h.run();
    const files = observationFiles(root);
    await files.locked(async () => {
      await files.store.save(h.store.value!);
      assert.deepEqual(
        await files.store.load(),
        JSON.parse(JSON.stringify(h.store.value)),
      );
      await assert.rejects(
        files.locked(async () => {}),
        /JOURNAL_LOCKED/,
      );
    });
    const folder = resolve(root, ".local/pipeline-os");
    await writeFile(
      resolve(folder, "s00-composio-observation.json.tmp"),
      sentinel,
    );
    await assert.rejects(files.locked(() => files.store.save(h.store.value!)));
    assert.equal(
      await readFile(
        resolve(folder, "s00-composio-observation.json.tmp"),
        "utf8",
      ),
      sentinel,
    );
    assert.deepEqual(
      await files.store.load(),
      JSON.parse(JSON.stringify(h.store.value)),
    );
    await assert.rejects(stat(resolve(folder, "s00-composio-run.json.lock")));
  }));
test("both locks are released on work failure and unrelated locks remain intact", () =>
  temporary(async (root) => {
    const files = observationFiles(root),
      folder = resolve(root, ".local/pipeline-os");
    await assert.rejects(
      files.locked(async () => {
        throw Error(sentinel);
      }),
    );
    await files.locked(async () => {});
    const lock = resolve(folder, "s00-composio-observation.json.lock");
    await writeFile(lock, sentinel);
    await assert.rejects(
      files.locked(async () => {}),
      /JOURNAL_LOCKED/,
    );
    assert.equal(await readFile(lock, "utf8"), sentinel);
    await assert.rejects(stat(resolve(folder, "s00-composio-run.json.lock")));
  }));
test("observer CLI is offline without env autoload/mkdir and sanitizes arguments", () =>
  temporary(async (root) => {
    await writeFile(resolve(root, ".env.local"), "PRIVATE=" + sentinel);
    await writeFile(
      resolve(root, "guard.mjs"),
      "globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};",
    );
    const cli = resolve("scripts/pipeline-os/s00-composio-observer-cli.ts"),
      loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
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
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, COMPOSIO_API_KEY: sentinel },
        },
      );
    const status = run([]);
    assert.equal(status.status, 0);
    assert.equal(JSON.parse(status.stdout).phase, "not_started");
    await assert.rejects(stat(resolve(root, ".local")));
    for (const args of [
      ["--execute"],
      ["--" + sentinel],
      ["--execute", "--authorized-total=40", "--included-calls-confirmed"],
    ]) {
      const result = run(args);
      assert.equal(result.status, 2);
      assert.ok(!result.stderr.includes(sentinel));
      assert.ok(!result.stdout.includes(sentinel));
    }
    await assert.rejects(stat(resolve(root, ".local")));
  }));
test("old CLI rejects network actions once an observation ledger exists", () =>
  temporary(async (root) => {
    const folder = resolve(root, ".local/pipeline-os");
    await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, "s00-composio-observation.json"), "{}");
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
      "OBSERVATION_LEDGER_SUPERSEDES_RUNNER",
    );
    assert.equal(
      await readFile(resolve(folder, "s00-composio-observation.json"), "utf8"),
      "{}",
    );
  }));
