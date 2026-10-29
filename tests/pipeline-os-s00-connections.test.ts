import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runS00Connections } from "../scripts/pipeline-os/s00-connections";

// Contract-shaped fixtures only; no local env files or real provider requests.
const secret = "private-fixture-sentinel";
const env = {
  COMPOSIO_API_KEY: secret,
  COMPOSIO_AUTH_CONFIG_ID: "ac_fixture",
  COMPOSIO_CONNECTED_ACCOUNT_1_ID: "ca_first",
  COMPOSIO_CONNECTED_ACCOUNT_2_ID: "ca_second",
  INSTANTLY_API_KEY: secret,
  INSTANTLY_WORKSPACE_ID: "workspace-fixture",
  TEXTTORRENT_API_SID: secret,
  TEXTTORRENT_API_PUBLIC_KEY: secret,
  TEXTTORRENT_ACT_AS_USER: "",
  // These must never be used by the connection harness.
  S00_TEST_RECIPIENT_EMAIL: `${secret}@example.test`,
  S00_TEST_RECIPIENT_PHONE: secret,
  NEXT_PUBLIC_SUPABASE_URL: `https://${secret}.invalid`,
  BOUNCER_API_KEY: secret,
};
const fixtures = (): Record<string, unknown>[] => [
  {
    id: "ac_fixture",
    toolkit: { slug: "gmail" },
    auth_scheme: "OAUTH2",
    status: "ENABLED",
    is_composio_managed: false,
    credentials: { client_secret: secret },
  },
  ...["ca_first", "ca_second"].map((id) => ({
    id,
    toolkit: { slug: "gmail" },
    auth_config: {
      id: "ac_fixture",
      auth_scheme: "OAUTH2",
      is_disabled: false,
    },
    status: "ACTIVE",
    is_disabled: false,
    user_id: `pg-test-${secret}`,
    state: { val: { access_token: secret, displayName: `${id}@fixture.test` } },
  })),
  { id: "workspace-fixture", owner: secret, name: secret },
  {
    items: [{ email: `${secret}@example.test`, signature: secret }],
    next_starting_after: secret,
  },
  {
    code: 200,
    success: true,
    data: {
      id: 1,
      email: secret,
      credits: 100,
      plan: { package_name: secret },
    },
  },
];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function transport(bodies = fixtures()) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const body = bodies[calls.length - 1];
    assert.ok(body, "Unexpected extra request");
    return json(body);
  };
  return { calls, fetchImpl };
}
const status = (
  report: Awaited<ReturnType<typeof runS00Connections>>,
  check: string,
) => report.checks.find((item) => item.check === check)?.status;

test("S00 connections are offline by default, even when credentials exist", async () => {
  let calls = 0;
  const report = await runS00Connections(env, {
    fetchImpl: async () => {
      calls++;
      throw new Error(secret);
    },
  });
  assert.equal(calls, 0);
  assert.equal(report.networkCalls, 0);
  assert.ok(report.checks.every((check) => check.status === "not_run"));
});

test("S00 missing configuration causes no requests and independent fixed diagnostics", async () => {
  const stub = transport();
  const report = await runS00Connections(
    {},
    { ...stub, executeReadonly: true },
  );
  assert.equal(stub.calls.length, 0);
  assert.equal(status(report, "composio_auth"), "missing_config");
  assert.equal(status(report, "instantly_workspace"), "missing_config");
  assert.equal(status(report, "texttorrent_identity"), "missing_config");
  assert.equal(report.checks.length, 6);
});

