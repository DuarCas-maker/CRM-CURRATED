// Isolated C phase. No environment, network, listener or persistence effects on import.
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { hash, S00RunError } from "./s00-composio-common";
import {
  instantlyA as a,
  instantlyWebhookJson,
  type InstantlyClock,
} from "./s00-instantly-runner";
import { instantlyB as b, type BTrialContext } from "./s00-instantly-b";
import {
  validateBR28State,
  validateBR28Inputs,
  type BR28State,
} from "./s00-instantly-b-recovery-from-28";
import {
  validateCManifest,
  cSecrets,
  cPayloadDigest,
  type CManifest,
  type CReceiver,
  type CObservation,
} from "./s00-instantly-c-receiver";

const fail = (code: string): never => {
  throw new S00RunError(code);
};
const digest = z.string().regex(/^[a-f0-9]{64}$/),
  id = z.string().uuid();
type Obj = Record<string, unknown>;
export const cSteps = [
  "workspace",
  "plan",
  "current",
  "hooks",
  "create",
  "hook",
  "test",
  "logs",
  "detail",
  "remove",
  "absent",
  "final",
] as const;
type Step = (typeof cSteps)[number];
const cErrors = [
  "C_NONCE_EXISTS",
  "C_RESOURCE_MISMATCH",
  "C_INVALID_PROVIDER_SCHEMA",
  "C_UNRESOLVED_CREATE",
  "C_RESERVE_REQUIRED",
  "C_CLEANUP_REQUIRED",
  "C_WINDOW_CLOSED",
  "C_RECEIVER_FAILED",
] as const;
const errors = [...b.errors, ...cErrors] as const;
const transient = (code: string) =>
  ["NETWORK_OR_TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(code);
const uncertain = (e: unknown) =>
  (e instanceof a.ReadError &&
    [
      "NETWORK_OR_TIMEOUT",
      "HTTP_429",
      "HTTP_5XX",
      "INVALID_RESPONSE",
      "RESPONSE_LIMIT",
      "CANCELLED",
    ].includes(e.code)) ||
  (e instanceof S00RunError && e.code === "C_INVALID_PROVIDER_SCHEMA");
const context = (s: BR28State): BTrialContext => ({
  prior: s.prior.prior.prior.prior.prior,
  campaignId: s.prior.prior.prior.prior.campaignId,
  leads: s.leads,
});
export function validateCSource(value: unknown): BR28State {
  const s = validateBR28State(value);
  if (
    s.calls !== 43 ||
    s.status !== "completed" ||
    s.stage !== 13 ||
    s.normal !== 15 ||
    s.reserve ||
    s.hold ||
    s.requests.length !== 15
  )
    fail("C_SOURCE_REQUIRED");
  return value as BR28State;
}
export type CInputs = {
  source: BR28State;
  scope: unknown;
  manifest: unknown;
  receiver: unknown;
};
export function validateCInputs(input: CInputs) {
  const source = validateCSource(input.source),
    v = validateBR28Inputs({
      source: source.prior,
      scope: input.scope,
      manifest: input.manifest,
    });
  if (
    source.scopeHash !== v.scopeHash ||
    source.manifestHash !== v.manifestHash
  )
    fail("C_BINDING_CHANGED");
  const receiver = validateCManifest(input.receiver),
    sourceHash = hash(JSON.stringify(source));
  if (receiver.sourceHash !== sourceHash) fail("C_BINDING_CHANGED");
  return {
    ...v,
    source,
    sourceHash,
    receiver,
    receiverHash: hash(JSON.stringify(receiver)),
  };
}
const schema = z
  .object({
    version: z.literal(8),
    provider: z.literal("instantly"),
    phase: z.literal("C"),
    prior: z.custom<BR28State>(),
    sourceHash: digest,
    scopeHash: digest,
    manifestHash: digest,
    receiverHash: digest,
    calls: z.number().int().min(43).max(62),
    normal: z.number().int().min(0).max(14),
    reserve: z.number().int().min(0).max(3),
    hold: z.number().int().min(0).max(2),
    status: z.enum(["running", "completed", "partial", "failed"]),
    stage: z.number().int().min(0).max(12),
    campaignVerified: z.boolean(),
    hookId: id.nullable(),
    hookVerified: z.boolean(),
    logId: id.nullable(),
    receiverArmed: z.boolean(),
    testConfirmed: z.boolean(),
    receiptObserved: z.boolean(),
    receiptConflict: z.boolean(),
    contextValidated: z.boolean(),
    logVerified: z.boolean(),
    cleaned: z.boolean(),
    finalVerified: z.boolean(),
    cleanup: z.enum(["not_needed", "pending", "verified", "unknown"]),
    error: z.enum(errors).nullable(),
    requests: z
      .array(
        z
          .object({
            step: z.enum(cSteps),
            page: z.number().int().min(1).max(2),
            bucket: z.enum(["N", "R", "H"]),
            purpose: z.enum(["normal", "retry", "reconcile", "emergency"]),
            result: z.enum([...a.codes, "NOT_FOUND"]),
          })
          .strict(),
      )
      .max(19),
  })
  .strict();
export type CState = z.infer<typeof schema>;
export interface CStore {
  load(): Promise<BR28State | CState | undefined>;
  save(s: CState): Promise<void>;
}
export function validateCState(value: unknown): CState {
  const p = schema.safeParse(value);
  if (!p.success) return fail("C_INVALID_JOURNAL");
  const s = p.data;
  validateCSource(s.prior);
  const attempted = (step: Step) =>
    s.requests.some((q) => q.step === step && q.bucket === "N");
  if (
    s.sourceHash !== hash(JSON.stringify(s.prior)) ||
    s.scopeHash !== s.prior.scopeHash ||
    s.manifestHash !== s.prior.manifestHash ||
    s.calls !== 43 + s.requests.length ||
    s.normal !== s.requests.filter((q) => q.bucket === "N").length ||
    s.reserve !== s.requests.filter((q) => q.bucket === "R").length ||
    s.hold !== s.requests.filter((q) => q.bucket === "H").length ||
    (s.status === "failed") !== (s.error !== null) ||
    s.campaignVerified !== s.stage >= 3 ||
    (s.hookVerified && !s.hookId) ||
    (s.hookId && !attempted("create")) ||
    (s.receiverArmed && (!s.hookVerified || s.stage < 6)) ||
    (s.testConfirmed && !attempted("test")) ||
    (s.logVerified && !s.logId) ||
    (s.contextValidated && !s.receiptObserved) ||
    (s.receiptConflict && !s.receiptObserved) ||
    s.cleaned !== (s.cleanup === "verified") ||
    (s.cleanup === "not_needed" && attempted("create")) ||
    s.finalVerified !== (s.stage === 12) ||
    (s.stage >= 5 && !s.hookId) ||
    (s.stage >= 6 && !s.hookVerified) ||
    (s.stage >= 7 && !attempted("test"))
  )
    fail("C_INVALID_JOURNAL");
  let rank = -1,
    emergency = false;
  const pages = new Map<string, number>();
  for (const [i, q] of s.requests.entries()) {
    const prev = s.requests[i - 1],
      r = cSteps.indexOf(q.step);
    if (
      q.result === "IN_FLIGHT" &&
      (i !== s.requests.length - 1 || s.status !== "running")
    )
      fail("C_INVALID_JOURNAL");
    if (q.result === "NOT_FOUND" && !["absent", "hook"].includes(q.step))
      fail("C_INVALID_JOURNAL");
    if (q.bucket === "N") {
      const expected =
        rank < 0
          ? 0
          : r === rank && ["hooks", "logs"].includes(q.step)
            ? rank
            : rank === 7 && r === 9 && !s.logId
              ? 9
              : rank + 1;
      if (
        emergency ||
        q.purpose !== "normal" ||
        r !== expected ||
        r > s.stage ||
        q.page !== (pages.get(q.step) ?? 0) + 1 ||
        (q.page > 1 && !["hooks", "logs"].includes(q.step))
      )
        fail("C_INVALID_JOURNAL");
      rank = r;
      pages.set(q.step, q.page);
    } else if (q.bucket === "R") {
      if (
        emergency ||
        !prev ||
        prev.step !== q.step ||
        prev.page !== q.page ||
        (q.purpose === "retry"
          ? !transient(prev.result) || prev.purpose === "retry"
          : q.purpose !== "reconcile" ||
            prev.bucket !== "N" ||
            !["create", "test"].includes(q.step))
      )
        fail("C_INVALID_JOURNAL");
    } else {
      if (
        !s.hookId ||
        !s.hookVerified ||
        q.purpose !== "emergency" ||
        q.page !== 1 ||
        !["remove", "absent"].includes(q.step)
      )
        fail("C_INVALID_JOURNAL");
      if (
        q.step === "remove" &&
        s.requests.slice(0, i).some((x) => x.step === "remove")
      )
        fail("C_INVALID_JOURNAL");
      if (
        q.step === "absent" &&
        s.requests
          .slice(0, i)
          .some((x) => x.bucket === "H" && x.step === "absent")
      )
        fail("C_INVALID_JOURNAL");
      emergency = true;
    }
  }
  if (
    s.stage > rank + 1 + (rank === 7 && !s.logId ? 1 : 0) ||
    (s.cleaned &&
      !s.requests.some(
        (q) => q.step === "absent" && q.result === "NOT_FOUND",
      )) ||
    (["completed", "partial"].includes(s.status) &&
      (s.stage !== 12 ||
        !s.cleaned ||
        !s.finalVerified ||
        s.requests.at(-1)?.step !== "final" ||
        s.requests.at(-1)?.result !== "OK")) ||
    (s.status === "completed" &&
      (!s.receiptObserved ||
        s.receiptConflict ||
        !s.contextValidated ||
        !s.testConfirmed ||
        !s.logVerified)) ||
    (s.status === "partial" &&
      s.receiptObserved &&
      !s.receiptConflict &&
      s.contextValidated &&
      s.testConfirmed &&
      s.logVerified)
  )
    fail("C_INVALID_JOURNAL");
  // A later checkpoint cannot turn a failed earlier read into historical success.
  for (const step of cSteps.slice(0, s.stage)) {
    if (step === "detail" && !s.logId) continue;
    const last = s.requests.findLast((q) => q.step === step);
    const accepted =
      step === "absent"
        ? last?.result === "NOT_FOUND"
        : step === "remove"
          ? last?.result === "OK" ||
            (!!last &&
              [
                "NETWORK_OR_TIMEOUT",
                "HTTP_429",
                "HTTP_5XX",
                "INVALID_RESPONSE",
                "RESPONSE_LIMIT",
              ].includes(last.result))
          : last?.result === "OK";
    if (!accepted) fail("C_INVALID_JOURNAL");
  }
  return s;
}
export function assertCTransition(
  previous: BR28State | CState | undefined,
  next: CState,
) {
  validateCState(next);
  if (!previous) return fail("C_SOURCE_REQUIRED");
  if (previous.version === 7) {
    validateCSource(previous);
    if (
      next.sourceHash !== hash(JSON.stringify(previous)) ||
      next.calls !== 43 ||
      next.stage ||
      next.requests.length ||
      next.status !== "running" ||
      next.hookId ||
      next.cleanup !== "not_needed" ||
      next.receiverArmed ||
      next.receiptObserved ||
      next.testConfirmed ||
      next.logVerified
    )
      fail("C_HISTORY_IMMUTABLE");
    return;
  }
  const p = validateCState(previous);
  if (isDeepStrictEqual(p, next)) return;
  if (
    p.status !== "running" ||
    JSON.stringify(p.prior) !== JSON.stringify(next.prior) ||
    ["sourceHash", "scopeHash", "manifestHash", "receiverHash"].some(
      (k) => p[k as keyof CState] !== next[k as keyof CState],
    ) ||
    next.calls < p.calls ||
    next.calls > p.calls + 1 ||
    next.stage < p.stage ||
    next.stage > p.stage + 1 ||
    (p.hookId && p.hookId !== next.hookId) ||
    (p.logId && p.logId !== next.logId)
  )
    fail("C_HISTORY_IMMUTABLE");
  for (const k of [
    "campaignVerified",
    "hookVerified",
    "receiverArmed",
    "testConfirmed",
    "receiptObserved",
    "receiptConflict",
    "contextValidated",
    "logVerified",
    "cleaned",
    "finalVerified",
  ] as const)
    if (p[k] && !next[k]) fail("C_HISTORY_IMMUTABLE");
  for (const [i, q] of p.requests.entries()) {
    const n = next.requests[i];
    if (
      !n ||
      q.step !== n.step ||
      q.bucket !== n.bucket ||
      q.purpose !== n.purpose ||
      q.page !== n.page ||
      (q.result !== "IN_FLIGHT" && q.result !== n.result)
    )
      fail("C_HISTORY_IMMUTABLE");
  }
  if (
    next.calls !== p.calls &&
    (next.stage !== p.stage ||
      p.requests.at(-1)?.result === "IN_FLIGHT" ||
      next.requests.at(-1)?.result !== "IN_FLIGHT" ||
      (next.requests.at(-1)?.bucket === "N" &&
        next.requests.at(-1)?.step !== cSteps[p.stage]))
  )
    fail("C_HISTORY_IMMUTABLE");
  if (
    next.stage !== p.stage &&
    (next.calls !== p.calls ||
      next.requests.at(-1)?.result === "IN_FLIGHT" ||
      (p.stage !== 8 &&
        !next.requests.some(
          (q) => q.bucket === "N" && q.step === cSteps[p.stage],
        )))
  )
    fail("C_HISTORY_IMMUTABLE");
}
export function cRequest(
  s: CState,
  m: CManifest,
  step: Step,
  token: string,
  options: { cursor?: string; reconcile?: boolean } = {},
) {
  validateCState(s);
  validateCManifest(m);
  if (
    !cSteps.includes(step) ||
    hash(JSON.stringify(m)) !== s.receiverHash ||
    hash(token) !== m.tokenHash
  )
    fail("C_BLOCKED_ROUTE");
  if (
    (options.cursor && !["hooks", "logs"].includes(step)) ||
    (options.reconcile && !["create", "test"].includes(step))
  )
    fail("C_BLOCKED_ROUTE");
  const ctx = context(s.prior),
    root = "https://api.instantly.ai/api/v2/";
  const req = {
    url: root,
    method: "GET" as "GET" | "POST" | "DELETE",
    body: undefined as Obj | undefined,
    write: false,
  };
  const hook = () => {
    if (!s.hookId) fail("C_RESOURCE_MISMATCH");
    return root + "webhooks/" + s.hookId;
  };
  if (step === "workspace") req.url += "workspaces/current";
  else if (step === "plan") req.url += "workspace-billing/plan-details";
  else if (step === "current" || step === "final")
    req.url += "campaigns/" + ctx.campaignId;
  else if (step === "hooks" || (step === "create" && options.reconcile)) {
    const u = new URL(root + "webhooks");
    u.searchParams.set("campaign", ctx.campaignId!);
    u.searchParams.set("event_type", "reply_received");
    u.searchParams.set("limit", "100");
    if (options.cursor) u.searchParams.set("starting_after", options.cursor);
    req.url = u.href;
  } else if (step === "create") {
    req.url += "webhooks";
    req.method = "POST";
    req.write = true;
    req.body = {
      target_hook_url: m.url,
      campaign: ctx.campaignId,
      name: "S00-INS-C-" + m.nonce,
      event_type: "reply_received",
      headers: { "X-S00-Webhook-Token": token },
    };
  } else if (step === "hook" || step === "absent") req.url = hook();
  else if (step === "test" && !options.reconcile) {
    req.url = hook() + "/test";
    req.method = "POST";
    req.write = true;
  } else if (step === "logs" || (step === "test" && options.reconcile)) {
    const u = new URL(root + "webhook-events");
    u.searchParams.set("search", m.url);
    u.searchParams.set("from", new Date(m.startsAt).toISOString().slice(0, 10));
    u.searchParams.set("to", new Date(m.endsAt).toISOString().slice(0, 10));
    u.searchParams.set("limit", "100");
    if (options.cursor) u.searchParams.set("starting_after", options.cursor);
    req.url = u.href;
  } else if (step === "detail") {
    if (!s.logId) fail("C_RESOURCE_MISMATCH");
    req.url += "webhook-events/" + s.logId;
  } else if (step === "remove") {
    req.url = hook();
    req.method = "DELETE";
    req.write = true;
  } else fail("C_BLOCKED_ROUTE");
  return req;
}
export function cReport(s?: CState, source?: BR28State) {
  if (s) validateCState(s);
  if (source) validateCSource(source);
  return {
    provider: "instantly",
    phase: "C",
    status: s?.status ?? "not_started",
    calls: s?.calls ?? source?.calls ?? 0,
    priorCalls: 43,
    newCalls: s?.requests.length ?? 0,
    budget: {
      normal: s?.normal ?? 0,
      reserve: s?.reserve ?? 0,
      hold: s?.hold ?? 0,
      maxNew: 19,
      maxAccumulated: 62,
    },
    stage: s?.stage ?? 0,
    error: s?.error ?? null,
    transportObserved: s?.receiptObserved ?? false,
    contextValidated: !!s?.contextValidated && !s.receiptConflict,
    conflictingDeliveries: s?.receiptConflict ?? false,
    logVerified: s?.logVerified ?? false,
    cleanup: s?.cleanup ?? "not_needed",
    campaignFinalVerified: s?.finalVerified ?? false,
    interruptedNeedsReview: s?.status === "running",
    sends: 0,
    paidOperations: 0,
    campaignMutations: 0,
    realReplyVerified: false,
    individualSchedulerPauseVerified: false,
    sendingSafetyCertified: false,
    providerBillingMeasured: false,
  };
}
export async function runInstantlyC(
  env: Readonly<Record<string, string | undefined>>,
  store: CStore,
  inputs: CInputs | undefined,
  options: {
    execute?: boolean;
    authorizedNew?: number;
    authorizedTotal?: number;
    includedCallsConfirmed?: boolean;
    webhooksIncludedConfirmed?: boolean;
    manifestReviewed?: boolean;
    receiverReady?: boolean;
    receiverFailureAsOperational?: boolean;
    fetchImpl?: typeof fetch;
    clock?: InstantlyClock;
    signal?: AbortSignal;
    receiverFactory?: (input: {
      manifest: CManifest;
      workspace: string;
      campaign: string;
      token: string;
      key: string;
      now: () => number;
    }) => CReceiver;
  } = {},
) {
  if (!options.execute) {
    const old = await store.load();
    return old?.version === 8 ? cReport(old) : cReport(undefined, old);
  }
  if (
    options.authorizedNew !== 19 ||
    options.authorizedTotal !== 62 ||
    !options.includedCallsConfirmed ||
    !options.webhooksIncludedConfirmed ||
    !options.manifestReviewed ||
    !options.receiverReady
  )
    fail("C_AUTHORIZATION_REQUIRED");
  const old = await store.load();
  if (old?.version === 8) return cReport(old);
  if (!old || !inputs || !options.receiverFactory)
    return fail("C_INPUTS_REQUIRED");
  const v = validateCInputs(inputs),
    source = validateCSource(old);
  if (hash(JSON.stringify(source)) !== v.sourceHash) fail("C_SOURCE_CHANGED");
  const config = a.configuration(env);
  if (
    config.fingerprint !==
    source.prior.prior.prior.prior.prior.predecessor.fingerprint
  )
    fail("INSTANTLY_BINDING_CHANGED");
  const secrets = cSecrets(env, v.receiver),
    // C compares absolute webhook timestamps/windows; A's performance clock is relative.
    clock = options.clock ?? {
      now: () => Date.now(),
      sleep: a.realClock.sleep,
    };
  if (clock.now() > v.receiver.endsAt || clock.now() < v.receiver.startsAt)
    fail("C_WINDOW_CLOSED");
  const receiver = options.receiverFactory!({
    manifest: v.receiver,
    workspace: config.workspace,
    campaign: context(source).campaignId!,
    ...secrets,
    now: () => clock.now(),
  });
  const s: CState = {
    version: 8,
    provider: "instantly",
    phase: "C",
    prior: source,
    sourceHash: v.sourceHash,
    scopeHash: v.scopeHash,
    manifestHash: v.manifestHash,
    receiverHash: v.receiverHash,
    calls: 43,
    normal: 0,
    reserve: 0,
    hold: 0,
    status: "running",
    stage: 0,
    campaignVerified: false,
    hookId: null,
    hookVerified: false,
    logId: null,
    receiverArmed: false,
    testConfirmed: false,
    receiptObserved: false,
    receiptConflict: false,
    contextValidated: false,
    logVerified: false,
    cleaned: false,
    finalVerified: false,
    cleanup: "not_needed",
    error: null,
    requests: [],
  };
  const save = async () => {
    validateCState(s);
    try {
      await store.save(structuredClone(s));
    } catch {
      fail("C_STORAGE_OR_INTERNAL_FAILURE");
    }
  };
  await save();
  let last: number | undefined;
  const wait = async (ms: number, emergency = false) => {
    if (options.signal?.aborted && !emergency) fail("CANCELLED");
    try {
      if (ms > 0) await clock.sleep(ms, emergency ? undefined : options.signal);
    } catch {
      fail("CANCELLED");
    }
  };
  const remaining = [14, 13, 12, 11, 9, 8, 7, 6, 4, 3, 2, 1, 0];
  async function request(
    step: Step,
    bucket: "N" | "R" | "H" = "N",
    page = 1,
    cursor = "",
    reconcile = false,
    purpose: CState["requests"][number]["purpose"] = "normal",
  ): Promise<Obj | null> {
    const req = cRequest(s, v.receiver, step, secrets.token, {
      cursor,
      reconcile,
    });
    await wait(
      last === undefined ? 0 : Math.max(0, 1000 - (clock.now() - last)),
      bucket === "H",
    );
    if (
      s.calls >= 62 ||
      (bucket === "N"
        ? s.normal >= 14
        : bucket === "R"
          ? s.reserve >= 3
          : s.hold >= 2)
    )
      fail("BUDGET_EXHAUSTED");
    if (step === "test" && req.write && clock.now() >= v.receiver.endsAt)
      fail("C_WINDOW_CLOSED");
    if (
      bucket === "H" &&
      (!s.hookVerified || !s.hookId || !["remove", "absent"].includes(step))
    )
      fail("C_BLOCKED_ROUTE");
    if (
      req.write &&
      bucket !== "H" &&
      (s.reserve >= 3 ||
        s.hold ||
        14 - s.normal < remaining[s.stage] ||
        62 - s.calls < remaining[s.stage] + 3)
    )
      fail("C_RESERVE_REQUIRED");
    if (
      req.write &&
      s.requests.some(
        (q) =>
          q.step === step && q.purpose !== "reconcile" && q.purpose !== "retry",
      )
    )
      fail("C_BLOCKED_ROUTE");
    const q: CState["requests"][number] = {
      step,
      page,
      bucket,
      purpose,
      result: "IN_FLIGHT",
    };
    s.requests.push(q);
    s.calls++;
    if (bucket === "N") s.normal++;
    else if (bucket === "R") s.reserve++;
    else s.hold++;
    if (step === "create" && req.write) s.cleanup = "pending";
    await save();
    last = clock.now();
    let body: Obj | null = null,
      failure: InstanceType<typeof a.ReadError> | undefined;
    try {
      body = await instantlyWebhookJson(
        options.fetchImpl ?? fetch,
        config.key,
        req.url,
        req.method,
        req.body,
        bucket === "H" ? undefined : options.signal,
      );
      q.result = body === null ? "NOT_FOUND" : "OK";
    } catch (e) {
      if (!(e instanceof a.ReadError)) throw e;
      failure = e;
      q.result = e.code;
    }
    await save();
    if (!failure) return body;
    if (
      !req.write &&
      bucket !== "H" &&
      purpose !== "retry" &&
      transient(failure.code)
    ) {
      const delay = Math.max(5000, failure.wait);
      if (delay > 60000) fail("RETRY_WAIT_TOO_LONG");
      await wait(delay);
      return request(step, "R", page, cursor, reconcile, "retry");
    }
    throw failure;
  }
  const object = (x: Obj | null) => {
    if (!x) fail("C_RESOURCE_MISMATCH");
    return x!;
  };
  const verifyCampaign = (x: Obj | null) =>
    b.assertCampaign(
      context(source),
      v.manifest,
      object(x),
      config.workspace,
      true,
      true,
    );
  function verifyHook(x: Obj | null, known = true) {
    const r = object(x);
    if (!id.safeParse(r.id).success) fail("C_INVALID_PROVIDER_SCHEMA");
    if (
      r.organization !== config.workspace ||
      r.campaign !== context(source).campaignId ||
      r.target_hook_url !== v.receiver.url ||
      r.name !== "S00-INS-C-" + v.receiver.nonce ||
      r.event_type !== "reply_received" ||
      !r.headers ||
      typeof r.headers !== "object" ||
      (r.headers as Obj)["X-S00-Webhook-Token"] !== secrets.token ||
      (known && r.id !== s.hookId)
    )
      fail("C_RESOURCE_MISMATCH");
    return r.id as string;
  }
  const next = async () => {
    s.stage++;
    await save();
  };
  let receipt: CObservation = {
    authenticated: false,
    contextValidated: false,
    conflict: false,
    payloadDigest: null,
    receivedAt: null,
  };
  const observe = async () => {
    try {
      receipt = await receiver.observe();
    } catch {
      fail(
        options.receiverFailureAsOperational
          ? "C_RECEIVER_FAILED"
          : "C_STORAGE_OR_INTERNAL_FAILURE",
      );
    }
    s.receiptObserved = receipt.authenticated;
    s.contextValidated = receipt.contextValidated;
    s.receiptConflict ||= receipt.conflict;
  };
  const matchesLog = (x: Obj) => {
    const t =
      typeof x.timestamp_created === "string"
        ? Date.parse(x.timestamp_created)
        : NaN;
    let payloadDigest: string | null = null;
    if (
      x.payload &&
      typeof x.payload === "object" &&
      !Array.isArray(x.payload)
    ) {
      try {
        payloadDigest = cPayloadDigest(x.payload, secrets.key);
      } catch {
        fail("C_INVALID_PROVIDER_SCHEMA");
      }
    }
    return (
      x.organization_id === config.workspace &&
      x.webhook_url === v.receiver.url &&
      t >= v.receiver.startsAt &&
      t <= v.receiver.endsAt &&
      x.success === true &&
      typeof x.status_code === "number" &&
      x.status_code >= 200 &&
      x.status_code < 300 &&
      !!x.payload &&
      typeof x.payload === "object" &&
      receipt.authenticated &&
      payloadDigest !== null &&
      payloadDigest === receipt.payloadDigest
    );
  };
  const logCandidates = (x: Obj | null) => a.list(object(x));
  try {
    a.tenant(object(await request("workspace")), "id", config.workspace);
    await next();
    if (
      !a.planSummary(object(await request("plan")), config.workspace)
        .outreachPresent
    )
      fail("B_CAPACITY_REQUIRED");
    await next();
    verifyCampaign(await request("current"));
    s.campaignVerified = true;
    await next();
    let cursor = "",
      complete = false;
    const hookIds = new Set<string>(),
      cursors = new Set<string>();
    for (let page = 1; page <= 2; page++) {
      const p = a.list(object(await request("hooks", "N", page, cursor)));
      for (const r of p.rows) {
        if (
          !id.safeParse(r.id).success ||
          hookIds.has(r.id as string) ||
          r.organization !== config.workspace ||
          r.campaign !== context(source).campaignId ||
          r.event_type !== "reply_received"
        )
          fail("C_RESOURCE_MISMATCH");
        hookIds.add(r.id as string);
        if (
          r.target_hook_url === v.receiver.url ||
          r.name === "S00-INS-C-" + v.receiver.nonce
        )
          fail("C_NONCE_EXISTS");
      }
      if (!p.next) {
        complete = true;
        break;
      }
      if (cursors.has(p.next) || !p.rows.length) fail("CURSOR_REPEATED");
      cursors.add(p.next);
      cursor = p.next;
    }
    if (!complete) fail("PAGINATION_LIMIT");
    await next();
    try {
      s.hookId = verifyHook(await request("create"), false);
    } catch (e) {
      if (!uncertain(e)) throw e;
      const p = a.list(
        object(await request("create", "R", 1, "", true, "reconcile")),
      );
      const found = p.rows.filter(
        (r) =>
          r.target_hook_url === v.receiver.url ||
          r.name === "S00-INS-C-" + v.receiver.nonce,
      );
      if (p.next || found.length !== 1) fail("C_UNRESOLVED_CREATE");
      s.hookId = verifyHook(found[0], false);
    }
    // An exact create response/reconciliation establishes ownership for emergency cleanup.
    s.hookVerified = true;
    await next();
    verifyHook(await request("hook"));
    await next();
    try {
      await receiver.arm();
    } catch (e) {
      if (e instanceof S00RunError && e.code === "C_WINDOW_CLOSED") throw e;
      fail(
        options.receiverFailureAsOperational
          ? "C_RECEIVER_FAILED"
          : "C_STORAGE_OR_INTERNAL_FAILURE",
      );
    }
    s.receiverArmed = true;
    await save();
    try {
      const r = object(await request("test"));
      if (
        r.success !== true ||
        typeof r.status_code !== "number" ||
        r.status_code < 200 ||
        r.status_code >= 300
      )
        fail("C_RECEIVER_FAILED");
      s.testConfirmed = true;
    } catch (e) {
      if (!uncertain(e)) throw e;
      await request("test", "R", 1, "", true, "reconcile");
    }
    for (;;) {
      await observe();
      if (receipt.authenticated || clock.now() >= v.receiver.endsAt) break;
      await wait(Math.min(1000, v.receiver.endsAt - clock.now()));
    }
    await next();
    cursor = "";
    const logCursors = new Set<string>(),
      logIds = new Set<string>(),
      candidates = new Map<string, Obj>();
    for (let page = 1; page <= 2; page++) {
      const p = logCandidates(await request("logs", "N", page, cursor));
      for (const r of p.rows) {
        if (!id.safeParse(r.id).success || logIds.has(r.id as string))
          fail("DUPLICATE_RECORD");
        logIds.add(r.id as string);
        if (
          r.organization_id !== config.workspace ||
          r.webhook_url !== v.receiver.url
        )
          fail("C_RESOURCE_MISMATCH");
        if (matchesLog(r)) candidates.set(r.id as string, r);
      }
      if (candidates.size > 1) fail("C_RESOURCE_MISMATCH");
      if (!p.next && candidates.size) break;
      if (page === 2) {
        if (p.next) fail("PAGINATION_LIMIT");
        break;
      }
      if (p.next) {
        if (logCursors.has(p.next) || !p.rows.length) fail("CURSOR_REPEATED");
        logCursors.add(p.next);
        cursor = p.next;
      } else {
        await wait(5000);
        cursor = "";
        logIds.clear();
      }
    }
    s.logId = candidates.keys().next().value ?? null;
    await next();
    if (s.logId) {
      const detail = object(await request("detail"));
      if (detail.id !== s.logId || !matchesLog(detail))
        fail("C_RESOURCE_MISMATCH");
      s.logVerified = true;
      s.testConfirmed = true;
    }
    await next();
    try {
      verifyHook(await request("remove"));
    } catch (e) {
      if (!uncertain(e)) throw e;
    }
    await next();
    if ((await request("absent")) !== null) fail("C_CLEANUP_REQUIRED");
    s.cleaned = true;
    s.cleanup = "verified";
    await next();
    verifyCampaign(await request("final"));
    s.stage++;
    s.finalVerified = true;
    await observe();
    try {
      await receiver.close();
    } catch {
      fail(
        options.receiverFailureAsOperational
          ? "C_RECEIVER_FAILED"
          : "C_STORAGE_OR_INTERNAL_FAILURE",
      );
    }
    s.status =
      s.receiptObserved &&
      !s.receiptConflict &&
      s.contextValidated &&
      s.testConfirmed &&
      s.logVerified
        ? "completed"
        : "partial";
    await save();
  } catch (e) {
    if (
      (!(e instanceof S00RunError) && !(e instanceof a.ReadError)) ||
      !errors.includes((e as S00RunError).code as (typeof errors)[number])
    )
      throw new S00RunError("C_STORAGE_OR_INTERNAL_FAILURE");
    const error = (e as S00RunError).code as (typeof errors)[number];
    if (
      s.hookVerified &&
      s.hookId &&
      !s.cleaned &&
      ![
        "C_RESOURCE_MISMATCH",
        "WORKSPACE_MISMATCH",
        "HTTP_401",
        "HTTP_402",
        "HTTP_403",
      ].includes(error)
    ) {
      try {
        if (!s.requests.some((q) => q.step === "remove"))
          try {
            verifyHook(await request("remove", "H", 1, "", false, "emergency"));
          } catch (err) {
            if (!(err instanceof a.ReadError)) throw err;
          }
        if (
          (await request("absent", "H", 1, "", false, "emergency")) === null
        ) {
          s.cleaned = true;
          s.cleanup = "verified";
        } else s.cleanup = "unknown";
      } catch (err) {
        if (
          (!(err instanceof S00RunError) && !(err instanceof a.ReadError)) ||
          (err instanceof S00RunError &&
            err.code === "C_STORAGE_OR_INTERNAL_FAILURE")
        )
          throw err;
        s.cleanup = "unknown";
      }
    } else if (s.cleanup === "pending") s.cleanup = "unknown";
    if (s.receiverArmed)
      try {
        await receiver.close();
      } catch {
        if (!options.receiverFailureAsOperational)
          throw new S00RunError("C_STORAGE_OR_INTERNAL_FAILURE");
      }
    s.status = "failed";
    s.error = error;
    await save();
  }
  return cReport(s);
}
