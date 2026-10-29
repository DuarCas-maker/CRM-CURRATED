// S00-A only: exact-thread observation, never a mailbox scanner or CRM worker.
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { validateRunState, type RunState } from "./s00-composio-runner";
import {
  composioConfiguration,
  composioJson,
  composioThreadMetadataUrl,
  retryAfterDelay,
  obj,
  str,
  hash,
  gmailId,
  gmailRoot,
  mailboxAddress,
  clean,
  fail,
  S00RunError,
  type Obj,
} from "./s00-composio-common";

const id = z.string().regex(/^[a-f0-9]{1,128}$/i);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.number().int().positive().safe();
const code = z.string().regex(/^[A-Z0-9_]{1,80}$/);
const op = z.enum([
  "usage_before",
  "config",
  "connection",
  "profile",
  "baseline",
  "poll",
  "recheck",
  "usage_after",
]);
type Operation = z.infer<typeof op>;
const eventSchema = z
  .object({
    id,
    receivedAt: time,
    requestStartedAt: time,
    httpReceivedAt: time,
    detectedAt: time,
    persistedAt: time.nullable(),
  })
  .strict();
const boxSchema = z
  .object({
    alias: z.union([z.literal(1), z.literal(2)]),
    baseline: z.array(id).max(20),
    polls: z.number().int().min(0).max(12),
    event: eventSchema.optional(),
    rechecked: z.boolean(),
  })
  .strict();
const clockSchema = z
  .object({
    synchronized: z.boolean(),
    uncertaintyMs: z.number().finite().min(0).nullable(),
  })
  .strict();
const usageSchema = z
  .object({
    instantCharge: z
      .string()
      .regex(/^\d+(?:\.\d+)?$/)
      .nullable(),
    remainingAllowanceKnown: z.literal(false),
  })
  .strict();
const observationSchema = z
  .object({
    version: z.literal(1),
    sourceHash: digest,
    fingerprint: digest,
    historicalCalls: z.literal(37),
    calls: z.number().int().min(0).max(40),
    authorizedTotal: z.literal(77),
    retries: z.number().int().min(0).max(5),
    phase: z.enum([
      "preflight",
      "baseline",
      "armed",
      "closing",
      "completed",
      "blocked",
      "interrupted",
    ]),
    armedAt: time.nullable(),
    ready: z.boolean(),
    clock: clockSchema,
    cadenceHealthy: z.boolean(),
    rounds: z.number().int().min(0).max(12),
    boxes: z.array(boxSchema).length(2),
    requests: z
      .array(
        z
          .object({
            op,
            alias: z.union([z.literal(1), z.literal(2)]).optional(),
            startedAt: time,
            httpReceivedAt: time.nullable(),
            result: code,
          })
          .strict(),
      )
      .max(40),
    error: code.optional(),
    usageError: code.optional(),
    usageBefore: usageSchema.optional(),
    usageAfter: usageSchema.optional(),
  })
  .strict();
