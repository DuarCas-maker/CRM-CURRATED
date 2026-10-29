// Own GET only; no environment, filesystem or HTTP effects on import/default status.
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { hash, S00RunError } from "./s00-composio-common";
import {
  instantlyA as a,
  instantlyTrialJson,
  type InstantlyClock,
} from "./s00-instantly-runner";
import {
  bCampaignPayload,
  bTrialOptionalFields,
  instantlyB as b,
  type BManifest,
  type BTrialContext,
} from "./s00-instantly-b";
import {
  validateBRState,
  validateBRInputs,
  type BRState,
} from "./s00-instantly-b-recovery";

const fail = (code: string): never => {
  throw new S00RunError(code);
};
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const trace = [
  "workspace",
  "plan",
  "initial",
  "empty",
  "configure",
  "configured",
  "emergency_pause",
  "emergency_check",
];
export function validateCFDSource(value: unknown): BRState {
  const s = validateBRState(value);
  if (
    s.status !== "failed" ||
    s.calls !== 27 ||
    s.stage !== 5 ||
    s.error !== "B_UNSAFE_CAMPAIGN" ||
    s.normal !== 6 ||
    s.reserve !== 0 ||
    s.hold !== 2 ||
    s.emergency !== "verified_paused" ||
    !s.campaignVerified ||
    !s.mutationAttempted ||
    s.leads.A ||
    s.leads.B ||
    s.snapshots.A ||
    s.snapshots.B ||
    s.requests.length !== 8 ||
    s.requests.some(
      (q, i) =>
        q.step !== trace[i] ||
        q.result !== "OK" ||
        q.page !== 1 ||
        q.bucket !== (i < 6 ? "N" : "H") ||
        q.purpose !== (i < 6 ? "normal" : "emergency"),
    )
  )
    fail("CFD_SOURCE_REQUIRED");
  return value as BRState;
}
export type CFDInputs = { source: BRState; scope: unknown; manifest: unknown };
export function validateCFDInputs(input: CFDInputs) {
  const source = validateCFDSource(input.source),
    v = validateBRInputs({
      source: source.prior,
      scope: input.scope,
      manifest: input.manifest,
    });
  if (
    source.scopeHash !== v.scopeHash ||
    source.manifestHash !== v.manifestHash
  )
    fail("CFD_BINDING_CHANGED");
  return {
    source,
    manifest: v.manifest,
    sourceHash: hash(JSON.stringify(source)),
    scopeHash: v.scopeHash,
    manifestHash: v.manifestHash,
  };
}
const specs = [
  ["id", "string"],
  ["name", "string"],
  ["organization", "string"],
  ["status", "number"],
  ["email_list", "array"],
  ["email_tag_list", "array"],
  ["cc_list", "array"],
  ["bcc_list", "array"],
  ["provider_routing_rules", "array"],
  ["ai_sdr_id", "null"],
  ["is_evergreen", "boolean"],
  ["stop_on_reply", "boolean"],
  ["stop_for_company", "boolean"],
  ["campaign_schedule", "object"],
  ["sequences", "array"],
  ["campaign_schedule.start_date", "string"],
  ["campaign_schedule.end_date", "string"],
  ["campaign_schedule.schedules", "array"],
  ["campaign_schedule.schedules[0]", "object"],
  ["campaign_schedule.schedules[0].name", "string"],
  ["campaign_schedule.schedules[0].timing", "object"],
  ["campaign_schedule.schedules[0].timing.from", "string"],
  ["campaign_schedule.schedules[0].timing.to", "string"],
  ["campaign_schedule.schedules[0].days", "object"],
  ["campaign_schedule.schedules[0].days.0", "boolean"],
  ["campaign_schedule.schedules[0].days.1", "boolean"],
  ["campaign_schedule.schedules[0].days.2", "boolean"],
  ["campaign_schedule.schedules[0].days.3", "boolean"],
  ["campaign_schedule.schedules[0].days.4", "boolean"],
  ["campaign_schedule.schedules[0].days.5", "boolean"],
  ["campaign_schedule.schedules[0].days.6", "boolean"],
  ["campaign_schedule.schedules[0].timezone", "string"],
  ["sequences[0]", "object"],
  ["sequences[0].steps", "array"],
  ["sequences[0].steps[0]", "object"],
  ["sequences[0].steps[0].type", "string"],
  ["sequences[0].steps[0].delay", "number"],
  ["sequences[0].steps[0].delay_unit", "missing"],
  ["sequences[0].steps[0].pre_delay", "missing"],
  ["sequences[0].steps[0].pre_delay_unit", "missing"],
  ["sequences[0].steps[0].variants", "array"],
  ["sequences[0].steps[0].variants[0]", "object"],
  ["sequences[0].steps[0].variants[0].subject", "string"],
  ["sequences[0].steps[0].variants[0].body", "string"],
  ["sequences[0].steps[0].variants[0].v_disabled", "missing"],
] as const;
type Path = (typeof specs)[number][0];
const paths = specs.map((s) => s[0]) as [Path, ...Path[]];
const expectedSizes: Partial<Record<Path, number>> = {
  email_list: 0,
  email_tag_list: 0,
  cc_list: 0,
  bcc_list: 0,
  provider_routing_rules: 0,
  campaign_schedule: 3,
  sequences: 1,
  "campaign_schedule.schedules": 1,
  "campaign_schedule.schedules[0]": 4,
  "campaign_schedule.schedules[0].timing": 2,
  "campaign_schedule.schedules[0].days": 7,
  "sequences[0]": 1,
  "sequences[0].steps": 1,
  "sequences[0].steps[0]": 3,
  "sequences[0].steps[0].variants": 1,
  "sequences[0].steps[0].variants[0]": 2,
};
const kinds = [
  "missing",
  "null",
  "array",
  "object",
  "string",
  "number",
  "boolean",
  "other",
] as const;
type Kind = (typeof kinds)[number];
const basis = (p: Path) =>
  p === "ai_sdr_id"
    ? "creation_intent"
    : p === "status"
      ? "guard"
      : ["id", "name", "organization"].includes(p)
        ? "identity"
        : "configured_request";
