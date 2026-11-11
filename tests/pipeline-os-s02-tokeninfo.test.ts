import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";
import { withMailQuota } from "../src/lib/server/mail-quota";
import { createExistingComposioProvider } from "../src/lib/server/mail-accounts/composio-existing-provider";
import {
  verifyExistingComposioBinding,
  existingVerificationPassed,
  type ExistingVerificationPorts,
} from "../src/lib/server/mail-accounts/composio-existing-verifier";
import { requiredComposioScopes } from "../src/lib/server/mail-accounts/composio-verifier";

function fixture() {
  const q = quotaFixture();
  const target = {
    contract_version: 2 as const,
    account_id: q.account,
    binding_id: randomUUID(),
    binding_revision: 1,
    composio_project_id: "pr_fixture",
    auth_config_id: "ac_fixture",
    connected_account_id: "ca_existing",
    composio_user_id: "original-owner",
    quota_policy_id: q.policy.policy_id,
    quota_policy_generation: q.policy.generation,
    expected_mailbox_email: "one@example.test",
  };
  const context = {
    contract_version: 2,
    composio_project_id: target.composio_project_id,
    credential_version: "fixture-v1",
    auth_config_revision: "config-r1",
    provenance_reference: "synthetic-only",
    project_provenance: "server_reviewed",
    policy: q.policy,
  };
  const token: Record<string, unknown> = {
    aud: "synthetic-client.apps.example.test",
    scope: requiredComposioScopes.join(" "),
    expires_in: 3600,
  };
  const calls: string[] = [];
  let attempts = 0;
  let authorized = true;
  let before = async (_attempt: number) => {};
  let respond = async () => Response.json({ status: 200, data: token });
  const provider = createExistingComposioProvider({
    apiKey: "fixture-key-never-log",
    credentialVersion: context.credential_version,
    now: () => q.now,
    beforeRequest: async () => {
      attempts++;
      if (attempts > 4) throw Error("fixture budget exhausted");
      await before(attempts);
    },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://backend.composio.dev");
      assert.equal(url.search, "");
      assert.equal(init?.redirect, "manual");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.credentials, "omit");
      assert.equal(new Headers(init?.headers).has("Authorization"), false);
      assert.equal(
        new Headers(init?.headers).get("x-api-key"),
        "fixture-key-never-log",
      );
      if (url.pathname === "/api/v3.1/connected_accounts/ca_existing") {
        calls.push("connection");
        assert.equal(init?.method, "GET");
        return Response.json({
          id: target.connected_account_id,
          user_id: target.composio_user_id,
          authScheme: "OAUTH2",
          toolkit: { slug: "gmail" },
          auth_config: {
            id: target.auth_config_id,
            auth_scheme: "OAUTH2",
            is_disabled: false,
          },
          status: "ACTIVE",
          is_disabled: false,
          updated_at: "connection-r1",
          requested_scopes: requiredComposioScopes,
          effective_grants: { scopes: requiredComposioScopes },
          state: {
            val: {
              scope: requiredComposioScopes,
              access_token: "PRIVATE-FIXTURE-TOKEN",
            },
          },
        });
      }
      if (url.pathname === "/api/v3.1/auth_configs/ac_fixture") {
        calls.push("config");
        assert.equal(init?.method, "GET");
        return Response.json({
          id: target.auth_config_id,
          toolkit: { slug: "gmail" },
          auth_scheme: "OAUTH2",
          status: "ENABLED",
          last_updated_at: context.auth_config_revision,
        });
      }
      assert.equal(url.pathname, "/api/v3.1/tools/execute/proxy");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init.body));
      if (body.endpoint === "https://oauth2.googleapis.com/tokeninfo") {
        calls.push("tokeninfo");
        assert.deepEqual(body, {
          connected_account_id: "ca_existing",
          user_id: "original-owner",
          endpoint: "https://oauth2.googleapis.com/tokeninfo",
          method: "POST",
          parameters: [
            {
              name: "Content-Type",
              value: "application/x-www-form-urlencoded;charset=UTF-8",
              type: "header",
            },
          ],
        });
        return respond();
      }
      calls.push("profile");
      assert.deepEqual(body, {
        connected_account_id: "ca_existing",
        user_id: "original-owner",
        endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        method: "GET",
      });
      return Response.json({
        status: 200,
        data: { emailAddress: "one@example.test" },
      });
    },
  });
  const ports: ExistingVerificationPorts = {
    context: () => context,
    authorize: async () => authorized,
    now: () => q.now,
    ...provider,
  };
  const grantInput = () => ({
    target,
    connectionRevision: "connection-r1",
    deadlineMs: q.now + 30000,
    authorize: async () => {
      if (!authorized) throw Error("revoked");
    },
    signal: new AbortController().signal,
  });
  return {
    q,
    target,
    context,
    token,
    calls,
    ports,
    provider,
    grantInput,
    get attempts() {
      return attempts;
    },
    before(fn: typeof before) {
      before = fn;
    },
    respond(fn: typeof respond) {
      respond = fn;
    },
    revoke() {
      authorized = false;
    },
    run: () =>
      withMailQuota(q.deps, () => verifyExistingComposioBinding(target, ports)),
    grants: () =>
      withMailQuota(q.deps, () => provider.effectiveGrants(grantInput())),
  };
}

