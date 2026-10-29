// Phase B standalone trial. No env autoload, HTTP, filesystem writes or sends at import.
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { hash, S00RunError } from "./s00-composio-common";
import {
  instantlyA as a,
  instantlyTrialJson,
  type InstantlyClock,
} from "./s00-instantly-runner";
import {
  validateInstantlyRecovery,
  type InstantlyRecovery,
} from "./s00-instantly-recovery";

type Obj = Record<string, unknown>;
type Env = Readonly<Record<string, string | undefined>>;
const fail = (code: string): never => {
  throw new S00RunError(code);
};
const digest = z.string().regex(/^[a-f0-9]{64}$/),
  uuid = z.string().uuid(),
  nullableId = uuid.nullable();
const daySchema = z
  .object({
    "0": z.boolean(),
    "1": z.boolean(),
    "2": z.boolean(),
    "3": z.boolean(),
    "4": z.boolean(),
    "5": z.boolean(),
    "6": z.boolean(),
  })
  .strict();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (s) =>
        Number.isFinite(Date.parse(s + "T00:00:00Z")) &&
        new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s,
    );
const schedule = z
  .object({
    schedules: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            timing: z
              .object({ from: time, to: time })
              .strict()
              .refine((x) => x.from < x.to),
            days: daySchema.refine((x) => Object.values(x).some(Boolean)),
            timezone: z
              .string()
              .min(1)
              .max(80)
              .refine((x) => {
                try {
                  new Intl.DateTimeFormat("en", { timeZone: x });
                  return true;
                } catch {
                  return false;
                }
              }),
          })
          .strict(),
      )
      .length(1),
    start_date: date,
    end_date: date,
  })
  .strict()
  .refine((x) => x.start_date <= x.end_date);
