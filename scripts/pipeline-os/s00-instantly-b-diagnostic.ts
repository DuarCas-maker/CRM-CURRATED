// Explicit future read-only diagnostic. Imports/default status have no env or HTTP effects.
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
  validateBInputs,
  validateBState,
  type BState,
  type BManifest,
} from "./s00-instantly-b";

const fail = (code: string): never => {
  throw new S00RunError(code);
};
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourceTrace = [
  "workspace",
  "plan",
  "search",
  "create",
  "initial",
  "emergency_pause",
  "emergency_check",
];
export function validateBDSource(value: unknown): BState {
  const s = validateBState(value);
  if (
    s.calls !== 18 ||
    s.status !== "failed" ||
    s.error !== "B_UNSAFE_CAMPAIGN" ||
    s.stage !== 4 ||
    s.normal !== 5 ||
    s.reserve !== 0 ||
    s.hold !== 2 ||
    !s.campaignVerified ||
    !s.campaignId ||
    s.emergency !== "verified_paused" ||
    s.leads.A ||
    s.leads.B ||
    s.snapshots.A ||
    s.snapshots.B ||
    s.requests.length !== 7 ||
    s.requests.some(
      (q, i) =>
        q.step !== sourceTrace[i] ||
        q.result !== "OK" ||
        q.page !== 1 ||
        q.bucket !== (i < 5 ? "N" : "H") ||
        q.purpose !== (i < 5 ? "normal" : "emergency"),
    )
  )
    fail("BD_SOURCE_REQUIRED");
  // The hash of the saved source binds its serialization order, after strict validation.
  return value as BState;
}
export type BDInputs = { source: BState; scope: unknown; manifest: unknown };
export function validateBDInputs(input: BDInputs) {
  const source = validateBDSource(input.source);
  const v = validateBInputs({
    prior: source.prior,
    scope: input.scope,
    manifest: input.manifest,
  });
  if (
    source.manifestHash !== v.manifestHash ||
    source.scopeHash !== v.scopeHash ||
    !v.manifest.controlledRecipientsConfirmed ||
    !v.manifest.exclusiveTrialControlConfirmed ||
    !v.manifest.statusMapping.confirmed
  )
    fail("BD_BINDING_CHANGED");
  return {
    source,
    manifest: v.manifest,
    sourceHash: hash(JSON.stringify(source)),
    manifestHash: v.manifestHash,
    scopeHash: v.scopeHash,
  };
}

const fieldNames = [
  "id",
  "name",
  "organization",
  "status",
  "email_list",
  "email_tag_list",
  "cc_list",
  "bcc_list",
  "provider_routing_rules",
  "ai_sdr_id",
  "is_evergreen",
  "stop_on_reply",
  "stop_for_company",
  "campaign_schedule",
  "sequences",
  "campaign_schedule.start_date",
  "campaign_schedule.end_date",
  "campaign_schedule.schedules",
  "campaign_schedule.schedules[0].name",
  "campaign_schedule.schedules[0].timing",
  "campaign_schedule.schedules[0].days",
  "campaign_schedule.schedules[0].timezone",
] as const;
const types = [
  "missing",
  "null",
  "array",
  "object",
  "string",
  "number",
  "boolean",
  "other",
] as const;
const reasons = [
  "match",
  "missing",
  "null",
  "wrong_type",
  "non_empty",
  "mismatch",
] as const;
const rowSchema = z
  .object({
    field: z.enum(fieldNames),
    observedType: z.enum(types),
    size: z.number().int().min(0).max(2_100_000).nullable(),
    reason: z.enum(reasons),
  })
  .strict();
const projectionSchema = z
  .object({
    identityMatches: z.literal(true),
    currentPaused: z.boolean(),
    originalGuardPassesNow: z.boolean(),
    historicalFailureCauseProven: z.literal(false),
    fields: z.array(rowSchema).length(fieldNames.length),
  })
  .strict();
