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
import { cfdSourceFixture } from "./fixtures/pipeline-os-instantly-config-diagnostic";
import {
  bEnv,
  bSecret,
  bWorkspace,
  bOther,
  bJson,
  BClock,
  bPublicSafe,
} from "./fixtures/pipeline-os-instantly-b";
import {
  runInstantlyConfigDiagnostic,
  validateCFDSource,
  validateCFDInputs,
  validateCFDState,
  assertCFDTransition,
  configuredCampaignProjection,
  cfdReport,
  type CFDStore,
  type CFDState,
} from "../scripts/pipeline-os/s00-instantly-config-diagnostic";
import type { BRState } from "../scripts/pipeline-os/s00-instantly-b-recovery";
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
class Memory implements CFDStore {
  value: BRState | CFDState;
  writes = 0;
  failAt = -1;
  constructor(s: BRState) {
    this.value = structuredClone(s);
  }
  async load() {
    return structuredClone(this.value);
  }
  async save(s: CFDState) {
    if (++this.writes === this.failAt) throw Error(bSecret);
    assertCFDTransition(this.value, s);
    this.value = structuredClone(s);
  }
}
async function harness() {
  const f = await cfdSourceFixture(),
    store = new Memory(f.inputs.source),
    clock = new BClock(),
    calls: { url: string; method: string; body: unknown; time: number }[] = [];
  const h = {
    ...f,
    store,
    clock,
    calls,
    responses: [] as (Response | Error)[],
    before: undefined as undefined | (() => void),
    run: (
      opts: Parameters<typeof runInstantlyConfigDiagnostic>[3] = {},
      env: Readonly<Record<string, string | undefined>> = bEnv,
    ) =>
      runInstantlyConfigDiagnostic(env, store, h.inputs, {
        execute: true,
        authorizedNew: 2,
        authorizedTotal: 29,
        includedCallsConfirmed: true,
        manifestReviewed: true,
        clock,
        fetchImpl,
        ...opts,
      }),
  };
  const fetchImpl: typeof fetch = async (raw, init) => {
    const s = validateCFDState(store.value);
    assert.equal(s.requests.at(-1)?.result, "IN_FLIGHT");
    assert.equal(s.calls, 28 + calls.length);
    assert.deepEqual(s.prior, h.inputs.source);
    assert.equal(
      String(raw),
      "https://api.instantly.ai/api/v2/campaigns/" +
        h.inputs.source.prior.prior.campaignId,
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
      method: init!.method!,
      body: init?.body,
      time: clock.now(),
    });
    h.before?.();
    const response = h.responses.shift();
    if (response instanceof Error) throw response;
    return response ?? bJson(h.body);
  };
  return h;
}
const fields = (r: Awaited<ReturnType<typeof runInstantlyConfigDiagnostic>>) =>
  r.projection!.fields;
