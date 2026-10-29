import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { setImmediate as turn } from "node:timers/promises";
import {
  runInstantlyB,
  validateBState,
  validateBInputs,
  validateBManifest,
  assertBTransition,
  bRequest,
  type BState,
  type BStore,
} from "../scripts/pipeline-os/s00-instantly-b";
import { instantlyFiles } from "../scripts/pipeline-os/s00-instantly-files";
import { type InstantlyRecovery } from "../scripts/pipeline-os/s00-instantly-recovery";
import { hash } from "../scripts/pipeline-os/s00-composio-common";
import { instantlyTrialJson } from "../scripts/pipeline-os/s00-instantly-runner";
import {
  bSourceFixture,
  bEnv,
  bSecret,
  bWorkspace,
  bOther,
  bId,
  bJson,
  BClock,
  BProvider,
  bPublicSafe,
} from "./fixtures/pipeline-os-instantly-b";
globalThis.fetch = async () => {
  throw Error("REAL_NETWORK_FORBIDDEN");
};
class Memory implements BStore {
  value: InstantlyRecovery | BState;
  writes = 0;
  failAt = -1;
  constructor(source: InstantlyRecovery) {
    this.value = structuredClone(source);
  }
  async load() {
    return structuredClone(this.value);
  }
  async save(s: BState) {
    this.writes++;
    if (this.writes === this.failAt) throw Error(bSecret);
    assertBTransition(this.value, s);
    this.value = structuredClone(s);
  }
}
async function harness() {
  const inputs = await bSourceFixture(),
    store = new Memory(inputs.prior),
    clock = new BClock(),
    provider = new BProvider();
  const calls: {
    step: string;
    bucket: string;
    purpose: string;
    method: string;
    url: string;
    body: any;
    time: number;
  }[] = [];
  const h = {
    inputs,
    store,
    clock,
    provider,
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
    run: (opts: Parameters<typeof runInstantlyB>[3] = {}, env = bEnv) =>
      runInstantlyB(env, store, h.inputs, {
        execute: true,
        authorizedNew: 25,
        authorizedTotal: 36,
        includedCallsConfirmed: true,
        manifestReviewed: true,
        fetchImpl,
        clock,
        ...opts,
      }),
  };
  const fetchImpl: typeof fetch = async (raw, init) => {
    const s = store.value as BState,
      q = s.requests.at(-1)!;
    assert.equal(s.version, 3);
    assert.equal(q.result, "IN_FLIGHT");
    assert.equal(s.calls, 11 + calls.length + 1);
    assert.deepEqual(s.prior, h.inputs.prior);
    assert.equal(init?.redirect, "manual");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer " + bSecret,
    );
    calls.push({
      step: q.step,
      bucket: q.bucket,
      purpose: q.purpose,
      method: init!.method!,
      url: String(raw),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      time: clock.now(),
    });
    const count = calls.filter((c) => c.step === q.step).length,
      pre = h.before?.(q.step, count);
    if (pre instanceof Error) throw pre;
    if (pre) return pre;
    const body = provider.handle(String(raw), init!),
      post = h.after?.(body, q.step, count);
    if (post instanceof Error) throw post;
    if (post) return post;
    return bJson(body);
  };
  return h;
}

test("B-AC01/02 default is offline and preserves source11 without env/save", async () => {
  const h = await harness();
  const r = await runInstantlyB(
    new Proxy(
      {},
      {
        get() {
          throw Error("ENV_FORBIDDEN");
        },
      },
    ),
    h.store,
    undefined,
  );
  assert.equal(r.calls, 11);
  assert.equal(r.newCalls, 0);
  assert.equal(h.store.writes, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.store.value.version, 2);
});
test("B-AC02 gates, confirmation, same recipients and invalid schedule block before writes/HTTP", async () => {
  for (const opts of [
    { authorizedNew: 24 },
    { authorizedTotal: 35 },
    { includedCallsConfirmed: false },
    { manifestReviewed: false },
  ]) {
    const h = await harness();
    await assert.rejects(h.run(opts), /B_AUTHORIZATION_REQUIRED/);
    assert.equal(h.store.writes, 0);
  }
  for (const kind of ["controlled", "exclusive", "mapping", "same", "date"]) {
    const h = await harness(),
      m = h.inputs.manifest;
    if (kind === "controlled") m.controlledRecipientsConfirmed = false;
    if (kind === "exclusive") m.exclusiveTrialControlConfirmed = false;
    if (kind === "mapping") m.statusMapping.confirmed = false;
    if (kind === "same") m.recipients[1] = m.recipients[0];
    if (kind === "date") m.schedule.start_date = "2026-99-99";
    await assert.rejects(h.run());
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.writes, 0);
  }
});
test("B-AC01 scope/source/config/manifest binding cannot be changed", async () => {
  for (const kind of ["scope", "source", "key"]) {
    const h = await harness();
    if (kind === "scope")
      h.inputs.scope.binding.configurationFingerprint = "0".repeat(64);
    if (kind === "source") h.inputs.prior.calls = 10;
    await assert.rejects(
      h.run(
        {},
        kind === "key" ? { ...bEnv, INSTANTLY_API_KEY: "changed" } : bEnv,
      ),
    );
    assert.equal(h.store.writes, 0);
    assert.equal(h.calls.length, 0);
  }
});

