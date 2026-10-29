// S00 metadata-only diagnostics. No env-file loading, messages or tool execution.
type Environment = Readonly<Record<string, string | undefined>>;
type CheckId =
  | "composio_auth"
  | "composio_mailbox_1"
  | "composio_mailbox_2"
  | "instantly_workspace"
  | "instantly_accounts"
  | "texttorrent_identity";
type Status =
  | "not_run"
  | "missing_config"
  | "invalid_config"
  | "ok"
  | "identity_mismatch"
  | "not_ready"
  | "auth_failed"
  | "permission_denied"
  | "plan_required"
  | "not_found"
  | "rate_limited"
  | "provider_error"
  | "invalid_response"
  | "timeout"
  | "network_error"
  | "blocked_redirect"
  | "skipped_dependency";
type Details = Partial<{
  customOAuth: boolean;
  playgroundUser: boolean;
  providerIdentityAvailable: boolean;
  apiAuthenticationVerified: boolean;
  expectedWorkspaceConfigured: boolean;
  sampledAccounts: number;
  morePages: boolean;
  accountScope: "parent";
}>;
export type ConnectionCheck = {
  check: CheckId;
  status: Status;
  httpStatus?: number;
  details?: Details;
};
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const gmail = (value: unknown) => {
  const slug = object(value)?.slug;
  return typeof slug === "string" && slug.toLowerCase() === "gmail";
};
const idPattern = /^(ac|ca)_[A-Za-z0-9_-]{1,128}$/;
const cleanHeader = (value: string) =>
  value.length <= 8192 && !/[\r\n\x00]/.test(value);
const maxBytes = 128 * 1024;

