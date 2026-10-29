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
import { brSourceFixture } from "./fixtures/pipeline-os-instantly-b-recovery";
import {
  bEnv,
  bSecret,
  bWorkspace,
  bOther,
  bId,
  bJson,
  BClock,
  bPublicSafe,
} from "./fixtures/pipeline-os-instantly-b";
import {
  runInstantlyBRecovery,
  validateBRInputs,
  validateBRSource,
  validateBRState,
  assertBRTransition,
  brRequest,
  brReport,
  type BRState,
  type BRStore,
} from "../scripts/pipeline-os/s00-instantly-b-recovery";
import type { BDState } from "../scripts/pipeline-os/s00-instantly-b-diagnostic";
import { instantlyFiles } from "../scripts/pipeline-os/s00-instantly-files";
globalThis.fetch = async () => {
  throw Error("REAL_NETWORK_FORBIDDEN");
};
const noEnv = new Proxy(
  {},
  {
    get() {
      throw Error("ENV_FORBIDDEN");
    },
  },
);
class Memory implements BRStore {
  value: BDState | BRState;
  writes = 0;
  failAt = -1;
  constructor(source: BDState) {
    this.value = structuredClone(source);
  }
  async load() {
    return structuredClone(this.value);
  }
  async save(s: BRState) {
    if (++this.writes === this.failAt) throw Error(bSecret);
    assertBRTransition(this.value, s);
    this.value = structuredClone(s);
  }
}
async function harness() {
  const f = await brSourceFixture(),
    store = new Memory(f.inputs.source),
    clock = new BClock();
  const calls: {
    step: string;
    method: string;
    path: string;
    bucket: string;
    purpose: string;
    body: any;
    time: number;
  }[] = [];
  const h = {
    ...f,
    store,
    clock,
    calls,
    before: undefined as
      | undefined
      | ((step: string, count: number) => Response | Error | undefined),
    after: undefined as
      | undefined
      | ((
          body: any,
          step: string,
          count: number,
        ) => Response | Error | undefined),
    run: (
      opts: Parameters<typeof runInstantlyBRecovery>[3] = {},
      env: Readonly<Record<string, string | undefined>> = bEnv,
    ) =>
      runInstantlyBRecovery(env, store, h.inputs, {
        execute: true,
        authorizedNew: 22,
        authorizedTotal: 41,
        includedCallsConfirmed: true,
        manifestReviewed: true,
        clock,
        fetchImpl,
        ...opts,
      }),
  };
  const fetchImpl: typeof fetch = async (raw, init) => {
    const s = validateBRState(store.value),
      q = s.requests.at(-1)!;
    assert.equal(q.result, "IN_FLIGHT");
    assert.equal(s.calls, 20 + calls.length);
    assert.deepEqual(s.prior, h.inputs.source);
    const u = new URL(String(raw));
    assert.equal(u.origin, "https://api.instantly.ai");
    assert.equal(init?.redirect, "manual");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer " + bSecret,
    );
    assert.ok(!(init?.method === "POST" && u.pathname === "/api/v2/campaigns"));
    calls.push({
      step: q.step,
      method: init!.method!,
      path: u.pathname,
      bucket: q.bucket,
      purpose: q.purpose,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      time: clock.now(),
    });
    const count = calls.filter((c) => c.step === q.step).length,
      pre = h.before?.(q.step, count);
    if (pre instanceof Error) throw pre;
    if (pre) return pre;
    const body = h.provider.handle(String(raw), init!),
      post = h.after?.(body, q.step, count);
    if (post instanceof Error) throw post;
    return post ?? bJson(body);
  };
  return h;
}
const writes = (h: Awaited<ReturnType<typeof harness>>) =>
  h.calls.filter(
    (c) =>
      c.method === "PATCH" ||
      (c.method === "POST" && c.path === "/api/v2/leads"),
  );