test("CFD-AC02 default absent/source27 never reads env, calls HTTP or saves", async () => {
  const r = await runInstantlyConfigDiagnostic(
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
    before = JSON.stringify(h.store.value),
    s = await runInstantlyConfigDiagnostic(noEnv, h.store, undefined);
  assert.equal(s.calls, 27);
  assert.equal(s.status, "not_started");
  assert.equal(s.newCalls, 0);
  assert.equal(h.store.writes, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(JSON.stringify(h.store.value), before);
});
test("CFD-AC01/02 dedicated gates and bindings reject before effects", async () => {
  for (const opts of [
    { authorizedNew: 1 },
    { authorizedTotal: 20 },
    { authorizedTotal: 41 },
    { includedCallsConfirmed: false },
    { manifestReviewed: false },
  ]) {
    const h = await harness();
    await assert.rejects(h.run(opts, noEnv), /CFD_AUTHORIZATION_REQUIRED/);
    assert.equal(h.store.writes, 0);
  }
  for (const kind of [
    "calls",
    "status",
    "stage",
    "pause",
    "lead",
    "manifest",
    "scope",
    "key",
  ]) {
    const h = await harness();
    if (kind === "calls") h.inputs.source.calls = 26;
    if (kind === "status") h.inputs.source.status = "running";
    if (kind === "stage") h.inputs.source.stage = 4;
    if (kind === "pause") h.inputs.source.emergency = "unverified";
    if (kind === "lead") h.inputs.source.leads.A = bOther;
    if (kind === "manifest") h.inputs.manifest.body = "CHANGED_PRIVATE_BODY";
    if (kind === "scope")
      (h.inputs.scope as any).binding.configurationFingerprint = "f".repeat(64);
    await assert.rejects(
      h.run(
        {},
        kind === "key"
          ? { ...bEnv, INSTANTLY_API_KEY: "CHANGED_FICTIONAL" }
          : bEnv,
      ),
    );
    assert.equal(h.store.writes, 0);
    assert.equal(h.calls.length, 0);
  }
});
test("CFD-AC03/04/06 single own GET gives28 and identifies fixture extras without repairing recovery", async () => {
  const h = await harness(),
    source = structuredClone(h.inputs.source),
    r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 28);
  assert.equal(r.newCalls, 1);
  assert.equal(r.mutations, 0);
  assert.equal(r.recoveryResumed, false);
  assert.equal(r.recoveryStatus, "failed");
  assert.equal(r.historicalFailureCauseProven, false);
  assert.equal(r.sendingSafetyCertified, false);
  assert.equal(r.projection?.currentPaused, true);
  assert.equal(r.projection?.configuredGuardPassesNow, false);
  assert.equal(fields(r).length, 45);
  assert.equal(
    fields(r).find((f) => f.path === "sequences[0].steps[0].delay_unit")
      ?.reason,
    "unexpected",
  );
  assert.equal(
    fields(r).find((f) => f.path === "sequences[0].steps[0]")?.extraKeyCount,
    1,
  );
  assert.deepEqual(validateCFDState(h.store.value).prior, source);
  assert.ok(bPublicSafe(r));
  assert.ok(Buffer.byteLength(JSON.stringify(h.store.value, null, 2)) < 65536);
});
test("CFD-AC04 matching configured payload uses OC compatibility without rewriting raw omission", async () => {
  const h = await harness();
  delete h.body.sequences[0].steps[0].delay_unit;
  const r = await h.run();
  assert.equal(r.projection?.configuredGuardPassesNow, true);
  assert.equal(r.projection?.optionalFields.ai_sdr_id, "omitted");
  const ai = fields(r).find((f) => f.path === "ai_sdr_id")!;
  assert.equal(ai.reason, "missing");
  assert.equal(ai.basis, "creation_intent");
  assert.equal(r.historicalFailureCauseProven, false);
  assert.equal(
    fields(r).find((f) => f.path === "sequences[0].steps[0].variants[0].body")
      ?.reason,
    "match",
  );
});
test("CFD-AC04 parent omissions/null/wrong types stay distinct from defaults and children remain fixed", async () => {
  for (const [field, value, reason] of [
    ["campaign_schedule", undefined, "missing"],
    ["campaign_schedule", null, "null"],
    ["campaign_schedule", false, "wrong_type"],
    ["sequences", [], "mismatch"],
    ["email_list", ["private@example.invalid"], "non_empty"],
    ["stop_on_reply", undefined, "missing"],
  ] as const) {
    const h = await harness();
    if (value === undefined) delete h.body[field];
    else h.body[field] = value;
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(fields(r).find((f) => f.path === field)?.reason, reason);
    assert.equal(r.projection?.configuredGuardPassesNow, false);
    if (field === "campaign_schedule")
      assert.equal(
        fields(r).find(
          (f) => f.path === "campaign_schedule.schedules[0].timing.from",
        )?.reason,
        "missing",
      );
    assert.ok(!JSON.stringify(r).includes("private@example.invalid"));
  }
});
test("CFD-AC04 optional null/omission/conflict/invalid are reported separately from raw equality", async () => {
  for (const [key, value, state] of [
    ["ai_sdr_id", null, "null"],
    ["ai_sdr_id", bOther, "conflict"],
    ["is_evergreen", null, "null"],
    ["is_evergreen", true, "conflict"],
    ["stop_for_company", undefined, "omitted"],
    ["stop_for_company", "false", "invalid"],
  ] as const) {
    const h = await harness();
    delete h.body.sequences[0].steps[0].delay_unit;
    if (value === undefined) delete h.body[key];
    else h.body[key] = value;
    const r = await h.run();
    assert.equal(r.projection?.optionalFields[key], state);
    assert.equal(
      r.projection?.configuredGuardPassesNow,
      ["null", "omitted", "explicit"].includes(state),
    );
    assert.ok(bPublicSafe(r));
  }
});
test("CFD-AC04 all nested fixed groups locate their own differences", async () => {
  for (const [path, keys] of [
    [
      "campaign_schedule.schedules[0].timing.from",
      ["campaign_schedule", "schedules", 0, "timing", "from"],
    ],
    [
      "campaign_schedule.schedules[0].days.0",
      ["campaign_schedule", "schedules", 0, "days", "0"],
    ],
    ["sequences[0].steps[0].type", ["sequences", 0, "steps", 0, "type"]],
    ["sequences[0].steps[0].delay", ["sequences", 0, "steps", 0, "delay"]],
    [
      "sequences[0].steps[0].variants[0].subject",
      ["sequences", 0, "steps", 0, "variants", 0, "subject"],
    ],
    [
      "sequences[0].steps[0].variants[0].body",
      ["sequences", 0, "steps", 0, "variants", 0, "body"],
    ],
  ] as const) {
    const h = await harness();
    delete h.body.sequences[0].steps[0].delay_unit;
    let parent: any = h.body;
    for (const key of keys.slice(0, -1)) parent = parent[key];
    const key = keys.at(-1)!;
    parent[key] =
      typeof parent[key] === "boolean"
        ? !parent[key]
        : typeof parent[key] === "number"
          ? 9
          : "CFD_PRIVATE_SENTINEL";
    const r = await h.run();
    assert.equal(r.projection?.configuredGuardPassesNow, false);
    assert.notEqual(fields(r).find((f) => f.path === path)?.reason, "match");
    assert.ok(!JSON.stringify(r).includes("CFD_PRIVATE_SENTINEL"));
  }
});
test("CFD-AC04 no dynamic paths, values, string sizes or content hashes leak", async () => {
  const h = await harness();
  const step = h.body.sequences[0].steps[0];
  step["CFD_PRIVATE_FIELD_NAME"] = bSecret;
  step.variants[0].body = "CFD_PRIVATE_COPY";
  step.pre_delay = 0;
  step.variants[0].v_disabled = false;
  const r = await h.run(),
    printed = JSON.stringify(r);
  assert.ok(!printed.includes(bSecret));
  assert.ok(!printed.includes("CFD_PRIVATE_FIELD_NAME"));
  assert.ok(!printed.includes("CFD_PRIVATE_COPY"));
  assert.ok(!printed.includes(h.inputs.manifest.subject));
  assert.ok(!printed.includes(h.inputs.manifest.body));
  const body = fields(r).find(
    (f) => f.path === "sequences[0].steps[0].variants[0].body",
  )!;
  assert.equal(body.size, null);
  assert.equal(body.extraKeyCount, null);
  assert.equal(body.reason, "mismatch");
  assert.ok(
    fields(r).every(
      (f) => !Object.hasOwn(f, "value") && !Object.hasOwn(f, "hash"),
    ),
  );
  assert.equal(
    fields(r).find((f) => f.path === "sequences[0].steps[0].pre_delay")?.reason,
    "unexpected",
  );
  assert.equal(
    fields(r).find(
      (f) => f.path === "sequences[0].steps[0].variants[0].v_disabled",
    )?.reason,
    "unexpected",
  );
});
test("CFD-AC04 multiple array items expose counts only and property order is immaterial", async () => {
  const h = await harness();
  delete h.body.sequences[0].steps[0].delay_unit;
  h.body = Object.fromEntries(Object.entries(h.body).reverse());
  const match = await h.run();
  assert.equal(match.projection?.configuredGuardPassesNow, true);
  const k = await harness();
  k.body.sequences.push({ PRIVATE_INDEX_VALUE: bSecret });
  const r = await k.run();
  assert.equal(fields(r).find((f) => f.path === "sequences")?.size, 2);
  assert.equal(fields(r).length, 45);
  assert.ok(!JSON.stringify(r).includes("PRIVATE_INDEX_VALUE"));
  assert.ok(bPublicSafe(r));
});
test("CFD-AC03 identity mismatch discards projection and cannot follow another resource", async () => {
  for (const key of ["id", "name", "organization"]) {
    const h = await harness();
    h.body[key] = bOther;
    const r = await h.run();
    assert.equal(r.error, "CFD_IDENTITY_MISMATCH");
    assert.equal(r.projection, null);
    assert.equal(r.newCalls, 1);
    assert.equal(r.mutations, 0);
    assert.ok(bPublicSafe(r));
  }
});
test("CFD-AC06 nonpaused statuses preserve a projection but never issue pause or complete recovery", async () => {
  for (const value of [0, 1, 4, null, "2"]) {
    const h = await harness();
    h.body.status = value;
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(r.error, "CFD_NOT_PAUSED");
    assert.equal(r.projection?.currentPaused, false);
    assert.equal(r.projection?.configuredGuardPassesNow, false);
    assert.equal(r.calls, 28);
    assert.equal(h.calls.length, 1);
    assert.equal(r.mutations, 0);
  }
});
test("CFD-AC04 invalid roots, inherited identity and uncomparable structures fail closed", async () => {
  const h = await harness();
  for (const root of [null, [], false, bSecret])
    assert.throws(
      () =>
        configuredCampaignProjection(
          h.inputs.source,
          h.inputs.manifest,
          bWorkspace,
          root,
        ),
      /CFD_INVALID_CAMPAIGN_RESPONSE/,
    );
  const inherited = Object.create(h.body);
  assert.throws(
    () =>
      configuredCampaignProjection(
        h.inputs.source,
        h.inputs.manifest,
        bWorkspace,
        inherited,
      ),
    /CFD_IDENTITY_MISMATCH/,
  );
  const cycle = structuredClone(h.body);
  cycle.sequences[0].steps[0].loop = cycle;
  assert.throws(
    () =>
      configuredCampaignProjection(
        h.inputs.source,
        h.inputs.manifest,
        bWorkspace,
        cycle,
      ),
    /CFD_INVALID_PROJECTION/,
  );
});
test("CFD-AC05 at most one transient retry reaches29 with durable backoff", async () => {
  for (const response of [
    Error(bSecret),
    bJson({}, 500),
    bJson({}, 429, { "retry-after": "6" }),
  ]) {
    const h = await harness();
    h.responses.push(response);
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(r.calls, 29);
    assert.equal(h.calls.length, 2);
    assert.ok(h.calls[1].time - h.calls[0].time >= 5000);
  }
});
test("CFD-AC05 two transient failures and long Retry-After stop at29 or28 without third GET", async () => {
  const h = await harness();
  h.responses.push(bJson({}, 503), bJson({}, 503), bJson(h.body));
  const r = await h.run();
  assert.equal(r.error, "HTTP_5XX");
  assert.equal(r.calls, 29);
  assert.equal(h.calls.length, 2);
  const k = await harness();
  k.responses.push(bJson({}, 429, { "retry-after": "61" }));
  const s = await k.run();
  assert.equal(s.error, "RETRY_WAIT_TOO_LONG");
  assert.equal(s.calls, 28);
  assert.equal(k.calls.length, 1);
});
test("CFD-AC05 auth/payment/permanent HTTP, redirects and invalid JSON never retry", async () => {
  const cases = [
    ...[400, 401, 402, 403, 404].map((c) => bJson({ message: bSecret }, c)),
    new Response(null, {
      status: 302,
      headers: { location: "https://private.invalid" },
    }),
    new Response("{invalid", {
      headers: { "content-type": "application/json" },
    }),
  ];
  for (const response of cases) {
    const h = await harness();
    h.responses.push(response);
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(r.calls, 28);
    assert.equal(h.calls.length, 1);
    assert.ok(bPublicSafe(r));
  }
});
test("CFD-AC05 declared and streamed response limits are enforced without retry", async () => {
  for (const response of [
    new Response("{}", {
      headers: {
        "content-length": String(2_097_153),
        "content-type": "application/json",
      },
    }),
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(2_097_153));
          c.close();
        },
      }),
      { headers: { "content-type": "application/json" } },
    ),
  ]) {
    const h = await harness();
    h.responses.push(response);
    const r = await h.run();
    assert.equal(r.error, "RESPONSE_LIMIT");
    assert.equal(r.calls, 28);
    assert.equal(h.calls.length, 1);
  }
});
test("CFD-AC05 shared eight-second bound counts two stalled reads", async (t) => {
  const h = await harness();
  let calls = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const promise = h.run({
    fetchImpl: async () => {
      calls++;
      return new Promise(() => {});
    },
  });
  for (let i = 0; i < 25 && calls < 1; i++) await turn();
  assert.equal(calls, 1);
  t.mock.timers.tick(8001);
  for (let i = 0; i < 30 && calls < 2; i++) await turn();
  assert.equal(calls, 2);
  t.mock.timers.tick(8001);
  const r = await promise;
  assert.equal(r.calls, 29);
  assert.equal(r.error, "NETWORK_OR_TIMEOUT");
});
test("CFD-AC07 cancellation before/during calls or during backoff never retries after abort", async () => {
  const h = await harness(),
    a = new AbortController();
  a.abort();
  const r = await h.run({ signal: a.signal });
  assert.equal(r.calls, 27);
  assert.equal(r.error, "CANCELLED");
  assert.equal(h.calls.length, 0);
  const k = await harness(),
    b = new AbortController();
  k.before = () => b.abort();
  const s = await k.run({ signal: b.signal });
  assert.equal(s.calls, 28);
  assert.equal(s.status, "failed");
  assert.equal(k.calls.length, 1);
  const q = await harness(),
    stop = new AbortController();
  q.clock.sleep = async () => {
    stop.abort();
    throw Error(bSecret);
  };
  q.responses.push(bJson({}, 503));
  const rr = await q.run({ signal: stop.signal });
  assert.equal(rr.error, "CANCELLED");
  assert.equal(rr.calls, 28);
  assert.equal(q.calls.length, 1);
});
test("CFD-AC07 storage before/after HTTP cannot refund, repeat or recover implicitly", async () => {
  for (const n of [1, 2, 3, 4]) {
    const h = await harness();
    h.store.failAt = n;
    await assert.rejects(h.run(), /CFD_STORAGE_OR_INTERNAL_FAILURE/);
    const before = JSON.stringify(h.store.value),
      calls = h.calls.length,
      writes = h.store.writes;
    if (h.store.value.version === 6) {
      const r = await h.run({}, noEnv);
      assert.equal(r.interruptedNeedsReview, true);
      assert.equal(h.calls.length, calls);
      assert.equal(h.store.writes, writes);
      assert.equal(JSON.stringify(h.store.value), before);
    }
  }
});
test("CFD-AC01/07 completed/failed replay is offline and strict journals reject edits or leaks", async () => {
  for (const failed of [false, true]) {
    const h = await harness();
    if (failed) h.responses.push(bJson({}, 401));
    await h.run();
    const before = structuredClone(h.store.value),
      n = h.calls.length,
      w = h.store.writes;
    const r = await h.run({}, noEnv);
    assert.equal(r.status, failed ? "failed" : "completed");
    assert.equal(h.calls.length, n);
    assert.equal(h.store.writes, w);
    assert.deepEqual(h.store.value, before);
  }
  const h = await harness();
  await h.run();
  const good = validateCFDState(h.store.value);
  for (const change of [
    (s: CFDState) => {
      s.calls = 27;
    },
    (s: CFDState) => {
      s.prior.calls = 26;
    },
    (s: CFDState) => {
      s.projection!.fields[0].path = "PRIVATE_DYNAMIC" as never;
    },
    (s: CFDState) => {
      (s.projection!.fields[0] as any).value = bSecret;
    },
    (s: CFDState) => {
      s.projection!.fields[0].size = 5;
    },
    (s: CFDState) => {
      s.projection!.currentPaused = false;
    },
    (s: CFDState) => {
      s.projection!.configuredGuardPassesNow = true;
    },
    (s: CFDState) => {
      s.projection!.optionalFields.ai_sdr_id = "explicit";
    },
    (s: CFDState) => {
      s.status = "failed";
      s.error = "HTTP_401";
    },
  ]) {
    const s = structuredClone(good);
    change(s);
    assert.throws(() => validateCFDState(s));
  }
  const next = structuredClone(good);
  next.projection!.fields[0].reason = "mismatch";
  assert.throws(() => assertCFDTransition(good, next));
  for (const change of [
    (s: CFDState) => {
      s.projection!.fields.find((r) => r.path === "campaign_schedule")!.size =
        99;
    },
    (s: CFDState) => {
      s.projection!.fields.find(
        (r) => r.path === "campaign_schedule",
      )!.extraKeyCount = 1;
    },
    (s: CFDState) => {
      s.projection!.fields.find((r) => r.path === "ai_sdr_id")!.reason =
        "mismatch";
    },
    (s: CFDState) => {
      s.projection!.fields.find((r) => r.path === "sequences")!.reason =
        "non_empty";
    },
  ]) {
    const s = structuredClone(good);
    change(s);
    assert.throws(() => validateCFDState(s));
  }
  assert.ok(bPublicSafe(cfdReport(good)));
});
async function temporary(fn: (dir: string) => Promise<void>) {
  const base = resolve(".local/pipeline-os-tests");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(resolve(base, "instant-cfd-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function fixtureFiles(dir: string) {
  const f = await cfdSourceFixture(),
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
test("CFD-AC01/07 fictional migration preserves27 bytes and blocks every legacy effect/downgrade", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      before = await readFile(f.journal, "utf8");
    const r = await f.files.locked(() =>
      runInstantlyConfigDiagnostic(bEnv, f.files.cfdStore, f.inputs, {
        execute: true,
        authorizedNew: 2,
        authorizedTotal: 29,
        includedCallsConfirmed: true,
        manifestReviewed: true,
        clock: new BClock(),
        fetchImpl: async () => bJson(f.body),
      }),
    );
    assert.equal(r.calls, 28);
    const s = validateCFDState(await f.files.allStore.load());
    assert.equal(JSON.stringify(s.prior, null, 2) + "\n", before);
    for (const store of [
      f.files.store,
      f.files.ledgerStore,
      f.files.bStore,
      f.files.diagnosticStore,
      f.files.brStore,
    ])
      await assert.rejects(store.load(), /CFD_LEDGER_SUPERSEDES_BR/);
    for (const state of [
      f.inputs.source,
      f.inputs.source.prior,
      f.inputs.source.prior.prior,
    ])
      await assert.rejects(
        f.files.allStore.save(state),
        /CFD_LEDGER_SUPERSEDES_BR/,
      );
    const beforeReplay = await readFile(f.journal, "utf8");
    const same = await runInstantlyConfigDiagnostic(
      noEnv,
      f.files.cfdStore,
      await f.files.cfdInputs(),
      {
        execute: true,
        authorizedNew: 2,
        authorizedTotal: 29,
        includedCallsConfirmed: true,
        manifestReviewed: true,
      },
    );
    assert.equal(same.calls, 28);
    assert.equal(await readFile(f.journal, "utf8"), beforeReplay);
    assert.equal(
      (await readdir(f.folder)).filter((n) => /\.lock$|\.tmp$/.test(n)).length,
      0,
    );
  }));
test("CFD-AC07 foreign locks/tmp, bad schemas and large inputs cannot be overwritten", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir);
    await writeFile(f.journal + ".lock", "FOREIGN");
    await assert.rejects(
      f.files.locked(async () => {}),
      /INSTANTLY_JOURNAL_LOCKED/,
    );
    assert.equal(await readFile(f.journal + ".lock", "utf8"), "FOREIGN");
    let first: CFDState | undefined;
    await runInstantlyConfigDiagnostic(
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
        authorizedNew: 2,
        authorizedTotal: 29,
        includedCallsConfirmed: true,
        manifestReviewed: true,
      },
    ).catch(() => {});
    assert.ok(first);
    await writeFile(f.journal + ".tmp", "FOREIGN");
    await assert.rejects(f.files.cfdStore.save(first!), /EEXIST/);
    assert.equal(await readFile(f.journal + ".tmp", "utf8"), "FOREIGN");
    await writeFile(
      resolve(f.folder, "s00-instantly-b-manifest.json"),
      " ".repeat(65537),
    );
    await assert.rejects(
      f.files.cfdInputs(),
      /B_INPUT_FILE_INVALID_OR_MISSING/,
    );
    await writeFile(f.journal, "{}");
    await assert.rejects(f.files.allStore.load());
    await writeFile(f.journal, " ".repeat(65537));
    await assert.rejects(
      f.files.allStore.load(),
      /INSTANTLY_JOURNAL_READ_FAILED/,
    );
  }));