test("S00 uses six bounded GETs, isolates credentials and redacts successful payloads", async () => {
  const stub = transport();
  const report = await runS00Connections(env, {
    ...stub,
    executeReadonly: true,
  });
  assert.deepEqual(
    stub.calls.map((call) => call.url),
    [
      "https://backend.composio.dev/api/v3.1/auth_configs/ac_fixture",
      "https://backend.composio.dev/api/v3.1/connected_accounts/ca_first",
      "https://backend.composio.dev/api/v3.1/connected_accounts/ca_second",
      "https://api.instantly.ai/api/v2/workspaces/current",
      "https://api.instantly.ai/api/v2/accounts?limit=1",
      "https://api.texttorrent.com/api/v1/user/auth/me",
    ],
  );
  for (const [index, call] of stub.calls.entries()) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.redirect, "manual");
    assert.equal(call.init.body, undefined);
    const headers = new Headers(call.init.headers);
    assert.equal(headers.has("x-api-key"), index < 3);
    assert.equal(headers.has("authorization"), index === 3 || index === 4);
    assert.equal(headers.has("x-api-sid"), index === 5);
    assert.equal(headers.has("x-api-public-key"), index === 5);
    assert.equal(headers.has("x-act-as-user"), false);
  }
  assert.ok(report.checks.every((check) => check.status === "ok"));
  assert.equal(report.networkCalls, 6);
  assert.equal(report.mutationRequests, 0);
  assert.equal(report.messageSends, 0);
  assert.equal(report.paidVerificationRequests, 0);
  assert.equal(report.providerBillingMeasured, false);
  assert.equal(report.operationalReadiness, "not_tested");
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(JSON.stringify(report).includes("ca_first"), false);
  assert.deepEqual(report.checks[4].details, {
    sampledAccounts: 1,
    morePages: true,
  });
  assert.deepEqual(report.checks[1].details, {
    playgroundUser: true,
    providerIdentityAvailable: true,
  });
  assert.equal(report.distinctGmailMailboxesVerified, true);
});

test("S00 can verify a Composio project key without choosing missing connection IDs", async () => {
  const calls: string[] = [];
  const report = await runS00Connections(
    { COMPOSIO_API_KEY: secret },
    {
      executeReadonly: true,
      fetchImpl: async (url, init) => {
        calls.push(String(url));
        assert.equal(init?.method, "GET");
        return json({
          items: [{ id: "ac_other_fixture", credentials: secret }],
        });
      },
    },
  );
  assert.deepEqual(calls, [
    "https://backend.composio.dev/api/v3.1/auth_configs?limit=1",
  ]);
  assert.equal(status(report, "composio_auth"), "missing_config");
  assert.deepEqual(report.checks[0].details, {
    apiAuthenticationVerified: true,
  });
  assert.equal(report.networkCalls, 1);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(JSON.stringify(report).includes("ac_other_fixture"), false);
});

test("S00 rejects an auth config or connection ID mistakenly saved as the API key", async () => {
  for (const key of ["ac_fixture", "ca_first"]) {
    for (const input of [
      {
        ...env,
        COMPOSIO_API_KEY: key,
        INSTANTLY_API_KEY: "",
        TEXTTORRENT_API_SID: "",
      },
      { COMPOSIO_API_KEY: key },
    ]) {
      let calls = 0;
      const report = await runS00Connections(input, {
        executeReadonly: true,
        fetchImpl: async () => {
          calls++;
          throw new Error("Unexpected network request");
        },
      });
      assert.equal(status(report, "composio_auth"), "invalid_config");
      assert.equal(calls, 0);
    }
  }
});