const observation = z.enum([
  "omitted",
  "null",
  "explicit",
  "conflict",
  "invalid",
]);
const rowSchema = z
  .object({
    path: z.enum(paths),
    basis: z.enum([
      "creation_intent",
      "guard",
      "identity",
      "configured_request",
    ]),
    observedType: z.enum(kinds),
    expectedType: z.enum(kinds),
    size: z.number().int().min(0).max(2_100_000).nullable(),
    extraKeyCount: z.number().int().min(0).max(2_100_000).nullable(),
    reason: z.enum([
      "match",
      "missing",
      "null",
      "wrong_type",
      "non_empty",
      "unexpected",
      "mismatch",
    ]),
  })
  .strict();
const projectionSchema = z
  .object({
    identityMatches: z.literal(true),
    currentPaused: z.boolean(),
    configuredGuardPassesNow: z.boolean(),
    optionalFields: z
      .object({
        ai_sdr_id: observation,
        is_evergreen: observation,
        stop_for_company: observation,
      })
      .strict(),
    historicalFailureCauseProven: z.literal(false),
    sendingSafetyCertified: z.literal(false),
    fields: z.array(rowSchema).length(specs.length),
  })
  .strict();
export type CFDProjection = z.infer<typeof projectionSchema>;
type Obj = Record<string, unknown>;
const object = (x: unknown): x is Obj =>
  x !== null && typeof x === "object" && !Array.isArray(x);
function lookup(root: unknown, path: Path) {
  let value = root;
  for (const key of path.split(/[.\[\]]+/).filter(Boolean)) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, key)
    )
      return { exists: false, value: undefined };
    if (Array.isArray(value) && !/^\d+$/.test(key))
      return { exists: false, value: undefined };
    value = (value as Obj)[key];
  }
  return { exists: true, value };
}
const kind = (v: unknown, present = true): Kind =>
  !present
    ? "missing"
    : v === null
      ? "null"
      : Array.isArray(v)
        ? "array"
        : ["object", "string", "number", "boolean"].includes(typeof v)
          ? (typeof v as Kind)
          : "other";
