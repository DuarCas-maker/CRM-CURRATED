import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  controlHash,
  controlTicketSchema,
  controlSnapshotSchema,
  validateCAppManifest,
  type ControlSnapshot,
} from "../../src/lib/server/instantly/control-contract";
import {
  runInstantlyC,
  validateCSource,
  validateCState,
  validateCInputs,
  assertCTransition,
  type CState,
  type CInputs,
} from "./s00-instantly-c";
import { instantlyA } from "./s00-instantly-runner";
import {
  remoteControlBridge,
  validateControlJournal,
  type ControlJournal,
} from "./s00-instantly-control-bridge";
import type { BR28State } from "./s00-instantly-b-recovery-from-28";
export type CAppState = {
  version: 9;
  phase: "C_APP";
  sourceHash: string;
  manifestHash: string;
  calls: number;
  status: "awaiting_ticket" | "running" | "completed" | "partial" | "failed";
  provider: BR28State | CState;
  control: ControlJournal;
  final?: ControlSnapshot;
  ticketDisabled: boolean;
};
export type CAppStore = {
  load: () => Promise<BR28State | CAppState | undefined>;
  save: (s: CAppState) => Promise<void>;
};
export type CAppInputs = {
  source: BR28State;
  scope: unknown;
  bManifest: unknown;
  manifest: unknown;
};
export function validateCAppInputs(i: CAppInputs) {
  const source = validateCSource(i.source),
    m = validateCAppManifest(i.manifest),
    v = validateCInputs({
      source,
      scope: i.scope,
      manifest: i.bManifest,
      receiver: m.receiverManifest,
    });
  if (
    m.source.canonicalHash !== v.sourceHash ||
    m.source.scopeHash !== v.scopeHash ||
    m.source.bManifestHash !== v.manifestHash ||
    m.source.campaignId !== source.prior.prior.prior.prior.campaignId ||
    m.source.configurationFingerprint !==
      source.prior.prior.prior.prior.prior.predecessor.fingerprint
  )
    throw Error("CAPP_INPUT_BINDING");
  return m;
}
export function validateCAppState(s: CAppState): CAppState {
  if (
    !s ||
    s.version !== 9 ||
    s.phase !== "C_APP" ||
    !["awaiting_ticket", "running", "completed", "partial", "failed"].includes(
      s.status,
    ) ||
    ![
      "version",
      "phase",
      "sourceHash",
      "manifestHash",
      "calls",
      "status",
      "provider",
      "control",
      "final",
      "ticketDisabled",
    ].every((k) => k in s || k === "final") ||
    Object.keys(s).some(
      (k) =>
        ![
          "version",
          "phase",
          "sourceHash",
          "manifestHash",
          "calls",
          "status",
          "provider",
          "control",
          "final",
          "ticketDisabled",
        ].includes(k),
    )
  )
    throw Error("CAPP_INVALID_JOURNAL");
  const source =
    s.provider.version === 8
      ? validateCState(s.provider).prior
      : validateCSource(s.provider);
  if (
    s.sourceHash !== controlHash(JSON.stringify(source)) ||
    s.calls !== s.provider.calls ||
    !Number.isInteger(s.calls) ||
    s.calls < 43 ||
    s.calls > 62 ||
    !/^[a-f0-9]{64}$/.test(s.manifestHash) ||
    typeof s.ticketDisabled !== "boolean"
  )
    throw Error("CAPP_INVALID_JOURNAL");
  validateControlJournal(s.control);
  if (
    s.status === "awaiting_ticket" &&
    (s.provider.version !== 7 ||
      s.control.attempts.length !== 1 ||
      s.control.attempts[0].result !== "IN_FLIGHT")
  )
    throw Error("CAPP_INVALID_JOURNAL");
  if (s.final) {
    const f = controlSnapshotSchema.parse(s.final);
    if (
      f.sourceHash !== s.sourceHash ||
      s.provider.version !== 8 ||
      f.manifestHash !== s.provider.receiverHash
    )
      throw Error("CAPP_FINAL_BINDING");
  }
  if (
    s.status === "completed" &&
    (s.provider.version !== 8 ||
      s.provider.status !== "completed" ||
      !s.final?.closed ||
      s.final.conflict ||
      !s.final.contextValidated ||
      !s.final.authenticated ||
      !s.ticketDisabled)
  )
    throw Error("CAPP_INVALID_COMPLETION");
  return s;
}
export function assertCAppTransition(p: BR28State | CAppState, n: CAppState) {
  validateCAppState(n);
  if (p.version === 7) {
    if (n.status !== "awaiting_ticket" || !isDeepStrictEqual(n.provider, p))
      throw Error("CAPP_SOURCE_CHANGED");
    return;
  }
  validateCAppState(p);
  if (
    p.status !== "awaiting_ticket" &&
    p.status !== "running" &&
    !isDeepStrictEqual(p, n)
  )
    throw Error("CAPP_TERMINAL");
  if (
    p.sourceHash !== n.sourceHash ||
    p.manifestHash !== n.manifestHash ||
    n.calls < p.calls ||
    n.control.attempts.length < p.control.attempts.length ||
    n.control.attempts.length > p.control.attempts.length + 1 ||
    (p.ticketDisabled && !n.ticketDisabled)
  )
    throw Error("CAPP_HISTORY_CHANGED");
  for (let k = 0; k < p.control.attempts.length; k++) {
    const a = p.control.attempts[k],
      b = n.control.attempts[k];
    if (
      a.id !== b.id ||
      a.action !== b.action ||
      a.bucket !== b.bucket ||
      (a.result !== "IN_FLIGHT" &&
        a.result !== b.result &&
        !(a.result === "HTTP_200" && b.result === "OK"))
    )
      throw Error("CAPP_HISTORY_CHANGED");
  }
  if (n.provider.version === 8) assertCTransition(p.provider, n.provider);
  else if (!isDeepStrictEqual(p.provider, n.provider))
    throw Error("CAPP_HISTORY_CHANGED");
}
export async function prepareCAppGrant(
  store: CAppStore,
  inputs: CAppInputs,
  options: {
    execute?: boolean;
    authorizedProviderNew?: number;
    authorizedProviderTotal?: number;
    authorizedControlNew?: number;
  } = {},
) {
  const m = validateCAppInputs(inputs);
  if (!options.execute)
    return { mode: "offline", calls: 43, appRequests: 0, ready: true };
  if (
    options.authorizedProviderNew !== 19 ||
    options.authorizedProviderTotal !== 62 ||
    options.authorizedControlNew !== 25
  )
    throw Error("CAPP_AUTHORIZATION_REQUIRED");
  const old = await store.load();
  if (!old || old.version !== 7 || !isDeepStrictEqual(old, inputs.source))
    throw Error("CAPP_SOURCE_REQUIRED");
  const s: CAppState = {
    version: 9,
    phase: "C_APP",
    sourceHash: m.source.canonicalHash,
    manifestHash: controlHash(JSON.stringify(m)),
    calls: 43,
    status: "awaiting_ticket",
    provider: old,
    control: {
      attempts: [
        { id: randomUUID(), action: "grant", bucket: "N", result: "IN_FLIGHT" },
      ],
    },
    ticketDisabled: false,
  };
  assertCAppTransition(old, s);
  await store.save(s);
  return { intentId: s.control.attempts[0].id, manifest: m };
}
export function cAppReport(s: BR28State | CAppState | undefined) {
  if (!s)
    return {
      phase: "C_APP",
      status: "not_started",
      calls: 0,
      controlRequests: 0,
    };
  if (s.version === 7) {
    validateCSource(s);
    return {
      phase: "C_APP",
      status: "not_started",
      calls: 43,
      controlRequests: 0,
    };
  }
  validateCAppState(s);
  return {
    phase: "C_APP",
    status: s.status,
    calls: s.calls,
    providerNew: s.calls - 43,
    controlRequests: s.control.attempts.length,
    ticketDisabled: s.ticketDisabled,
    closed: !!s.final?.closed,
    interruptedNeedsReview: s.status === "running",
    sends: 0,
    realReplyVerified: false,
  };
}
export async function runCApp(
  env: Readonly<Record<string, string | undefined>>,
  store: CAppStore,
  inputs: CAppInputs | undefined,
  ticketValue: unknown,
  options: {
    execute?: boolean;
    authorizedProviderNew?: number;
    authorizedProviderTotal?: number;
    authorizedControlNew?: number;
    includedConfirmed?: boolean;
    fetchImpl?: typeof fetch;
    controlFetch?: typeof fetch;
    clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
    signal?: AbortSignal;
  } = {},
) {
  const old = await store.load();
  if (
    !options.execute ||
    (old?.version === 9 && old.status !== "awaiting_ticket")
  )
    return cAppReport(old);
  if (
    options.authorizedProviderNew !== 19 ||
    options.authorizedProviderTotal !== 62 ||
    options.authorizedControlNew !== 25 ||
    !options.includedConfirmed
  )
    throw Error("CAPP_AUTHORIZATION_REQUIRED");
  if (!inputs || !old || old.version !== 9 || old.status !== "awaiting_ticket")
    throw Error("CAPP_GRANT_REQUIRED");
  const m = validateCAppInputs(inputs);
  if (old.manifestHash !== controlHash(JSON.stringify(m)))
    throw Error("CAPP_MANIFEST_CHANGED");
  const ticket = controlTicketSchema.parse(ticketValue),
    config = instantlyA.configuration(env);
  if (
    config.workspace !== m.source.workspaceId ||
    config.fingerprint !== m.source.configurationFingerprint
  )
    throw Error("CAPP_CONFIGURATION_CHANGED");
  const token = env.INSTANTLY_S00_CONTROL_TOKEN;
  if (
    !token ||
    [
      config.key,
      env.INSTANTLY_S00_WEBHOOK_SECRET,
      env.INSTANTLY_S00_WEBHOOK_DEDUP_KEY,
    ].includes(token)
  )
    throw Error("CAPP_TOKEN_REQUIRED");
  let s = structuredClone(old),
    saved = structuredClone(old),
    storageUncertain = false;
  const persist = async () => {
    if (storageUncertain) throw Error("CAPP_STORAGE_UNCERTAIN");
    s.calls = s.provider.calls;
    assertCAppTransition(saved, s);
    try {
      await store.save(structuredClone(s));
    } catch {
      storageUncertain = true;
      throw Error("CAPP_STORAGE_UNCERTAIN");
    }
    saved = structuredClone(s);
  };
  const clock = options.clock ?? {
    now: Date.now,
    sleep: async (ms: number) => {
      await new Promise((r) => setTimeout(r, ms));
    },
  };
  const bridge = remoteControlBridge({
    manifest: m,
    ticket,
    token,
    journal: s.control,
    save: persist,
    fetchImpl: options.controlFetch ?? fetch,
    clock,
    signal: options.signal,
    emergency: () =>
      !!options.signal?.aborted ||
      (s.provider.version === 8 && s.provider.stage !== 12),
  });
  s.control.attempts[0].result = "OK";
  s.status = "running";
  await persist();
  let failure = false;
  try {
    await bridge.probe();
    const cInputs: CInputs = {
      source: inputs.source,
      scope: inputs.scope,
      manifest: inputs.bManifest,
      receiver: m.receiverManifest,
    };
    await runInstantlyC(
      env,
      {
        load: async () => s.provider,
        save: async (next) => {
          s.provider = next;
          await persist();
        },
      },
      cInputs,
      {
        execute: true,
        authorizedNew: 19,
        authorizedTotal: 62,
        includedCallsConfirmed: true,
        webhooksIncludedConfirmed: true,
        manifestReviewed: true,
        receiverReady: true,
        receiverFactory: () => bridge.receiver,
        receiverFailureAsOperational: true,
        fetchImpl: options.fetchImpl,
        clock: { now: () => clock.now(), sleep: (ms) => clock.sleep(ms) },
        signal: options.signal,
      },
    );
  } catch {
    failure = true;
  }
  if (storageUncertain) throw Error("CAPP_STORAGE_UNCERTAIN");
  try {
    const result = await bridge.finish();
    s.final = result.snapshot;
    s.ticketDisabled = result.disabled;
  } catch {
    failure = true;
    const result = bridge.state();
    s.final = result.snapshot;
    s.ticketDisabled = result.disabled;
  }
  if (storageUncertain) throw Error("CAPP_STORAGE_UNCERTAIN");
  s.status = failure
    ? "failed"
    : s.provider.version === 8 &&
        s.provider.status === "completed" &&
        s.final?.closed &&
        s.final.authenticated &&
        s.final.contextValidated &&
        !s.final.conflict &&
        s.ticketDisabled
      ? "completed"
      : "partial";
  await persist();
  return cAppReport(s);
}
