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
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { setImmediate as turn } from "node:timers/promises";
import { bdSourceFixture } from "./fixtures/pipeline-os-instantly-b-diagnostic";
import {
  bEnv,
  bSecret,
  bOther,
  bId,
  bJson,
  BClock,
  bPublicSafe,
} from "./fixtures/pipeline-os-instantly-b";
import {
  runInstantlyBDiagnostic,
  validateBDSource,
  validateBDInputs,
  validateBDState,
  assertBDTransition,
  campaignDiagnosticProjection,
  bdReport,
  type BDState,
  type BDStore,
  type BDInputs,
} from "../scripts/pipeline-os/s00-instantly-b-diagnostic";
import type { BState } from "../scripts/pipeline-os/s00-instantly-b";
import { instantlyFiles } from "../scripts/pipeline-os/s00-instantly-files";

globalThis.fetch = async () => {
  throw Error("REAL_NETWORK_FORBIDDEN");
};
test("BD-AC02 absent source is reported as unknown with zero observed calls", async () => {
  const r = await runInstantlyBDiagnostic(
    new Proxy(
      {},
      {
        get() {
          throw Error("ENV_FORBIDDEN");
        },
      },
    ),
    {
      load: async () => undefined,
      save: async () => {
        throw Error("SAVE_FORBIDDEN");
      },
    },
    undefined,
    {
      fetchImpl: async () => {
        throw Error("HTTP_FORBIDDEN");
      },
    },
  );
  assert.equal(r.calls, 0);
  assert.equal(r.priorCalls, 0);
  assert.equal(r.sourceAvailable, false);
  assert.equal(r.bTrialStatus, "unknown");
});
class Memory implements BDStore {
  value: BState | BDState;
  writes = 0;
  failAt = -1;
  constructor(s: BState) {
    this.value = structuredClone(s);
  }
  async load() {
    return structuredClone(this.value);
  }
  async save(s: BDState) {
    if (++this.writes === this.failAt) throw Error(bSecret);
    assertBDTransition(this.value, s);
    this.value = structuredClone(s);
  }
}
async function harness() {
  const f = await bdSourceFixture(),
    store = new Memory(f.inputs.source),
    clock = new BClock();
  const calls: {
    url: string;
    method: string | undefined;
    body: unknown;
    time: number;
  }[] = [];
  const h = {
    inputs: f.inputs,
    store,
    clock,
    calls,
    body: f.body,
    responses: [] as (Response | Error)[],
    before: undefined as (() => void) | undefined,
    run: (
      opts: Parameters<typeof runInstantlyBDiagnostic>[3] = {},
      env = bEnv,
    ) =>
      runInstantlyBDiagnostic(env, store, h.inputs, {
        execute: true,
        authorizedNew: 2,
        authorizedTotal: 20,
        includedCallsConfirmed: true,
        manifestReviewed: true,
        clock,
        fetchImpl: async (raw, init) => {
          const s = validateBDState(store.value);
          assert.equal(s.requests.at(-1)?.result, "IN_FLIGHT");
          assert.equal(s.calls, 18 + calls.length + 1);
          assert.deepEqual(s.prior, h.inputs.source);
          assert.equal(
            String(raw),
            "https://api.instantly.ai/api/v2/campaigns/" +
              h.inputs.source.campaignId,
          );
          assert.equal(init?.method, "GET");
          assert.equal(init?.body, undefined);
          assert.equal(init?.redirect, "manual");
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            "Bearer " + bSecret,
          );
          calls.push({
            url: String(raw),
            method: init?.method,
            body: init?.body,
            time: clock.time,
          });
          h.before?.();
          const response = h.responses.shift();
          if (response instanceof Error) throw response;
          return response ?? bJson(h.body);
        },
        ...opts,
      }),
  };
  return h;
}
const noEnv = new Proxy(
  {},
  {
    get() {
      throw Error("ENV_FORBIDDEN");
    },
  },
);

