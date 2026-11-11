import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bindingCommandV2Schema,
  bindingV2Query,
} from "../src/lib/composio-bindings-v2";
import {
  bindingPageV2,
  bindingCheckV2,
  bindingCommandV2,
  type BindingV2Ports,
} from "../src/lib/server/mail-accounts/composio-binding-v2";
import { withMailQuota } from "../src/lib/server/mail-quota";
import { existingVerificationHash } from "../src/lib/server/mail-accounts/composio-existing-verifier";
import { requiredComposioScopes } from "../src/lib/server/mail-accounts/composio-verifier";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";
import { resolvedBindingSchema } from "../src/lib/server/mail-transport/resolved-binding";
import {
  executeRuntimeMail,
  withMailRuntime,
  composioProductOperationEnabled,
  type RuntimeDependencies,
} from "../src/lib/server/mail-transport/runtime-context";

export function i04Fixture() {
  const q = quotaFixture(),
    binding = randomUUID(),
    check = randomUUID(),
    events: string[] = [];
  const context = {
    contract_version: 2 as const,
    composio_project_id: "pr_fixture",
    credential_version: "cred1",
    auth_config_revision: "rev1",
    provenance_reference: "review1",
    project_provenance: "server_reviewed" as const,
    policy: q.policy,
  };
  const target = {
    contract_version: 2,
    account_id: q.account,
    binding_id: binding,
    binding_revision: 1,
    composio_project_id: context.composio_project_id,
    auth_config_id: "ac_fixture",
    connected_account_id: "ca_fixture",
    composio_user_id: "owner",
    quota_policy_id: q.policy.policy_id,
    quota_policy_generation: 1,
    expected_mailbox_email: "one@example.test",
  };
  const expected = {
    expected_head_revision: 1,
    expected_account_revision: 1,
    expected_brand_revision: 1,
    expected_context_hash: "a".repeat(64),
  };
  let denied = false,
    replay = false,
    afterWire = () => {},
    descriptor: unknown = { context, auth_config_id: "ac_fixture" };
  const db = {
    rpc: async (name: string, p: Record<string, unknown>) => {
      events.push(name);
      if (denied)
        return { data: null, error: { message: "C_BINDING_FORBIDDEN" } };
      let data: unknown = null;
      if (name === "composio_binding_check_begin_v2")
        data = {
          contract_version: 2,
          id: check,
          status: "prepared",
          replay,
          valid_until: null,
        };
      if (name === "composio_binding_check_snapshot_v2") data = target;
      if (name === "composio_binding_check_admit_v2") data = true;
      if (name === "composio_binding_check_finish_v2") {
        const f = p.facts as { reason: unknown };
        if (f.reason === null) {
          assert.ok(p.evidence);
          assert.equal(events.filter((x) => x === "wire").length, 4);
        }
        data = {
          contract_version: 2,
          id: check,
          status: f.reason === null ? "completed" : "failed",
          replay: false,
          valid_until:
            f.reason === null ? new Date(q.now + 20000).toISOString() : null,
        };
      }
      return { data, error: null };
    },
  } as unknown as SupabaseClient;
  const ports: BindingV2Ports = {
    enabled: true,
    checksEnabled: true,
    human: db,
    service: () => {
      events.push("factory");
      return db;
    },
    descriptor: () => {
      events.push("descriptor");
      return descriptor;
    },
    apiKey: () => {
      events.push("key");
      return "fake-key";
    },
    now: () => q.now,
    fetchImpl: async (input, init) => {
      events.push("wire");
      const url = String(input);
      afterWire();
      if (url.endsWith("/connected_accounts/ca_fixture"))
        return Response.json({
          id: "ca_fixture",
          user_id: "owner",
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
        });
      if (url.endsWith("/auth_configs/ac_fixture"))
        return Response.json({
          id: "ac_fixture",
          toolkit: { slug: "gmail" },
          auth_scheme: "OAUTH2",
          status: "ENABLED",
          last_updated_at: "rev1",
        });
      const body = JSON.parse(String(init?.body));
      assert.equal(body.connected_account_id, "ca_fixture");
      assert.equal(body.user_id, "owner");
      if (body.endpoint === "https://oauth2.googleapis.com/tokeninfo")
        return Response.json({
          status: 200,
          data: {
            aud: "fake.apps.example.test",
            scope: requiredComposioScopes.join(" "),
            expires_in: 3600,
          },
        });
      assert.equal(
        body.endpoint,
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      );
      return Response.json({
        status: 200,
        data: { emailAddress: "one@example.test" },
      });
    },
  };
  const checkInput = {
    contract_version: 2,
    binding_id: binding,
    expected,
    idempotency_key: randomUUID(),
  };
  return {
    q,
    binding,
    check,
    context,
    target,
    expected,
    events,
    ports,
    checkInput,
    run: () =>
      withMailQuota(q.deps, () => bindingCheckV2(ports, q.account, checkInput)),
    deny: () => {
      denied = true;
    },
    replay: () => {
      replay = true;
    },
    afterWire: (f: () => void) => {
      afterWire = f;
    },
    descriptor: (v: unknown) => {
      descriptor = v;
    },
  };
}
test("I04 DTO v2 is explicit, strict and never accepts browser policy/proof or fake Google project", () => {
  const f = i04Fixture();
  const input = {
    contract_version: 2,
    kind: "register_candidate",
    payload: {
      ...f.expected,
      composio_project_id: "pr_fixture",
      auth_config_id: "ac_fixture",
      connected_account_id: "ca_fixture",
      composio_user_id: "owner",
    },
    idempotency_key: randomUUID(),
  };
  assert.ok(bindingCommandV2Schema.safeParse(input).success);
  for (const extra of [
    { google_quota_project_id: "fake" },
    { policy: f.q.policy },
    { facts: {} },
    { evidence: {} },
  ])
    assert.equal(
      bindingCommandV2Schema.safeParse({
        ...input,
        payload: { ...input.payload, ...extra },
      }).success,
      false,
    );
  assert.equal(bindingV2Query(new URLSearchParams("contract_version=3")), null);
  assert.equal(
    bindingV2Query(
      new URLSearchParams("contract_version=2&contract_version=2"),
    ),
    null,
  );
  assert.deepEqual(
    bindingV2Query(new URLSearchParams("contract_version=2&limit=25")),
    { cursor: null, limit: 25 },
  );
});
test("I04 orchestration: four admitted synthetic requests with exact tokeninfo receipt; check does not confirm", async () => {
  const f = i04Fixture();
  const r = await f.run();
  assert.equal(r.status, "completed");
  assert.equal(f.events.filter((x) => x === "wire").length, 4);
  assert.equal(
    f.events.filter((x) => x === "composio_binding_check_admit_v2").length,
    4,
  );
  assert.ok(
    f.events.indexOf("composio_binding_authorize_v2") <
      f.events.indexOf("factory"),
  );
  assert.ok(
    f.events.indexOf("composio_binding_check_begin_v2") <
      f.events.indexOf("key"),
  );
  assert.equal(f.events.includes("composio_binding_command_v2"), false);
});
test("I04 replay never recreates provider requests or accesses API key", async () => {
  const f = i04Fixture();
  f.replay();
  assert.equal((await f.run()).replay, true);
  assert.equal(f.events.includes("wire"), false);
  assert.equal(f.events.includes("key"), false);
});
test("I04 authorization and disabled gates precede credential/factory access", async () => {
  const f = i04Fixture();
  f.deny();
  await assert.rejects(f.run(), /superadmin/);
  assert.equal(f.events.includes("descriptor"), false);
  assert.equal(f.events.includes("factory"), false);
  const g = i04Fixture();
  g.ports.enabled = false;
  await assert.rejects(g.run());
  assert.deepEqual(g.events, []);
  const h = i04Fixture();
  h.ports.checksEnabled = false;
  await assert.rejects(h.run());
  assert.equal(h.events.includes("factory"), false);
});
test("I04 session revocation or descriptor rotation during check stops subsequent wires", async () => {
  const f = i04Fixture();
  f.afterWire(() => f.deny());
  await assert.rejects(f.run());
  assert.equal(f.events.filter((x) => x === "wire").length, 1);
  const g = i04Fixture();
  g.afterWire(() =>
    g.descriptor({
      context: { ...g.context, credential_version: "rotated" },
      auth_config_id: "ac_fixture",
    }),
  );
  await assert.rejects(g.run());
  assert.equal(g.events.filter((x) => x === "wire").length, 1);
});
test("I04 page reads and malformed commands never instantiate service or read credentials", async () => {
  const f = i04Fixture();
  await assert.rejects(bindingPageV2(f.ports, f.q.account, null, 25));
  await assert.rejects(
    bindingCommandV2(f.ports, f.q.account, { contract_version: 3 }),
  );
  assert.equal(f.events.includes("factory"), false);
  assert.equal(f.events.includes("descriptor"), false);
  assert.equal(f.events.includes("key"), false);
});
test("R1 resolved v2 cannot smuggle v1 quota or omit policy generation", () => {
  const f = i04Fixture(),
    b = {
      accountId: f.q.account,
      connectedAccountId: "ca_fixture",
      authConfigId: "ac_fixture",
      userId: "owner",
      mailboxEmail: "one@example.test",
      verifiedMailboxEmail: "one@example.test",
      identityVerified: true,
      status: "active",
      revision: 1,
      quotaContractVersion: 2,
      quotaProjectId: null,
      quotaPolicyId: f.q.policy.policy_id,
      quotaPolicyGeneration: 1,
    };
  assert.ok(resolvedBindingSchema.safeParse(b).success);
  assert.equal(
    resolvedBindingSchema.safeParse({ ...b, quotaProjectId: "invented" })
      .success,
    false,
  );
  assert.equal(
    resolvedBindingSchema.safeParse({ ...b, quotaPolicyGeneration: 0 }).success,
    false,
  );
  assert.equal(composioProductOperationEnabled, false);
});
test("R1 runtime v2 uses aggregate lease and preserves IDs without direct token or fallback", async () => {
  const f = i04Fixture(),
    id = randomUUID(),
    events: string[] = [];
  const deps: RuntimeDependencies = {
    composioEnabled: true,
    configuration: () => ({ context: f.context, apiKey: "fake-key" }),
    now: () => f.q.now,
    rpc: async (name, p) => {
      if (name === "mail_transport_snapshot")
        return {
          account_id: f.q.account,
          provider: "composio",
          revision: 1,
          verification_context_hash: existingVerificationHash(f.context),
          config_generation: 1,
          project_id: "pr_fixture",
          auth_config_id: "ac_fixture",
          quota_project_id: null,
          quota_contract_version: 2,
          quota_policy_id: f.q.policy.policy_id,
          quota_policy_generation: 1,
        };
      if (name === "mail_transport_acquire")
        return {
          id,
          account_id: f.q.account,
          provider: "composio",
          revision: 1,
          operation: p.operation,
          resource: p.resource,
          deadline: new Date(f.q.now + 30000).toISOString(),
          binding: {
            accountId: f.q.account,
            connectedAccountId: "ca_fixture",
            authConfigId: "ac_fixture",
            userId: "owner",
            mailboxEmail: "one@example.test",
            verifiedMailboxEmail: "one@example.test",
            identityVerified: true,
            status: "active",
            revision: 1,
            quotaContractVersion: 2,
            quotaProjectId: null,
            quotaPolicyId: f.q.policy.policy_id,
            quotaPolicyGeneration: 1,
          },
        };
      if (name === "mail_transport_validate_context") return true;
      if (name === "mail_transport_finish") return null;
      throw Error(name);
    },
    fetchImpl: async () => {
      events.push("wire");
      return Response.json({
        status: 200,
        data: { id: "abc123", messages: [] },
      });
    },
  };
  const result = await withMailQuota(f.q.deps, () =>
    withMailRuntime(deps, () =>
      executeRuntimeMail<{ id: string }>(
        { account: f.q.account, path: "threads/abc123", init: {} },
        {
          direct: async () => {
            throw Error("DIRECT_MUST_NOT_RUN");
          },
          quota: async (project) => {
            assert.equal(project, undefined);
            const { reserveGmailQuota } =
              await import("../src/lib/server/mail-quota");
            return reserveGmailQuota({
              account: f.q.account,
              provider: "composio",
              path: "threads/abc123",
              legacy: async () => {
                throw Error("NO_LEGACY");
              },
              authorize: async () => {},
            });
          },
        },
      ),
    ),
  );
  assert.equal(result.id, "abc123");
  assert.deepEqual(events, ["wire"]);
});