export type ObservationState = z.infer<typeof observationSchema>;
type ObservationBox = ObservationState["boxes"][number];
export interface ObservationStore {
  load(): Promise<ObservationState | undefined>;
  save(state: ObservationState): Promise<void>;
}
export interface ObservationClock {
  wallNow(): number;
  monoNow(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export const systemObservationClock: ObservationClock = {
  wallNow: () => Date.now(),
  monoNow: () => performance.now(),
  sleep: async (ms, signal) => {
    await delay(ms, undefined, { signal });
  },
};
export function validateObservation(value: unknown): ObservationState {
  const parsed = observationSchema.safeParse(value);
  if (!parsed.success) return fail("INVALID_OBSERVATION_JOURNAL");
  const s = parsed.data;
  if (
    s.requests.length !== s.calls ||
    s.calls + s.historicalCalls > s.authorizedTotal ||
    s.retries > s.calls ||
    s.boxes.some(
      (b, i) =>
        b.alias !== i + 1 ||
        new Set(b.baseline).size !== b.baseline.length ||
        (b.event &&
          (!s.armedAt ||
            b.baseline.includes(b.event.id) ||
            b.event.receivedAt < s.armedAt ||
            b.event.requestStartedAt > b.event.httpReceivedAt ||
            b.event.httpReceivedAt > b.event.detectedAt ||
            (b.event.persistedAt !== null &&
              b.event.persistedAt < b.event.detectedAt))) ||
        (b.rechecked && !b.event),
    ) ||
    (s.ready && !s.armedAt) ||
    (s.phase === "completed" &&
      s.boxes.some((b) => !b.event?.persistedAt || !b.rechecked))
  )
    return fail("INVALID_OBSERVATION_JOURNAL");
  return s;
}
const clockValid = (s: ObservationState) =>
  s.clock.synchronized &&
  s.clock.uncertaintyMs !== null &&
  s.clock.uncertaintyMs <= 2000 &&
  s.cadenceHealthy;
export function observationReport(state?: ObservationState) {
  const s = state ? validateObservation(state) : undefined;
  const latencies =
    s?.boxes.flatMap((b) =>
      b.event?.persistedAt ? [b.event.persistedAt - b.event.receivedAt] : [],
    ) ?? [];
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    mode: s ? "s00_observation" : "offline_no_observation",
    phase: s?.phase ?? "not_started",
    historicalCalls: s?.historicalCalls ?? 37,
    newCalls: s?.calls ?? 0,
    totalCalls: 37 + (s?.calls ?? 0),
    proposedNewLimit: 40,
    proposedTotalLimit: 77,
    authorizationGrantedByReport: false,
    retries: s?.retries ?? 0,
    error: s?.error ?? null,
    usageError: s?.usageError ?? null,
    usageBefore: s?.usageBefore ?? null,
    usageAfter: s?.usageAfter ?? null,
    apiMessagesSent: 0,
    attachmentsDownloaded: 0,
    contentAnalyzed: false,
    crmReceptionProven: false,
    samples: latencies.length,
    p50Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.5) - 1] : null,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    maxMs: sorted.length ? sorted.at(-1) : null,
    statistics: "descriptive_nearest_rank_not_sla",
    rounds: s?.rounds ?? 0,
    mailboxes:
      s?.boxes.map((b) => ({
        alias: b.alias,
        polls: b.polls,
        eventCount: b.event?.persistedAt ? 1 : 0,
        duplicateCheck: b.rechecked,
        latencyMs: b.event?.persistedAt
          ? b.event.persistedAt - b.event.receivedAt
          : null,
        latencyAcceptance: !b.event?.persistedAt
          ? "not_observed"
          : !clockValid(s) || b.event.persistedAt < b.event.receivedAt
            ? "indeterminate"
            : b.event.persistedAt - b.event.receivedAt <= 60_000
              ? "pass"
              : "fail",
      })) ?? [],
  };
}

function completedSource(source: RunState) {
  validateRunState(source);
  if (
    source.calls !== 33 ||
    source.priorDiagnosticCalls !== 4 ||
    source.phase !== "prepared" ||
    !source.profilesVerified ||
    !source.includedCallsConfirmed ||
    source.attachmentPolicy !== "provided_pdfs_10mb" ||
    source.boxes[0].addressHash === source.boxes[1].addressHash ||
    source.boxes.some(
      (b) =>
        !clean(b.owner) ||
        !b.addressHash ||
        !b.response ||
        !b.confirmationVerified ||
        b.initial.status !== "sent" ||
        b.confirmation.status !== "sent" ||
        !gmailId(b.initial.id) ||
        !gmailId(b.initial.threadId) ||
        !gmailId(b.confirmation.id) ||
        b.confirmation.threadId !== b.initial.threadId,
    )
  )
    return fail("SOURCE_NOT_COMPLETED_OR_BASE_CHANGED");
}

