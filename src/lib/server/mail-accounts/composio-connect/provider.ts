import { z } from "zod";
import {
  ConnectError,
  connectConfigSchema,
  connectIdentitySchema,
  connectLinkSchema,
  type ConnectClock,
  type ConnectProvider,
} from "../../../composio-connect";
import { ConnectNotEmitted } from "./orchestrator";
import { validateConnectProviderConfiguration } from "./config";

const root = "https://backend.composio.dev/api/v3.1";
const profileEndpoint =
  "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const maxBody = 256 * 1024;
const connectionId = connectIdentitySchema.shape.connected_account_id;
const tuple = z.strictObject({
  project_id: connectConfigSchema.shape.project_id,
  auth_config_id: connectConfigSchema.shape.auth_config_id,
  owner_id: connectConfigSchema.shape.owner_id,
  signal: z.instanceof(AbortSignal),
});
const createInput = tuple.extend({
  attempt_id: z.uuid(),
  callback_url: z.string().max(4096),
});
const identityInput = tuple.extend({ connected_account_id: connectionId });
const privateAccount = z.object({
  account_type: z.literal("PRIVATE").optional(),
});
const wireLink = z.object({
  connected_account_id: connectionId,
  redirect_url: z.string(),
  expires_at: z.iso.datetime({ offset: true }),
  experimental: privateAccount.optional(),
});
const wireConnection = z.object({
  id: connectionId,
  user_id: connectConfigSchema.shape.owner_id,
  toolkit: z.object({ slug: z.literal("gmail") }),
  authScheme: z.literal("OAUTH2"),
  auth_config: z.object({
    id: connectConfigSchema.shape.auth_config_id,
    auth_scheme: z.literal("OAUTH2"),
    is_disabled: z.literal(false),
  }),
  status: z.literal("ACTIVE"),
  is_disabled: z.literal(false),
  experimental: privateAccount.optional(),
});
const wireConfig = z.object({
  id: connectConfigSchema.shape.auth_config_id,
  toolkit: z.object({ slug: z.literal("gmail") }),
  auth_scheme: z.literal("OAUTH2"),
  status: z.literal("ENABLED"),
});
const wireProfile = z.object({
  status: z.literal(200),
  data: z.object({ emailAddress: z.string().trim().pipe(z.email().max(254)) }),
});
const credentialSchema = z.strictObject({
  version: z.string().min(1).max(128),
  api_key: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[\x21-\x7e]+$/),
});
class ProviderDeadline extends Error {}
const unavailable = () => new ConnectError("CONNECT_UNAVAILABLE");

export interface ConnectProviderOptions {
  configuration: unknown;
  expectedConfiguration: unknown;
  credential: unknown;
  fetchImpl: typeof fetch;
  clock: ConnectClock;
}

