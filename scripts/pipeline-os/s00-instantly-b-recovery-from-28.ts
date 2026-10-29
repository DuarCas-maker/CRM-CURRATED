// Explicit recovery of the same paused campaign. Import/status never loads env or HTTP.
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { hash, S00RunError } from "./s00-composio-common";
import {
  instantlyA as a,
  instantlyTrialJson,
  type InstantlyClock,
} from "./s00-instantly-runner";
import {
  bRequest,
  instantlyB as b,
  type BTrialContext,
  type BManifest,
} from "./s00-instantly-b";
import {
  validateCFDState,
  validateCFDInputs,
  type CFDState,
} from "./s00-instantly-config-diagnostic";

const fail = (code: string): never => {
  throw new S00RunError(code);
};
const digest = z.string().regex(/^[a-f0-9]{64}$/),
  id = z.string().uuid();
export const br28Steps = [
  "workspace",
  "plan",
  "current",
  "empty",
  "createA",
  "getA",
  "createB",
  "getB",
  "audience",
  "updateA",
  "recheckA",
  "recheckB",
  "final",
] as const;
type Step = (typeof br28Steps)[number];
type RequestStep = Step | "emergency_pause" | "emergency_check";
const writeSteps = new Set<string>(["createA", "createB", "updateA"]);
const transient = (code: string) =>
  ["NETWORK_OR_TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(code);
const errors = [
  ...b.errors,
  "BR28_AUDIENCE_NOT_EMPTY",
  "BR28_LEAD_SKIPPED",
  "BR28_RESERVE_REQUIRED",
] as const;
export function validateBR28Source(value: unknown): CFDState {
  const s = validateCFDState(value),
    p = s.projection;
  const mismatches = new Set([
    "sequences",
    "sequences[0]",
    "sequences[0].steps",
    "sequences[0].steps[0]",
  ]);
  const units = new Set([
    "sequences[0].steps[0].delay_unit",
    "sequences[0].steps[0].pre_delay_unit",
  ]);
  if (
    s.status !== "completed" ||
    s.calls !== 28 ||
    s.error !== null ||
    s.requests.length !== 1 ||
    s.requests[0].purpose !== "read" ||
    s.requests[0].result !== "OK" ||
    !p?.identityMatches ||
    !p.currentPaused ||
    p.configuredGuardPassesNow ||
    p.optionalFields.ai_sdr_id !== "omitted" ||
    p.optionalFields.is_evergreen !== "explicit" ||
    p.optionalFields.stop_for_company !== "explicit" ||
    p.fields.some((r) =>
      r.path === "ai_sdr_id"
        ? r.reason !== "missing"
        : mismatches.has(r.path)
          ? r.reason !== "mismatch"
          : units.has(r.path)
            ? r.reason !== "unexpected" || r.observedType !== "string"
            : r.reason !== "match",
    ) ||
    p.fields.find((r) => r.path === "sequences[0].steps[0]")?.size !== 5 ||
    p.fields.find((r) => r.path === "sequences[0].steps[0]")?.extraKeyCount !==
      2 ||
    [...mismatches]
      .filter((path) => path !== "sequences[0].steps[0]")
      .some((path) => {
        const row = p.fields.find((r) => r.path === path)!;
        return (
          row.size !== 1 ||
          (row.extraKeyCount !== null && row.extraKeyCount !== 0)
        );
      })
  )
    fail("BR28_SOURCE_REQUIRED");
  return value as CFDState;
}
export type BR28Inputs = {
  source: CFDState;
  scope: unknown;
  manifest: unknown;
};
export function validateBR28Inputs(input: BR28Inputs) {
  const source = validateBR28Source(input.source),
    v = validateCFDInputs({
      source: source.prior,
      scope: input.scope,
      manifest: input.manifest,
    });
  if (
    source.scopeHash !== v.scopeHash ||
    source.manifestHash !== v.manifestHash
  )
    fail("BR28_BINDING_CHANGED");
  return {
    source,
    manifest: v.manifest,
    sourceHash: hash(JSON.stringify(source)),
    scopeHash: v.scopeHash,
    manifestHash: v.manifestHash,
  };
}
const schema = z
  .object({
    version: z.literal(7),
    provider: z.literal("instantly"),
    phase: z.literal("B_RECOVERY_FROM_28"),
    prior: z.custom<CFDState>(),
    sourceHash: digest,
    scopeHash: digest,
    manifestHash: digest,
    calls: z.number().int().min(28).max(48),
    normal: z.number().int().min(0).max(15),
    reserve: z.number().int().min(0).max(3),
    hold: z.number().int().min(0).max(2),
    status: z.enum(["running", "completed", "failed"]),
    stage: z.number().int().min(0).max(13),
    campaignVerified: z.boolean(),
    mutationAttempted: z.boolean(),
    leads: z.object({ A: id.nullable(), B: id.nullable() }).strict(),
    snapshots: z
      .object({ A: digest.nullable(), B: digest.nullable() })
      .strict(),
    emergency: z.enum([
      "not_needed",
      "attempting",
      "verified_paused",
      "unverified",
      "skipped",
    ]),
    error: z.enum(errors).nullable(),
    requests: z
      .array(
        z
          .object({
            step: z.enum([...br28Steps, "emergency_pause", "emergency_check"]),
            page: z.number().int().min(1).max(3),
            bucket: z.enum(["N", "R", "H"]),
            purpose: z.enum(["normal", "retry", "reconcile", "emergency"]),
            result: z.enum(a.codes),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type BR28State = z.infer<typeof schema>;
export interface BR28Store {
  load(): Promise<CFDState | BR28State | undefined>;
  save(s: BR28State): Promise<void>;
}
export function validateBR28State(value: unknown): BR28State {
  const p = schema.safeParse(value);
  if (!p.success) return fail("BR28_INVALID_JOURNAL");
  const s = p.data;
  validateBR28Source(s.prior);
  if (
    s.sourceHash !== hash(JSON.stringify(s.prior)) ||
    s.scopeHash !== s.prior.scopeHash ||
    s.manifestHash !== s.prior.manifestHash ||
    s.calls !== 28 + s.requests.length ||
    s.normal !== s.requests.filter((q) => q.bucket === "N").length ||
    s.reserve !== s.requests.filter((q) => q.bucket === "R").length ||
    s.hold !== s.requests.filter((q) => q.bucket === "H").length ||
    (s.status === "failed") !== (s.error !== null) ||
    s.campaignVerified !== s.stage >= 3 ||
    s.mutationAttempted !==
      s.requests.some((q) => q.bucket === "N" && writeSteps.has(q.step))
  )
    fail("BR28_INVALID_JOURNAL");
  let index = 0,
    audiencePage = 0,
    emergency = 0;
  for (const [i, q] of s.requests.entries()) {
    const prev = s.requests[i - 1];
    if (
      q.result === "IN_FLIGHT" &&
      (i !== s.requests.length - 1 || s.status !== "running")
    )
      fail("BR28_INVALID_JOURNAL");
    if (q.bucket === "N") {
      if (emergency || q.purpose !== "normal" || (prev && prev.result !== "OK"))
        fail("BR28_INVALID_JOURNAL");
      if (index === 8 && audiencePage && q.step !== "audience") index++;
      if (
        q.step !== br28Steps[index] ||
        q.page !== (q.step === "audience" ? audiencePage + 1 : 1)
      )
        fail("BR28_INVALID_JOURNAL");
      if (q.step === "audience") audiencePage++;
      else index++;
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
            !writeSteps.has(q.step))
      )
        fail("BR28_INVALID_JOURNAL");
    } else {
      if (
        !s.mutationAttempted ||
        !s.campaignVerified ||
        q.purpose !== "emergency" ||
        q.page !== 1 ||
        q.step !== (emergency === 0 ? "emergency_pause" : "emergency_check") ||
        emergency >= 2
      )
        fail("BR28_INVALID_JOURNAL");
      emergency++;
    }
  }
  if (
    s.stage > (index === 8 && audiencePage ? 9 : index) ||
    (s.stage >= 9 && audiencePage < 2) ||
    (s.leads.A !== null) !== s.stage >= 5 ||
    (s.snapshots.A !== null) !== s.stage >= 6 ||
    (s.leads.B !== null) !== s.stage >= 7 ||
    (s.snapshots.B !== null) !== s.stage >= 8 ||
    (s.leads.A && s.leads.A === s.leads.B)
  )
    fail("BR28_INVALID_JOURNAL");
  if (
    s.status === "completed" &&
    (s.stage !== 13 ||
      s.requests.at(-1)?.step !== "final" ||
      s.requests.at(-1)?.result !== "OK" ||
      s.emergency !== "not_needed")
  )
    fail("BR28_INVALID_JOURNAL");
  if (
    (["skipped", "verified_paused", "unverified"].includes(s.emergency) &&
      s.status !== "failed") ||
    ((s.emergency === "not_needed" || s.emergency === "skipped") && s.hold) ||
    (s.emergency === "verified_paused" &&
      (s.hold !== 2 ||
        s.requests.at(-1)?.step !== "emergency_check" ||
        s.requests.at(-1)?.result !== "OK"))
  )
    fail("BR28_INVALID_JOURNAL");
  return s;
}
export function assertBR28Transition(
  previous: CFDState | BR28State | undefined,
  next: BR28State,
) {
  validateBR28State(next);
  if (!previous) return fail("BR28_SOURCE_REQUIRED");
  if (previous.version === 6) {
    validateBR28Source(previous);
    if (
      next.sourceHash !== hash(JSON.stringify(previous)) ||
      next.calls !== 28 ||
      next.stage !== 0 ||
      next.status !== "running" ||
      next.requests.length ||
      next.emergency !== "not_needed"
    )
      fail("BR28_HISTORY_IMMUTABLE");
    return;
  }
  const p = validateBR28State(previous);
  if (isDeepStrictEqual(p, next)) return;
  if (
    p.status !== "running" ||
    p.sourceHash !== next.sourceHash ||
    p.manifestHash !== next.manifestHash ||
    p.scopeHash !== next.scopeHash ||
    JSON.stringify(p.prior) !== JSON.stringify(next.prior) ||
    next.calls < p.calls ||
    next.calls > p.calls + 1 ||
    next.stage < p.stage ||
    next.stage > p.stage + 1 ||
    (p.campaignVerified && !next.campaignVerified) ||
    (p.mutationAttempted && !next.mutationAttempted)
  )
    fail("BR28_HISTORY_IMMUTABLE");
  for (const k of ["A", "B"] as const)
    if (
      (p.leads[k] && p.leads[k] !== next.leads[k]) ||
      (p.snapshots[k] && p.snapshots[k] !== next.snapshots[k])
    )
      fail("BR28_HISTORY_IMMUTABLE");
  for (const [i, q] of p.requests.entries()) {
    const n = next.requests[i];
    if (
      !n ||
      q.step !== n.step ||
      q.page !== n.page ||
      q.bucket !== n.bucket ||
      q.purpose !== n.purpose ||
      (q.result !== "IN_FLIGHT" && q.result !== n.result)
    )
      fail("BR28_HISTORY_IMMUTABLE");
  }
  if (
    next.stage !== p.stage &&
    (next.calls !== p.calls ||
      next.requests.at(-1)?.result !== "OK" ||
      next.requests.at(-1)?.step !== br28Steps[p.stage])
  )
    fail("BR28_HISTORY_IMMUTABLE");
  if (
    next.calls !== p.calls &&
    (next.stage !== p.stage ||
      p.requests.at(-1)?.result === "IN_FLIGHT" ||
      next.requests.at(-1)?.result !== "IN_FLIGHT" ||
      (next.requests.at(-1)?.bucket === "N" &&
        next.requests.at(-1)?.step !== br28Steps[p.stage]))
  )
    fail("BR28_HISTORY_IMMUTABLE");
}
const context = (s: BR28State): BTrialContext => ({
  prior: s.prior.prior.prior.prior.prior,
  campaignId: s.prior.prior.prior.prior.campaignId,
  leads: s.leads,
});
export function br28Request(
  s: BR28State,
  m: BManifest,
  step: RequestStep,
  opts: { cursor?: string; reconcile?: boolean } = {},
) {
  validateBR28State(s);
  if (![...br28Steps, "emergency_pause", "emergency_check"].includes(step))
    return fail("BR28_BLOCKED_ROUTE");
  if (
    (opts.cursor && step !== "audience") ||
    (opts.reconcile && !writeSteps.has(step))
  )
    fail("BR28_BLOCKED_ROUTE");
  return bRequest(
    context(s),
    m,
    step === "empty" ? "audience" : step === "current" ? "configured" : step,
    opts,
  );
}
export function br28Report(s?: BR28State, source?: CFDState) {
  if (s) validateBR28State(s);
  if (source) validateBR28Source(source);
  return {
    provider: "instantly",
    phase: "B_RECOVERY_FROM_28",
    status: s?.status ?? "not_started",
    sourceAvailable: !!s || !!source,
    priorCalls: s || source ? 28 : 0,
    newCalls: s?.requests.length ?? 0,
    calls: s?.calls ?? source?.calls ?? 0,
    budget: {
      normal: s?.normal ?? 0,
      reserve: s?.reserve ?? 0,
      hold: s?.hold ?? 0,
      maxNew: 20,
      maxAccumulated: 48,
    },
    stage: s?.stage ?? 0,
    error: s?.error ?? null,
    emergency: s?.emergency ?? "not_needed",
    interruptedNeedsReview: s?.status === "running",
    bOriginalStatus: s || source ? "failed" : "unknown",
    diagnosticStatus: s || source ? "completed" : "unknown",
    sameCampaignOnly: true,
    campaignCreated: false,
    campaignReconfigured: false,
    priorRecoveryStatus: s || source ? "failed" : "unknown",
    leadsRecorded: s ? Number(!!s.leads.A) + Number(!!s.leads.B) : 0,
    closedNonSending: s?.status === "completed",
    individualSchedulerPauseVerified: false,
    sendingSafetyCertified: false,
    sends: 0,
    paidOperations: 0,
    providerBillingMeasured: false,
  };
}
export async function runInstantlyBRecoveryFrom28(
  env: Readonly<Record<string, string | undefined>>,
  store: BR28Store,
  inputs: BR28Inputs | undefined,
  options: {
    execute?: boolean;
    authorizedNew?: number;
    authorizedTotal?: number;
    includedCallsConfirmed?: boolean;
    manifestReviewed?: boolean;
    fetchImpl?: typeof fetch;
    clock?: InstantlyClock;
    signal?: AbortSignal;
  } = {},
) {
  if (!options.execute) {
    const old = await store.load();
    return old?.version === 7 ? br28Report(old) : br28Report(undefined, old);
  }
  if (
    options.authorizedNew !== 20 ||
    options.authorizedTotal !== 48 ||
    !options.includedCallsConfirmed ||
    !options.manifestReviewed
  )
    fail("BR28_AUTHORIZATION_REQUIRED");
  if (!inputs) return fail("BR28_INPUTS_REQUIRED");
  const v = validateBR28Inputs(inputs),
    old = await store.load();
  if (!old) return fail("BR28_SOURCE_REQUIRED");
  if (old.version === 7) {
    const s = validateBR28State(old);
    if (
      s.sourceHash !== v.sourceHash ||
      s.manifestHash !== v.manifestHash ||
      s.scopeHash !== v.scopeHash
    )
      fail("BR28_BINDING_CHANGED");
    return br28Report(s);
  }
  validateBR28Source(old);
  if (hash(JSON.stringify(old)) !== v.sourceHash) fail("BR28_SOURCE_CHANGED");
  const config = a.configuration(env);
  if (
    config.fingerprint !==
    v.source.prior.prior.prior.prior.predecessor.fingerprint
  )
    fail("INSTANTLY_BINDING_CHANGED");
  const s: BR28State = {
    version: 7,
    provider: "instantly",
    phase: "B_RECOVERY_FROM_28",
    prior: v.source,
    sourceHash: v.sourceHash,
    scopeHash: v.scopeHash,
    manifestHash: v.manifestHash,
    calls: 28,
    normal: 0,
    reserve: 0,
    hold: 0,
    status: "running",
    stage: 0,
    campaignVerified: false,
    mutationAttempted: false,
    leads: { A: null, B: null },
    snapshots: { A: null, B: null },
    emergency: "not_needed",
    error: null,
    requests: [],
  };
  const save = async () => {
    validateBR28State(s);
    try {
      await store.save(structuredClone(s));
    } catch {
      throw new S00RunError("BR28_STORAGE_OR_INTERNAL_FAILURE");
    }
  };
  await save();
  const clock = options.clock ?? a.realClock;
  let last: number | undefined;
  const wait = async (ms: number, emergency = false) => {
    if (options.signal?.aborted && !emergency) fail("CANCELLED");
    try {
      if (ms > 0) await clock.sleep(ms, emergency ? undefined : options.signal);
    } catch {
      fail("CANCELLED");
    }
  };
  const remaining = [15, 14, 13, 12, 11, 10, 9, 8, 7, 4, 3, 2, 1, 0];
  type Obj = Record<string, unknown>;
  async function request(
    step: RequestStep,
    bucket: "N" | "R" | "H",
    page = 1,
    cursor = "",
    reconcile = false,
    purpose: BR28State["requests"][number]["purpose"] = "normal",
  ): Promise<Obj> {
    const req = br28Request(s, v.manifest, step, { cursor, reconcile });
    await wait(
      last === undefined ? 0 : Math.max(0, 1000 - (clock.now() - last)),
      bucket === "H",
    );
    if (
      s.calls >= 48 ||
      (bucket === "N"
        ? s.normal >= 15
        : bucket === "R"
          ? s.reserve >= 3
          : s.hold >= 2)
    )
      fail("BUDGET_EXHAUSTED");
    if (
      bucket === "H" &&
      (!s.campaignVerified ||
        !s.mutationAttempted ||
        !step.startsWith("emergency_"))
    )
      fail("BR28_BLOCKED_ROUTE");
    if (
      req.write &&
      bucket !== "H" &&
      (s.reserve >= 3 ||
        s.hold ||
        15 - s.normal < remaining[s.stage] ||
        48 - s.calls < remaining[s.stage] + 3)
    )
      fail("BR28_RESERVE_REQUIRED");
    const q: BR28State["requests"][number] = {
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
    if (req.write && bucket === "N") s.mutationAttempted = true;
    await save();
    last = clock.now();
    let body: Obj | undefined,
      err: InstanceType<typeof a.ReadError> | undefined;
    try {
      body = await instantlyTrialJson(
        options.fetchImpl ?? fetch,
        config.key,
        req.url,
        req.method,
        req.body,
        bucket === "H" ? undefined : options.signal,
      );
      q.result = "OK";
    } catch (e) {
      if (!(e instanceof a.ReadError)) throw e;
      err = e;
      q.result = e.code;
    }
    await save();
    if (!err) return body!;
    if (
      !req.write &&
      bucket !== "H" &&
      purpose !== "retry" &&
      transient(err.code)
    ) {
      const delay = Math.max(5000, err.wait);
      if (delay > 60000) fail("RETRY_WAIT_TOO_LONG");
      await wait(delay);
      return request(step, "R", page, cursor, reconcile, "retry");
    }
    throw err;
  }
  const read = (step: Step, page = 1, cursor = "", reconcile = false) =>
    request(
      step,
      reconcile ? "R" : "N",
      page,
      cursor,
      reconcile,
      reconcile ? "reconcile" : "normal",
    );
  const verify = (x: Obj, configured: boolean) =>
    b.assertCampaign(
      context(s),
      v.manifest,
      x,
      config.workspace,
      configured,
      true,
    );
  const snapshot = (x: Obj, alias: "A" | "B", hold = false) =>
    b.leadSnapshot(context(s), v.manifest, x, config.workspace, alias, hold);
  const next = async () => {
    s.stage++;
    if (s.stage === 13) s.status = "completed";
    await save();
  };
  async function mutate(
    step: "createA" | "createB" | "updateA",
    accept: (x: Obj) => void,
    conciliate: (x: Obj) => void,
  ) {
    try {
      accept(await request(step, "N"));
    } catch (e) {
      const uncertain =
        (e instanceof a.ReadError &&
          [
            "NETWORK_OR_TIMEOUT",
            "HTTP_5XX",
            "HTTP_429",
            "INVALID_RESPONSE",
            "RESPONSE_LIMIT",
          ].includes(e.code)) ||
        (e instanceof S00RunError && e.code === "B_INVALID_PROVIDER_SCHEMA");
      if (!uncertain) throw e;
      try {
        conciliate(await read(step, 1, "", true));
      } catch (error) {
        if (
          error instanceof S00RunError &&
          error.code === "BR28_STORAGE_OR_INTERNAL_FAILURE"
        )
          throw error;
        if (error instanceof S00RunError || error instanceof a.ReadError)
          fail("B_UNRESOLVED_WRITE");
        throw error;
      }
    }
  }
  try {
    if ((await read("workspace")).id !== config.workspace)
      fail("WORKSPACE_MISMATCH");
    await next();
    const plan = a.planSummary(await read("plan"), config.workspace);
    if (
      !plan.outreachPresent ||
      plan.availableContactSlots === null ||
      plan.availableContactSlots < 2
    )
      fail("B_CAPACITY_REQUIRED");
    await next();
    verify(await read("current"), true);
    s.campaignVerified = true;
    await next();
    const empty = a.list(await read("empty"));
    if (empty.rows.length || empty.next) fail("BR28_AUDIENCE_NOT_EMPTY");
    await next();
    for (const alias of ["A", "B"] as const) {
      const set = (x: Obj) => {
        if (x.skipped === true) fail("BR28_LEAD_SKIPPED");
        const candidate = b.createdId(x.id);
        if (candidate === s.leads[alias === "A" ? "B" : "A"])
          fail("B_RESOURCE_MISMATCH");
        s.leads[alias] = candidate;
      };
      await mutate(alias === "A" ? "createA" : "createB", set, (x) => {
        const p = a.list(x);
        if (p.next || p.rows.length !== 1) fail("B_UNRESOLVED_WRITE");
        const previous = s.leads[alias];
        set(p.rows[0]);
        try {
          snapshot(p.rows[0], alias);
        } catch (error) {
          s.leads[alias] = previous;
          throw error;
        }
      });
      await next();
      s.snapshots[alias] = snapshot(
        await read(alias === "A" ? "getA" : "getB"),
        alias,
      );
      await next();
    }
    let cursor = "",
      complete = false;
    const seen = new Set<string>();
    for (let page = 1; page <= 3; page++) {
      const p = a.list(await read("audience", page, cursor));
      if (p.rows.length > 1) fail("B_AUDIENCE_MISMATCH");
      for (const x of p.rows) {
        const candidate = b.createdId(x.id);
        if (seen.has(candidate)) fail("DUPLICATE_RECORD");
        const alias =
          candidate === s.leads.A
            ? "A"
            : candidate === s.leads.B
              ? "B"
              : undefined;
        if (!alias) fail("B_AUDIENCE_MISMATCH");
        snapshot(x, alias!);
        seen.add(candidate);
      }
      if (!p.next) {
        complete = true;
        break;
      }
      if (p.rows.length !== 1) fail("B_AUDIENCE_MISMATCH");
      const lastId = p.rows[0].id as string;
      if (p.next !== lastId) fail("B_AUDIENCE_MISMATCH");
      if (lastId === cursor) fail("CURSOR_REPEATED");
      cursor = lastId;
    }
    if (!complete || seen.size !== 2) fail("B_AUDIENCE_MISMATCH");
    await next();
    const changed = (x: Obj) => {
      if (snapshot(x, "A", true) !== s.snapshots.A) fail("B_ISOLATION_FAILED");
    };
    await mutate("updateA", () => {}, changed);
    await next();
    changed(await read("recheckA"));
    await next();
    if (snapshot(await read("recheckB"), "B") !== s.snapshots.B)
      fail("B_ISOLATION_FAILED");
    await next();
    verify(await read("final"), true);
    await next();
  } catch (e) {
    if (
      (!(e instanceof S00RunError) && !(e instanceof a.ReadError)) ||
      !errors.includes(e.code as (typeof errors)[number])
    )
      throw new S00RunError("BR28_STORAGE_OR_INTERNAL_FAILURE");
    const error = e.code as (typeof errors)[number];
    if (
      s.mutationAttempted &&
      s.campaignVerified &&
      ![
        "B_RESOURCE_MISMATCH",
        "WORKSPACE_MISMATCH",
        "HTTP_401",
        "HTTP_402",
        "HTTP_403",
      ].includes(error)
    ) {
      s.emergency = "attempting";
      try {
        try {
          await request("emergency_pause", "H", 1, "", false, "emergency");
        } catch (err) {
          if (!(err instanceof a.ReadError)) throw err;
        }
        const x = await request(
          "emergency_check",
          "H",
          1,
          "",
          false,
          "emergency",
        );
        b.campaignIdentity(context(s), x);
        if (x.organization !== config.workspace || x.status !== 2)
          fail("B_UNSAFE_CAMPAIGN");
        s.emergency = "verified_paused";
      } catch (err) {
        if (
          err instanceof S00RunError &&
          err.code === "BR28_STORAGE_OR_INTERNAL_FAILURE"
        )
          throw err;
        if (!(err instanceof S00RunError) && !(err instanceof a.ReadError))
          throw new S00RunError("BR28_STORAGE_OR_INTERNAL_FAILURE");
        s.emergency = "unverified";
      }
    } else s.emergency = "skipped";
    s.status = "failed";
    s.error = error;
  }
  await save();
  return br28Report(s);
}
