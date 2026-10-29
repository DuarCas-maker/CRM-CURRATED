// Isolated phase A. Imports do not load credentials, create files or call APIs.
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { hash, S00RunError, retryAfterDelay } from "./s00-composio-common";

type Env = Readonly<Record<string, string | undefined>>;
type Obj = Record<string, unknown>;
const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nullableInteger = integer.nullable();
const operations = [
  "workspace",
  "plan",
  "keys",
  "accounts",
  "events",
  "campaigns",
] as const;
type Operation = (typeof operations)[number];
const pageCaps: Record<Operation, number> = {
  workspace: 1,
  plan: 1,
  keys: 3,
  accounts: 2,
  events: 1,
  campaigns: 2,
};
export const instantlyScopeNames = [
  "all:all",
  "all:read",
  "all:create",
  "all:update",
  "all:delete",
  "campaigns:all",
  "campaigns:read",
  "campaigns:create",
  "campaigns:update",
  "leads:all",
  "leads:read",
  "leads:create",
  "leads:update",
  "webhooks:all",
  "webhooks:read",
  "webhooks:create",
  "webhooks:delete",
  "webhook_events:all",
  "webhook_events:read",
  "accounts:all",
  "accounts:read",
  "api_keys:all",
  "api_keys:read",
  "workspace_billing:all",
  "workspace_billing:read",
  "workspaces:all",
  "workspaces:read",
] as const;
const codes = [
  "IN_FLIGHT",
  "OK",
  "NETWORK_OR_TIMEOUT",
  "CANCELLED",
  "INVALID_RESPONSE",
  "RESPONSE_LIMIT",
  "BLOCKED_REDIRECT",
  "HTTP_401",
  "HTTP_402",
  "HTTP_403",
  "HTTP_429",
  "HTTP_5XX",
  "HTTP_OTHER",
] as const;
type ResultCode = (typeof codes)[number];
const errors = [
  ...codes.filter((c) => c !== "OK" && c !== "IN_FLIGHT"),
  "WORKSPACE_MISMATCH",
  "INVALID_SCHEMA",
  "PAGINATION_LIMIT",
  "CURSOR_REPEATED",
  "DUPLICATE_RECORD",
  "RETRY_LIMIT",
  "RETRY_WAIT_TOO_LONG",
  "BUDGET_EXHAUSTED",
] as const;
const scopesSchema = z
  .object(
    Object.fromEntries(
      instantlyScopeNames.map((n) => [n, z.boolean().nullable()]),
    ) as Record<
      (typeof instantlyScopeNames)[number],
      z.ZodNullable<z.ZodBoolean>
    >,
  )
  .strict();
const resultsSchema = z
  .object({
    workspaceMatched: z.boolean(),
    plan: z
      .object({
        checked: z.boolean(),
        outreachPresent: z.boolean(),
        totalLeadLimit: nullableInteger,
        currentLeadCount: nullableInteger,
        baseLeadLimit: nullableInteger,
        availableContactSlots: nullableInteger,
      })
      .strict(),
    keys: z
      .object({
        checked: z.boolean(),
        identified: z.boolean(),
        reason: z.enum([
          "not_checked",
          "matched",
          "not_found",
          "page_limit",
          "forbidden",
          "scopes_missing",
        ]),
        scopes: scopesSchema,
      })
      .strict(),
    accounts: z
      .object({
        complete: z.boolean(),
        count: integer.max(200),
        status1: integer.max(200),
        otherKnownStatus: integer.max(200),
        unknownStatus: integer.max(200),
        dailyLimitsKnown: integer.max(200),
        configuredDailyLimitSum: integer,
      })
      .strict(),
    events: z
      .object({
        checked: z.boolean(),
        replyReceived: z.boolean(),
        emailBounced: z.boolean(),
        leadUnsubscribed: z.boolean(),
      })
      .strict(),
    campaigns: z
      .object({ complete: z.boolean(), exactMatches: integer.max(200) })
      .strict(),
  })
  .strict();
