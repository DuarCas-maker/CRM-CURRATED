import { gmailResponseError } from "../../gmail-errors";
import { gmailRequestOperation } from "../../gmail-quota";
import {
  gmailApiRoot,
  type GmailRequest,
  type PreparedGmailTransport,
  type ResolvedComposioBinding,
} from "./contract";
import { MailTransportError } from "./errors";

export const composioProxyUrl =
  "https://backend.composio.dev/api/v3.1/tools/execute/proxy";
export const proxyRequestLimit = 40 * 1024 * 1024;
export const proxyResponseLimit = 32 * 1024 * 1024;
const gmailId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{1,128}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const email = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 254 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(v);
const base64url = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[A-Za-z0-9_-]*={0,2}$/.test(v) &&
  v.replace(/=+$/, "").length % 4 !== 1 &&
  (!v.includes("=") || v.length % 4 === 0);
const clean = (v: unknown, max = 1024): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  !/[\x00-\x20\x7f]/.test(v);
const invalidRequest = (): never => {
  throw new MailTransportError("INVALID_GMAIL_REQUEST");
};

function bindingSnapshot(value: ResolvedComposioBinding) {
  if (
    !value ||
    typeof value.accountId !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.accountId) ||
    typeof value.connectedAccountId !== "string" ||
    !/^ca_[A-Za-z0-9_-]{1,128}$/.test(value.connectedAccountId) ||
    typeof value.authConfigId !== "string" ||
    !/^ac_[A-Za-z0-9_-]{1,128}$/.test(value.authConfigId) ||
    !clean(value.userId) ||
    !email(value.mailboxEmail) ||
    !email(value.verifiedMailboxEmail) ||
    value.mailboxEmail.toLowerCase() !==
      value.verifiedMailboxEmail.toLowerCase() ||
    value.identityVerified !== true ||
    value.status !== "active" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.quotaProjectId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.quotaProjectId)
  )
    throw new MailTransportError("INVALID_COMPOSIO_BINDING");
  return Object.freeze({ ...value });
}

type Resource =
  | "profile"
  | "history"
  | "messages"
  | "message"
  | "thread"
  | "attachment"
  | "signature"
  | "send";