test("BR-AC02 absent source and default source19 are offline without inferred budget", async () => {
  const r = await runInstantlyBRecovery(
    noEnv,
    {
      load: async () => undefined,
      save: async () => {
        throw Error("SAVE_FORBIDDEN");
      },
    },
    undefined,
  );
  assert.equal(r.calls, 0);
  assert.equal(r.sourceAvailable, false);
  const h = await harness(),
    before = JSON.stringify(h.store.value);
  const status = await runInstantlyBRecovery(noEnv, h.store, undefined);
  assert.equal(status.calls, 19);
  assert.equal(status.newCalls, 0);
  assert.equal(status.status, "not_started");
  assert.equal(h.calls.length, 0);
  assert.equal(h.store.writes, 0);
  assert.equal(JSON.stringify(h.store.value), before);
});
test("BR-AC01/02 explicit new gates, confirmations, bindings and exact source before effects", async () => {
  for (const options of [
    { authorizedNew: 21 },
    { authorizedTotal: 40 },
    { includedCallsConfirmed: false },
    { manifestReviewed: false },
  ]) {
    const h = await harness();
    await assert.rejects(h.run(options, noEnv), /BR_AUTHORIZATION_REQUIRED/);
    assert.equal(h.store.writes, 0);
  }
  for (const kind of [
    "calls",
    "status",
    "paused",
    "manifest",
    "scope",
    "key",
    "mapping",
    "controlled",
  ]) {
    const h = await harness();
    if (kind === "calls") h.inputs.source.calls = 20;
    if (kind === "status") h.inputs.source.status = "running";
    if (kind === "paused") h.inputs.source.projection!.currentPaused = false;
    if (kind === "manifest") h.inputs.manifest.subject = "CHANGED_FICTIONAL";
    if (kind === "scope")
      (h.inputs.scope as any).binding.configurationFingerprint = "f".repeat(64);
    if (kind === "mapping") h.inputs.manifest.statusMapping.pausedStatus = 1;
    if (kind === "controlled")
      h.inputs.manifest.controlledRecipientsConfirmed = false;
    await assert.rejects(
      h.run(
        {},
        kind === "key"
          ? { ...bEnv, INSTANTLY_API_KEY: "CHANGED_FICTIONAL" }
          : bEnv,
      ),
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.writes, 0);
  }
});
test("BR-AC01/04/05 normal16 requests ends35 with same campaign and immutable source19", async () => {
  const h = await harness(),
    source = structuredClone(h.inputs.source),
    r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 35);
  assert.equal(r.newCalls, 16);
  assert.equal(r.stage, 15);
  assert.equal(r.campaignCreated, false);
  assert.equal(r.bOriginalStatus, "failed");
  assert.equal(r.diagnosticStatus, "completed");
  assert.equal(r.closedNonSending, true);
  assert.equal(r.sendingSafetyCertified, false);
  assert.equal(r.sends, 0);
  assert.equal(r.paidOperations, 0);
  assert.equal(h.provider.campaign!.id, bId(30));
  assert.equal(h.provider.campaign!.status, 2);
  assert.equal(h.provider.leads.length, 2);
  assert.equal(h.provider.leads[0].payload.s00_hold, true);
  assert.equal(h.provider.leads[1].payload.s00_hold, false);
  assert.deepEqual(validateBRState(h.store.value).prior, source);
  assert.ok(bPublicSafe(r));
  for (const c of h.calls) {
    assert.ok(!/activate|resume|send|reply|verify|enrich|delete/.test(c.path));
    if (c.body?.email_list) assert.deepEqual(c.body.email_list, []);
  }
  const config = h.calls.find((c) => c.step === "configure")!.body;
  assert.equal(Object.hasOwn(config, "ai_sdr_id"), false);
  for (const c of h.calls.filter((c) => c.path === "/api/v2/leads")) {
    assert.equal(c.body.verify_leads_on_import, false);
    assert.equal(c.body.verify_leads_for_lead_finder, false);
  }
  for (let i = 1; i < h.calls.length; i++)
    assert.ok(h.calls[i].time - h.calls[i - 1].time >= 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(h.store.value, null, 2)) < 65536);
});
test("BR-AC04/06 third empty audience page gives17 normal and36 cumulative", async () => {
  const h = await harness();
  h.provider.threePages = true;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 36);
  assert.equal(r.budget.normal, 17);
  assert.equal(h.calls.filter((c) => c.step === "audience").length, 3);
});
test("BR-AC03 preflight drift and unavailable capacity stop without writes or emergency", async () => {
  for (const kind of [
    "workspace",
    "capacity",
    "active",
    "draft",
    "foreign",
    "name",
    "tenant",
    "sender",
    "reply",
    "schedule",
    "sequences",
    "audience",
    "cursor",
  ]) {
    const h = await harness();
    h.after = (x, step) => {
      if (kind === "workspace" && step === "workspace") x.id = bOther;
      if (kind === "capacity" && step === "plan")
        x.subscriptions.outreach.current_lead_count = 25000;
      if (step === "initial") {
        if (kind === "active") x.status = 1;
        if (kind === "draft") x.status = 0;
        if (kind === "foreign") x.id = bOther;
        if (kind === "name") x.name = "OTHER_FICTIONAL";
        if (kind === "tenant") x.organization = bOther;
        if (kind === "sender") x.email_list = ["other@example.invalid"];
        if (kind === "reply") delete x.stop_on_reply;
        if (kind === "schedule") x.campaign_schedule = {};
        if (kind === "sequences") x.sequences = [{}];
      }
      if (step === "empty") {
        if (kind === "audience") x.items = [{ id: bOther }];
        if (kind === "cursor") x.next_starting_after = bOther;
      }
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.status, "failed", kind);
    assert.equal(writes(h).length, 0);
    assert.equal(r.budget.hold, 0);
    assert.equal(h.provider.leads.length, 0);
  }
});
test("BR-AC08 builder excludes campaign creation/search, normal pause and unknown routing", async () => {
  const h = await harness();
  await h.run();
  const s = validateBRState(h.store.value);
  for (const step of [
    "create",
    "search",
    "pause",
    "send",
    "activate",
    "delete",
    "updateB",
  ])
    assert.throws(
      () => brRequest(s, h.inputs.manifest, step as never),
      /BR_BLOCKED_ROUTE/,
    );
  assert.throws(
    () => brRequest(s, h.inputs.manifest, "initial", { cursor: bOther }),
    /BR_BLOCKED_ROUTE/,
  );
  assert.throws(
    () => brRequest(s, h.inputs.manifest, "initial", { reconcile: true }),
    /BR_BLOCKED_ROUTE/,
  );
});
test("BR-AC06 uncertain configure/createA/createB/updateA reconcile once without duplicate writes", async () => {
  for (const target of ["configure", "createA", "createB", "updateA"]) {
    const h = await harness();
    h.after = (_, step, count) =>
      step === target && count === 1 ? Error(bSecret) : undefined;
    const r = await h.run();
    assert.equal(r.status, "completed", target);
    assert.equal(r.newCalls, 17);
    assert.equal(r.budget.reserve, 1);
    assert.equal(writes(h).filter((c) => c.step === target).length, 1);
    assert.equal(h.provider.leads.length, 2);
  }
});
test("BR-AC04 skip and ambiguous own-lead reconciliation never create replacements", async () => {
  for (const kind of ["skip", "empty", "ambiguous", "markers"]) {
    const h = await harness();
    h.after = (x, step, count) => {
      if (step === "createA" && count === 1)
        return kind === "skip" ? bJson({ skipped: true }) : Error(bSecret);
      if (step === "createA" && count === 2) {
        if (kind === "empty") x.items = [];
        if (kind === "ambiguous") x.items.push(structuredClone(x.items[0]));
        if (kind === "markers") delete x.items[0].payload.s00_run;
      }
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.status, "failed", kind);
    assert.equal(writes(h).filter((c) => c.step === "createA").length, 1);
    assert.equal(r.emergency, "verified_paused");
    assert.ok(!h.calls.some((c) => c.step === "createB"));
  }
});
test("BR-AC05 isolation and final campaign guards do not declare completion after emergency", async () => {
  for (const kind of ["A", "B", "active", "sender"]) {
    const h = await harness();
    h.after = (x, step) => {
      if (step === "updateA" && (kind === "A" || kind === "B"))
        h.provider.leads[kind === "A" ? 0 : 1].payload.unrelated = "changed";
      if (step === "final") {
        if (kind === "active") x.status = 1;
        if (kind === "sender") x.email_list = ["other@example.invalid"];
      }
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(r.closedNonSending, false);
    assert.equal(r.emergency, "verified_paused");
    assert.equal(r.budget.hold, 2);
  }
});
test("BR-AC04 audience duplicates/foreign/cursor inconsistency fail without recreating leads", async () => {
  for (const kind of ["duplicate", "foreign", "empty", "oversize"]) {
    const h = await harness();
    h.after = (x, step, count) => {
      if (step === "audience") {
        if (kind === "duplicate" && count === 2)
          x.items = [structuredClone(h.provider.leads[0])];
        if (kind === "foreign") x.items[0].id = bOther;
        if (kind === "empty") {
          x.items = [];
          delete x.next_starting_after;
        }
        if (kind === "oversize") x.items.push(structuredClone(x.items[0]));
      }
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(h.provider.leads.length, 2);
    assert.equal(writes(h).filter((c) => c.method === "POST").length, 2);
  }
});
test("BR-AC06 transient read retry/backoff and exhausted R block next write", async () => {
  const h = await harness();
  h.before = (step, count) =>
    ["workspace", "plan", "initial"].includes(step) && count === 1
      ? bJson({}, 429, { "retry-after": "6" })
      : undefined;
  const r = await h.run();
  assert.equal(r.status, "failed");
  assert.equal(r.error, "BR_RESERVE_REQUIRED");
  assert.equal(r.budget.reserve, 3);
  assert.equal(r.budget.hold, 0);
  assert.equal(writes(h).length, 0);
  assert.ok(h.clock.waits.filter((x) => x >= 6000).length >= 3);
});
test("BR-AC06 exact worst case N17/R3/H2 stops at22 new/41 total", async () => {
  const h = await harness();
  h.provider.threePages = true;
  h.before = (step, count) =>
    (["configured", "getA"].includes(step) && count === 1) || step === "final"
      ? bJson({}, 503)
      : undefined;
  const r = await h.run();
  assert.equal(r.status, "failed");
  assert.equal(r.calls, 41);
  assert.equal(r.newCalls, 22);
  assert.equal(r.budget.normal, 17);
  assert.equal(r.budget.reserve, 3);
  assert.equal(r.budget.hold, 2);
  assert.equal(r.emergency, "verified_paused");
});
test("BR-AC06 reconciliation may retry one transient read without repeating the mutation", async () => {
  const h = await harness();
  h.after = (_, step, count) =>
    step === "configure" && count === 1 ? Error(bSecret) : undefined;
  h.before = (step, count) =>
    step === "configure" && count === 2 ? bJson({}, 503) : undefined;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.budget.reserve, 2);
  assert.equal(writes(h).filter((c) => c.step === "configure").length, 1);
});
test("BR-AC06 permanent auth/payment/validation and long waits never retry blindly", async () => {
  for (const code of [400, 401, 402, 403, 404]) {
    const h = await harness();
    h.before = (step) =>
      step === "workspace" ? bJson({ message: bSecret }, code) : undefined;
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(r.newCalls, 1);
    assert.equal(writes(h).length, 0);
    assert.ok(bPublicSafe(r));
  }
  const h = await harness();
  h.before = () => bJson({}, 429, { "retry-after": "61" });
  const r = await h.run();
  assert.equal(r.error, "RETRY_WAIT_TOO_LONG");
  assert.equal(r.newCalls, 1);
});
test("BR-AC07 foreign/auth failures after mutation cannot trigger effects on returned resources", async () => {
  for (const kind of ["id", "organization", "401", "403"]) {
    const h = await harness();
    h.after = (x, step) => {
      if (step === "configured") {
        if (kind === "id" || kind === "organization") x[kind] = bOther;
        else return bJson({}, Number(kind));
      }
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(r.budget.hold, 0);
    assert.ok(!h.calls.some((c) => c.path.endsWith("/pause")));
  }
});
test("BR-AC07 emergency pause uncertainty gets one check and no repeat pause", async () => {
  const h = await harness();
  h.after = (x, step) => {
    if (step === "configured") x.stop_on_reply = false;
    if (step === "emergency_pause") return Error(bSecret);
    return undefined;
  };
  const r = await h.run();
  assert.equal(r.status, "failed");
  assert.equal(r.emergency, "verified_paused");
  assert.equal(h.calls.filter((c) => c.step === "emergency_pause").length, 1);
  assert.equal(r.budget.hold, 2);
});
test("BR-AC07 storage failure before/after HTTP preserves uncertainty without emergency or replay", async () => {
  for (const at of [1, 2, 3, 14, 15]) {
    const h = await harness();
    h.store.failAt = at;
    await assert.rejects(h.run(), /BR_STORAGE_OR_INTERNAL_FAILURE/);
    assert.ok(!h.calls.some((c) => c.step.startsWith("emergency_")));
    const before = JSON.stringify(h.store.value),
      calls = h.calls.length;
    if (h.store.value.version === 5) {
      const r = await h.run({}, noEnv);
      assert.equal(r.interruptedNeedsReview, true);
      assert.equal(h.calls.length, calls);
      assert.equal(JSON.stringify(h.store.value), before);
    }
  }
});
test("BR-AC07 abort before requests or between retry never starts another effect", async () => {
  const h = await harness(),
    abort = new AbortController();
  abort.abort();
  const r = await h.run({ signal: abort.signal });
  assert.equal(r.error, "CANCELLED");
  assert.equal(r.calls, 19);
  assert.equal(h.calls.length, 0);
  const k = await harness(),
    stop = new AbortController();
  k.before = () => {
    stop.abort();
    return bJson({}, 503);
  };
  const q = await k.run({ signal: stop.signal });
  assert.equal(q.error, "CANCELLED");
  assert.equal(q.newCalls, 1);
});
test("BR-AC01/07 terminal replay is offline and history/counters/progress cannot be rewritten", async () => {
  const h = await harness();
  await h.run();
  const before = structuredClone(h.store.value),
    count = h.calls.length,
    n = h.store.writes;
  const r = await h.run({}, noEnv);
  assert.equal(r.status, "completed");
  assert.equal(h.calls.length, count);
  assert.equal(h.store.writes, n);
  for (const change of [
    (s: BRState) => {
      s.calls = 19;
    },
    (s: BRState) => {
      s.prior.calls = 18;
    },
    (s: BRState) => {
      s.stage = 0;
    },
    (s: BRState) => {
      s.requests[0].step = "final";
    },
    (s: BRState) => {
      s.normal = 0;
    },
  ]) {
    const x = structuredClone(before) as BRState;
    change(x);
    assert.throws(() => validateBRState(x));
  }
  const other = structuredClone(before) as BRState;
  other.snapshots.A = "f".repeat(64);
  assert.throws(
    () => assertBRTransition(before, other),
    /BR_HISTORY_IMMUTABLE/,
  );
  assert.deepEqual(h.store.value, before);
  assert.ok(bPublicSafe(brReport(before as BRState)));
});
test("BR-AC01 progress and counters require durable matching operation evidence", async () => {
  const h = await harness();
  const history: BRState[] = [];
  const save = h.store.save.bind(h.store);
  h.store.save = async (s) => {
    await save(s);
    history.push(structuredClone(s));
  };
  await h.run();
  const before = history.find(
    (s) =>
      s.stage === 0 && s.requests.length === 1 && s.requests[0].result === "OK",
  )!;
  const next = structuredClone(before);
  next.calls++;
  next.normal++;
  next.requests.push({
    step: "plan",
    page: 1,
    bucket: "N",
    purpose: "normal",
    result: "IN_FLIGHT",
  });
  assert.throws(() => assertBRTransition(before, next), /BR_HISTORY_IMMUTABLE/);
  const bad = structuredClone(h.store.value) as BRState;
  bad.requests[0].result = "HTTP_401";
  assert.throws(() => validateBRState(bad), /BR_INVALID_JOURNAL/);
  const running = structuredClone(
    history.find((s) => s.stage === 0 && s.requests.length === 0)!,
  );
  running.status = "failed";
  running.error = "CANCELLED";
  running.requests = [];
  running.emergency = "verified_paused";
  assert.throws(() => validateBRState(running), /BR_INVALID_JOURNAL/);
});

async function temporary(fn: (dir: string) => Promise<void>) {
  const base = resolve(".local/pipeline-os-tests");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(resolve(base, "instant-br-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function fixtureFiles(dir: string) {
  const f = await brSourceFixture(),
    folder = resolve(dir, ".local/pipeline-os");
  await mkdir(folder, { recursive: true });
  const journal = resolve(folder, "s00-instantly-run.json");
  await writeFile(journal, JSON.stringify(f.inputs.source, null, 2) + "\n");
  await writeFile(
    resolve(folder, "s00-instantly-scope-attestation.json"),
    JSON.stringify(f.inputs.scope),
  );
  await writeFile(
    resolve(folder, "s00-instantly-b-manifest.json"),
    JSON.stringify(f.inputs.manifest),
  );
  return { ...f, folder, journal, files: instantlyFiles(dir) };
}
test("BR-AC01/07 files migrate fictional v4 only, preserve lineage and reject all legacy paths", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      before = await readFile(f.journal, "utf8"),
      saves: BRState[] = [];
    const memory = new Memory(f.inputs.source);
    await runInstantlyBRecovery(
      bEnv,
      {
        load: () => memory.load(),
        save: async (s) => {
          await memory.save(s);
          saves.push(structuredClone(s));
        },
      },
      f.inputs,
      {
        execute: true,
        authorizedNew: 22,
        authorizedTotal: 41,
        includedCallsConfirmed: true,
        manifestReviewed: true,
        clock: new BClock(),
        fetchImpl: async (raw, init) =>
          bJson(f.provider.handle(String(raw), init!)),
      },
    );
    for (const s of saves) await f.files.brStore.save(s);
    const saved = validateBRState(await f.files.allStore.load());
    assert.equal(saved.calls, 35);
    assert.equal(JSON.stringify(saved.prior, null, 2) + "\n", before);
    for (const store of [
      f.files.store,
      f.files.ledgerStore,
      f.files.bStore,
      f.files.diagnosticStore,
    ])
      await assert.rejects(store.load(), /BR_LEDGER_SUPERSEDES_BD/);
    await assert.rejects(
      f.files.allStore.save(f.inputs.source),
      /BR_LEDGER_SUPERSEDES_BD/,
    );
    const r = await runInstantlyBRecovery(
      noEnv,
      f.files.brStore,
      await f.files.brInputs(),
      {
        execute: true,
        authorizedNew: 22,
        authorizedTotal: 41,
        includedCallsConfirmed: true,
        manifestReviewed: true,
      },
    );
    assert.equal(r.calls, 35);
    assert.equal(
      (await readdir(f.folder)).filter((n) => /\.lock$|\.tmp$/.test(n)).length,
      0,
    );
  }));
test("BR-AC07 foreign locks/tmp, corrupt/oversized input stop without HTTP", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir);
    await writeFile(f.journal + ".lock", "FOREIGN");
    await assert.rejects(
      f.files.locked(async () => {}),
      /INSTANTLY_JOURNAL_LOCKED/,
    );
    assert.equal(await readFile(f.journal + ".lock", "utf8"), "FOREIGN");
    await writeFile(f.journal + ".tmp", "FOREIGN");
    // A valid initial v5 is produced by reserving no requests under the source transition.
    let first: BRState | undefined;
    await runInstantlyBRecovery(
      bEnv,
      {
        load: async () => f.inputs.source,
        save: async (s) => {
          first = s;
          throw Error("STOP_BEFORE_HTTP");
        },
      },
      f.inputs,
      {
        execute: true,
        authorizedNew: 22,
        authorizedTotal: 41,
        includedCallsConfirmed: true,
        manifestReviewed: true,
      },
    ).catch(() => {});
    assert.ok(first);
    await assert.rejects(f.files.brStore.save(first!), /EEXIST/);
    assert.equal(await readFile(f.journal + ".tmp", "utf8"), "FOREIGN");
    await writeFile(
      resolve(f.folder, "s00-instantly-b-manifest.json"),
      " ".repeat(65537),
    );
    await assert.rejects(f.files.brInputs(), /B_INPUT_FILE_INVALID_OR_MISSING/);
    await writeFile(f.journal, " ".repeat(65537));
    await assert.rejects(
      f.files.allStore.load(),
      /INSTANTLY_JOURNAL_READ_FAILED/,
    );
  }));
