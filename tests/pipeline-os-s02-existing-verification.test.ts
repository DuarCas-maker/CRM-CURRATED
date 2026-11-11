import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";
import {
  withMailQuota,
  assertMailQuotaEmission,
  reserveGmailQuota,
} from "../src/lib/server/mail-quota";
import {
  verifyExistingComposioBinding,
  existingVerificationPassed,
  existingVerificationHash,
  type ExistingVerificationPorts,
} from "../src/lib/server/mail-accounts/composio-existing-verifier";
import { createExistingComposioProvider } from "../src/lib/server/mail-accounts/composio-existing-provider";
import {
  requiredComposioScopes,
  verifyComposioBinding,
} from "../src/lib/server/mail-accounts/composio-verifier";
function fixture() {
  const q = quotaFixture(),
    calls: string[] = [];
  const target = {
    contract_version: 2,
    account_id: q.account,
    binding_id: randomUUID(),
    binding_revision: 1,
    composio_project_id: "pr_fixture",
    auth_config_id: "ac_fixture",
    connected_account_id: "ca_existing",
    composio_user_id: "legacy-owner",
    quota_policy_id: q.policy.policy_id,
    quota_policy_generation: 1,
    expected_mailbox_email: "one@example.test",
  };
  const context = {
    contract_version: 2,
    composio_project_id: "pr_fixture",
    credential_version: "fixture-v1",
    auth_config_revision: "2026-11-10T10:00:00Z",
    provenance_reference: "synthetic-review",
    project_provenance: "server_reviewed",
    policy: q.policy,
  };
  const connection = {
    id: target.connected_account_id,
    auth_config_id: target.auth_config_id,
    user_id: target.composio_user_id,
    toolkit: "gmail",
    status: "ACTIVE",
    disabled: false,
    revision: "connection-r1",
  };
  const config = {
    id: target.auth_config_id,
    toolkit: "gmail",
    enabled: true,
    revision: context.auth_config_revision,
  };
  const grants = {
    source: "reviewed_effective_grants",
    contract_reference: "synthetic-contract-only",
    connected_account_id: target.connected_account_id,
    auth_config_id: target.auth_config_id,
    user_id: target.composio_user_id,
    connection_revision: connection.revision,
    credential_version: context.credential_version,
    observed_at_ms: q.now,
    expires_at_ms: q.now + 60000,
    scopes: [...requiredComposioScopes],
  };
  const profile = {
    connected_account_id: target.connected_account_id,
    primary_email: "ONE@example.test",
  };
  let authorized = true;
  const ports: ExistingVerificationPorts = {
    context: () => structuredClone(context),
    authorize: async () => authorized,
    now: () => q.now,
    connection: async (input) => {
      calls.push("connection");
      assert.equal(input.id, target.connected_account_id);
      return connection;
    },
    authConfig: async (input) => {
      calls.push("config");
      assert.equal(input.id, target.auth_config_id);
      return config;
    },
    effectiveGrants: async () => {
      calls.push("grants");
      return grants;
    },
    profile: async (input) => {
      calls.push("profile");
      assert.equal(input.connectedAccountId, target.connected_account_id);
      assert.equal(input.userId, "legacy-owner");
      assertMailQuotaEmission("composio", "profile");
      return profile;
    },
  };
  return {
    q,
    target,
    context,
    connection,
    config,
    grants,
    profile,
    ports,
    calls,
    revoke: () => {
      authorized = false;
    },
    run: () =>
      withMailQuota(q.deps, () => verifyExistingComposioBinding(target, ports)),
  };
}
test("QGR-I03 legacy C2 cannot bypass active v2 admission", async () => {
  const q = quotaFixture();
  let reads = 0;
  const deny = async () => {
    reads++;
    throw Error("unreachable");
  };
  const result = await withMailQuota(q.deps, () =>
    verifyComposioBinding(
      {},
      {},
      { connection: deny, authConfig: deny, profile: deny },
    ),
  );
  assert.equal(result.reason, "stale_context");
  assert.equal(reads, 0);
});
test("QGR-I03 v2 verifies synthetic authorized evidence without a Google project or OAuth link", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(existingVerificationPassed(result), true);
  assert.equal(result.quota_policy, true);
  assert.equal("quota" in result, false);
  assert.equal("google_quota_project_id" in f.target, false);
  assert.deepEqual(f.calls, ["connection", "config", "grants", "profile"]);
  assert.equal(
    f.q.calls.find((c) => c.name === "mail_quota_reserve")!.input.units,
    1,
  );
  assert.equal(
    f.q.calls.find((c) => c.name === "mail_quota_reserve")!.input
      .direct_project,
    null,
  );
  assert.equal(f.target.composio_user_id, "legacy-owner");
});
test("QGR-I03 v2 does not reinterpret v1 context or invented Google IDs", async () => {
  const f = fixture();
  await withMailQuota(f.q.deps, async () => {
    assert.equal(
      (
        await verifyExistingComposioBinding(
          { ...f.target, google_quota_project_id: "invented" },
          f.ports,
        )
      ).reason,
      "verification_incomplete",
    );
    assert.equal(
      (
        await verifyExistingComposioBinding(
          { ...f.target, contract_version: 1 },
          f.ports,
        )
      ).reason,
      "verification_incomplete",
    );
  });
  assert.equal(f.calls.length, 0);
});
for (const change of ["owner", "account", "configuration", "inactive"])
  test("QGR-I03 v2 metadata mismatch blocks: " + change, async () => {
    const f = fixture();
    if (change === "owner") f.connection.user_id = "other-owner";
    if (change === "account") f.connection.id = "ca_other";
    if (change === "configuration") f.config.revision = "changed";
    if (change === "inactive") f.connection.disabled = true;
    const result = await f.run();
    assert.equal(existingVerificationPassed(result), false);
    assert(!f.calls.includes("profile"));
    assert.equal(f.q.calls.length, 0);
  });