test("BD-AC01/02 default status is offline, source18 immutable, no env/save", async () => {
  const h = await harness(),
    before = structuredClone(h.store.value);
  const r = await h.run({ execute: false }, noEnv as typeof bEnv);
  assert.equal(r.calls, 18);
  assert.equal(r.status, "not_started");
  assert.equal(h.calls.length, 0);
  assert.equal(h.store.writes, 0);
  assert.deepEqual(h.store.value, before);
  assert.ok(bPublicSafe(r));
});
test("BD-AC02 all explicit gates are required before env, writes or HTTP", async () => {
  for (const change of [
    { authorizedNew: 1 },
    { authorizedTotal: 36 },
    { includedCallsConfirmed: false },
    { manifestReviewed: false },
  ]) {
    const h = await harness();
    await assert.rejects(
      h.run(change, noEnv as typeof bEnv),
      /BD_AUTHORIZATION_REQUIRED/,
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.writes, 0);
  }
});
test("BD-AC01 only the exact audited failed B18 source is eligible", async () => {
  const f = await bdSourceFixture();
  for (const change of [
    { calls: 17 },
    { error: "CANCELLED" },
    { emergency: "unverified" },
    { stage: 5 },
    { campaignVerified: false },
    { leads: { A: bId(40), B: null } },
  ]) {
    assert.throws(() => validateBDSource({ ...f.inputs.source, ...change }));
  }
  const bad = structuredClone(f.inputs.source);
  bad.requests[4].result = "HTTP_403";
  assert.throws(() => validateBDSource(bad));
  assert.equal(validateBDSource(f.inputs.source), f.inputs.source);
});
test("BD-AC03 manifest, scope, current configuration and supplied source are bound", async () => {
  for (const kind of [
    "manifest",
    "scope",
    "configuration",
    "source",
  ] as const) {
    const h = await harness();
    if (kind === "manifest")
      h.inputs.manifest.subject = "Changed fictional subject";
    if (kind === "scope")
      (h.inputs.scope as any).binding.configurationFingerprint = "f".repeat(64);
    if (kind === "source")
      (h.store.value as BState).prior.predecessor.nonce = "f".repeat(24);
    await assert.rejects(
      h.run(
        {},
        kind === "configuration"
          ? { ...bEnv, INSTANTLY_API_KEY: "CHANGED_FICTIONAL_KEY" }
          : bEnv,
      ),
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.store.writes, 0);
  }
});
test("BD-AC03/07 success is one own GET,19 cumulative, not a B repair or historical proof", async () => {
  const h = await harness(),
    source = structuredClone(h.inputs.source),
    r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 19);
  assert.equal(h.calls.length, 1);
  assert.equal(r.projection?.currentPaused, true);
  assert.equal(r.projection?.originalGuardPassesNow, true);
  assert.equal(r.historicalFailureCauseProven, false);
  assert.equal(r.bTrialStatus, "failed");
  assert.equal(r.bResumed, false);
  assert.equal(r.mutations, 0);
  assert.ok(bPublicSafe(r));
  assert.deepEqual(validateBDState(h.store.value).prior, source);
});
test("BD-AC04 omissions, nulls, types and nonempty safety arrays stay distinct without defaults", async () => {
  for (const [field, value, reason] of [
    ["cc_list", undefined, "missing"],
    ["cc_list", null, "null"],
    ["cc_list", false, "wrong_type"],
    ["cc_list", ["PRIVATE_CONTACT@example.invalid"], "non_empty"],
    ["ai_sdr_id", bSecret, "wrong_type"],
    ["is_evergreen", true, "mismatch"],
    ["stop_on_reply", undefined, "missing"],
  ] as const) {
    const h = await harness();
    if (value === undefined) delete h.body[field];
    else h.body[field] = value;
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(
      r.projection?.fields.find((row) => row.field === field)?.reason,
      reason,
    );
    assert.equal(r.projection?.originalGuardPassesNow, false);
    assert.ok(!JSON.stringify(r).includes(bSecret));
    assert.ok(!JSON.stringify(r).includes("PRIVATE_CONTACT@example.invalid"));
  }
});
test("BD-AC04 fixed schedule paths locate normalization without leaking unknown keys or copy", async () => {
  const h = await harness();
  (h.body.campaign_schedule as any).schedules[0].timing.to = "09:06";
  (h.body.campaign_schedule as any)[bSecret] = "PRIVATE_VALUE";
  h.body.sequences = [
    { steps: [{ variants: [{ subject: bSecret, body: "PRIVATE_COPY" }] }] },
  ];
  const r = await h.run();
  assert.equal(
    r.projection?.fields.find(
      (x) => x.field === "campaign_schedule.schedules[0].timing",
    )?.reason,
    "mismatch",
  );
  assert.equal(
    r.projection?.fields.find((x) => x.field === "sequences")?.reason,
    "non_empty",
  );
  assert.ok(!JSON.stringify(r).includes(bSecret));
  assert.ok(!JSON.stringify(r).includes("PRIVATE_COPY"));
  const newState = { ...validateBDState(h.store.value), prior: undefined };
  assert.ok(!JSON.stringify(newState).includes("PRIVATE_VALUE"));
});
test("BD-AC04 semantic equality ignores provider property order", async () => {
  const h = await harness();
  const timing = (h.body.campaign_schedule as any).schedules[0].timing;
  (h.body.campaign_schedule as any).schedules[0].timing = {
    to: timing.to,
    from: timing.from,
  };
  assert.equal((await h.run()).projection?.originalGuardPassesNow, true);
});
test("BD-AC03 foreign resource identity fails without retry, correction or projection", async () => {
  for (const field of ["id", "name", "organization"]) {
    const h = await harness();
    h.body[field] = field === "name" ? bSecret : bOther;
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(r.error, "BD_IDENTITY_MISMATCH");
    assert.equal(r.projection, null);
    assert.equal(h.calls.length, 1);
    assert.ok(bPublicSafe(r));
  }
});
test("BD-AC07 draft/active/unexpected status is reported without any pause mutation", async () => {
  for (const status of [0, 1, 4, "2", null]) {
    const h = await harness();
    h.body.status = status;
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(r.error, "BD_NOT_PAUSED");
    assert.equal(r.projection?.currentPaused, false);
    assert.equal(h.calls.length, 1);
    assert.equal(
      r.projection?.fields.find((x) => x.field === "status")?.reason,
      status === 0
        ? "match"
        : status === null
          ? "null"
          : typeof status === "string"
            ? "wrong_type"
            : "mismatch",
    );
  }
});
test("BD-AC05 permanent HTTP/auth, redirect and invalid bodies never retry", async () => {
  for (const response of [
    bJson({ message: bSecret }, 401),
    bJson({}, 402),
    bJson({}, 403),
    bJson({}, 400),
    new Response(null, {
      status: 302,
      headers: { location: "https://foreign.example.invalid/" },
    }),
    new Response("not json " + bSecret, {
      headers: { "content-type": "application/json" },
    }),
    bJson([]),
  ]) {
    const h = await harness();
    h.responses.push(response);
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(h.calls.length, 1);
    assert.ok(bPublicSafe(r));
  }
});
test("BD-AC05 transient read gets at most one retry,20 cumulative, durable backoff", async () => {
  for (const response of [
    new Error(bSecret),
    bJson({}, 503),
    bJson({}, 429, { "retry-after": "7" }),
  ]) {
    const h = await harness();
    h.responses.push(response);
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(r.calls, 20);
    assert.equal(h.calls.length, 2);
    assert.ok(h.clock.waits[0] >= 5000);
    assert.equal(validateBDState(h.store.value).requests[1].purpose, "retry");
  }
});
test("BD-AC05 two failing reads stop at20, long Retry-After stops at19", async () => {
  const h = await harness();
  h.responses.push(bJson({}, 503), bJson({}, 503));
  assert.equal((await h.run()).calls, 20);
  assert.equal(h.calls.length, 2);
  const x = await harness();
  x.responses.push(bJson({}, 429, { "retry-after": "61" }));
  const r = await x.run();
  assert.equal(r.calls, 19);
  assert.equal(r.error, "RETRY_WAIT_TOO_LONG");
  assert.equal(x.calls.length, 1);
});
test("BD-AC06 persistence failures before/after HTTP never refund or repeat", async () => {
  for (const at of [1, 2, 3, 4]) {
    const h = await harness();
    h.store.failAt = at;
    await assert.rejects(h.run(), /BD_STORAGE_OR_INTERNAL_FAILURE/);
    assert.equal(h.calls.length, at <= 2 ? 0 : 1);
    const snapshot = structuredClone(h.store.value);
    const writes = h.store.writes;
    if (snapshot.version === 4) {
      await h.run({}, noEnv as typeof bEnv);
      assert.equal(h.store.writes, writes);
      assert.deepEqual(h.store.value, snapshot);
      assert.equal(h.calls.length, at <= 2 ? 0 : 1);
    }
  }
});
test("BD-AC06 completed/failed/interrupted replay is offline even with execute flags", async () => {
  for (const kind of ["completed", "failed", "interrupted"]) {
    const h = await harness();
    if (kind === "failed") h.responses.push(bJson({}, 403));
    if (kind === "interrupted") h.store.failAt = 3;
    try {
      await h.run();
    } catch {
      assert.equal(kind, "interrupted");
    }
    const before = structuredClone(h.store.value),
      writes = h.store.writes,
      calls = h.calls.length;
    await h.run({}, noEnv as typeof bEnv);
    assert.deepEqual(h.store.value, before);
    assert.equal(h.store.writes, writes);
    assert.equal(h.calls.length, calls);
  }
});
test("BD-AC06 abort before reservation or between retries cannot spend a second request", async () => {
  const h = await harness(),
    c = new AbortController();
  c.abort();
  const r = await h.run({ signal: c.signal });
  assert.equal(r.error, "CANCELLED");
  assert.equal(r.calls, 18);
  assert.equal(h.calls.length, 0);
  const x = await harness(),
    stop = new AbortController();
  x.responses.push(bJson({}, 503));
  x.clock.sleep = async () => {
    stop.abort();
  };
  assert.equal((await x.run({ signal: stop.signal })).calls, 19);
  assert.equal(x.calls.length, 1);
});
test("BD-AC01/04 strict journals reject resets, leaked fields and historical edits", async () => {
  const h = await harness();
  await h.run();
  const source = validateBDState(h.store.value);
  for (const change of [
    { calls: 18 },
    { requests: [] },
    { privateEmail: bSecret },
    { sourceHash: "f".repeat(64) },
  ])
    assert.throws(() => validateBDState({ ...source, ...change }));
  const leaked = structuredClone(source);
  (leaked.projection!.fields[0] as any).value = bSecret;
  assert.throws(() => validateBDState(leaked));
  const changed = structuredClone(source);
  changed.prior.campaignId = bOther;
  assert.throws(() => validateBDState(changed));
  const reset = structuredClone(source);
  reset.status = "running";
  reset.projection = null;
  assert.throws(
    () => assertBDTransition(source, reset),
    /BD_HISTORY_IMMUTABLE/,
  );
  const arbitrary = structuredClone(source);
  (arbitrary.projection!.fields[0] as any).field = bSecret;
  assert.throws(() => validateBDState(arbitrary));
});
test("BD-AC04 root shapes and projection construction cannot retain arbitrary field names", async () => {
  const f = await bdSourceFixture();
  for (const raw of [null, [], false, bSecret])
    assert.throws(() =>
      campaignDiagnosticProjection(
        f.inputs.source,
        f.inputs.manifest,
        bEnv.INSTANTLY_WORKSPACE_ID,
        raw,
      ),
    );
  const projection = campaignDiagnosticProjection(
    f.inputs.source,
    f.inputs.manifest,
    bEnv.INSTANTLY_WORKSPACE_ID,
    { ...f.body, [bSecret]: bSecret },
  );
  assert.ok(!JSON.stringify(projection).includes(bSecret));
  assert.equal(projection.historicalFailureCauseProven, false);
});
test("BD-AC01 default diagnostics reject an ineligible B source instead of mislabelling it", async () => {
  const h = await harness();
  (h.store.value as BState).emergency = "unverified";
  await assert.rejects(
    h.run({ execute: false }, noEnv as typeof bEnv),
    /BD_SOURCE_REQUIRED/,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.store.writes, 0);
});
test("BD-AC05 declared and streaming responses over2MiB stop without retry", async () => {
  for (const declared of [true, false]) {
    const h = await harness();
    h.responses.push(
      new Response("x".repeat(2 * 1024 * 1024 + 1), {
        headers: {
          "content-type": "application/json",
          ...(declared
            ? { "content-length": String(2 * 1024 * 1024 + 1) }
            : {}),
        },
      }),
    );
    const r = await h.run();
    assert.equal(r.error, "RESPONSE_LIMIT");
    assert.equal(r.calls, 19);
    assert.equal(h.calls.length, 1);
  }
});
test("BD-AC05 stalled transports use the shared8s bound and stop at20", async (t) => {
  const h = await harness();
  let attempts = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
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
    assert.equal(outcome.result.calls, 20);
    assert.equal(outcome.result.error, "NETWORK_OR_TIMEOUT");
  } finally {
    t.mock.timers.reset();
  }
});
test("BD-AC06 cancellation during HTTP cannot retry a cancelled request", async () => {
  const h = await harness(),
    c = new AbortController();
  h.before = () => c.abort();
  const r = await h.run({ signal: c.signal });
  assert.equal(r.error, "CANCELLED");
  assert.equal(r.calls, 19);
  assert.equal(h.calls.length, 1);
});
test("BD-AC01 failed journals must agree with their durable HTTP outcomes", async () => {
  const h = await harness();
  h.responses.push(bJson({}, 403));
  await h.run();
  const s = validateBDState(h.store.value);
  assert.throws(
    () => validateBDState({ ...s, error: "HTTP_401" }),
    /BD_INVALID_JOURNAL/,
  );
  assert.throws(
    () => validateBDState({ ...s, error: "BD_IDENTITY_MISMATCH" }),
    /BD_INVALID_JOURNAL/,
  );
});
async function temporary(work: (dir: string) => Promise<void>) {
  const root = resolve(".local");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(resolve(root, "s00-instantly-bd-test-"));
  if (!dir.startsWith(root + sep)) throw Error("UNSAFE_TEST_DIRECTORY");
  try {
    await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function fixtureFiles(dir: string) {
  const f = await bdSourceFixture(),
    folder = resolve(dir, ".local/pipeline-os"),
    path = resolve(folder, "s00-instantly-run.json");
  await mkdir(folder, { recursive: true });
  await writeFile(path, JSON.stringify(f.inputs.source, null, 2) + "\n");
  await writeFile(
    resolve(folder, "s00-instantly-b-manifest.json"),
    JSON.stringify(f.inputs.manifest),
  );
  await writeFile(
    resolve(folder, "s00-instantly-scope-attestation.json"),
    JSON.stringify(f.inputs.scope),
  );
  return { ...f, folder, path, files: instantlyFiles(dir) };
}
test("BD-AC01/06 filesystem migration preserves B18 and rejects all legacy effects/downgrades", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      before = await readFile(f.path, "utf8");
    const r = await f.files.locked(() =>
      runInstantlyBDiagnostic(bEnv, f.files.diagnosticStore, f.inputs, {
        execute: true,
        authorizedNew: 2,
        authorizedTotal: 20,
        includedCallsConfirmed: true,
        manifestReviewed: true,
        fetchImpl: async () => bJson(f.body),
        clock: new BClock(),
      }),
    );
    assert.equal(r.calls, 19);
    const saved = validateBDState(await f.files.diagnosticStore.load());
    assert.equal(JSON.stringify(saved.prior, null, 2) + "\n", before);
    await assert.rejects(f.files.bStore.load(), /BD_LEDGER_SUPERSEDES_B/);
    await assert.rejects(f.files.ledgerStore.load(), /BD_LEDGER_SUPERSEDES_B/);
    await assert.rejects(
      f.files.bStore.save(f.inputs.source),
      /BD_LEDGER_SUPERSEDES_B/,
    );
    await assert.rejects(
      f.files.ledgerStore.save(f.inputs.source.prior),
      /BD_LEDGER_SUPERSEDES_B/,
    );
    assert.equal((await f.files.diagnosticInputs()).source.calls, 18);
    assert.equal((await f.files.bInputs()).prior.calls, 11);
  }));
