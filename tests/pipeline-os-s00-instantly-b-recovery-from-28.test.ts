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
import { br28SourceFixture } from "./fixtures/pipeline-os-instantly-b-recovery-from-28";
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
  runInstantlyBRecoveryFrom28,
  validateBR28Source,
  validateBR28Inputs,
  validateBR28State,
  assertBR28Transition,
  br28Request,
  br28Report,
  type BR28State,
  type BR28Store,
} from "../scripts/pipeline-os/s00-instantly-b-recovery-from-28";
import type { CFDState } from "../scripts/pipeline-os/s00-instantly-config-diagnostic";
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
class Memory implements BR28Store {
  value: CFDState | BR28State;
  writes = 0;
  failAt = -1;
  constructor(source: CFDState) {
    this.value = structuredClone(source);
  }
  async load() {
    return structuredClone(this.value);
  }
  async save(s: BR28State) {
    if (++this.writes === this.failAt) throw Error(bSecret);
    assertBR28Transition(this.value, s);
    this.value = structuredClone(s);
  }
}
async function harness() {
  const f = await br28SourceFixture(),
    store = new Memory(f.inputs.source),
    clock = new BClock();
  const calls: {
    step: string;
    purpose: string;
    bucket: string;
    method: string;
    path: string;
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
      opts: Parameters<typeof runInstantlyBRecoveryFrom28>[3] = {},
      env: Readonly<Record<string, string | undefined>> = bEnv,
    ) =>
      runInstantlyBRecoveryFrom28(env, store, h.inputs, {
        execute: true,
        authorizedNew: 20,
        authorizedTotal: 48,
        includedCallsConfirmed: true,
        manifestReviewed: true,
        fetchImpl,
        clock,
        ...opts,
      }),
  };
  const fetchImpl: typeof fetch = async (raw, init) => {
    const s = validateBR28State(store.value),
      q = s.requests.at(-1)!;
    assert.equal(q.result, "IN_FLIGHT");
    assert.equal(s.calls, 29 + calls.length);
    assert.deepEqual(s.prior, h.inputs.source);
    const url = new URL(String(raw));
    assert.equal(url.origin, "https://api.instantly.ai");
    assert.equal(init?.redirect, "manual");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer " + bSecret,
    );
    assert.ok(
      !(init?.method === "PATCH" && url.pathname.includes("/campaigns/")),
    );
    calls.push({
      step: q.step,
      purpose: q.purpose,
      bucket: q.bucket,
      method: init!.method!,
      path: url.pathname,
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

test("BR28-AC02 default source28 or absent source never reads env, saves or calls HTTP", async () => {
  const f = await br28SourceFixture();
  for (const source of [undefined, f.inputs.source]) {
    const r = await runInstantlyBRecoveryFrom28(
      noEnv,
      {
        load: async () => source,
        save: async () => {
          throw Error("SAVE_FORBIDDEN");
        },
      },
      undefined,
    );
    assert.equal(r.status, "not_started");
    assert.equal(r.calls, source ? 28 : 0);
    assert.equal(r.newCalls, 0);
    assert.equal(r.sourceAvailable, !!source);
  }
});
test("BR28-AC01/02 exact source, dedicated gates and bindings reject before effects", async () => {
  for (const options of [
    { authorizedNew: 22 },
    { authorizedTotal: 41 },
    { includedCallsConfirmed: false },
    { manifestReviewed: false },
  ]) {
    const h = await harness();
    await assert.rejects(h.run(options, noEnv));
    assert.equal(h.store.writes, 0);
    assert.equal(h.calls.length, 0);
  }
  const f = await br28SourceFixture();
  assert.doesNotThrow(() => validateBR28Source(f.inputs.source));
  for (const change of [
    (s: any) => (s.calls = 29),
    (s: any) => (s.status = "failed"),
    (s: any) => (s.projection.configuredGuardPassesNow = true),
    (s: any) => (s.prior.stage = 4),
    (s: any) =>
      (s.projection.fields.find((r: any) =>
        r.path.endsWith(".pre_delay_unit"),
      ).observedType = "null"),
  ]) {
    const source = structuredClone(f.inputs.source);
    change(source);
    assert.throws(() => validateBR28Source(source));
  }
  const h = await harness();
  h.inputs.manifest.recipients[0] = "other@example.invalid";
  await assert.rejects(h.run({}, noEnv));
  assert.equal(h.store.writes, 0);
  const changed = await harness();
  await assert.rejects(
    changed.run({}, { ...bEnv, INSTANTLY_API_KEY: "different" }),
    { message: "INSTANTLY_BINDING_CHANGED" },
  );
  assert.equal(changed.store.writes, 0);
});
test("BR28-AC03/04/05 normal14 ends42 without reconfiguring and preserves history28", async () => {
  const h = await harness(),
    source = structuredClone(h.inputs.source),
    campaign = structuredClone(h.provider.campaign),
    r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 42);
  assert.equal(r.newCalls, 14);
  assert.equal(r.stage, 13);
  assert.equal(r.leadsRecorded, 2);
  assert.equal(r.campaignReconfigured, false);
  assert.equal(r.sendingSafetyCertified, false);
  assert.deepEqual(h.provider.campaign, campaign);
  assert.deepEqual(validateBR28State(h.store.value).prior, source);
  assert.ok(bPublicSafe(r));
  assert.equal(writes(h).length, 3);
  for (const c of writes(h)) {
    assert.ok(!/activate|resume|send|verify|enrich|delete/.test(c.path));
    if (c.method === "POST") {
      assert.equal(c.body.verify_leads_on_import, false);
      assert.equal(c.body.verify_leads_for_lead_finder, false);
    }
  }
  assert.equal(h.provider.leads[0].payload.s00_hold, true);
  assert.equal(h.provider.leads[1].payload.s00_hold, false);
  for (let i = 1; i < h.calls.length; i++)
    assert.ok(h.calls[i].time - h.calls[i - 1].time >= 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(h.store.value, null, 2)) < 65536);
});
test("BR28-AC04 third empty terminal audience page gives15 normal and43 cumulative", async () => {
  const h = await harness();
  h.provider.threePages = true;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 43);
  assert.equal(r.budget.normal, 15);
  assert.equal(h.calls.filter((c) => c.step === "audience").length, 3);
});

