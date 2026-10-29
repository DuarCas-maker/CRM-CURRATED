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
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setImmediate as turn } from "node:timers/promises";
import { hash } from "../scripts/pipeline-os/s00-composio-common";
import {
  cSourceFixture,
  cEnv,
  cToken,
  cDedup,
  cNow,
} from "./fixtures/pipeline-os-instantly-c";
import {
  bEnv,
  bId,
  bWorkspace,
  bOther,
  bSecret,
  bJson,
  BClock,
} from "./fixtures/pipeline-os-instantly-b";
import {
  runInstantlyC,
  validateCSource,
  validateCInputs,
  validateCState,
  assertCTransition,
  cRequest,
  cReport,
  type CState,
  type CStore,
} from "../scripts/pipeline-os/s00-instantly-c";
import {
  createCReceiver,
  cReceiptFiles,
  validateCReceipt,
  validateCManifest,
  cPayloadDigest,
  cSecrets,
  type CReceiptStore,
  type CReceiptState,
} from "../scripts/pipeline-os/s00-instantly-c-receiver";
import type { BR28State } from "../scripts/pipeline-os/s00-instantly-b-recovery-from-28";
import { instantlyFiles } from "../scripts/pipeline-os/s00-instantly-files";
import {
  instantlyWebhookJson,
  instantlyTrialJson,
} from "../scripts/pipeline-os/s00-instantly-runner";

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
class ReceiptMemory implements CReceiptStore {
  value?: CReceiptState;
  fail = false;
  async load() {
    if (this.fail) throw Error(bSecret);
    return this.value && structuredClone(this.value);
  }
  async transact(change: (p: CReceiptState | undefined) => CReceiptState) {
    if (this.fail) throw Error(bSecret);
    const next = change(await this.load());
    validateCReceipt(next);
    this.value = structuredClone(next);
  }
}
class Memory implements CStore {
  value: BR28State | CState;
  writes = 0;
  failAt = -1;
  constructor(source: BR28State) {
    this.value = structuredClone(source);
  }
  async load() {
    return structuredClone(this.value);
  }
  async save(s: CState) {
    if (++this.writes === this.failAt) throw Error(bSecret);
    assertCTransition(this.value, s);
    this.value = structuredClone(s);
  }
}
async function harness() {
  const f = await cSourceFixture(),
    store = new Memory(f.inputs.source),
    receipt = new ReceiptMemory(),
    clock = new BClock();
  clock.time = cNow;
  const calls: {
    step: string;
    purpose: string;
    bucket: string;
    method: string;
    url: URL;
    body: any;
    time: number;
  }[] = [];
  let receiver: ReturnType<typeof createCReceiver>,
    hook: Record<string, any> | undefined,
    log: Record<string, any> | undefined;
  const h = {
    ...f,
    store,
    receipt,
    clock,
    calls,
    twoHooks: false,
    twoLogs: false,
    noReceipt: false,
    noLog: false,
    wrongContext: false,
    before: undefined as
      | undefined
      | ((step: string, count: number) => Response | Error | undefined),
    after: undefined as
      | undefined
      | ((
          body: any,
          step: string,
          count: number,
        ) =>
          Response | Error | undefined | Promise<Response | Error | undefined>),
    get receiver() {
      return receiver;
    },
    get hook() {
      return hook;
    },
    get log() {
      return log;
    },
    run: (
      opts: Parameters<typeof runInstantlyC>[3] = {},
      env: Readonly<Record<string, string | undefined>> = cEnv,
    ) =>
      runInstantlyC(env, store, h.inputs, {
        execute: true,
        authorizedNew: 19,
        authorizedTotal: 62,
        includedCallsConfirmed: true,
        webhooksIncludedConfirmed: true,
        manifestReviewed: true,
        receiverReady: true,
        clock,
        fetchImpl,
        receiverFactory: (input) => {
          receiver = createCReceiver({ ...input, store: receipt });
          return receiver;
        },
        ...opts,
      }),
  };
  const fetchImpl: typeof fetch = async (raw, init) => {
    const s = validateCState(store.value),
      q = s.requests.at(-1)!;
    assert.equal(q.result, "IN_FLIGHT");
    assert.equal(s.calls, 44 + calls.length);
    assert.deepEqual(s.prior, h.inputs.source);
    const url = new URL(String(raw));
    assert.equal(url.origin, "https://api.instantly.ai");
    assert.equal(init?.redirect, "manual");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer " + bSecret,
    );
    calls.push({
      step: q.step,
      purpose: q.purpose,
      bucket: q.bucket,
      method: init!.method!,
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      time: clock.now(),
    });
    const count = calls.filter((x) => x.step === q.step).length,
      pre = h.before?.(q.step, count);
    if (pre instanceof Error) throw pre;
    if (pre) return pre;
    let body: any;
    const p = url.pathname,
      method = init?.method;
    if (p === "/api/v2/webhooks" && method === "POST") {
      hook = {
        ...JSON.parse(String(init!.body)),
        id: bId(80),
        organization: bWorkspace,
        status: 1,
      };
      body = hook;
    } else if (p === "/api/v2/webhooks" && method === "GET") {
      if (hook) body = { items: [hook] };
      else if (h.twoHooks && !url.searchParams.has("starting_after"))
        body = {
          items: [
            {
              id: bId(70),
              organization: bWorkspace,
              campaign: h.provider.campaign!.id,
              event_type: "reply_received",
              target_hook_url: "https://other.example.invalid/untouched",
              name: "Existing untouched hook",
            },
          ],
          next_starting_after: bId(70),
        };
      else body = { items: [] };
    } else if (p === `/api/v2/webhooks/${bId(80)}/test` && method === "POST") {
      const payload = {
        timestamp: new Date(clock.now()).toISOString(),
        event_type: "reply_received",
        workspace: h.wrongContext ? bOther : bWorkspace,
        campaign_id: h.provider.campaign!.id,
        lead_email: "PRIVATE_CALLBACK_SENTINEL@example.invalid",
        reply_text: "PRIVATE_BODY_SENTINEL",
      };
      if (!h.noReceipt) {
        const r = await receiver.handle(
          new Request(h.inputs.receiver.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "X-S00-Webhook-Token": cToken,
            },
            body: JSON.stringify(payload),
          }),
        );
        assert.equal(r.status, 200);
      }
      log = {
        id: bId(81),
        organization_id: bWorkspace,
        webhook_url: h.inputs.receiver.url,
        timestamp_created: new Date(clock.now()).toISOString(),
        success: true,
        status_code: 200,
        payload,
      };
      body = { success: true, status_code: 200 };
    } else if (p === `/api/v2/webhooks/${bId(80)}`) {
      if (method === "DELETE") {
        body = hook;
        hook = undefined;
      } else if (!hook) return bJson({}, 404);
      else body = hook;
    } else if (p === "/api/v2/webhook-events") {
      if (h.noLog) body = { items: [] };
      else if (h.twoLogs && !url.searchParams.has("starting_after"))
        body = {
          items: [{ ...log, id: bId(82), success: false }],
          next_starting_after: bId(82),
        };
      else body = { items: log ? [log] : [] };
    } else if (p === `/api/v2/webhook-events/${bId(81)}`) body = log;
    else body = h.provider.handle(String(raw), init!);
    const post = await h.after?.(body, q.step, count);
    if (post instanceof Error) throw post;
    return post ?? bJson(body);
  };
  return h;
}
const effects = (h: Awaited<ReturnType<typeof harness>>) =>
  h.calls.filter((c) => c.method !== "GET");