// No environment, global fetch, SDK, caller or transport activation. All effects require explicit dependencies.
export function createConnectProvider(
  options: ConnectProviderOptions,
): ConnectProvider {
  if (
    !options ||
    typeof options.fetchImpl !== "function" ||
    !options.clock ||
    ["now", "setTimer", "clearTimer"].some(
      (k) => typeof options.clock[k as keyof ConnectClock] !== "function",
    )
  )
    throw new ConnectError("CONNECT_UNAVAILABLE", { beforeEmission: true });
  const config = validateConnectProviderConfiguration(
    options.configuration,
    options.expectedConfiguration,
  );
  const key = credentialSchema.safeParse(options.credential);
  if (!key.success || key.data.version !== config.context.credential_version)
    throw new ConnectError("CONNECT_UNAVAILABLE", { beforeEmission: true });
  const { fetchImpl, clock } = options;
  const apiKey = key.data.api_key;
  function now(): number {
    const n = clock.now();
    if (!Number.isSafeInteger(n) || n < 0) throw unavailable();
    return n;
  }
  function sameTuple(input: z.infer<typeof tuple>): void {
    if (
      input.project_id !== config.config.project_id ||
      input.auth_config_id !== config.config.auth_config_id ||
      input.owner_id !== config.config.owner_id
    )
      throw unavailable();
  }
  function callback(value: string): void {
    const u = new URL(value);
    const state = u.searchParams.get("state");
    if (
      u.href !== value ||
      u.origin !== config.callback_origin ||
      u.username ||
      u.password ||
      u.hash ||
      u.pathname !== "/api/mail/composio/connect/callback" ||
      [...u.searchParams].length !== 1 ||
      !state ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(state)
    )
      throw unavailable();
  }
  function cancelBody(response: Response): void {
    try {
      void response.body?.cancel().catch(() => {});
    } catch {
      /* No raw errors escape. */
    }
  }
  async function json(
    response: Response,
    signal: AbortSignal,
    deadline: number,
  ): Promise<unknown> {
    if (
      response.redirected ||
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      cancelBody(response);
      throw unavailable();
    }
    const length = response.headers.get("content-length");
    if (
      length !== null &&
      (!/^\d+$/.test(length) || Number(length) > maxBody)
    ) {
      cancelBody(response);
      throw unavailable();
    }
    if (!response.body) throw unavailable();
    const reader = response.body.getReader();
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      if (signal.aborted || now() >= deadline) throw unavailable();
      while (true) {
        if (signal.aborted || now() >= deadline) throw unavailable();
        const next = await reader.read();
        if (signal.aborted || now() >= deadline) throw unavailable();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maxBody) throw unavailable();
        chunks.push(next.value);
      }
      const buffer = new Uint8Array(bytes);
      let position = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, position);
        position += chunk.byteLength;
      }
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      );
    } finally {
      signal.removeEventListener("abort", abort);
      try {
        void reader.cancel().catch(() => {});
      } catch {
        /* bounded cleanup */
      }
      reader.releaseLock();
    }
  }
  async function read(
    path: string,
    method: "GET" | "POST",
    body: unknown,
    status: number,
    outer: AbortSignal,
    deadline: number,
    emission: { started: boolean },
  ): Promise<unknown> {
    const controller = new AbortController();
    let timer: unknown;
    let timerSet = false;
    let rejectDeadline!: (reason: unknown) => void;
    const timeout = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    const stop = () => {
      controller.abort();
      rejectDeadline(new ProviderDeadline());
    };
    outer.addEventListener("abort", stop, { once: true });
    try {
      const limit = Math.min(deadline, now() + 10_000);
      if (outer.aborted || now() >= limit) throw unavailable();
      timer = clock.setTimer(stop, limit - now());
      timerSet = true;
      const operation = Promise.resolve().then(async () => {
        if (outer.aborted || controller.signal.aborted || now() >= limit)
          throw unavailable();
        const headers: Record<string, string> = {
          "x-api-key": apiKey,
          accept: "application/json",
        };
        if (body !== undefined) headers["content-type"] = "application/json";
        // Everything that can reject before emission, including serialization, precedes this marker.
        const init: RequestInit = {
          method,
          headers,
          redirect: "manual",
          signal: controller.signal,
        };
        if (body !== undefined) init.body = JSON.stringify(body);
        emission.started = true;
        const response = await fetchImpl(root + path, init);
        if (controller.signal.aborted || now() >= limit) {
          cancelBody(response);
          throw unavailable();
        }
        if (response.status !== status) {
          cancelBody(response);
          throw unavailable();
        }
        return await json(response, controller.signal, limit);
      });
      const value = await Promise.race([operation, timeout]);
      if (outer.aborted || controller.signal.aborted || now() >= limit)
        throw unavailable();
      return value;
    } finally {
      outer.removeEventListener("abort", stop);
      controller.abort();
      if (timerSet) clock.clearTimer(timer);
    }
  }
  return {
    async createLink(value) {
      const emission = { started: false };
      try {
        const input = createInput.parse(value);
        sameTuple(input);
        callback(input.callback_url);
        const raw = await read(
          "/connected_accounts/link",
          "POST",
          {
            auth_config_id: input.auth_config_id,
            user_id: input.owner_id,
            callback_url: input.callback_url,
          },
          201,
          input.signal,
          now() + 10_000,
          emission,
        );
        const link = wireLink.parse(raw);
        const result = connectLinkSchema.parse({
          connected_account_id: link.connected_account_id,
          url: link.redirect_url,
          expires_at_ms: Date.parse(link.expires_at),
        });
        if (result.expires_at_ms <= now()) throw unavailable();
        return result;
      } catch {
        if (!emission.started) throw new ConnectNotEmitted();
        throw unavailable();
      }
    },
    async readIdentity(value) {
      try {
        const input = identityInput.parse(value);
        sameTuple(input);
        const deadline = now() + 30_000;
        const emission = { started: false };
        const connection = wireConnection.parse(
          await read(
            "/connected_accounts/" + input.connected_account_id,
            "GET",
            undefined,
            200,
            input.signal,
            deadline,
            emission,
          ),
        );
        if (
          connection.id !== input.connected_account_id ||
          connection.user_id !== input.owner_id ||
          connection.auth_config.id !== input.auth_config_id
        )
          throw unavailable();
        const auth = wireConfig.parse(
          await read(
            "/auth_configs/" + input.auth_config_id,
            "GET",
            undefined,
            200,
            input.signal,
            deadline,
            emission,
          ),
        );
        if (auth.id !== connection.auth_config.id) throw unavailable();
        const profile = wireProfile.parse(
          await read(
            "/tools/execute/proxy",
            "POST",
            {
              connected_account_id: connection.id,
              user_id: connection.user_id,
              endpoint: profileEndpoint,
              method: "GET",
            },
            200,
            input.signal,
            deadline,
            emission,
          ),
        );
        // Project comes from the credential-bound server descriptor, not an invented metadata field.
        return connectIdentitySchema.parse({
          connected_account_id: connection.id,
          project_id: config.context.composio_project_id,
          auth_config_id: auth.id,
          owner_id: connection.user_id,
          toolkit: connection.toolkit.slug,
          active: true,
          primary_email: profile.data.emailAddress,
        });
      } catch {
        throw unavailable();
      }
    },
  };
}