test("BD-AC06 foreign locks/tmp and missing/oversized inputs cannot be overwritten", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir);
    await writeFile(f.path + ".lock", "foreign");
    await assert.rejects(
      f.files.locked(async () => true),
      /INSTANTLY_JOURNAL_LOCKED/,
    );
    assert.equal(await readFile(f.path + ".lock", "utf8"), "foreign");
    await writeFile(f.path + ".tmp", "foreign");
    const h = await harness();
    h.inputs = f.inputs;
    h.store.value = f.inputs.source;
    h.store.failAt = 2;
    await assert.rejects(h.run());
    const initial = validateBDState(h.store.value);
    await assert.rejects(f.files.diagnosticStore.save(initial));
    assert.equal(await readFile(f.path + ".tmp", "utf8"), "foreign");
    await writeFile(
      resolve(f.folder, "s00-instantly-b-manifest.json"),
      "x".repeat(65537),
    );
    await assert.rejects(
      f.files.diagnosticInputs(),
      /B_INPUT_FILE_INVALID_OR_MISSING/,
    );
  }));
const loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
const cli = resolve("scripts/pipeline-os/s00-instantly-runner-cli.ts");
function cliRun(
  dir: string,
  guard: string,
  flags: string[],
  env: Record<string, string> = {},
) {
  return spawnSync(
    process.execPath,
    ["--import", loader, "--import", pathToFileURL(guard).href, cli, ...flags],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 15000,
      env: { SystemRoot: process.env.SystemRoot, NODE_ENV: "test", ...env },
    },
  );
}
test("BD-AC02 CLI preview and invalid modes never autoload env, HTTP or save", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      before = await readFile(f.path, "utf8"),
      guard = resolve(dir, "guard.mjs");
    await writeFile(guard, "globalThis.fetch=()=>{throw Error('NO_HTTP')};");
    await writeFile(resolve(dir, ".env.local"), "INSTANTLY_API_KEY=" + bSecret);
    for (const [flags, expected] of [
      [["--phase", "B_DIAGNOSTIC"], 0],
      [["--check-b-diagnostic"], 0],
      [["--phase", "A", "--check-b-diagnostic"], 2],
      [["--phase", "B_DIAGNOSTIC", "--execute"], 2],
      [["--phase", "B_DIAGNOSTIC", "--recover-pagination"], 2],
      [["--phase", "B_DIAGNOSTIC", "--check-b-manifest"], 2],
    ] as const) {
      const p = cliRun(dir, guard, [...flags]);
      assert.equal(p.status, expected, p.stderr);
      assert.ok(!(p.stdout + p.stderr).includes(bSecret));
    }
    assert.equal(await readFile(f.path, "utf8"), before);
    assert.equal(
      (await readdir(f.folder)).filter((x) => /\.(lock|tmp)$/.test(x)).length,
      0,
    );
  }));
