// In-process handler only: importing this module never listens, loads env or calls HTTP.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
export class WebhookError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const hash = (x: string) => createHash("sha256").update(x).digest("hex");

const fail = (code: string): never => {
  throw new WebhookError(code);
};
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const cReceiverManifestSchema = z
  .object({
    version: z.literal(1),
    sourceHash: digest,
    nonce: z.string().regex(/^[a-f0-9]{24}$/),
    url: z.string().url().max(512),
    startsAt: z.number().int().nonnegative(),
    endsAt: z.number().int().positive(),
    tokenHash: digest,
    dedupKeyHash: digest,
    controlled: z.literal(true),
    noAdditionalCost: z.literal(true),
    persistenceVerified: z.literal(true),
    logsRedacted: z.literal(true),
  })
  .strict();
export type CManifest = z.infer<typeof cReceiverManifestSchema>;
export function validateCManifest(value: unknown): CManifest {
  const p = cReceiverManifestSchema.safeParse(value);
  if (!p.success) return fail("C_INVALID_MANIFEST");
  const m = p.data,
    u = new URL(m.url);
  if (
    u.protocol !== "https:" ||
    m.url !== u.href ||
    (u.port && u.port !== "443") ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.hostname === "localhost" ||
    u.hostname.endsWith(".localhost") ||
    u.hostname.endsWith(".local") ||
    u.hostname.endsWith(".internal") ||
    /^[\d.]+$/.test(u.hostname) ||
    u.hostname.includes(":") ||
    !u.pathname.split("/").includes(m.nonce) ||
    m.endsAt - m.startsAt !== 120000 ||
    m.tokenHash === m.dedupKeyHash
  )
    fail("C_INVALID_MANIFEST");
  return m;
}
export function cSecrets(
  env: Readonly<Record<string, string | undefined>>,
  m: CManifest,
) {
  const token = env.INSTANTLY_S00_WEBHOOK_SECRET,
    key = env.INSTANTLY_S00_WEBHOOK_DEDUP_KEY;
  if (
    !token ||
    !key ||
    !/^[a-f0-9]{64}$/.test(token) ||
    !/^[a-f0-9]{64}$/.test(key) ||
    token === key ||
    token === env.INSTANTLY_API_KEY ||
    key === env.INSTANTLY_API_KEY ||
    hash(token) !== m.tokenHash ||
    hash(key) !== m.dedupKeyHash
  )
    return fail("C_SECRET_BINDING_CHANGED");
  return { token, key };
}
const receiptSchema = z
  .object({
    version: z.literal(1),
    manifestHash: digest,
    armedAt: z.number().int().nonnegative(),
    deadline: z.number().int().nonnegative(),
    closed: z.boolean(),
    receipts: z
      .array(
        z
          .object({
            digest,
            payloadDigest: digest,
            receivedAt: z.number().int().nonnegative(),
            contextValidated: z.boolean(),
            classification: z.enum(["accepted", "quarantined"]),
            duplicate: z.boolean(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
export type CReceiptState = z.infer<typeof receiptSchema>;
export function validateCReceipt(value: unknown): CReceiptState {
  const p = receiptSchema.safeParse(value);
  if (!p.success) return fail("C_INVALID_RECEIPT");
  const s = p.data;
  if (
    s.deadline <= s.armedAt ||
    s.deadline - s.armedAt > 120000 ||
    s.receipts.some(
      (r, i) =>
        r.receivedAt < s.armedAt ||
        r.receivedAt > s.deadline ||
        (i > 0 && r.receivedAt < s.receipts[i - 1].receivedAt) ||
        r.duplicate !==
          s.receipts.slice(0, i).some((x) => x.digest === r.digest) ||
        r.classification !==
          (r.contextValidated && (!i || s.receipts[0].digest === r.digest)
            ? "accepted"
            : "quarantined"),
    )
  )
    fail("C_INVALID_RECEIPT");
  return s;
}
export interface CReceiptStore {
  load(): Promise<CReceiptState | undefined>;
  transact(
    change: (previous: CReceiptState | undefined) => CReceiptState,
  ): Promise<void>;
}
export function receiptTransition(
  p: CReceiptState | undefined,
  n: CReceiptState,
) {
  validateCReceipt(n);
  if (!p) {
    if (n.closed || n.receipts.length) fail("C_RECEIPT_HISTORY_IMMUTABLE");
    return;
  }
  validateCReceipt(p);
  if (JSON.stringify(p) === JSON.stringify(n)) return;
  if (
    p.closed ||
    p.manifestHash !== n.manifestHash ||
    p.armedAt !== n.armedAt ||
    p.deadline !== n.deadline ||
    n.receipts.length < p.receipts.length ||
    n.receipts.length > p.receipts.length + 1 ||
    (n.closed && n.receipts.length !== p.receipts.length) ||
    p.receipts.some(
      (r, i) => JSON.stringify(r) !== JSON.stringify(n.receipts[i]),
    )
  )
    fail("C_RECEIPT_HISTORY_IMMUTABLE");
}
export function cPayloadDigest(value: unknown, key: string) {
  const canonical = (x: unknown, depth = 0): unknown => {
    if (depth > 32) fail("C_INVALID_CALLBACK");
    if (Array.isArray(x)) return x.map((v) => canonical(v, depth + 1));
    if (x && typeof x === "object")
      return Object.fromEntries(
        Object.keys(x)
          .sort()
          .map((k) => [
            k,
            canonical((x as Record<string, unknown>)[k], depth + 1),
          ]),
      );
    return x;
  };
  return createHmac("sha256", key)
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export type CObservation = {
  authenticated: boolean;
  contextValidated: boolean;
  conflict: boolean;
  payloadDigest: string | null;
  receivedAt: number | null;
};
export interface CReceiver {
  arm(): Promise<void>;
  observe(): Promise<CObservation>;
  close(): Promise<void>;
}
export function createCReceiver(input: {
  manifest: CManifest;
  workspace: string;
  campaign: string;
  token: string;
  key: string;
  store: CReceiptStore;
  now?: () => number;
}) {
  const m = validateCManifest(input.manifest),
    binding = hash(JSON.stringify(m)),
    now = input.now ?? Date.now;
  if (
    hash(input.token) !== m.tokenHash ||
    hash(input.key) !== m.dedupKeyHash ||
    input.token === input.key ||
    !/^[a-f0-9]{64}$/.test(input.token) ||
    !/^[a-f0-9]{64}$/.test(input.key)
  )
    fail("C_SECRET_BINDING_CHANGED");
  const checked = (p: CReceiptState | undefined) => {
    if (
      !p ||
      p.manifestHash !== binding ||
      p.armedAt < m.startsAt ||
      p.deadline !== m.endsAt
    )
      return fail("C_RECEIPT_BINDING_CHANGED");
    return validateCReceipt(p);
  };
  const control: CReceiver = {
    async arm() {
      const t = now();
      if (t < m.startsAt || t >= m.endsAt) fail("C_WINDOW_CLOSED");
      await input.store.transact((p) => {
        if (p) fail("C_RECEIVER_ALREADY_ARMED");
        return {
          version: 1,
          manifestHash: binding,
          armedAt: t,
          deadline: m.endsAt,
          closed: false,
          receipts: [],
        };
      });
    },
    async observe() {
      const p = checked(await input.store.load()),
        first = p.receipts[0];
      return {
        authenticated: !!first,
        contextValidated: !!first?.contextValidated,
        conflict: p.receipts.some((r) => r.digest !== first.digest),
        payloadDigest: first?.payloadDigest ?? null,
        receivedAt: first?.receivedAt ?? null,
      };
    },
    async close() {
      await input.store.transact((p) => ({ ...checked(p), closed: true }));
    },
  };
  const handler = async (request: Request): Promise<Response> => {
    const reply = (status: number) =>
      new Response(null, { status, headers: { "cache-control": "no-store" } });
    if (request.method !== "POST") return reply(405);
    if (request.url !== m.url) return reply(404);
    const supplied = request.headers.get("X-S00-Webhook-Token") ?? "";
    const wanted = createHash("sha256").update(input.token).digest(),
      actual = createHash("sha256").update(supplied).digest();
    if (!timingSafeEqual(wanted, actual)) return reply(401);
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("content-type") ?? "",
      )
    )
      return reply(415);
    if (Number(request.headers.get("content-length") ?? 0) > 262144)
      return reply(413);
    let p: CReceiptState;
    try {
      p = checked(await input.store.load());
    } catch {
      return reply(503);
    }
    if (p.closed || now() > p.deadline || now() < p.armedAt) return reply(410);
    const reader = request.body?.getReader();
    if (!reader) return reply(400);
    let timer: ReturnType<typeof setTimeout> | undefined, raw: Buffer;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TIMEOUT")), 8000);
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const r = await Promise.race([reader.read(), timeout]);
        if (r.done) break;
        size += r.value.byteLength;
        if (size > 262144) return reply(413);
        chunks.push(r.value);
      }
      raw = Buffer.concat(chunks);
    } catch {
      return reply(408);
    } finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    let data: Record<string, unknown>, payloadDigest: string;
    try {
      data = JSON.parse(raw.toString("utf8"));
      const schema = z.object({
        timestamp: z.string().datetime({ offset: true }).optional(),
        event_type: z.string().max(100).optional(),
        workspace: z.string().uuid().optional(),
        campaign_id: z.string().uuid().optional(),
      });
      if (!schema.safeParse(data).success) return reply(400);
      payloadDigest = cPayloadDigest(data, input.key);
    } catch {
      return reply(400);
    }
    const time = now(),
      eventTime =
        typeof data.timestamp === "string" ? Date.parse(data.timestamp) : NaN;
    const contextValidated =
      data.workspace === input.workspace &&
      data.campaign_id === input.campaign &&
      data.event_type === "reply_received" &&
      eventTime >= m.startsAt - 5000 &&
      eventTime <= time + 30000;
    const bodyDigest = createHmac("sha256", input.key)
      .update(raw)
      .digest("hex");
    let status = 200;
    try {
      await input.store.transact((previous) => {
        const s = checked(previous);
        if (s.closed || time > s.deadline || time < s.armedAt) {
          status = 410;
          return s;
        }
        if (s.receipts.length >= 16) {
          status = 429;
          return s;
        }
        const first = s.receipts[0];
        s.receipts.push({
          digest: bodyDigest,
          payloadDigest,
          receivedAt: time,
          contextValidated,
          classification:
            contextValidated && (!first || first.digest === bodyDigest)
              ? "accepted"
              : "quarantined",
          duplicate: s.receipts.some((r) => r.digest === bodyDigest),
        });
        return s;
      });
    } catch {
      return reply(503);
    }
    return reply(status);
  };
  return { ...control, handle: handler };
}