const requestSchema = z
  .object({
    op: z.enum(operations),
    page: z.number().int().min(1).max(3),
    bucket: z.enum(["N", "R"]),
    result: z.enum(codes),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    provider: z.literal("instantly"),
    phase: z.literal("A"),
    status: z.enum(["running", "completed", "failed"]),
    nonce: z.string().regex(/^[a-f0-9]{24}$/),
    fingerprint: digest,
    manifestHash: digest,
    normal: integer.max(10),
    retry: integer.max(2),
    calls: integer.max(12),
    checkpoint: integer.max(6),
    requests: z.array(requestSchema).max(12),
    error: z.enum(errors).nullable(),
    results: resultsSchema,
  })
  .strict();
export type InstantlyState = z.infer<typeof stateSchema>;
export interface InstantlyStore {
  load(): Promise<InstantlyState | undefined>;
  save(state: InstantlyState): Promise<void>;
}
export interface InstantlyClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
const realClock: InstantlyClock = {
  now: () => performance.now(),
  sleep: async (ms, signal) => {
    await delay(ms, undefined, { signal });
  },
};
const unknownScopes = () =>
  Object.fromEntries(
    instantlyScopeNames.map((s) => [s, null]),
  ) as InstantlyState["results"]["keys"]["scopes"];
const fail = (code: string): never => {
  throw new S00RunError(code);
};
const object = (value: unknown): Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : fail("INVALID_SCHEMA");
const safeString = (value: unknown, max = 4096): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\x00-\x1f\x7f]/.test(value);
const safeKey = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,8192}$/.test(value);
const parse = <T>(schema: z.ZodType<T>, data: unknown): T => {
  const r = schema.safeParse(data);
  return r.success ? r.data : fail("INVALID_SCHEMA");
};

export function inspectInstantlyConfiguration(env: Env) {
  const key = env.INSTANTLY_API_KEY ?? "",
    workspace = env.INSTANTLY_WORKSPACE_ID ?? "";
  return {
    keyPresent: key.length > 0,
    keyHeaderSafe: safeKey(key),
    workspacePresent: workspace.length > 0,
    workspaceUuidValid: uuid.safeParse(workspace).success,
    remotelyVerified: false,
  };
}
function configuration(env: Env) {
  const check = inspectInstantlyConfiguration(env);
  if (!check.keyHeaderSafe || !check.workspaceUuidValid)
    return fail("INVALID_CONFIGURATION");
  const key = env.INSTANTLY_API_KEY!,
    workspace = env.INSTANTLY_WORKSPACE_ID!;
  return {
    key,
    workspace,
    fingerprint: hash(JSON.stringify(["instantly/A/v1", hash(key), workspace])),
  };
}
function manifest(nonce: string, fingerprint: string) {
  return hash(
    JSON.stringify({
      version: 1,
      phase: "A",
      nonce,
      fingerprint,
      caps: pageCaps,
      normal: 10,
      retry: 2,
      total: 12,
    }),
  );
}
function initial(fingerprint: string): InstantlyState {
  const nonce = randomBytes(12).toString("hex");
  return {
    version: 1,
    provider: "instantly",
    phase: "A",
    status: "running",
    nonce,
    fingerprint,
    manifestHash: manifest(nonce, fingerprint),
    normal: 0,
    retry: 0,
    calls: 0,
    checkpoint: 0,
    requests: [],
    error: null,
    results: {
      workspaceMatched: false,
      plan: {
        checked: false,
        outreachPresent: false,
        totalLeadLimit: null,
        currentLeadCount: null,
        baseLeadLimit: null,
        availableContactSlots: null,
      },
      keys: {
        checked: false,
        identified: false,
        reason: "not_checked",
        scopes: unknownScopes(),
      },
      accounts: {
        complete: false,
        count: 0,
        status1: 0,
        otherKnownStatus: 0,
        unknownStatus: 0,
        dailyLimitsKnown: 0,
        configuredDailyLimitSum: 0,
      },
      events: {
        checked: false,
        replyReceived: false,
        emailBounced: false,
        leadUnsubscribed: false,
      },
      campaigns: { complete: false, exactMatches: 0 },
    },
  };
}