test("BR-AC02/08 CLI fixture-only migration, replay and invalid gates never touch real env/APIs", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      guard = resolve(dir, "provider.mjs"),
      callsFile = resolve(dir, "calls.txt");
    await writeFile(
      resolve(dir, "campaign.json"),
      JSON.stringify(f.provider.campaign),
    );
    await writeFile(
      resolve(dir, ".env.local"),
      "INSTANTLY_API_KEY=ENV_AUTOLOAD_FORBIDDEN\n",
    );
    const fixture = pathToFileURL(
      resolve("tests/fixtures/pipeline-os-instantly-b.ts"),
    ).href;
    await writeFile(
      guard,
      `import{BProvider}from '${fixture}';import{readFileSync,appendFileSync}from'node:fs';const p=new BProvider();p.campaign=JSON.parse(readFileSync('campaign.json','utf8'));globalThis.fetch=async(raw,init)=>{appendFileSync('calls.txt','HTTP\\n');if(init.method==='POST'&&new URL(String(raw)).pathname==='/api/v2/campaigns')throw Error('FORBIDDEN_CREATE');return new Response(JSON.stringify(p.handle(String(raw),init)),{headers:{'content-type':'application/json'}});};`,
    );
    const loader = pathToFileURL(
        resolve("node_modules/tsx/dist/loader.mjs"),
      ).href,
      cli = resolve("scripts/pipeline-os/s00-instantly-runner-cli.ts");
    const run = (flags: string[], env = false) =>
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
          timeout: 45000,
          env: {
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: "test",
            ...(env ? bEnv : {}),
          },
        },
      );
    const before = await readFile(f.journal, "utf8");
    for (const flags of [
      [],
      ["--phase", "B_RECOVERY"],
      ["--check-b-recovery"],
    ]) {
      const p = run(flags);
      assert.equal(p.status, 0, p.stderr);
      assert.ok(!(p.stdout + p.stderr).includes(bSecret));
    }
    for (const flags of [
      ["--phase", "B_RECOVERY", "--execute"],
      ["--check-b-recovery", "--phase", "A"],
      ["--check-b-recovery", "--execute"],
      ["--phase", "B_RECOVERY", "--authorized-new", "22"],
    ])
      assert.equal(run(flags).status, 2);
    assert.equal(await readFile(f.journal, "utf8"), before);
    await assert.rejects(readFile(callsFile), { code: "ENOENT" });
    const flags = [
        "--phase",
        "B_RECOVERY",
        "--execute",
        "--authorized-new",
        "22",
        "--authorized-total",
        "41",
        "--included-calls-confirmed",
        "--manifest-reviewed",
      ],
      p = run(flags, true);
    assert.equal(p.status, 0, p.stderr);
    const report = JSON.parse(p.stdout);
    assert.equal(report.calls, 35);
    assert.equal(report.status, "completed");
    assert.ok(bPublicSafe(report));
    const saved = await readFile(f.journal, "utf8");
    assert.equal(run(flags).status, 0);
    assert.equal(run([]).status, 0);
    assert.equal(run(["--phase", "B_DIAGNOSTIC"]).status, 2);
    assert.equal(await readFile(f.journal, "utf8"), saved);
    assert.equal(
      (await readFile(callsFile, "utf8")).trim().split("\n").length,
      16,
    );
    assert.equal(
      (await readdir(f.folder)).filter((n) => /\.lock$|\.tmp$/.test(n)).length,
      0,
    );
  }));
