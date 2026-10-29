// Explicit continuation of one failed phase-A ledger. Import/default preview are offline.
import { z } from "zod";
import { hash, S00RunError } from "./s00-composio-common";
import {
  instantlyA as a,
  instantlyReport,
  validateInstantlyState,
  type InstantlyState,
  type InstantlyClock,
} from "./s00-instantly-runner";

type Env = Readonly<Record<string, string | undefined>>;
type Obj = Record<string, unknown>;
const fail = (code: string): never => {
  throw new S00RunError(code);
};
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const ops = [
  "workspace",
  "plan",
  "keys",
  "accounts",
  "events",
  "campaigns",
] as const;
type Op = (typeof ops)[number];
const errorCodes = [...a.errors, "OUTREACH_PLAN_UNCONFIRMED"] as const;
const keyReasons = [
  "not_checked",
  "matched",
  "not_found",
  "page_limit",
  "forbidden",
  "scopes_missing",
  "probe_duplicates",
] as const;
const resultsSchema = a.resultsSchema
  .extend({
    keys: a.resultsSchema.shape.keys
      .extend({ reason: z.enum(keyReasons) })
      .strict(),
  })
  .strict();
const diagnosticSchema = z
  .object({
    checked: z.boolean(),
    rows: z.number().int().min(0).max(100),
    duplicateIds: z.number().int().min(0).max(100),
    conflictingIds: z.number().int().min(0).max(100),
    exactMatches: z.number().int().min(0).max(100),
    cursorPresent: z.boolean(),
    reason: z.enum([
      "not_checked",
      "matched",
      "not_found",
      "pagination_unreliable",
      "duplicates",
      "forbidden",
      "scopes_missing",
    ]),
  })
  .strict();
const requestSchema = a.requestSchema
  .extend({ purpose: z.enum(["first", "page", "retry"]) })
  .strict();
const recoverySchema = z
  .object({
    version: z.literal(2),
    provider: z.literal("instantly"),
    phase: z.literal("A"),
    predecessor: z.custom<InstantlyState>(),
    predecessorHash: digest,
    manifestHash: digest,
    status: z.enum(["running", "completed", "failed"]),
    checkpoint: z.number().int().min(0).max(6),
    calls: z.number().int().min(4).max(12),
    normal: z.number().int().min(4).max(10),
    retry: z.number().int().min(0).max(2),
    error: z.enum(errorCodes).nullable(),
    requests: z.array(requestSchema).max(8),
    diagnostic: diagnosticSchema,
    results: resultsSchema,
  })
  .strict();
export type InstantlyRecovery = z.infer<typeof recoverySchema>;
export type InstantlyLedger = InstantlyState | InstantlyRecovery;
export interface InstantlyLedgerStore {
  load(): Promise<InstantlyLedger | undefined>;
  save(state: InstantlyLedger): Promise<void>;
}
const order = (requests: InstantlyState["requests"]) =>
  JSON.stringify(requests) ===
  JSON.stringify([
    { op: "workspace", page: 1, bucket: "N", result: "OK" },
    { op: "plan", page: 1, bucket: "N", result: "OK" },
    { op: "keys", page: 1, bucket: "N", result: "OK" },
    { op: "keys", page: 2, bucket: "N", result: "OK" },
  ]);