test("BD-AC03/06 CLI full fixture-only GET, global status, no-op replay and B rejection", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      guard = resolve(dir, "provider.mjs");
    await writeFile(resolve(dir, "response.json"), JSON.stringify(f.body));
    await writeFile(
      guard,
      `import {readFileSync,appendFileSync} from 'node:fs';const body=JSON.parse(readFileSync('response.json','utf8'));globalThis.fetch=async(raw,init)=>{if(init.method!=='GET'||String(raw)!=='https://api.instantly.ai/api/v2/campaigns/'+body.id||init.body)throw Error('BAD_ROUTE');appendFileSync('calls.txt','GET\\n');return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});};`,
    );
    const flags = [
      "--execute",
      "--phase",
      "B_DIAGNOSTIC",
      "--authorized-new",
      "2",
      "--authorized-total",
      "20",
      "--included-calls-confirmed",
      "--manifest-reviewed",
    ];
    const first = cliRun(dir, guard, flags, bEnv);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).calls, 19);
    assert.ok(bPublicSafe(JSON.parse(first.stdout)));
    const before = await readFile(f.path, "utf8");
    assert.equal(cliRun(dir, guard, []).status, 0);
    assert.equal(cliRun(dir, guard, flags).status, 0);
    assert.equal(
      cliRun(
        dir,
        guard,
        [
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
        bEnv,
      ).status,
      2,
    );
    assert.equal(await readFile(f.path, "utf8"), before);
    assert.equal(
      (await readFile(resolve(dir, "calls.txt"), "utf8")).trim(),
      "GET",
    );
  }));
