// Shared S00 primitives; no env files, application runtime or implicit retries.
import { createHash } from "node:crypto";

export type Obj = Record<string, unknown>;
export const obj = (x: unknown): Obj =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {};
export const str = (x: unknown) => (typeof x === "string" ? x : "");
export const hash = (x: string | Uint8Array) =>
  createHash("sha256").update(x).digest("hex");
export const clean = (x: string) =>
  x.length > 0 && x.length < 8192 && !/[\r\n\x00]/.test(x);
export const email = (x: string) =>
  /^[A-Za-z0-9.!#$%&'*+/=?^_{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(x) &&
  x.length < 255;
export const gmailId = (x: unknown) => /^[a-f0-9]{1,128}$/i.test(str(x));
export const gmailRoot = "https://gmail.googleapis.com/gmail/v1/users/me/";
export class S00RunError extends Error {
  constructor(
    public code: string,
    public retryAfterMs = 0,
  ) {
    super(code);
  }
}
export const fail = (code: string): never => {
  throw new S00RunError(code);
};
export function mailboxAddress(header: string) {
  if (!clean(header)) return fail("INVALID_MAIL_HEADER");
  const match = header.match(/<([^<>]+)>$/);
  const value = (match ? match[1] : header).trim().toLowerCase();
  if (!email(value)) return fail("INVALID_MAIL_HEADER");
  return value;
}
export function composioConfiguration(
  env: Readonly<Record<string, string | undefined>>,
) {
  const key = env.COMPOSIO_API_KEY?.trim() ?? "",
    auth = env.COMPOSIO_AUTH_CONFIG_ID?.trim() ?? "";
  const ids = [
    env.COMPOSIO_CONNECTED_ACCOUNT_1_ID?.trim() ?? "",
    env.COMPOSIO_CONNECTED_ACCOUNT_2_ID?.trim() ?? "",
  ];
  const recipient = env.S00_TEST_RECIPIENT_EMAIL?.trim().toLowerCase() ?? "";
  if (
    !clean(key) ||
    /^(?:ac|ca)_/.test(key) ||
    !/^ac_[A-Za-z0-9_-]{1,128}$/.test(auth) ||
    ids.some((id) => !/^ca_[A-Za-z0-9_-]{1,128}$/.test(id)) ||
    ids[0] === ids[1] ||
    !email(recipient)
  )
    return fail("INVALID_CONFIGURATION");
  return {
    key,
    auth,
    ids,
    recipient,
    fingerprint: hash(JSON.stringify([hash(key), auth, ids, recipient])),
    targetFingerprint: hash(JSON.stringify([auth, ids, recipient])),
  };
}

export function retryAfterDelay(raw: string, serverDate: string) {
  if (!raw) return 0;
  if (/^\d{1,10}$/.test(raw)) return Number(raw) * 1000;
  const date = Date.parse(raw),
    server = Date.parse(serverDate);
  return Number.isFinite(date) && Number.isFinite(server)
    ? Math.max(0, date - server)
    : 360_000;
}
export async function composioJson(
  fetchImpl: typeof fetch,
  key: string,
  path: string,
  method: "GET" | "POST",
  body?: Obj,
  maxBytes = 2_100_000,
  signal?: AbortSignal,
  recognizeRevokedConnection = false,
) {
  // Both callers additionally restrict routes to the exact configured accounts.
  if (
    !/^(?:project\/usage\/summary|tools\/execute\/proxy|auth_configs\/ac_[A-Za-z0-9_-]{1,128}|connected_accounts\/ca_[A-Za-z0-9_-]{1,128})$/.test(
      path,
    ) ||
    method !==
      (/^(?:auth_configs|connected_accounts)\//.test(path) ? "GET" : "POST")
  )
    return fail("BLOCKED_ROUTE");
  return boundedComposioJson(
    fetchImpl,
    key,
    path,
    method,
    body,
    maxBytes,
    signal,
    200,
    recognizeRevokedConnection,
  );
}

// Internal transport shared by strict, separately allowlisted entry points.
export async function boundedComposioJson(
  fetchImpl: typeof fetch,
  key: string,
  path: string,
  method: "GET" | "POST",
  body: Obj | undefined,
  maxBytes: number,
  signal: AbortSignal | undefined,
  expectedStatus: 200 | 201,
  recognizeRevokedConnection = false,
) {
  const base = path.split("?")[0];
  const permitted =
    method === "GET"
      ? /^(?:auth_configs\/ac_[A-Za-z0-9_-]{1,128}|connected_accounts(?:\/ca_[A-Za-z0-9_-]{1,128})?)$/.test(
          base,
        )
      : /^(?:project\/usage\/summary|tools\/execute\/proxy|connected_accounts\/link|connected_accounts\/ca_[A-Za-z0-9_-]{1,128}\/revoke)$/.test(
          path,
        );
  if (
    !permitted ||
    (expectedStatus === 201) !== (path === "connected_accounts/link")
  )
    return fail("BLOCKED_ROUTE");
  let response: Response;
  try {
    response = await fetchImpl(
      "https://backend.composio.dev/api/v3.1/" + path,
      {
        method,
        headers: {
          "x-api-key": key,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "manual",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
      },
    );
  } catch {
    return fail(signal?.aborted ? "CANCELLED" : "NETWORK_OR_TIMEOUT");
  }
  try {
    const inspectRevocation =
      recognizeRevokedConnection &&
      path === "tools/execute/proxy" &&
      method === "POST" &&
      response.status === 422;
    if (response.status !== expectedStatus && !inspectRevocation) {
      throw new S00RunError(
        "HTTP_" + response.status,
        retryAfterDelay(
          response.headers.get("retry-after") ?? "",
          response.headers.get("date") ?? "",
        ),
      );
    }
    if (
      !(response.headers.get("content-type") ?? "").includes("application/json")
    )
      return fail("INVALID_RESPONSE");
    const reader = response.body?.getReader();
    if (!reader) return fail("INVALID_RESPONSE");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const p = await reader.read();
        if (p.done) break;
        total += p.value.length;
        if (total > (inspectRevocation ? Math.min(maxBytes, 32768) : maxBytes))
          return fail("RESPONSE_TOO_LARGE");
        chunks.push(p.value);
      }
    } catch (e) {
      if (e instanceof S00RunError) throw e;
      return fail(signal?.aborted ? "CANCELLED" : "NETWORK_OR_TIMEOUT");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return fail("INVALID_RESPONSE");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail("INVALID_RESPONSE");
    if (inspectRevocation) {
      // Classify only explicit provider errors; never expose their private text.
      const strings = (x: unknown, depth = 0): string[] => {
        if (typeof x === "string") return [x];
        if (!x || typeof x !== "object" || depth > 4) return [];
        return Object.values(x).flatMap((v) => strings(v, depth + 1));
      };
      const revoked = strings(value).some(
        (t) =>
          !/\bnot\b.{0,40}\brevoked\b|\b(?:isn't|wasn't)\b.{0,40}\brevoked\b/i.test(
            t,
          ) &&
          /\bconnected[\s_-]+account\b.{0,180}\brevoked\b|\brevoked\b.{0,80}\bconnected[\s_-]+account\b/i.test(
            t,
          ),
      );
      return fail(revoked ? "CONNECTION_REVOKED" : "HTTP_422");
    }
    return obj(value);
  } finally {
    await response.body?.cancel().catch(() => {});
  }
}

export function composioThreadMetadataUrl(threadId: string) {
  if (!gmailId(threadId)) return fail("INVALID_THREAD_ID");
  const url = new URL(gmailRoot + "threads/" + threadId);
  url.searchParams.set("format", "metadata");
  for (const h of [
    "From",
    "To",
    "Subject",
    "Message-ID",
    "In-Reply-To",
    "References",
  ])
    url.searchParams.append("metadataHeaders", h);
  url.searchParams.set(
    "fields",
    "id,messages(id,threadId,internalDate,payload(headers))",
  );
  return url.href;
}