const statuses = z.union([
  z.literal(-99),
  z.literal(-1),
  z.literal(-2),
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
const manifestSchema = z
  .object({
    version: z.literal(1),
    controlledRecipientsConfirmed: z.boolean(),
    exclusiveTrialControlConfirmed: z.boolean(),
    recipients: z.tuple([
      z.string().email().max(254),
      z.string().email().max(254),
    ]),
    schedule,
    subject: z
      .string()
      .min(1)
      .max(160)
      .refine((s) => !/[\r\n\0]/.test(s)),
    body: z.string().min(1).max(4000),
    statusMapping: z
      .object({
        confirmed: z.boolean(),
        source: z.literal("operator_panel"),
        evidenceRef: z.string().min(1).max(160),
        draftStatus: statuses,
        pausedStatus: statuses,
      })
      .strict(),
  })
  .strict()
  .refine(
    (x) =>
      x.recipients[0].toLowerCase() !== x.recipients[1].toLowerCase() &&
      x.statusMapping.draftStatus !== x.statusMapping.pausedStatus,
  );
export type BManifest = z.infer<typeof manifestSchema>;
export function validateBManifest(input: unknown) {
  const r = manifestSchema.safeParse(input);
  if (!r.success) return fail("B_INVALID_MANIFEST");
  return r.data;
}
const scopeSchema = z
  .object({
    version: z.literal(1),
    provider: z.literal("instantly"),
    phase: z.literal("A"),
    kind: z.literal("operator_scope_attestation"),
    recordedAt: z.string(),
    keyLabel: z.literal("CRM-curated"),
    declaredScopes: z.tuple([z.literal("all:all")]),
    evidence: z
      .object({
        panel: z.string(),
        screenshotName: z.string(),
        screenshotSha256: digest,
        userConfirmedSavedKeyLabel: z.literal(true),
      })
      .strict(),
    binding: z
      .object({
        basis: z.literal("last_tested_configuration_and_user_confirmation"),
        configurationFingerprint: digest,
        ledgerManifestHash: digest,
        ledgerSha256: digest,
        priorCalls: z.literal(4),
        accumulatedCalls: z.literal(11),
      })
      .strict(),
    apiListingMatchedCurrentKey: z.literal(false),
    effectiveWritesTested: z.literal(false),
    authorizesRemoteOperations: z.literal(false),
    requiresCurrentFingerprintMatchBeforeUse: z.literal(true),
  })
  .strict();
export type BInputs = {
  prior: InstantlyRecovery;
  scope: unknown;
  manifest: unknown;
};
export function validateBInputs(inputs: BInputs) {
  validateInstantlyRecovery(inputs.prior);
  // Preserve field order: the operator attestation binds the saved file bytes.
  const prior = inputs.prior,
    parsed = scopeSchema.safeParse(inputs.scope),
    manifest = validateBManifest(inputs.manifest);
  if (
    prior.status !== "completed" ||
    prior.calls !== 11 ||
    prior.predecessor.calls !== 4
  )
    return fail("B_SOURCE_REQUIRED");
  if (!parsed.success) return fail("B_SCOPE_EVIDENCE_REQUIRED");
  const scope = parsed.data;
  if (
    scope.binding.configurationFingerprint !== prior.predecessor.fingerprint ||
    scope.binding.ledgerManifestHash !== prior.manifestHash ||
    scope.binding.ledgerSha256 !== hash(JSON.stringify(prior, null, 2) + "\n")
  )
    return fail("B_SCOPE_BINDING_CHANGED");
  return {
    prior,
    scope,
    manifest,
    sourceHash: hash(JSON.stringify(prior)),
    scopeHash: hash(JSON.stringify(scope)),
    manifestHash: hash(JSON.stringify(manifest)),
  };
}
const steps = [
  "workspace",
  "plan",
  "search",
  "create",
  "initial",
  "pause",
  "paused",
  "configure",
  "configured",
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
type Step = (typeof steps)[number];
const errors = [
  ...a.errors,
  "B_INVALID_PROVIDER_SCHEMA",
  "B_RESOURCE_MISMATCH",
  "B_UNSAFE_CAMPAIGN",
  "B_CAPACITY_REQUIRED",
  "B_NONCE_EXISTS",
  "B_AUDIENCE_MISMATCH",
  "B_ISOLATION_FAILED",
  "B_UNRESOLVED_WRITE",
  "B_RECOVERY_RESERVE_REQUIRED",
] as const;
const requestSchema = z
  .object({
    step: z.enum([...steps, "emergency_pause", "emergency_check"]),
    page: z.number().int().min(1).max(3),
    bucket: z.enum(["N", "R", "H"]),
    purpose: z.enum(["normal", "retry", "reconcile", "emergency"]),
    result: z.enum(a.codes),
  })
  .strict();
const bSchema = z
  .object({
    version: z.literal(3),
    provider: z.literal("instantly"),
    phase: z.literal("B"),
    prior: z.custom<InstantlyRecovery>(),
    sourceHash: digest,
    scopeHash: digest,
    manifestHash: digest,
    status: z.enum(["running", "completed", "failed"]),
    stage: z.number().int().min(0).max(18),
    calls: z.number().int().min(11).max(36),
    normal: z.number().int().min(0).max(20),
    reserve: z.number().int().min(0).max(3),
    hold: z.number().int().min(0).max(2),
    requests: z.array(requestSchema).max(25),
    error: z.enum(errors).nullable(),
    campaignId: nullableId,
    campaignVerified: z.boolean(),
    leads: z.object({ A: nullableId, B: nullableId }).strict(),
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
  })
  .strict();
export type BState = z.infer<typeof bSchema>;
export interface BStore {
  load(): Promise<InstantlyRecovery | BState | undefined>;
  save(s: BState): Promise<void>;
}
export function validateBState(input: unknown): BState {
  const r = bSchema.safeParse(input);
  if (!r.success) return fail("B_INVALID_JOURNAL");
  const s = r.data;
  let prior: InstantlyRecovery;
  try {
    validateInstantlyRecovery(s.prior);
    prior = s.prior;
  } catch {
    return fail("B_INVALID_JOURNAL");
  }
  if (
    prior.status !== "completed" ||
    prior.calls !== 11 ||
    s.sourceHash !== hash(JSON.stringify(prior)) ||
    s.calls !== 11 + s.requests.length ||
    s.normal + s.reserve + s.hold !== s.requests.length ||
    s.normal !== s.requests.filter((x) => x.bucket === "N").length ||
    s.reserve !== s.requests.filter((x) => x.bucket === "R").length ||
    s.hold !== s.requests.filter((x) => x.bucket === "H").length
  )
    return fail("B_INVALID_JOURNAL");
  let previous = -1;
  const normal = new Set<string>();
  for (const [i, q] of s.requests.entries()) {
    const op = steps.indexOf(q.step as Step),
      id = q.step + q.page;
    if (
      q.result === "IN_FLIGHT" &&
      (i !== s.requests.length - 1 || s.status !== "running")
    )
      fail("B_INVALID_JOURNAL");
    if (q.bucket === "H") {
      if (
        !s.campaignVerified ||
        !s.campaignId ||
        q.purpose !== "emergency" ||
        q.page !== 1 ||
        !["emergency_pause", "emergency_check"].includes(q.step)
      )
        fail("B_INVALID_JOURNAL");
      const expected = s.requests.slice(0, i).filter((x) => x.bucket === "H")
        .length
        ? "emergency_check"
        : "emergency_pause";
      if (q.step !== expected) fail("B_INVALID_JOURNAL");
      previous = 100;
    } else {
      if (
        previous === 100 ||
        op < previous ||
        op > s.stage ||
        op < 0 ||
        q.purpose === "emergency" ||
        (q.page > 1 && q.step !== "audience" && q.step !== "search")
      )
        fail("B_INVALID_JOURNAL");
      if (q.bucket === "N") {
        if (
          q.purpose !== "normal" ||
          normal.has(id) ||
          (q.step !== "audience" && q.page !== 1)
        )
          fail("B_INVALID_JOURNAL");
        normal.add(id);
      } else if (!["retry", "reconcile"].includes(q.purpose))
        fail("B_INVALID_JOURNAL");
      if (q.purpose === "retry") {
        const p = s.requests[i - 1];
        if (
          !p ||
          p.step !== q.step ||
          p.page !== q.page ||
          !["NETWORK_OR_TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(p.result)
        )
          fail("B_INVALID_JOURNAL");
      }
      previous = op;
    }
  }
  for (let i = 0; i < s.stage; i++)
    if (!s.requests.some((q) => q.step === steps[i] && q.result === "OK"))
      fail("B_INVALID_JOURNAL");
  if (
    (s.status === "completed") !== (s.stage === 18) ||
    (s.status === "failed") !== (s.error !== null) ||
    (s.stage >= 4 && !s.campaignId) ||
    (s.campaignVerified && (!s.campaignId || s.stage < 4)) ||
    (s.stage >= 5 && !s.campaignVerified) ||
    (s.stage >= 10 && !s.leads.A) ||
    (s.stage >= 12 && !s.leads.B) ||
    (s.leads.A && s.leads.A === s.leads.B) ||
    (s.stage >= 11 && !s.snapshots.A) ||
    (s.stage >= 13 && !s.snapshots.B)
  )
    fail("B_INVALID_JOURNAL");
  return s;
}
export function assertBTransition(
  previous: InstantlyRecovery | BState | undefined,
  next: BState,
) {
  validateBState(next);
  if (!previous) return fail("B_SOURCE_REQUIRED");
  if (previous.version === 2) {
    validateInstantlyRecovery(previous);
    if (
      next.sourceHash !== hash(JSON.stringify(previous)) ||
      next.calls !== 11 ||
      next.stage ||
      next.requests.length ||
      next.status !== "running"
    )
      fail("B_HISTORY_IMMUTABLE");
    return;
  }
  const p = validateBState(previous);
  if (JSON.stringify(p) === JSON.stringify(next)) return;
  if (
    p.status !== "running" ||
    p.sourceHash !== next.sourceHash ||
    p.scopeHash !== next.scopeHash ||
    p.manifestHash !== next.manifestHash ||
    JSON.stringify(p.prior) !== JSON.stringify(next.prior) ||
    next.calls < p.calls ||
    next.calls > p.calls + 1 ||
    next.stage < p.stage ||
    next.stage > p.stage + 1 ||
    (p.campaignId && p.campaignId !== next.campaignId) ||
    (p.campaignVerified && !next.campaignVerified)
  )
    fail("B_HISTORY_IMMUTABLE");
  for (const alias of ["A", "B"] as const)
    if (
      (p.leads[alias] && p.leads[alias] !== next.leads[alias]) ||
      (p.snapshots[alias] && p.snapshots[alias] !== next.snapshots[alias])
    )
      fail("B_HISTORY_IMMUTABLE");
  for (const [i, r] of p.requests.entries()) {
    const n = next.requests[i];
    if (
      !n ||
      r.step !== n.step ||
      r.page !== n.page ||
      r.bucket !== n.bucket ||
      r.purpose !== n.purpose ||
      (r.result !== "IN_FLIGHT" && r.result !== n.result)
    )
      fail("B_HISTORY_IMMUTABLE");
  }
}
const root = "https://api.instantly.ai/api/v2/";
export type BTrialContext = Pick<BState, "prior" | "campaignId" | "leads">;
const record = (x: unknown): Obj =>
  x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Obj)
    : fail("B_INVALID_PROVIDER_SCHEMA");
const canonical = (x: unknown): unknown =>
  Array.isArray(x)
    ? x.map(canonical)
    : x !== null && typeof x === "object"
      ? Object.fromEntries(
          Object.entries(x)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : x;
const stableHash = (x: unknown) => hash(JSON.stringify(canonical(x)));
const eq = (x: unknown, y: unknown) => stableHash(x) === stableHash(y);
const createdId = (x: unknown) => {
  const r = uuid.safeParse(x);
  return r.success ? r.data : fail("B_INVALID_PROVIDER_SCHEMA");
};
const empty = (x: unknown) => Array.isArray(x) && x.length === 0;
const safety = {
  email_list: [],
  email_tag_list: [],
  cc_list: [],
  bcc_list: [],
  provider_routing_rules: [],
  is_evergreen: false,
  stop_on_reply: true,
  stop_for_company: false,
};
function name(s: BTrialContext) {
  return "S00-INSTANTLY-" + s.prior.predecessor.nonce;
}
function variables(s: BTrialContext, alias: "A" | "B", hold = false) {
  return {
    s00_run: s.prior.predecessor.nonce,
    s00_alias: alias,
    s00_hold: hold,
  };
}
export function bCampaignPayload(
  s: BTrialContext,
  m: BManifest,
  configured: boolean,
) {
  return {
    name: name(s),
    campaign_schedule: m.schedule,
    ...structuredClone(safety),
    // Creator metadata is supported on create, not in the documented PATCH body.
    ...(configured ? {} : { ai_sdr_id: null }),
    sequences: configured
      ? [
          {
            steps: [
              {
                type: "email",
                delay: 0,
                variants: [{ subject: m.subject, body: m.body }],
              },
            ],
          },
        ]
      : [],
  };
}
export function bLeadPayload(s: BTrialContext, m: BManifest, alias: "A" | "B") {
  if (!s.campaignId) return fail("B_RESOURCE_MISMATCH");
  return {
    campaign: s.campaignId,
    email: m.recipients[alias === "A" ? 0 : 1].toLowerCase(),
    skip_if_in_workspace: true,
    skip_if_in_campaign: true,
    verify_leads_on_import: false,
    verify_leads_for_lead_finder: false,
    custom_variables: variables(s, alias),
  };
}
function campaignIdentity(s: BTrialContext, x: Obj) {
  if (x.id !== s.campaignId || x.name !== name(s)) fail("B_RESOURCE_MISMATCH");
}
type OptionalObservation =
  "omitted" | "null" | "explicit" | "conflict" | "invalid";
// Optional/nullable does not establish a default or certify sending safety.
// This projection retains uncertainty without retaining field values or mutating input.
export function bTrialOptionalFields(input: unknown) {
  const x = record(input);
  const inspect = (
    key: "ai_sdr_id" | "is_evergreen" | "stop_for_company",
  ): OptionalObservation => {
    if (!Object.hasOwn(x, key)) return key in x ? "invalid" : "omitted";
    const value = x[key];
    if (value === null) return "null";
    if (key === "ai_sdr_id")
      return uuid.safeParse(value).success ? "conflict" : "invalid";
    if (typeof value !== "boolean") return "invalid";
    return value === false ? "explicit" : "conflict";
  };
  return {
    ai_sdr_id: inspect("ai_sdr_id"),
    is_evergreen: inspect("is_evergreen"),
    stop_for_company: inspect("stop_for_company"),
  };
}
// Only the documented "days" defaults may supplement our single zero-delay email step.
// Raw diagnostics opt out; requests and provider objects are never normalized in place.
function trialSequencesMatch(actual: unknown, expected: unknown): boolean {
  const plain = (x: unknown): x is Obj =>
    x !== null &&
    typeof x === "object" &&
    Object.getPrototypeOf(x) === Object.prototype;
  if (
    !Array.isArray(actual) ||
    actual.length !== 1 ||
    !Array.isArray(expected) ||
    expected.length !== 1
  )
    return false;
  const sequence = actual[0],
    wanted = expected[0];
  if (
    !plain(sequence) ||
    !plain(wanted) ||
    !Object.hasOwn(sequence, "steps") ||
    !Array.isArray(sequence.steps) ||
    sequence.steps.length !== 1 ||
    !Array.isArray(wanted.steps) ||
    wanted.steps.length !== 1
  )
    return false;
  const step = sequence.steps[0],
    target = wanted.steps[0];
  if (
    !plain(step) ||
    !plain(target) ||
    target.type !== "email" ||
    target.delay !== 0 ||
    Object.keys(target).sort().join(",") !== "delay,type,variants"
  )
    return false;
  const comparable = { ...step };
  for (const key of ["delay_unit", "pre_delay_unit"] as const) {
    if (key in step && !Object.hasOwn(step, key)) return false;
    if (Object.hasOwn(step, key)) {
      if (step[key] !== "days") return false;
      delete comparable[key];
    }
  }
  return isDeepStrictEqual([{ ...sequence, steps: [comparable] }], expected);
}
function assertCampaign(
  s: BTrialContext,
  m: BManifest,
  x: Obj,
  workspace: string,
  configured: boolean,
  paused: boolean,
  sequencePolicy:
    "documented_defaults" | "request_exact" = "documented_defaults",
) {
  campaignIdentity(s, x);
  if (x.organization !== workspace) fail("WORKSPACE_MISMATCH");
  if (
    // Independent non-sending gate even if a manifest maps an active status incorrectly.
    (x.status !== 0 && x.status !== 2) ||
    !(
      [m.statusMapping.draftStatus, m.statusMapping.pausedStatus] as number[]
    ).includes(x.status as number) ||
    (paused && x.status !== m.statusMapping.pausedStatus)
  )
    fail("B_UNSAFE_CAMPAIGN");
  for (const k of [
    "email_list",
    "email_tag_list",
    "cc_list",
    "bcc_list",
    "provider_routing_rules",
  ])
    if (!empty(x[k])) fail("B_UNSAFE_CAMPAIGN");
  if (
    Object.values(bTrialOptionalFields(x)).some(
      (state) => state === "conflict" || state === "invalid",
    ) ||
    x.stop_on_reply !== true ||
    !eq(x.campaign_schedule, m.schedule) ||
    !(configured && sequencePolicy === "documented_defaults"
      ? trialSequencesMatch(x.sequences, bCampaignPayload(s, m, true).sequences)
      : eq(x.sequences, bCampaignPayload(s, m, configured).sequences))
  )
    fail("B_UNSAFE_CAMPAIGN");
}
function leadSnapshot(
  s: BTrialContext,
  m: BManifest,
  x: Obj,
  workspace: string,
  alias: "A" | "B",
  hold: boolean,
) {
  if (
    x.id !== s.leads[alias] ||
    x.campaign !== s.campaignId ||
    typeof x.email !== "string" ||
    x.email.toLowerCase() !== m.recipients[alias === "A" ? 0 : 1].toLowerCase()
  )
    return fail("B_RESOURCE_MISMATCH");
  if (x.organization !== workspace) fail("WORKSPACE_MISMATCH");
  if (typeof x.status !== "number") fail("B_INVALID_PROVIDER_SCHEMA");
  const payload = record(x.payload),
    expected = variables(s, alias, hold);
  for (const [k, v] of Object.entries(expected))
    if (
      payload[k] !== v ||
      (x.custom_variables !== undefined && record(x.custom_variables)[k] !== v)
    )
      fail("B_RESOURCE_MISMATCH");
  return stableHash({
    id: x.id,
    organization: x.organization,
    campaign: x.campaign,
    email: x.email.toLowerCase(),
    status: x.status,
    payload: { ...payload, s00_hold: false },
    ...(x.custom_variables !== undefined
      ? { custom_variables: { ...record(x.custom_variables), s00_hold: false } }
      : {}),
  });
}
type Request = {
  url: string;
  method: "GET" | "POST" | "PATCH";
  body?: Obj;
  write: boolean;
};
export function bRequest(
  s: BTrialContext,
  m: BManifest,
  step: Step | "emergency_pause" | "emergency_check",
  options: { cursor?: string; reconcile?: boolean } = {},
): Request {
  if (![...steps, "emergency_pause", "emergency_check"].includes(step))
    fail("B_RESOURCE_MISMATCH");
  const cid = s.campaignId,
    lid = step.includes("B") ? s.leads.B : s.leads.A;
  const campaign = () => {
    if (!cid) fail("B_RESOURCE_MISMATCH");
    return root + "campaigns/" + cid;
  };
  const lead = () => {
    if (!lid) fail("B_RESOURCE_MISMATCH");
    return root + "leads/" + lid;
  };
  const search = () => {
    const u = new URL(root + "campaigns");
    u.searchParams.set("limit", "100");
    u.searchParams.set("search", name(s));
    if (options.cursor) u.searchParams.set("starting_after", options.cursor);
    return { url: u.href, method: "GET", write: false } as Request;
  };
  if (step === "workspace")
    return { url: root + "workspaces/current", method: "GET", write: false };
  if (step === "plan")
    return {
      url: root + "workspace-billing/plan-details",
      method: "GET",
      write: false,
    };
  if (step === "search" || (step === "create" && options.reconcile))
    return search();
  if (step === "create")
    return {
      url: root + "campaigns",
      method: "POST",
      body: bCampaignPayload(s, m, false),
      write: true,
    };
  if (
    ["initial", "paused", "configured", "final", "emergency_check"].includes(
      step,
    ) ||
    (["configure", "pause"].includes(step) && options.reconcile)
  )
    return { url: campaign(), method: "GET", write: false };
  if (step === "pause" || step === "emergency_pause")
    return { url: campaign() + "/pause", method: "POST", write: true };
  if (step === "configure")
    return {
      url: campaign(),
      method: "PATCH",
      body: bCampaignPayload(s, m, true),
      write: true,
    };
  if (step === "audience")
    return {
      url: root + "leads/list",
      method: "POST",
      body: {
        campaign: cid,
        limit: 1,
        distinct_contacts: false,
        ...(options.cursor ? { starting_after: options.cursor } : {}),
      },
      write: false,
    };
  if (step === "createA" || step === "createB") {
    const alias = step === "createA" ? "A" : "B";
    if (options.reconcile)
      return {
        url: root + "leads/list",
        method: "POST",
        body: {
          campaign: cid,
          limit: 100,
          distinct_contacts: false,
          contacts: [m.recipients[alias === "A" ? 0 : 1].toLowerCase()],
        },
        write: false,
      };
    return {
      url: root + "leads",
      method: "POST",
      body: bLeadPayload(s, m, alias),
      write: true,
    };
  }
  if (step === "updateA" && !options.reconcile)
    return {
      url: lead(),
      method: "PATCH",
      body: { custom_variables: variables(s, "A", true) },
      write: true,
    };
  return { url: lead(), method: "GET", write: false };
}
export const instantlyB = {
  assertCampaign,
  leadSnapshot,
  createdId,
  campaignIdentity,
  errors,
};
export function bReport(s?: BState, priorCalls = 11) {
  if (!s)
    return {
      provider: "instantly",
      phase: "B",
      status: "not_started",
      priorCalls,
      newCalls: 0,
      calls: priorCalls,
      budget: {
        normal: 0,
        reserve: 0,
        hold: 0,
        maxNew: 25,
        maxAccumulated: 36,
      },
      error: null,
      blockers: ["B_NOT_RUN"],
      sends: 0,
      paidOperations: 0,
      sendingSafetyCertified: false,
    };
  validateBState(s);
  return {
    provider: "instantly",
    phase: "B",
    status: s.status,
    priorCalls: 11,
    newCalls: s.requests.length,
    calls: s.calls,
    stage: s.stage,
    budget: {
      normal: s.normal,
      reserve: s.reserve,
      hold: s.hold,
      maxNew: 25,
      maxAccumulated: 36,
    },
    error: s.error,
    emergency: s.emergency,
    interruptedNeedsReview: s.status === "running",
    campaignCreated: !!s.campaignId,
    leadsRecorded: Number(!!s.leads.A) + Number(!!s.leads.B),
    isolatedUpdateVerified: s.stage >= 17,
    closedNonSending: s.status === "completed",
    individualSchedulerPauseVerified: false,
    blockers: s.status === "completed" ? [] : ["B_NOT_COMPLETE"],
    sends: 0,
    paidOperations: 0,
    sendingSafetyCertified: false,
    providerBillingMeasured: false,
  };
}
export async function runInstantlyB(
  env: Env,
  store: BStore,
  inputs: BInputs | undefined,
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
    return old?.version === 3
      ? bReport(old)
      : bReport(undefined, old?.calls ?? 11);
  }
  if (
    options.authorizedNew !== 25 ||
    options.authorizedTotal !== 36 ||
    !options.includedCallsConfirmed ||
    !options.manifestReviewed
  )
    fail("B_AUTHORIZATION_REQUIRED");
  if (!inputs) return fail("B_INPUTS_REQUIRED");
  const validated = validateBInputs(inputs),
    m = validated.manifest,
    config = a.configuration(env);
  if (config.fingerprint !== validated.prior.predecessor.fingerprint)
    fail("INSTANTLY_BINDING_CHANGED");
  if (
    !m.controlledRecipientsConfirmed ||
    !m.exclusiveTrialControlConfirmed ||
    !m.statusMapping.confirmed
  )
    fail("B_MANIFEST_NOT_CONFIRMED");
  const old = await store.load();
  if (!old) return fail("B_SOURCE_REQUIRED");
  if (old.version === 3) {
    const s = validateBState(old);
    if (
      s.manifestHash !== validated.manifestHash ||
      s.sourceHash !== validated.sourceHash ||
      s.scopeHash !== validated.scopeHash
    )
      fail("B_BINDING_CHANGED");
    return bReport(s);
  }
  validateInstantlyRecovery(old);
  if (hash(JSON.stringify(old)) !== validated.sourceHash)
    fail("B_SOURCE_CHANGED");
  const s: BState = {
    version: 3,
    provider: "instantly",
    phase: "B",
    prior: validated.prior,
    sourceHash: validated.sourceHash,
    scopeHash: validated.scopeHash,
    manifestHash: validated.manifestHash,
    status: "running",
    stage: 0,
    calls: 11,
    normal: 0,
    reserve: 0,
    hold: 0,
    requests: [],
    error: null,
    campaignId: null,
    campaignVerified: false,
    leads: { A: null, B: null },
    snapshots: { A: null, B: null },
    emergency: "not_needed",
  };
  const clock = options.clock ?? a.realClock,
    fetchImpl = options.fetchImpl ?? fetch;
  const save = async () => {
    validateBState(s);
    await store.save(structuredClone(s));
  };
  await save();
  let last: number | undefined;
  async function wait(ms: number, emergency = false) {
    if (options.signal?.aborted && !emergency) fail("CANCELLED");
    try {
      if (ms > 0) await clock.sleep(ms, emergency ? undefined : options.signal);
    } catch {
      fail("CANCELLED");
    }
  }
  async function request(
    step: Step | "emergency_pause" | "emergency_check",
    bucket: "N" | "R" | "H",
    page = 1,
    cursor = "",
    reconcile = false,
    purpose: "normal" | "retry" | "reconcile" | "emergency" = "normal",
  ): Promise<Obj> {
    const req = bRequest(s, m, step, { cursor, reconcile });
    await wait(
      last === undefined ? 0 : Math.max(0, 1000 - (clock.now() - last)),
      bucket === "H",
    );
    if (
      s.calls >= 36 ||
      (bucket === "N"
        ? s.normal >= 20
        : bucket === "R"
          ? s.reserve >= 3
          : s.hold >= 2)
    )
      fail("BUDGET_EXHAUSTED");
    if (
      bucket === "H" &&
      (!s.campaignVerified || !step.startsWith("emergency_"))
    )
      fail("B_RESOURCE_MISMATCH");
    if (req.write && bucket !== "H" && (s.reserve >= 3 || s.hold !== 0))
      fail("B_RECOVERY_RESERVE_REQUIRED");
    const q: BState["requests"][number] = {
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
    await save();
    last = clock.now();
    let result: Obj | undefined,
      failure: InstanceType<typeof a.ReadError> | undefined;
    try {
      result = await instantlyTrialJson(
        fetchImpl,
        config.key,
        req.url,
        req.method,
        req.body,
        bucket === "H" ? undefined : options.signal,
      );
      q.result = "OK";
    } catch (e) {
      failure =
        e instanceof a.ReadError ? e : new a.ReadError("INVALID_RESPONSE");
      q.result = failure.code;
    }
    await save();
    if (!failure) return result!;
    if (
      !req.write &&
      bucket !== "H" &&
      purpose !== "retry" &&
      ["NETWORK_OR_TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(failure.code)
    ) {
      const delay = Math.max(5000, failure.wait);
      if (delay > 60000) fail("RETRY_WAIT_TOO_LONG");
      return wait(delay).then(() =>
        request(step, "R", page, cursor, reconcile, "retry"),
      );
    }
    throw failure;
  }
  async function read(
    step: Step,
    page = 1,
    cursor = "",
    bucket: "N" | "R" = "N",
    reconcile = false,
  ) {
    return request(
      step,
      bucket,
      page,
      cursor,
      reconcile,
      bucket === "R" ? "reconcile" : "normal",
    );
  }
  async function mutate(
    step: Step,
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
        conciliate(await read(step, 1, "", "R", true));
      } catch (error) {
        if (error instanceof S00RunError || error instanceof a.ReadError)
          fail("B_UNRESOLVED_WRITE");
        throw error;
      }
    }
  }
  async function next() {
    s.stage++;
    if (s.stage === 18) s.status = "completed";
    await save();
  }
  function ownCampaign(x: Obj) {
    if (x.id !== s.campaignId || x.name !== name(s))
      fail("B_RESOURCE_MISMATCH");
    if (x.organization !== config.workspace) fail("WORKSPACE_MISMATCH");
    s.campaignVerified = true;
  }
  const verify = (x: Obj, configured: boolean, paused: boolean) =>
    assertCampaign(s, m, x, config.workspace, configured, paused);
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
    let cursor = "",
      complete = false;
    const cursors = new Set<string>();
    for (let page = 1; page <= 3; page++) {
      const x = a.list(
        await read("search", page, cursor, page === 1 ? "N" : "R"),
      );
      if (x.rows.some((r) => r.name === name(s))) fail("B_NONCE_EXISTS");
      if (!x.next) {
        complete = true;
        break;
      }
      if (cursors.has(x.next) || x.next === cursor) fail("CURSOR_REPEATED");
      cursors.add(x.next);
      cursor = x.next;
    }
    if (!complete) fail("PAGINATION_LIMIT");
    await next();
    await mutate(
      "create",
      (x) => {
        s.campaignId = createdId(x.id);
      },
      (x) => {
        const p = a.list(x),
          matches = p.rows.filter((r) => r.name === name(s));
        if (p.next || matches.length !== 1) fail("B_UNRESOLVED_WRITE");
        s.campaignId = createdId(matches[0].id);
        verify(matches[0], false, false);
      },
    );
    await next();
    const first = await read("initial");
    ownCampaign(first);
    verify(first, false, false);
    await next();
    await mutate(
      "pause",
      () => {},
      (x) => verify(x, false, true),
    );
    await next();
    verify(await read("paused"), false, true);
    await next();
    await mutate(
      "configure",
      () => {},
      (x) => verify(x, true, true),
    );
    await next();
    verify(await read("configured"), true, true);
    await next();
    for (const alias of ["A", "B"] as const) {
      await mutate(
        alias === "A" ? "createA" : "createB",
        (x) => {
          const id = createdId(x.id);
          if (id === s.leads[alias === "A" ? "B" : "A"])
            fail("B_RESOURCE_MISMATCH");
          s.leads[alias] = id;
        },
        (x) => {
          const p = a.list(x);
          if (p.next || p.rows.length !== 1) fail("B_UNRESOLVED_WRITE");
          s.leads[alias] = createdId(p.rows[0].id);
          leadSnapshot(s, m, p.rows[0], config.workspace, alias, false);
        },
      );
      await next();
      s.snapshots[alias] = leadSnapshot(
        s,
        m,
        await read(alias === "A" ? "getA" : "getB"),
        config.workspace,
        alias,
        false,
      );
      await next();
    }
    const seen = new Set<string>();
    cursor = "";
    complete = false;
    for (let page = 1; page <= 3; page++) {
      const p = a.list(await read("audience", page, cursor));
      if (p.rows.length > 1) fail("B_AUDIENCE_MISMATCH");
      for (const row of p.rows) {
        const id = a.parse(uuid, row.id);
        if (seen.has(id)) fail("DUPLICATE_RECORD");
        const alias =
          id === s.leads.A ? "A" : id === s.leads.B ? "B" : undefined;
        if (!alias) return fail("B_AUDIENCE_MISMATCH");
        leadSnapshot(s, m, row, config.workspace, alias, false);
        seen.add(id);
      }
      if (!p.next) {
        complete = true;
        break;
      }
      if (p.rows.length !== 1) fail("B_AUDIENCE_MISMATCH");
      const lastId = p.rows[0].id as string;
      if (cursor === lastId) fail("CURSOR_REPEATED");
      cursor = lastId;
    }
    if (!complete || seen.size !== 2) fail("B_AUDIENCE_MISMATCH");
    await next();
    const changed = (x: Obj) => {
      if (leadSnapshot(s, m, x, config.workspace, "A", true) !== s.snapshots.A)
        fail("B_ISOLATION_FAILED");
    };
    await mutate("updateA", () => {}, changed);
    await next();
    changed(await read("recheckA"));
    await next();
    if (
      leadSnapshot(
        s,
        m,
        await read("recheckB"),
        config.workspace,
        "B",
        false,
      ) !== s.snapshots.B
    )
      fail("B_ISOLATION_FAILED");
    await next();
    verify(await read("final"), true, true);
    await next();
  } catch (e) {
    if (!(e instanceof S00RunError) && !(e instanceof a.ReadError))
      throw new S00RunError("B_STORAGE_OR_INTERNAL_FAILURE");
    if (!errors.includes(e.code as (typeof errors)[number]))
      throw new S00RunError("B_STORAGE_OR_INTERNAL_FAILURE");
    const error = e.code as (typeof errors)[number];
    const unsafeIdentity = [
      "WORKSPACE_MISMATCH",
      "B_RESOURCE_MISMATCH",
      "HTTP_401",
      "HTTP_402",
      "HTTP_403",
    ].includes(error);
    const failedPause =
      s.requests.at(-1)?.step === "pause" && s.requests.at(-1)?.result !== "OK";
    if (s.campaignVerified && s.campaignId && !unsafeIdentity && !failedPause) {
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
        campaignIdentity(s, x);
        if (
          x.organization !== config.workspace ||
          x.status !== m.statusMapping.pausedStatus
        )
          fail("B_UNSAFE_CAMPAIGN");
        s.emergency = "verified_paused";
      } catch (err) {
        if (
          !(err instanceof a.ReadError) &&
          !(
            err instanceof S00RunError &&
            errors.includes(err.code as (typeof errors)[number])
          )
        )
          throw err;
        s.emergency = "unverified";
      }
    } else s.emergency = "skipped";
    s.status = "failed";
    s.error = error;
    await save();
  }
  return bReport(s);
}
