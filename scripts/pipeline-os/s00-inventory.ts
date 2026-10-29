// Metadata inventory only. This module never loads env files or executes tools.
type Env = Readonly<Record<string, string | undefined>>;
type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : {};
const str = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const scopes = {
  profile: "https://www.googleapis.com/auth/userinfo.profile",
  email: "https://www.googleapis.com/auth/userinfo.email",
  read: "https://www.googleapis.com/auth/gmail.readonly",
  send: "https://www.googleapis.com/auth/gmail.send",
  compose: "https://www.googleapis.com/auth/gmail.compose",
  modify: "https://www.googleapis.com/auth/gmail.modify",
  fullMailbox: "https://mail.google.com/",
};
const scopeFlags = (value: unknown) => {
  const available = Array.isArray(value) || typeof value === "string";
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : str(value).split(/[\s,]+/);
  return Object.fromEntries(
    Object.entries(scopes).map(([name, scope]) => [
      name,
      available ? values.includes(scope) : null,
    ]),
  );
};
const publicVersion = (value: unknown) =>
  /^\d{8}_\d{2}$/.test(str(value)) ? str(value) : null;
const headerValid = (value: string) =>
  !!value && value.length <= 8192 && !/[\r\n\x00]/.test(value);
const positiveId = (value: unknown) =>
  (Number.isSafeInteger(value) && Number(value) > 0) || !!str(value).trim();

export function inventoryUrlAllowed(raw: string) {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.hash) return false;
    const routes: Record<string, RegExp> = {
      "https://backend.composio.dev":
        /^\/api\/v3\.1\/(?:auth_configs\/ac_[A-Za-z0-9_-]{1,128}|connected_accounts\/ca_[A-Za-z0-9_-]{1,128}|tools\/(?:GMAIL_SEND_EMAIL|GMAIL_FETCH_EMAILS|GMAIL_REPLY_TO_THREAD|GMAIL_GET_ATTACHMENT|GMAIL_GET_PROFILE)|triggers_types\/GMAIL_NEW_GMAIL_MESSAGE|trigger_instances\/active)$/,
      "https://api.instantly.ai":
        /^\/api\/v2\/(?:accounts|api-keys|workspaces\/current|workspace-billing\/plan-details)$/,
      "https://api.texttorrent.com":
        /^\/api\/v1\/(?:user\/sub-account\/list|inbox\/numbers\/active)$/,
    };
    if (!routes[url.origin]?.test(url.pathname)) return false;
    return [...url.searchParams.keys()].every((key) =>
      [
        "limit",
        "page",
        "starting_after",
        "version",
        "toolkit_versions",
        "auth_config_ids",
      ].includes(key),
    );
  } catch {
    return false;
  }
}