async function temporary<T>(work: (root: string) => Promise<T>) {
  const parent = resolve(".local/pipeline-os-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, "c-"));
  try {
    return await work(root);
  } finally {
    const absolute = resolve(root);
    assert.ok(
      absolute.startsWith(parent + "\\") || absolute.startsWith(parent + "/"),
    );
    await rm(absolute, { recursive: true, force: true });
  }
}

test("C-AC01/02 preview, absent source and replay never read env, save or fetch", async () => {
  const h = await harness();
  for (const source of [undefined, h.inputs.source]) {
    const r = await runInstantlyC(
      noEnv,
      {
        load: async () => source,
        save: async () => {
          throw Error("SAVE_FORBIDDEN");
        },
      },
      undefined,
    );
    assert.equal(r.newCalls, 0);
    assert.equal(r.calls, source ? 43 : 0);
  }
  const r = await h.run();
  assert.equal(r.status, "completed");
  const bytes = JSON.stringify(h.store.value),
    n = h.calls.length,
    w = h.store.writes;
  await h.run({}, noEnv);
  assert.equal(h.calls.length, n);
  assert.equal(h.store.writes, w);
  assert.equal(JSON.stringify(h.store.value), bytes);
});
test("C-AC01/02 exact43 and bound manifest/gates/secrets reject before effects", async () => {
  const h = await harness();
  for (const opts of [
    { authorizedNew: 20 },
    { authorizedTotal: 63 },
    { includedCallsConfirmed: false },
    { webhooksIncludedConfirmed: false },
    { manifestReviewed: false },
    { receiverReady: false },
  ]) {
    await assert.rejects(h.run(opts, noEnv));
    assert.equal(h.store.writes, 0);
  }
  for (const change of [
    (s: any) => (s.calls = 42),
    (s: any) => (s.status = "failed"),
    (s: any) => (s.stage = 12),
  ]) {
    const source = structuredClone(h.inputs.source);
    change(source);
    assert.throws(() => validateCSource(source));
  }
  const bad = { ...h.inputs.receiver, sourceHash: "f".repeat(64) };
  assert.throws(() => validateCInputs({ ...h.inputs, receiver: bad }));
  for (const change of [
    { url: "http://receiver.example.invalid/" + bad.nonce },
    { url: "https://127.0.0.1/" + bad.nonce },
    { url: bad.url + "?secret=x" },
    { endsAt: bad.endsAt + 1 },
    { dedupKeyHash: bad.tokenHash },
    { logsRedacted: false },
  ])
    assert.throws(() => validateCManifest({ ...h.inputs.receiver, ...change }));
  await assert.rejects(h.run({}, { ...cEnv, INSTANTLY_API_KEY: "changed" }));
  await assert.rejects(
    h.run({}, { ...cEnv, INSTANTLY_S00_WEBHOOK_SECRET: "c".repeat(64) }),
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.store.writes, 0);
});
test("C-AC06/09 complete12 calls55 and paginated14 calls57 retain source and touch only own hook", async () => {
  for (const maximum of [false, true]) {
    const h = await harness();
    h.twoHooks = maximum;
    h.twoLogs = maximum;
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(r.calls, maximum ? 57 : 55);
    assert.equal(r.newCalls, maximum ? 14 : 12);
    assert.equal(r.cleanup, "verified");
    assert.equal(r.campaignFinalVerified, true);
    assert.deepEqual(
      effects(h).map((c) => c.method),
      ["POST", "POST", "DELETE"],
    );
    assert.ok(
      effects(h).every((c) => c.url.pathname.startsWith("/api/v2/webhooks")),
    );
    assert.equal(h.provider.leads.length, 2);
    const create = effects(h)[0].body;
    assert.equal(create.campaign, h.provider.campaign!.id);
    assert.equal(create.event_type, "reply_received");
    assert.equal(create.headers["X-S00-Webhook-Token"], cToken);
    assert.ok(
      h.calls.slice(1).every((c, i) => c.time - h.calls[i].time >= 1000),
    );
    assert.deepEqual((h.store.value as CState).prior, h.inputs.source);
    const report = JSON.stringify(r);
    for (const secret of [
      cToken,
      cDedup,
      bSecret,
      bWorkspace,
      h.inputs.receiver.url,
      "PRIVATE_BODY_SENTINEL",
      "PRIVATE_CALLBACK_SENTINEL",
    ])
      assert.ok(!report.includes(secret));
  }
});
test("C-AC08 synthetic foreign context and absent logs are partial, not replies or successful C", async () => {
  for (const flag of ["wrongContext", "noReceipt", "noLog"] as const) {
    const h = await harness();
    h[flag] = true;
    const r = await h.run();
    assert.equal(r.status, "partial");
    assert.equal(r.realReplyVerified, false);
    assert.equal(r.cleanup, "verified");
    assert.equal(r.individualSchedulerPauseVerified, false);
    assert.equal(r.sends, 0);
    assert.equal(r.paidOperations, 0);
  }
});
test("C-AC06 preflight workspace/plan/campaign/hooks drift blocks before create", async () => {
  for (const step of ["workspace", "plan", "current", "hooks"]) {
    const h = await harness();
    h.after = (x, s) =>
      s !== step
        ? undefined
        : bJson(
            step === "workspace"
              ? { id: bOther }
              : step === "plan"
                ? { ...x, subscriptions: {} }
                : step === "current"
                  ? { ...x, email_list: ["PRIVATE@example.invalid"] }
                  : {
                      items: [
                        {
                          id: bId(90),
                          organization: bWorkspace,
                          campaign: h.provider.campaign!.id,
                          event_type: "reply_received",
                          target_hook_url: h.inputs.receiver.url,
                        },
                      ],
                    },
          );
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(effects(h).length, 0);
  }
  const paged = await harness();
  paged.after = (_, s) =>
    s === "hooks"
      ? bJson({
          items: [
            {
              id: bId(91),
              organization: bWorkspace,
              campaign: paged.provider.campaign!.id,
              event_type: "reply_received",
            },
          ],
          next_starting_after: bId(91),
        })
      : undefined;
  assert.equal((await paged.run()).status, "failed");
  assert.equal(effects(paged).length, 0);
});
test("C-AC07 uncertain create/test/delete reconcile without repeating any mutation", async () => {
  for (const step of ["create", "test", "remove"]) {
    const h = await harness();
    h.after = (_, s, n) =>
      s === step && n === 1 ? new Error(bSecret) : undefined;
    const r = await h.run();
    assert.equal(r.status, "completed");
    assert.equal(effects(h).length, 3);
    assert.equal(effects(h).filter((c) => c.step === step).length, 1);
    assert.ok(r.calls <= 62);
    if (step !== "remove") assert.equal(r.budget.reserve, 1);
  }
});
test("C-AC07 ambiguous create and missing own hook never adopt/delete another resource", async () => {
  const h = await harness();
  h.after = (_, s, n) =>
    s === "create" && n === 1
      ? new Error(bSecret)
      : s === "create"
        ? bJson({ items: [] })
        : undefined;
  const r = await h.run();
  assert.equal(r.status, "failed");
  assert.equal(r.cleanup, "unknown");
  assert.equal(effects(h).length, 1);
  const other = await harness();
  other.after = (x, s) =>
    s === "create" ? bJson({ ...x, organization: bOther }) : undefined;
  assert.equal((await other.run()).status, "failed");
  assert.equal(effects(other).length, 1);
});
test("C-AC09 transient read retries use shared R, permanent auth failures never retry", async () => {
  const h = await harness();
  h.before = (s, n) =>
    s === "workspace" && n === 1
      ? bJson({}, 429, { "retry-after": "5" })
      : undefined;
  const r = await h.run();
  assert.equal(r.status, "completed");
  assert.equal(r.budget.reserve, 1);
  assert.ok(h.clock.waits.includes(5000));
  for (const status of [401, 402, 403, 400]) {
    const x = await harness();
    x.before = () => bJson({}, status);
    const failed = await x.run();
    assert.equal(failed.status, "failed");
    assert.equal(x.calls.length, 1);
  }
  const long = await harness();
  long.before = () => bJson({}, 429, { "retry-after": "61" });
  assert.equal((await long.run()).error, "RETRY_WAIT_TOO_LONG");
  assert.equal(long.calls.length, 1);
});
test("C-AC09/10 R exhaustion protects mutations; H cleans only own verified hook", async () => {
  const h = await harness();
  h.before = (s, n) =>
    ["workspace", "plan", "current"].includes(s) && n === 1
      ? bJson({}, 500)
      : undefined;
  const r = await h.run();
  assert.equal(r.error, "C_RESERVE_REQUIRED");
  assert.equal(r.budget.reserve, 3);
  assert.equal(effects(h).length, 0);
  const clean = await harness();
  clean.before = (s) => (s === "detail" ? bJson({}, 500) : undefined);
  const done = await clean.run();
  assert.equal(done.status, "failed");
  assert.equal(done.cleanup, "verified");
  assert.equal(done.budget.hold, 2);
  assert.equal(effects(clean).filter((x) => x.method === "DELETE").length, 1);
});
test("C-AC10 DELETE uncertainty or remaining resource never causes a second DELETE", async () => {
  const h = await harness();
  h.before = (s) => (s === "remove" ? bJson({}, 500) : undefined);
  const r = await h.run();
  assert.equal(r.status, "failed");
  assert.equal(r.cleanup, "unknown");
  assert.equal(effects(h).filter((c) => c.method === "DELETE").length, 1);
  assert.ok(r.calls <= 62);
  const auth = await harness();
  auth.before = (s) => (s === "hook" ? bJson({}, 403) : undefined);
  const stopped = await auth.run();
  assert.equal(stopped.cleanup, "unknown");
  assert.equal(effects(auth).filter((c) => c.method === "DELETE").length, 0);
});
test("C-AC06/08 forged logs, duplicate candidates and final drift never report success", async () => {
  for (const kind of ["foreign", "duplicate", "detail", "final"]) {
    const h = await harness();
    h.after = (x, s) =>
      kind === "foreign" && s === "logs"
        ? bJson({ items: [{ ...h.log, organization_id: bOther }] })
        : kind === "duplicate" && s === "logs"
          ? bJson({ items: [h.log, { ...h.log, id: bId(83) }] })
          : kind === "detail" && s === "detail"
            ? bJson({ ...x, payload: {} })
            : kind === "final" && s === "final"
              ? bJson({ ...x, status: 1 })
              : undefined;
    const r = await h.run();
    assert.equal(r.status, "failed");
    assert.equal(
      r.cleanup,
      kind === "foreign" || kind === "duplicate" || kind === "detail"
        ? "unknown"
        : "verified",
    );
    assert.equal(r.campaignFinalVerified, false);
  }
});
test("C-AC09 request builder and transport block send/PATCH/foreign URLs; 404 only own GET hook", async () => {
  const h = await harness();
  await h.run();
  const s = h.store.value as CState;
  for (const step of ["send", "activate", "pause", "createA", "configure"])
    assert.throws(() => cRequest(s, h.inputs.receiver, step as any, cToken));
  assert.throws(() =>
    cRequest(
      s,
      { ...h.inputs.receiver, nonce: "d".repeat(24) },
      "test",
      cToken,
    ),
  );
  let count = 0;
  const fake: typeof fetch = async () => {
    count++;
    return bJson({}, 404);
  };
  for (const [url, method] of [
    ["https://evil.example.invalid/api/v2/webhooks", "GET"],
    [
      "https://api.instantly.ai/api/v2/campaigns/" + bId(30) + "/activate",
      "POST",
    ],
    ["https://api.instantly.ai/api/v2/webhooks/" + bId(80), "PATCH"],
  ] as const)
    await assert.rejects(
      instantlyWebhookJson(fake, bSecret, url, method as any),
    );
  assert.equal(count, 0);
  assert.equal(
    await instantlyWebhookJson(
      fake,
      bSecret,
      "https://api.instantly.ai/api/v2/webhooks/" + bId(80),
      "GET",
    ),
    null,
  );
  await assert.rejects(
    instantlyTrialJson(
      fake,
      bSecret,
      "https://api.instantly.ai/api/v2/webhooks",
      "POST",
    ),
  );
  assert.equal(count, 1);
});
test("C-AC01/11 journal validation rejects counter/history/source edits and terminal downgrade", async () => {
  const h = await harness();
  await h.run();
  const s = h.store.value as CState;
  for (const change of [
    (x: CState) => x.calls++,
    (x: CState) => (x.prior.calls = 42),
    (x: CState) => (x.requests[0].result = "HTTP_403"),
    (x: CState) => (x.requests[0].bucket = "R"),
    (x: CState) => (x.cleaned = false),
    (x: CState) => (x.contextValidated = false),
  ]) {
    const n = structuredClone(s);
    change(n);
    assert.throws(() => validateCState(n));
  }
  const next = structuredClone(s);
  next.status = "running";
  assert.throws(() => assertCTransition(s, next));
  assert.throws(() => assertCTransition(undefined, s));
});
test("C-AC01/11 storage failure before/after reserved HTTP is visible and never replays", async () => {
  for (const failAt of [1, 2, 3, 15]) {
    const h = await harness();
    h.store.failAt = failAt;
    await assert.rejects(h.run());
    assert.ok(h.calls.length <= failAt);
    const n = h.calls.length,
      w = h.store.writes;
    if (h.store.value.version === 8) {
      await h.run({}, noEnv);
      assert.equal(h.calls.length, n);
      assert.equal(h.store.writes, w);
    }
  }
});
test("C-AC10 cancellation before HTTP and after create closes only own hook", async () => {
  const pre = await harness(),
    controller = new AbortController();
  controller.abort();
  assert.equal((await pre.run({ signal: controller.signal })).status, "failed");
  assert.equal(pre.calls.length, 0);
  const h = await harness(),
    active = new AbortController();
  h.after = (_, s) => {
    if (s === "hook") active.abort();
    return undefined;
  };
  const r = await h.run({ signal: active.signal });
  assert.equal(r.status, "failed");
  assert.equal(r.cleanup, "verified");
  assert.equal(r.budget.hold, 2);
});

async function receiverHarness(
  store: CReceiptStore = new ReceiptMemory(),
  fixture?: Awaited<ReturnType<typeof cSourceFixture>>,
) {
  const f = fixture ?? (await cSourceFixture());
  let time = cNow;
  const r = createCReceiver({
    manifest: f.inputs.receiver,
    workspace: bWorkspace,
    campaign: f.provider.campaign!.id,
    token: cToken,
    key: cDedup,
    store,
    now: () => time,
  });
  const payload = {
    timestamp: new Date(time).toISOString(),
    event_type: "reply_received",
    workspace: bWorkspace,
    campaign_id: f.provider.campaign!.id,
    lead_email: "PRIVATE_EMAIL_SENTINEL@example.invalid",
    reply_html: "PRIVATE_BODY_SENTINEL",
  };
  const request = (
    data: unknown = payload,
    headers: Record<string, string> = {},
    method = "POST",
  ) =>
    new Request(f.inputs.receiver.url, {
      method,
      headers: {
        "content-type": "application/json",
        "X-S00-Webhook-Token": cToken,
        ...headers,
      },
      ...(method === "POST" ? { body: JSON.stringify(data) } : {}),
    });
  return { r, store, payload, request, f, setTime: (t: number) => (time = t) };
}
test("C-AC03 receiver rejects method/URL/auth/type/schema/size without storing payload", async () => {
  const h = await receiverHarness();
  await h.r.arm();
  for (const [request, status] of [
    [h.request(undefined, {}, "GET"), 405],
    [new Request("https://other.example.invalid", { method: "POST" }), 404],
    [h.request(undefined, { "X-S00-Webhook-Token": "bad" }), 401],
    [h.request(undefined, { "content-type": "text/plain" }), 415],
    [h.request([]), 400],
    [h.request({ ...h.payload, workspace: 123 }), 400],
    [h.request({ ...h.payload, reply_html: "x".repeat(262145) }), 413],
  ] as const)
    assert.equal((await h.r.handle(request)).status, status);
  assert.equal((await h.store.load())!.receipts.length, 0);
});
test("C-AC04/05 receiver persists before2xx, dedups, quarantines conflict and survives restart", async () => {
  const h = await receiverHarness();
  await h.r.arm();
  assert.equal((await h.r.handle(h.request())).status, 200);
  assert.equal((await h.store.load())!.receipts.length, 1);
  assert.equal((await h.r.handle(h.request())).status, 200);
  assert.equal((await h.store.load())!.receipts[1].duplicate, true);
  const restarted = await receiverHarness(h.store, h.f);
  await assert.rejects(restarted.r.arm());
  assert.equal((await restarted.r.observe()).authenticated, true);
  assert.equal(
    (await h.r.handle(h.request({ ...h.payload, reply_html: "CHANGED" })))
      .status,
    200,
  );
  assert.equal((await h.r.observe()).conflict, true);
  for (let i = 3; i < 16; i++)
    assert.equal((await h.r.handle(h.request())).status, 200);
  assert.equal((await h.r.handle(h.request())).status, 429);
  const encoded = JSON.stringify(await h.store.load());
  assert.ok(!encoded.includes("PRIVATE_EMAIL_SENTINEL"));
  assert.ok(!encoded.includes("PRIVATE_BODY_SENTINEL"));
  assert.ok(!encoded.includes(cToken));
  await h.r.close();
  assert.equal((await h.r.handle(h.request())).status, 410);
  await assert.rejects(h.r.arm());
});
test("C-AC04/05 synthetic missing context is quarantined; expired window and disk errors never ack", async () => {
  const h = await receiverHarness();
  await h.r.arm();
  assert.equal((await h.r.handle(h.request({ synthetic: true }))).status, 200);
  assert.equal((await h.r.observe()).contextValidated, false);
  assert.equal(
    (await h.store.load())!.receipts[0].classification,
    "quarantined",
  );
  h.setTime(cNow + 120001);
  assert.equal((await h.r.handle(h.request())).status, 410);
  const memory = new ReceiptMemory(),
    disk = await receiverHarness(memory);
  await disk.r.arm();
  memory.fail = true;
  assert.equal((await disk.r.handle(disk.request())).status, 503);
  assert.equal(
    cPayloadDigest({ b: 2, a: 1 }, cDedup),
    cPayloadDigest({ a: 1, b: 2 }, cDedup),
  );
});
test("C-AC11 real file adapters migrate fictional7→8 atomically, preserve history, block all legacy and foreign locks", async () =>
  temporary(async (root) => {
    const h = await harness(),
      folder = resolve(root, ".local/pipeline-os");
    await mkdir(folder, { recursive: true });
    await writeFile(
      resolve(folder, "s00-instantly-run.json"),
      JSON.stringify(h.inputs.source, null, 2) + "\n",
    );
    const files = instantlyFiles(root);
    const original = h.store.save.bind(h.store);
    h.store.save = async (s) => {
      await original(s);
      await files.cStore.save(s);
    };
    await h.run();
    const s = await files.cStore.load();
    assert.equal(s?.version, 8);
    assert.equal((s as CState).calls, 55);
    assert.equal(
      JSON.stringify((s as CState).prior),
      JSON.stringify(h.inputs.source),
    );
    for (const load of [
      files.store.load,
      files.ledgerStore.load,
      files.bStore.load,
      files.diagnosticStore.load,
      files.brStore.load,
      files.cfdStore.load,
      files.br28Store.load,
      files.bInputs,
      files.brInputs,
      files.br28Inputs,
      files.cfdInputs,
    ])
      await assert.rejects(load, { message: "C_LEDGER_SUPERSEDES_BR28" });
    await assert.rejects(files.allStore.save(h.inputs.source));
    assert.ok(
      Buffer.byteLength(
        await readFile(resolve(folder, "s00-instantly-run.json"), "utf8"),
      ) < 65536,
    );
    await writeFile(resolve(folder, "s00-instantly-run.json.lock"), "foreign");
    await assert.rejects(files.locked(async () => {}));
    assert.equal(
      await readFile(resolve(folder, "s00-instantly-run.json.lock"), "utf8"),
      "foreign",
    );
    const receipts = cReceiptFiles(root),
      r = await receiverHarness(receipts);
    await r.r.arm();
    assert.equal((await r.r.handle(r.request())).status, 200);
    await r.r.close();
    assert.equal((await receipts.load())!.closed, true);
    await writeFile(
      resolve(folder, "s00-instantly-c-receipt.json.lock"),
      "foreign",
    );
    assert.equal((await r.r.handle(r.request())).status, 410);
    await assert.rejects(receipts.transact((x) => x!));
    assert.equal(
      await readFile(
        resolve(folder, "s00-instantly-c-receipt.json.lock"),
        "utf8",
      ),
      "foreign",
    );
  }));
test("C-AC02 CLI offline status/check/gates use only fictional files and no autoload/network", async () =>
  temporary(async (root) => {
    const h = await harness(),
      folder = resolve(root, ".local/pipeline-os");
    await mkdir(folder, { recursive: true });
    for (const [name, value] of [
      ["s00-instantly-run.json", h.inputs.source],
      ["s00-instantly-b-manifest.json", h.inputs.manifest],
      ["s00-instantly-scope-attestation.json", h.inputs.scope],
      ["s00-instantly-c-manifest.json", h.inputs.receiver],
    ] as const)
      await writeFile(
        resolve(folder, name),
        JSON.stringify(value, null, 2) + "\n",
      );
    const preload = resolve(root, "deny.cjs");
    await writeFile(
      preload,
      "globalThis.fetch=()=>{throw Error('REAL_NETWORK_FORBIDDEN')}; process.loadEnvFile=()=>{throw Error('ENV_AUTOLOAD_FORBIDDEN')};",
    );
    const cli = resolve("scripts/pipeline-os/s00-instantly-runner-cli.ts"),
      tsx = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        ["--require", preload, "--import", tsx, cli, ...args],
        {
          cwd: root,
          env: { SystemRoot: process.env.SystemRoot, NODE_ENV: "test" },
          encoding: "utf8",
          timeout: 15000,
        },
      );
    for (const args of [[], ["--phase", "C"], ["--check-c-manifest"]]) {
      const r = run(args);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        JSON.parse(r.stdout).calls ?? JSON.parse(r.stdout).sourceCalls,
        43,
      );
    }
    for (const args of [
      ["--phase", "C", "--execute"],
      ["--phase", "C", "--check-b-manifest"],
      ["--phase", "A", "--receiver-ready"],
    ]) {
      const r = run(args);
      assert.equal(r.status, 2);
      assert.ok(!r.stderr.includes(bSecret));
    }
    assert.equal(
      JSON.parse(
        await readFile(resolve(folder, "s00-instantly-run.json"), "utf8"),
      ).version,
      7,
    );
    assert.ok(
      !(await readdir(folder)).some(
        (n) => n.endsWith(".lock") || n.endsWith(".tmp"),
      ),
    );
  }));