export function validateInstantlyState(input: unknown): InstantlyState {
  let s: InstantlyState;
  try {
    s = parse(stateSchema, input);
  } catch {
    return fail("INVALID_INSTANTLY_JOURNAL");
  }
  const invalid = () => fail("INVALID_INSTANTLY_JOURNAL");
  if (
    s.manifestHash !== manifest(s.nonce, s.fingerprint) ||
    s.calls !== s.requests.length ||
    s.normal + s.retry !== s.calls ||
    s.normal !== s.requests.filter((r) => r.bucket === "N").length ||
    s.retry !== s.requests.filter((r) => r.bucket === "R").length
  )
    return invalid();
  const seen = new Map<string, number>();
  let previousOp = -1;
  for (const [i, r] of s.requests.entries()) {
    const oi = operations.indexOf(r.op),
      id = r.op + r.page,
      count = seen.get(id) ?? 0;
    if (
      oi < previousOp ||
      oi > s.checkpoint ||
      r.page > pageCaps[r.op] ||
      (r.result === "IN_FLIGHT" &&
        (i !== s.requests.length - 1 || s.status !== "running"))
    )
      return invalid();
    if (r.bucket === "N") {
      const previousPages = [...seen.keys()].filter((k) =>
        k.startsWith(r.op),
      ).length;
      if (count || r.page !== previousPages + 1) return invalid();
    } else {
      const prev = s.requests[i - 1];
      if (
        count !== 1 ||
        !prev ||
        prev.op !== r.op ||
        prev.page !== r.page ||
        !["NETWORK_OR_TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(prev.result)
      )
        return invalid();
    }
    seen.set(id, count + 1);
    previousOp = oi;
  }
  for (let i = 0; i < s.checkpoint; i++) {
    const rows = s.requests.filter((r) => r.op === operations[i]);
    const last = rows.at(-1);
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
    r.campaigns.complete !== s.checkpoint >= 6
  )
    return invalid();
  if (
    r.keys.identified !== (r.keys.reason === "matched") ||
    (!r.keys.identified &&
      Object.values(r.keys.scopes).some((v) => v !== null)) ||
    (r.keys.identified && Object.values(r.keys.scopes).some((v) => v === null))
  )
    return invalid();
  if (
    r.accounts.status1 +
      r.accounts.otherKnownStatus +
      r.accounts.unknownStatus !==
      r.accounts.count ||
    r.accounts.dailyLimitsKnown > r.accounts.count
  )
    return invalid();
  const p = r.plan;
  const remaining =
    p.outreachPresent &&
    p.totalLeadLimit !== null &&
    p.currentLeadCount !== null &&
    p.currentLeadCount <= p.totalLeadLimit
      ? p.totalLeadLimit - p.currentLeadCount
      : null;
  if (p.availableContactSlots !== remaining) return invalid();
  if (
    (s.status === "completed") !== (s.checkpoint === 6) ||
    (s.status === "failed") !== (s.error !== null)
  )
    return invalid();
  return s;
}

// Reject rewriting history even if a caller holds the exclusive filesystem lock.
export function assertInstantlyTransition(
  previous: InstantlyState | undefined,
  next: InstantlyState,
) {
  validateInstantlyState(next);
  if (!previous) {
    if (next.calls !== 0 || next.checkpoint !== 0 || next.status !== "running")
      fail("INSTANTLY_HISTORY_IMMUTABLE");
    return;
  }
  validateInstantlyState(previous);
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  if (
    previous.status !== "running" ||
    previous.nonce !== next.nonce ||
    previous.fingerprint !== next.fingerprint ||
    previous.manifestHash !== next.manifestHash ||
    next.calls < previous.calls ||
    next.calls > previous.calls + 1 ||
    next.checkpoint < previous.checkpoint ||
    next.checkpoint > previous.checkpoint + 1
  )
    fail("INSTANTLY_HISTORY_IMMUTABLE");
  for (const [i, r] of previous.requests.entries()) {
    const n = next.requests[i];
    if (
      !n ||
      r.op !== n.op ||
      r.page !== n.page ||
      r.bucket !== n.bucket ||
      (r.result !== "IN_FLIGHT" && r.result !== n.result)
    )
      fail("INSTANTLY_HISTORY_IMMUTABLE");
  }
  // Completed result sections are immutable. Pending section changes only with its checkpoint.
  const keys = [
    "workspaceMatched",
    "plan",
    "keys",
    "accounts",
    "events",
    "campaigns",
  ] as const;
  for (const [i, key] of keys.entries()) {
    if (
      (i < previous.checkpoint || next.checkpoint === previous.checkpoint) &&
      JSON.stringify(previous.results[key]) !==
        JSON.stringify(next.results[key])
    )
      fail("INSTANTLY_HISTORY_IMMUTABLE");
  }
}

const paths: Record<Operation, string> = {
  workspace: "workspaces/current",
  plan: "workspace-billing/plan-details",
  keys: "api-keys",
  accounts: "accounts",
  events: "webhooks/event-types",
  campaigns: "campaigns",
};
const root = "https://api.instantly.ai/api/v2/";
export function instantlyPhaseAUrlAllowed(
  raw: string,
  method: string,
  nonce: string,
) {
  try {
    const u = new URL(raw);
    if (
      method !== "GET" ||
      !/^[a-f0-9]{24}$/.test(nonce) ||
      u.origin !== "https://api.instantly.ai" ||
      u.username ||
      u.password ||
      u.hash ||
      !Object.values(paths).some((p) => root + p === raw.split("?")[0])
    )
      return false;
    const path = u.pathname.slice("/api/v2/".length),
      paged = ["api-keys", "accounts", "campaigns"].includes(path);
    if (!paged) return !u.search;
    const keys = [...u.searchParams.keys()];
    if (
      new Set(keys).size !== keys.length ||
      keys.some(
        (k) =>
          ![
            "limit",
            "starting_after",
            ...(path === "campaigns" ? ["search"] : []),
          ].includes(k),
      ) ||
      u.searchParams.get("limit") !== "100"
    )
      return false;
    if (
      path === "campaigns" &&
      u.searchParams.get("search") !== "S00-INSTANTLY-" + nonce
    )
      return false;
    return (
      !u.searchParams.has("starting_after") ||
      safeString(u.searchParams.get("starting_after"))
    );
  } catch {
    return false;
  }
}
function requestUrl(op: Operation, nonce: string, cursor: string) {
  const u = new URL(root + paths[op]);
  if (["keys", "accounts", "campaigns"].includes(op)) {
    u.searchParams.set("limit", "100");
    if (op === "campaigns")
      u.searchParams.set("search", "S00-INSTANTLY-" + nonce);
    if (cursor) u.searchParams.set("starting_after", cursor);
  }
  if (!instantlyPhaseAUrlAllowed(u.href, "GET", nonce))
    return fail("BLOCKED_ROUTE");
  return u.href;
}
class ReadError extends Error {
  constructor(
    public code: Exclude<ResultCode, "OK" | "IN_FLIGHT">,
    public wait = 0,
  ) {
    super(code);
  }
}
async function boundedJson(
  fetchImpl: typeof fetch,
  url: string,
  key: string,
  signal?: AbortSignal,
  request: { method: "GET" | "POST" | "PATCH"; body?: Obj } = { method: "GET" },
) {
  let response: Response | undefined;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 8000);
  const combined = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  // Also bound non-cooperative injected transports/streams. Production fetch gets the same signal.
  let abort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    abort = () =>
      reject(
        new ReadError(signal?.aborted ? "CANCELLED" : "NETWORK_OR_TIMEOUT"),
      );
    if (combined.aborted) abort();
    else combined.addEventListener("abort", abort, { once: true });
  });
  try {
    const pending = Promise.resolve().then(() =>
      fetchImpl(url, {
        method: request.method,
        headers: {
          Authorization: "Bearer " + key,
          Accept: "application/json",
          ...(request.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        redirect: "manual",
        signal: combined,
      }),
    );
    void pending.then(
      (r) => {
        if (combined.aborted) void r.body?.cancel().catch(() => undefined);
      },
      () => undefined,
    );
    try {
      response = await Promise.race([pending, aborted]);
    } catch (e) {
      throw e instanceof ReadError
        ? e
        : new ReadError(signal?.aborted ? "CANCELLED" : "NETWORK_OR_TIMEOUT");
    }
    if (combined.aborted)
      throw new ReadError(signal?.aborted ? "CANCELLED" : "NETWORK_OR_TIMEOUT");
    if (response.status !== 200) {
      const status = response.status;
      const code =
        status >= 300 && status < 400
          ? "BLOCKED_REDIRECT"
          : status === 401
            ? "HTTP_401"
            : status === 402
              ? "HTTP_402"
              : status === 403
                ? "HTTP_403"
                : status === 429
                  ? "HTTP_429"
                  : status >= 500 && status <= 599
                    ? "HTTP_5XX"
                    : "HTTP_OTHER";
      throw new ReadError(
        code,
        retryAfterDelay(
          response.headers.get("retry-after") ?? "",
          response.headers.get("date") ?? "",
        ),
      );
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    )
      throw new ReadError("INVALID_RESPONSE");
    const length = response.headers.get("content-length");
    if (length && /^\d+$/.test(length) && Number(length) > 2 * 1024 * 1024)
      throw new ReadError("RESPONSE_LIMIT");
    const reader = response.body?.getReader();
    if (!reader) throw new ReadError("INVALID_RESPONSE");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new ReadError("RESPONSE_LIMIT");
        chunks.push(part.value);
      }
    } catch (e) {
      throw e instanceof ReadError
        ? e
        : new ReadError(signal?.aborted ? "CANCELLED" : "NETWORK_OR_TIMEOUT");
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    try {
      return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw new ReadError("INVALID_RESPONSE");
    }
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", abort);
    void response?.body?.cancel().catch(() => undefined);
  }
}