// Metadata is rejected if fields selection was ignored; no full/raw fallback.
export function metadata(
  value: Obj,
  source: RunState,
  alias: 1 | 2,
  recipient: string,
) {
  const box = source.boxes[alias - 1];
  if (
    value.id !== box.initial.threadId ||
    Object.keys(value).some((k) => !["id", "messages"].includes(k)) ||
    !Array.isArray(value.messages) ||
    !value.messages.length ||
    value.messages.length > 20
  )
    return fail("METADATA_CONTRACT_MISMATCH");
  const seen = new Set<string>();
  const messages = value.messages.map((raw) => {
    const m = obj(raw),
      p = obj(m.payload);
    if (
      !gmailId(m.id) ||
      seen.has(str(m.id)) ||
      m.threadId !== box.initial.threadId ||
      Object.keys(m).some(
        (k) => !["id", "threadId", "internalDate", "payload"].includes(k),
      ) ||
      Object.keys(p).some((k) => k !== "headers") ||
      !Array.isArray(p.headers) ||
      p.headers.length > 100 ||
      typeof m.internalDate !== "string" ||
      !/^\d{1,16}$/.test(m.internalDate) ||
      !Number.isSafeInteger(Number(m.internalDate)) ||
      Number(m.internalDate) <= 0
    )
      return fail("METADATA_CONTRACT_MISMATCH");
    seen.add(str(m.id));
    const h: Record<string, string> = {};
    for (const header of p.headers) {
      const item = obj(header),
        name = str(item.name).toLowerCase();
      if (
        ![
          "from",
          "to",
          "subject",
          "message-id",
          "in-reply-to",
          "references",
        ].includes(name) ||
        name in h ||
        !clean(str(item.value))
      )
        return fail("INVALID_MESSAGE_HEADERS");
      h[name] = str(item.value);
    }
    const from = mailboxAddress(h.from ?? ""),
      to = mailboxAddress(h.to ?? "");
    if (
      !(
        (from === recipient && hash(to) === box.addressHash) ||
        (hash(from) === box.addressHash && to === recipient)
      ) ||
      (h.subject ?? "").replace(/^(?:re:\s*)+/i, "") !==
        "[S00 TEST] S00-COMPOSIO-" + source.token + "-M" + alias
    )
      return fail("WRONG_REPLY_HEADERS");
    return {
      id: str(m.id),
      receivedAt: Number(m.internalDate),
      inbound: from === recipient,
    };
  });
  if (
    !seen.has(box.initial.id!) ||
    !seen.has(box.confirmation.id!) ||
    !seen.has(box.response!.id)
  )
    return fail("SOURCE_MESSAGES_MISSING");
  return messages;
}
const safeCode = (e: unknown) =>
  e instanceof S00RunError && /^[A-Z0-9_]{1,80}$/.test(e.code)
    ? e.code
    : "LOCAL_OR_CONTRACT_ERROR";
const transient = (e: unknown) =>
  e instanceof S00RunError &&
  /^(NETWORK_OR_TIMEOUT|HTTP_(429|5\d\d)|UPSTREAM_(429|5\d\d))$/.test(e.code);