export async function runS00Inventory(
  env: Env,
  options: { executeReadonly?: boolean; fetchImpl?: typeof fetch } = {},
) {
  const checks: Obj[] = [];
  let networkCalls = 0;
  const stoppedProviders = new Set<string>();
  const get = (name: string) => env[name]?.trim() ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;
  const report = () => ({
    mode: options.executeReadonly ? "readonly_inventory" : "offline_no_network",
    networkCalls,
    requestBudget: 40,
    sends: 0,
    toolExecutions: 0,
    paidOperations: 0,
    providerBillingMeasured: false,
    checks,
  });
  if (!options.executeReadonly) return report();

  async function read(
    label: string,
    url: string,
    headers: Record<string, string>,
  ) {
    const result: Obj = { check: label, status: "not_run" };
    checks.push(result);
    if (stoppedProviders.has(new URL(url).origin)) {
      result.status = "skipped_provider_auth_or_rate_limit";
      return { result };
    }
    if (
      networkCalls >= 40 ||
      !inventoryUrlAllowed(url) ||
      Object.values(headers).some((value) => !headerValid(value))
    ) {
      result.status = "blocked_input_or_budget";
      return { result };
    }
    let response: Response | undefined;
    try {
      networkCalls++;
      response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json", ...headers },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      result.httpStatus = response.status;
      const numericHeader = (name: string) => {
        const value = response?.headers.get(name);
        return value && /^\d+$/.test(value) ? Number(value) : null;
      };
      result.observedApiLimit = numericHeader("x-ratelimit");
      result.observedApiRemaining = numericHeader("x-ratelimit-remaining");
      if (response.status !== 200) {
        if ([401, 429].includes(response.status))
          stoppedProviders.add(new URL(url).origin);
        result.status =
          response.status === 403
            ? "permission_denied"
            : response.status === 401
              ? "auth_failed"
              : response.status === 429
                ? "rate_limited"
                : response.status === 405
                  ? "method_mismatch"
                  : response.status >= 300 && response.status < 400
                    ? "blocked_redirect"
                    : "provider_error";
        return { result };
      }
      if (
        !(response.headers.get("content-type") ?? "").includes(
          "application/json",
        )
      ) {
        throw new Error("JSON_REQUIRED");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("EMPTY_RESPONSE");
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 131072) throw new Error("RESPONSE_LIMIT");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const buffer = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      const body: unknown = JSON.parse(new TextDecoder().decode(buffer));
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error("OBJECT_REQUIRED");
      result.status = "ok";
      return { result, body: obj(body) };
    } catch {
      result.status =
        response?.status === 200
          ? "invalid_response"
          : "network_or_timeout_error";
      return { result };
    } finally {
      await response?.body?.cancel().catch(() => undefined);
    }
  }

  const composioHeaders = { "x-api-key": get("COMPOSIO_API_KEY") };
  const authId = get("COMPOSIO_AUTH_CONFIG_ID");
  const pilotMailboxes: string[] = [];
  if (
    headerValid(composioHeaders["x-api-key"]) &&
    /^ac_[A-Za-z0-9_-]{1,128}$/.test(authId)
  ) {
    const config = await read(
      "composio_config_scopes",
      `https://backend.composio.dev/api/v3.1/auth_configs/${authId}`,
      composioHeaders,
    );
    if (config.body) {
      const credentials = obj(config.body.credentials);
      config.result.matchesExpectedConfig = config.body.id === authId;
      config.result.configuredScopeFlags = scopeFlags(
        credentials.scopes ?? credentials.scope,
      );
      config.result.scopeClaimsAreEffectiveGrant = false;
    }
    for (const index of [1, 2]) {
      const id = get(`COMPOSIO_CONNECTED_ACCOUNT_${index}_ID`);
      if (!/^ca_[A-Za-z0-9_-]{1,128}$/.test(id)) continue;
      const account = await read(
        `composio_mailbox_${index}_scopes`,
        `https://backend.composio.dev/api/v3.1/connected_accounts/${id}`,
        composioHeaders,
      );
      if (!account.body) continue;
      const matches =
        account.body.id === id && obj(account.body.auth_config).id === authId;
      account.result.matchesExpectedConnection = matches;
      account.result.requestedScopeFlags = scopeFlags(
        account.body.requested_scopes,
      );
      account.result.scopeClaimsAreEffectiveGrant = false;
      const identity = str(obj(obj(account.body.state).val).displayName)
        .trim()
        .toLowerCase();
      if (matches && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identity))
        pilotMailboxes[index - 1] = identity;
    }
    for (const slug of [
      "GMAIL_SEND_EMAIL",
      "GMAIL_FETCH_EMAILS",
      "GMAIL_REPLY_TO_THREAD",
      "GMAIL_GET_ATTACHMENT",
      "GMAIL_GET_PROFILE",
    ]) {
      const tool = await read(
        `metadata_${slug.toLowerCase()}`,
        `https://backend.composio.dev/api/v3.1/tools/${slug}?version=latest`,
        composioHeaders,
      );
      if (!tool.body) continue;
      tool.result.metadataMatches = tool.body.slug === slug;
      tool.result.version = publicVersion(tool.body.version);
      tool.result.documentedScopeFlags = scopeFlags(tool.body.scopes);
      tool.result.hasStructuredScopeRequirements =
        !!tool.body.scope_requirements;
      tool.result.executionPermissionVerified = false;
    }
    const trigger = await read(
      "composio_new_mail_trigger_metadata",
      "https://backend.composio.dev/api/v3.1/triggers_types/GMAIL_NEW_GMAIL_MESSAGE?toolkit_versions=latest",
      composioHeaders,
    );
    if (trigger.body) {
      trigger.result.metadataMatches =
        trigger.body.slug === "GMAIL_NEW_GMAIL_MESSAGE";
      trigger.result.pollSupported =
        trigger.body.type === "poll" ||
        (Array.isArray(trigger.body.types) &&
          trigger.body.types.includes("poll"));
      trigger.result.webhookSupported =
        trigger.body.type === "webhook" ||
        (Array.isArray(trigger.body.types) &&
          trigger.body.types.includes("webhook"));
      trigger.result.version = publicVersion(trigger.body.version);
    }
    const active = await read(
      "composio_active_triggers_for_config",
      `https://backend.composio.dev/api/v3.1/trigger_instances/active?auth_config_ids=${authId}&limit=50`,
      composioHeaders,
    );
    if (active.body && Array.isArray(active.body.items)) {
      active.result.sampledTriggers = active.body.items.length;
      active.result.complete = !active.body.next_cursor;
      active.result.totalReported = number(active.body.total_items);
    } else if (active.body) active.result.status = "unexpected_shape";
  } else checks.push({ check: "composio_inventory", status: "missing_config" });

  const instantlyKey = get("INSTANTLY_API_KEY");
  if (headerValid(instantlyKey)) {
    const headers = { Authorization: `Bearer ${instantlyKey}` };
    const workspace = await read(
      "instantly_workspace_target",
      "https://api.instantly.ai/api/v2/workspaces/current",
      headers,
    );
    const expected = get("INSTANTLY_WORKSPACE_ID");
    const matched =
      workspace.body && expected && workspace.body.id === expected;
    workspace.result.expectedWorkspaceMatched = !!matched;
    if (matched) {
      const plan = await read(
        "instantly_plan_limits",
        "https://api.instantly.ai/api/v2/workspace-billing/plan-details",
        headers,
      );
      if (plan.body) {
        const subscriptions = obj(plan.body.subscriptions);
        const outreach = obj(subscriptions.outreach);
        const credits = obj(subscriptions.credits);
        plan.result.outreachLeadLimit = number(outreach.total_lead_limit);
        plan.result.baseLeadLimit = number(outreach.base_lead_limit);
        plan.result.availableCredits = number(credits.available_credits);
        plan.result.hasOutreachSubscription = !!subscriptions.outreach;
      }
      const accounts: Obj[] = [];
      let cursor = "";
      let complete = false;
      for (let page = 0; page < 5; page++) {
        const response = await read(
          "instantly_accounts_page",
          `https://api.instantly.ai/api/v2/accounts?limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ""}`,
          headers,
        );
        if (!response.body || !Array.isArray(response.body.items)) break;
        for (const raw of response.body.items) {
          const item = obj(raw);
          if (!str(item.email)) continue;
          const pilotIndex = pilotMailboxes.indexOf(
            str(item.email).toLowerCase(),
          );
          accounts.push({
            alias: `mailbox_${accounts.length + 1}`,
            matchesComposioMailbox: pilotIndex < 0 ? null : pilotIndex + 1,
            statusCode: number(item.status),
            dailyLimit: number(item.daily_limit),
            dailyLimitMax: number(item.daily_limit_max),
            sendingGap: number(item.sending_gap),
            setupPending: item.setup_pending === true,
          });
        }
        const next = str(response.body.next_starting_after);
        response.result.sampledAccounts = response.body.items.length;
        if (!next) {
          complete = true;
          break;
        }
        if (next === cursor || next.length > 4096) break;
        cursor = next;
      }
      checks.push({
        check: "instantly_mailboxes_summary",
        status: "summary",
        complete,
        count: accounts.length,
        accounts,
      });
      const keys = await read(
        "instantly_current_key_scopes",
        "https://api.instantly.ai/api/v2/api-keys?limit=100",
        headers,
      );
      if (keys.body && Array.isArray(keys.body.items)) {
        const current = keys.body.items
          .map(obj)
          .find((item) => item.key === instantlyKey);
        const keyScopes = Array.isArray(current?.scopes) ? current.scopes : [];
        keys.result.currentKeyIdentified = !!current;
        keys.result.scopeFlags = Object.fromEntries(
          [
            "all:read",
            "all:all",
            "accounts:read",
            "campaigns:read",
            "campaigns:create",
            "campaigns:update",
            "leads:read",
            "leads:create",
            "webhooks:read",
            "workspace_billing:read",
          ].map((scope) => [scope, current ? keyScopes.includes(scope) : null]),
        );
      }
    }
  } else
    checks.push({ check: "instantly_inventory", status: "missing_config" });

  const sid = get("TEXTTORRENT_API_SID");
  const publicKey = get("TEXTTORRENT_API_PUBLIC_KEY");
  if (
    headerValid(sid) &&
    headerValid(publicKey) &&
    !get("TEXTTORRENT_ACT_AS_USER")
  ) {
    const headers = { "X-API-SID": sid, "X-API-PUBLIC-KEY": publicKey };
    const subaccounts: Obj[] = [];
    const seenSubaccounts = new Set<string>();
    let subaccountsComplete = false;
    for (let page = 1; page <= 5; page++) {
      const response = await read(
        "texttorrent_subaccounts_page",
        `https://api.texttorrent.com/api/v1/user/sub-account/list?limit=50&page=${page}`,
        headers,
      );
      const data = obj(response.body?.data);
      if (
        !response.body ||
        response.body.success !== true ||
        !Array.isArray(data.data)
      )
        break;
      for (const raw of data.data) {
        const account = obj(raw);
        if (
          !positiveId(account.id) ||
          account.type !== "sub" ||
          seenSubaccounts.has(String(account.id))
        )
          continue;
        seenSubaccounts.add(String(account.id));
        subaccounts.push(account);
      }
      response.result.records = data.data.length;
      response.result.totalReported = number(data.total);
      if (typeof data.last_page === "number" && page >= data.last_page) {
        subaccountsComplete = true;
        break;
      }
      if (data.data.length === 0) break;
    }
    checks.push({
      check: "texttorrent_subaccounts_summary",
      status: "summary",
      complete: subaccountsComplete,
      count: subaccounts.length,
      accounts: subaccounts.map((account, index) => ({
        alias: `subaccount_${index + 1}`,
        active: account.status === 1,
        approved: account.admin_approval === 1,
        dailySmsLimit: number(account.daily_sms_limit),
        zeroLimitMeansUnlimitedByUserSetting: account.daily_sms_limit === 0,
        effectivePermissionsVerified: false,
        explicitPermissionCount: Array.isArray(account.permissions)
          ? account.permissions.length
          : null,
        explicitPermissionFlags: Object.fromEntries(
          [
            "view_contacts",
            "send_messages",
            "view_inbox",
            "view_analytics",
            "create_campaigns",
            "manage_notes",
          ].map((permission) => [
            permission,
            Array.isArray(account.permissions)
              ? account.permissions.includes(permission)
              : null,
          ]),
        ),
      })),
    });
    const parentIds = [
      ...new Set(
        subaccounts
          .filter((account) => positiveId(account.parent_id))
          .map((account) => String(account.parent_id)),
      ),
    ];
    const contexts = [
      {
        alias: "parent",
        email: "",
        ownerId: parentIds.length === 1 ? parentIds[0] : "",
      },
      ...subaccounts
        .map((account, index) => ({
          alias: `subaccount_${index + 1}`,
          email: str(account.email),
          ownerId: String(account.id),
          active: account.status === 1,
        }))
        .filter(
          (account) =>
            account.active && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(account.email),
        ),
    ];
    for (const context of contexts) {
      let total = 0;
      let sms = 0;
      let mms = 0;
      let smsUnknown = 0;
      let mmsUnknown = 0;
      let complete = false;
      let mismatchedOwners = 0;
      const seenLines = new Set<string>();
      const scopedHeaders: Record<string, string> = {
        ...headers,
        ...(context.email ? { "X-ACT-AS-USER": context.email } : {}),
      };
      for (let page = 1; page <= 5; page++) {
        const response = await read(
          "texttorrent_active_numbers_page",
          `https://api.texttorrent.com/api/v1/inbox/numbers/active?limit=50&page=${page}`,
          scopedHeaders,
        );
        response.result.accountAlias = context.alias;
        const data = obj(response.body?.data);
        if (
          !response.body ||
          response.body.success !== true ||
          !Array.isArray(data.data)
        )
          break;
        for (const raw of data.data) {
          const line = obj(raw);
          if (line.status !== 1 || !str(line.number)) continue;
          if (context.ownerId && String(line.user_id) !== context.ownerId) {
            mismatchedOwners++;
            continue;
          }
          const lineKey = positiveId(line.id)
            ? String(line.id)
            : str(line.number);
          if (seenLines.has(lineKey)) continue;
          seenLines.add(lineKey);
          total++;
          const capabilities = obj(line.capabilities);
          if (capabilities.sms === true) sms++;
          if (capabilities.mms === true) mms++;
          if (typeof capabilities.sms !== "boolean") smsUnknown++;
          if (typeof capabilities.mms !== "boolean") mmsUnknown++;
        }
        if (typeof data.last_page === "number" && page >= data.last_page) {
          complete = true;
          break;
        }
        if (data.data.length === 0) break;
      }
      checks.push({
        check: "texttorrent_lines_summary",
        status: "summary",
        accountAlias: context.alias,
        complete,
        activeLines: total,
        smsCapableLines: sms,
        mmsCapableLines: mms,
        smsCapabilityUnknownLines: smsUnknown,
        mmsCapabilityUnknownLines: mmsUnknown,
        expectedOwnerKnown: !!context.ownerId,
        mismatchedOwnerRecords: mismatchedOwners,
      });
    }
  } else
    checks.push({
      check: "texttorrent_inventory",
      status: "missing_config_or_parent_scope_required",
    });
  return report();
}