// Separate transport entry point for B; A's public allowlist stays GET-only.
export async function instantlyTrialJson(
  fetchImpl: typeof fetch,
  key: string,
  url: string,
  method: "GET" | "POST" | "PATCH",
  body?: Obj,
  signal?: AbortSignal,
) {
  if (!["GET", "POST", "PATCH"].includes(method)) return fail("BLOCKED_ROUTE");
  const u = new URL(url),
    p = u.pathname;
  const id = "[0-9a-fA-F-]{36}";
  const allowed =
    method === "GET"
      ? /^\/api\/v2\/(?:workspaces\/current|workspace-billing\/plan-details|campaigns)$/.test(
          p,
        ) || new RegExp(`^/api/v2/(?:campaigns|leads)/${id}$`).test(p)
      : method === "POST"
        ? /^\/api\/v2\/(?:campaigns|leads|leads\/list)$/.test(p) ||
          new RegExp(`^/api/v2/campaigns/${id}/pause$`).test(p)
        : new RegExp(`^/api/v2/(?:campaigns|leads)/${id}$`).test(p);
  if (
    u.origin !== "https://api.instantly.ai" ||
    u.username ||
    u.password ||
    u.hash ||
    !allowed ||
    url.split("?")[0] !== u.origin + p
  )
    return fail("BLOCKED_ROUTE");
  if ((method !== "GET" && u.search) || (method === "GET" && body))
    return fail("BLOCKED_ROUTE");
  if (method === "GET" && p === "/api/v2/campaigns") {
    const keys = [...u.searchParams.keys()];
    if (
      new Set(keys).size !== keys.length ||
      keys.some((k) => !["limit", "search", "starting_after"].includes(k)) ||
      u.searchParams.get("limit") !== "100" ||
      !/^S00-INSTANTLY-[a-f0-9]{24}$/.test(
        u.searchParams.get("search") ?? "",
      ) ||
      (u.searchParams.has("starting_after") &&
        !safeString(u.searchParams.get("starting_after")))
    )
      return fail("BLOCKED_ROUTE");
  } else if (u.search) return fail("BLOCKED_ROUTE");
  return boundedJson(fetchImpl, url, key, signal, { method, body });
}

