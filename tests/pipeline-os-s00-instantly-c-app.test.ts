import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { cAppFixture, appToken } from "./fixtures/pipeline-os-instantly-c-app";
import { cEnv, cToken, cDedup, cNow } from "./fixtures/pipeline-os-instantly-c";
import {
  bId,
  bWorkspace,
  bJson,
  BClock,
} from "./fixtures/pipeline-os-instantly-b";
import {
  remoteControlBridge,
  validateControlJournal,
  type ControlJournal,
} from "../scripts/pipeline-os/s00-instantly-control-bridge";
import {
  prepareCAppGrant,
  runCApp,
  validateCAppState,
  assertCAppTransition,
  type CAppState,
} from "../scripts/pipeline-os/s00-instantly-c-app";
import {
  controlSnapshotSchema,
  controlHash,
} from "../src/lib/server/instantly/control-contract";
import {
  createCReceiver,
  type CReceiptState,
} from "../scripts/pipeline-os/s00-instantly-c-receiver";
import { validateCState } from "../scripts/pipeline-os/s00-instantly-c";
import { cAppFiles } from "../scripts/pipeline-os/s00-instantly-c-app-files";
import { InstantlyTrialControl } from "../src/components/instantly-trial-control";
globalThis.fetch = async () => {
  throw Error("REAL_NETWORK_FORBIDDEN");
};
const authorized = {
  execute: true,
  authorizedProviderNew: 19,
  authorizedProviderTotal: 62,
  authorizedControlNew: 25,
  includedConfirmed: true,
};
async function harness() {
  const f = await cAppFixture(cNow),
    clock = new BClock();
  clock.time = cNow;
  let value: any = structuredClone(f.inputs.source),
    receipt: CReceiptState | undefined,
    revoked = false,
    controlCalls = 0,
    providerCalls = 0,
    hook: any,
    log: any;
  const snapshots: any[] = [],
    actions: string[] = [],
    providerMethods: string[] = [];
  const store = {
    load: async () => structuredClone(value),
    save: async (s: CAppState) => {
      assertCAppTransition(value, s);
      value = structuredClone(s);
    },
  };
  const receiver = createCReceiver({
    manifest: f.manifest.receiverManifest,
    token: cToken,
    key: cDedup,
    workspace: f.manifest.source.workspaceId,
    campaign: f.manifest.source.campaignId,
    now: () => clock.now(),
    store: {
      load: async () => receipt && structuredClone(receipt),
      transact: async (change) => {
        receipt = change(receipt && structuredClone(receipt));
      },
    },
  });
  const state = () =>
    controlSnapshotSchema.parse({
      nonce: f.manifest.receiverManifest.nonce,
      sourceHash: f.manifest.source.canonicalHash,
      manifestHash: controlHash(JSON.stringify(f.manifest.receiverManifest)),
      revision:
        (receipt ? 1 : 0) +
        (receipt?.receipts.length ?? 0) +
        (receipt?.closed ? 1 : 0),
      armed: !!receipt,
      closed: receipt?.closed ?? false,
      authenticated: !!receipt?.receipts.length,
      contextValidated: receipt?.receipts[0]?.contextValidated ?? false,
      conflict:
        receipt?.receipts.some(
          (r) => r.digest !== receipt!.receipts[0].digest,
        ) ?? false,
      payloadDigest: receipt?.receipts[0]?.payloadDigest ?? null,
      receivedAt: receipt?.receipts[0]?.receivedAt ?? null,
      observations: receipt?.receipts.length ?? 0,
    });
  const controlFetch: typeof fetch = async (raw, init) => {
    assert.equal(
      String(raw),
      f.manifest.origin +
        "/api/integrations/instantly/control/" +
        f.manifest.receiverManifest.nonce,
    );
    assert.equal(init?.redirect, "manual");
    const h = new Headers(init?.headers);
    assert.equal(h.get("authorization"), "Bearer " + appToken);
    const action = init?.body
      ? JSON.parse(String(init.body)).action
      : h.get("X-S00-Control-Action");
    assert.equal(value.control.attempts.at(-1).result, "IN_FLIGHT");
    actions.push(action);
    controlCalls++;
    if (revoked) return bJson({}, 401);
    if (action === "arm") await receiver.arm();
    if (action === "close") await receiver.close();
    if (action === "revoke") revoked = true;
    const s = state();
    snapshots.push(s);
    return bJson(s);
  };
  const providerFetch: typeof fetch = async (raw, init) => {
    const s = validateCState(value.provider),
      q = s.requests.at(-1)!;
    assert.equal(q.result, "IN_FLIGHT");
    providerCalls++;
    assert.equal(s.calls, 43 + providerCalls);
    providerMethods.push(init?.method ?? "GET");
    const p = new URL(String(raw)).pathname,
      method = init?.method;
    let body: any;
    if (p === "/api/v2/webhooks" && method === "POST") {
      hook = {
        ...JSON.parse(String(init!.body)),
        id: bId(80),
        organization: bWorkspace,
        status: 1,
      };
      body = hook;
    } else if (p === "/api/v2/webhooks" && method === "GET")
      body = { items: hook ? [hook] : [] };
    else if (p === `/api/v2/webhooks/${bId(80)}/test`) {
      const payload = {
        timestamp: new Date(clock.now()).toISOString(),
        event_type: "reply_received",
        workspace: bWorkspace,
        campaign_id: f.provider.campaign!.id,
        lead_email: "PRIVATE_CALLBACK_SENTINEL@example.invalid",
        reply_text: "PRIVATE_BODY_SENTINEL",
      };
      assert.equal(
        (
          await receiver.handle(
            new Request(f.manifest.receiverManifest.url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "X-S00-Webhook-Token": cToken,
              },
              body: JSON.stringify(payload),
            }),
          )
        ).status,
        200,
      );
      log = {
        id: bId(81),
        organization_id: bWorkspace,
        webhook_url: f.manifest.receiverManifest.url,
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
    } else if (p === "/api/v2/webhook-events")
      body = { items: log ? [log] : [] };
    else if (p === `/api/v2/webhook-events/${bId(81)}`) body = log;
    else body = f.provider.handle(String(raw), init!);
    return bJson(body);
  };
  async function grant() {
    const a = await prepareCAppGrant(store, f.inputs, authorized);
    return f.ticket((a as any).intentId);
  }
  const run = (ticket: unknown, extra: object = {}) =>
    runCApp(
      { ...cEnv, INSTANTLY_S00_CONTROL_TOKEN: appToken },
      store,
      f.inputs,
      ticket,
      {
        ...authorized,
        clock,
        controlFetch,
        fetchImpl: providerFetch,
        ...extra,
      },
    );
  return {
    ...f,
    store,
    clock,
    state,
    grant,
    run,
    controlFetch,
    actions,
    snapshots,
    get value() {
      return value;
    },
    get counts() {
      return { controlCalls, providerCalls };
    },
    get hook() {
      return hook;
    },
  };
}
test("CAPP-AC01/08/11 full offline executor uses one ledger, closes then revokes and replay is inert", async () => {
  const h = await harness(),
    ticket = await h.grant(),
    r = await h.run(ticket);
  assert.equal(r.status, "completed");
  assert.equal(h.value.provider.prior.calls, 43);
  assert.ok(h.counts.providerCalls <= 14);
  assert.ok(h.counts.controlCalls + 1 <= 19);
  assert.equal(h.value.calls, 43 + h.counts.providerCalls);
  assert.equal(h.value.ticketDisabled, true);
  assert.equal(h.value.final.closed, true);
  assert.equal(h.hook, undefined);
  assert.deepEqual(h.actions.slice(-4), ["close", "final", "revoke", "probe"]);
  const text = JSON.stringify(h.value);
  for (const sentinel of [
    appToken,
    "PRIVATE_CALLBACK_SENTINEL",
    "PRIVATE_BODY_SENTINEL",
  ])
    assert.equal(text.includes(sentinel), false);
  const counts = { ...h.counts };
  await h.run(ticket, {
    controlFetch: () => {
      throw Error("REPLAY");
    },
    fetchImpl: () => {
      throw Error("REPLAY");
    },
  });
  assert.deepEqual(h.counts, counts);
  assert.equal(JSON.stringify(h.value), text);
});
test("CAPP-AC01 offline preview and interrupted v9 do not access env or network", async () => {
  const h = await harness();
  const forbidden = new Proxy(
    {},
    {
      get() {
        throw Error("ENV_FORBIDDEN");
      },
    },
  );
  assert.equal(
    (await runCApp(forbidden, h.store, undefined, undefined)).calls,
    43,
  );
  const ticket = await h.grant();
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    throw Error("OFFLINE");
  };
  await h.run(ticket, { controlFetch: fetchImpl });
  const before = calls;
  await runCApp(forbidden, h.store, undefined, undefined, { execute: true });
  assert.equal(calls, before);
  assert.notEqual(h.value.status, "completed");
});
test("CAPP-AC04 reserve reads retry once; mutations never retry; reservation precedes HTTP", async () => {
  const h = await harness(),
    ticket = await h.grant(),
    journal: ControlJournal = {
      attempts: [
        { id: ticket.intentId, action: "grant", bucket: "N", result: "OK" },
      ],
    };
  let count = 0,
    saves = 0;
  const bridge = remoteControlBridge({
    manifest: h.manifest,
    ticket,
    token: appToken,
    journal,
    clock: h.clock,
    save: async () => {
      saves++;
    },
    fetchImpl: async () => {
      assert.ok(saves > count);
      count++;
      if (count === 1) return bJson({}, 503);
      return bJson(h.state());
    },
  });
  await bridge.probe();
  assert.equal(count, 2);
  assert.deepEqual(
    journal.attempts.map((x) => x.bucket),
    ["N", "N", "R"],
  );
  const j2: ControlJournal = {
    attempts: [
      { id: ticket.intentId, action: "grant", bucket: "N", result: "OK" },
    ],
  };
  count = 0;
  const mutation = remoteControlBridge({
    manifest: h.manifest,
    ticket,
    token: appToken,
    journal: j2,
    clock: h.clock,
    save: async () => {},
    fetchImpl: async () => {
      count++;
      return bJson({}, 503);
    },
  });
  await assert.rejects(mutation.receiver.arm());
  await assert.rejects(mutation.receiver.arm());
  assert.equal(count, 1);
});
test("CAPP-AC04 poll interval and maxima are enforced before HTTP", async () => {
  const h = await harness(),
    ticket = await h.grant(),
    journal: ControlJournal = {
      attempts: [
        { id: ticket.intentId, action: "grant", bucket: "N", result: "OK" },
      ],
    };
  let calls = 0;
  const snapshot = { ...h.state(), armed: true };
  const bridge = remoteControlBridge({
    manifest: h.manifest,
    ticket,
    token: appToken,
    journal,
    clock: h.clock,
    save: async () => {},
    fetchImpl: async () => {
      calls++;
      return bJson(snapshot);
    },
  });
  for (let i = 0; i < 120; i++) {
    await bridge.receiver.observe();
    h.clock.time += 1000;
  }
  assert.equal(calls, 12);
  assert.equal(journal.attempts.length, 13);
  const max: ControlJournal = {
    attempts: [
      journal.attempts[0],
      ...Array.from({ length: 18 }, () => ({
        id: randomUUID(),
        action: "probe" as const,
        bucket: "N" as const,
        result: "OK",
      })),
      ...Array.from({ length: 4 }, () => ({
        id: randomUUID(),
        action: "probe" as const,
        bucket: "R" as const,
        result: "OK",
      })),
      { id: randomUUID(), action: "close", bucket: "H", result: "OK" },
      { id: randomUUID(), action: "revoke", bucket: "H", result: "OK" },
    ],
  };
  assert.equal(validateControlJournal(max).attempts.length, 25);
  assert.throws(() =>
    validateControlJournal({
      attempts: [
        ...max.attempts,
        { id: randomUUID(), action: "probe", bucket: "R", result: "OK" },
      ],
    }),
  );
});
test("CAPP-AC05 foreign/oversized/redirect snapshots and lost storage fail closed", async () => {
  const h = await harness(),
    ticket = await h.grant();
  for (const response of [
    bJson({ ...h.state(), nonce: "f".repeat(24) }),
    new Response("x".repeat(65537)),
    new Response(null, {
      status: 302,
      headers: { location: "https://outside.invalid" },
    }),
  ]) {
    let count = 0;
    const bridge = remoteControlBridge({
      manifest: h.manifest,
      ticket,
      token: appToken,
      journal: {
        attempts: [
          { id: ticket.intentId, action: "grant", bucket: "N", result: "OK" },
        ],
      },
      clock: h.clock,
      save: async () => {},
      fetchImpl: async () => {
        count++;
        return response;
      },
    });
    await assert.rejects(bridge.probe());
    assert.equal(count, 1);
  }
  let calls = 0;
  const bridge = remoteControlBridge({
    manifest: h.manifest,
    ticket,
    token: appToken,
    journal: {
      attempts: [
        { id: ticket.intentId, action: "grant", bucket: "N", result: "OK" },
      ],
    },
    clock: h.clock,
    save: async () => {
      throw Error("DISK");
    },
    fetchImpl: async () => {
      calls++;
      throw Error();
    },
  });
  await assert.rejects(bridge.probe(), /STORAGE/);
  await assert.rejects(bridge.finish(), /STORAGE/);
  assert.equal(calls, 0);
});
test("CAPP-AC07 late conflict in final frozen snapshot downgrades completion", async () => {
  const h = await harness(),
    ticket = await h.grant();
  const transport: typeof fetch = async (raw, init) => {
    const r = await h.controlFetch(raw, init);
    if (new Headers(init?.headers).get("X-S00-Control-Action") === "final") {
      const s = await r.json();
      return bJson({
        ...s,
        conflict: true,
        observations: 2,
        revision: s.revision + 1,
      });
    }
    return r;
  };
  const r = await h.run(ticket, { controlFetch: transport });
  assert.notEqual(r.status, "completed");
  assert.ok(h.value.final?.conflict);
  assert.equal(h.hook, undefined);
});
test("CAPP-AC09 file adapter locks, preserves source and rejects replaced state", async () => {
  const parent = resolve(".local/pipeline-os-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, "capp-"));
  try {
    const h = await harness(),
      folder = resolve(root, ".local/pipeline-os");
    await mkdir(folder, { recursive: true });
    await writeFile(
      resolve(folder, "s00-instantly-run.json"),
      JSON.stringify(h.inputs.source),
    );
    const files = cAppFiles(root);
    await assert.rejects(
      prepareCAppGrant(files.store, h.inputs, authorized),
      /LOCK/,
    );
    await files.locked(async () => {
      await prepareCAppGrant(files.store, h.inputs, authorized);
      await assert.rejects(cAppFiles(root).locked(async () => {}));
    });
    const s = validateCAppState((await files.store.load()) as CAppState);
    assert.equal(s.calls, 43);
    await files.locked(async () => {
      await assert.rejects(
        files.store.save({ ...s, sourceHash: "f".repeat(64) }),
      );
      await files.approval({
        intentId: s.control.attempts[0].id,
        manifest: h.manifest,
      });
      await assert.rejects(files.approval({}));
    });
    assert.equal(
      (await readdir(folder)).includes("s00-instantly-run.json.lock"),
      false,
    );
    assert.equal(
      (
        await readFile(resolve(folder, "c-app/runtime/approval.json"), "utf8")
      ).includes(appToken),
      false,
    );
    const node = process.execPath,
      loader = resolve("node_modules/tsx/dist/loader.mjs"),
      cli = resolve("scripts/pipeline-os/s00-instantly-c-app-cli.ts");
    const result = spawnSync(
      node,
      ["--import", pathToFileURL(loader).href, cli],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          SystemRoot: process.env.SystemRoot,
          PATH: process.env.PATH,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /awaiting_ticket/);
    assert.doesNotMatch(result.stdout, /intentId|canonicalHash|Bearer/);
  } finally {
    assert.ok(root.startsWith(parent));
    await rm(root, { recursive: true, force: true });
  }
});
test("CAPP-AC10 UI hidden for other roles and initial action disabled", () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(InstantlyTrialControl, { allowed: false }),
    ),
    "",
  );
  const text = renderToStaticMarkup(
    createElement(InstantlyTrialControl, { allowed: true }),
  );
  assert.match(text, /Autorizar este ensayo/);
  assert.match(text, /disabled/);
  assert.doesNotMatch(text, /INSTANTLY_API_KEY|service_role/);
});
test("CAPP-AC05 aborted response stream is bounded, does not retry or expose token", async () => {
  const h = await harness(),
    ticket = await h.grant(),
    controller = new AbortController();
  let calls = 0;
  const bridge = remoteControlBridge({
    manifest: h.manifest,
    ticket,
    token: appToken,
    journal: {
      attempts: [
        { id: ticket.intentId, action: "grant", bucket: "N", result: "OK" },
      ],
    },
    clock: h.clock,
    signal: controller.signal,
    save: async () => {},
    fetchImpl: async () => {
      calls++;
      setTimeout(() => controller.abort(), 5);
      return new Response(new ReadableStream({ start() {} }));
    },
  });
  await assert.rejects(bridge.probe(), /CAPP_CONTROL_FAILED/);
  assert.equal(calls, 1);
});
test("CAPP-AC11 control outage cleans only known provider hook using emergency reserve", async () => {
  const h = await harness(),
    ticket = await h.grant();
  let count = 0;
  const transport: typeof fetch = async (raw, init) => {
    if (new Headers(init?.headers).get("X-S00-Control-Action") === "observe") {
      count++;
      return bJson({}, 503);
    }
    return h.controlFetch(raw, init);
  };
  const r = await h.run(ticket, { controlFetch: transport });
  assert.notEqual(r.status, "completed");
  assert.equal(count, 2);
  assert.equal(h.hook, undefined);
  assert.equal(h.value.provider.cleanup, "verified");
  assert.equal(h.value.ticketDisabled, true);
  assert.equal(
    h.value.provider.requests.filter((q: any) => q.bucket === "H").length,
    2,
  );
  assert.ok(
    h.value.control.attempts.filter((q: any) => q.bucket === "H").length <= 2,
  );
  assert.ok(h.value.calls <= 62);
  assert.ok(h.value.control.attempts.length <= 25);
});
test("CAPP-AC05 storage loss after HTTP prevents any further request and leaves recovery explicit", async () => {
  const h = await harness(),
    ticket = await h.grant();
  let http = 0,
    saves = 0;
  const store = {
    load: h.store.load,
    save: async (s: CAppState) => {
      if (++saves === 3) throw Error("PRIVATE_DISK_SENTINEL");
      return h.store.save(s);
    },
  };
  await assert.rejects(
    runCApp(
      { ...cEnv, INSTANTLY_S00_CONTROL_TOKEN: appToken },
      store,
      h.inputs,
      ticket,
      {
        ...authorized,
        clock: h.clock,
        controlFetch: async (raw, init) => {
          http++;
          return h.controlFetch(raw, init);
        },
        fetchImpl: () => {
          throw Error("PROVIDER_FORBIDDEN");
        },
      },
    ),
    /STORAGE/,
  );
  assert.equal(http, 1);
  assert.equal(h.value.status, "running");
  assert.equal(h.value.control.attempts.at(-1).result, "IN_FLIGHT");
});
test("CAPP-AC11 crash at every durable save stops transport and cannot replay after restart", async () => {
  const completed = await harness(),
    t = await completed.grant();
  let saves = 0;
  const original = completed.store.save;
  completed.store.save = async (s) => {
    saves++;
    return original(s);
  };
  assert.equal((await completed.run(t)).status, "completed");
  for (let point = 1; point <= saves; point++) {
    const h = await harness(),
      ticket = await h.grant(),
      save = h.store.save;
    let writes = 0,
      atFailure: typeof h.counts | undefined;
    h.store.save = async (s) => {
      if (++writes === point) {
        atFailure = { ...h.counts };
        throw Error("OFFLINE_CRASH");
      }
      return save(s);
    };
    await assert.rejects(h.run(ticket), /STORAGE|OFFLINE_CRASH/);
    assert.deepEqual(h.counts, atFailure, `transport after save ${point}`);
    if (h.value.status === "running") {
      const before = { ...h.counts };
      await h.run(ticket);
      assert.deepEqual(h.counts, before, `restart replay ${point}`);
    }
  }
});