test("S00 distinguishes two Gmail connections from two distinct provider mailboxes", async () => {
  for (const identity of [`${secret}@fixture.test`, undefined]) {
    const bodies = fixtures();
    for (const index of [1, 2]) {
      bodies[index].state = { val: { displayName: identity } };
    }
    const stub = transport(bodies);
    const report = await runS00Connections(env, {
      ...stub,
      executeReadonly: true,
    });
    assert.equal(report.distinctGmailMailboxesVerified, false);
    assert.equal(
      status(report, "composio_mailbox_2"),
      identity ? "identity_mismatch" : "ok",
    );
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test("S00 rejects duplicate or malformed Composio IDs before constructing a URL", async () => {
  for (const change of [
    { COMPOSIO_CONNECTED_ACCOUNT_2_ID: "ca_first" },
    { COMPOSIO_AUTH_CONFIG_ID: "ca_wrong_kind" },
    { COMPOSIO_CONNECTED_ACCOUNT_1_ID: "ca_../../tools/execute" },
    { COMPOSIO_API_KEY: "bad\r\nheader" },
  ]) {
    let calls = 0;
    const report = await runS00Connections(
      { ...env, INSTANTLY_API_KEY: "", TEXTTORRENT_API_SID: "", ...change },
      {
        executeReadonly: true,
        fetchImpl: async () => {
          calls++;
          throw new Error(secret);
        },
      },
    );
    assert.equal(calls, 0);
    assert.equal(status(report, "composio_auth"), "invalid_config");
  }
});

test("S00 does not accept mismatched or inactive Gmail accounts as ready", async () => {
  for (const change of [
    { id: "ca_other" },
    { toolkit: { slug: "github" } },
    { auth_config: { id: "ac_other", auth_scheme: "OAUTH2" } },
    { auth_config: { id: "ac_fixture", auth_scheme: "API_KEY" } },
    { status: "EXPIRED" },
    { is_disabled: true },
    {
      auth_config: {
        id: "ac_fixture",
        auth_scheme: "OAUTH2",
        is_disabled: true,
      },
    },
  ]) {
    const bodies = fixtures();
    bodies[1] = { ...bodies[1], ...change };
    const stub = transport(bodies);
    const report = await runS00Connections(env, {
      ...stub,
      executeReadonly: true,
    });
    assert.notEqual(status(report, "composio_mailbox_1"), "ok");
    assert.equal(status(report, "composio_mailbox_2"), "ok");
    assert.equal(status(report, "texttorrent_identity"), "ok");
  }
});

test("S00 stops dependent requests for a disabled auth config or wrong workspace", async () => {
  const calls: string[] = [];
  const report = await runS00Connections(env, {
    executeReadonly: true,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("auth_configs")) {
        return json({ ...fixtures()[0], status: "DISABLED" });
      }
      if (String(url).includes("workspaces/current"))
        return json({ id: secret });
      return json(fixtures()[5]);
    },
  });
  assert.equal(status(report, "composio_auth"), "not_ready");
  assert.equal(status(report, "instantly_workspace"), "identity_mismatch");
  assert.equal(status(report, "composio_mailbox_1"), "skipped_dependency");
  assert.equal(status(report, "instantly_accounts"), "skipped_dependency");
  assert.equal(status(report, "texttorrent_identity"), "ok");
  assert.equal(calls.length, 3);
});

test("S00 reports an unpinned Instantly workspace without claiming expected identity", async () => {
  const bodies = fixtures();
  bodies[4] = { items: [], next_starting_after: "" };
  const stub = transport(bodies);
  const report = await runS00Connections(
    { ...env, INSTANTLY_WORKSPACE_ID: "" },
    { ...stub, executeReadonly: true },
  );
  assert.equal(status(report, "instantly_workspace"), "ok");
  assert.deepEqual(report.checks[3].details, {
    expectedWorkspaceConfigured: false,
  });
  assert.deepEqual(report.checks[4].details, {
    sampledAccounts: 0,
    morePages: false,
  });
});

test("S00 rejects arbitrary subaccount selection in the parent-only TextTorrent probe", async () => {
  const report = await runS00Connections(
    {
      TEXTTORRENT_API_SID: secret,
      TEXTTORRENT_API_PUBLIC_KEY: secret,
      TEXTTORRENT_ACT_AS_USER: `${secret}@example.test`,
    },
    {
      executeReadonly: true,
      fetchImpl: async () => {
        throw new Error("This must not run");
      },
    },
  );
  assert.equal(report.networkCalls, 0);
  assert.equal(status(report, "texttorrent_identity"), "invalid_config");
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("S00 classifies HTTP failures without retries, error content or dependent requests", async () => {
  for (const [code, expected] of [
    [401, "auth_failed"],
    [402, "plan_required"],
    [403, "permission_denied"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "provider_error"],
    [503, "provider_error"],
  ] as const) {
    let calls = 0;
    const report = await runS00Connections(env, {
      executeReadonly: true,
      fetchImpl: async () => {
        calls++;
        return json({ [secret]: secret }, code);
      },
    });
    assert.equal(calls, 3);
    assert.equal(status(report, "composio_auth"), expected);
    assert.equal(status(report, "instantly_workspace"), expected);
    assert.equal(status(report, "texttorrent_identity"), expected);
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test("S00 never follows a credential-bearing redirect", async () => {
  let calls = 0;
  const report = await runS00Connections(env, {
    executeReadonly: true,
    fetchImpl: async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { location: `https://${secret}.invalid` },
      });
    },
  });
  assert.equal(calls, 3);
  assert.equal(status(report, "composio_auth"), "blocked_redirect");
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("S00 rejects invalid JSON, non-JSON, oversized responses and unknown shapes", async () => {
  for (const response of [
    () =>
      new Response(secret, { headers: { "content-type": "application/json" } }),
    () => new Response(secret, { headers: { "content-type": "text/html" } }),
    () => json({ data: secret.repeat(8000) }),
    () => json([secret]),
    () => json({ data: secret }),
  ]) {
    const report = await runS00Connections(env, {
      executeReadonly: true,
      fetchImpl: async () => response(),
    });
    assert.equal(status(report, "composio_auth"), "invalid_response");
    assert.equal(status(report, "instantly_workspace"), "invalid_response");
    assert.equal(status(report, "texttorrent_identity"), "invalid_response");
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test("S00 rejects HTTP 200 with TextTorrent failure or missing identity", async () => {
  for (const body of [
    { code: 200, success: false, data: { id: 1 } },
    { code: 401, success: true, data: { id: 1 } },
    { code: 200, success: true, data: {} },
  ]) {
    const bodies = fixtures();
    bodies[5] = body;
    const stub = transport(bodies);
    const report = await runS00Connections(env, {
      ...stub,
      executeReadonly: true,
    });
    assert.equal(status(report, "texttorrent_identity"), "invalid_response");
  }
});

test("S00 bounds timeouts and hides network and abort exception text", async () => {
  const report = await runS00Connections(env, {
    executeReadonly: true,
    timeoutMs: 5,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error(secret)),
          {
            once: true,
          },
        );
      }),
  });
  assert.equal(report.networkCalls, 3);
  assert.equal(status(report, "composio_auth"), "timeout");
  assert.equal(status(report, "texttorrent_identity"), "timeout");
  const failed = await runS00Connections(env, {
    executeReadonly: true,
    fetchImpl: async () => {
      throw new Error(secret);
    },
  });
  assert.equal(status(failed, "composio_auth"), "network_error");
  assert.equal(JSON.stringify([report, failed]).includes(secret), false);
  await assert.rejects(
    runS00Connections(env, { executeReadonly: true, timeoutMs: 8001 }),
    /S00_INVALID_TIMEOUT/,
  );
});

test("S00 connection CLI never loads files, defaults offline and redacts invalid arguments", () => {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) delete childEnv[key];
  const run = (args: string[], extraEnv = {}) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/pipeline-os/s00-connections-cli.ts",
        ...args,
      ],
      { encoding: "utf8", env: { ...childEnv, ...extraEnv } },
    );
  const offline = run([], env);
  assert.equal(offline.status, 0);
  assert.equal(JSON.parse(offline.stdout).networkCalls, 0);
  const absent = run(["--execute-readonly"]);
  assert.equal(absent.status, 2);
  assert.equal(JSON.parse(absent.stdout).networkCalls, 0);
  const invalid = run(["--config-env", secret]);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.stringify(invalid).includes(secret), false);
  assert.equal(JSON.parse(invalid.stderr).error, "S00_CONNECTIONS_INPUT_ERROR");
});