function list(body: Obj) {
  const rows = parse(
    z.array(z.record(z.string(), z.unknown())).max(100),
    body.items,
  );
  const raw = body.next_starting_after;
  if (raw !== undefined && raw !== null && raw !== "" && !safeString(raw))
    fail("INVALID_SCHEMA");
  return { rows, next: typeof raw === "string" ? raw : "" };
}
function tenant(row: Obj, field: string, workspace: string) {
  if (row[field] !== workspace) fail("WORKSPACE_MISMATCH");
}
const optionalInteger = (value: unknown) =>
  value === undefined || value === null ? null : parse(integer, value);

// Pure transformations shared with the explicit pagination recovery. No HTTP here.
function planSummary(
  body: Obj,
  workspace: string,
): InstantlyState["results"]["plan"] {
  tenant(body, "organization_id", workspace);
  const subscriptions = object(body.subscriptions);
  const outreach =
    subscriptions.outreach == null ? null : object(subscriptions.outreach);
  const total = optionalInteger(outreach?.total_lead_limit),
    current = optionalInteger(outreach?.current_lead_count);
  return {
    checked: true,
    outreachPresent: !!outreach,
    totalLeadLimit: total,
    currentLeadCount: current,
    baseLeadLimit: optionalInteger(outreach?.base_lead_limit),
    availableContactSlots:
      outreach && total !== null && current !== null && current <= total
        ? total - current
        : null,
  };
}
function accountCollector(workspace: string) {
  const summary: InstantlyState["results"]["accounts"] = {
    complete: false,
    count: 0,
    status1: 0,
    otherKnownStatus: 0,
    unknownStatus: 0,
    dailyLimitsKnown: 0,
    configuredDailyLimitSum: 0,
  };
  const seen = new Set<string>();
  return {
    summary,
    visit(row: Obj) {
      tenant(row, "organization", workspace);
      const address = parse(
        z.string().email().max(320),
        row.email,
      ).toLowerCase();
      if (seen.has(address)) fail("DUPLICATE_RECORD");
      seen.add(address);
      summary.count++;
      if (row.status === 1) summary.status1++;
      else if (
        typeof row.status === "number" &&
        [2, 3, -1, -2, -3].includes(row.status)
      )
        summary.otherKnownStatus++;
      else summary.unknownStatus++;
      const limit = optionalInteger(row.daily_limit);
      if (limit !== null) {
        summary.dailyLimitsKnown++;
        summary.configuredDailyLimitSum += limit;
      }
    },
  };
}
function eventSummary(body: Obj): InstantlyState["results"]["events"] {
  const events = parse(
    z.array(z.object({ id: z.string().min(1).max(200) })).max(500),
    body.event_types,
  );
  const ids = new Set(events.map((e) => e.id));
  if (ids.size !== events.length) fail("DUPLICATE_RECORD");
  return {
    checked: true,
    replyReceived: ids.has("reply_received"),
    emailBounced: ids.has("email_bounced"),
    leadUnsubscribed: ids.has("lead_unsubscribed"),
  };
}
function campaignCollector(workspace: string, nonce: string) {
  const summary = { complete: false, exactMatches: 0 };
  const seen = new Set<string>();
  return {
    summary,
    visit(row: Obj) {
      tenant(row, "organization", workspace);
      const id = parse(uuid, row.id);
      if (seen.has(id)) fail("DUPLICATE_RECORD");
      seen.add(id);
      if (!safeString(row.name, 1000)) fail("INVALID_SCHEMA");
      if (row.name === "S00-INSTANTLY-" + nonce) summary.exactMatches++;
    },
  };
}