export async function runS00Connections(
  env: Environment,
  options: {
    executeReadonly?: boolean;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const checks: ConnectionCheck[] = [];
  const gmailIdentities: string[] = [];
  let networkCalls = 0;
  const value = (name: string) => env[name]?.trim() ?? "";
  const add = (check: CheckId, status: Status, details?: Details) => {
    checks.push({ check, status, ...(details ? { details } : {}) });
  };
  // Only fixed keys, enums, booleans and counters leave this module.
  const report = () => ({
    mode: options.executeReadonly ? "readonly_metadata" : "offline_no_network",
    networkCalls,
    maxNetworkCalls: 6,
    mutationRequests: 0,
    messageSends: 0,
    paidVerificationRequests: 0,
    providerBillingMeasured: false,
    operationalReadiness: "not_tested",
    distinctGmailMailboxesVerified:
      gmailIdentities.length === 2 &&
      new Set(gmailIdentities).size === 2 &&
      checks
        .filter((check) => check.check.startsWith("composio_mailbox_"))
        .every((check) => check.status === "ok"),
    checks,
  });
  if (!options.executeReadonly) {
    for (const check of [
      "composio_auth",
      "composio_mailbox_1",
      "composio_mailbox_2",
      "instantly_workspace",
      "instantly_accounts",
      "texttorrent_identity",
    ] as const) {
      add(check, "not_run");
    }
    return report();
  }

  const transport = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000) {
    throw new Error("S00_INVALID_TIMEOUT");
  }
  async function request(
    check: CheckId,
    url: string,
    headers: Record<string, string>,
    inspect: (body: JsonObject) => Pick<ConnectionCheck, "status" | "details">,
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response | undefined;
    let httpStatus: number | undefined;
    try {
      networkCalls++;
      response = await transport(url, {
        method: "GET",
        headers: { Accept: "application/json", ...headers },
        redirect: "manual",
        signal: controller.signal,
      });
      httpStatus = response.status;
      if (httpStatus !== 200) {
        const status: Status =
          httpStatus >= 300 && httpStatus < 400
            ? "blocked_redirect"
            : httpStatus === 401
              ? "auth_failed"
              : httpStatus === 402
                ? "plan_required"
                : httpStatus === 403
                  ? "permission_denied"
                  : httpStatus === 404
                    ? "not_found"
                    : httpStatus === 429
                      ? "rate_limited"
                      : "provider_error";
        checks.push({ check, status, httpStatus });
        return false;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error("S00_JSON_REQUIRED");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("S00_EMPTY_BODY");
      let size = 0;
      const parts: Uint8Array[] = [];
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) throw new Error("S00_BODY_LIMIT");
          parts.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      const body = object(JSON.parse(new TextDecoder().decode(bytes)));
      if (!body) throw new Error("S00_OBJECT_REQUIRED");
      const result = inspect(body);
      checks.push({ check, httpStatus, ...result });
      return result.status === "ok";
    } catch {
      checks.push({
        check,
        status: controller.signal.aborted
          ? "timeout"
          : httpStatus === 200
            ? "invalid_response"
            : "network_error",
        ...(httpStatus === undefined ? {} : { httpStatus }),
      });
      return false;
    } finally {
      clearTimeout(timer);
      await response?.body?.cancel().catch(() => undefined);
    }
  }

  const composioKey = value("COMPOSIO_API_KEY");
  const validComposioKey =
    cleanHeader(composioKey) && !/^(ac|ca)_/.test(composioKey);
  const authId = value("COMPOSIO_AUTH_CONFIG_ID");
  const accountIds = [
    value("COMPOSIO_CONNECTED_ACCOUNT_1_ID"),
    value("COMPOSIO_CONNECTED_ACCOUNT_2_ID"),
  ];
  if (!composioKey || !authId || accountIds.some((id) => !id)) {
    if (composioKey && validComposioKey) {
      await request(
        "composio_auth",
        "https://backend.composio.dev/api/v3.1/auth_configs?limit=1",
        { "x-api-key": composioKey },
        (body) => {
          const validPage =
            Array.isArray(body.items) &&
            body.items.length <= 1 &&
            body.items.every((item) => nonempty(object(item)?.id));
          return validPage
            ? {
                status: "missing_config",
                details: { apiAuthenticationVerified: true },
              }
            : { status: "invalid_response" };
        },
      );
    } else {
      add("composio_auth", composioKey ? "invalid_config" : "missing_config");
    }
    add("composio_mailbox_1", "skipped_dependency");
    add("composio_mailbox_2", "skipped_dependency");
  } else if (
    !validComposioKey ||
    !idPattern.test(authId) ||
    !authId.startsWith("ac_") ||
    accountIds.some((id) => !idPattern.test(id) || !id.startsWith("ca_")) ||
    accountIds[0] === accountIds[1]
  ) {
    add("composio_auth", "invalid_config");
    add("composio_mailbox_1", "skipped_dependency");
    add("composio_mailbox_2", "skipped_dependency");
  } else {
    const headers = { "x-api-key": composioKey };
    const authOk = await request(
      "composio_auth",
      `https://backend.composio.dev/api/v3.1/auth_configs/${authId}`,
      headers,
      (body) => {
        if (!nonempty(body.id) || !object(body.toolkit)) {
          return { status: "invalid_response" };
        }
        if (
          body.id !== authId ||
          !gmail(body.toolkit) ||
          body.auth_scheme !== "OAUTH2"
        ) {
          return { status: "identity_mismatch" };
        }
        return {
          status: body.status === "ENABLED" ? "ok" : "not_ready",
          ...(typeof body.is_composio_managed === "boolean"
            ? { details: { customOAuth: !body.is_composio_managed } }
            : {}),
        };
      },
    );
    for (const [index, id] of accountIds.entries()) {
      const check = index === 0 ? "composio_mailbox_1" : "composio_mailbox_2";
      if (!authOk) {
        add(check, "skipped_dependency");
        continue;
      }
      await request(
        check,
        `https://backend.composio.dev/api/v3.1/connected_accounts/${id}`,
        headers,
        (body) => {
          const auth = object(body.auth_config);
          if (!nonempty(body.id) || !auth || !nonempty(auth.id)) {
            return { status: "invalid_response" };
          }
          if (
            body.id !== id ||
            auth.id !== authId ||
            !gmail(body.toolkit) ||
            auth.auth_scheme !== "OAUTH2"
          ) {
            return { status: "identity_mismatch" };
          }
          const ready =
            body.status === "ACTIVE" &&
            body.is_disabled !== true &&
            auth.is_disabled !== true;
          const displayName = object(object(body.state)?.val)?.displayName;
          const identity =
            typeof displayName === "string" &&
            /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(displayName.trim())
              ? displayName.trim().toLowerCase()
              : undefined;
          const duplicate = identity && gmailIdentities.includes(identity);
          if (ready && identity) gmailIdentities.push(identity);
          return {
            status: !ready
              ? "not_ready"
              : duplicate
                ? "identity_mismatch"
                : "ok",
            details: {
              providerIdentityAvailable: !!identity,
              playgroundUser:
                typeof body.user_id === "string" &&
                body.user_id.startsWith("pg-test-"),
            },
          };
        },
      );
    }
  }

  const instantlyKey = value("INSTANTLY_API_KEY");
  const expectedWorkspace = value("INSTANTLY_WORKSPACE_ID");
  if (!instantlyKey || !cleanHeader(instantlyKey)) {
    add(
      "instantly_workspace",
      instantlyKey ? "invalid_config" : "missing_config",
    );
    add("instantly_accounts", "skipped_dependency");
  } else {
    const headers = { Authorization: `Bearer ${instantlyKey}` };
    const workspaceOk = await request(
      "instantly_workspace",
      "https://api.instantly.ai/api/v2/workspaces/current",
      headers,
      (body) => ({
        status: !nonempty(body.id)
          ? "invalid_response"
          : expectedWorkspace && expectedWorkspace !== body.id
            ? "identity_mismatch"
            : "ok",
        details: { expectedWorkspaceConfigured: !!expectedWorkspace },
      }),
    );
    if (!workspaceOk) {
      add("instantly_accounts", "skipped_dependency");
    } else {
      await request(
        "instantly_accounts",
        "https://api.instantly.ai/api/v2/accounts?limit=1",
        headers,
        (body) => {
          if (
            !Array.isArray(body.items) ||
            body.items.length > 1 ||
            body.items.some((item) => !nonempty(object(item)?.email))
          ) {
            return { status: "invalid_response" };
          }
          return {
            status: "ok",
            details: {
              sampledAccounts: body.items.length,
              morePages: nonempty(body.next_starting_after),
            },
          };
        },
      );
    }
  }

  const sid = value("TEXTTORRENT_API_SID");
  const publicKey = value("TEXTTORRENT_API_PUBLIC_KEY");
  if (!sid || !publicKey) {
    add("texttorrent_identity", "missing_config");
  } else if (
    !cleanHeader(sid) ||
    !cleanHeader(publicKey) ||
    value("TEXTTORRENT_ACT_AS_USER")
  ) {
    // This initial probe was authorized for the parent, not an arbitrary subuser.
    add("texttorrent_identity", "invalid_config");
  } else {
    await request(
      "texttorrent_identity",
      "https://api.texttorrent.com/api/v1/user/auth/me",
      { "X-API-SID": sid, "X-API-PUBLIC-KEY": publicKey },
      (body) => {
        const data = object(body.data);
        const validId =
          (Number.isSafeInteger(data?.id) && Number(data?.id) > 0) ||
          nonempty(data?.id);
        return {
          status:
            body.success === true && body.code === 200 && validId
              ? "ok"
              : "invalid_response",
          details: { accountScope: "parent" },
        };
      },
    );
  }
  return report();
}
