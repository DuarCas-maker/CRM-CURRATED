// S00-C extends the same journal. No dotenv, browser, application hooks or implicit execution.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  validateReconnect,
  validateReconnectSources,
  reconnectGatesSchema,
  type ReconnectState,
  type ReconnectSources,
} from "./s00-composio-reconnect";
import {
  metadata,
  systemObservationClock,
  type ObservationClock,
} from "./s00-composio-observer";
import {
  obj,
  str,
  hash,
  email,
  fail,
  S00RunError,
  composioConfiguration,
  composioJson,
  boundedComposioJson,
  composioThreadMetadataUrl,
  gmailRoot,
  retryAfterDelay,
  type Obj,
} from "./s00-composio-common";

const digest = z.string().regex(/^[a-f0-9]{64}$/),
  ca = z.string().regex(/^ca_[A-Za-z0-9_-]{1,128}$/),
  gid = z.string().regex(/^[a-f0-9]{1,128}$/i),
  time = z.number().int().positive().safe(),
  code = z.string().regex(/^[A-Z0-9_]{1,80}$/);
const operations = z.enum([
  "usage_before",
  "config",
  "old",
  "m2_before",
  "link",
  "candidate_1",
  "candidate_2",
  "candidate_3",
  "profile",
  "history",
  "recheck",
  "m2_after",
  "usage_after",
  "reconcile_link",
]);
type Op = z.infer<typeof operations>;
const usage = z
  .object({
    instantCharge: z
      .string()
      .regex(/^\d+(?:\.\d+)?$/)
      .nullable(),
    remainingAllowanceKnown: z.literal(false),
  })
  .strict();