for (const change of [
  "missing",
  "declared",
  "owner",
  "connection",
  "revision",
  "credential",
  "expired",
  "old",
  "scope",
])
  test("QGR-I03 v2 effective evidence invalid: " + change, async () => {
    const f = fixture();
    if (change === "missing") f.ports.effectiveGrants = async () => null;
    if (change === "declared")
      f.ports.effectiveGrants = async () => ({
        ...f.grants,
        source: "requested_scopes",
      });
    if (change === "owner") f.grants.user_id = "other";
    if (change === "connection") f.grants.connected_account_id = "ca_other";
    if (change === "revision") f.grants.connection_revision = "old";
    if (change === "credential") f.grants.credential_version = "old";
    if (change === "expired") f.grants.expires_at_ms = f.q.now;
    if (change === "old") {
      f.grants.observed_at_ms = f.q.now - 40000;
      f.grants.expires_at_ms = f.q.now + 10000;
    }
    if (change === "scope") f.grants.scopes = [requiredComposioScopes[0]];
    const result = await f.run();
    assert.equal(existingVerificationPassed(result), false);
    assert(!f.calls.includes("profile"));
    assert.equal(f.q.calls.length, 0);
    assert.equal(
      result.reason,
      change === "declared" ? "verification_incomplete" : "permission_unproven",
    );
  });
