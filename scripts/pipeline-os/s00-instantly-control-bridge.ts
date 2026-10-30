import { randomUUID } from "node:crypto";
import {
  controlHash,
  controlSnapshotSchema,
  controlTicketSchema,
  validateCAppManifest,
  type CAppManifest,
  type ControlSnapshot,
  type ControlTicket,
} from "../../src/lib/server/instantly/control-contract";
import type { CReceiver } from "./s00-instantly-c-receiver";
export type ControlAction =
  | "grant"
  | "probe"
  | "observe"
  | "final"
  | "arm"
  | "close"
  | "revoke"
  | "revocation_check";
export type ControlAttempt = {
  id: string;
  action: ControlAction;
  bucket: "N" | "R" | "H";
  result: string;
};
export type ControlJournal = { attempts: ControlAttempt[] };
async function bounded<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw Error("CAPP_CONTROL_ABORTED");
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(Error("CAPP_CONTROL_ABORTED"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, interrupted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
export function validateControlJournal(j: ControlJournal) {
  if (
    !j ||
    Object.keys(j).length !== 1 ||
    !Array.isArray(j.attempts) ||
    j.attempts.length < 1 ||
    j.attempts.length > 25
  )
    throw Error("CAPP_CONTROL_JOURNAL");
  const counts = { N: 0, R: 0, H: 0 },
    ids = new Set<string>();
  for (const [i, a] of j.attempts.entries()) {
    if (
      Object.keys(a).length !== 4 ||
      typeof a.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(a.id) ||
      ids.has(a.id) ||
      !["N", "R", "H"].includes(a.bucket) ||
      ![
        "grant",
        "probe",
        "observe",
        "final",
        "arm",
        "close",
        "revoke",
        "revocation_check",
      ].includes(a.action) ||
      !/^(IN_FLIGHT|OK|HTTP_[0-9]{3}|FAILED)$/.test(a.result)
    )
      throw Error("CAPP_CONTROL_JOURNAL");
    ids.add(a.id);
    counts[a.bucket]++;
    if (
      (i === 0) !== (a.action === "grant") ||
      (i === 0 && a.bucket !== "N") ||
      (a.bucket === "R" &&
        !["probe", "observe", "final", "revocation_check"].includes(
          a.action,
        )) ||
      (a.bucket === "H" && !["close", "revoke"].includes(a.action))
    )
      throw Error("CAPP_CONTROL_JOURNAL");
  }
  if (
    counts.N > 19 ||
    counts.R > 4 ||
    counts.H > 2 ||
    j.attempts.filter((a) => a.action === "observe" && a.bucket === "N")
      .length > 12
  )
    throw Error("CAPP_CONTROL_BUDGET");
  for (const action of ["arm", "close", "revoke"])
    if (j.attempts.filter((a) => a.action === action).length > 1)
      throw Error("CAPP_CONTROL_EFFECT_REPLAY");
  return j;
}
export function remoteControlBridge(input: {
  manifest: CAppManifest;
  ticket: ControlTicket;
  token: string;
  journal: ControlJournal;
  save: () => Promise<void>;
  fetchImpl: typeof fetch;
  clock: { now: () => number; sleep: (ms: number) => Promise<void> };
  signal?: AbortSignal;
  emergency?: () => boolean;
}) {
  const m = validateCAppManifest(input.manifest),
    ticket = controlTicketSchema.parse(input.ticket);
  validateControlJournal(input.journal);
  if (
    !/^[a-f0-9]{64}$/.test(input.token) ||
    ticket.expiresAt !== m.receiverManifest.endsAt + 60000 ||
    ticket.nonce !== m.receiverManifest.nonce ||
    ticket.sourceHash !== m.source.canonicalHash ||
    ticket.manifestHash !== controlHash(JSON.stringify(m.receiverManifest)) ||
    ticket.intentId !== input.journal.attempts[0].id
  )
    throw Error("CAPP_TICKET_BINDING");
  let latest: ControlSnapshot | undefined,
    finalSnapshot: ControlSnapshot | undefined,
    disabled = false,
    lastPoll = -Infinity,
    busy = false,
    blocked = false;
  async function durableSave() {
    try {
      await input.save();
    } catch {
      blocked = true;
      throw Error("CAPP_STORAGE_UNCERTAIN");
    }
  }
  const attempted = (a: ControlAction) =>
    input.journal.attempts.some((x) => x.action === a);
  const snapshot = (value: unknown) => {
    const s = controlSnapshotSchema.parse(value);
    if (
      s.nonce !== ticket.nonce ||
      s.sourceHash !== ticket.sourceHash ||
      s.manifestHash !== ticket.manifestHash ||
      (latest &&
        (s.revision < latest.revision ||
          s.observations < latest.observations ||
          (latest.conflict && !s.conflict) ||
          (latest.authenticated && latest.payloadDigest !== s.payloadDigest) ||
          (latest.closed && !s.closed)))
    )
      throw Error("CAPP_SNAPSHOT_BINDING");
    latest = s;
    return s;
  };
  async function request(
    action: Exclude<ControlAction, "grant">,
    bucket: "N" | "R" | "H" = "N",
    retry = false,
  ): Promise<ControlSnapshot | undefined> {
    if (blocked) throw Error("CAPP_STORAGE_UNCERTAIN");
    if (input.clock.now() >= ticket.expiresAt)
      throw Error("CAPP_TICKET_EXPIRED");
    if (busy) throw Error("CAPP_CONCURRENT_CONTROL");
    if (["arm", "close", "revoke"].includes(action) && attempted(action))
      throw Error("CAPP_EFFECT_ALREADY_ATTEMPTED");
    const q: ControlAttempt = {
        id: randomUUID(),
        action,
        bucket,
        result: "IN_FLIGHT",
      },
      next = { attempts: [...input.journal.attempts, q] };
    validateControlJournal(next);
    busy = true;
    input.journal.attempts.push(q);
    await durableSave();
    const write = ["arm", "close", "revoke"].includes(action),
      headers: Record<string, string> = {
        Authorization: "Bearer " + input.token,
        "X-S00-Control-Bucket": bucket,
        "X-S00-Control-Request-Id": q.id,
      };
    if (write) headers["content-type"] = "application/json";
    else
      headers["X-S00-Control-Action"] =
        action === "revocation_check" ? "probe" : action;
    let transient = false,
      wait = 5000;
    busy = true;
    const signal = AbortSignal.any([
      AbortSignal.timeout(8000),
      ...(bucket !== "H" && input.signal ? [input.signal] : []),
    ]);
    try {
      if (signal.aborted) throw Error("CAPP_CONTROL_ABORTED");
      const response = await bounded(
        input.fetchImpl(
          m.origin + "/api/integrations/instantly/control/" + ticket.nonce,
          {
            method: write ? "POST" : "GET",
            headers,
            body: write ? JSON.stringify({ action }) : undefined,
            redirect: "manual",
            signal,
          },
        ),
        signal,
      );
      q.result = "HTTP_" + response.status;
      await durableSave();
      if (action === "revocation_check" && response.status === 401) {
        await response.body?.cancel();
        disabled = true;
        return;
      }
      if (response.status !== 200) {
        transient = [429, 500, 502, 503, 504].includes(response.status);
        const raw = response.headers.get("retry-after");
        if (raw) {
          const seconds = Number(raw);
          wait = Number.isFinite(seconds)
            ? Math.max(5000, seconds * 1000)
            : Math.max(5000, Date.parse(raw) - Date.now());
        }
        await response.body?.cancel();
        throw Error("CAPP_CONTROL_HTTP");
      }
      const reader = response.body?.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        if (reader)
          for (;;) {
            const x = await bounded(reader.read(), signal);
            if (x.done) break;
            size += x.value.length;
            if (size > 65536) throw Error("CAPP_CONTROL_RESPONSE_LIMIT");
            chunks.push(x.value);
          }
      } finally {
        void reader?.cancel().catch(() => {});
      }
      const s = snapshot(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (action === "final" && !s.closed) throw Error("CAPP_FINAL_NOT_CLOSED");
      q.result = "OK";
      await durableSave();
      return s;
    } catch (e) {
      if (blocked) throw Error("CAPP_STORAGE_UNCERTAIN");
      if (q.result === "IN_FLIGHT") {
        q.result = "FAILED";
        transient = true;
        await durableSave();
      }
      if (
        !write &&
        !retry &&
        transient &&
        wait <= 60000 &&
        !input.signal?.aborted
      ) {
        busy = false;
        await input.clock.sleep(wait);
        return request(action, "R", true);
      }
      throw Error("CAPP_CONTROL_FAILED");
    } finally {
      busy = false;
    }
  }
  const receiver: CReceiver = {
    arm: async () => {
      const s = await request("arm");
      if (!s?.armed || s.closed) throw Error("CAPP_ARM_FAILED");
    },
    observe: async () => {
      if (
        input.clock.now() - lastPoll >= 10000 &&
        input.clock.now() <= m.receiverManifest.endsAt &&
        input.journal.attempts.filter(
          (a) => a.action === "observe" && a.bucket === "N",
        ).length < 12
      ) {
        lastPoll = input.clock.now();
        await request("observe");
      }
      if (!latest) throw Error("CAPP_NO_SNAPSHOT");
      return {
        authenticated: latest.authenticated,
        contextValidated: latest.contextValidated,
        conflict: latest.conflict,
        payloadDigest: latest.payloadDigest,
        receivedAt: latest.receivedAt,
      };
    },
    close: async () => {
      if (attempted("close")) return;
      let uncertain = false;
      try {
        await request("close", input.emergency?.() ? "H" : "N");
      } catch {
        uncertain = true;
      }
      finalSnapshot = await request("final", uncertain ? "R" : "N");
      if (!finalSnapshot?.closed) throw Error("CAPP_CLOSE_UNCERTAIN");
    },
  };
  return {
    receiver,
    probe: async () => {
      const s = await request("probe");
      if (s?.armed || s?.closed) throw Error("CAPP_TRIAL_ALREADY_USED");
    },
    finish: async () => {
      if (latest?.armed && !attempted("close")) await receiver.close();
      let uncertain = false;
      if (!attempted("revoke"))
        try {
          await request("revoke", input.emergency?.() ? "H" : "N");
        } catch {
          uncertain = true;
        }
      await request("revocation_check", uncertain ? "R" : "N");
      return { snapshot: finalSnapshot, disabled };
    },
    state: () => ({ snapshot: finalSnapshot, disabled }),
  };
}