function hosted(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ["connect.composio.dev", "backend.composio.dev"].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
const schema = z
  .object({
    version: z.literal(2),
    baseCalls: z.literal(81),
    authorizedTotal: z.literal(97),
    predecessor: z.custom<ReconnectState>(),
    predecessorHash: digest,
    fingerprint: digest,
    targetHash: digest,
    token: z.string().regex(/^[a-f0-9]{12}$/),
    originalIds: z.tuple([ca, ca]),
    phase: z.enum([
      "preparing",
      "await_auth",
      "verifying",
      "recovery_required",
      "completed",
      "blocked",
    ]),
    calls: z.number().int().min(0).max(16),
    normal: z.number().int().min(0).max(13),
    retry: z.number().int().min(0).max(3),
    requests: z
      .array(
        z
          .object({
            op: operations,
            bucket: z.enum(["normal", "retry"]),
            startedAt: time,
            result: code,
          })
          .strict(),
      )
      .max(16),
    link: z
      .object({
        alias: z.string().regex(/^s00-c-m1-[a-f0-9]{12}$/),
        status: z.enum([
          "not_sent",
          "in_flight",
          "uncertain",
          "confirmed",
          "failed",
        ]),
        id: ca.optional(),
        url: z.string().max(8192).refine(hosted).optional(),
        expiresAt: time.optional(),
        statusChecks: z.number().int().min(0).max(3),
        remoteStatus: z
          .enum([
            "ACTIVE",
            "INITIALIZING",
            "INITIATED",
            "EXPIRED",
            "FAILED",
            "REVOKED",
            "INACTIVE",
          ])
          .optional(),
        delivered: z.boolean(),
        reconciled: z.boolean(),
      })
      .strict(),
    checks: z
      .object({
        config: z.boolean(),
        old: z.boolean(),
        m2Before: z.boolean(),
        active: z.boolean(),
        profile: z.boolean(),
        history: z.boolean(),
        recheck: z.boolean(),
        m2After: z.boolean(),
      })
      .strict(),
    history: z.array(gid).max(20),
    binding: z
      .object({
        logicalAlias: z.literal(1),
        oldId: ca,
        newId: ca,
        addressHash: digest,
        paused: z.literal(true),
      })
      .strict()
      .optional(),
    usageBefore: usage.optional(),
    usageAfter: usage.optional(),
    error: code.optional(),
    usageError: code.optional(),
  })
  .strict();
export type CorrectionState = z.infer<typeof schema>;
export type ReconnectLedger = ReconnectState | CorrectionState;
export interface CorrectionStore {
  load(): Promise<ReconnectLedger | undefined>;
  save(state: CorrectionState): Promise<void>;
  deliver?(url: string): Promise<void>;
}
export type CorrectionAction =
  | "status"
  | "correct_prepare"
  | "correct_verify"
  | "correct_reconcile"
  | "correct_deliver";
export type CorrectionOptions = {
  execute?: boolean;
  authorizedTotal?: number;
  correctionAuthorized?: boolean;
  managementAuthorized?: boolean;
  includedCallsConfirmed?: boolean;
  gates?: z.infer<typeof reconnectGatesSchema>;
  oauthCompleted?: boolean;
  clock?: ObservationClock;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};
const safe = (e: unknown) =>
  e instanceof S00RunError && /^[A-Z0-9_]{1,80}$/.test(e.code)
    ? e.code
    : "LOCAL_OR_CONTRACT_ERROR";
function predecessor(value: unknown) {
  const p = validateReconnect(value);
  if (
    p.phase !== "recovery_required" ||
    p.calls !== 21 ||
    p.normal !== 15 ||
    p.retry !== 2 ||
    p.recovery !== 4 ||
    p.identityDiagnostic !== "M2" ||
    p.error !== "PROFILE_IDENTITY_MISMATCH" ||
    p.links.length !== 2 ||
    p.binding ||
    p.revoke.status !== "confirmed" ||
    !p.checks.revoked ||
    !p.checks.denied ||
    !p.checks.m2During ||
    !p.checks.active ||
    p.checks.profile
  )
    return fail("CORRECTION_PREDECESSOR_REQUIRED");
  return p;
}
export function validateCorrection(value: unknown): CorrectionState {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail("INVALID_CORRECTION_JOURNAL");
  const s = parsed.data,
    p = predecessor(s.predecessor),
    linkRequests = s.requests.filter((r) => r.op === "link"),
    ok = (op: Op) => s.requests.some((r) => r.op === op && r.result === "OK"),
    ids = [...p.links.map((l) => l.id), ...s.originalIds].filter(Boolean);
  if (
    s.predecessorHash !== hash(JSON.stringify(p)) ||
    s.fingerprint !== p.fingerprint ||
    s.link.alias !== `s00-c-m1-${s.token}` ||
    s.calls !== s.normal + s.retry ||
    s.calls !== s.requests.length ||
    s.requests.filter((r) => r.bucket === "normal").length !== s.normal ||
    s.requests.filter((r) => r.bucket === "retry").length !== s.retry ||
    new Set(s.history).size !== s.history.length ||
    linkRequests.length > 1 ||
    linkRequests.some((r) => r.bucket !== "normal") ||
    (linkRequests.length === 0 && s.link.status !== "not_sent") ||
    (linkRequests.length === 1 && s.link.status === "not_sent") ||
    (linkRequests.length === 1 &&
      (!s.usageBefore ||
        !s.checks.config ||
        !s.checks.old ||
        !s.checks.m2Before)) ||
    (s.link.status === "confirmed" &&
      (!s.link.id || !s.link.url || !s.link.expiresAt || !ok("link"))) ||
    s.originalIds[0] === s.originalIds[1] ||
    s.originalIds.some((id) => p.links.some((l) => l.id === id)) ||
    (s.link.id && ids.includes(s.link.id)) ||
    (s.link.delivered && s.link.status !== "confirmed") ||
    (s.checks.active && (!s.link.delivered || s.link.status !== "confirmed")) ||
    s.requests.filter((r) => r.op === "reconcile_link").length > 1 ||
    s.requests.some((r) => r.op === "reconcile_link" && r.bucket !== "retry") ||
    operations.options.some(
      (op) =>
        op !== "link" &&
        (s.requests.filter((r) => r.op === op).length > 2 ||
          s.requests.filter((r) => r.op === op && r.bucket === "normal")
            .length > 1),
    ) ||
    (s.usageBefore && !ok("usage_before")) ||
    (s.usageAfter && !ok("usage_after")) ||
    (s.checks.config && !ok("config")) ||
    (s.checks.old && !ok("old")) ||
    (s.checks.m2Before && !ok("m2_before")) ||
    (s.checks.profile && (!s.checks.active || !ok("profile"))) ||
    (s.checks.active &&
      (s.link.remoteStatus !== "ACTIVE" ||
        !["candidate_1", "candidate_2", "candidate_3"].some((op) =>
          ok(op as Op),
        ))) ||
    (s.checks.history &&
      (!s.checks.profile ||
        !ok("history") ||
        !p.baseline.every((id) => s.history.includes(id)))) ||
    (s.checks.recheck && (!s.checks.history || !ok("recheck"))) ||
    (s.checks.m2After && !ok("m2_after")) ||
    (s.binding &&
      (!Object.values(s.checks).every(Boolean) ||
        s.binding.newId !== s.link.id ||
        s.binding.newId === s.binding.oldId ||
        s.binding.oldId !== s.originalIds[0] ||
        s.binding.addressHash !== s.targetHash)) ||
    (s.phase === "completed" && !s.binding)
  )
    return fail("INVALID_CORRECTION_JOURNAL");
  return s;
}
export function validateReconnectLedger(value: unknown): ReconnectLedger {
  return obj(value).version === 2
    ? validateCorrection(value)
    : validateReconnect(value);
}
export function assertCorrectionPermission(options: CorrectionOptions) {
  if (
    options.authorizedTotal !== 97 ||
    !options.correctionAuthorized ||
    !options.managementAuthorized ||
    !options.includedCallsConfirmed ||
    !reconnectGatesSchema.safeParse(options.gates).success
  )
    return fail("CORRECTION_AUTHORIZATION_REQUIRED");
}
function validateContext(p: ReconnectState, sources: ReconnectSources) {
  validateReconnectSources(sources);
  if (p.sourceHash !== hash(JSON.stringify(sources)))
    return fail("CONFIGURATION_CHANGED");
  return sources.run;
}
export function correctionTargetCheck(
  text: string | undefined,
  p: ReconnectState,
  sources: ReconnectSources,
) {
  const src = validateContext(predecessor(p), sources);
  if (text === undefined || Buffer.byteLength(text) > 512)
    return fail("M1_TARGET_REQUIRED_OR_TOO_LARGE");
  const address = text.trim().toLowerCase();
  if (!email(address)) return fail("INVALID_M1_TARGET");
  const target = hash(address);
  if (target === src.boxes[1].addressHash) return fail("M1_TARGET_IS_M2");
  if (target !== src.boxes[0].addressHash)
    return fail("M1_TARGET_NOT_ORIGINAL");
  return {
    mode: "offline_m1_target_check",
    matchesM1: true,
    authenticatedCalls: 0,
  };
}
export function correctionReport(value: CorrectionState) {
  const s = validateCorrection(value);
  return {
    mode: "s00_correct_m1",
    phase: s.phase,
    baseCalls: 81,
    newCalls: s.calls,
    totalCalls: 81 + s.calls,
    proposedNewLimit: 16,
    proposedTotalLimit: 97,
    authorizationGrantedByReport: false,
    budget: { normal: s.normal, retry: s.retry },
    historicalBudget: { normal: 15, retry: 2, recovery: 4 },
    error: s.error ?? null,
    usageError: s.usageError ?? null,
    usageBefore: s.usageBefore ?? null,
    usageAfter: s.usageAfter ?? null,
    target: "M1",
    control: "M2",
    checks: s.checks,
    linkPrepared: s.link.status === "confirmed",
    linkDelivered: s.link.delivered,
    historicalLinks: 2,
    newLinks: s.requests.filter((r) => r.op === "link").length,
    bindingVerified: !!s.binding,
    closureComplete: !!s.binding && !!s.usageAfter,
    operationallyPaused: true,
    apiMessagesSent: 0,
    attachmentsDownloaded: 0,
    contentAnalyzed: false,
    crmIntegrationProven: false,
    recoveryRequired: s.phase === "recovery_required",
  };
}
export async function runComposioCorrection(
  env: Readonly<Record<string, string | undefined>>,
  sources: ReconnectSources | undefined,
  store: CorrectionStore,
  action: CorrectionAction = "status",
  targetText?: string,
  options: CorrectionOptions = {},
) {
  const raw = await store.load(),
    saved = raw?.version === 2 ? validateCorrection(raw) : undefined;
  if (!options.execute || action === "status")
    return saved ? correctionReport(saved) : undefined;
  if (
    ![
      "correct_prepare",
      "correct_verify",
      "correct_reconcile",
      "correct_deliver",
    ].includes(action)
  )
    return fail("INVALID_ACTION");
  assertCorrectionPermission(options);
  if (!sources || !raw) return fail("CORRECTION_PREDECESSOR_REQUIRED");
  const p = predecessor(saved?.predecessor ?? raw),
    src = validateContext(p, sources),
    config = composioConfiguration(env);
  if (
    config.fingerprint !== p.fingerprint ||
    config.targetFingerprint !== p.targetFingerprint
  )
    return fail("CONFIGURATION_CHANGED");
  if (
    saved &&
    (saved.targetHash !== src.boxes[0].addressHash ||
      JSON.stringify(saved.originalIds) !== JSON.stringify(config.ids))
  )
    return fail("CONFIGURATION_CHANGED");
  if (saved?.phase === "completed") return correctionReport(saved);
  correctionTargetCheck(targetText, p, sources);
  if (action === "correct_verify" && !options.oauthCompleted)
    return fail("OAUTH_CONFIRMATION_REQUIRED");
  if (!saved && action !== "correct_prepare")
    return fail("CORRECTION_PREPARE_REQUIRED");
  const token = randomBytes(6).toString("hex"),
    s: CorrectionState = saved ?? {
      version: 2,
      baseCalls: 81,
      authorizedTotal: 97,
      predecessor: structuredClone(p),
      predecessorHash: hash(JSON.stringify(p)),
      fingerprint: config.fingerprint,
      targetHash: src.boxes[0].addressHash,
      originalIds: [config.ids[0], config.ids[1]],
      token,
      phase: "preparing",
      calls: 0,
      normal: 0,
      retry: 0,
      requests: [],
      link: {
        alias: `s00-c-m1-${token}`,
        status: "not_sent",
        statusChecks: 0,
        delivered: false,
        reconciled: false,
      },
      checks: {
        config: false,
        old: false,
        m2Before: false,
        active: false,
        profile: false,
        history: false,
        recheck: false,
        m2After: false,
      },
      history: [],
    };
  const clock = options.clock ?? systemObservationClock,
    fetchImpl = options.fetchImpl ?? fetch;
  const save = async () => {
    validateCorrection(s);
    try {
      await store.save(structuredClone(s));
    } catch {
      return fail("JOURNAL_WRITE_FAILED");
    }
  };
  if (!saved) await save();
  if (s.link.status === "in_flight") {
    s.link.status = "uncertain";
    s.phase = "recovery_required";
    s.error = "LINK_RECONCILIATION_REQUIRED";
    await save();
  }
  const cancel = () => {
    if (options.signal?.aborted) return fail("CANCELLED");
  };
  const terminal = () =>
    (/^(HTTP|UPSTREAM)_4\d\d$/.test(s.error ?? "") && !/429$/.test(s.error!)) ||
    [
      "CONFIG_NOT_READY",
      "ORIGINAL_STATE_CHANGED",
      "ACCOUNT_IDENTITY_MISMATCH",
      "PROFILE_IDENTITY_MISMATCH",
      "INVALID_GMAIL_PROFILE",
      "INVALID_RESPONSE",
      "RESPONSE_TOO_LARGE",
      "INVALID_CANDIDATE_STATUS",
      "HISTORY_MESSAGES_MISSING",
      "HISTORY_CHANGED",
      "METADATA_CONTRACT_MISMATCH",
      "WRONG_REPLY_HEADERS",
      "INVALID_MESSAGE_HEADERS",
      "SOURCE_MESSAGES_MISSING",
      "OAUTH_NOT_ACTIVE",
      "AUTH_LINK_EXPIRED",
    ].includes(s.error ?? "");
  const sleep = async (ms: number) => {
    cancel();
    try {
      await clock.sleep(ms, options.signal);
    } catch {
      return fail(options.signal?.aborted ? "CANCELLED" : "CLOCK_WAIT_FAILED");
    }
    cancel();
  };
  const body = (id: string, endpoint: string) => ({
    connected_account_id: id,
    user_id: src.boxes[id === config.ids[1] ? 1 : 0].owner,
    endpoint,
    method: "GET",
  });
  const sameAccount = (data: Obj, id: string, alias: 1 | 2) => {
    if (
      data.id !== id ||
      data.user_id !== src.boxes[alias - 1].owner ||
      obj(data.auth_config).id !== config.auth ||
      obj(data.toolkit).slug !== "gmail"
    )
      return fail("ACCOUNT_IDENTITY_MISMATCH");
  };
  function guard(op: Op, path: string, method: "GET" | "POST", b?: Obj) {
    if (op === "link") {
      if (
        path !== "connected_accounts/link" ||
        method !== "POST" ||
        b?.auth_config_id !== config.auth ||
        b.user_id !== src.boxes[0].owner ||
        b.alias !== s.link.alias ||
        Object.keys(b).sort().join() !== "alias,auth_config_id,user_id"
      )
        return fail("BLOCKED_ROUTE");
      return;
    }
    if (op === "reconcile_link") {
      const q = new URLSearchParams({
        user_ids: src.boxes[0].owner,
        auth_config_ids: config.auth,
        toolkit_slugs: "gmail",
        limit: "20",
      });
      if (path !== `connected_accounts?${q}` || method !== "GET" || b)
        return fail("BLOCKED_ROUTE");
      return;
    }
    if (op === "usage_before" || op === "usage_after") {
      if (
        path !== "project/usage/summary" ||
        method !== "POST" ||
        !b ||
        Object.keys(b).length
      )
        return fail("BLOCKED_ROUTE");
      return;
    }
    if (op === "config" || op === "old" || op.startsWith("candidate_")) {
      const expected =
        op === "config"
          ? "auth_configs/" + config.auth
          : "connected_accounts/" + (op === "old" ? config.ids[0] : s.link.id);
      if (
        method !== "GET" ||
        b ||
        path !== expected ||
        (op.startsWith("candidate_") && !s.link.id)
      )
        return fail("BLOCKED_ROUTE");
      return;
    }
    const id =
      op === "m2_before" || op === "m2_after" ? config.ids[1] : s.link.id;
    const endpoint =
      op === "history" || op === "recheck"
        ? composioThreadMetadataUrl(src.boxes[0].initial.threadId!)
        : gmailRoot + "profile";
    if (
      !id ||
      method !== "POST" ||
      path !== "tools/execute/proxy" ||
      JSON.stringify(b) !== JSON.stringify(body(id, endpoint))
    )
      return fail("BLOCKED_ROUTE");
  }
  async function request(
    op: Op,
    path: string,
    method: "GET" | "POST",
    b?: Obj,
  ) {
    guard(op, path, method, b);
    let existing = s.requests.filter((r) => r.op === op),
      bucket: "normal" | "retry" =
        existing.length || op === "reconcile_link" ? "retry" : "normal";
    if (
      (op === "link" && (existing.length || s.link.status !== "not_sent")) ||
      existing.length >= 2 ||
      (op === "reconcile_link" && existing.length)
    )
      return fail("OPERATION_ALREADY_RESERVED");
    for (;;) {
      cancel();
      if (
        s.calls >= 16 ||
        s[bucket] >= (bucket === "normal" ? 13 : 3) ||
        (bucket === "normal" && op !== "usage_after" && s.normal >= 12)
      )
        return fail("CALL_BUDGET_EXHAUSTED");
      if (op === "link") s.link.status = "in_flight";
      const trace = {
        op,
        bucket,
        startedAt: clock.wallNow(),
        result: "IN_FLIGHT",
      };
      s.calls++;
      s[bucket]++;
      s.requests.push(trace);
      await save();
      try {
        const data =
          op === "link" || op === "reconcile_link"
            ? await boundedComposioJson(
                fetchImpl,
                config.key,
                path,
                method,
                b,
                2_100_000,
                options.signal,
                op === "link" ? 201 : 200,
              )
            : await composioJson(
                fetchImpl,
                config.key,
                path,
                method,
                b,
                2_100_000,
                options.signal,
              );
        if (path === "tools/execute/proxy" && data.status !== 200)
          throw new S00RunError(
            "UPSTREAM_" +
              (Number.isInteger(data.status) ? data.status : "INVALID"),
            retryAfterDelay(
              str(obj(data.headers)["retry-after"]),
              str(obj(data.headers).date),
            ),
          );
        const value = path === "tools/execute/proxy" ? obj(data.data) : data;
        if (!Object.keys(value).length) return fail("INVALID_RESPONSE");
        trace.result = "OK";
        await save();
        return value;
      } catch (e) {
        if (safe(e).startsWith("JOURNAL_")) throw e;
        trace.result = safe(e);
        if (op === "link")
          s.link.status = /^HTTP_4/.test(trace.result) ? "failed" : "uncertain";
        await save();
        if (
          op === "link" ||
          op === "reconcile_link" ||
          bucket === "retry" ||
          s.retry >= 3 ||
          !/^(NETWORK_OR_TIMEOUT|HTTP_(429|5\d\d)|UPSTREAM_(429|5\d\d))$/.test(
            safe(e),
          )
        )
          throw e;
        const wait = Math.max(
          5000,
          e instanceof S00RunError ? e.retryAfterMs : 0,
        );
        if (wait > 60000) return fail("RETRY_WAIT_EXCEEDS_LIMIT");
        await sleep(wait);
        bucket = "retry";
      }
    }
  }
  async function profile(id: string, op: "m2_before" | "m2_after" | "profile") {
    const d = await request(
        op,
        "tools/execute/proxy",
        "POST",
        body(id, gmailRoot + "profile"),
      ),
      address = str(d.emailAddress).toLowerCase();
    if (!email(address)) return fail("INVALID_GMAIL_PROFILE");
    if (hash(address) !== src.boxes[op === "profile" ? 0 : 1].addressHash)
      return fail("PROFILE_IDENTITY_MISMATCH");
  }
  async function use(op: "usage_before" | "usage_after") {
    const d = await request(op, "project/usage/summary", "POST", {});
    return {
      instantCharge:
        typeof d.instant_charge === "string" &&
        /^\d+(?:\.\d+)?$/.test(d.instant_charge)
          ? d.instant_charge
          : null,
      remainingAllowanceKnown: false as const,
    };
  }
  async function history(op: "history" | "recheck") {
    const d = await request(
        op,
        "tools/execute/proxy",
        "POST",
        body(
          s.link.id!,
          composioThreadMetadataUrl(src.boxes[0].initial.threadId!),
        ),
      ),
      ids = metadata(d, src, 1, config.recipient)
        .map((m) => m.id)
        .sort();
    if (
      !p.baseline.every((id) => ids.includes(id)) ||
      !ids.includes(sources!.observation.boxes[0].event!.id)
    )
      return fail("HISTORY_MESSAGES_MISSING");
    if (op === "recheck" && JSON.stringify(ids) !== JSON.stringify(s.history))
      return fail("HISTORY_CHANGED");
    return ids;
  }
  async function deliver() {
    if (s.link.delivered) return;
    if (
      s.link.status !== "confirmed" ||
      !s.link.url ||
      !s.link.expiresAt ||
      s.link.expiresAt < clock.wallNow() + 180000
    )
      return fail("VALID_LINK_REQUIRED");
    if (!store.deliver) return fail("PRIVATE_DELIVERY_UNAVAILABLE");
    try {
      await store.deliver(s.link.url);
    } catch {
      return fail("PRIVATE_DELIVERY_FAILED");
    }
    s.link.delivered = true;
    s.phase = "await_auth";
    delete s.error;
    await save();
  }
  try {
    if (action === "correct_prepare") {
      if (terminal()) return correctionReport(s);
      if (s.link.status === "confirmed") return correctionReport(s);
      if (s.link.status !== "not_sent")
        return fail("LINK_RECONCILIATION_REQUIRED");
      if (!s.usageBefore) {
        s.usageBefore = await use("usage_before");
        await save();
      }
      if (!s.checks.config) {
        const d = await request("config", "auth_configs/" + config.auth, "GET"),
          creds = obj(d.credentials),
          scopes = creds.scopes ?? creds.scope;
        if (
          d.id !== config.auth ||
          obj(d.toolkit).slug !== "gmail" ||
          d.is_disabled === true ||
          d.enabled === false ||
          d.is_composio_managed !== false ||
          !(
            Array.isArray(scopes) ? scopes : str(scopes).split(/[\s,]+/)
          ).includes("https://www.googleapis.com/auth/gmail.readonly")
        )
          return fail("CONFIG_NOT_READY");
        s.checks.config = true;
        await save();
      }
      if (!s.checks.old) {
        const d = await request(
          "old",
          "connected_accounts/" + config.ids[0],
          "GET",
        );
        sameAccount(d, config.ids[0], 1);
        if (d.status !== "REVOKED") return fail("ORIGINAL_STATE_CHANGED");
        s.checks.old = true;
        await save();
      }
      if (!s.checks.m2Before) {
        await profile(config.ids[1], "m2_before");
        s.checks.m2Before = true;
        await save();
      }
      if (16 - s.calls < 1 + 8 + (3 - s.retry))
        return fail("PROTECTED_RESERVE_BEFORE_LINK");
      const d = await request("link", "connected_accounts/link", "POST", {
          auth_config_id: config.auth,
          user_id: src.boxes[0].owner,
          alias: s.link.alias,
        }),
        id = str(d.connected_account_id),
        url = str(d.redirect_url),
        expires = Date.parse(str(d.expires_at));
      if (
        !ca.safeParse(id).success ||
        [...config.ids, ...p.links.map((l) => l.id)].includes(id) ||
        !hosted(url) ||
        !Number.isFinite(expires) ||
        expires < clock.wallNow() + 180000
      )
        return fail("INVALID_AUTH_LINK");
      s.link.id = id;
      s.link.url = url;
      s.link.expiresAt = expires;
      s.link.status = "confirmed";
      await save();
      await deliver();
    } else if (action === "correct_deliver") await deliver();
    else if (action === "correct_reconcile") {
      if (s.link.status !== "uncertain" || s.link.reconciled)
        return fail("NO_UNCERTAIN_LINK");
      const q = new URLSearchParams({
          user_ids: src.boxes[0].owner,
          auth_config_ids: config.auth,
          toolkit_slugs: "gmail",
          limit: "20",
        }),
        d = await request("reconcile_link", "connected_accounts?" + q, "GET");
      if (!Array.isArray(d.items) || d.items.length > 20 || d.next_cursor)
        return fail("LINK_RECONCILIATION_INCOMPLETE");
      const matches = d.items.map(obj).filter((a) => a.alias === s.link.alias);
      if (matches.length !== 1) return fail("LINK_RECONCILIATION_AMBIGUOUS");
      const a = matches[0],
        id = str(a.id);
      sameAccount(a, id, 1);
      if (
        !ca.safeParse(id).success ||
        [...config.ids, ...p.links.map((l) => l.id)].includes(id)
      )
        return fail("INVALID_CANDIDATE");
      s.link.id = id;
      s.link.reconciled = true;
      return fail("AUTH_LINK_SECRET_UNAVAILABLE");
    } else if (action === "correct_verify") {
      if (terminal()) return correctionReport(s);
      if (!s.link.delivered || s.link.status !== "confirmed")
        return fail("DELIVERED_LINK_REQUIRED");
      s.phase = "verifying";
      await save();
      const start = clock.monoNow();
      while (!s.checks.active && s.link.statusChecks < 3) {
        const i = s.link.statusChecks,
          wait = start + [0, 15000, 30000][i] - clock.monoNow();
        if (wait > 0) await sleep(wait);
        s.link.statusChecks++;
        await save();
        const d = await request(
          ("candidate_" + (i + 1)) as Op,
          "connected_accounts/" + s.link.id,
          "GET",
        );
        sameAccount(d, s.link.id!, 1);
        const remote = schema.shape.link.shape.remoteStatus.safeParse(d.status);
        if (!remote.success || !remote.data || d.is_disabled === true)
          return fail("INVALID_CANDIDATE_STATUS");
        s.link.remoteStatus = remote.data;
        s.checks.active = d.status === "ACTIVE";
        await save();
        if (
          ["EXPIRED", "FAILED", "REVOKED", "INACTIVE"].includes(
            d.status as string,
          )
        )
          return fail("OAUTH_NOT_ACTIVE");
        if (!s.checks.active && s.link.expiresAt! <= clock.wallNow())
          return fail("AUTH_LINK_EXPIRED");
      }
      if (!s.checks.active) return fail("OAUTH_NOT_ACTIVE");
      if (!s.checks.profile) {
        await profile(s.link.id!, "profile");
        s.checks.profile = true;
        await save();
      }
      if (!s.checks.history) {
        s.history = await history("history");
        s.checks.history = true;
        await save();
      }
      if (!s.checks.recheck) {
        await history("recheck");
        s.checks.recheck = true;
        await save();
      }
      if (!s.checks.m2After) {
        await profile(config.ids[1], "m2_after");
        s.checks.m2After = true;
        await save();
      }
      s.binding = {
        logicalAlias: 1,
        oldId: config.ids[0],
        newId: s.link.id!,
        addressHash: s.targetHash,
        paused: true,
      };
      s.phase = "completed";
      delete s.error;
      await save();
      try {
        s.usageAfter = await use("usage_after");
        await save();
      } catch (e) {
        if (safe(e).startsWith("JOURNAL_")) throw e;
        s.usageError = safe(e);
        await save();
      }
    } else return fail("INVALID_ACTION");
  } catch (e) {
    if (safe(e).startsWith("JOURNAL_")) throw e;
    if (["in_flight"].includes(s.link.status)) s.link.status = "uncertain";
    s.error = safe(e);
    s.phase = s.link.status === "not_sent" ? "blocked" : "recovery_required";
    await save();
  }
  return correctionReport(s);
}
