// Standalone S00 test runner. No env-file loading, SDK retries or application hooks.
import { randomBytes } from "node:crypto";
import {
  obj,
  str,
  hash,
  email,
  clean,
  gmailId,
  gmailRoot,
  mailboxAddress,
  fail,
  S00RunError,
  composioConfiguration,
  composioJson,
  type Obj,
} from "./s00-composio-common";
export { S00RunError } from "./s00-composio-common";
const fixtureHash =
  "57d85b15535c0ad501519b0d65537b9e05cda7fe2a6a89f6b5ef12b2820096bd";
const fixtureName = "S00-composio-fixture.pdf";
const fixtureBytes = 2263;
const sendStates = [
  "not_sent",
  "in_flight",
  "sent",
  "uncertain",
  "failed",
] as const;
type SendState = (typeof sendStates)[number];
type Send = { status: SendState; id?: string; threadId?: string; at?: string };
type ReceivedPdf = { bytes: number; sha256: string };
type Box = {
  alias: 1 | 2;
  owner: string;
  addressHash: string;
  polls: number;
  initial: Send;
  confirmation: Send;
  response?: {
    id: string;
    attachmentHash: string;
    detectedAt: string;
    receivedAt: number;
    verification?: "provided_pdfs";
    attachments?: ReceivedPdf[];
  };
  confirmationVerified?: boolean;
};
export type RunState = {
  version: 1;
  phase: "preparing" | "prepared" | "blocked";
  fingerprint: string;
  targetFingerprint?: string;
  token: string;
  calls: number;
  profilesVerified: boolean;
  includedCallsConfirmed: boolean;
  boxes: Box[];
  usageBefore?: Usage;
  usageAfter?: Usage;
  lastError?: string;
  attachmentPolicy?: "provided_pdfs_10mb";
  priorDiagnosticCalls?: number;
};
type Usage = {
  instantCharge: string | null;
  eventCount: number | null;
  remainingAllowanceKnown: false;
};
export interface RunStore {
  load(): Promise<RunState | undefined>;
  save(state: RunState): Promise<void>;
}
export function decodeBase64url(value: unknown, maxBytes = 1_000_000): Buffer {
  const x = str(value);
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > 10_000_000 ||
    x.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
    x.replace(/=+$/, "").length % 4 === 1 ||
    !/^[A-Za-z0-9_-]*={0,2}$/.test(x)
  )
    return fail("INVALID_BASE64");
  const result = Buffer.from(x, "base64url");
  if (result.length > maxBytes) return fail("FILE_TOO_LARGE");
  return result;
}
const callLimit = (state: RunState) =>
  (state.attachmentPolicy === "provided_pdfs_10mb" ? 40 : 32) -
  (state.priorDiagnosticCalls ?? 0);
