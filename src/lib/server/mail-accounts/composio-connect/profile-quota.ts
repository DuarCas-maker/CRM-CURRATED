import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { ConnectAuthority } from "../../../composio-connect";
import { ConnectError } from "../../../composio-connect";
import { mailQuotaPolicySchema } from "../../../mail-quota-policy";
import type { ConnectRpcClient } from "./store";

const receipt = z.strictObject({
  reserved: z.literal(true),
  phase_id: z.uuid(),
  policy_id: z.uuid(),
  generation: z.number().int().positive(),
  wait_ms: z.number().int().min(0).max(600000),
  deadline_ms: z.number().int().positive(),
});
const deny = () => new ConnectError("CONNECT_UNAVAILABLE");

// One profile GET tied to an already-authorized identity phase. No credential, env, or provider access.
export async function reserveConnectProfileQuota(input: {
  attempt: string;
  phase: string;
  authority: ConnectAuthority;
  policy: unknown;
  deadline: number;
  rpc: ConnectRpcClient["rpc"];
  now(): number;
  signal?: AbortSignal;
  authorize(): Promise<void>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}) {
  const policy = mailQuotaPolicySchema.safeParse(input.policy);
  if (!policy.success || policy.data.state !== "enabled") throw deny();
  const expected = policy.data;
  const live = () => {
    const at = input.now();
    if (
      !Number.isSafeInteger(at) ||
      input.signal?.aborted ||
      at >= input.deadline
    )
      throw deny();
  };
  live();
  await input.authorize();
  const invoke = async (name: string) => {
    live();
    try {
      const r = await input.rpc(name, {
        attempt: input.attempt,
        phase: input.phase,
        authority: input.authority,
      });
      if (r.error) throw deny();
      return r.data;
    } catch {
      throw deny();
    }
  };
  const checked = receipt.safeParse(
    await invoke("composio_connect_profile_reserve"),
  );
  if (!checked.success) throw deny();
  const r = checked.data;
  if (
    r.phase_id !== input.phase ||
    r.policy_id !== expected.policy_id ||
    r.generation !== expected.generation ||
    r.deadline_ms !== input.deadline ||
    input.now() + r.wait_ms >= input.deadline
  )
    throw deny();
  if (r.wait_ms) {
    await (input.sleep ?? ((ms, signal) => delay(ms, undefined, { signal })))(
      r.wait_ms,
      input.signal,
    );
  }
  await input.authorize();
  live();
  let emitted = false;
  return {
    async emit<T>(action: () => Promise<T>): Promise<T> {
      if (emitted) throw deny();
      emitted = true;
      live();
      await input.authorize();
      if ((await invoke("composio_connect_profile_admit")) !== true)
        throw deny();
      await input.authorize();
      live();
      return action();
    },
  };
}