// Internal contract for phase-A ledger versions; never accepts an arbitrary URL or method.
export const instantlyA = {
  configuration,
  resultsSchema,
  requestSchema,
  codes,
  errors,
  realClock,
  ReadError,
  list,
  tenant,
  parse,
  uuid,
  unknownScopes,
  planSummary,
  accountCollector,
  eventSummary,
  campaignCollector,
  freshResults: () => initial("0".repeat(64)).results,
  read: (
    fetchImpl: typeof fetch,
    key: string,
    nonce: string,
    op: Operation,
    cursor = "",
    signal?: AbortSignal,
  ) => boundedJson(fetchImpl, requestUrl(op, nonce, cursor), key, signal),
};

export function instantlyReport(state?: InstantlyState) {
  const s = state ? validateInstantlyState(state) : undefined;
  const r = s?.results;
  return {
    provider: "instantly",
    phase: "A",
    status: s?.status ?? "not_started",
    calls: s?.calls ?? 0,
    budget: {
      normal: s?.normal ?? 0,
      retry: s?.retry ?? 0,
      maxNormal: 10,
      maxRetry: 2,
      maxTotal: 12,
    },
    checkpoint: s?.checkpoint ?? 0,
    error: s?.error ?? null,
    interruptedNeedsReview: !!s && s.status === "running",
    lastAttemptUncertain: s?.requests.at(-1)?.result === "IN_FLIGHT",
    results: r ? structuredClone(r) : null,
    blockers: !s
      ? ["NOT_RUN"]
      : [
          ...(s.status !== "completed" ? ["PHASE_A_NOT_COMPLETE"] : []),
          ...(!r!.keys.identified ? ["CURRENT_KEY_SCOPES_UNKNOWN"] : []),
          ...(!r!.accounts.complete ? ["ACCOUNTS_NOT_COMPLETE"] : []),
          ...(r!.plan.availableContactSlots === null
            ? ["CONTACT_CAPACITY_UNKNOWN"]
            : r!.plan.availableContactSlots < 2
              ? ["CONTACT_CAPACITY_BELOW_TWO"]
              : []),
          ...(r!.campaigns.exactMatches > 0
            ? ["TRIAL_NAME_ALREADY_EXISTS"]
            : []),
          ...(!r!.events.checked ||
          !r!.events.replyReceived ||
          !r!.events.emailBounced ||
          !r!.events.leadUnsubscribed
            ? ["REQUIRED_EVENT_TYPES_NOT_CONFIRMED"]
            : []),
        ],
    writesAuthorized: false,
    phasesBCImplemented: false,
    sends: 0,
    paidOperations: 0,
    providerBillingMeasured: false,
    realResponseAndStoppingVerified: false,
  };
}