test("TI-AC01 real adapter composition uses four simulated requests and Gmail quota only for profile", async () => {
  const f = fixture();
  const facts = await f.run();
  assert.equal(existingVerificationPassed(facts), true);
  assert.deepEqual(f.calls, ["connection", "config", "tokeninfo", "profile"]);
  assert.equal(f.attempts, 4);
  assert.equal(
    f.q.calls.filter((c) => c.name === "mail_quota_reserve").length,
    1,
  );
  assert.equal(
    f.q.calls.find((c) => c.name === "mail_quota_reserve")?.input.units,
    1,
  );
});

test("TI-AC01 evidence minimizes claims and bounds local freshness; scopes normalize once", async () => {
  const f = fixture();
  f.token.scope = [...requiredComposioScopes, requiredComposioScopes[0]].join(
    "  ",
  );
  f.token.expires_in = "3600";
  f.token.email = "ONE@example.test";
  f.token.email_verified = "true";
  f.token.access_token = "PRIVATE-FIXTURE-TOKEN";
  const start = f.q.now;
  assert.deepEqual(await f.grants(), {
    source: "reviewed_effective_grants",
    contract_reference: "google-tokeninfo-proxy-v1",
    connected_account_id: "ca_existing",
    auth_config_id: "ac_fixture",
    user_id: "original-owner",
    connection_revision: "connection-r1",
    credential_version: "fixture-v1",
    observed_at_ms: start,
    expires_at_ms: start + 60000,
    scopes: requiredComposioScopes,
  });
  assert.equal(f.q.calls.length, 0);
});