function requestSnapshot(
  request: GmailRequest,
  binding: ResolvedComposioBinding,
) {
  if (!request || typeof request !== "object") return invalidRequest();
  const { path, init = {} } = request;
  if (
    !init ||
    typeof init !== "object" ||
    typeof path !== "string" ||
    path.length > 16384 ||
    /[\x00-\x20\x7f#\\]/.test(path) ||
    path.split("?").length > 2 ||
    Object.keys(init).some(
      (k) => !["method", "body", "headers", "signal"].includes(k),
    )
  )
    return invalidRequest();
  let headers: Headers;
  try {
    headers = new Headers(init.headers);
  } catch {
    return invalidRequest();
  }
  if (
    [...headers].some(
      ([k, v]) =>
        k !== "content-type" || v.toLowerCase() !== "application/json",
    ) ||
    (init.signal != null && !(init.signal instanceof AbortSignal))
  )
    return invalidRequest();
  const method = init.method ?? "GET";
  const [resource, query = ""] = path.split("?");
  let kind: Resource, keys: string[];
  if (resource === "profile") {
    kind = "profile";
    keys = ["fields"];
  } else if (resource === "history") {
    kind = "history";
    keys = [
      "fields",
      "startHistoryId",
      "maxResults",
      "pageToken",
      "historyTypes",
      "labelId",
    ];
  } else if (resource === "messages") {
    kind = "messages";
    keys = [
      "fields",
      "q",
      "maxResults",
      "pageToken",
      "includeSpamTrash",
      "labelIds",
    ];
  } else if (/^messages\/[a-f0-9]{1,128}$/i.test(resource)) {
    kind = "message";
    keys = ["fields", "format", "metadataHeaders"];
  } else if (/^threads\/[a-f0-9]{1,128}$/i.test(resource)) {
    kind = "thread";
    keys = ["fields", "format", "metadataHeaders"];
  } else if (
    /^messages\/[a-f0-9]{1,128}\/attachments\/[A-Za-z0-9_-]{1,2048}$/i.test(
      resource,
    )
  ) {
    kind = "attachment";
    keys = ["fields"];
  } else if (resource.startsWith("settings/sendAs/")) {
    const encoded = resource.slice("settings/sendAs/".length);
    let address: string;
    try {
      address = decodeURIComponent(encoded);
    } catch {
      return invalidRequest();
    }
    if (
      !email(address) ||
      encodeURIComponent(address) !== encoded ||
      address.toLowerCase() !== binding.mailboxEmail.toLowerCase()
    )
      return invalidRequest();
    kind = "signature";
    keys = ["fields"];
  } else if (resource === "messages/send") {
    kind = "send";
    keys = [];
  } else return invalidRequest();
  if (method !== (kind === "send" ? "POST" : "GET")) return invalidRequest();
  const params = new URLSearchParams(query);
  for (const [key, value] of params) {
    if (!keys.includes(key) || /[\x00-\x1f\x7f]/.test(value))
      return invalidRequest();
  }
  let body: Record<string, unknown> | undefined;
  if (kind === "send") {
    if (typeof init.body !== "string") return invalidRequest();
    if (Buffer.byteLength(init.body) > proxyRequestLimit)
      throw new MailTransportError("MAIL_REQUEST_TOO_LARGE");
    try {
      const parsed: unknown = JSON.parse(init.body);
      if (
        !record(parsed) ||
        Object.keys(parsed).some((k) => !["raw", "threadId"].includes(k)) ||
        !base64url(parsed.raw) ||
        parsed.raw.length === 0 ||
        (parsed.threadId !== undefined && !gmailId(parsed.threadId))
      )
        return invalidRequest();
      body = parsed;
    } catch (error) {
      if (error instanceof MailTransportError) throw error;
      return invalidRequest();
    }
  } else if (init.body != null) return invalidRequest();
  return {
    path,
    kind,
    method,
    endpoint: gmailApiRoot + resource + (query ? "?" + params.toString() : ""),
    body,
    signal: init.signal,
  };
}

function validData(
  kind: Resource,
  data: unknown,
  binding: ResolvedComposioBinding,
  path: string,
) {
  if (!record(data)) return false;
  const cursorOk =
    data.nextPageToken === undefined || clean(data.nextPageToken, 8192);
  const messagesOk = (v: unknown) =>
    Array.isArray(v) &&
    v.every(
      (m) =>
        record(m) &&
        gmailId(m.id) &&
        (m.threadId === undefined || gmailId(m.threadId)),
    );
  switch (kind) {
    case "profile":
      return (
        email(data.emailAddress) &&
        data.emailAddress.toLowerCase() ===
          binding.mailboxEmail.toLowerCase() &&
        typeof data.historyId === "string" &&
        /^\d{1,40}$/.test(data.historyId)
      );
    case "messages":
      return (
        cursorOk && (data.messages === undefined || messagesOk(data.messages))
      );
    case "history":
      return (
        cursorOk &&
        typeof data.historyId === "string" &&
        /^\d{1,40}$/.test(data.historyId) &&
        (data.history === undefined ||
          (Array.isArray(data.history) &&
            data.history.every(
              (h) =>
                record(h) &&
                (h.messagesAdded === undefined ||
                  (Array.isArray(h.messagesAdded) &&
                    h.messagesAdded.every(
                      (entry) =>
                        record(entry) &&
                        record(entry.message) &&
                        gmailId(entry.message.id),
                    ))),
            )))
      );
    case "message":
      return (
        gmailId(data.id) &&
        data.id === path.split("?")[0].split("/")[1] &&
        (data.threadId === undefined || gmailId(data.threadId))
      );
    case "thread":
      return (
        gmailId(data.id) &&
        data.id === path.split("?")[0].split("/")[1] &&
        (data.messages === undefined || messagesOk(data.messages))
      );
    case "attachment":
      return (
        base64url(data.data) &&
        (data.size === undefined ||
          (Number.isSafeInteger(data.size) &&
            Number(data.size) >= 0 &&
            data.size ===
              Math.floor((data.data.replace(/=+$/, "").length * 3) / 4)))
      );
    case "send":
      return gmailId(data.id) && gmailId(data.threadId);
    case "signature":
      return (
        (email(data.sendAsEmail) ||
          typeof data.signature === "string" ||
          typeof data.displayName === "string") &&
        (data.sendAsEmail === undefined ||
          (email(data.sendAsEmail) &&
            data.sendAsEmail.toLowerCase() ===
              binding.mailboxEmail.toLowerCase())) &&
        (data.signature === undefined || typeof data.signature === "string") &&
        (data.displayName === undefined || typeof data.displayName === "string")
      );
  }
}

// Bound even injected transports/streams that do not implement AbortSignal.
function withAbort<T>(
  work: () => Promise<T>,
  signal: AbortSignal,
  uncertain: boolean,
  discardLate?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new MailTransportError("COMPOSIO_NETWORK_OR_TIMEOUT", uncertain));
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      work().then(
        (value) => {
          signal.removeEventListener("abort", abort);
          if (signal.aborted) discardLate?.(value);
          else resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    } catch (error) {
      signal.removeEventListener("abort", abort);
      reject(error);
    }
  });
}