test("BR28-AC03 preflight drift, incompatible units, capacity and nonempty audience stop before effects", async () => {
  const cases: [string, (body: any) => void][] = [
    ["workspace", (b) => (b.id = bOther)],
    ["plan", (b) => (b.subscriptions.outreach.current_lead_count = 25000)],
    ...["id", "name", "organization"].map(
      (k) =>
        ["current", (b: any) => (b[k] = bOther)] as [
          string,
          (body: any) => void,
        ],
    ),
    ["current", (b) => (b.status = 1)],
    ["current", (b) => (b.status = 0)],
    ["current", (b) => (b.email_list = ["sender@example.invalid"])],
    ["current", (b) => (b.stop_on_reply = false)],
    ["current", (b) => (b.campaign_schedule.schedules[0].timezone = "UTC")],
    ["current", (b) => (b.sequences[0].steps[0].delay_unit = "minutes")],
    ["current", (b) => (b.sequences[0].steps[0].pre_delay_unit = null)],
    ["current", (b) => (b.sequences[0].steps[0].variants[0].body = "changed")],
    ["empty", (b) => (b.items = [{ id: bId(999) }])],
  ];
  for (const [at, change] of cases) {
    const h = await harness();
    h.after = (body, step) => {
      if (step === at) change(body);
      return undefined;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(writes(h).length, 0);
    assert.equal(h.calls.filter((c) => c.bucket === "H").length, 0);
    const calls = h.calls.length,
      saves = h.store.writes;
    assert.equal((await h.run({}, noEnv)).status, "failed");
    assert.equal(h.calls.length, calls);
    assert.equal(h.store.writes, saves);
  }
  const h = await harness();
  delete h.provider.campaign!.sequences[0].steps[0].delay_unit;
  delete h.provider.campaign!.sequences[0].steps[0].pre_delay_unit;
  assert.equal((await h.run()).status, "completed");
});
test("BR28-AC08 builder denies configure, create/search campaign, foreign cursors and unknown effects", async () => {
  const h = await harness();
  await h.run();
  const s = validateBR28State(h.store.value);
  for (const step of [
    "configure",
    "configured",
    "initial",
    "create",
    "search",
    "pause",
    "activate",
    "send",
    "delete",
    "verify",
    "enrich",
  ]) {
    assert.throws(() => br28Request(s, h.inputs.manifest, step as any), {
      message: "BR28_BLOCKED_ROUTE",
    });
  }
  assert.throws(
    () => br28Request(s, h.inputs.manifest, "createA", { cursor: "foreign" }),
    { message: "BR28_BLOCKED_ROUTE" },
  );
  assert.throws(
    () => br28Request(s, h.inputs.manifest, "current", { reconcile: true }),
    { message: "BR28_BLOCKED_ROUTE" },
  );
  assert.equal(br28Request(s, h.inputs.manifest, "current").method, "GET");
  assert.equal(
    br28Request(s, h.inputs.manifest, "emergency_pause").method,
    "POST",
  );
});
test("BR28-AC06 all three uncertain writes reconcile once without duplicate mutation", async () => {
  for (const at of ["createA", "createB", "updateA"]) {
    const h = await harness();
    h.after = (_, step, count) =>
      step === at && count === 1 ? Error(bSecret) : undefined;
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(r.budget.reserve, 1);
    assert.equal(
      h.calls.filter((c) => c.step === at && c.purpose === "normal").length,
      1,
    );
    assert.equal(h.provider.leads.length, 2);
    assert.equal(
      h.calls.filter((c) => c.step === at && c.purpose === "reconcile").length,
      1,
    );
  }
});
test("BR28-AC04 skip or unresolved/ambiguous contact never creates a replacement", async () => {
  for (const mode of ["skip", "absent", "ambiguous"]) {
    const h = await harness();
    h.after = (body, step, count) => {
      if (step !== "createA") return;
      if (mode === "skip" && count === 1) {
        body.skipped = true;
        return;
      }
      if (count === 1) return Error(bSecret);
      if (mode === "absent") body.items = [];
      else body.items.push(structuredClone(body.items[0]));
      return;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(
      h.calls.filter((c) => c.step === "createA" && c.purpose === "normal")
        .length,
      1,
    );
    assert.equal(
      h.calls.some((c) => c.step === "createB"),
      false,
    );
    assert.equal(h.provider.leads.length, 1);
    assert.equal(r.emergency, "verified_paused");
  }
});
test("BR28-AC04 duplicate, foreign and cursor drift in audience stop without a fourth page", async () => {
  for (const mode of ["duplicate", "foreign", "cursor", "extra"]) {
    const h = await harness();
    h.after = (body, step, count) => {
      if (step !== "audience") return;
      if (mode === "foreign") body.items[0].id = bId(999);
      if (mode === "duplicate" && count === 2)
        body.items = [structuredClone(h.provider.leads[0])];
      if (mode === "cursor" && count === 2)
        body.next_starting_after = h.provider.leads[0].id;
      if (mode === "extra") body.items.push(structuredClone(body.items[0]));
      return;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.ok(h.calls.filter((c) => c.step === "audience").length <= 3);
    assert.equal(
      h.calls.some((c) => c.step === "updateA"),
      false,
    );
    assert.equal(h.provider.leads.length, 2);
  }
});
test("BR28-AC05 isolation and final guards cannot complete after emergency", async () => {
  for (const at of ["recheckA", "recheckB", "final"]) {
    const h = await harness();
    h.after = (body, step) => {
      if (step === at) {
        if (at === "final") body.stop_on_reply = false;
        else body.payload.extra_field = "changed";
      }
      return;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(r.closedNonSending, false);
    assert.equal(r.emergency, "verified_paused");
    assert.equal(r.sendingSafetyCertified, false);
  }
});
test("BR28-AC06 transients retry reads once with backoff; permanent and long waits stop", async () => {
  const h = await harness();
  h.before = (step, count) =>
    step === "workspace" && count === 1
      ? bJson({}, 429, { "retry-after": "6" })
      : undefined;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 43);
  assert.ok(h.clock.waits.includes(6000));
  for (const status of [400, 401, 402, 403, 404]) {
    const g = await harness();
    g.before = () => bJson({ private: bSecret }, status);
    const out = await g.run();
    assert.equal(out.status, "failed");
    assert.equal(g.calls.length, 1);
    assert.equal(out.budget.reserve, 0);
    assert.ok(bPublicSafe(out));
  }
  const g = await harness();
  g.before = () => bJson({}, 429, { "retry-after": "61" });
  const out = await g.run();
  assert.equal(out.error, "RETRY_WAIT_TOO_LONG");
  assert.equal(g.calls.length, 1);
});
test("BR28-AC06 exhausted shared reserve blocks first write with emergency untouched", async () => {
  const h = await harness();
  h.before = (step, count) =>
    ["workspace", "plan", "current"].includes(step) && count === 1
      ? bJson({}, 503)
      : undefined;
  const r = await h.run();
  assert.equal(r.status, "failed");
  assert.equal(r.error, "BR28_RESERVE_REQUIRED");
  assert.equal(r.calls, 35);
  assert.equal(r.budget.reserve, 3);
  assert.equal(r.budget.hold, 0);
  assert.equal(writes(h).length, 0);
});
test("BR28-AC06 worst case N15/R3/H2 reaches20 new and48 cumulative without exceeding", async () => {
  const h = await harness();
  h.provider.threePages = true;
  h.before = (step, count) =>
    ["getA", "getB", "recheckA"].includes(step) && count === 1
      ? bJson({}, 503)
      : step === "final"
        ? bJson({}, 400)
        : undefined;
  const r = await h.run();
  assert.equal(r.status, "failed");
  assert.equal(r.calls, 48);
  assert.equal(r.newCalls, 20);
  assert.deepEqual(
    [r.budget.normal, r.budget.reserve, r.budget.hold],
    [15, 3, 2],
  );
  assert.equal(r.emergency, "verified_paused");
  assert.equal(h.calls.length, 20);
  assert.ok(Buffer.byteLength(JSON.stringify(h.store.value, null, 2)) < 65536);
});
test("BR28-AC07 identity/auth failures after mutation cannot trigger another resource effect", async () => {
  for (const mode of ["identity", "tenant", "auth"]) {
    const h = await harness();
    h.after = (body, step) => {
      if (step !== "getA") return;
      if (mode === "auth") return bJson({}, 403);
      if (mode === "identity") body.id = bId(999);
      else body.organization = bOther;
      return;
    };
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(r.budget.hold, 0);
    assert.equal(writes(h).length, 1);
    assert.ok(!h.calls.some((c) => c.path.includes(bId(999))));
  }
});
test("BR28-AC07 uncertain emergency pause never repeats pause; failed check is unverified", async () => {
  for (const failCheck of [false, true]) {
    const h = await harness();
    h.after = (_, step) =>
      step === "final" ||
      step === "emergency_pause" ||
      (failCheck && step === "emergency_check")
        ? Error(bSecret)
        : undefined;
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(r.emergency, failCheck ? "unverified" : "verified_paused");
    assert.equal(h.calls.filter((c) => c.step === "emergency_pause").length, 1);
    assert.equal(h.calls.filter((c) => c.step === "emergency_check").length, 1);
  }
});
test("BR28-AC07 storage before reservation or after HTTP never retries or refunds", async () => {
  for (const failAt of [1, 2, 3]) {
    const h = await harness();
    h.store.failAt = failAt;
    await assert.rejects(h.run(), {
      message: "BR28_STORAGE_OR_INTERNAL_FAILURE",
    });
    assert.equal(h.calls.length, failAt === 3 ? 1 : 0);
    const count = h.calls.length;
    const r = await h.run(failAt === 1 ? { execute: false } : {}, noEnv);
    assert.equal(r.status, failAt === 1 ? "not_started" : "running");
    assert.equal(h.calls.length, count);
    assert.equal(h.store.value.calls, failAt === 3 ? 29 : 28);
  }
  const h = await harness();
  h.after = (_, step) => {
    if (step === "createA") h.store.failAt = h.store.writes + 1;
    return undefined;
  };
  await assert.rejects(h.run(), {
    message: "BR28_STORAGE_OR_INTERNAL_FAILURE",
  });
  assert.equal(h.calls.length, 5);
  assert.equal(h.provider.leads.length, 1);
  assert.equal(
    h.calls.some((q) => q.bucket === "H"),
    false,
  );
  assert.equal((await h.run({}, noEnv)).status, "running");
  assert.equal(h.calls.length, 5);
  assert.equal(h.store.value.calls, 33);
});
test("BR28-AC07 abort before HTTP or after first write preserves counts and bounded emergency", async () => {
  const h = await harness(),
    controller = new AbortController();
  controller.abort();
  const r = await h.run({ signal: controller.signal });
  assert.equal(r.error, "CANCELLED");
  assert.equal(r.calls, 28);
  assert.equal(h.calls.length, 0);
  const g = await harness(),
    c = new AbortController();
  g.after = (_, step) => {
    if (step === "createA") c.abort();
    return;
  };
  const out = await g.run({ signal: c.signal });
  assert.equal(out.status, "failed");
  assert.equal(out.error, "CANCELLED");
  assert.equal(out.emergency, "verified_paused");
  assert.equal(out.calls, 35);
  assert.equal(
    g.calls.some((q) => q.step === "createB"),
    false,
  );
});
test("BR28-AC01/07 strict state and transitions reject rollback, forged progress and terminal replay", async () => {
  const h = await harness();
  await h.run();
  const s = validateBR28State(h.store.value),
    bytes = JSON.stringify(s);
  const out = await h.run({}, noEnv);
  assert.equal(out.calls, 42);
  assert.equal(h.calls.length, 14);
  assert.equal(JSON.stringify(h.store.value), bytes);
  for (const change of [
    (x: any) => (x.calls = 28),
    (x: any) => x.normal--,
    (x: any) => x.stage--,
    (x: any) => (x.prior.calls = 29),
    (x: any) => (x.campaignVerified = false),
    (x: any) => (x.leads.B = x.leads.A),
    (x: any) => (x.requests[0].step = "plan"),
    (x: any) => (x.requests.at(-1).result = "IN_FLIGHT"),
    (x: any) => (x.private = bSecret),
  ]) {
    const v = structuredClone(s);
    change(v);
    assert.throws(() => validateBR28State(v));
  }
  const v = structuredClone(s);
  v.status = "running";
  assert.throws(() => assertBR28Transition(s, v));
});

test("BR28-AC06 reconciliation retries a transient read without repeating create", async () => {
  const h = await harness();
  h.after = (_, step, count) =>
    step === "createA" && count === 1 ? Error(bSecret) : undefined;
  h.before = (step, count) =>
    step === "createA" && count === 2 ? bJson({}, 503) : undefined;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.budget.reserve, 2);
  assert.equal(r.calls, 44);
  assert.equal(
    h.calls.filter(
      (c) =>
        c.step === "createA" &&
        c.method === "POST" &&
        c.path === "/api/v2/leads",
    ).length,
    1,
  );
});
test("BR28-AC06 shared timeout8s counts two stalled reads and cannot make a third", async (t) => {
  const h = await harness();
  let count = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = h.run({
    fetchImpl: async () => {
      count++;
      return new Promise(() => {});
    },
  });
  for (let i = 0; i < 30 && count < 1; i++) await turn();
  assert.equal(count, 1);
  t.mock.timers.tick(8001);
  for (let i = 0; i < 30 && count < 2; i++) await turn();
  assert.equal(count, 2);
  t.mock.timers.tick(8001);
  const r = await pending;
  assert.equal(r.calls, 30);
  assert.equal(r.error, "NETWORK_OR_TIMEOUT");
  assert.equal(count, 2);
});

async function temporary(work: (dir: string) => Promise<void>) {
  const root = resolve(".local/pipeline-os-tests");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(resolve(root, "br28-"));
  try {
    await work(dir);
  } finally {
    assert.equal(
      resolve(dir).startsWith(root + "\\") ||
        resolve(dir).startsWith(root + "/"),
      true,
    );
    await rm(dir, { recursive: true, force: true });
  }
}
async function fixtureFiles(dir: string) {
  const f = await br28SourceFixture(),
    folder = resolve(dir, ".local/pipeline-os"),
    journal = resolve(folder, "s00-instantly-run.json");
  await mkdir(folder, { recursive: true });
  for (const [name, data] of [
    ["s00-instantly-run.json", f.inputs.source],
    ["s00-instantly-scope-attestation.json", f.inputs.scope],
    ["s00-instantly-b-manifest.json", f.inputs.manifest],
  ] as const)
    await writeFile(
      resolve(folder, name),
      JSON.stringify(data, null, 2) + "\n",
    );
  return { ...f, folder, journal, files: instantlyFiles(dir) };
}
test("BR28-AC01/07 files migrate only fictional v6, retain28 bytes and block all legacy effects", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      before = await readFile(f.journal, "utf8");
    const r = await f.files.locked(() =>
      runInstantlyBRecoveryFrom28(bEnv, f.files.br28Store, f.inputs, {
        execute: true,
        authorizedNew: 20,
        authorizedTotal: 48,
        includedCallsConfirmed: true,
        manifestReviewed: true,
        clock: new BClock(),
        fetchImpl: async (raw, init) =>
          bJson(f.provider.handle(String(raw), init!)),
      }),
    );
    assert.equal(r.status, "completed");
    const s = validateBR28State(await f.files.allStore.load());
    assert.equal(JSON.stringify(s.prior, null, 2) + "\n", before);
    assert.ok(Buffer.byteLength(await readFile(f.journal)) < 65536);
    for (const load of [
      () => f.files.store.load(),
      () => f.files.ledgerStore.load(),
      () => f.files.bStore.load(),
      () => f.files.diagnosticStore.load(),
      () => f.files.brStore.load(),
      () => f.files.cfdStore.load(),
      () => f.files.bInputs(),
      () => f.files.diagnosticInputs(),
      () => f.files.brInputs(),
      () => f.files.cfdInputs(),
    ])
      await assert.rejects(load, { message: "BR28_LEDGER_SUPERSEDES_CFD" });
    await assert.rejects(f.files.allStore.save(f.inputs.source), {
      message: "BR28_LEDGER_SUPERSEDES_CFD",
    });
    assert.equal((await f.files.br28Inputs()).source.calls, 28);
    assert.equal((await f.files.br28Store.load())?.calls, 42);
    assert.equal(
      (await readdir(f.folder)).some((n) => /\.lock$|\.tmp$/.test(n)),
      false,
    );
  }));
