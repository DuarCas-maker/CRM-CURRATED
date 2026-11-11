import { z } from "zod";
import { mailQuotaEnabled, assertMailQuotaEmission } from "../mail-quota";
import {
  existingConnection,
  existingConfig,
  existingVerificationTarget,
  type ExistingVerificationPorts,
} from "./composio-existing-verifier";
// Pinned metadata, tokeninfo and profile. No token extraction, OAuth mutations or send.
const root = "https://backend.composio.dev/api/v3.1";
const reference = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const positiveSeconds = z.union([
  z.number().int().positive().safe(),
  z
    .string()
    .regex(/^[1-9]\d{0,12}$/)
    .transform(Number),
]);
const wireTokeninfo = z.object({
  status: z.literal(200),
  data: z.object({
    error: z.never().optional(),
    aud: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[\x21-\x7e]+$/),
    scope: z
      .string()
      .min(1)
      .max(16384)
      .regex(/^[\x21\x23-\x5b\x5d-\x7e]+(?: +[\x21\x23-\x5b\x5d-\x7e]+)*$/),
    expires_in: positiveSeconds,
    exp: positiveSeconds.optional(),
    email: z.email().max(254).optional(),
    email_verified: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .optional(),
  }),
});
const wireConnection = z.object({
  id: z.string(),
  user_id: z.string(),
  authScheme: z.literal("OAUTH2"),
  toolkit: z.object({ slug: z.string() }),
  auth_config: z.object({
    id: z.string(),
    auth_scheme: z.literal("OAUTH2"),
    is_disabled: z.boolean(),
  }),
  status: z.string(),
  is_disabled: z.boolean(),
  updated_at: z.string(),
  experimental: z
    .object({ account_type: z.literal("PRIVATE").optional() })
    .optional(),
});
const wireConfig = z.object({
  id: z.string(),
  toolkit: z.object({ slug: z.string() }),
  auth_scheme: z.literal("OAUTH2"),
  status: z.string(),
  last_updated_at: z.string(),
});
export function createExistingComposioProvider(options: {
  apiKey: string;
  credentialVersion: string;
  now?(): number;
  fetchImpl: typeof fetch;
  beforeRequest(): Promise<void>;
}): Pick<
  ExistingVerificationPorts,
  "connection" | "authConfig" | "effectiveGrants" | "profile"