test("QGR-I03 v2 revocation and policy change during pacing block profile", async () => {
  for (const kind of ["session", "policy"]) {
    const f = fixture();
    f.q.wait(200);
    f.q.afterSleep(async () => {
      if (kind === "session") f.revoke();
      else f.context.credential_version = "fixture-v2";
    });
    const result = await f.run();
    assert.equal(existingVerificationPassed(result), false);
    assert(!f.calls.includes("profile"));
  }
});
test("QGR-I03 v2 mailbox mismatch and stale context after profile never pass", async () => {
  const f = fixture();
  f.profile.primary_email = "other@example.test";
  assert.equal((await f.run()).reason, "identity_mismatch");
  const s = fixture(),
    old = s.ports.profile;
  s.ports.profile = async (input) => {
    const v = await old(input);
    s.context.policy = { ...s.context.policy, generation: 2 };
    return v;
  };
  assert.equal((await s.run()).reason, "stale_context");
});
test("QGR-I03 grants expiring during quota wait stop before profile", async () => {
  const f = fixture();
  f.q.wait(100);
  f.grants.expires_at_ms = f.q.now + 50;
  const result = await f.run();
  assert.equal(result.reason, "permission_unproven");
  assert.equal(result.permissions, false);
  assert(!f.calls.includes("profile"));
});
test("QGR-I03 abort bounds an unresponsive provider and sanitizes its details", async () => {
  const f = fixture(),
    controller = new AbortController();
  f.ports.connection = async () => new Promise(() => {});
  const timer = setTimeout(() => controller.abort(), 10);
  const result = await withMailQuota(f.q.deps, () =>
    verifyExistingComposioBinding(f.target, f.ports, {
      signal: controller.signal,
    }),
  );
  clearTimeout(timer);
  assert.equal(existingVerificationPassed(result), false);
  assert.equal(f.q.calls.length, 0);
  assert.equal(JSON.stringify(result).includes("token"), false);
});
test("QGR-I03 v2 digest includes policy limits/generation and credential/config revision", () => {
  const f = fixture(),
    before = existingVerificationHash(f.context);
  assert.ok(before);
  for (const patch of [
    { credential_version: "new" },
    { auth_config_revision: "new" },
    { policy: { ...f.context.policy, generation: 2 } },
    {
      policy: {
        ...f.context.policy,
        limits: { ...f.context.policy.limits, group_units_per_window: 100 },
      },
    },
  ])
    assert.notEqual(
      existingVerificationHash({ ...f.context, ...patch }),
      before,
    );
});
test("QGR-I03 wire discards declared grants/tokens when tokeninfo denies proof", async () => {
  const f = fixture(),
    wires: string[] = [];
  const provider = createExistingComposioProvider({
    credentialVersion: "fixture-v1",
    apiKey: "synthetic-only-key",
    beforeRequest: async () => {},
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://backend.composio.dev");
      wires.push(url.pathname);
      if (url.pathname === "/api/v3.1/tools/execute/proxy") {
        assert.equal(init?.method, "POST");
        assert.equal(
          JSON.parse(String(init.body)).endpoint,
          "https://oauth2.googleapis.com/tokeninfo",
        );
        return Response.json({ status: 403, data: { error: "denied" } });
      }
      assert.equal(init?.method, "GET");
      if (url.pathname.includes("connected_accounts"))
        return Response.json({
          id: "ca_existing",
          user_id: "legacy-owner",
          authScheme: "OAUTH2",
          toolkit: { slug: "gmail" },
          auth_config: {
            id: "ac_fixture",
            auth_scheme: "OAUTH2",
            is_disabled: false,
          },
          status: "ACTIVE",
          is_disabled: false,
          updated_at: "connection-r1",
          requested_scopes: requiredComposioScopes,
          effective_grants: f.grants,
          state: { val: { access_token: "SENSITIVE-FIXTURE" } },
        });
      assert.equal(url.pathname, "/api/v3.1/auth_configs/ac_fixture");
      return Response.json({
        id: "ac_fixture",
        toolkit: { slug: "gmail" },
        auth_scheme: "OAUTH2",
        status: "ENABLED",
        last_updated_at: f.context.auth_config_revision,
        credentials: { scopes: requiredComposioScopes },
      });
    },
  });
  f.ports = { ...f.ports, ...provider };
  const result = await withMailQuota(f.q.deps, () =>
    verifyExistingComposioBinding(f.target, f.ports),
  );
  assert.equal(result.reason, "permission_unproven");
  assert.equal(wires.length, 3);
  assert.equal(f.q.calls.length, 0);
  assert(!JSON.stringify(result).includes("SENSITIVE"));
  assert(!wires.some((p) => /link|refresh|revoke|complete_auth/.test(p)));
});
test("QGR-I03 profile wire requires a v2 lease and pins owner/connection/endpoint", async () => {
  const f = fixture();
  let wires = 0;
  const provider = createExistingComposioProvider({
    credentialVersion: "fixture-v1",
    apiKey: "synthetic-key",
    beforeRequest: async () => {},
    fetchImpl: async (input, init) => {
      wires++;
      assert.equal(
        String(input),
        "https://backend.composio.dev/api/v3.1/tools/execute/proxy",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init.body)), {
        connected_account_id: "ca_existing",
        user_id: "legacy-owner",
        endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        method: "GET",
      });
      return Response.json({
        status: 200,
        data: { emailAddress: "one@example.test" },
      });
    },
  });
  const request = {
    connectedAccountId: "ca_existing",
    userId: "legacy-owner",
    signal: new AbortController().signal,
  };
  await withMailQuota(f.q.deps, async () => {
    await assert.rejects(provider.profile(request));
    assert.equal(wires, 0);
    const lease = await reserveGmailQuota({
      account: f.q.account,
      provider: "composio",
      path: "profile",
      requiresV2: true,
      authorize: f.q.authorize,
      legacy: async () => {
        throw Error("forbidden legacy");
      },
    });
    assert.deepEqual(await lease.emit(() => provider.profile(request)), {
      connected_account_id: "ca_existing",
      primary_email: "one@example.test",
    });
  });
  assert.equal(wires, 1);
});
test("QGR-I03 profile rechecks deadline after its final asynchronous authorization", async () => {
  const f = fixture();
  let wires = 0;
  const provider = createExistingComposioProvider({
    credentialVersion: "fixture-v1",
    apiKey: "synthetic-key",
    beforeRequest: async () => {
      f.q.advance(120001);
    },
    fetchImpl: async () => {
      wires++;
      throw Error("unreachable");
    },
  });
  await withMailQuota(f.q.deps, async () => {
    const lease = await reserveGmailQuota({
      account: f.q.account,
      provider: "composio",
      path: "profile",
      requiresV2: true,
      authorize: f.q.authorize,
      legacy: async () => {
        throw Error();
      },
    });
    await assert.rejects(
      lease.emit(() =>
        provider.profile({
          connectedAccountId: "ca_existing",
          userId: "legacy-owner",
          signal: new AbortController().signal,
        }),
      ),
    );
  });
  assert.equal(wires, 0);
});
for (const kind of ["status", "redirect", "type", "utf8", "length", "overflow"])
  test(
    "QGR-I03 metadata wire rejects malformed response without retry: " + kind,
    async () => {
      let calls = 0;
      const provider = createExistingComposioProvider({
        credentialVersion: "fixture-v1",
        apiKey: "never-log-fixture-key",
        beforeRequest: async () => {},
        fetchImpl: async (_input, init) => {
          calls++;
          assert.equal(init?.redirect, "manual");
          if (kind === "status")
            return Response.json(
              { error: "private-fixture-details" },
              { status: 429 },
            );
          if (kind === "redirect")
            return new Response(null, {
              status: 302,
              headers: { location: "https://foreign.example.test/" },
            });
          if (kind === "type")
            return new Response("private-fixture-details", {
              headers: { "content-type": "text/html" },
            });
          if (kind === "utf8")
            return new Response(new Uint8Array([255]), {
              headers: { "content-type": "application/json" },
            });
          if (kind === "length")
            return new Response("{}", {
              headers: {
                "content-type": "application/json",
                "content-length": "262145",
              },
            });
          return new Response(new Uint8Array(262145), {
            headers: { "content-type": "application/json" },
          });
        },
      });
      await assert.rejects(
        provider.connection({
          id: "ca_existing",
          signal: new AbortController().signal,
        }),
        (error) => {
          assert.equal(
            (error as Error).message,
            "EXISTING_PROVIDER_UNAVAILABLE",
          );
          return true;
        },
      );
      assert.equal(calls, 1);
    },
  );
test("QGR-I03 metadata stream abort stays bounded and makes one attempt", async () => {
  const controller = new AbortController();
  let calls = 0;
  const provider = createExistingComposioProvider({
    credentialVersion: "fixture-v1",
    apiKey: "synthetic-key",
    beforeRequest: async () => {},
    fetchImpl: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    await assert.rejects(
      provider.connection({ id: "ca_existing", signal: controller.signal }),
      /EXISTING_PROVIDER_UNAVAILABLE/,
    );
    assert.equal(calls, 1);
  } finally {
    clearTimeout(timer);
  }
});