export function eligibleInstantlyRecovery(input: unknown): InstantlyState {
  const s = validateInstantlyState(input);
  if (
    s.status !== "failed" ||
    s.error !== "DUPLICATE_RECORD" ||
    s.checkpoint !== 2 ||
    s.calls !== 4 ||
    s.normal !== 4 ||
    s.retry !== 0 ||
    !order(s.requests)
  )
    fail("INSTANTLY_RECOVERY_BASE_REQUIRED");
  return s;
}
function manifest(predecessorHash: string) {
  return hash(
    JSON.stringify({
      version: 2,
      phase: "A",
      recovery: "key_probe_once",
      predecessorHash,
      newNormal: 6,
      reserve: 2,
      total: 12,
      keyPages: 1,
      accountPages: 2,
      campaignPages: 2,
    }),
  );
}
function initial(base: InstantlyState): InstantlyRecovery {
  const predecessor = structuredClone(eligibleInstantlyRecovery(base)),
    predecessorHash = hash(JSON.stringify(predecessor));
  return {
    version: 2,
    provider: "instantly",
    phase: "A",
    predecessor,
    predecessorHash,
    manifestHash: manifest(predecessorHash),
    status: "running",
    checkpoint: 0,
    calls: 4,
    normal: 4,
    retry: 0,
    error: null,
    requests: [],
    diagnostic: {
      checked: false,
      rows: 0,
      duplicateIds: 0,
      conflictingIds: 0,
      exactMatches: 0,
      cursorPresent: false,
      reason: "not_checked",
    },
    results: a.freshResults(),
  };
}
export function validateInstantlyRecovery(input: unknown): InstantlyRecovery {
  const parsed = recoverySchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INSTANTLY_RECOVERY");
  const s = parsed.data,
    invalid = () => fail("INVALID_INSTANTLY_RECOVERY");
  let base: InstantlyState;
  try {
    base = eligibleInstantlyRecovery(s.predecessor);
  } catch {
    return invalid();
  }
  if (
    hash(JSON.stringify(base)) !== s.predecessorHash ||
    s.manifestHash !== manifest(s.predecessorHash) ||
    s.calls !== 4 + s.requests.length ||
    s.normal !== 4 + s.requests.filter((r) => r.bucket === "N").length ||
    s.retry !== s.requests.filter((r) => r.bucket === "R").length ||
    s.calls !== s.normal + s.retry
  )
    return invalid();
  let previous = -1;
  const seen = new Map<string, number>();
  for (const [i, r] of s.requests.entries()) {
    const oi = ops.indexOf(r.op),
      id = r.op + r.page,
      count = seen.get(id) ?? 0,
      prior = s.requests[i - 1];
    if (
      oi < previous ||
      oi > s.checkpoint ||
      r.page > (["accounts", "campaigns"].includes(r.op) ? 2 : 1) ||
      (r.result === "IN_FLIGHT" &&
        (i !== s.requests.length - 1 || s.status !== "running"))
    )
      return invalid();
    if (r.purpose === "retry") {
      if (
        r.bucket !== "R" ||
        count !== 1 ||
        !prior ||
        prior.op !== r.op ||
        prior.page !== r.page ||
        !["NETWORK_OR_TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(prior.result)
      )
        return invalid();
    } else {
      if (
        count ||
        (r.purpose === "first") !== (r.page === 1) ||
        r.bucket !== (r.page === 1 ? "N" : "R")
      )
        return invalid();
      if (
        r.page === 2 &&
        (!prior ||
          prior.op !== r.op ||
          prior.page !== 1 ||
          prior.result !== "OK")
      )
        return invalid();
    }
    seen.set(id, count + 1);
    previous = oi;
  }
  for (let i = 0; i < s.checkpoint; i++) {
    const last = s.requests.filter((r) => r.op === ops[i]).at(-1);
    if (
      !last ||
      (last.result !== "OK" && !(i === 2 && last.result === "HTTP_403"))
    )
      return invalid();
  }
  const r = s.results;
  if (
    r.workspaceMatched !== s.checkpoint >= 1 ||
    r.plan.checked !== s.checkpoint >= 2 ||
    r.keys.checked !== s.checkpoint >= 3 ||
    r.accounts.complete !== s.checkpoint >= 4 ||
    r.events.checked !== s.checkpoint >= 5 ||
    r.campaigns.complete !== s.checkpoint >= 6 ||
    s.diagnostic.checked !== s.checkpoint >= 3
  )
    return invalid();
  if (
    r.keys.identified !== (r.keys.reason === "matched") ||
    r.keys.identified !== (s.diagnostic.reason === "matched") ||
    Object.values(r.keys.scopes).some((v) =>
      r.keys.identified ? v === null : v !== null,
    )
  )
    return invalid();
  if (
    r.accounts.count !==
      r.accounts.status1 +
        r.accounts.otherKnownStatus +
        r.accounts.unknownStatus ||
    r.accounts.dailyLimitsKnown > r.accounts.count
  )
    return invalid();
  const p = r.plan,
    slots =
      p.outreachPresent &&
      p.totalLeadLimit !== null &&
      p.currentLeadCount !== null &&
      p.currentLeadCount <= p.totalLeadLimit
        ? p.totalLeadLimit - p.currentLeadCount
        : null;
  if (
    p.availableContactSlots !== slots ||
    s.diagnostic.conflictingIds > s.diagnostic.duplicateIds ||
    s.diagnostic.duplicateIds > s.diagnostic.rows ||
    s.diagnostic.exactMatches > s.diagnostic.rows
  )
    return invalid();
  if (
    r.keys.identified &&
    (s.diagnostic.exactMatches !== 1 || s.diagnostic.duplicateIds > 0)
  )
    return invalid();
  if (
    (s.status === "completed") !== (s.checkpoint === 6) ||
    (s.status === "failed") !== (s.error !== null)
  )
    return invalid();
  return s;
}
export function validateInstantlyLedger(input: unknown): InstantlyLedger {
  return input &&
    typeof input === "object" &&
    "version" in input &&
    input.version === 2
    ? validateInstantlyRecovery(input)
    : validateInstantlyState(input);
}
export function assertInstantlyRecoveryTransition(
  previous: InstantlyLedger | undefined,
  next: InstantlyRecovery,
) {
  validateInstantlyRecovery(next);
  if (!previous) return fail("INSTANTLY_RECOVERY_BASE_REQUIRED");
  if (previous.version === 1) {
    const base = eligibleInstantlyRecovery(previous);
    if (
      next.predecessorHash !== hash(JSON.stringify(base)) ||
      next.calls !== 4 ||
      next.checkpoint !== 0 ||
      next.requests.length ||
      next.status !== "running"
    )
      fail("INSTANTLY_RECOVERY_HISTORY_IMMUTABLE");
    return;
  }
  const p = validateInstantlyRecovery(previous);
  if (JSON.stringify(p) === JSON.stringify(next)) return;
  if (
    p.status !== "running" ||
    p.predecessorHash !== next.predecessorHash ||
    p.manifestHash !== next.manifestHash ||
    JSON.stringify(p.predecessor) !== JSON.stringify(next.predecessor) ||
    next.calls < p.calls ||
    next.calls > p.calls + 1 ||
    next.checkpoint < p.checkpoint ||
    next.checkpoint > p.checkpoint + 1
  )
    fail("INSTANTLY_RECOVERY_HISTORY_IMMUTABLE");
  for (const [i, r] of p.requests.entries()) {
    const n = next.requests[i];
    if (
      !n ||
      r.op !== n.op ||
      r.page !== n.page ||
      r.bucket !== n.bucket ||
      r.purpose !== n.purpose ||
      (r.result !== "IN_FLIGHT" && r.result !== n.result)
    )
      fail("INSTANTLY_RECOVERY_HISTORY_IMMUTABLE");
  }
  for (const [i, k] of (
    [
      "workspaceMatched",
      "plan",
      "keys",
      "accounts",
      "events",
      "campaigns",
    ] as const
  ).entries())
    if (
      (i < p.checkpoint || next.checkpoint === p.checkpoint) &&
      JSON.stringify(p.results[k]) !== JSON.stringify(next.results[k])
    )
      fail("INSTANTLY_RECOVERY_HISTORY_IMMUTABLE");
  if (
    (p.checkpoint >= 3 || next.checkpoint === p.checkpoint) &&
    JSON.stringify(p.diagnostic) !== JSON.stringify(next.diagnostic)
  )
    fail("INSTANTLY_RECOVERY_HISTORY_IMMUTABLE");
}

// A single page is a diagnostic sample, never a claim that key pagination is repaired.
export function inspectInstantlyKeyProbe(
  body: Obj,
  key: string,
  workspace: string,
) {
  const { rows, next } = a.list(body),
    byId = new Map<string, string>();
  let duplicates = 0,
    conflicts = 0,
    matches = 0,
    scopes: string[] | undefined;
  for (const row of rows) {
    const id = a.parse(a.uuid, row.id);
    a.tenant(row, "organization_id", workspace);
    const parsed = z.array(z.string().max(200)).max(500).safeParse(row.scopes);
    const canonical = hash(
      JSON.stringify([
        row.key ?? null,
        parsed.success ? [...parsed.data].sort() : null,
        row.organization_id,
      ]),
    );
    if (byId.has(id)) {
      duplicates++;
      if (byId.get(id) !== canonical) conflicts++;
    } else byId.set(id, canonical);
    if (row.key === key) {
      matches++;
      scopes = parsed.success ? parsed.data : undefined;
    }
  }
  const matched = duplicates === 0 && matches === 1 && scopes !== undefined;
  const reason =
    duplicates || matches > 1
      ? "duplicates"
      : matched
        ? "matched"
        : matches === 1
          ? "scopes_missing"
          : next
            ? "pagination_unreliable"
            : "not_found";
  return {
    diagnostic: {
      checked: true,
      rows: rows.length,
      duplicateIds: duplicates,
      conflictingIds: conflicts,
      exactMatches: matches,
      cursorPresent: !!next,
      reason,
    } as InstantlyRecovery["diagnostic"],
    keys: {
      checked: true,
      identified: matched,
      reason:
        reason === "duplicates"
          ? "probe_duplicates"
          : reason === "pagination_unreliable"
            ? "page_limit"
            : reason,
      scopes: matched
        ? (Object.fromEntries(
            Object.keys(a.unknownScopes()).map((s) => [s, scopes!.includes(s)]),
          ) as ReturnType<typeof a.unknownScopes>)
        : a.unknownScopes(),
    } as InstantlyRecovery["results"]["keys"],
  };
}
export function instantlyLedgerReport(input?: InstantlyLedger) {
  if (!input || input.version === 1)
    return {
      ...instantlyReport(input),
      ledgerVersion: input?.version ?? null,
      recoveryEligible:
        !!input &&
        (() => {
          try {
            eligibleInstantlyRecovery(input);
            return true;
          } catch {
            return false;
          }
        })(),
      recoveryExecuted: false,
    };
  const s = validateInstantlyRecovery(input),
    r = s.results;
  return {
    provider: "instantly",
    phase: "A",
    ledgerVersion: 2,
    status: s.status,
    calls: s.calls,
    priorCalls: 4,
    newCalls: s.requests.length,
    remainingAuthorized: 12 - s.calls,
    budget: {
      normal: s.normal,
      retry: s.retry,
      maxNormal: 10,
      maxRetry: 2,
      maxTotal: 12,
    },
    checkpoint: s.checkpoint,
    error: s.error,
    interruptedNeedsReview: s.status === "running",
    lastAttemptUncertain: s.requests.at(-1)?.result === "IN_FLIGHT",
    results: structuredClone(r),
    diagnostic: structuredClone(s.diagnostic),
    recoveryEligible: false,
    recoveryExecuted: true,
    historicalPaginationAnomaly: true,
    paginationRootCauseVerified: false,
    blockers: [
      ...(s.status !== "completed" ? ["PHASE_A_NOT_COMPLETE"] : []),
      ...(!r.keys.identified ? ["CURRENT_KEY_SCOPES_UNKNOWN"] : []),
      ...(!r.accounts.complete ? ["ACCOUNTS_NOT_COMPLETE"] : []),
      ...(r.plan.availableContactSlots === null
        ? ["CONTACT_CAPACITY_UNKNOWN"]
        : r.plan.availableContactSlots < 2
          ? ["CONTACT_CAPACITY_BELOW_TWO"]
          : []),
      ...(r.campaigns.exactMatches ? ["TRIAL_NAME_ALREADY_EXISTS"] : []),
      ...(!r.events.replyReceived ||
      !r.events.emailBounced ||
      !r.events.leadUnsubscribed
        ? ["REQUIRED_EVENT_TYPES_NOT_CONFIRMED"]
        : []),
    ],
    writesAuthorized: false,
    sends: 0,
    paidOperations: 0,
    providerBillingMeasured: false,
    phasesBCImplemented: false,
    realResponseAndStoppingVerified: false,
  };
}

export async function recoverInstantlyPagination(
  env: Env,
  store: InstantlyLedgerStore,
  options: {
    execute?: boolean;
    phase?: string;
    authorizedNew?: number;
    authorizedTotal?: number;
    includedCallsConfirmed?: boolean;
    fetchImpl?: typeof fetch;
    clock?: InstantlyClock;
    signal?: AbortSignal;
  } = {},
) {
  if (!options.execute) return instantlyLedgerReport(await store.load());
  if (
    options.phase !== "A" ||
    options.authorizedNew !== 8 ||
    options.authorizedTotal !== 12 ||
    options.includedCallsConfirmed !== true
  )
    fail("INSTANTLY_RECOVERY_AUTHORIZATION_REQUIRED");
  const config = a.configuration(env),
    prior = await store.load();
  if (!prior) fail("INSTANTLY_RECOVERY_BASE_REQUIRED");
  const ledger = validateInstantlyLedger(prior),
    binding =
      ledger.version === 1
        ? ledger.fingerprint
        : ledger.predecessor.fingerprint;
  if (binding !== config.fingerprint) fail("INSTANTLY_BINDING_CHANGED");
  if (ledger.version === 2) return instantlyLedgerReport(ledger); // Terminal/interrupted versions never restart.
  const s = initial(eligibleInstantlyRecovery(ledger)),
    clock = options.clock ?? a.realClock,
    fetchImpl = options.fetchImpl ?? fetch;
  const save = async () => {
    validateInstantlyRecovery(s);
    await store.save(structuredClone(s));
  };
  await save();
  let lastStart: number | undefined;
  async function wait(ms: number) {
    if (options.signal?.aborted) fail("CANCELLED");
    try {
      if (ms > 0) await clock.sleep(ms, options.signal);
    } catch {
      fail("CANCELLED");
    }
    if (options.signal?.aborted) fail("CANCELLED");
  }
  async function read(op: Op, page = 1, cursor = "") {
    for (let attempt = 0; attempt < 2; attempt++) {
      await wait(
        lastStart === undefined
          ? 0
          : Math.max(0, 1000 - (clock.now() - lastStart)),
      );
      const reserve = attempt > 0 || page > 1;
      if (s.calls >= 12 || (reserve ? s.retry >= 2 : s.normal >= 10))
        fail("BUDGET_EXHAUSTED");
      const row: InstantlyRecovery["requests"][number] = {
        op,
        page,
        bucket: reserve ? "R" : "N",
        purpose: attempt ? "retry" : page > 1 ? "page" : "first",
        result: "IN_FLIGHT",
      };
      s.requests.push(row);
      s.calls++;
      if (reserve) s.retry++;
      else s.normal++;
      await save();
      lastStart = clock.now();
      let response: Obj | undefined,
        failure: InstanceType<typeof a.ReadError> | undefined;
      try {
        response = await a.read(
          fetchImpl,
          config.key,
          s.predecessor.nonce,
          op,
          cursor,
          options.signal,
        );
        row.result = "OK";
      } catch (e) {
        failure =
          e instanceof a.ReadError ? e : new a.ReadError("INVALID_RESPONSE");
        row.result = failure.code;
      }
      await save();
      if (!failure) return response!;
      if (
        !["NETWORK_OR_TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(failure.code)
      )
        throw failure;
      if (attempt || s.retry >= 2) fail("RETRY_LIMIT");
      const backoff = Math.max(5000, failure.wait);
      if (backoff > 60000) fail("RETRY_WAIT_TOO_LONG");
      await wait(backoff);
    }
    return fail("RETRY_LIMIT");
  }
  async function pages(
    op: "accounts" | "campaigns",
    visit: (row: Obj) => void,
  ) {
    let cursor = "";
    const seen = new Set<string>();
    for (let page = 1; page <= 2; page++) {
      const body = a.list(await read(op, page, cursor));
      for (const row of body.rows) visit(row);
      if (body.next && (seen.has(body.next) || body.next === cursor))
        fail("CURSOR_REPEATED");
      if (!body.next) return;
      seen.add(body.next);
      cursor = body.next;
    }
    fail("PAGINATION_LIMIT");
  }
  async function checkpoint() {
    s.checkpoint++;
    if (s.checkpoint === 6) s.status = "completed";
    await save();
  }
  try {
    const workspace = await read("workspace");
    if (workspace.id !== config.workspace) fail("WORKSPACE_MISMATCH");
    s.results.workspaceMatched = true;
    await checkpoint();
    const plan = a.planSummary(await read("plan"), config.workspace);
    if (!plan.outreachPresent) fail("OUTREACH_PLAN_UNCONFIRMED");
    s.results.plan = plan;
    await checkpoint();
    try {
      const probe = inspectInstantlyKeyProbe(
        await read("keys"),
        config.key,
        config.workspace,
      );
      s.results.keys = probe.keys;
      s.diagnostic = probe.diagnostic;
    } catch (e) {
      if (!(e instanceof a.ReadError) || e.code !== "HTTP_403") throw e;
      s.results.keys = {
        checked: true,
        identified: false,
        reason: "forbidden",
        scopes: a.unknownScopes(),
      };
      s.diagnostic = { ...s.diagnostic, checked: true, reason: "forbidden" };
    }
    await checkpoint();
    const accounts = a.accountCollector(config.workspace);
    await pages("accounts", accounts.visit);
    accounts.summary.complete = true;
    s.results.accounts = accounts.summary;
    await checkpoint();
    s.results.events = a.eventSummary(await read("events"));
    await checkpoint();
    const campaigns = a.campaignCollector(
      config.workspace,
      s.predecessor.nonce,
    );
    await pages("campaigns", campaigns.visit);
    campaigns.summary.complete = true;
    s.results.campaigns = campaigns.summary;
    await checkpoint();
  } catch (e) {
    if (!(e instanceof a.ReadError) && !(e instanceof S00RunError))
      throw new S00RunError("INSTANTLY_STORAGE_OR_INTERNAL_FAILURE");
    if (!errorCodes.includes(e.code as (typeof errorCodes)[number]))
      throw new S00RunError("INSTANTLY_STORAGE_OR_INTERNAL_FAILURE");
    s.error = e.code as (typeof errorCodes)[number];
    s.status = "failed";
    await save();
  }
  return instantlyLedgerReport(s);
}