> {
  if (
    !options.apiKey ||
    options.apiKey.length > 4096 ||
    /[^\x21-\x7e]/.test(options.apiKey) ||
    !reference.safeParse(options.credentialVersion).success
  )
    throw new Error("EXISTING_PROVIDER_UNAVAILABLE");
  const { apiKey, credentialVersion, fetchImpl, beforeRequest } = options;
  const now = options.now ?? Date.now;
  async function read(
    path: string,
    signal: AbortSignal,
    body?: Record<string, unknown>,
    tokeninfoGuard?: () => Promise<void>,
  ) {
    if (signal.aborted) throw new Error("EXISTING_PROVIDER_UNAVAILABLE");
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal.addEventListener("abort", stop, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Response | undefined;
    try {
      const task = async () => {
        await beforeRequest();
        if (controller.signal.aborted) throw new Error();
        if (tokeninfoGuard) await tokeninfoGuard();
        if (controller.signal.aborted) throw new Error();
        if (body) {
          if (!mailQuotaEnabled())
            throw new Error("EFFECTIVE_GRANTS_SOURCE_REQUIRED");
          if (!tokeninfoGuard) assertMailQuotaEmission("composio", "profile");
        }
        response = await fetchImpl(root + path, {
          method: body ? "POST" : "GET",
          headers: {
            "x-api-key": apiKey,
            accept: "application/json",
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          cache: "no-store",
          credentials: "omit",
          redirect: "manual",
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          throw new Error();
        }
        if (
          response.status !== 200 ||
          response.redirected ||
          !/^application\/json(?:;|$)/i.test(
            response.headers.get("content-type") ?? "",
          )
        )
          throw new Error();
        const length = response.headers.get("content-length");
        if (
          length !== null &&
          (!/^\d+$/.test(length) || Number(length) > 262144)
        )
          throw new Error();
        const reader = response.body?.getReader();
        if (!reader) throw new Error();
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        controller.signal.addEventListener("abort", cancel, { once: true });
        try {
          while (true) {
            if (controller.signal.aborted) throw new Error();
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > 262144) throw new Error();
            chunks.push(next.value);
          }
          if (controller.signal.aborted) throw new Error();
          return JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          );
        } finally {
          controller.signal.removeEventListener("abort", cancel);
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      };
      return await Promise.race([
        task(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error());
          }, 10000);
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error()),
            { once: true },
          );
        }),
      ]);
    } catch {
      throw new Error("EXISTING_PROVIDER_UNAVAILABLE");
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      controller.abort();
      if (response && !response.bodyUsed)
        void response.body?.cancel().catch(() => {});
    }
  }
  return {
    async connection({ id, signal }) {
      if (!/^ca_[A-Za-z0-9_-]{1,128}$/.test(id))
        throw new Error("EXISTING_PROVIDER_UNAVAILABLE");
      const r = wireConnection.parse(
        await read("/connected_accounts/" + id, signal),
      );
      // Unknown fields, requested_scopes, credentials and fabricated effective_grants are discarded.
      return existingConnection.parse({
        id: r.id,
        auth_config_id: r.auth_config.id,
        user_id: r.user_id,
        toolkit: r.toolkit.slug,
        status: r.status,
        disabled: r.is_disabled || r.auth_config.is_disabled,
        revision: r.updated_at,
      });
    },
    async authConfig({ id, signal }) {
      if (!/^ac_[A-Za-z0-9_-]{1,128}$/.test(id))
        throw new Error("EXISTING_PROVIDER_UNAVAILABLE");
      const r = wireConfig.parse(await read("/auth_configs/" + id, signal));
      return existingConfig.parse({
        id: r.id,
        toolkit: r.toolkit.slug,
        enabled: r.status === "ENABLED",
        revision: r.last_updated_at,
      });
    },
    async effectiveGrants(input) {
      // Clone validated server input before any await; never serialize arbitrary caller fields.
      const target = existingVerificationTarget.safeParse(input.target);
      if (
        !target.success ||
        !reference.safeParse(input.connectionRevision).success ||
        !Number.isSafeInteger(input.deadlineMs) ||
        typeof input.authorize !== "function" ||
        !mailQuotaEnabled()
      )
        return null;
      const t = target.data;
      const { connectionRevision, deadlineMs, authorize, signal } = input;
      const started = now();
      const alive = () => {
        const current = now();
        if (
          signal.aborted ||
          !mailQuotaEnabled() ||
          !Number.isSafeInteger(current) ||
          current < started ||
          current >= deadlineMs ||
          current - started >= 10000
        )
          throw new Error("EXISTING_PROVIDER_UNAVAILABLE");
      };
      if (!Number.isSafeInteger(started) || started < 0) return null;
      alive();
      const value = await read(
        "/tools/execute/proxy",
        signal,
        {
          connected_account_id: t.connected_account_id,
          user_id: t.composio_user_id,
          endpoint: "https://oauth2.googleapis.com/tokeninfo",
          method: "POST",
          // Raw v3.1 uses `type`; SDK proxy parameter shapes may use `in`.
          parameters: [
            {
              name: "Content-Type",
              value: "application/x-www-form-urlencoded;charset=UTF-8",
              type: "header",
            },
          ],
        },
        async () => {
          alive();
          await authorize();
          alive();
        },
      );
      alive();
      const parsed = wireTokeninfo.safeParse(value);
      if (!parsed.success) return null;
      const data = parsed.data.data;
      const scopes = [...new Set(data.scope.split(/ +/))];
      const expiresAt = Math.min(
        started + 60000,
        started + data.expires_in * 1000,
        data.exp === undefined ? Infinity : data.exp * 1000,
      );
      if (
        scopes.length > 64 ||
        scopes.some((scope) => scope.length > 256) ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= now() ||
        (data.email !== undefined &&
          data.email.toLowerCase() !==
            t.expected_mailbox_email.toLowerCase()) ||
        data.email_verified === false ||
        data.email_verified === "false"
      )
        return null;
      return {
        source: "reviewed_effective_grants",
        contract_reference: "google-tokeninfo-proxy-v1",
        connected_account_id: t.connected_account_id,
        auth_config_id: t.auth_config_id,
        user_id: t.composio_user_id,
        connection_revision: connectionRevision,
        credential_version: credentialVersion,
        observed_at_ms: started,
        expires_at_ms: expiresAt,
        scopes,
      };
    },
    async profile({ connectedAccountId, userId, signal }) {
      if (
        !/^ca_[A-Za-z0-9_-]{1,128}$/.test(connectedAccountId) ||
        !userId ||
        userId.length > 1024 ||
        /[\s\x00-\x1f\x7f]/.test(userId)
      )
        throw new Error("EXISTING_PROVIDER_UNAVAILABLE");
      const value = await read("/tools/execute/proxy", signal, {
        connected_account_id: connectedAccountId,
        user_id: userId,
        endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        method: "GET",
      });
      const r = z
        .object({
          status: z.literal(200),
          data: z.object({
            emailAddress: z.string().trim().pipe(z.email().max(254)),
          }),
        })
        .parse(value);
      return {
        connected_account_id: connectedAccountId,
        primary_email: r.data.emailAddress,
      };
    },
  };
}