export async function runInstantlyPhaseA(
  env: Env,
  store: InstantlyStore,
  options: {
    execute?: boolean;
    phase?: string;
    authorizedNew?: number;
    includedCallsConfirmed?: boolean;
    fetchImpl?: typeof fetch;
    clock?: InstantlyClock;
    signal?: AbortSignal;
  } = {},
) {
  if (!options.execute) return instantlyReport(await store.load());
  if (
    options.phase !== "A" ||
    options.authorizedNew !== 12 ||
    options.includedCallsConfirmed !== true
  )
    fail("INSTANTLY_A_AUTHORIZATION_REQUIRED");
  const config = configuration(env),
    previous = await store.load();
  if (previous) {
    const s = validateInstantlyState(previous);
    if (s.fingerprint !== config.fingerprint) fail("INSTANTLY_BINDING_CHANGED");
    return instantlyReport(s); // No automatic retry/resume/reset of an existing run.
  }
  const state = initial(config.fingerprint),
    clock = options.clock ?? realClock,
    fetchImpl = options.fetchImpl ?? fetch;
  const persist = async () => {
    validateInstantlyState(state);
    await store.save(structuredClone(state));
  };
  await persist();
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
  async function read(op: Operation, page = 1, cursor = "") {
    const url = requestUrl(op, state.nonce, cursor);
    for (let attempt = 0; attempt < 2; attempt++) {
      await wait(
        lastStart === undefined
          ? 0
          : Math.max(0, 1000 - (clock.now() - lastStart)),
      );
      if (
        state.calls >= 12 ||
        (attempt === 0 ? state.normal >= 10 : state.retry >= 2)
      )
        fail("BUDGET_EXHAUSTED");
      const request: InstantlyState["requests"][number] = {
        op,
        page,
        bucket: attempt ? "R" : "N",
        result: "IN_FLIGHT",
      };
      state.requests.push(request);
      state.calls++;
      if (attempt) state.retry++;
      else state.normal++;
      await persist(); // Never HTTP if reservation cannot be durably written.
      lastStart = clock.now();
      let body: Obj | undefined, failure: ReadError | undefined;
      try {
        body = await boundedJson(fetchImpl, url, config.key, options.signal);
        request.result = "OK";
      } catch (e) {
        failure =
          e instanceof ReadError ? e : new ReadError("INVALID_RESPONSE");
        request.result = failure.code;
      }
      await persist(); // A save failure is never treated as a retryable HTTP failure.
      if (!failure) return body!;
      const transient = ["NETWORK_OR_TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(
        failure.code,
      );
      if (!transient) throw failure;
      if (attempt || state.retry >= 2) fail("RETRY_LIMIT");
      const backoff = Math.max(5000, failure.wait);
      if (backoff > 60_000) fail("RETRY_WAIT_TOO_LONG");
      await wait(backoff);
    }
    return fail("RETRY_LIMIT");
  }
  async function pages(
    op: "keys" | "accounts" | "campaigns",
    visit: (row: Obj) => void,
    stop: () => boolean = () => false,
  ) {
    let cursor = "";
    const seenCursors = new Set<string>();
    for (let page = 1; page <= pageCaps[op]; page++) {
      const data = list(await read(op, page, cursor));
      for (const row of data.rows) visit(row);
      if (data.next && (seenCursors.has(data.next) || data.next === cursor))
        fail("CURSOR_REPEATED");
      if (stop()) return true;
      if (!data.next) return true;
      seenCursors.add(data.next);
      cursor = data.next;
    }
    return false;
  }
  async function checkpoint() {
    state.checkpoint++;
    if (state.checkpoint === 6) state.status = "completed";
    await persist();
  }
  try {
    const workspace = await read("workspace");
    if (workspace.id !== config.workspace) fail("WORKSPACE_MISMATCH");
    state.results.workspaceMatched = true;
    await checkpoint();

    const plan = await read("plan");
    state.results.plan = planSummary(plan, config.workspace);
    await checkpoint();

    let identified = false,
      missingScopes = false,
      keyComplete = false;
    let currentScopes = unknownScopes();
    const keyIds = new Set<string>();
    try {
      keyComplete = await pages(
        "keys",
        (row) => {
          const id = parse(uuid, row.id);
          if (keyIds.has(id)) fail("DUPLICATE_RECORD");
          keyIds.add(id);
          tenant(row, "organization_id", config.workspace);
          if (row.key !== config.key) return;
          if (identified || missingScopes) fail("DUPLICATE_RECORD");
          const parsed = z
            .array(z.string().max(200))
            .max(500)
            .safeParse(row.scopes);
          if (!parsed.success) {
            missingScopes = true;
            return;
          }
          identified = true;
          currentScopes = Object.fromEntries(
            instantlyScopeNames.map((s) => [s, parsed.data.includes(s)]),
          ) as typeof currentScopes;
        },
        () => identified || missingScopes,
      );
      state.results.keys = {
        checked: true,
        identified,
        reason: identified
          ? "matched"
          : missingScopes
            ? "scopes_missing"
            : keyComplete
              ? "not_found"
              : "page_limit",
        scopes: currentScopes,
      };
    } catch (e) {
      if (!(e instanceof ReadError) || e.code !== "HTTP_403") throw e;
      state.results.keys = {
        checked: true,
        identified: false,
        reason: "forbidden",
        scopes: unknownScopes(),
      };
    }
    await checkpoint();

    const accountSample = accountCollector(config.workspace);
    const accountsComplete = await pages("accounts", accountSample.visit);
    if (!accountsComplete) fail("PAGINATION_LIMIT");
    accountSample.summary.complete = true;
    state.results.accounts = accountSample.summary;
    await checkpoint();

    state.results.events = eventSummary(await read("events"));
    await checkpoint();

    const campaigns = campaignCollector(config.workspace, state.nonce);
    const campaignsComplete = await pages("campaigns", campaigns.visit);
    if (!campaignsComplete) fail("PAGINATION_LIMIT");
    campaigns.summary.complete = true;
    state.results.campaigns = campaigns.summary;
    await checkpoint();
  } catch (e) {
    // Persist errors only from the fixed vocabulary. Never include a provider/filesystem message.
    if (!(e instanceof ReadError) && !(e instanceof S00RunError))
      throw new S00RunError("INSTANTLY_STORAGE_OR_INTERNAL_FAILURE");
    const code = e.code;
    if (!errors.includes(code as (typeof errors)[number]))
      throw new S00RunError("INSTANTLY_STORAGE_OR_INTERNAL_FAILURE");
    state.status = "failed";
    state.error = code as (typeof errors)[number];
    await persist();
  }
  return instantlyReport(state);
}