test("C-AC05 late conflicting callback downgrades evidence to partial without rewriting earlier receipt", async () => {
  const h = await harness();
  h.after = async (_, step) => {
    if (step === "final")
      assert.equal(
        (
          await h.receiver.handle(
            new Request(h.inputs.receiver.url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "X-S00-Webhook-Token": cToken,
              },
              body: JSON.stringify({
                ...h.log!.payload,
                reply_text: "DIFFERENT_FICTIONAL_BODY",
              }),
            }),
          )
        ).status,
        200,
      );
    return undefined;
  };
  const r = await h.run();
  assert.equal(r.status, "partial");
  assert.equal(r.contextValidated, false);
  assert.equal(r.conflictingDeliveries, true);
  assert.equal(r.cleanup, "verified");
});
test("C-AC06/10 expiration after preflight never tests and still cleans the owned hook", async () => {
  const h = await harness();
  h.after = (_, step) => {
    if (step === "hook") h.clock.time = cNow + 120001;
    return undefined;
  };
  const r = await h.run();
  assert.equal(r.error, "C_WINDOW_CLOSED");
  assert.equal(r.cleanup, "verified");
  assert.equal(h.calls.filter((c) => c.step === "test").length, 0);
});
test("C-AC04 receiver waits for commit before ack and returns503 on transaction failure", async () => {
  const memory = new ReceiptMemory();
  let fail = false,
    release: () => void = () => {},
    pending = false;
  const store: CReceiptStore = {
    load: () => memory.load(),
    transact: async (change) => {
      if (fail) throw Error(bSecret);
      if (pending) await new Promise<void>((r) => (release = r));
      await memory.transact(change);
    },
  };
  const h = await receiverHarness(store);
  await h.r.arm();
  pending = true;
  let done = false;
  const first = h.r.handle(h.request()).then((x) => {
    done = true;
    return x;
  });
  await turn();
  assert.equal(done, false);
  assert.equal((await memory.load())!.receipts.length, 0);
  release();
  assert.equal((await first).status, 200);
  fail = true;
  assert.equal((await h.r.handle(h.request())).status, 503);
  assert.equal((await memory.load())!.receipts.length, 1);
});
test("C-AC03 transport and callback bound streams, redirects and eight second timeouts", async () => {
  const h = await receiverHarness();
  await h.r.arm();
  const url = "https://api.instantly.ai/api/v2/webhooks/" + bId(80);
  await assert.rejects(
    instantlyWebhookJson(async () => bJson({}, 302), bSecret, url, "GET"),
    { message: "BLOCKED_REDIRECT" },
  );
  await assert.rejects(
    instantlyWebhookJson(
      async () =>
        bJson({}, 200, { "content-length": String(2 * 1024 * 1024 + 1) }),
      bSecret,
      url,
      "GET",
    ),
    { message: "RESPONSE_LIMIT" },
  );
  await assert.rejects(
    instantlyWebhookJson(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
              c.close();
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      bSecret,
      url,
      "GET",
    ),
    { message: "RESPONSE_LIMIT" },
  );
  const oversized = new Request(h.f.inputs.receiver.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-S00-Webhook-Token": cToken,
    },
    body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(262145));
        c.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
  assert.equal((await h.r.handle(oversized)).status, 413);
  const stalled = new Request(h.f.inputs.receiver.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-S00-Webhook-Token": cToken,
    },
    body: new ReadableStream({ start() {} }),
    duplex: "half",
  } as RequestInit);
  const [callback] = await Promise.all([
    h.r.handle(stalled),
    assert.rejects(
      instantlyWebhookJson(
        async () => new Promise(() => {}),
        bSecret,
        url,
        "GET",
      ),
      { message: "NETWORK_OR_TIMEOUT" },
    ),
  ]);
  assert.equal(callback.status, 408);
});
test("C-AC05/11 receipt filesystem concurrency, foreign temp, oversized and corrupt files fail closed", async () =>
  temporary(async (root) => {
    const store = cReceiptFiles(root),
      h = await receiverHarness(store);
    await h.r.arm();
    const rs = await Promise.all([
      h.r.handle(h.request()),
      h.r.handle(h.request()),
    ]);
    assert.ok(rs.every((r) => [200, 503].includes(r.status)));
    assert.ok(rs.some((r) => r.status === 200));
    const saved = (await store.load())!;
    assert.equal(new Set(saved.receipts.map((r) => r.digest)).size, 1);
    const file = resolve(
      root,
      ".local/pipeline-os/s00-instantly-c-receipt.json",
    );
    await writeFile(file + ".tmp", "FOREIGN_TEMP");
    assert.equal((await h.r.handle(h.request())).status, 503);
    assert.equal(await readFile(file + ".tmp", "utf8"), "FOREIGN_TEMP");
    for (const body of ["{bad-json", " ".repeat(16385)]) {
      await writeFile(file, body);
      await assert.rejects(store.load());
      assert.equal((await h.r.handle(h.request())).status, 503);
    }
  }));