export function mime(
  from: string,
  to: string,
  subject: string,
  body: string,
  messageId: string,
  inReplyTo?: string,
  references: string[] = [],
) {
  if (
    ![from, to].every(email) ||
    !clean(subject) ||
    !/^<[^<>\s]+@[^<>\s]+>$/.test(messageId)
  )
    return fail("INVALID_MIME");
  if (inReplyTo && !/^<[^<>\s]+@[^<>\s]+>$/.test(inReplyTo))
    return fail("INVALID_MIME");
  if (references.some((x) => !/^<[^<>\s]+@[^<>\s]+>$/.test(x)))
    return fail("INVALID_MIME");
  return Buffer.from(
    [
      "From: " + from,
      "To: " + to,
      "Subject: " + subject,
      "Message-ID: " + messageId,
      ...(inReplyTo
        ? [
            "In-Reply-To: " + inReplyTo,
            "References: " + [...new Set([...references, inReplyTo])].join(" "),
          ]
        : []),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body).toString("base64"),
    ].join("\r\n"),
  ).toString("base64url");
}
export function publicRunReport(state?: RunState) {
  const usageReport = (usage?: Usage) =>
    usage
      ? {
          instantCharge:
            typeof usage.instantCharge === "string" &&
            /^\d+(?:\.\d+)?$/.test(usage.instantCharge)
              ? usage.instantCharge
              : null,
          eventCount: Number.isSafeInteger(usage.eventCount)
            ? usage.eventCount
            : null,
          remainingAllowanceKnown: false,
        }
      : null;
  return {
    mode: state ? "s00_controlled_run" : "offline_no_run",
    calls: (state?.calls ?? 0) + (state?.priorDiagnosticCalls ?? 0),
    runnerCalls: state?.calls ?? 0,
    priorDiagnosticCalls: state?.priorDiagnosticCalls ?? 0,
    maxCalls: state ? callLimit(state) + (state.priorDiagnosticCalls ?? 0) : 32,
    attachmentPolicy: state?.attachmentPolicy ?? "known_fixture",
    phase: state?.phase ?? "not_prepared",
    token: state?.token ?? null,
    includedCallsConfirmed: state?.includedCallsConfirmed ?? false,
    monthlyAllowanceExposedByApi: false,
    usageBefore: usageReport(state?.usageBefore),
    usageAfter: usageReport(state?.usageAfter),
    error: state?.lastError ?? null,
    mailboxes:
      state?.boxes.map((b) => ({
        alias: b.alias,
        subject: "[S00 TEST] S00-COMPOSIO-" + state.token + "-M" + b.alias,
        initial: b.initial.status,
        confirmation: b.confirmation.status,
        polls: b.polls,
        responseDetected: !!b.response,
        attachmentHashVerified: b.response?.attachmentHash === fixtureHash,
        attachmentVerification: !b.response
          ? "pending"
          : b.response.verification === "provided_pdfs"
            ? "bytes_size_signature_sha256"
            : "known_fixture_hash",
        sourceHashCompared:
          !!b.response && b.response.verification !== "provided_pdfs",
        receivedPdfCount:
          b.response?.verification === "provided_pdfs"
            ? (b.response.attachments?.length ?? 0)
            : b.response
              ? 1
              : 0,
        receivedPdfBytes:
          b.response?.verification === "provided_pdfs"
            ? (b.response.attachments?.reduce(
                (total, a) => total + a.bytes,
                0,
              ) ?? 0)
            : b.response
              ? fixtureBytes
              : 0,
        pdfContentAnalyzed: false,
        confirmationVerified: !!b.confirmationVerified,
        latencyMs: b.response
          ? Date.parse(b.response.detectedAt) - b.response.receivedAt
          : null,
      })) ?? [],
  };
}
export function validateRunState(value: unknown): RunState {
  const s = value as RunState;
  if (
    !s ||
    s.version !== 1 ||
    !["preparing", "prepared", "blocked"].includes(s.phase) ||
    !/^[a-f0-9]{12}$/.test(s.token) ||
    !/^[a-f0-9]{64}$/.test(s.fingerprint) ||
    (s.targetFingerprint !== undefined &&
      !/^[a-f0-9]{64}$/.test(s.targetFingerprint)) ||
    !Number.isInteger(s.calls) ||
    s.calls < 0 ||
    (s.priorDiagnosticCalls !== undefined &&
      (!Number.isSafeInteger(s.priorDiagnosticCalls) ||
        s.priorDiagnosticCalls < 0 ||
        s.priorDiagnosticCalls > 4)) ||
    (s.attachmentPolicy !== undefined &&
      s.attachmentPolicy !== "provided_pdfs_10mb") ||
    s.calls > callLimit(s) ||
    typeof s.profilesVerified !== "boolean" ||
    typeof s.includedCallsConfirmed !== "boolean" ||
    (s.lastError !== undefined && !/^[A-Z0-9_]{1,80}$/.test(s.lastError)) ||
    !Array.isArray(s.boxes) ||
    s.boxes.length !== 2
  )
    return fail("INVALID_JOURNAL");
  for (const [i, b] of s.boxes.entries()) {
    if (
      b.alias !== i + 1 ||
      typeof b.owner !== "string" ||
      (b.owner && !clean(b.owner)) ||
      !/^(?:[a-f0-9]{64})?$/.test(b.addressHash) ||
      !Number.isInteger(b.polls) ||
      b.polls < 0 ||
      b.polls > 7 ||
      !b.initial ||
      !b.confirmation ||
      !sendStates.includes(b.initial.status) ||
      !sendStates.includes(b.confirmation.status)
    )
      return fail("INVALID_JOURNAL");
    for (const send of [b.initial, b.confirmation])
      if (
        (send.id && !gmailId(send.id)) ||
        (send.threadId && !gmailId(send.threadId))
      )
        return fail("INVALID_JOURNAL");
    if (
      b.response &&
      (!gmailId(b.response.id) ||
        (b.response.verification === "provided_pdfs"
          ? s.attachmentPolicy !== "provided_pdfs_10mb" ||
            !/^[a-f0-9]{64}$/.test(b.response.attachmentHash) ||
            !Array.isArray(b.response.attachments) ||
            b.response.attachments.length < 1 ||
            b.response.attachments.length > 2 ||
            b.response.attachments.some(
              (a) =>
                !a ||
                !Number.isSafeInteger(a.bytes) ||
                a.bytes < 5 ||
                a.bytes > 10_000_000 ||
                !/^[a-f0-9]{64}$/.test(a.sha256),
            ) ||
            b.response.attachmentHash !==
              hash(JSON.stringify(b.response.attachments))
          : b.response.verification !== undefined ||
            b.response.attachmentHash !== fixtureHash) ||
        !Number.isFinite(b.response.receivedAt) ||
        !Number.isFinite(Date.parse(b.response.detectedAt)))
    )
      return fail("INVALID_JOURNAL");
  }
  return s;
}
export async function runComposioTest(
  env: Readonly<Record<string, string | undefined>>,
  store: RunStore,
  action: "status" | "prepare" | "send" | "inspect" | "confirm" | "usage",
  options: {
    execute?: boolean;
    includedCallsConfirmed?: boolean;
    providedPdfsAuthorized?: boolean;
    fetchImpl?: typeof fetch;
  } = {},
) {
  let state = await store.load();
  if (state) validateRunState(state);
  if (!options.execute || action === "status") return publicRunReport(state);
  const { key, auth, ids, recipient, fingerprint, targetFingerprint } =
    composioConfiguration(env);
  const canRevalidate =
    !!state &&
    action === "prepare" &&
    state.phase === "blocked" &&
    state.lastError === "HTTP_403" &&
    state.profilesVerified === false &&
    state.boxes.every(
      (box) =>
        box.initial.status === "not_sent" &&
        box.confirmation.status === "not_sent" &&
        !box.response &&
        box.polls === 0,
    );
  if (
    state &&
    state.fingerprint !== fingerprint &&
    !(canRevalidate && state.targetFingerprint === targetFingerprint)
  )
    return fail("CONFIGURATION_CHANGED");
  if (state && canRevalidate) {
    if (state.targetFingerprint !== targetFingerprint)
      return fail("JOURNAL_TARGET_BINDING_REQUIRED");
    state.phase = "preparing";
    state.fingerprint = fingerprint;
    delete state.lastError;
    await store.save(state);
  }
  if (!state) {
    if (action !== "prepare") return fail("PREPARE_REQUIRED");
    state = {
      version: 1,
      phase: "preparing",
      fingerprint,
      targetFingerprint,
      token: randomBytes(6).toString("hex"),
      calls: 0,
      profilesVerified: false,
      includedCallsConfirmed: false,
      boxes: [1, 2].map((alias) => ({
        alias,
        owner: "",
        addressHash: "",
        polls: 0,
        initial: { status: "not_sent" },
        confirmation: { status: "not_sent" },
      })) as Box[],
    };
    await store.save(state);
  }
  const s = state;
  const save = async () => {
    try {
      await store.save(s);
    } catch {
      return fail("JOURNAL_WRITE_FAILED");
    }
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  if (options.providedPdfsAuthorized && !s.attachmentPolicy) {
    if (
      action !== "inspect" ||
      !s.profilesVerified ||
      !s.includedCallsConfirmed ||
      !(
        s.phase === "prepared" ||
        (s.phase === "blocked" && s.lastError === "ACK_TOKEN_MISSING")
      ) ||
      s.boxes.some(
        (b) =>
          b.initial.status !== "sent" ||
          b.confirmation.status !== "not_sent" ||
          b.response,
      )
    )
      return fail("UNSAFE_ATTACHMENT_POLICY_TRANSITION");
    s.attachmentPolicy = "provided_pdfs_10mb";
    s.phase = "prepared";
    delete s.lastError;
    await save();
  }
  async function request(path: string, method: "GET" | "POST", body?: Obj) {
    if (s.calls >= callLimit(s)) return fail("CALL_BUDGET_EXHAUSTED");
    if (!(
      path === "project/usage/summary" ||
      path === "tools/execute/proxy" ||
      path === "auth_configs/" + auth ||
      ids.some((id) => path === "connected_accounts/" + id)
    ))
      return fail("BLOCKED_ROUTE");
    s.calls++;
    await save();
    return composioJson(
      fetchImpl,
      key,
      path,
      method,
      body,
      s.attachmentPolicy === "provided_pdfs_10mb" &&
        path === "tools/execute/proxy" &&
        str(body?.endpoint).includes("/attachments/")
        ? 14_000_000
        : 2_100_000,
    );
  }
  async function usage(): Promise<Usage> {
    const value = await request("project/usage/summary", "POST", {});
    const entities = Object.values(obj(value.entities));
    return {
      instantCharge:
        typeof value.instant_charge === "string" &&
        /^\d+(?:\.\d+)?$/.test(value.instant_charge)
          ? value.instant_charge
          : null,
      eventCount:
        entities.length &&
        entities.every((x) => Number.isSafeInteger(obj(x).event_count))
          ? entities.reduce<number>((a, x) => a + Number(obj(x).event_count), 0)
          : null,
      remainingAllowanceKnown: false,
    };
  }
  async function proxy(
    box: Box,
    path: string,
    method: "GET" | "POST" = "GET",
    body?: Obj,
  ) {
    if (!s.includedCallsConfirmed)
      return fail("INCLUDED_ALLOWANCE_CONFIRMATION_REQUIRED");
    if (
      !/^(?:profile|messages\/send|threads\/[a-f0-9]{1,128}|messages\/[a-f0-9]{1,128}\/attachments\/[A-Za-z0-9_-]{1,1024})$/.test(
        path,
      )
    )
      return fail("BLOCKED_GMAIL_ROUTE");
    const value = await request("tools/execute/proxy", "POST", {
      connected_account_id: ids[box.alias - 1],
      user_id: box.owner,
      endpoint: gmailRoot + path,
      method,
      ...(body ? { body } : {}),
    });
    if (value.status !== 200)
      return fail(
        "UPSTREAM_" +
          (Number.isInteger(value.status) ? value.status : "INVALID"),
      );
    if (
      !value.data ||
      typeof value.data !== "object" ||
      Array.isArray(value.data) ||
      Object.keys(obj(value.data)).length === 0
    )
      return fail("INVALID_PROXY_RESPONSE");
    return obj(value.data);
  }
  const token = (box: Box) => "S00-COMPOSIO-" + s.token + "-M" + box.alias;
  const subject = (box: Box) => "[S00 TEST] " + token(box);
  async function send(
    box: Box,
    kind: "initial" | "confirmation",
    raw: string,
    threadId?: string,
  ) {
    const slot = box[kind];
    if (slot.status !== "not_sent") return;
    if (s.calls >= callLimit(s)) return fail("CALL_BUDGET_EXHAUSTED");
    slot.status = "in_flight";
    slot.at = new Date().toISOString();
    await save();
    try {
      const result = await proxy(box, "messages/send", "POST", {
        raw,
        ...(threadId ? { threadId } : {}),
      });
      if (
        !gmailId(result.id) ||
        !gmailId(result.threadId) ||
        (threadId && threadId !== result.threadId)
      )
        return fail("INVALID_SEND_RESULT");
      slot.id = str(result.id);
      slot.threadId = str(result.threadId);
      slot.status = "sent";
      await save();
    } catch (error) {
      slot.status =
        error instanceof S00RunError && /^(?:HTTP|UPSTREAM)_4/.test(error.code)
          ? "failed"
          : "uncertain";
      await save();
      throw error;
    }
  }
  function parts(payload: Obj): Obj[] {
    const found: Obj[] = [];
    const visit = (p: Obj, depth: number) => {
      if (depth > 8 || found.length >= 64) return fail("MIME_LIMIT");
      found.push(p);
      if (Array.isArray(p.parts))
        for (const child of p.parts) visit(obj(child), depth + 1);
    };
    visit(payload, 0);
    return found;
  }
  function headers(message: Obj) {
    const h: Record<string, string> = {};
    const list = obj(message.payload).headers;
    if (!Array.isArray(list) || list.length > 100)
      return fail("INVALID_MESSAGE_HEADERS");
    for (const raw of list) {
      const x = obj(raw),
        name = str(x.name).toLowerCase();
      if (
        ["from", "to", "subject", "message-id", "references"].includes(name)
      ) {
        if (name in h) return fail("DUPLICATE_HEADER");
        h[name] = str(x.value);
      }
    }
    return h;
  }
  async function thread(box: Box) {
    if (box.initial.status !== "sent" || !gmailId(box.initial.threadId))
      return fail("INITIAL_NOT_SENT");
    const value = await proxy(box, "threads/" + box.initial.threadId);
    if (
      value.id !== box.initial.threadId ||
      !Array.isArray(value.messages) ||
      value.messages.length > 10 ||
      !value.messages.some((m) => obj(m).id === box.initial.id)
    )
      return fail("WRONG_THREAD");
    return (value.messages as unknown[]).map(obj);
  }
  try {
    if (action === "usage") {
      s.usageAfter = await usage();
      await save();
      return publicRunReport(s);
    }
    if (s.phase === "blocked") return fail("RUN_BLOCKED");
    if (action === "prepare") {
      if (s.phase === "prepared") return publicRunReport(s);
      s.usageBefore = await usage();
      const config = await request("auth_configs/" + auth, "GET");
      const scopes =
        obj(config.credentials).scopes ?? obj(config.credentials).scope;
      const declared = Array.isArray(scopes)
        ? scopes
        : str(scopes).split(/[\s,]+/);
      if (
        config.id !== auth ||
        obj(config.toolkit).slug !== "gmail" ||
        config.is_disabled === true ||
        config.enabled === false ||
        !["gmail.readonly", "gmail.send"].every((x) =>
          declared.includes("https://www.googleapis.com/auth/" + x),
        )
      )
        return fail("CONFIG_NOT_READY");
      for (const box of s.boxes) {
        const account = await request(
          "connected_accounts/" + ids[box.alias - 1],
          "GET",
        );
        const address = str(obj(obj(account.state).val).displayName)
          .trim()
          .toLowerCase();
        if (
          account.id !== ids[box.alias - 1] ||
          obj(account.auth_config).id !== auth ||
          obj(account.toolkit).slug !== "gmail" ||
          account.status !== "ACTIVE" ||
          account.is_disabled === true ||
          !clean(str(account.user_id)) ||
          !email(address) ||
          address === recipient
        )
          return fail("MAILBOX_NOT_READY");
        box.owner = str(account.user_id);
        box.addressHash = hash(address);
      }
      if (s.boxes[0].addressHash === s.boxes[1].addressHash)
        return fail("DUPLICATE_MAILBOX");
      s.phase = "prepared";
      await save();
    } else {
      if (s.phase !== "prepared") return fail("PREPARE_REQUIRED");
      if (options.includedCallsConfirmed) {
        s.includedCallsConfirmed = true;
        await save();
      }
      if (action === "send") {
        if (
          s.boxes.some((b) =>
            [b.initial.status, b.confirmation.status].some((x) =>
              ["uncertain", "in_flight", "failed"].includes(x),
            ),
          )
        )
          return fail("UNCERTAIN_SEND_REQUIRES_RECONCILIATION");
        const addresses: string[] = [];
        if (!s.profilesVerified) {
          for (const box of s.boxes) {
            const profile = await proxy(box, "profile");
            const address = str(profile.emailAddress).toLowerCase();
            if (
              !email(address) ||
              hash(address) !== box.addressHash ||
              address === recipient
            )
              return fail("PROFILE_MISMATCH");
            addresses.push(address);
          }
          s.profilesVerified = true;
          await save();
        } else if (s.boxes.some((b) => b.initial.status === "not_sent"))
          return fail("INTERRUPTED_SEND_REQUIRES_RECONCILIATION");
        for (const box of s.boxes) {
          if (box.initial.status !== "not_sent") continue;
          const body =
            "Controlled integration test for Pipeline OS. No action on a real application is requested. Please reply in this same thread with: S00 ACK " +
            token(box) +
            ", and attach the fictitious test PDF provided separately. Reference: S00-FIXTURE-001.";
          await send(
            box,
            "initial",
            mime(
              addresses[box.alias - 1],
              recipient,
              subject(box),
              body,
              "<s00-" +
                s.token +
                "-m" +
                box.alias +
                "-initial@pipeline-os.test>",
            ),
          );
        }
      } else if (action === "inspect") {
        for (const box of s.boxes) {
          if (box.response) continue;
          if (box.polls >= 7) return fail("POLL_LIMIT");
          box.polls++;
          await save();
          const messages = await thread(box);
          const candidates = messages.filter((m) => {
            if (m.threadId !== box.initial.threadId || !gmailId(m.id))
              return fail("WRONG_MESSAGE");
            const h = headers(m);
            const sender = mailboxAddress(h.from ?? "");
            if (sender !== recipient && hash(sender) !== box.addressHash)
              return fail("UNEXPECTED_SENDER");
            return sender === recipient;
          });
          if (candidates.length === 0) continue;
          if (candidates.length !== 1) return fail("AMBIGUOUS_REPLY");
          const message = candidates[0],
            h = headers(message);
          if (
            (h.subject ?? "").replace(/^(?:re:\s*)+/i, "") !== subject(box) ||
            hash(mailboxAddress(h.to ?? "")) !== box.addressHash
          )
            return fail("WRONG_REPLY_HEADERS");
          const payloads = parts(obj(message.payload));
          const provided = s.attachmentPolicy === "provided_pdfs_10mb";
          if (!provided) {
            const text = payloads
              .filter((p) => /^text\/(plain|html)$/.test(str(p.mimeType)))
              .map((p) => decodeBase64url(obj(p.body).data).toString("utf8"))
              .join("\n");
            if (!text.trimStart().startsWith("S00 ACK " + token(box)))
              return fail("ACK_TOKEN_MISSING");
          }
          const attachments = payloads.filter((p) =>
            provided
              ? p.mimeType === "application/pdf" && !!str(p.filename)
              : str(p.filename) === fixtureName,
          );
          if (!attachments.length || attachments.length > (provided ? 2 : 1))
            return fail("EXPECTED_PDF_MISSING_OR_COUNT");
          // Validate every declared size before fetching any attachment.
          const maxBytes = provided ? 10_000_000 : 1_000_000;
          for (const part of attachments) {
            const size = obj(part.body).size;
            if (
              part.mimeType !== "application/pdf" ||
              !Number.isSafeInteger(size) ||
              Number(size) < 5 ||
              Number(size) > maxBytes ||
              (!provided && size !== fixtureBytes)
            )
              return fail("INVALID_ATTACHMENT_METADATA");
          }
          const observed: ReceivedPdf[] = [];
          for (const part of attachments) {
            const body = obj(part.body);
            let data = body.data;
            if (body.attachmentId) {
              const id = str(body.attachmentId);
              if (!/^[A-Za-z0-9_-]{1,1024}$/.test(id))
                return fail("INVALID_ATTACHMENT_ID");
              const download = await proxy(
                box,
                "messages/" + str(message.id) + "/attachments/" + id,
              );
              if (provided && download.size !== body.size)
                return fail("ATTACHMENT_SIZE_MISMATCH");
              data = download.data;
            }
            const bytes = decodeBase64url(data, maxBytes);
            try {
              if (provided) {
                if (bytes.length !== body.size)
                  return fail("ATTACHMENT_SIZE_MISMATCH");
                if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
                  return fail("PDF_SIGNATURE_MISMATCH");
              } else if (
                bytes.length !== fixtureBytes ||
                hash(bytes) !== fixtureHash
              )
                return fail("ATTACHMENT_HASH_MISMATCH");
              observed.push({ bytes: bytes.length, sha256: hash(bytes) });
            } finally {
              bytes.fill(0);
            }
          }
          const receivedAt = Number(message.internalDate);
          if (!Number.isFinite(receivedAt) || receivedAt <= 0)
            return fail("INVALID_RECEIPT_TIME");
          box.response = {
            id: str(message.id),
            attachmentHash: provided
              ? hash(JSON.stringify(observed))
              : fixtureHash,
            ...(provided
              ? {
                  verification: "provided_pdfs" as const,
                  attachments: observed,
                }
              : {}),
            receivedAt,
            detectedAt: new Date().toISOString(),
          };
          await save();
        }
      } else if (action === "confirm") {
        for (const box of s.boxes) {
          if (!box.response) continue;
          if (
            box.confirmation.status !== "not_sent" &&
            box.confirmation.status !== "sent"
          )
            return fail("UNCERTAIN_SEND_REQUIRES_RECONCILIATION");
          if (box.confirmation.status === "not_sent") {
            const messages = await thread(box);
            const message = messages.find((m) => m.id === box.response!.id);
            if (!message) return fail("REPLY_DISAPPEARED");
            const h = headers(message);
            const from = mailboxAddress(h.to ?? "");
            if (
              hash(from) !== box.addressHash ||
              mailboxAddress(h.from ?? "") !== recipient
            )
              return fail("WRONG_REPLY_HEADERS");
            const refs =
              (h.references ?? "").match(/<[^<>\s]+@[^<>\s]+>/g) ?? [];
            if (refs.length > 20) return fail("INVALID_REFERENCES");
            const raw = mime(
              from,
              recipient,
              subject(box),
              "S00 RECEIVED " +
                token(box) +
                (box.response.verification === "provided_pdfs"
                  ? ". Your PDF attachments were received. Byte counts and PDF signatures were checked and SHA-256 fingerprints computed. No document content was analyzed. This controlled integration test is complete."
                  : ". The fictitious attachment passed the integrity check. This controlled integration test is complete."),
              "<s00-" +
                s.token +
                "-m" +
                box.alias +
                "-confirmation@pipeline-os.test>",
              h["message-id"],
              refs,
            );
            if (!h["message-id"]) return fail("MESSAGE_ID_REQUIRED");
            await send(box, "confirmation", raw, box.initial.threadId);
          }
          if (!box.confirmationVerified) {
            const messages = await thread(box);
            box.confirmationVerified = messages.some(
              (m) =>
                m.id === box.confirmation.id &&
                m.threadId === box.initial.threadId,
            );
            if (!box.confirmationVerified)
              return fail("CONFIRMATION_NOT_VISIBLE");
            await save();
          }
        }
      }
    }
    return publicRunReport(s);
  } catch (error) {
    const code =
      error instanceof S00RunError ? error.code : "LOCAL_OR_CONTRACT_ERROR";
    if (code !== "INCLUDED_ALLOWANCE_CONFIRMATION_REQUIRED") {
      s.phase = "blocked";
      s.lastError = code;
      await save();
    }
    if (error instanceof S00RunError) throw error;
    return fail(code);
  }
}