const context = (s: BRState): BTrialContext => ({
  prior: s.prior.prior.prior,
  campaignId: s.prior.prior.campaignId,
  leads: s.leads,
});
function row(path: Path, body: Obj, expected: Obj): z.infer<typeof rowSchema> {
  const actual = lookup(body, path),
    wanted = lookup(expected, path),
    observedType = kind(actual.value, actual.exists),
    expectedType = kind(wanted.value, wanted.exists);
  const size = Array.isArray(actual.value)
    ? actual.value.length
    : object(actual.value)
      ? Object.keys(actual.value).length
      : null;
  const extraKeyCount =
    object(actual.value) && object(wanted.value)
      ? Object.keys(actual.value).filter(
          (k) => !Object.hasOwn(wanted.value as Obj, k),
        ).length
      : null;
  const reason = !actual.exists
    ? wanted.exists
      ? "missing"
      : "match"
    : !wanted.exists
      ? "unexpected"
      : isDeepStrictEqual(actual.value, wanted.value)
        ? "match"
        : actual.value === null
          ? "null"
          : observedType !== expectedType
            ? "wrong_type"
            : Array.isArray(actual.value) &&
                Array.isArray(wanted.value) &&
                wanted.value.length === 0 &&
                actual.value.length > 0
              ? "non_empty"
              : "mismatch";
  return {
    path,
    basis: basis(path),
    observedType,
    expectedType,
    size,
    extraKeyCount,
    reason,
  };
}
const guardPaths: Path[] = [
  "id",
  "name",
  "organization",
  "status",
  "email_list",
  "email_tag_list",
  "cc_list",
  "bcc_list",
  "provider_routing_rules",
  "stop_on_reply",
  "campaign_schedule",
  "sequences",
];
function validateProjection(input: unknown): CFDProjection {
  const p = projectionSchema.safeParse(input);
  if (!p.success) return fail("CFD_INVALID_JOURNAL");
  const v = p.data;
  for (const [i, r] of v.fields.entries()) {
    if (
      (r.reason === "match" &&
        ((r.size !== null && r.size !== expectedSizes[r.path]) ||
          (r.extraKeyCount !== null && r.extraKeyCount !== 0))) ||
      (r.reason === "mismatch" &&
        (r.observedType !== r.expectedType ||
          ["missing", "null"].includes(r.observedType))) ||
      (r.reason === "non_empty" && expectedSizes[r.path] !== 0)
    )
      fail("CFD_INVALID_JOURNAL");
    if (
      r.path !== specs[i][0] ||
      r.expectedType !== specs[i][1] ||
      r.basis !== basis(r.path) ||
      (r.observedType === "array" || r.observedType === "object") !==
        (r.size !== null) ||
      (r.observedType === "object" && r.expectedType === "object") !==
        (r.extraKeyCount !== null) ||
      (r.extraKeyCount !== null && r.extraKeyCount > r.size!)
    )
      fail("CFD_INVALID_JOURNAL");
    if (
      (r.reason === "missing" &&
        (r.observedType !== "missing" || r.expectedType === "missing")) ||
      (r.reason === "unexpected" &&
        (r.expectedType !== "missing" || r.observedType === "missing")) ||
      (r.reason === "null" &&
        (r.observedType !== "null" ||
          r.expectedType === "null" ||
          r.expectedType === "missing")) ||
      (r.reason === "wrong_type" &&
        (r.observedType === r.expectedType ||
          ["missing", "null"].includes(r.observedType) ||
          r.expectedType === "missing")) ||
      (r.reason === "match" && r.observedType !== r.expectedType) ||
      (r.reason === "non_empty" &&
        (r.observedType !== "array" || r.expectedType !== "array" || !r.size))
    )
      fail("CFD_INVALID_JOURNAL");
  }
  if (
    v.fields.slice(0, 3).some((r) => r.reason !== "match") ||
    v.currentPaused !== (v.fields[3].reason === "match")
  )
    fail("CFD_INVALID_JOURNAL");
  for (const key of [
    "ai_sdr_id",
    "is_evergreen",
    "stop_for_company",
  ] as const) {
    const r = v.fields.find((r) => r.path === key)!,
      state = v.optionalFields[key];
    const allowed =
      r.observedType === "missing"
        ? ["omitted"]
        : r.observedType === "null"
          ? ["null"]
          : key === "ai_sdr_id" && r.observedType === "string"
            ? ["conflict", "invalid"]
            : key !== "ai_sdr_id" && r.observedType === "boolean"
              ? [r.reason === "match" ? "explicit" : "conflict"]
              : ["invalid"];
    if (!allowed.includes(state)) fail("CFD_INVALID_JOURNAL");
  }
  const guardPass =
    guardPaths.every(
      (path) => v.fields.find((r) => r.path === path)!.reason === "match",
    ) &&
    Object.values(v.optionalFields).every(
      (s) => s !== "conflict" && s !== "invalid",
    );
  if (v.configuredGuardPassesNow !== guardPass) fail("CFD_INVALID_JOURNAL");
  return v;
}
export function configuredCampaignProjection(
  source: BRState,
  manifest: BManifest,
  workspace: string,
  body: unknown,
): CFDProjection {
  if (!object(body)) return fail("CFD_INVALID_CAMPAIGN_RESPONSE");
  try {
    const ctx = context(source),
      payload = bCampaignPayload(ctx, manifest, true);
    if (
      !["id", "name", "organization"].every((k) => Object.hasOwn(body, k)) ||
      body.id !== ctx.campaignId ||
      body.name !== payload.name ||
      body.organization !== workspace
    )
      fail("CFD_IDENTITY_MISMATCH");
    const expected: Obj = {
      ...payload,
      id: ctx.campaignId,
      organization: workspace,
      status: manifest.statusMapping.pausedStatus,
      ai_sdr_id: null,
    };
    // Missing indispensable containers are a known guard failure, not an internal error.
    let configuredGuardPassesNow =
      object(body.campaign_schedule) && Array.isArray(body.sequences);
    if (configuredGuardPassesNow) {
      try {
        // V6 records raw request equality; later trial compatibility must not rewrite history.
        b.assertCampaign(
          ctx,
          manifest,
          body,
          workspace,
          true,
          true,
          "request_exact",
        );
      } catch (e) {
        if (e instanceof S00RunError && e.code === "B_UNSAFE_CAMPAIGN")
          configuredGuardPassesNow = false;
        else throw e;
      }
    }
    const projection = {
      identityMatches: true as const,
      currentPaused: body.status === 2,
      configuredGuardPassesNow,
      optionalFields: bTrialOptionalFields(body),
      historicalFailureCauseProven: false as const,
      sendingSafetyCertified: false as const,
      fields: paths.map((p) => row(p, body, expected)),
    };
    return validateProjection(projection);
  } catch (e) {
    if (e instanceof S00RunError && e.code === "CFD_IDENTITY_MISMATCH") throw e;
    throw new S00RunError("CFD_INVALID_PROJECTION");
  }
}
const transient = (c: string) =>
  ["NETWORK_OR_TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(c);
const errors = [
  ...a.errors,
  "CFD_IDENTITY_MISMATCH",
  "CFD_INVALID_CAMPAIGN_RESPONSE",
  "CFD_INVALID_PROJECTION",
  "CFD_NOT_PAUSED",
] as const;
const schema = z
  .object({
    version: z.literal(6),
    provider: z.literal("instantly"),
    phase: z.literal("B_CONFIG_DIAGNOSTIC"),
    prior: z.custom<BRState>(),
    sourceHash: digest,
    scopeHash: digest,
    manifestHash: digest,
    calls: z.number().int().min(27).max(29),
    status: z.enum(["running", "completed", "failed"]),
    requests: z
      .array(
        z
          .object({
            purpose: z.enum(["read", "retry"]),
            result: z.enum(a.codes),
          })
          .strict(),
      )
      .max(2),
    error: z.enum(errors).nullable(),
    projection: projectionSchema.nullable(),
  })
  .strict();
export type CFDState = z.infer<typeof schema>;
export interface CFDStore {
  load(): Promise<BRState | CFDState | undefined>;
  save(s: CFDState): Promise<void>;
}
export function validateCFDState(input: unknown): CFDState {
  const p = schema.safeParse(input);
  if (!p.success) return fail("CFD_INVALID_JOURNAL");
  const s = p.data;
  validateCFDSource(s.prior);
  if (
    s.sourceHash !== hash(JSON.stringify(s.prior)) ||
    s.manifestHash !== s.prior.manifestHash ||
    s.scopeHash !== s.prior.scopeHash ||
    s.calls !== 27 + s.requests.length ||
    (s.status === "failed") !== (s.error !== null)
  )
    fail("CFD_INVALID_JOURNAL");
  for (const [i, q] of s.requests.entries())
    if (
      q.purpose !== (i ? "retry" : "read") ||
      (i === 1 && !transient(s.requests[0].result)) ||
      (q.result === "IN_FLIGHT" &&
        (i !== s.requests.length - 1 || s.status !== "running"))
    )
      fail("CFD_INVALID_JOURNAL");
  const last = s.requests.at(-1);
  if (
    (s.status === "running" && s.projection) ||
    (s.status === "completed" &&
      (!s.projection?.currentPaused || last?.result !== "OK")) ||
    (s.projection &&
      (last?.result !== "OK" ||
        (s.status === "failed" && s.error !== "CFD_NOT_PAUSED"))) ||
    (s.error === "CFD_NOT_PAUSED" &&
      (!s.projection || s.projection.currentPaused))
  )
    fail("CFD_INVALID_JOURNAL");
  if (
    s.status === "failed" &&
    ((!last && s.error !== "CANCELLED") ||
      ([
        "CFD_IDENTITY_MISMATCH",
        "CFD_INVALID_CAMPAIGN_RESPONSE",
        "CFD_INVALID_PROJECTION",
        "CFD_NOT_PAUSED",
      ].includes(s.error!) &&
        last?.result !== "OK") ||
      ((a.codes as readonly string[]).includes(s.error!) &&
        s.error !== "CANCELLED" &&
        last?.result !== s.error) ||
      (s.error === "RETRY_WAIT_TOO_LONG" && !transient(last?.result ?? "")))
  )
    fail("CFD_INVALID_JOURNAL");
  if (s.projection) validateProjection(s.projection);
  return s;
}
export function assertCFDTransition(
  previous: BRState | CFDState | undefined,
  next: CFDState,
) {
  validateCFDState(next);
  if (!previous) return fail("CFD_SOURCE_REQUIRED");
  if (previous.version === 5) {
    validateCFDSource(previous);
    if (
      next.sourceHash !== hash(JSON.stringify(previous)) ||
      next.calls !== 27 ||
      next.requests.length ||
      next.status !== "running" ||
      next.projection ||
      next.error
    )
      fail("CFD_HISTORY_IMMUTABLE");
    return;
  }
  const p = validateCFDState(previous);
  if (isDeepStrictEqual(p, next)) return;
  if (
    p.status !== "running" ||
    p.sourceHash !== next.sourceHash ||
    p.manifestHash !== next.manifestHash ||
    p.scopeHash !== next.scopeHash ||
    JSON.stringify(p.prior) !== JSON.stringify(next.prior) ||
    next.calls < p.calls ||
    next.calls > p.calls + 1
  )
    fail("CFD_HISTORY_IMMUTABLE");
  for (const [i, q] of p.requests.entries()) {
    const r = next.requests[i];
    if (
      !r ||
      r.purpose !== q.purpose ||
      (q.result !== "IN_FLIGHT" && q.result !== r.result)
    )
      fail("CFD_HISTORY_IMMUTABLE");
  }
  if (
    next.calls !== p.calls &&
    (p.requests.at(-1)?.result === "IN_FLIGHT" ||
      next.requests.at(-1)?.result !== "IN_FLIGHT" ||
      next.status !== "running" ||
      next.projection)
  )
    fail("CFD_HISTORY_IMMUTABLE");
}
export function cfdReport(s?: CFDState, source?: BRState) {
  const v = s ? validateCFDState(s) : undefined;
  if (source) validateCFDSource(source);
  return {
    provider: "instantly",
    phase: "B_CONFIG_DIAGNOSTIC",
    status: v?.status ?? "not_started",
    sourceAvailable: !!v || !!source,
    priorCalls: v || source ? 27 : 0,
    newCalls: v?.requests.length ?? 0,
    calls: v?.calls ?? source?.calls ?? 0,
    budget: { maxNew: 2, maxAccumulated: 29, originalCeiling: 41 },
    error: v?.error ?? null,
    interruptedNeedsReview: v?.status === "running",
    projection: v?.projection ?? null,
    bOriginalStatus: v || source ? "failed" : "unknown",
    recoveryStatus: v || source ? "failed" : "unknown",
    recoveryResumed: false,
    historicalFailureCauseProven: false,
    sendingSafetyCertified: false,
    sends: 0,
    paidOperations: 0,
    mutations: 0,
  };
}
export async function runInstantlyConfigDiagnostic(
  env: Readonly<Record<string, string | undefined>>,
  store: CFDStore,
  inputs: CFDInputs | undefined,
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
    return old?.version === 6 ? cfdReport(old) : cfdReport(undefined, old);
  }
  if (
    options.authorizedNew !== 2 ||
    options.authorizedTotal !== 29 ||
    !options.includedCallsConfirmed ||
    !options.manifestReviewed
  )
    fail("CFD_AUTHORIZATION_REQUIRED");
  if (!inputs) return fail("CFD_INPUTS_REQUIRED");
  const v = validateCFDInputs(inputs),
    old = await store.load();
  if (!old) return fail("CFD_SOURCE_REQUIRED");
  if (old.version === 6) {
    const s = validateCFDState(old);
    if (
      s.sourceHash !== v.sourceHash ||
      s.manifestHash !== v.manifestHash ||
      s.scopeHash !== v.scopeHash
    )
      fail("CFD_BINDING_CHANGED");
    return cfdReport(s);
  }
  validateCFDSource(old);
  if (hash(JSON.stringify(old)) !== v.sourceHash) fail("CFD_SOURCE_CHANGED");
  const config = a.configuration(env);
  if (config.fingerprint !== v.source.prior.prior.prior.predecessor.fingerprint)
    fail("INSTANTLY_BINDING_CHANGED");
  const s: CFDState = {
    version: 6,
    provider: "instantly",
    phase: "B_CONFIG_DIAGNOSTIC",
    prior: v.source,
    sourceHash: v.sourceHash,
    scopeHash: v.scopeHash,
    manifestHash: v.manifestHash,
    calls: 27,
    status: "running",
    requests: [],
    error: null,
    projection: null,
  };
  const save = async () => {
    validateCFDState(s);
    try {
      await store.save(structuredClone(s));
    } catch {
      throw new S00RunError("CFD_STORAGE_OR_INTERNAL_FAILURE");
    }
  };
  await save();
  const clock = options.clock ?? a.realClock;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (options.signal?.aborted) fail("CANCELLED");
      const q: CFDState["requests"][number] = {
        purpose: attempt ? "retry" : "read",
        result: "IN_FLIGHT",
      };
      s.requests.push(q);
      s.calls++;
      await save();
      let body: Obj | undefined,
        error: InstanceType<typeof a.ReadError> | undefined;
      try {
        body = await instantlyTrialJson(
          options.fetchImpl ?? fetch,
          config.key,
          "https://api.instantly.ai/api/v2/campaigns/" +
            v.source.prior.prior.campaignId,
          "GET",
          undefined,
          options.signal,
        );
        q.result = "OK";
      } catch (e) {
        if (!(e instanceof a.ReadError)) throw e;
        error = e;
        q.result = e.code;
      }
      await save();
      if (!error) {
        s.projection = configuredCampaignProjection(
          v.source,
          v.manifest,
          config.workspace,
          body,
        );
        if (!s.projection.currentPaused) fail("CFD_NOT_PAUSED");
        s.status = "completed";
        break;
      }
      if (attempt || !transient(error.code)) throw error;
      const delay = Math.max(5000, error.wait);
      if (delay > 60000) fail("RETRY_WAIT_TOO_LONG");
      try {
        await clock.sleep(delay, options.signal);
      } catch {
        fail("CANCELLED");
      }
    }
  } catch (e) {
    if (
      (!(e instanceof S00RunError) && !(e instanceof a.ReadError)) ||
      !errors.includes(e.code as (typeof errors)[number])
    )
      throw new S00RunError("CFD_STORAGE_OR_INTERNAL_FAILURE");
    s.status = "failed";
    s.error = e.code as (typeof errors)[number];
  }
  await save();
  return cfdReport(s);
}