test("C-AC09 budgets remain bounded across normal pagination, R3 and protected H2", async () => {
  const h = await harness();
  h.twoHooks = true;
  h.twoLogs = true;
  h.before = (s, n) =>
    ["workspace", "detail"].includes(s) && n === 1 ? bJson({}, 500) : undefined;
  h.after = (_, s, n) =>
    s === "test" && n === 1 ? new Error(bSecret) : undefined;
  const r = await h.run();
  assert.equal(r.status, "failed");
  assert.equal(r.budget.reserve, 3);
  assert.equal(r.budget.hold, 2);
  assert.equal(r.cleanup, "verified");
  assert.ok(r.budget.normal <= 14);
  assert.ok(r.newCalls <= 19);
  assert.ok(r.calls <= 62);
  assert.equal(effects(h).filter((c) => c.method === "DELETE").length, 1);
});
test("C-AC11 corrupt/oversized ledger and foreign temp never replace saved source", async () =>
  temporary(async (root) => {
    const h = await harness(),
      folder = resolve(root, ".local/pipeline-os"),
      file = resolve(folder, "s00-instantly-run.json");
    await mkdir(folder, { recursive: true });
    const source = JSON.stringify(h.inputs.source, null, 2) + "\n";
    await writeFile(file, source);
    const files = instantlyFiles(root);
    h.store.save = async (s) => files.cStore.save(s);
    await writeFile(file + ".tmp", "FOREIGN_LEDGER_TEMP");
    await assert.rejects(h.run());
    assert.equal(h.calls.length, 0);
    assert.equal(await readFile(file, "utf8"), source);
    assert.equal(await readFile(file + ".tmp", "utf8"), "FOREIGN_LEDGER_TEMP");
    for (const body of ["{bad-json", " ".repeat(65537)]) {
      await writeFile(file, body);
      await assert.rejects(files.allStore.load());
      assert.equal(await readFile(file, "utf8"), body);
    }
  }));