export async function observeComposio(
  env: Readonly<Record<string, string | undefined>>,
  source: RunState | undefined,
  store: ObservationStore,
  options: {
    execute?: boolean;
    authorizedTotal?: number;
    includedCallsConfirmed?: boolean;
    fetchImpl?: typeof fetch;
    clock?: ObservationClock;
    clockEvidence?: { synchronized: boolean; uncertaintyMs: number | null };
    signal?: AbortSignal;
    onReady?: () => void | Promise<void>;
  } = {},
) {
  let saved = await store.load();
  if (saved) saved = validateObservation(saved);
  if (!options.execute) return observationReport(saved);
  // Gate before configuration, journal writes, timers or any authenticated request.
  if (options.authorizedTotal !== 77 || !options.includedCallsConfirmed)
    return fail("OBSERVATION_AUTHORIZATION_REQUIRED");
  if (!source) return fail("SOURCE_REQUIRED");
  completedSource(source);
  const config = composioConfiguration(env);
  if (
    source.fingerprint !== config.fingerprint ||
    source.targetFingerprint !== config.targetFingerprint
  )
    return fail("CONFIGURATION_CHANGED");
  const sourceHash = hash(JSON.stringify(source));
  if (
    saved &&
    (saved.sourceHash !== sourceHash ||
      saved.fingerprint !== config.fingerprint)
  )
    return fail("CONFIGURATION_CHANGED");
  if (saved) {
    if (["preflight", "baseline", "armed", "closing"].includes(saved.phase)) {
      saved.phase = "interrupted";
      saved.error = "INTERRUPTED_REQUIRES_REVIEW";
      try {
        await store.save(saved);
      } catch {
        return fail("JOURNAL_WRITE_FAILED");
      }
    }
    return observationReport(saved); // Never rearm or retry a prior observation implicitly.
  }
  const clock = options.clock ?? systemObservationClock,
    fetchImpl = options.fetchImpl ?? fetch;
  const evidence = clockSchema.safeParse(
    options.clockEvidence ?? { synchronized: false, uncertaintyMs: null },
  );
  if (!evidence.success) return fail("INVALID_CLOCK_EVIDENCE");
  const s: ObservationState = {
    version: 1,
    sourceHash,
    fingerprint: config.fingerprint,
    historicalCalls: 37,
    authorizedTotal: 77,
    calls: 0,
    retries: 0,
    phase: "preflight",
    armedAt: null,
    ready: false,
    clock: evidence.data,
    cadenceHealthy: true,
    rounds: 0,
    boxes: [
      { alias: 1, baseline: [], polls: 0, rechecked: false },
      { alias: 2, baseline: [], polls: 0, rechecked: false },
    ],
    requests: [],
  };
  const save = async () => {
    validateObservation(s);
    try {
      await store.save(structuredClone(s));
    } catch {
      return fail("JOURNAL_WRITE_FAILED");
    }
  };
  await save();
  let anchorMono = 0,
    anchorWall = 0;
  const deadline = () => anchorMono + 360_000;
  const cancelled = () => {
    if (options.signal?.aborted) return fail("CANCELLED");
  };
  function checkClock() {
    if (
      s.armedAt &&
      Math.abs(clock.wallNow() - anchorWall - (clock.monoNow() - anchorMono)) >
        2000
    )
      s.cadenceHealthy = false;
  }
  const sleep = async (ms: number) => {
    cancelled();
    try {
      await clock.sleep(ms, options.signal);
    } catch {
      return fail(options.signal?.aborted ? "CANCELLED" : "CLOCK_WAIT_FAILED");
    }
    cancelled();
    checkClock();
  };
  const reserve = (kind: Operation) =>
    kind === "usage_after"
      ? 0
      : kind === "recheck"
        ? 1 + s.boxes.filter((b) => !b.rechecked).length - 1
        : 3;
  async function request(
    kind: Operation,
    path: string,
    method: "GET" | "POST",
    body?: Obj,
    alias?: 1 | 2,
  ) {
    let attempt = 0;
    for (;;) {
      cancelled();
      checkClock();
      if (kind === "poll" && clock.monoNow() + 8000 > deadline())
        return fail("OBSERVATION_DEADLINE");
      if (s.calls + 1 + reserve(kind) > 40 || 37 + s.calls + 1 > 77)
        return fail("CALL_BUDGET_EXHAUSTED");
      if (
        ![
          "project/usage/summary",
          "tools/execute/proxy",
          "auth_configs/" + config.auth,
          ...config.ids.map((i) => "connected_accounts/" + i),
        ].includes(path)
      )
        return fail("BLOCKED_ROUTE");
      if (path === "tools/execute/proxy") {
        const b = source!.boxes[(alias ?? 0) - 1];
        const url = new URL(str(body?.endpoint));
        const expected = threadUrl(alias!);
        if (
          !b ||
          body?.connected_account_id !== config.ids[alias! - 1] ||
          body.user_id !== b.owner ||
          body.method !== "GET" ||
          ![gmailRoot + "profile", expected].includes(url.href) ||
          body.body !== undefined
        )
          return fail("BLOCKED_GMAIL_ROUTE");
      }
      if (attempt > 0) s.retries++;
      s.calls++;
      const trace = {
        op: kind,
        alias,
        startedAt: clock.wallNow(),
        httpReceivedAt: null as number | null,
        result: "IN_FLIGHT",
      };
      s.requests.push(trace);
      await save();
      try {
        const response = await composioJson(
          fetchImpl,
          config.key,
          path,
          method,
          body,
          2_100_000,
          options.signal,
        );
        trace.httpReceivedAt = clock.wallNow();
        checkClock();
        if (path === "tools/execute/proxy" && response.status !== 200)
          throw new S00RunError(
            "UPSTREAM_" +
              (Number.isInteger(response.status) ? response.status : "INVALID"),
            retryAfterDelay(
              str(
                obj(response.headers)["retry-after"] ??
                  obj(response.headers)["Retry-After"],
              ),
              str(obj(response.headers).date ?? obj(response.headers).Date),
            ),
          );
        const data =
          path === "tools/execute/proxy" ? obj(response.data) : response;
        if (!Object.keys(data).length) return fail("INVALID_PROXY_RESPONSE");
        trace.result = "OK";
        await save();
        return {
          data,
          startedAt: trace.startedAt,
          httpReceivedAt: trace.httpReceivedAt,
        };
      } catch (e) {
        trace.result = safeCode(e);
        trace.httpReceivedAt ??= clock.wallNow();
        await save();
        if (!transient(e) || attempt >= 2 || s.retries >= 5) throw e;
        const wait = Math.max(
          attempt === 0 ? 5000 : 10000,
          e instanceof S00RunError ? e.retryAfterMs : 0,
        );
        if (
          wait > 360_000 ||
          (kind === "poll" && clock.monoNow() + wait + 8000 > deadline())
        )
          return fail("RETRY_EXCEEDS_DEADLINE");
        // Preserve closing slots before waiting, too.
        if (s.calls + 1 + reserve(kind) > 40)
          return fail("CALL_BUDGET_EXHAUSTED");
        await sleep(wait);
        attempt++;
      }
    }
  }
  function threadUrl(alias: 1 | 2) {
    return composioThreadMetadataUrl(
      source!.boxes[alias - 1].initial.threadId!,
    );
  }
  function proxyBody(alias: 1 | 2, endpoint: string) {
    return {
      connected_account_id: config.ids[alias - 1],
      user_id: source!.boxes[alias - 1].owner,
      endpoint,
      method: "GET",
    };
  }
  async function readThread(
    b: ObservationBox,
    kind: "baseline" | "poll" | "recheck",
  ) {
    const r = await request(
      kind,
      "tools/execute/proxy",
      "POST",
      proxyBody(b.alias, threadUrl(b.alias)),
      b.alias,
    );
    return {
      ...r,
      messages: metadata(r.data, source!, b.alias, config.recipient),
    };
  }
  async function usage(kind: "usage_before" | "usage_after") {
    const r = await request(kind, "project/usage/summary", "POST", {});
    return {
      instantCharge:
        typeof r.data.instant_charge === "string" &&
        /^\d+(?:\.\d+)?$/.test(r.data.instant_charge)
          ? r.data.instant_charge
          : null,
      remainingAllowanceKnown: false as const,
    };
  }
  let skipFinalUsage = false;
  try {
    s.usageBefore = await usage("usage_before");
    const auth = (await request("config", "auth_configs/" + config.auth, "GET"))
      .data;
    const scopes = obj(auth.credentials).scopes ?? obj(auth.credentials).scope;
    const declared = Array.isArray(scopes)
      ? scopes
      : str(scopes).split(/[\s,]+/);
    if (
      auth.id !== config.auth ||
      obj(auth.toolkit).slug !== "gmail" ||
      auth.enabled === false ||
      auth.is_disabled === true ||
      !declared.includes("https://www.googleapis.com/auth/gmail.readonly")
    )
      return fail("CONFIG_NOT_READY");
    for (const b of s.boxes) {
      const account = (
        await request(
          "connection",
          "connected_accounts/" + config.ids[b.alias - 1],
          "GET",
          undefined,
          b.alias,
        )
      ).data;
      if (
        account.id !== config.ids[b.alias - 1] ||
        account.status !== "ACTIVE" ||
        account.is_disabled === true ||
        obj(account.auth_config).id !== config.auth ||
        obj(account.toolkit).slug !== "gmail" ||
        account.user_id !== source.boxes[b.alias - 1].owner ||
        hash(
          str(obj(obj(account.state).val).displayName)
            .trim()
            .toLowerCase(),
        ) !== source.boxes[b.alias - 1].addressHash
      )
        return fail("MAILBOX_NOT_READY");
      const profile = (
        await request(
          "profile",
          "tools/execute/proxy",
          "POST",
          proxyBody(b.alias, gmailRoot + "profile"),
          b.alias,
        )
      ).data;
      if (
        hash(str(profile.emailAddress).toLowerCase()) !==
        source.boxes[b.alias - 1].addressHash
      )
        return fail("PROFILE_MISMATCH");
    }
    s.phase = "baseline";
    await save();
    for (const b of s.boxes)
      b.baseline = (await readThread(b, "baseline")).messages.map((m) => m.id);
    anchorWall = clock.wallNow();
    anchorMono = clock.monoNow();
    s.armedAt = anchorWall;
    s.phase = "armed";
    s.ready = true;
    await save();
    await options.onReady?.();
    for (let round = 0; round < 12; round++) {
      const due = anchorMono + round * 30_000;
      if (clock.monoNow() < due) await sleep(due - clock.monoNow());
      checkClock();
      if (clock.monoNow() - due > 5000) s.cadenceHealthy = false;
      s.rounds = round + 1;
      if (clock.monoNow() >= due + 30_000) {
        await save();
        continue;
      }
      for (const b of s.boxes) {
        if (b.event) continue;
        b.polls++;
        await save();
        const r = await readThread(b, "poll");
        const novel = r.messages.filter((m) => !b.baseline.includes(m.id));
        if (novel.some((m) => !m.inbound))
          return fail("UNEXPECTED_NEW_OUTBOUND");
        if (novel.length > 1) return fail("AMBIGUOUS_REPLY");
        if (!novel.length) continue;
        const m = novel[0];
        if (m.receivedAt < s.armedAt || m.receivedAt > clock.wallNow() + 2000)
          return fail("REPLY_TIME_OUTSIDE_WINDOW");
        b.event = {
          id: m.id,
          receivedAt: m.receivedAt,
          requestStartedAt: r.startedAt,
          httpReceivedAt: r.httpReceivedAt,
          detectedAt: clock.wallNow(),
          persistedAt: null,
        };
        await save(); // Commit first; a failed commit never yields a successful sample.
        b.event.persistedAt = clock.wallNow();
        await save();
      }
      if (s.boxes.every((b) => b.event)) break;
    }
    s.phase = "closing";
    await save();
    if (s.boxes.every((b) => b.event)) {
      for (const b of s.boxes) {
        const r = await readThread(b, "recheck");
        const novel = r.messages.filter((m) => !b.baseline.includes(m.id));
        if (
          novel.length !== 1 ||
          novel[0].id !== b.event!.id ||
          novel[0].receivedAt !== b.event!.receivedAt
        )
          return fail("RECHECK_MISMATCH");
        b.rechecked = true;
        await save();
      }
      s.phase = "completed";
    } else {
      s.phase = "blocked";
      s.error = "RESPONSES_NOT_OBSERVED";
    }
    await save();
  } catch (e) {
    s.phase = options.signal?.aborted ? "interrupted" : "blocked";
    s.error = safeCode(e);
    skipFinalUsage = /^(JOURNAL_|CANCELLED|(?:HTTP|UPSTREAM)_40[13])/.test(
      s.error,
    );
    if (s.error.startsWith("JOURNAL_")) throw e;
    await save();
  }
  if (!skipFinalUsage) {
    try {
      s.usageAfter = await usage("usage_after");
      await save();
    } catch (e) {
      if (safeCode(e).startsWith("JOURNAL_")) throw e;
      s.usageError = safeCode(e);
      await save();
    }
  }
  return observationReport(s);
}