test("BR28-AC07 foreign locks/tmp and oversized/corrupt journals preserve the fictional source", () =>
  temporary(async (dir) => {
    const f = await fixtureFiles(dir),
      before = await readFile(f.journal, "utf8"),
      lock = f.journal + ".lock",
      tmp = f.journal + ".tmp";
    await writeFile(lock, bSecret);
    await assert.rejects(
      f.files.locked(async () => {}),
      { message: "INSTANTLY_JOURNAL_LOCKED" },
    );
    assert.equal(await readFile(lock, "utf8"), bSecret);
    await rm(lock);
    await writeFile(tmp, bSecret);
    await assert.rejects(
      f.files.locked(() =>
        runInstantlyBRecoveryFrom28(bEnv, f.files.br28Store, f.inputs, {
          execute: true,
          authorizedNew: 20,
          authorizedTotal: 48,
          includedCallsConfirmed: true,
          manifestReviewed: true,
        }),
      ),
      { message: "BR28_STORAGE_OR_INTERNAL_FAILURE" },
    );
    assert.equal(await readFile(tmp, "utf8"), bSecret);
    assert.equal(await readFile(f.journal, "utf8"), before);
    await rm(tmp);
    for (const body of [
      "{bad-json",
      JSON.stringify({ ...f.inputs.source, private: bSecret }),
      " ".repeat(65537),
    ]) {
      await writeFile(f.journal, body);
      await assert.rejects(f.files.br28Store.load());
      assert.equal(await readFile(f.journal, "utf8"), body);
    }
  }));