const invalid: [string, (t: Record<string, unknown>) => void][] = [
  [
    "missing scope",
    (t) => {
      delete t.scope;
    },
  ],
  [
    "send not granted",
    (t) => {
      t.scope = requiredComposioScopes[0];
    },
  ],
  [
    "array scope",
    (t) => {
      t.scope = requiredComposioScopes;
    },
  ],
  [
    "scope control",
    (t) => {
      t.scope = requiredComposioScopes.join("\n");
    },
  ],
  [
    "too many scopes",
    (t) => {
      t.scope = [
        ...requiredComposioScopes,
        ...Array.from({ length: 65 }, (_, i) => "scope" + i),
      ].join(" ");
    },
  ],
  [
    "oversized scope",
    (t) => {
      t.scope = requiredComposioScopes.join(" ") + " " + "s".repeat(257);
    },
  ],
  [
    "aud absent",
    (t) => {
      delete t.aud;
    },
  ],
  [
    "aud empty",
    (t) => {
      t.aud = "";
    },
  ],
  [
    "expiry absent",
    (t) => {
      delete t.expires_in;
    },
  ],
  [
    "expiry zero",
    (t) => {
      t.expires_in = 0;
    },
  ],
  [
    "expiry negative",
    (t) => {
      t.expires_in = -1;
    },
  ],
  [
    "expiry fraction",
    (t) => {
      t.expires_in = 1.5;
    },
  ],
  [
    "expiry nonnumeric",
    (t) => {
      t.expires_in = "unknown";
    },
  ],
  [
    "expiry overflow",
    (t) => {
      t.expires_in = "9".repeat(30);
    },
  ],
  [
    "exp expired",
    (t) => {
      t.exp = 1;
    },
  ],
  [
    "exp invalid",
    (t) => {
      t.exp = "unknown";
    },
  ],
  [
    "different email",
    (t) => {
      t.email = "other@example.test";
    },
  ],
  [
    "email unverified",
    (t) => {
      t.email_verified = false;
    },
  ],
  [
    "email unverified string",
    (t) => {
      t.email_verified = "false";
    },
  ],
  [
    "OAuth error beside valid scopes",
    (t) => {
      t.error = "private-fixture-error";
    },
  ],
];
for (const [label, change] of invalid)
  test(
    "TI-AC02 blocks " + label + " without declared-scope fallback",
    async () => {
      const f = fixture();
      change(f.token);
      const result = await f.run();
      assert.equal(result.reason, "permission_unproven");
      assert.equal(result.permissions, false);
      assert.deepEqual(f.calls, ["connection", "config", "tokeninfo"]);
      assert.equal(f.attempts, 3);
      assert.equal(f.q.calls.length, 0);
    },
  );

for (const kind of ["revoked", "credential", "deadline", "abort"])
  test("TI-AC03 cancels after budget guard before wire: " + kind, async () => {
    const f = fixture();
    const controller = new AbortController();
    f.before(async (n) => {
      if (n !== 3) return;
      if (kind === "revoked") f.revoke();
      if (kind === "credential") f.context.credential_version = "changed";
      if (kind === "deadline") f.q.advance(30001);
      if (kind === "abort") controller.abort();
    });
    const result = await withMailQuota(f.q.deps, () =>
      verifyExistingComposioBinding(f.target, f.ports, {
        signal: controller.signal,
      }),
    );
    assert.equal(existingVerificationPassed(result), false);
    assert.deepEqual(f.calls, ["connection", "config"]);
    assert.equal(f.q.calls.length, 0);
  });

test("TI-AC03 strict target prevents destination injection and disabled v2 blocks before budget", async () => {
  const f = fixture();
  const input = f.grantInput();
  await withMailQuota(f.q.deps, async () => {
    const injected = {
      ...input,
      target: { ...input.target, endpoint: "https://foreign.example.test" },
    };
    assert.equal(await f.provider.effectiveGrants(injected), null);
    assert.equal(
      await withMailQuota({ ...f.q.deps, enabled: false }, () =>
        f.provider.effectiveGrants(input),
      ),
      null,
    );
  });
  assert.equal(f.attempts, 0);
  assert.deepEqual(f.calls, []);
});

test("TI-AC03 raw REST parameters are fixed and caller cannot inject Authorization or a destination", async () => {
  const f = fixture();
  const request = {
    ...f.grantInput(),
    endpoint: "https://foreign.example.test/",
    method: "DELETE",
    parameters: [
      {
        name: "Authorization",
        value: "Bearer PRIVATE-FIXTURE",
        type: "header",
      },
    ],
  };
  // Fixture asserts the complete raw REST body, including required parameter `type`.
  const proof = await withMailQuota(f.q.deps, () =>
    f.provider.effectiveGrants(request),
  );
  assert.ok(proof);
  assert.deepEqual(f.calls, ["tokeninfo"]);
  assert.equal(JSON.stringify(proof).includes("PRIVATE-FIXTURE"), false);
});