test("CFD-AC02/03 CLI pure fixture GET, status/replay and gates never autoload or send", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      guard = resolve(dir, "read-only.mjs"),
      calls = resolve(dir, "calls.txt");
    await writeFile(resolve(dir, "body.json"), JSON.stringify(f.body));
    await writeFile(
      resolve(dir, ".env.local"),
      "INSTANTLY_API_KEY=ENV_AUTOLOAD_FORBIDDEN\n",
    );
    await writeFile(
      guard,
      `import{readFileSync,appendFileSync}from'node:fs';globalThis.fetch=async(raw,init)=>{if(init.method!=='GET'||init.body!==undefined||new URL(String(raw)).search)throw Error('NON_GET_FORBIDDEN');appendFileSync('calls.txt','GET\\n');return new Response(readFileSync('body.json','utf8'),{headers:{'content-type':'application/json'}});};`,
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
          timeout: 15000,
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
      ["--phase", "B_CONFIG_DIAGNOSTIC"],
      ["--check-b-config-diagnostic"],
    ]) {
      const p = run(flags);
      assert.equal(p.status, 0, p.stderr);
      assert.ok(!(p.stdout + p.stderr).includes(bSecret));
    }
    for (const flags of [
      ["--phase", "B_CONFIG_DIAGNOSTIC", "--execute"],
      ["--check-b-config-diagnostic", "--phase", "B_RECOVERY"],
      ["--check-b-config-diagnostic", "--execute"],
      ["--phase", "B_CONFIG_DIAGNOSTIC", "--included-calls-confirmed"],
    ])
      assert.equal(run(flags).status, 2);
    assert.equal(await readFile(f.journal, "utf8"), before);
    await assert.rejects(readFile(calls), { code: "ENOENT" });
    const flags = [
        "--phase",
        "B_CONFIG_DIAGNOSTIC",
        "--execute",
        "--authorized-new",
        "2",
        "--authorized-total",
        "29",
        "--included-calls-confirmed",
        "--manifest-reviewed",
      ],
      p = run(flags, true);
    assert.equal(p.status, 0, p.stderr);
    const r = JSON.parse(p.stdout);
    assert.equal(r.calls, 28);
    assert.equal(r.mutations, 0);
    assert.ok(bPublicSafe(r));
    const saved = await readFile(f.journal, "utf8");
    assert.equal(run(flags).status, 0);
    assert.equal(run([]).status, 0);
    assert.equal(run(["--phase", "B_RECOVERY"]).status, 2);
    assert.equal(run(["--check-b-diagnostic"]).status, 2);
    assert.equal(await readFile(f.journal, "utf8"), saved);
    assert.equal((await readFile(calls, "utf8")).trim(), "GET");
    assert.equal(
      (await readdir(f.folder)).filter((n) => /\.lock$|\.tmp$/.test(n)).length,
      0,
    );
  }));
