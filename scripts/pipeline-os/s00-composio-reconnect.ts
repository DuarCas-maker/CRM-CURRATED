// S00-B: stepwise M1-only management. No env loading, UI automation or app hooks.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { validateRunState, type RunState } from "./s00-composio-runner";
import {
  validateObservation,
  metadata,
  systemObservationClock,
  type ObservationState,
  type ObservationClock,
} from "./s00-composio-observer";
import {
  obj,
  str,
  email,
  hash,
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

const ca = z.string().regex(/^ca_[A-Za-z0-9_-]{1,128}$/),
  digest = z.string().regex(/^[a-f0-9]{64}$/),
  time = z.number().int().positive().safe();
const code = z.string().regex(/^[A-Z0-9_]{1,80}$/),
  gid = z.string().regex(/^[a-f0-9]{1,128}$/i);
const mutation = z.enum([
  "not_sent",
  "in_flight",
  "uncertain",
  "confirmed",
  "failed",
]);
const phase = z.enum([
  "preparing",
  "prepared",
  "revoking",
  "revocation_uncertain",
  "await_auth",
  "verifying",
  "recovery_required",
  "completed",
  "blocked",
]);
const usage = z
  .object({
    instantCharge: z
      .string()
      .regex(/^\d+(?:\.\d+)?$/)
      .nullable(),
    remainingAllowanceKnown: z.literal(false),
  })
  .strict();
const hostedUrl = (value: string) => {
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
};
const linkSchema = z
  .object({
    alias: z.string().regex(/^s00-b-m1-[a-f0-9]{12}-(normal|recovery)$/),
    status: mutation,
    id: ca.optional(),
    url: z.string().max(8192).refine(hostedUrl).optional(),
    expiresAt: time.optional(),
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
    statusChecks: z.number().int().min(0).max(4),
    reconciled: z.boolean(),
  })
  .strict();
const operations = z.enum([
  "usage_before",
  "config",
  "m1",
  "m2",
  "profile_m1",
  "profile_m2",
  "baseline",
  "link",
  "revoke",
  "status_old",
  "probe_old",
  "control_m2",
  "candidate",
  "profile_candidate",
  "history",
  "recheck",
  "control_final",
  "usage_after",
  "reconcile_link",
  "reconcile_old",
  "recovery_link",
  "recovery_status",
  "recovery_profile",
  "identity_diagnostic",
]);
type Op = z.infer<typeof operations>;
type Bucket = "normal" | "retry" | "recovery";
const schema = z
  .object({
    version: z.literal(1),
    baseCalls: z.literal(60),
    authorizedTotal: z.literal(88),
    sourceHash: digest,
    fingerprint: digest,
    targetFingerprint: digest,
    token: z.string().regex(/^[a-f0-9]{12}$/),
    phase,
    calls: z.number().int().min(0).max(28),
    normal: z.number().int().min(0).max(21),
    retry: z.number().int().min(0).max(3),
    recovery: z.number().int().min(0).max(4),
    baseline: z.array(gid).max(20),
    links: z.array(linkSchema).max(2),
    revoke: z.object({ status: mutation, reconciled: z.boolean() }).strict(),
    checks: z
      .object({
        revoked: z.boolean(),
        denied: z.boolean(),
        m2During: z.boolean(),
        active: z.boolean(),
        profile: z.boolean(),
        history: z.boolean(),
        recheck: z.boolean(),
        m2After: z.boolean(),
      })
      .strict(),
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
    requests: z
      .array(
        z
          .object({
            op: operations,
            bucket: z.enum(["normal", "retry", "recovery"]),
            startedAt: time,
            result: code,
          })
          .strict(),
      )
      .max(28),
    usageBefore: usage.optional(),
    usageAfter: usage.optional(),
    error: code.optional(),
    usageError: code.optional(),
    identityDiagnostic: z.enum(["M1", "M2", "OTHER", "INVALID"]).optional(),
  })
  .strict();
export type ReconnectState = z.infer<typeof schema>;
type Link = ReconnectState["links"][number];
export type ReconnectAction =
  | "status"
  | "prepare"
  | "revoke"
  | "verify"
  | "recover"
  | "reconcile"
  | "inspect_identity";
export type ReconnectSources = { run: RunState; observation: ObservationState };
export interface ReconnectStore {
  load(): Promise<ReconnectState | undefined>;
  save(state: ReconnectState): Promise<void>;
}
export const reconnectGatesSchema = z
  .object({
    managementPermission: z.literal(true),
    operatorReady: z.literal(true),
    grantIsolated: z.literal(true),
    noVerifier: z.literal(true),
  })
  .strict();
export type ReconnectOptions = {
  execute?: boolean;
  authorizedTotal?: number;
  managementAuthorized?: boolean;
  includedCallsConfirmed?: boolean;
  gates?: z.infer<typeof reconnectGatesSchema>;
  oauthCompleted?: boolean;
  recoveryConfirmed?: boolean;
  identityDiagnosticAuthorized?: boolean;
  fetchImpl?: typeof fetch;
  clock?: ObservationClock;
  signal?: AbortSignal;
};
export function assertReconnectPermission(options: ReconnectOptions) {
  if (
    options.authorizedTotal !== 88 ||
    !options.managementAuthorized ||
    !options.includedCallsConfirmed ||
    !reconnectGatesSchema.safeParse(options.gates).success
  )
    return fail("RECONNECT_AUTHORIZATION_REQUIRED");
}

export function validateReconnect(value: unknown): ReconnectState {
  const p = schema.safeParse(value);
  if (!p.success) return fail("INVALID_RECONNECT_JOURNAL");
  const s = p.data;
  const revokes = s.requests.filter((r) => r.op === "revoke").length;
  const diagnostics = s.requests.filter((r) => r.op === "identity_diagnostic");
  if (
    diagnostics.length > 1 ||
    diagnostics.some((r) => r.bucket !== "normal") ||
    (s.identityDiagnostic !== undefined &&
      (diagnostics.length !== 1 || diagnostics[0].result !== "OK")) ||
    revokes > 1 ||
    (revokes === 0 && s.revoke.status !== "not_sent") ||
    (revokes === 1 && s.revoke.status === "not_sent") ||
    s.links.some((l, i) => {
      const n = s.requests.filter(
        (r) => r.op === (i ? "recovery_link" : "link"),
      ).length;
      return (
        n > 1 ||
        (n === 0 && l.status !== "not_sent") ||
        (n === 1 && l.status === "not_sent")
      );
    }) ||
    s.requests.some(
      (r) =>
        (["link", "revoke"].includes(r.op) && r.bucket !== "normal") ||
        (r.op === "recovery_link" && r.bucket !== "recovery"),
    ) ||
    s.calls !== s.normal + s.retry + s.recovery ||
    s.requests.length !== s.calls ||
    (["normal", "retry", "recovery"] as const).some(
      (b) => s.requests.filter((r) => r.bucket === b).length !== s[b],
    ) ||
    new Set(s.baseline).size !== s.baseline.length ||
    s.links.some(
      (l, i) =>
        l.alias !== `s00-b-m1-${s.token}-${i ? "recovery" : "normal"}` ||
        (l.status === "confirmed" && (!l.id || !l.url || !l.expiresAt)),
    ) ||
    (s.links.length === 2 && s.links[0].id === s.links[1].id) ||
    (s.checks.denied && !s.checks.revoked) ||
    (s.checks.profile && !s.checks.active) ||
    (s.checks.history && !s.checks.profile) ||
    (s.checks.recheck && !s.checks.history) ||
    (s.binding &&
      (!s.checks.profile ||
        !s.checks.history ||
        !s.checks.recheck ||
        !s.checks.m2After ||
        s.binding.oldId === s.binding.newId ||
        s.binding.newId !== s.links.at(-1)?.id)) ||
    (s.phase === "completed" &&
      (!s.binding || !Object.values(s.checks).every(Boolean)))
  )
    return fail("INVALID_RECONNECT_JOURNAL");
  return s;
}
export function reconnectReport(value?: ReconnectState) {
  const s = value ? validateReconnect(value) : undefined;
  return {
    mode: s ? "s00_m1_reconnect" : "offline_no_reconnect",
    phase: s?.phase ?? "not_started",
    baseCalls: 60,
    newCalls: s?.calls ?? 0,
    totalCalls: 60 + (s?.calls ?? 0),
    proposedNewLimit: 28,
    proposedTotalLimit: 88,
    authorizationGrantedByReport: false,
    budget: {
      normal: s?.normal ?? 0,
      retry: s?.retry ?? 0,
      recovery: s?.recovery ?? 0,
    },
    error: s?.error ?? null,
    usageError: s?.usageError ?? null,
    usageBefore: s?.usageBefore ?? null,
    usageAfter: s?.usageAfter ?? null,
    identityDiagnostic: s?.identityDiagnostic ?? null,
    target: "M1",
    control: "M2",
    linkPrepared: s?.links.at(-1)?.status === "confirmed",
    linksCreated: s?.links.filter((l) => l.status === "confirmed").length ?? 0,
    revokeStatus: s?.revoke.status ?? "not_sent",
    revocationReconciled: s?.revoke.reconciled ?? false,
    checks: s?.checks ?? null,
    bindingVerified: !!s?.binding,
    closureComplete: !!s?.usageAfter,
    operationallyPaused: true,
    apiMessagesSent: 0,
    attachmentsDownloaded: 0,
    contentAnalyzed: false,
    crmIntegrationProven: false,
    recoveryRequired: s
      ? ["recovery_required", "revocation_uncertain"].includes(s.phase)
      : false,
  };
}
const safeCode = (e: unknown) =>
  e instanceof S00RunError && /^[A-Z0-9_]{1,80}$/.test(e.code)
    ? e.code
    : "LOCAL_OR_CONTRACT_ERROR";
const transient = (e: unknown) =>
  e instanceof S00RunError &&
  /^(NETWORK_OR_TIMEOUT|HTTP_(429|5\d\d)|UPSTREAM_(429|5\d\d))$/.test(e.code);
export function validateReconnectSources(src: ReconnectSources) {
  validateRunState(src.run);
  validateObservation(src.observation);
  if (
    src.observation.phase !== "completed" ||
    src.observation.calls !== 23 ||
    src.observation.historicalCalls !== 37 ||
    src.run.calls !== 33 ||
    src.run.priorDiagnosticCalls !== 4 ||
    src.observation.sourceHash !== hash(JSON.stringify(src.run)) ||
    src.observation.boxes.some((b) => !b.rechecked || !b.event?.persistedAt) ||
    src.run.boxes.some(
      (b) =>
        !b.confirmationVerified ||
        !b.initial.threadId ||
        !b.owner ||
        !b.addressHash,
    ) ||
    src.run.boxes[0].addressHash === src.run.boxes[1].addressHash
  )
    return fail("SOURCE_NOT_FINAL_60");
}

export async function runComposioReconnect(
  env: Readonly<Record<string, string | undefined>>,
  sources: ReconnectSources | undefined,
  store: ReconnectStore,
  action: ReconnectAction = "status",
  options: ReconnectOptions = {},
) {
  let saved = await store.load();
  if (saved) saved = validateReconnect(saved);
  if (!options.execute || action === "status") return reconnectReport(saved);
  if (
    ![
      "prepare",
      "revoke",
      "verify",
      "recover",
      "reconcile",
      "inspect_identity",
    ].includes(action)
  )
    return fail("INVALID_ACTION");
  assertReconnectPermission(options);
  if (!sources) return fail("SOURCE_REQUIRED");
  validateReconnectSources(sources);
  const config = composioConfiguration(env),
    src = sources.run;
  if (config.targetFingerprint !== src.targetFingerprint)
    return fail("CONFIGURATION_CHANGED");
  const sourceHash = hash(JSON.stringify(sources));
  if (
    saved &&
    (saved.sourceHash !== sourceHash ||
      saved.targetFingerprint !== config.targetFingerprint ||
      saved.fingerprint !== config.fingerprint)
  )
    return fail("CONFIGURATION_CHANGED");
  if (saved?.links.some((l) => l.id && config.ids.includes(l.id)))
    return fail("INVALID_RECONNECT_JOURNAL");
  if (
    saved?.binding &&
    (saved.binding.oldId !== config.ids[0] ||
      saved.binding.addressHash !== src.boxes[0].addressHash)
  )
    return fail("INVALID_RECONNECT_JOURNAL");
  if (saved?.phase === "completed") return reconnectReport(saved);
  if (!saved && action !== "prepare") return fail("PREPARE_REQUIRED");
  if (action === "verify" && !options.oauthCompleted)
    return fail("OAUTH_CONFIRMATION_REQUIRED");
  if (action === "recover" && !options.recoveryConfirmed)
    return fail("RECOVERY_CONFIRMATION_REQUIRED");
  if (action === "inspect_identity" && !options.identityDiagnosticAuthorized)
    return fail("IDENTITY_DIAGNOSTIC_AUTHORIZATION_REQUIRED");
  const existed = !!saved;
  const s: ReconnectState = saved ?? {
    version: 1,
    baseCalls: 60,
    authorizedTotal: 88,
    sourceHash,
    fingerprint: config.fingerprint,
    targetFingerprint: config.targetFingerprint,
    token: randomBytes(6).toString("hex"),
    phase: "preparing",
    calls: 0,
    normal: 0,
    retry: 0,
    recovery: 0,
    baseline: [],
    links: [],
    revoke: { status: "not_sent", reconciled: false },
    checks: {
      revoked: false,
      denied: false,
      m2During: false,
      active: false,
      profile: false,
      history: false,
      recheck: false,
      m2After: false,
    },
    requests: [],
  };
  const clock = options.clock ?? systemObservationClock,
    fetchImpl = options.fetchImpl ?? fetch;
  const save = async () => {
    validateReconnect(s);
    try {
      await store.save(structuredClone(s));
    } catch {
      return fail("JOURNAL_WRITE_FAILED");
    }
  };
  if (!saved) await save();
  let interrupted = false;
  for (const slot of [...s.links, s.revoke])
    if (slot.status === "in_flight") {
      slot.status = "uncertain";
      interrupted = true;
    }
  if (interrupted) {
    s.error = "INTERRUPTED_MUTATION_REQUIRES_RECONCILIATION";
    s.phase =
      s.revoke.status === "uncertain" ? "revocation_uncertain" : "blocked";
    await save();
  }
  const cancellation = () => {
    if (options.signal?.aborted) return fail("CANCELLED");
  };
  const sleep = async (ms: number) => {
    cancellation();
    try {
      await clock.sleep(ms, options.signal);
    } catch {
      return fail(options.signal?.aborted ? "CANCELLED" : "CLOCK_WAIT_FAILED");
    }
    cancellation();
  };
  function proxyBody(account: string, endpoint: string) {
    return {
      connected_account_id: account,
      user_id: src.boxes[0].owner,
      endpoint,
      method: "GET",
    };
  }
  function guard(
    path: string,
    method: "GET" | "POST",
    body: Obj | undefined,
    op: Op,
  ) {
    const link = s.links.at(-1);
    if (path === "connected_accounts/link") {
      if (
        method !== "POST" ||
        !["link", "recovery_link"].includes(op) ||
        !link ||
        body?.auth_config_id !== config.auth ||
        body.user_id !== src.boxes[0].owner ||
        body.alias !== link.alias ||
        Object.keys(body).sort().join() !== "alias,auth_config_id,user_id"
      )
        return fail("BLOCKED_MANAGEMENT_ROUTE");
      return;
    }
    if (path === `connected_accounts/${config.ids[0]}/revoke`) {
      if (op !== "revoke" || method !== "POST" || body !== undefined)
        return fail("BLOCKED_MANAGEMENT_ROUTE");
      return;
    }
    if (path.startsWith("connected_accounts?")) {
      const u = new URL("https://backend.composio.dev/api/v3.1/" + path);
      if (
        op !== "reconcile_link" ||
        method !== "GET" ||
        u.searchParams.get("user_ids") !== src.boxes[0].owner ||
        u.searchParams.get("auth_config_ids") !== config.auth ||
        u.searchParams.get("toolkit_slugs") !== "gmail" ||
        u.searchParams.get("limit") !== "20" ||
        u.searchParams.size !== 4
      )
        return fail("BLOCKED_MANAGEMENT_ROUTE");
      return;
    }
    if (path === "tools/execute/proxy") {
      const account = str(body?.connected_account_id),
        endpoint = str(body?.endpoint);
      const idx = account === config.ids[1] ? 1 : 0;
      if (
        method !== "POST" ||
        body?.method !== "GET" ||
        body.user_id !== src.boxes[idx].owner ||
        body.body !== undefined ||
        ![config.ids[0], config.ids[1], link?.id].includes(account) ||
        ![
          gmailRoot + "profile",
          composioThreadMetadataUrl(src.boxes[0].initial.threadId!),
        ].includes(endpoint) ||
        (endpoint !== gmailRoot + "profile" && account === config.ids[1])
      )
        return fail("BLOCKED_GMAIL_ROUTE");
      return;
    }
    if (path === "project/usage/summary" && method === "POST") return;
    if (
      method !== "GET" ||
      ![
        "auth_configs/" + config.auth,
        ...[...config.ids, link?.id]
          .filter(Boolean)
          .map((id) => "connected_accounts/" + id),
      ].includes(path)
    )
      return fail("BLOCKED_ROUTE");
  }
  async function request(
    op: Op,
    path: string,
    method: "GET" | "POST",
    body?: Obj,
    bucket: Bucket = "normal",
    slot?: Link | ReconnectState["revoke"],
  ) {
    let attempt = 0;
    for (;;) {
      cancellation();
      guard(path, method, body, op);
      const b: Bucket = attempt ? "retry" : bucket;
      if (
        s.calls >= 28 ||
        s[b] >= { normal: 21, retry: 3, recovery: 4 }[b] ||
        (b === "normal" && op !== "usage_after" && s.normal >= 20)
      )
        return fail("CALL_BUDGET_EXHAUSTED");
      if (slot && slot.status !== "not_sent")
        return fail("MUTATION_ALREADY_RESERVED");
      if (slot) slot.status = "in_flight";
      s.calls++;
      s[b]++;
      const trace = {
        op,
        bucket: b,
        startedAt: clock.wallNow(),
        result: "IN_FLIGHT",
      };
      s.requests.push(trace);
      await save();
      try {
        const management =
          path === "connected_accounts/link" ||
          path.endsWith("/revoke") ||
          path.startsWith("connected_accounts?");
        const data = await (management
          ? boundedComposioJson(
              fetchImpl,
              config.key,
              path,
              method,
              body,
              2_100_000,
              options.signal,
              path === "connected_accounts/link" ? 201 : 200,
            )
          : composioJson(
              fetchImpl,
              config.key,
              path,
              method,
              body,
              2_100_000,
              options.signal,
              op === "probe_old",
            ));
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
        trace.result = safeCode(e);
        if (slot)
          slot.status = /^HTTP_4/.test(trace.result) ? "failed" : "uncertain";
        await save();
        if (
          slot ||
          bucket === "retry" ||
          attempt ||
          s.retry >= 3 ||
          !transient(e) ||
          op === "probe_old" ||
          op === "identity_diagnostic"
        )
          throw e;
        const wait = Math.max(
          5000,
          e instanceof S00RunError ? e.retryAfterMs : 0,
        );
        if (wait > 60_000) return fail("RETRY_WAIT_EXCEEDS_LIMIT");
        await sleep(wait);
        attempt++;
      }
    }
  }
  async function profile(account: string, op: Op, bucket: Bucket = "normal") {
    const data = await request(
      op,
      "tools/execute/proxy",
      "POST",
      {
        ...proxyBody(account, gmailRoot + "profile"),
        user_id:
          account === config.ids[1] ? src.boxes[1].owner : src.boxes[0].owner,
      },
      bucket,
    );
    const expected = src.boxes[account === config.ids[1] ? 1 : 0].addressHash;
    const address = str(data.emailAddress).toLowerCase();
    if (!email(address)) return fail("INVALID_GMAIL_PROFILE");
    if (hash(address) !== expected) return fail("PROFILE_IDENTITY_MISMATCH");
  }
  function accountIdentity(data: Obj, id: string, alias: 1 | 2) {
    if (
      data.id !== id ||
      data.user_id !== src.boxes[alias - 1].owner ||
      obj(data.auth_config).id !== config.auth ||
      obj(data.toolkit).slug !== "gmail"
    )
      return fail("ACCOUNT_IDENTITY_MISMATCH");
  }
  async function history(
    account: string,
    op: "baseline" | "history" | "recheck",
  ) {
    const data = await request(
      op,
      "tools/execute/proxy",
      "POST",
      proxyBody(
        account,
        composioThreadMetadataUrl(src.boxes[0].initial.threadId!),
      ),
    );
    const messages = metadata(data, src, 1, config.recipient),
      ids = messages.map((m) => m.id).sort();
    if (!ids.includes(sources!.observation.boxes[0].event!.id))
      return fail("OBSERVED_MESSAGE_MISSING");
    if (op !== "baseline" && JSON.stringify(ids) !== JSON.stringify(s.baseline))
      return fail("HISTORY_CHANGED");
    return ids;
  }
  async function usageRead(op: "usage_before" | "usage_after") {
    const data = await request(op, "project/usage/summary", "POST", {});
    return {
      instantCharge:
        typeof data.instant_charge === "string" &&
        /^\d+(?:\.\d+)?$/.test(data.instant_charge)
          ? data.instant_charge
          : null,
      remainingAllowanceKnown: false as const,
    };
  }
  async function createLink(recovery: boolean) {
    if ((!recovery && s.links.length) || (recovery && s.links.length !== 1))
      return fail("LINK_LIMIT_REACHED");
    if (recovery && s.recovery + 3 > 4)
      return fail("RECOVERY_RESERVE_INSUFFICIENT");
    // Proofs for the old transport cannot validate a new connected-account ID.
    s.checks.active = false;
    s.checks.profile = false;
    s.checks.history = false;
    s.checks.recheck = false;
    s.checks.m2After = false;
    delete s.binding;
    const l: Link = {
      alias: `s00-b-m1-${s.token}-${recovery ? "recovery" : "normal"}`,
      status: "not_sent",
      statusChecks: 0,
      reconciled: false,
    };
    s.links.push(l);
    await save();
    const data = await request(
      recovery ? "recovery_link" : "link",
      "connected_accounts/link",
      "POST",
      {
        auth_config_id: config.auth,
        user_id: src.boxes[0].owner,
        alias: l.alias,
      },
      recovery ? "recovery" : "normal",
      l,
    );
    const expires = Date.parse(str(data.expires_at)),
      id = str(data.connected_account_id),
      url = str(data.redirect_url);
    if (
      !ca.safeParse(id).success ||
      config.ids.includes(id) ||
      s.links.some((other) => other !== l && other.id === id) ||
      !linkSchema.shape.url.safeParse(url).success ||
      !Number.isFinite(expires) ||
      expires < clock.wallNow() + 180_000
    )
      return fail("INVALID_OR_SHORT_LIVED_AUTH_LINK");
    l.id = id;
    l.url = url;
    l.expiresAt = expires;
    l.status = "confirmed";
    s.checks.active = false;
    s.checks.profile = false;
    await save();
  }
  async function candidateStatus(l: Link, bucket: Bucket) {
    if (!l.id) return fail("CANDIDATE_ID_UNKNOWN");
    if (bucket === "recovery" && s.recovery + 2 > 4)
      return fail("RECOVERY_IDENTITY_SLOT_RESERVED");
    const data = await request(
      bucket === "recovery" ? "recovery_status" : "candidate",
      "connected_accounts/" + l.id,
      "GET",
      undefined,
      bucket,
    );
    accountIdentity(data, l.id, 1);
    const remote = linkSchema.shape.remoteStatus.safeParse(data.status);
    if (!remote.success || !remote.data || data.is_disabled === true)
      return fail("INVALID_CANDIDATE_STATUS");
    l.remoteStatus = remote.data;
    s.checks.active = data.status === "ACTIVE";
    if (!s.checks.active) {
      s.checks.profile = false;
      s.checks.history = false;
      s.checks.recheck = false;
      s.checks.m2After = false;
      delete s.binding;
    }
    await save();
    return remote.data;
  }
  async function finish() {
    const l = s.links.at(-1)!;
    if (
      !s.checks.profile ||
      !s.checks.active ||
      !s.checks.revoked ||
      !s.checks.denied ||
      !s.checks.m2During
    )
      return fail("RECOVERY_PREREQUISITES_MISSING");
    if (!s.checks.history) {
      await history(l.id!, "history");
      s.checks.history = true;
      await save();
    }
    if (!s.checks.recheck) {
      await history(l.id!, "recheck");
      s.checks.recheck = true;
      await save();
    }
    if (!s.checks.m2After) {
      await profile(config.ids[1], "control_final");
      s.checks.m2After = true;
      await save();
    }
    s.binding = {
      logicalAlias: 1,
      oldId: config.ids[0],
      newId: l.id!,
      addressHash: src.boxes[0].addressHash,
      paused: true,
    };
    s.phase = "completed";
    delete s.error;
    await save();
    try {
      s.usageAfter = await usageRead("usage_after");
      await save();
    } catch (e) {
      if (safeCode(e).startsWith("JOURNAL_")) throw e;
      s.usageError = safeCode(e);
      await save();
    }
  }
  async function proveRevocation(bucket: Bucket = "normal") {
    const old = await request(
      bucket === "retry" ? "reconcile_old" : "status_old",
      "connected_accounts/" + config.ids[0],
      "GET",
      undefined,
      bucket,
    );
    accountIdentity(old, config.ids[0], 1);
    if (old.status !== "REVOKED") return fail("REVOCATION_NOT_CONFIRMED");
    s.checks.revoked = true;
    s.revoke.reconciled = s.revoke.status !== "confirmed";
    s.revoke.status = "confirmed";
    await save();
    if (!s.checks.denied) {
      let denied = false;
      try {
        await profile(config.ids[0], "probe_old");
      } catch (e) {
        denied =
          /^(HTTP_(400|403)|UPSTREAM_(401|403))$/.test(safeCode(e)) ||
          (s.checks.revoked && safeCode(e) === "CONNECTION_REVOKED");
        if (!denied) throw e;
      }
      if (!denied) return fail("OLD_CONNECTION_STILL_USABLE");
      s.checks.denied = true;
      await save();
    }
    if (!s.checks.m2During) {
      await profile(config.ids[1], "control_m2");
      s.checks.m2During = true;
      await save();
    }
    s.phase = "await_auth";
    delete s.error;
    await save();
  }
  try {
    if (action === "inspect_identity") {
      if (s.requests.some((r) => r.op === "identity_diagnostic"))
        return reconnectReport(s);
      if (
        s.phase !== "recovery_required" ||
        !s.checks.active ||
        s.links.length !== 2 ||
        s.recovery !== 4 ||
        !["PROFILE_IDENTITY_MISMATCH", "INVALID_GMAIL_PROFILE"].includes(
          s.error ?? "",
        ) ||
        !s.links.at(-1)?.id
      )
        return fail("IDENTITY_DIAGNOSTIC_NOT_AVAILABLE");
      const data = await request(
        "identity_diagnostic",
        "tools/execute/proxy",
        "POST",
        {
          ...proxyBody(s.links.at(-1)!.id!, gmailRoot + "profile"),
          user_id: src.boxes[0].owner,
        },
      );
      const address = str(data.emailAddress).toLowerCase();
      s.identityDiagnostic = !email(address)
        ? "INVALID"
        : hash(address) === src.boxes[0].addressHash
          ? "M1"
          : hash(address) === src.boxes[1].addressHash
            ? "M2"
            : "OTHER";
      await save();
    } else if (action === "prepare") {
      if (existed) {
        if (s.phase === "prepared") return reconnectReport(s);
        return fail("PREPARATION_CANNOT_RESTART");
      }
      s.usageBefore = await usageRead("usage_before");
      const auth = await request(
          "config",
          "auth_configs/" + config.auth,
          "GET",
        ),
        credentials = obj(auth.credentials),
        scopes = credentials.scopes ?? credentials.scope;
      if (
        auth.id !== config.auth ||
        obj(auth.toolkit).slug !== "gmail" ||
        auth.is_disabled === true ||
        auth.enabled === false ||
        auth.is_composio_managed === true ||
        !(
          Array.isArray(scopes) ? scopes : str(scopes).split(/[\s,]+/)
        ).includes("https://www.googleapis.com/auth/gmail.readonly")
      )
        return fail("CONFIG_NOT_READY");
      for (const alias of [1, 2] as const) {
        const id = config.ids[alias - 1],
          a = await request(
            alias === 1 ? "m1" : "m2",
            "connected_accounts/" + id,
            "GET",
          );
        accountIdentity(a, id, alias);
        if (a.status !== "ACTIVE" || a.is_disabled === true)
          return fail("SOURCE_ACCOUNT_NOT_ACTIVE");
        await profile(id, alias === 1 ? "profile_m1" : "profile_m2");
      }
      s.baseline = await history(config.ids[0], "baseline");
      await save();
      if (28 - (s.calls + 1) < 20) return fail("PROTECTED_RESERVE_BEFORE_LINK");
      await createLink(false);
      s.phase = "prepared";
      await save();
    } else if (action === "revoke") {
      if (s.revoke.status !== "not_sent") return reconnectReport(s);
      if (
        s.phase !== "prepared" ||
        s.links[0]?.status !== "confirmed" ||
        s.links[0].expiresAt! < clock.wallNow() + 180_000
      )
        return fail("VALID_PREPARED_LINK_REQUIRED");
      if (28 - s.calls < 20) return fail("PROTECTED_RESERVE_BEFORE_REVOKE");
      s.phase = "revoking";
      await save();
      try {
        const result = await request(
          "revoke",
          `connected_accounts/${config.ids[0]}/revoke`,
          "POST",
          undefined,
          "normal",
          s.revoke,
        );
        const account = obj(result.connected_account);
        if (account.id !== config.ids[0] || account.status !== "REVOKED")
          return fail("INVALID_REVOKE_RESULT");
        s.revoke.status = "confirmed";
        await save();
      } catch (e) {
        if (safeCode(e).startsWith("JOURNAL_")) throw e;
        if (!["uncertain"].includes(s.revoke.status)) throw e;
      }
      await proveRevocation();
    } else if (action === "reconcile") {
      if (
        s.revoke.status === "uncertain" ||
        (s.revoke.status === "confirmed" &&
          (!s.checks.revoked || !s.checks.denied || !s.checks.m2During))
      )
        await proveRevocation("retry");
      else {
        const l = s.links.at(-1);
        if (!l || l.status !== "uncertain" || l.reconciled)
          return fail("NO_UNCERTAIN_LINK_TO_RECONCILE");
        const query = new URLSearchParams({
          user_ids: src.boxes[0].owner,
          auth_config_ids: config.auth,
          toolkit_slugs: "gmail",
          limit: "20",
        });
        const data = await request(
          "reconcile_link",
          "connected_accounts?" + query,
          "GET",
          undefined,
          "retry",
        );
        if (
          !Array.isArray(data.items) ||
          data.items.length > 20 ||
          data.next_cursor
        )
          return fail("LINK_RECONCILIATION_INCOMPLETE");
        const candidates = data.items
          .map(obj)
          .filter((a) => a.alias === l.alias);
        if (candidates.length !== 1)
          return fail("LINK_RECONCILIATION_AMBIGUOUS");
        const a = candidates[0];
        if (!ca.safeParse(a.id).success || config.ids.includes(str(a.id)))
          return fail("LINK_RECONCILIATION_AMBIGUOUS");
        accountIdentity(a, str(a.id), 1);
        l.id = str(a.id);
        l.reconciled = true;
        s.phase = "blocked";
        s.error = "AUTH_LINK_SECRET_UNAVAILABLE";
        await save();
      }
    } else if (action === "verify") {
      if (
        !["await_auth", "recovery_required", "verifying"].includes(s.phase) ||
        !s.checks.m2During
      )
        return fail("REVOKE_REQUIRED");
      const l = s.links.at(-1)!;
      if (l.status !== "confirmed") return fail("CONFIRMED_LINK_REQUIRED");
      s.phase = "verifying";
      await save();
      const recovery = s.links.length === 2;
      if (!s.checks.active) {
        const start = clock.monoNow();
        while (l.statusChecks < (recovery ? 2 : 4)) {
          const due = start + [0, 15_000, 30_000, 60_000][l.statusChecks];
          if (clock.monoNow() < due) await sleep(due - clock.monoNow());
          l.statusChecks++;
          await save();
          const status = await candidateStatus(
            l,
            recovery ? "recovery" : "normal",
          );
          if (status === "ACTIVE") break;
          if (
            ["EXPIRED", "FAILED", "REVOKED"].includes(status) ||
            l.expiresAt! <= clock.wallNow()
          )
            return fail("OAUTH_LINK_EXPIRED_OR_FAILED");
        }
      }
      if (!s.checks.active) return fail("OAUTH_NOT_ACTIVE");
      if (!s.checks.profile) {
        await profile(
          l.id!,
          recovery ? "recovery_profile" : "profile_candidate",
          recovery ? "recovery" : "normal",
        );
        s.checks.profile = true;
        await save();
      }
      await finish();
    } else if (action === "recover") {
      if (
        !s.checks.revoked ||
        !s.checks.denied ||
        !s.checks.m2During ||
        !["recovery_required", "await_auth"].includes(s.phase)
      )
        return fail("RECOVERY_PREREQUISITES_MISSING");
      const l = s.links.at(-1)!;
      if (l.status !== "confirmed")
        return fail("UNCERTAIN_LINK_REQUIRES_RECONCILIATION");
      const status = await candidateStatus(l, "recovery");
      if (status === "ACTIVE") {
        if (!options.oauthCompleted) return fail("OAUTH_CONFIRMATION_REQUIRED");
        await profile(l.id!, "recovery_profile", "recovery");
        s.checks.profile = true;
        await save();
        await finish();
      } else {
        if (s.links.length !== 1) return fail("RECOVERY_LINK_LIMIT_REACHED");
        if (
          !["EXPIRED", "FAILED"].includes(status) &&
          l.expiresAt! > clock.wallNow()
        )
          return fail("RECOVERY_LINK_NOT_EXPIRED");
        await createLink(true);
        s.phase = "await_auth";
        delete s.error;
        await save();
      }
    }
  } catch (e) {
    const c = safeCode(e);
    if (c.startsWith("JOURNAL_") || c === "INVALID_RECONNECT_JOURNAL") throw e;
    for (const slot of [...s.links, s.revoke])
      if (slot.status === "in_flight") slot.status = "uncertain";
    s.error = c;
    s.phase =
      s.revoke.status === "uncertain"
        ? "revocation_uncertain"
        : s.revoke.status === "confirmed"
          ? "recovery_required"
          : "blocked";
    await save();
  }
  return reconnectReport(s);
}