for (const kind of [
  "403",
  "429",
  "500",
  "redirect",
  "html",
  "json",
  "length",
  "overflow",
  "utf8",
  "network",
])
  test(
    "TI-AC04 tokeninfo transport fails closed with one attempt: " + kind,
    async () => {
      const f = fixture();
      f.respond(async () => {
        if (/^\d+$/.test(kind))
          return Response.json(
            { error: "PRIVATE-FIXTURE" },
            { status: Number(kind) },
          );
        if (kind === "redirect")
          return new Response(null, {
            status: 302,
            headers: { location: "https://foreign.example.test" },
          });
        if (kind === "html")
          return new Response("PRIVATE-FIXTURE", {
            headers: { "content-type": "text/html" },
          });
        if (kind === "json")
          return new Response("PRIVATE-FIXTURE", {
            headers: { "content-type": "application/json" },
          });
        if (kind === "length")
          return new Response("{}", {
            headers: {
              "content-type": "application/json",
              "content-length": "262145",
            },
          });
        if (kind === "overflow")
          return new Response(new Uint8Array(262145), {
            headers: { "content-type": "application/json" },
          });
        if (kind === "utf8")
          return new Response(new Uint8Array([255]), {
            headers: { "content-type": "application/json" },
          });
        throw Error("PRIVATE-FIXTURE");
      });
      const result = await f.run();
      assert.equal(existingVerificationPassed(result), false);
      assert.equal(result.reason, "provider_unavailable");
      assert(!JSON.stringify(result).includes("PRIVATE-FIXTURE"));
      assert.deepEqual(f.calls, ["connection", "config", "tokeninfo"]);
      assert.equal(f.attempts, 3);
      assert.equal(f.q.calls.length, 0);
    },
  );

test("TI-AC04 inner Google denial is not accepted as HTTP-200 evidence", async () => {
  const f = fixture();
  f.respond(async () => Response.json({ status: 403, data: f.token }));
  assert.equal((await f.run()).reason, "permission_unproven");
  assert.equal(f.attempts, 3);
});

