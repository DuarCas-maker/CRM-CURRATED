import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  withWorkerPilot,
  WorkerPilotError,
  type PilotRequest,
} from "../src/lib/server/worker-request-control";

export const executionModeSchema = z.enum(["normal", "paused", "pilot"]);
export function workerExecutionMode(value: string | undefined) {
  return executionModeSchema.parse(value ?? "normal");
}
const snapshotSchema = z
  .object({
    accountId: z.string().uuid(),
    outboxId: z.string().uuid(),
    provider: z.enum(["gmail_oauth", "composio"]),
    claimed: z.boolean(),
    status: z.string(),
    threadId: z.string().nullable(),
  })
  .strict();
export type PilotClaim = Readonly<{ pilotId: string; lease: string }>;
export type PilotDependencies = {
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<unknown>;
  send: (claim: PilotClaim) => Promise<void>;
  readThread: (accountId: string, threadId: string) => Promise<void>;
  stopRequested?: () => boolean;
};
export async function startWorkerPilot(
  id: string | undefined,
  deps: PilotDependencies,
  lease = randomBytes(32).toString("hex"),
) {
  const pilotId = z.string().uuid().parse(id);
  if (!/^[a-f0-9]{64}$/.test(lease)) throw new WorkerPilotError();
  const credentials = Object.freeze({ pilot: pilotId, lease });
  const acquired = await deps.rpc("worker_pilot_acquire", credentials);
  if (acquired !== true) throw new WorkerPilotError();
  let stopped = false;
  const stop = async () => {
    stopped = true;
    await deps.rpc("worker_pilot_close", credentials);
  };
  return {
    stop,
    async cycle(): Promise<"waiting" | "observing" | "closed"> {
      if (stopped) return "closed";
      try {
        if (deps.stopRequested?.()) {
          await stop();
          return "closed";
        }
        const raw = await deps.rpc("worker_pilot_snapshot", credentials);
        if (raw === null) {
          stopped = true;
          return "closed";
        }
        const snapshot = snapshotSchema.parse(raw);
        if (deps.stopRequested?.()) {
          await stop();
          return "closed";
        }
        const authorize = async (request: PilotRequest, reserve: boolean) => {
          if (stopped || deps.stopRequested?.()) return false;
          const allowed = await deps.rpc("worker_pilot_request", {
            ...credentials,
            request,
            reserve,
          });
          return allowed === true && !stopped && !deps.stopRequested?.();
        };
        const context = { ...snapshot, action: "send" as const, authorize };
        if (!snapshot.claimed && snapshot.status === "queued") {
          await withWorkerPilot(context, () => deps.send({ pilotId, lease }));
          return "waiting";
        }
        if (snapshot.status === "sent" && snapshot.threadId) {
          await withWorkerPilot({ ...context, action: "thread" }, () =>
            deps.readThread(snapshot.accountId, snapshot.threadId!),
          );
          return "observing";
        }
        if (snapshot.claimed || snapshot.status !== "queued") {
          await deps.rpc("worker_pilot_close", credentials);
          stopped = true;
          return "closed";
        }
        return "waiting";
      } catch {
        stopped = true;
        try {
          await deps.rpc("worker_pilot_close", credentials);
        } catch {
          /* fail closed locally even if DB is unavailable */
        }
        throw new WorkerPilotError();
      }
    },
  };
}