test("C-AC01/11 CLI fictional execution and terminal replay keep one counter and no listener", async () =>
  temporary(async (root) => {
    const h = await harness(),
      folder = resolve(root, ".local/pipeline-os");
    await mkdir(folder, { recursive: true });
    for (const [name, value] of [
      ["s00-instantly-run.json", h.inputs.source],
      ["s00-instantly-b-manifest.json", h.inputs.manifest],
      ["s00-instantly-scope-attestation.json", h.inputs.scope],
      ["s00-instantly-c-manifest.json", h.inputs.receiver],
    ] as const)
      await writeFile(
        resolve(folder, name),
        JSON.stringify(value, null, 2) + "\n",
      );
    await writeFile(
      resolve(root, "campaign.json"),
      JSON.stringify(h.provider.campaign),
    );
    await writeFile(
      resolve(root, ".env.local"),
      "INSTANTLY_API_KEY=ENV_AUTOLOAD_FORBIDDEN\n",
    );
    const provider = pathToFileURL(
        resolve("tests/fixtures/pipeline-os-instantly-b.ts"),
      ).href,
      receiverModule = pathToFileURL(
        resolve("scripts/pipeline-os/s00-instantly-c-receiver.ts"),
      ).href;
    const preload = resolve(root, "fictional-provider.mjs");
    await writeFile(
      preload,
      `import{BProvider,bId,bWorkspace}from'${provider}';import{createCReceiver,cReceiptFiles}from'${receiverModule}';import{readFileSync,appendFileSync}from'node:fs';import timers from'node:timers/promises';import{syncBuiltinESMExports}from'node:module';import net from'node:net';net.Server.prototype.listen=function(){throw Error('LISTENER_FORBIDDEN')};syncBuiltinESMExports();let time=${cNow};Date.now=()=>time;timers.setTimeout=async(ms)=>{time+=ms};syncBuiltinESMExports();process.loadEnvFile=()=>{throw Error('ENV_AUTOLOAD_FORBIDDEN')};const p=new BProvider();p.campaign=JSON.parse(readFileSync('campaign.json','utf8'));const m=JSON.parse(readFileSync('.local/pipeline-os/s00-instantly-c-manifest.json','utf8'));const receiver=createCReceiver({manifest:m,workspace:bWorkspace,campaign:p.campaign.id,token:'${cToken}',key:'${cDedup}',store:cReceiptFiles(process.cwd()),now:()=>time});let hook,log;globalThis.fetch=async(raw,init)=>{const u=new URL(String(raw)),path=u.pathname,method=init.method;appendFileSync('calls.txt','HTTP\\n');if(u.origin!=='https://api.instantly.ai'||method==='PATCH')throw Error('FORBIDDEN');let body;if(path==='/api/v2/webhooks'&&method==='GET')body={items:hook?[hook]:[]};else if(path==='/api/v2/webhooks'&&method==='POST'){hook={...JSON.parse(init.body),id:bId(80),organization:bWorkspace};body=hook;}else if(path.endsWith('/test')){const payload={timestamp:new Date(time).toISOString(),workspace:bWorkspace,campaign_id:p.campaign.id,event_type:'reply_received'};const r=await receiver.handle(new Request(m.url,{method:'POST',headers:{'content-type':'application/json','X-S00-Webhook-Token':'${cToken}'},body:JSON.stringify(payload)}));if(r.status!==200)throw Error('FIXTURE_RECEIVER_FAILED');log={id:bId(81),organization_id:bWorkspace,webhook_url:m.url,timestamp_created:new Date(time).toISOString(),success:true,status_code:200,payload};body={success:true,status_code:200};}else if(path==='/api/v2/webhooks/'+bId(80)){if(method==='DELETE'){body=hook;hook=undefined;}else if(!hook)return new Response('{}',{status:404,headers:{'content-type':'application/json'}});else body=hook;}else if(path==='/api/v2/webhook-events')body={items:log?[log]:[]};else if(path==='/api/v2/webhook-events/'+bId(81))body=log;else body=p.handle(String(raw),init);return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});};`,
    );
    const loader = pathToFileURL(
        resolve("node_modules/tsx/dist/loader.mjs"),
      ).href,
      cli = resolve("scripts/pipeline-os/s00-instantly-runner-cli.ts");
    const flags = [
      "--phase",
      "C",
      "--execute",
      "--authorized-new",
      "19",
      "--authorized-total",
      "62",
      "--included-calls-confirmed",
      "--webhooks-included-confirmed",
      "--manifest-reviewed",
      "--receiver-ready",
    ];
    const run = (args: string[], env = false) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          loader,
          "--import",
          pathToFileURL(preload).href,
          cli,
          ...args,
        ],
        {
          cwd: root,
          env: {
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: "test",
            ...(env ? cEnv : {}),
          },
          encoding: "utf8",
          timeout: 20000,
        },
      );
    const r = run(flags, true);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).calls, 55);
    assert.equal(JSON.parse(r.stdout).status, "completed");
    const bytes = await readFile(
      resolve(folder, "s00-instantly-run.json"),
      "utf8",
    );
    assert.equal(run(flags).status, 0);
    assert.equal(run([]).status, 0);
    assert.equal(run(["--phase", "B_RECOVERY_FROM_28"]).status, 2);
    assert.equal(
      await readFile(resolve(folder, "s00-instantly-run.json"), "utf8"),
      bytes,
    );
    assert.equal(
      (await readFile(resolve(root, "calls.txt"), "utf8")).trim().split("\n")
        .length,
      12,
    );
    assert.ok(
      !(await readdir(folder)).some(
        (n) => n.endsWith(".lock") || n.endsWith(".tmp"),
      ),
    );
  }));