test("B-AC01 saved-file binding preserves request field order after strict validation", async () => {
  const inputs = await bSourceFixture();
  inputs.prior.requests = inputs.prior.requests.map((r) => ({
    op: r.op,
    page: r.page,
    bucket: r.bucket,
    purpose: r.purpose,
    result: r.result,
  }));
  inputs.scope.binding.ledgerSha256 = hash(
    JSON.stringify(inputs.prior, null, 2) + "\n",
  );
  const before = JSON.stringify(inputs.prior),
    checked = validateBInputs(inputs);
  assert.equal(JSON.stringify(checked.prior), before);
  assert.equal(
    checked.scope.binding.ledgerSha256,
    hash(JSON.stringify(checked.prior, null, 2) + "\n"),
  );
});

test("B-AC03 closed transport rejects wrong methods, hosts, queries and sending routes", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    return bJson({});
  };
  const root = "https://api.instantly.ai/api/v2/";
  for (const [url, method] of [
    [root + "campaigns/" + bId(30), "DELETE"],
    [root + "campaigns/" + bId(30) + "/activate", "POST"],
    [root + "accounts", "POST"],
    ["https://evil.invalid/api/v2/campaigns", "POST"],
    [root + "workspaces/current?anything=1", "GET"],
    [root + "campaigns?limit=100&search=another", "GET"],
    [
      root +
        "campaigns?limit=100&limit=100&search=S00-INSTANTLY-" +
        "a".repeat(24),
      "GET",
    ],
  ])
    await assert.rejects(
      instantlyTrialJson(fetchImpl, bSecret, url, method as any),
      /BLOCKED_ROUTE/,
    );
  assert.equal(calls, 0);
});
test("B-AC03/04/05 happy path19 new/30 accumulated, safe payloads and isolated update", async () => {
  const h = await harness(),
    r = await h.run(),
    s = validateBState(h.store.value);
  assert.equal(r.status, "completed");
  assert.equal(r.newCalls, 19);
  assert.equal(r.calls, 30);
  assert.equal(s.normal, 19);
  assert.equal(s.reserve, 0);
  assert.equal(s.hold, 0);
  assert.equal(r.closedNonSending, true);
  assert.equal(r.isolatedUpdateVerified, true);
  assert.deepEqual(s.prior, h.inputs.prior);
  assert.equal(h.provider.campaign?.status, 2);
  assert.equal(h.provider.leads[0].payload.s00_hold, true);
  assert.equal(h.provider.leads[1].payload.s00_hold, false);
  assert.ok(bPublicSafe(r));
  assert.equal(h.calls.filter((c) => c.step === "audience").length, 2);
  for (const c of h.calls) {
    assert.ok(
      !/activate|resume|send|reply|verify|enrich|delete/.test(
        new URL(c.url).pathname,
      ),
    );
    if (c.body?.email_list) assert.deepEqual(c.body.email_list, []);
  }
  for (let i = 1; i < h.calls.length; i++)
    assert.ok(h.calls[i].time - h.calls[i - 1].time >= 1000);
});
test("B-AC04 audience can require empty third page, exactly20 normals", async () => {
  const h = await harness();
  h.provider.threePages = true;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.newCalls, 20);
  assert.equal(r.calls, 31);
  assert.equal(h.calls.filter((c) => c.step === "audience").length, 3);
});
test("B-AC03 workspace/capacity/existing nonce block before campaign creation", async () => {
  for (const kind of ["workspace", "capacity", "nonce"]) {
    const h = await harness();
    h.after = (b, step) => {
      if (kind === "workspace" && step === "workspace") b.id = bOther;
      if (kind === "capacity" && step === "plan")
        b.subscriptions.outreach.current_lead_count = 25000;
      if (kind === "nonce" && step === "search")
        b.items = [
          {
            id: bId(77),
            name: "S00-INSTANTLY-" + h.inputs.prior.predecessor.nonce,
          },
        ];
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.ok(!h.calls.some((c) => c.step === "create"));
    assert.equal(h.provider.campaign, undefined);
  }
});
test("B-AC03 missing sender guard, attached sender or unsupported status stops before audience", async () => {
  for (const kind of ["missing", "sender", "status", "tag", "agent"]) {
    const h = await harness();
    h.after = (b, step) => {
      if (step === "initial") {
        if (kind === "missing") delete b.email_list;
        if (kind === "sender") b.email_list = ["private@example.invalid"];
        if (kind === "status") b.status = 99;
        if (kind === "tag") b.email_tag_list = [bId(80)];
        if (kind === "agent") b.ai_sdr_id = bId(81);
      }
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.error, "B_UNSAFE_CAMPAIGN");
    assert.ok(!h.calls.some((c) => c.step === "createA"));
    assert.equal(r.emergency, "verified_paused");
    assert.equal(validateBState(h.store.value).hold, 2);
  }
});
test("B-AC03 pause rejected never triggers activation or blind emergency retry", async () => {
  const h = await harness();
  h.before = (step) =>
    step === "pause" ? bJson({ message: bSecret }, 400) : undefined;
  const r = await h.run();
  assert.equal(r.status, "failed");
  assert.equal(h.calls.filter((c) => c.url.endsWith("/pause")).length, 1);
  assert.ok(!h.calls.some((c) => c.step === "createA"));
  assert.ok(bPublicSafe(r));
});
test("B-AC03 mismatched campaign ID/name/tenant never causes mutation of returned foreign resource", async () => {
  for (const field of ["id", "organization", "name"]) {
    const h = await harness();
    h.after = (b, step) => {
      if (step === "initial")
        b[field] = field === "name" ? "other-campaign" : bOther;
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.ok(!h.calls.some((c) => c.step === "emergency_pause"));
    assert.ok(!h.calls.some((c) => c.step === "createA"));
  }
});
test("B-AC04 lead identity mismatch, skipped create, payload markers missing or conflicting fail closed", async () => {
  for (const kind of ["foreign", "skip", "markers", "conflict"]) {
    const h = await harness();
    h.after = (b, step) => {
      if (step === "createA" && kind === "skip")
        return bJson({ skipped: true });
      if (step === "getA") {
        if (kind === "foreign") b.campaign = bId(99);
        if (kind === "markers") delete b.payload.s00_alias;
        if (kind === "conflict")
          b.custom_variables = { ...b.payload, s00_hold: true };
      }
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(
      h.provider.leads.filter((l) => l.payload.s00_alias === "A").length,
      1,
    );
    assert.ok(
      h.calls.filter(
        (c) =>
          c.step === "createA" &&
          c.method === "POST" &&
          c.url.endsWith("/leads"),
      ).length <= 1,
    );
  }
});
test("B-AC04 duplicate, foreign or transient empty audience does not recreate contacts", async () => {
  for (const kind of ["duplicate", "foreign", "empty"]) {
    const h = await harness();
    h.after = (b, step, count) => {
      if (step === "audience") {
        if (kind === "empty" && count === 1) {
          b.items = [];
          delete b.next_starting_after;
        }
        if (kind === "duplicate" && count === 2)
          b.items = [structuredClone(h.provider.leads[0])];
        if (kind === "foreign") b.items[0].id = bId(88);
      }
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(h.provider.leads.length, 2);
    assert.equal(
      h.calls.filter((c) => c.method === "POST" && c.url.endsWith("/leads"))
        .length,
      2,
    );
  }
});
test("B-AC05 changes to B or unrelated A fields fail isolation", async () => {
  for (const alias of ["A", "B"]) {
    const h = await harness();
    h.after = (b, step) => {
      if (step === "updateA")
        h.provider.leads[alias === "A" ? 0 : 1].payload.unrelated = "changed";
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.error, "B_ISOLATION_FAILED");
    assert.equal(r.emergency, "verified_paused");
  }
});
test("B-AC06 uncertain campaign create reconciles once without duplicate POST", async () => {
  const h = await harness();
  h.after = (_, step, count) =>
    step === "create" && count === 1 ? Error(bSecret) : undefined;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.newCalls, 20);
  assert.equal(
    h.calls.filter((c) => c.step === "create" && c.method === "POST").length,
    1,
  );
  assert.equal(validateBState(h.store.value).reserve, 1);
});
test("B-AC06 ambiguous create reconciliation stops without replacement resource", async () => {
  const h = await harness();
  h.after = (b, step, count) => {
    if (step === "create" && count === 1) return Error(bSecret);
    if (step === "create" && count === 2)
      b.items.push(structuredClone(b.items[0]));
    return undefined;
  };
  const r = await h.run();
  assert.equal(r.error, "B_UNRESOLVED_WRITE");
  assert.equal(
    h.calls.filter((c) => c.step === "create" && c.method === "POST").length,
    1,
  );
  assert.equal(h.provider.leads.length, 0);
});
test("B-AC06 uncertain lead create, configure and PATCH A reconcile with reads, never repeat write", async () => {
  for (const step of ["createA", "configure", "updateA"]) {
    const h = await harness();
    h.after = (_, s, count) =>
      s === step && count === 1 ? Error(bSecret) : undefined;
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(
      h.calls.filter(
        (c) =>
          c.step === step &&
          (c.method === "PATCH" ||
            (c.url.endsWith("/leads") && c.method === "POST")),
      ).length,
      1,
    );
    assert.equal(h.provider.leads.length, 2);
  }
});
test("B-AC06 read backoff/Retry-After and H stay within protected budgets", async () => {
  const h = await harness();
  h.before = (step, count) =>
    step === "workspace" && count === 1
      ? bJson({}, 429, { "retry-after": "7" })
      : undefined;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(validateBState(h.store.value).reserve, 1);
  assert.ok(h.clock.waits.includes(7000));
  const stop = await harness();
  stop.before = () => bJson({}, 429, { "retry-after": "61" });
  const out = await stop.run();
  assert.equal(out.error, "RETRY_WAIT_TOO_LONG");
  assert.equal(out.newCalls, 1);
});
test("B-AC06 R exhaustion stops before more mutation and H cannot fund diagnostics", async () => {
  const h = await harness();
  h.before = (step, count) =>
    ["workspace", "plan", "search"].includes(step) && count === 1
      ? bJson({}, 503)
      : undefined;
  const r = await h.run();
  assert.equal(r.error, "B_RECOVERY_RESERVE_REQUIRED");
  assert.equal(h.calls.filter((c) => c.step === "create").length, 0);
  assert.equal(validateBState(h.store.value).reserve, 3);
  assert.equal(validateBState(h.store.value).hold, 0);
});
test("B-AC06 upper bound reaches N20/R3/H2 exactly25 new,36 cumulative", async () => {
  const h = await harness();
  h.provider.threePages = true;
  h.before = (step, count) =>
    ["workspace", "plan", "final"].includes(step) && count === 1
      ? bJson({}, 503)
      : undefined;
  h.after = (b, step) => {
    if (step === "final") b.email_list = ["unexpected@example.invalid"];
    return undefined;
  };
  const r = await h.run(),
    s = validateBState(h.store.value);
  assert.equal(r.status, "failed");
  assert.equal(s.normal, 20);
  assert.equal(s.reserve, 3);
  assert.equal(s.hold, 2);
  assert.equal(r.newCalls, 25);
  assert.equal(r.calls, 36);
  assert.equal(r.emergency, "verified_paused");
});
test("B-AC07 failure before/after HTTP cannot erase reserved attempt or trigger a retry", async () => {
  for (const failAt of [1, 2, 3]) {
    const h = await harness();
    h.store.failAt = failAt;
    await assert.rejects(h.run());
    assert.equal(h.calls.length, failAt === 3 ? 1 : 0);
    assert.equal(h.store.value.calls, failAt === 3 ? 12 : 11);
  }
});
test("B-AC07 completed/failed/IN_FLIGHT replays without HTTP or saves", async () => {
  for (const kind of ["completed", "failed", "uncertain"]) {
    const h = await harness();
    if (kind === "failed") h.before = () => bJson({}, 401);
    if (kind === "uncertain") h.store.failAt = 3;
    try {
      await h.run();
    } catch {
      assert.equal(kind, "uncertain");
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
test("B-AC01 corruption, counter resets, changed manifest and source history cannot reopen run", async () => {
  const h = await harness();
  await h.run();
  const s = validateBState(h.store.value);
  for (const mutate of [
    (x: any) => (x.calls = 11),
    (x: any) => (x.prior.calls = 0),
    (x: any) => (x.sourceHash = "0".repeat(64)),
    (x: any) => (x.normal = 0),
    (x: any) => (x.requests[0].bucket = "H"),
  ]) {
    const bad = structuredClone(s);
    mutate(bad);
    assert.throws(() => validateBState(bad));
  }
  h.inputs.manifest.subject = "changed";
  await assert.rejects(h.run(), /B_BINDING_CHANGED/);
  const changed = structuredClone(s);
  changed.leads.A = bId(88);
  assert.throws(() => assertBTransition(s, changed), /B_HISTORY_IMMUTABLE/);
});
test("B-AC07 emergency pause uncertainty only gets one check, no retry and no deletes", async () => {
  const h = await harness();
  h.after = (b, step) => {
    if (step === "configured") b.email_list = ["unexpected@example.invalid"];
    if (step === "emergency_pause") return Error(bSecret);
    return undefined;
  };
  const r = await h.run();
  assert.equal(r.emergency, "verified_paused");
  assert.equal(h.calls.filter((c) => c.step === "emergency_pause").length, 1);
  assert.equal(h.calls.filter((c) => c.step === "emergency_check").length, 1);
  assert.ok(!h.calls.some((c) => c.method === "DELETE"));
});
test("B-AC08 malicious manifest fields or routes cannot add sender/status/send action", async () => {
  const h = await harness();
  assert.throws(() =>
    validateBManifest({
      ...h.inputs.manifest,
      email_list: ["sender@example.invalid"],
    }),
  );
  h.store.failAt = 2;
  await assert.rejects(h.run());
  const s = validateBState(h.store.value);
  assert.throws(() => bRequest(s, h.inputs.manifest, "activate" as any));
  assert.ok(bPublicSafe(await runInstantlyB({}, h.store, undefined)));
});
test("B-AC06 eight-second shared transport bounds stalled reads and counts retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const h = await harness();
    let attempts = 0;
    const work = h
      .run({
        fetchImpl: async () => {
          attempts++;
          return new Promise<Response>(() => {});
        },
      })
      .then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
    for (let i = 0; i < 1000 && attempts < 1; i++) await turn();
    assert.equal(attempts, 1);
    t.mock.timers.tick(8000);
    for (let i = 0; i < 1000 && attempts < 2; i++) await turn();
    assert.equal(attempts, 2);
    t.mock.timers.tick(8000);
    const outcome = await work;
    if ("error" in outcome) throw outcome.error;
    const r = outcome.result;
    assert.equal(r.status, "failed");
    assert.equal(r.newCalls, 2);
    assert.equal(validateBState(h.store.value).reserve, 1);
  } finally {
    t.mock.timers.reset();
  }
});
async function temporary(work: (dir: string) => Promise<void>) {
  await mkdir(resolve(".local"), { recursive: true });
  const dir = await mkdtemp(resolve(".local", "s00-instantly-b-test-"));
  try {
    await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function fixtureFiles(dir: string) {
  const inputs = await bSourceFixture(),
    folder = resolve(dir, ".local/pipeline-os"),
    path = resolve(folder, "s00-instantly-run.json");
  await mkdir(folder, { recursive: true });
  await writeFile(path, JSON.stringify(inputs.prior, null, 2) + "\n");
  await writeFile(
    resolve(folder, "s00-instantly-scope-attestation.json"),
    JSON.stringify(inputs.scope),
  );
  await writeFile(
    resolve(folder, "s00-instantly-b-manifest.json"),
    JSON.stringify(inputs.manifest),
  );
  return { inputs, folder, path, files: instantlyFiles(dir) };
}
test("B-AC07 filesystem future migration preserves11 and refuses legacy downgrades/foreign tmp", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      h = await harness();
    h.inputs = f.inputs;
    h.store.value = f.inputs.prior;
    h.store.failAt = 2;
    await assert.rejects(h.run());
    const state = validateBState(h.store.value);
    await f.files.locked(() => f.files.bStore.save(state));
    assert.deepEqual(
      validateBState(await f.files.bStore.load()).prior,
      f.inputs.prior,
    );
    await assert.rejects(f.files.ledgerStore.load(), /B_LEDGER_SUPERSEDES_A/);
    await assert.rejects(
      f.files.ledgerStore.save(f.inputs.prior),
      /B_LEDGER_SUPERSEDES_A/,
    );
    await writeFile(f.path + ".tmp", "foreign");
    await assert.rejects(f.files.bStore.save(state));
    assert.equal(await readFile(f.path + ".tmp", "utf8"), "foreign");
  }));
test("B-AC02 CLI status/check-manifest/invalid gates are offline and preserve source", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      before = await readFile(f.path, "utf8"),
      guard = resolve(dir, "guard.mjs");
    await writeFile(guard, "globalThis.fetch=()=>{throw Error('NO_HTTP')};");
    const loader = pathToFileURL(
        resolve("node_modules/tsx/dist/loader.mjs"),
      ).href,
      cli = resolve("scripts/pipeline-os/s00-instantly-runner-cli.ts");
    for (const flags of [
      ["--phase", "B"],
      ["--check-b-manifest"],
      [
        "--execute",
        "--phase",
        "B",
        "--authorized-new",
        "25",
        "--included-calls-confirmed",
      ],
      ["--check-config", "--phase", "B"],
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
      assert.equal(
        p.status,
        flags.includes("--execute") || flags.includes("--check-config") ? 2 : 0,
      );
      assert.ok(!(p.stdout + p.stderr).includes(bSecret));
    }
    assert.equal(await readFile(f.path, "utf8"), before);
    assert.equal(
      (await readdir(f.folder)).filter((n) => /\.lock$|\.tmp$/.test(n)).length,
      0,
    );
  }));
test("B-AC03/07 CLI full fixture-only run creates paused trial, replay adds zero HTTP", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      guard = resolve(dir, "provider.mjs"),
      fixture = pathToFileURL(
        resolve("tests/fixtures/pipeline-os-instantly-b.ts"),
      ).href;
    await writeFile(
      guard,
      `import {BProvider} from '${fixture}';import {appendFileSync} from 'node:fs';const p=new BProvider();globalThis.fetch=async(raw,init)=>{appendFileSync('calls.txt','HTTP\\n');return new Response(JSON.stringify(p.handle(String(raw),init)),{headers:{'content-type':'application/json'}});};`,
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
          timeout: 45000,
          env: {
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: "test",
            INSTANTLY_API_KEY: bSecret,
            INSTANTLY_WORKSPACE_ID: bWorkspace,
          },
        },
      );
    const flags = [
        "--execute",
        "--phase",
        "B",
        "--authorized-new",
        "25",
        "--authorized-total",
        "36",
        "--included-calls-confirmed",
        "--manifest-reviewed",
      ],
      first = run(flags);
    assert.equal(first.status, 0, first.stderr);
    const r = JSON.parse(first.stdout);
    assert.equal(r.calls, 30);
    assert.equal(r.status, "completed");
    assert.ok(bPublicSafe(r));
    const before = await readFile(f.path, "utf8");
    assert.equal(run([]).status, 0);
    assert.equal(run(flags).status, 0);
    assert.equal(
      run([
        "--execute",
        "--phase",
        "A",
        "--authorized-new",
        "12",
        "--included-calls-confirmed",
      ]).status,
      2,
    );
    assert.equal(await readFile(f.path, "utf8"), before);
    assert.equal(
      (await readFile(resolve(dir, "calls.txt"), "utf8")).trim().split("\n")
        .length,
      19,
    );
    assert.equal(
      (await readdir(f.folder)).filter((n) => /\.tmp$|\.lock$/.test(n)).length,
      0,
    );
    assert.deepEqual(validateBState(JSON.parse(before)).prior, f.inputs.prior);
  }));