async function readJson(
  response: Response,
  signal: AbortSignal,
  uncertain: boolean,
) {
  const fail = (
    code:
      | "COMPOSIO_INVALID_RESPONSE"
      | "MAIL_RESPONSE_TOO_LARGE"
      | "COMPOSIO_NETWORK_OR_TIMEOUT",
  ): never => {
    throw new MailTransportError(code, uncertain);
  };
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      response.headers.get("content-type") ?? "",
    )
  )
    return fail("COMPOSIO_INVALID_RESPONSE");
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > proxyResponseLimit)
  )
    return fail("MAIL_RESPONSE_TOO_LARGE");
  const reader = response.body?.getReader();
  if (!reader) return fail("COMPOSIO_INVALID_RESPONSE");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await withAbort(() => reader.read(), signal, uncertain);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > proxyResponseLimit) return fail("MAIL_RESPONSE_TOO_LARGE");
      chunks.push(chunk.value);
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      ) as unknown;
    } catch {
      return fail("COMPOSIO_INVALID_RESPONSE");
    }
  } catch (error) {
    if (error instanceof MailTransportError) throw error;
    return fail("COMPOSIO_NETWORK_OR_TIMEOUT");
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function composioProxyTransport(options: {
  apiKey: string;
  binding: ResolvedComposioBinding;
  fetchImpl: typeof fetch;
}): PreparedGmailTransport {
  if (
    !clean(options.apiKey, 8192) ||
    !/^[\x21-\x7e]+$/.test(options.apiKey) ||
    /^(?:ac|ca)_/.test(options.apiKey) ||
    typeof options.fetchImpl !== "function"
  )
    throw new MailTransportError("INVALID_TRANSPORT_CONFIGURATION");
  const binding = bindingSnapshot(options.binding);
  const { apiKey, fetchImpl } = options;
  return {
    provider: "composio",
    async execute<T>(request: GmailRequest) {
      const r = requestSnapshot(request, binding);
      const uncertain = r.kind === "send";
      const body = JSON.stringify({
        connected_account_id: binding.connectedAccountId,
        user_id: binding.userId,
        endpoint: r.endpoint,
        method: r.method,
        ...(r.body ? { body: r.body } : {}),
      });
      if (Buffer.byteLength(body) > proxyRequestLimit)
        throw new MailTransportError("MAIL_REQUEST_TOO_LARGE");
      const signal = r.signal
        ? AbortSignal.any([r.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000);
      if (signal.aborted)
        throw new MailTransportError("COMPOSIO_NETWORK_OR_TIMEOUT");
      let response: Response;
      try {
        response = await withAbort(
          () =>
            fetchImpl(composioProxyUrl, {
              method: "POST",
              headers: {
                "x-api-key": apiKey,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body,
              redirect: "manual",
              signal,
            }),
          signal,
          uncertain,
          (late) => {
            void late.body?.cancel().catch(() => {});
          },
        );
      } catch {
        throw new MailTransportError("COMPOSIO_NETWORK_OR_TIMEOUT", uncertain);
      }
      try {
        if (
          response.redirected ||
          (response.status >= 300 && response.status < 400)
        )
          throw new MailTransportError(
            "COMPOSIO_REDIRECT_REJECTED",
            uncertain,
            response.status,
          );
        if (response.status !== 200) {
          const retry = response.headers.get("retry-after") ?? "";
          const seconds = /^\d+$/.test(retry)
            ? Math.min(Number(retry), 86400)
            : 0;
          throw new MailTransportError(
            [401, 403].includes(response.status)
              ? "COMPOSIO_AUTH_REJECTED"
              : response.status === 429
                ? "COMPOSIO_RATE_LIMITED"
                : response.status >= 500
                  ? "COMPOSIO_UNAVAILABLE"
                  : "COMPOSIO_HTTP_REJECTED",
            uncertain,
            response.status,
            seconds,
          );
        }
        const envelope = await readJson(response, signal, uncertain);
        if (
          !record(envelope) ||
          !Number.isInteger(envelope.status) ||
          Number(envelope.status) < 200 ||
          Number(envelope.status) > 599 ||
          (Number(envelope.status) >= 300 && Number(envelope.status) < 400)
        )
          throw new MailTransportError("COMPOSIO_INVALID_RESPONSE", uncertain);
        if (envelope.status !== 200) {
          if (Number(envelope.status) < 400)
            throw new MailTransportError(
              "COMPOSIO_INVALID_RESPONSE",
              uncertain,
            );
          const error = await gmailResponseError(
            new Response(
              JSON.stringify(record(envelope.data) ? envelope.data : {}),
              {
                status: Number(envelope.status),
                headers: { "content-type": "application/json" },
              },
            ),
          );
          error.operation = gmailRequestOperation(r.path, r.method);
          throw error;
        }
        if (!validData(r.kind, envelope.data, binding, r.path))
          throw new MailTransportError("COMPOSIO_INVALID_RESPONSE", uncertain);
        return envelope.data as T;
      } finally {
        void response.body?.cancel().catch(() => {});
      }
    },
  };
}