export type BDProjection = z.infer<typeof projectionSchema>;
const transient = (code: string) =>
  ["NETWORK_OR_TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(code);
const errors = [
  ...a.errors,
  "BD_IDENTITY_MISMATCH",
  "BD_NOT_PAUSED",
  "BD_INVALID_CAMPAIGN_RESPONSE",
] as const;
const schema = z
  .object({
    version: z.literal(4),
    provider: z.literal("instantly"),
    phase: z.literal("B_DIAGNOSTIC"),
    prior: z.custom<BState>(),
    sourceHash: digest,
    manifestHash: digest,
    scopeHash: digest,
    calls: z.number().int().min(18).max(20),
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
export type BDState = z.infer<typeof schema>;
export interface BDStore {
  load(): Promise<BState | BDState | undefined>;
  save(s: BDState): Promise<void>;
}
export function validateBDState(input: unknown): BDState {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("BD_INVALID_JOURNAL");
  const s = parsed.data;
  validateBDSource(s.prior);
  if (
    s.sourceHash !== hash(JSON.stringify(s.prior)) ||
    s.manifestHash !== s.prior.manifestHash ||
    s.scopeHash !== s.prior.scopeHash ||
    s.calls !== 18 + s.requests.length
  )
    fail("BD_INVALID_JOURNAL");
  for (const [i, q] of s.requests.entries()) {
    if (
      q.purpose !== (i === 0 ? "read" : "retry") ||
      (i === 1 && !transient(s.requests[0].result)) ||
      (q.result === "IN_FLIGHT" &&
        (i !== s.requests.length - 1 || s.status !== "running"))
    )
      fail("BD_INVALID_JOURNAL");
  }
  const last = s.requests.at(-1);
  if (
    (s.status === "failed") !== (s.error !== null) ||
    (s.status === "running" && s.projection !== null) ||
    (s.status === "completed" &&
      (!s.projection?.currentPaused || last?.result !== "OK")) ||
    (s.projection !== null &&
      (last?.result !== "OK" ||
        (s.status === "failed" && s.error !== "BD_NOT_PAUSED"))) ||
    (s.error === "BD_NOT_PAUSED" &&
      (!s.projection || s.projection.currentPaused))
  )
    fail("BD_INVALID_JOURNAL");
  if (
    s.status === "failed" &&
    ((!last && s.error !== "CANCELLED") ||
      ([
        "BD_IDENTITY_MISMATCH",
        "BD_INVALID_CAMPAIGN_RESPONSE",
        "BD_NOT_PAUSED",
      ].includes(s.error!) &&
        last?.result !== "OK") ||
      ((a.codes as readonly string[]).includes(s.error!) &&
        s.error !== "CANCELLED" &&
        last?.result !== s.error) ||
      (s.error === "RETRY_WAIT_TOO_LONG" && !transient(last?.result ?? "")))
  )
    fail("BD_INVALID_JOURNAL");
  if (s.projection) {
    const rows = s.projection.fields;
    if (
      rows.some(
        (r, i) =>
          r.field !== fieldNames[i] ||
          (r.observedType === "array" || r.observedType === "object") !==
            (r.size !== null) ||
          (r.reason === "missing" && r.observedType !== "missing") ||
          (r.reason === "null" && r.observedType !== "null") ||
          (r.reason === "non_empty" && (r.observedType !== "array" || !r.size)),
      ) ||
      rows.slice(0, 3).some((r) => r.reason !== "match") ||
      s.projection.originalGuardPassesNow !==
        rows.slice(0, 15).every((r) => r.reason === "match")
    )
      fail("BD_INVALID_JOURNAL");
  }
  return s;
}
export function assertBDTransition(
  previous: BState | BDState | undefined,
  next: BDState,
) {
  validateBDState(next);
  if (!previous) return fail("BD_SOURCE_REQUIRED");
  if (previous.version === 3) {
    validateBDSource(previous);
    if (
      next.sourceHash !== hash(JSON.stringify(previous)) ||
      next.calls !== 18 ||
      next.requests.length ||
      next.status !== "running" ||
      next.projection ||
      next.error
    )
      fail("BD_HISTORY_IMMUTABLE");
    return;
  }
  const p = validateBDState(previous);
  if (isDeepStrictEqual(p, next)) return;
  if (
    p.status !== "running" ||
    p.sourceHash !== next.sourceHash ||
    p.manifestHash !== next.manifestHash ||
    p.scopeHash !== next.scopeHash ||
    JSON.stringify(p.prior) !== JSON.stringify(next.prior) ||
    next.calls < p.calls ||
    next.calls > p.calls + 1 ||
    (p.projection && !isDeepStrictEqual(p.projection, next.projection))
  )
    fail("BD_HISTORY_IMMUTABLE");
  for (const [i, r] of p.requests.entries()) {
    const q = next.requests[i];
    if (
      !q ||
      r.purpose !== q.purpose ||
      (r.result !== "IN_FLIGHT" && r.result !== q.result)
    )
      fail("BD_HISTORY_IMMUTABLE");
  }
}

type Obj = Record<string, unknown>;
const own = (o: unknown, k: string): unknown =>
  o && typeof o === "object" && !Array.isArray(o) && Object.hasOwn(o, k)
    ? (o as Obj)[k]
    : undefined;
function typeOf(x: unknown): (typeof types)[number] {
  if (x === undefined) return "missing";
  if (x === null) return "null";
  if (Array.isArray(x)) return "array";
  return ["object", "string", "number", "boolean"].includes(typeof x)
    ? (typeof x as "object" | "string" | "number" | "boolean")
    : "other";
}
const same = (x: unknown, expected: unknown) => {
  try {
    return isDeepStrictEqual(x, expected);
  } catch {
    return false;
  }
};
function row(
  field: (typeof fieldNames)[number],
  value: unknown,
  expected: unknown,
  statusMatch?: boolean,
): z.infer<typeof rowSchema> {
  const observedType = typeOf(value),
    expectedType = typeOf(expected);
  const size =
    observedType === "array"
      ? (value as unknown[]).length
      : observedType === "object"
        ? Object.keys(value as Obj).length
        : null;
  const reason =
    statusMatch === true || (statusMatch === undefined && same(value, expected))
      ? "match"
      : observedType === "missing"
        ? "missing"
        : observedType === "null"
          ? "null"
          : observedType !== expectedType
            ? "wrong_type"
            : observedType === "array" &&
                Array.isArray(expected) &&
                expected.length === 0 &&
                size! > 0
              ? "non_empty"
              : "mismatch";
  return { field, observedType, size, reason };
}
export function campaignDiagnosticProjection(
  source: BState,
  manifest: BManifest,
  workspace: string,
  body: unknown,
): BDProjection {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return fail("BD_INVALID_CAMPAIGN_RESPONSE");
  const x = body as Obj,
    expected = bCampaignPayload(source, manifest, false);
  if (
    x.id !== source.campaignId ||
    x.name !== expected.name ||
    x.organization !== workspace
  )
    fail("BD_IDENTITY_MISMATCH");
  const fields: BDProjection["fields"] = [
    row("id", x.id, source.campaignId),
    row("name", x.name, expected.name),
    row("organization", x.organization, workspace),
    row(
      "status",
      x.status,
      manifest.statusMapping.pausedStatus,
      (
        [
          manifest.statusMapping.draftStatus,
          manifest.statusMapping.pausedStatus,
        ] as number[]
      ).includes(x.status as number),
    ),
  ];
  for (const field of fieldNames.slice(4, 15))
    fields.push(row(field, own(x, field), own(expected, field)));
  const schedule = own(x, "campaign_schedule"),
    schedules = own(schedule, "schedules");
  const first = Array.isArray(schedules) ? schedules[0] : undefined;
  for (const field of ["start_date", "end_date", "schedules"] as const)
    fields.push(
      row(
        `campaign_schedule.${field}`,
        own(schedule, field),
        manifest.schedule[field],
      ),
    );
  for (const field of ["name", "timing", "days", "timezone"] as const)
    fields.push(
      row(
        `campaign_schedule.schedules[0].${field}`,
        own(first, field),
        manifest.schedule.schedules[0][field],
      ),
    );
  return {
    identityMatches: true,
    currentPaused: x.status === manifest.statusMapping.pausedStatus,
    originalGuardPassesNow: fields
      .slice(0, 15)
      .every((r) => r.reason === "match"),
    historicalFailureCauseProven: false,
    fields,
  };
}

export function bdReport(s?: BDState, priorCalls: number | null = null) {
  const v = s ? validateBDState(s) : undefined;
  return {
    provider: "instantly",
    phase: "B_DIAGNOSTIC",
    status: v?.status ?? "not_started",
    sourceAvailable: !!v || priorCalls !== null,
    priorCalls: v || priorCalls !== null ? 18 : 0,
    newCalls: v?.requests.length ?? 0,
    calls: v?.calls ?? priorCalls ?? 0,
    budget: { maxNew: 2, maxAccumulated: 20, originalCeiling: 36 },
    error: v?.error ?? null,
    interruptedNeedsReview: v?.status === "running",
    projection: v?.projection ?? null,
    bTrialStatus: v || priorCalls !== null ? "failed" : "unknown",
    bResumed: false,
    historicalFailureCauseProven: false,
    sends: 0,
    paidOperations: 0,
    mutations: 0,
  };
}
export async function runInstantlyBDiagnostic(
  env: Readonly<Record<string, string | undefined>>,
  store: BDStore,
  inputs: BDInputs | undefined,
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
    if (old?.version === 3) validateBDSource(old);
    return old?.version === 4
      ? bdReport(old)
      : bdReport(undefined, old?.calls ?? null);
  }
  if (
    options.authorizedNew !== 2 ||
    options.authorizedTotal !== 20 ||
    !options.includedCallsConfirmed ||
    !options.manifestReviewed
  )
    fail("BD_AUTHORIZATION_REQUIRED");
  if (!inputs) return fail("BD_INPUTS_REQUIRED");
  const v = validateBDInputs(inputs),
    old = await store.load();
  if (!old) return fail("BD_SOURCE_REQUIRED");
  if (old.version === 4) {
    const s = validateBDState(old);
    if (
      s.sourceHash !== v.sourceHash ||
      s.manifestHash !== v.manifestHash ||
      s.scopeHash !== v.scopeHash
    )
      fail("BD_BINDING_CHANGED");
    return bdReport(s); // includes IN_FLIGHT: no implicit recovery, env or network.
  }
  validateBDSource(old);
  if (hash(JSON.stringify(old)) !== v.sourceHash) fail("BD_SOURCE_CHANGED");
  const config = a.configuration(env);
  if (config.fingerprint !== v.source.prior.predecessor.fingerprint)
    fail("INSTANTLY_BINDING_CHANGED");
  const s: BDState = {
    version: 4,
    provider: "instantly",
    phase: "B_DIAGNOSTIC",
    prior: v.source,
    sourceHash: v.sourceHash,
    manifestHash: v.manifestHash,
    scopeHash: v.scopeHash,
    calls: 18,
    status: "running",
    requests: [],
    error: null,
    projection: null,
  };
  const save = async () => {
    validateBDState(s);
    try {
      await store.save(structuredClone(s));
    } catch {
      throw new S00RunError("BD_STORAGE_OR_INTERNAL_FAILURE");
    }
  };
  await save();
  const clock = options.clock ?? a.realClock;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (options.signal?.aborted) fail("CANCELLED");
      const q: BDState["requests"][number] = {
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
          "https://api.instantly.ai/api/v2/campaigns/" + s.prior.campaignId,
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
        s.projection = campaignDiagnosticProjection(
          s.prior,
          v.manifest,
          config.workspace,
          body,
        );
        if (!s.projection.currentPaused) fail("BD_NOT_PAUSED");
        s.status = "completed";
        break;
      }
      if (attempt || !transient(error.code)) throw error;
      const wait = Math.max(5000, error.wait);
      if (wait > 60000) fail("RETRY_WAIT_TOO_LONG");
      try {
        await clock.sleep(wait, options.signal);
      } catch {
        fail("CANCELLED");
      }
    }
  } catch (e) {
    if (!(e instanceof S00RunError) && !(e instanceof a.ReadError))
      throw new S00RunError("BD_STORAGE_OR_INTERNAL_FAILURE");
    if (!errors.includes(e.code as (typeof errors)[number]))
      throw new S00RunError("BD_STORAGE_OR_INTERNAL_FAILURE");
    s.status = "failed";
    s.error = e.code as (typeof errors)[number];
  }
  await save();
  return bdReport(s);
}