test("TI-AC04 stalled budget guard aborts and cannot emit late", async () => {
  const f = fixture(),
    controller = new AbortController();
  let release!: () => void;
  f.before(
    async () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const task = withMailQuota(f.q.deps, () =>
    f.provider.effectiveGrants({
      ...f.grantInput(),
      signal: controller.signal,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  await assert.rejects(task, /EXISTING_PROVIDER_UNAVAILABLE/);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls, []);
  assert.equal(f.attempts, 1);
});

test("TI-AC05 latency is subtracted from expiry and exp can shorten evidence", async () => {
  const f = fixture(),
    start = f.q.now;
  f.token.expires_in = 10;
  f.token.exp = String(Math.floor((start + 5000) / 1000));
  f.respond(async () => {
    f.q.advance(2000);
    return Response.json({ status: 200, data: f.token });
  });
  const proof = (await f.grants()) as {
    observed_at_ms: number;
    expires_at_ms: number;
  };
  assert.equal(proof.observed_at_ms, start);
  assert.equal(proof.expires_at_ms, Number(f.token.exp) * 1000);
  assert(proof.expires_at_ms < f.q.now + 5000);
});

test("TI-AC05 expired token after transit returns unproven without profile", async () => {
  const f = fixture();
  f.token.expires_in = 1;
  f.respond(async () => {
    f.q.advance(1001);
    return Response.json({ status: 200, data: f.token });
  });
  assert.equal((await f.run()).reason, "permission_unproven");
  assert(!f.calls.includes("profile"));
});

test("TI-AC05 token expires during profile quota wait and retained reservation never emits", async () => {
  const f = fixture();
  f.token.expires_in = 1;
  f.q.wait(1001);
  const facts = await f.run();
  assert.equal(facts.reason, "permission_unproven");
  assert.equal(facts.permissions, false);
  assert(!f.calls.includes("profile"));
  assert.equal(
    f.q.calls.filter((c) => c.name === "mail_quota_reserve").length,
    1,
  );
});

test("TI-AC03 exhausted budget and unauthorized actor never reach tokeninfo", async () => {
  const f = fixture();
  f.before(async (n) => {
    if (n === 3) throw Error("PRIVATE-BUDGET");
  });
  assert.equal((await f.run()).reason, "provider_unavailable");
  assert.deepEqual(f.calls, ["connection", "config"]);
  const denied = fixture();
  denied.revoke();
  assert.equal((await denied.run()).reason, "stale_context");
  assert.equal(denied.attempts, 0);
});

test("TI-AC03 target mutation cannot retarget an in-flight tokeninfo request", async () => {
  const f = fixture();
  const input = f.grantInput();
  f.before(async () => {
    input.target.connected_account_id = "ca_foreign";
    input.target.composio_user_id = "foreign-owner";
  });
  const proof = (await withMailQuota(f.q.deps, () =>
    f.provider.effectiveGrants(input),
  )) as { connected_account_id: string; user_id: string };
  assert.equal(proof.connected_account_id, "ca_existing");
  assert.equal(proof.user_id, "original-owner");
  assert.equal(f.attempts, 1);
});

test("TI-AC03 adapter freezes key and credential version at construction", async () => {
  const f = fixture();
  const options = {
    apiKey: "initial-fictional-key",
    credentialVersion: "initial-version",
    now: () => f.q.now,
    beforeRequest: async () => {},
    fetchImpl: (async (_url, init) => {
      assert.equal(
        new Headers(init?.headers).get("x-api-key"),
        "initial-fictional-key",
      );
      return Response.json({ status: 200, data: f.token });
    }) as typeof fetch,
  };
  const p = createExistingComposioProvider(options);
  options.apiKey = "changed-fictional-key";
  options.credentialVersion = "changed-version";
  const proof = (await withMailQuota(f.q.deps, () =>
    p.effectiveGrants(f.grantInput()),
  )) as { credential_version: string };
  assert.equal(proof.credential_version, "initial-version");
});

test("TI-AC04 tokeninfo stalled response stream aborts with one request", async () => {
  const f = fixture(),
    controller = new AbortController();
  f.respond(
    async () =>
      new Response(
        new ReadableStream({
          pull: () => new Promise(() => {}),
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    await assert.rejects(
      withMailQuota(f.q.deps, () =>
        f.provider.effectiveGrants({
          ...f.grantInput(),
          signal: controller.signal,
        }),
      ),
      /EXISTING_PROVIDER_UNAVAILABLE/,
    );
  } finally {
    clearTimeout(timer);
  }
  assert.deepEqual(f.calls, ["tokeninfo"]);
  assert.equal(f.attempts, 1);
});

for (const delta of [-1, 10001])
  test(
    "TI-AC05 response outside monotonic step clock fails: " + delta,
    async () => {
      const f = fixture();
      f.respond(async () => {
        f.q.advance(delta);
        return Response.json({ status: 200, data: f.token });
      });
      assert.equal((await f.run()).reason, "provider_unavailable");
      assert(!f.calls.includes("profile"));
    },
  );

test("TI-AC05 grant expiration while profile returns never passes", async () => {
  const f = fixture();
  f.token.expires_in = 1;
  const profile = f.ports.profile;
  f.ports.profile = async (input) => {
    const result = await profile(input);
    f.q.advance(1001);
    return result;
  };
  const facts = await f.run();
  assert.equal(facts.reason, "permission_unproven");
  assert.equal(facts.permissions, false);
  assert.equal(existingVerificationPassed(facts), false);
  assert.equal(f.attempts, 4);
});
