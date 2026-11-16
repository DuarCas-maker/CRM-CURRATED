import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { ConnectError, connectIdentitySchema } from "../../../composio-connect";
import {
  connectProviderConfigSchema,
  validateConnectProviderConfiguration,
} from "./config";
import { createConnectProvider } from "./provider";

export const recoveryCommand = z.strictObject({
  source_id: z.uuid(),
  expected_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  idempotency_key: z.uuid(),
});
export const recoveryResult = z.object({
  id: z.uuid(),
  state: z.enum(["verifying", "failed", "completed"]),
  child_id: z.uuid().nullable(),
  deadline_ms: z.number().int().positive(),
  wait_ms: z.number().int().min(0).max(10000),
  descriptor: connectProviderConfigSchema,
  connection_id: connectIdentitySchema.shape.connected_account_id,
  expected_email: z.email(),
});
export type RecoveryOperation =
  "begin" | "check" | "reserve" | "admit" | "finish" | "fail";

export async function reconcileExistingConnection(input: {
  execute(
    operation: RecoveryOperation,
    extra?: Record<string, unknown>,
  ): Promise<unknown>;
  configuration: z.infer<typeof connectProviderConfigSchema>;
  credential: { version: string; api_key: string };
  fetchImpl: typeof fetch;
  now(): number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}) {
  const initial = recoveryResult.parse(await input.execute("begin"));
  if (initial.state === "completed" && initial.child_id) return initial;
  let requests = 0;
  const abort = new AbortController();
  const descriptor = validateConnectProviderConfiguration(
    {
      ...input.configuration,
      config: {
        ...input.configuration.config,
        owner_id: initial.descriptor.config.owner_id,
      },
    },
    initial.descriptor,
  );
  const timer = setTimeout(() => abort.abort(), 30000);
  const live = async () => {
    const current = recoveryResult.parse(await input.execute("check"));
    if (
      abort.signal.aborted ||
      input.now() >= initial.deadline_ms ||
      current.id !== initial.id ||
      current.connection_id !== initial.connection_id ||
      current.expected_email !== initial.expected_email ||
      JSON.stringify(current.descriptor) !== JSON.stringify(descriptor)
    )
      throw new ConnectError("CONNECT_STALE");
  };
  try {
    const root = "https://backend.composio.dev/api/v3.1";
    const paths = [
      root + "/connected_accounts/" + initial.connection_id,
      root + "/auth_configs/" + descriptor.config.auth_config_id,
      root + "/tools/execute/proxy",
    ];
    const provider = createConnectProvider({
      configuration: descriptor,
      expectedConfiguration: descriptor,
      credential: input.credential,
      clock: {
        now: input.now,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      fetchImpl: async (url, init) => {
        if (
          String(url) !== paths[requests] ||
          init?.method !== (requests === 2 ? "POST" : "GET") ||
          requests >= 3
        )
          throw new ConnectError("CONNECT_FORBIDDEN");
        await live();
        if (requests === 2) {
          const reserve = recoveryResult.parse(await input.execute("reserve"));
          if (reserve.wait_ms)
            await (
              input.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }))
            )(reserve.wait_ms, abort.signal);
          await live();
          await input.execute("admit");
          await live();
        }
        requests++;
        return input.fetchImpl(url, init);
      },
    });
    const identity = connectIdentitySchema.parse(
      await provider.readIdentity({
        connected_account_id: initial.connection_id,
        project_id: descriptor.config.project_id,
        auth_config_id: descriptor.config.auth_config_id,
        owner_id: descriptor.config.owner_id,
        signal: abort.signal,
      }),
    );
    if (
      identity.primary_email.toLowerCase() !==
      initial.expected_email.toLowerCase()
    )
      throw new ConnectError("CONNECT_IDENTITY_MISMATCH");
    await live();
    return recoveryResult.parse(await input.execute("finish", { identity }));
  } catch (error) {
    try {
      await input.execute("fail");
    } catch {
      /* Preserve an incomplete durable run; never retry the provider. */
    }
    if (error instanceof ConnectError) throw error;
    throw new ConnectError("CONNECT_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}