test("BR28-AC02/08 CLI fictional execution, replay, mixed modes and no autoload", () =>
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
      `import{BProvider}from '${fixture}';import{readFileSync,appendFileSync}from'node:fs';const p=new BProvider();p.campaign=JSON.parse(readFileSync('campaign.json','utf8'));globalThis.fetch=async(raw,init)=>{appendFileSync('calls.txt','HTTP\\n');const u=new URL(String(raw));if(u.origin!=='https://api.instantly.ai'||init.method==='PATCH'&&u.pathname.includes('/campaigns/')||init.method==='POST'&&u.pathname==='/api/v2/campaigns')throw Error('FORBIDDEN_CAMPAIGN_WRITE');return new Response(JSON.stringify(p.handle(String(raw),init)),{headers:{'content-type':'application/json'}});};`,
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
      ["--phase", "B_RECOVERY_FROM_28"],
      ["--check-b-recovery-from-28"],
    ]) {
      const p = run(flags);
      assert.equal(p.status, 0, p.stderr);
      assert.ok(bPublicSafe(JSON.parse(p.stdout)));
    }
    for (const flags of [
      ["--phase", "B_RECOVERY_FROM_28", "--execute"],
      ["--check-b-recovery-from-28", "--phase", "A"],
      ["--check-b-recovery-from-28", "--check-b-recovery"],
      ["--check-b-recovery-from-28", "--check-b-config-diagnostic"],
      ["--check-b-recovery-from-28", "--execute"],
      ["--phase", "B_RECOVERY_FROM_28", "--authorized-new", "20"],
    ])
      assert.equal(run(flags).status, 2);
    assert.equal(await readFile(f.journal, "utf8"), before);
    await assert.rejects(readFile(callsFile), { code: "ENOENT" });
    const flags = [
        "--phase",
        "B_RECOVERY_FROM_28",
        "--execute",
        "--authorized-new",
        "20",
        "--authorized-total",
        "48",
        "--included-calls-confirmed",
        "--manifest-reviewed",
      ],
      p = run(flags, true);
    assert.equal(p.status, 0, p.stderr);
    const r = JSON.parse(p.stdout);
    assert.equal(r.calls, 42);
    assert.equal(r.status, "completed");
    assert.ok(bPublicSafe(r));
    const saved = await readFile(f.journal, "utf8");
    assert.equal(run(flags).status, 0);
    assert.equal(run([]).status, 0);
    assert.equal(run(["--phase", "B_CONFIG_DIAGNOSTIC"]).status, 2);
    assert.equal(await readFile(f.journal, "utf8"), saved);
    assert.equal(
      (await readFile(callsFile, "utf8")).trim().split("\n").length,
      14,
    );
    assert.equal(
      (await readdir(f.folder)).some((n) => /\.lock$|\.tmp$/.test(n)),
      false,
    );
  }));
