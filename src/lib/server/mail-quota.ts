import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import {
  mailQuotaPolicySchema,
  type MailQuotaPolicy,
} from "../mail-quota-policy";
import { gmailRequestCost } from "../gmail-quota";
import { GmailError } from "../gmail-errors";

export class MailQuotaError extends Error {
  constructor(
    public readonly code:
      | "QGR_UNAVAILABLE"
      | "QGR_STALE"
      | "QGR_EXPIRED"
      | "QGR_REPLAY"
      | "QGR_DENIED",
  ) {
    super(code);
  }
}
export interface MailQuotaPorts {
  enabled: boolean;
  rpc(name: string, input: Record<string, unknown>): Promise<unknown>;
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  uuid(): string;
}
const contexts = new AsyncLocalStorage<Readonly<MailQuotaPorts>>();
export function withMailQuota<T>(
  ports: MailQuotaPorts,
  action: () => Promise<T>,
) {
  return contexts.run(Object.freeze({ ...ports }), action);
}
export function mailQuotaEnabled(): boolean {
  const injected = contexts.getStore();
  if (injected) return injected.enabled;
  const flag = process.env.MAIL_QUOTA_POLICY_ENABLED ?? "false";
  if (!["true", "false"].includes(flag))
    throw new MailQuotaError("QGR_UNAVAILABLE");
  return flag === "true";
}
async function ports(): Promise<Readonly<MailQuotaPorts> | null> {
  if (!mailQuotaEnabled()) return null;
  const injected = contexts.getStore();
  if (injected) return injected;
  const { serviceClient } = await import("./supabase");
  return {
    enabled: true,
    now: () => Date.now(),
    uuid: randomUUID,
    sleep: (ms, signal) => sleep(ms, undefined, { signal }),
    async rpc(name, input) {
      try {
        const r = await serviceClient().rpc(name, input);
        if (r.error) throw new Error();
        return r.data;
      } catch {
        throw new MailQuotaError("QGR_UNAVAILABLE");
      }
    },
  };
}
const snapshotSchema = z.strictObject({
  closed: z.boolean(),
  policy: mailQuotaPolicySchema.nullable(),
});
async function policy(
  p: Readonly<MailQuotaPorts>,
): Promise<MailQuotaPolicy | null> {
  let raw;
  try {
    raw = await p.rpc("mail_quota_snapshot", {});
  } catch {
    throw new MailQuotaError("QGR_UNAVAILABLE");
  }
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) throw new MailQuotaError("QGR_UNAVAILABLE");
  if (parsed.data.closed) throw new MailQuotaError("QGR_DENIED");
  return parsed.data.policy;
}
type Proof = {
  provider: "gmail_oauth" | "composio";
  path: string;
  method: string;
  used: boolean;
  alive(): void;
};
const emissions = new AsyncLocalStorage<Proof>();
// Low-level transports must not become an alternate entry around the quota gate.
export function assertMailQuotaEmission(
  provider: Proof["provider"],
  path: string,
  method = "GET",
) {
  if (!mailQuotaEnabled()) return;
  const proof = emissions.getStore();
  if (
    !proof ||
    proof.used ||
    proof.provider !== provider ||
    proof.path !== path ||
    proof.method !== method
  )
    throw new MailQuotaError("QGR_DENIED");
  proof.alive();
  proof.used = true;
}
export function recheckMailQuotaEmission() {
  if (!mailQuotaEnabled()) return;
  const proof = emissions.getStore();
  if (!proof) throw new MailQuotaError("QGR_DENIED");
  proof.alive();
}
export interface MailQuotaLease {
  emit<T>(action: () => Promise<T>): Promise<T>;
}
export interface GmailQuotaRequest {
  account: string;
  provider: Proof["provider"];
  path: string;
  method?: string;
  project?: string;
  key?: string;
  deadline?: string;
  signal?: AbortSignal;
  requiresV2?: boolean;
  authorize(): Promise<void>;
  pace?(): Promise<void>;
  legacy(): Promise<void>;
}
const receipt = z.union([
  z.strictObject({
    reserved: z.literal(false),
    reason: z.literal("window_exhausted"),
    group_scope: z.literal("gmail:crm:shared"),
  }),
  z.strictObject({
    reserved: z.literal(true),
    wait_ms: z.number().int().min(0).max(600000),
    group_scope: z.literal("gmail:crm:shared"),
    account_scope: z.string(),
    policy_id: z.uuid(),
    generation: z.number().int().positive(),
  }),
]);
export async function reserveGmailQuota(
  inputValue: GmailQuotaRequest,
): Promise<MailQuotaLease> {
  const input = Object.freeze({ ...inputValue });
  const p = await ports(),
    enabled = !!p,
    method = input.method ?? "GET";
  await input.authorize();
  await input.pace?.();
  const captured = p ? await policy(p) : null;
  const active = !!captured && captured.state === "enabled";
  if (
    !active &&
    (input.requiresV2 || (enabled && input.provider !== "gmail_oauth"))
  )
    throw new MailQuotaError("QGR_DENIED");
  let used = false;
  if (!active) {
    const alive = () => {
      if (
        input.signal?.aborted ||
        (input.deadline &&
          (p?.now() ?? Date.now()) >= Date.parse(input.deadline))
      )
        throw new MailQuotaError("QGR_EXPIRED");
    };
    await input.legacy();
    return {
      async emit<T>(action: () => Promise<T>) {
        if (used) throw new MailQuotaError("QGR_REPLAY");
        used = true;
        if (mailQuotaEnabled() !== enabled || input.signal?.aborted)
          throw new MailQuotaError("QGR_STALE");
        if (p && JSON.stringify(await policy(p)) !== JSON.stringify(captured))
          throw new MailQuotaError("QGR_STALE");
        await input.authorize();
        alive();
        return emissions.run(
          {
            provider: input.provider,
            path: input.path,
            method,
            used: false,
            alive,
          },
          action,
        );
      },
    };
  }
  const c = captured!,
    key = input.key ?? p!.uuid(),
    end = input.deadline ?? new Date(p!.now() + 120000).toISOString();
  if (
    !z.uuid().safeParse(input.account).success ||
    !z.uuid().safeParse(key).success ||
    !Number.isFinite(Date.parse(end))
  )
    throw new MailQuotaError("QGR_DENIED");
  const alive = () => {
    if (
      input.signal?.aborted ||
      !Number.isFinite(p!.now()) ||
      p!.now() >= Date.parse(end)
    )
      throw new MailQuotaError("QGR_EXPIRED");
    if (!mailQuotaEnabled()) throw new MailQuotaError("QGR_STALE");
  };
  const fresh = async () => {
    alive();
    await input.authorize();
    const next = await policy(p!);
    if (JSON.stringify(next) !== JSON.stringify(c))
      throw new MailQuotaError("QGR_STALE");
    alive();
  };
  await fresh();
  let raw;
  try {
    raw = await p!.rpc("mail_quota_reserve", {
      account: input.account,
      provider: input.provider,
      units: gmailRequestCost(input.path, method),
      policy_id: c.policy_id,
      generation: c.generation,
      request_key: key,
      deadline: end,
      direct_project:
        input.provider === "gmail_oauth" ? (input.project ?? null) : null,
    });
  } catch {
    throw new MailQuotaError("QGR_UNAVAILABLE");
  }
  const reserved = receipt.safeParse(raw);
  if (!reserved.success) throw new MailQuotaError("QGR_UNAVAILABLE");
  if (!reserved.data.reserved)
    throw new GmailError(403, "dailyLimitExceeded", 3600);
  const r = reserved.data;
  if (
    r.policy_id !== c.policy_id ||
    r.generation !== c.generation ||
    r.account_scope !== "gmail:account:" + input.account.toLowerCase()
  )
    throw new MailQuotaError("QGR_STALE");
  alive();
  if (p!.now() + r.wait_ms >= Date.parse(end))
    throw new MailQuotaError("QGR_EXPIRED");
  if (r.wait_ms > 0) await p!.sleep(r.wait_ms, input.signal);
  await fresh();
  return {
    async emit<T>(action: () => Promise<T>) {
      if (used) throw new MailQuotaError("QGR_REPLAY");
      used = true;
      await fresh();
      let admitted;
      try {
        admitted = await p!.rpc("mail_quota_admit", { request_key: key });
      } catch {
        throw new MailQuotaError("QGR_UNAVAILABLE");
      }
      if (admitted !== true) throw new MailQuotaError("QGR_REPLAY");
      await input.authorize();
      alive();
      return emissions.run(
        {
          provider: input.provider,
          path: input.path,
          method,
          used: false,
          alive,
        },
        action,
      );
    },
  };
}
