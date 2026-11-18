import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  executeRuntimeMail,
  withMailRuntime,
  withMailDispatch,
  type RuntimeDependencies,
  type RuntimeCallbacks,
} from "../src/lib/server/mail-transport/runtime-context";
import { DirectCredentialUnavailable } from "../src/lib/server/mail-transport/errors";
import { GmailError } from "../src/lib/gmail-errors";
import { reserveGmailQuota, withMailQuota } from "../src/lib/server/mail-quota";
import { verificationContextV2Hash } from "../src/lib/server/mail-transport/verification-context-v2";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";

function fixture() {
  const account = randomUUID(),
    outbox = randomUUID(),
    parent = randomUUID(),
    child = randomUUID(),
    q = quotaFixture(),
    events: string[] = [];
  const context = {
    contract_version: 2 as const,
    composio_project_id: "pr_fixture",
    credential_version: "cred_fixture",
    auth_config_revision: "revision_fixture",
    provenance_reference: "review_fixture",
    project_provenance: "server_reviewed",
    policy: q.policy,
  };
  let directFailure: unknown = new DirectCredentialUnavailable(),
    afterWire = false,
    finishFailure = false,
    free = true,
    validate = true,
    timeout = false,
    stale = false;
  let directPosts = 0,
    proxyPosts = 0;
  const deps: RuntimeDependencies = {
    composioEnabled: true,
    configuration: () => ({
      context: {
        ...context,
        credential_version: stale ? "changed" : context.credential_version,
      },
      apiKey: "fictional-key",
    }),
    now: () => Date.now(),
    rpc: async (name, p) => {
      events.push(name + (p.outcome ? ":" + p.outcome : ""));
      if (name === "mail_transport_snapshot")
        return {
          account_id: account,
          provider: "gmail_oauth",
          revision: 1,
          verification_context_hash: null,
          config_generation: 0,
          project_id: null,
          auth_config_id: null,
          quota_project_id: null,
        };
      if (name === "mail_transport_acquire")
        return {
          id: parent,
          account_id: account,
          provider: "gmail_oauth",
          revision: 1,
          operation: "send",
          resource: outbox,
          deadline: new Date(Date.now() + 60000).toISOString(),
          binding: null,
        };
      if (name === "mail_transport_validate_context") return true;
      if (name === "mail_transport_finish") {
        if (finishFailure)
          throw Error("fixture durable cancellation unavailable");
        return null;
      }
      if (name === "simple_mail_fallback_begin") {
        assert.ok(
          events.includes("mail_transport_finish:cancelled_before_wire"),
        );
        if (!free) throw Error("fixture included budget closed");
        return {
          context_hash: verificationContextV2Hash(context),
          config_generation: 1,
          project_id: "pr_fixture",
          ticket: {
            id: child,
            account_id: account,
            provider: "composio",
            revision: 1,
            operation: "send",
            resource: outbox,
            deadline: new Date(Date.now() + 60000).toISOString(),
            binding: {
              accountId: account,
              connectedAccountId: "ca_fixture",
              authConfigId: "ac_fixture",
              userId: "fixture-owner",
              mailboxEmail: "qa@example.test",
              verifiedMailboxEmail: "qa@example.test",
              identityVerified: true,
              status: "active",
              revision: 1,
              quotaContractVersion: 2,
              quotaProjectId: null,
              quotaPolicyId: q.policy.policy_id,
              quotaPolicyGeneration: 1,
            },
          },
        };
      }
      if (name === "simple_mail_fallback_validate") return validate;
      if (name === "simple_mail_included_reserve") return free;
      if (name === "mail_transport_settle_dispatch")
        return timeout ? "uncertain" : "finished";
      throw Error("UNEXPECTED_RPC:" + name);
    },
    fetchImpl: async (_url, init) => {
      proxyPosts++;
      events.push("proxy-wire");
      assert.equal(
        JSON.parse(String(init?.body)).connected_account_id,
        "ca_fixture",
      );
      if (timeout) throw Error("fixture network timeout after write");
      return Response.json({
        status: 200,
        data: { id: "abc123", threadId: "def456" },
      });
    },
  };
  const callbacks: RuntimeCallbacks = {
    direct: async () => {
      events.push("direct-prepare");
      if (!afterWire) throw directFailure;
      return {
        quotaProjectId: "fixture-project",
        transport: {
          provider: "gmail_oauth",
          execute: async <T>() => {
            directPosts++;
            throw Error("fixture timeout after write");
          },
        },
      };
    },
    quota: (_project, t) =>
      reserveGmailQuota({
        account,
        provider: t?.provider ?? "gmail_oauth",
        path: "messages/send",
        method: "POST",
        project: t?.provider === "composio" ? undefined : "fixture-project",
        key: t?.id,
        authorize: async () => {},
        pace: async () => {},
        legacy: async () => {},
      }),
  };
  const run = () =>
    withMailQuota(q.deps, () =>
      withMailRuntime(deps, () =>
        withMailDispatch(account, outbox, () =>
          executeRuntimeMail(
            {
              account,
              path: "messages/send",
              init: { method: "POST", body: JSON.stringify({ raw: "YWJj" }) },
              beforeRequest: async () => {
                events.push("brand-admission");
              },
            },
            callbacks,
          ),
        ),
      ),
    );
  return {
    run,
    events,
    get directPosts() {
      return directPosts;
    },
    get proxyPosts() {
      return proxyPosts;
    },
    directFailure: (v: unknown) => {
      directFailure = v;
    },
    afterWire: () => {
      afterWire = true;
    },
    finishFailure: () => {
      finishFailure = true;
    },
    noFree: () => {
      free = false;
    },
    revoked: () => {
      validate = false;
    },
    timeout: () => {
      timeout = true;
    },
    stale: () => {
      stale = true;
    },
  };
}
test("Automatic fallback boundaries never duplicate an uncertain send", async (t) => {
  const prior = process.env.SIMPLE_MAIL_ENABLED;
  process.env.SIMPLE_MAIL_ENABLED = "true";
  try {
    await t.test(
      "known OAuth preparation failure uses one Composio POST after durable cancellation",
      async () => {
        const f = fixture();
        assert.deepEqual(await f.run(), { id: "abc123", threadId: "def456" });
        assert.equal(f.directPosts, 0);
        assert.equal(f.proxyPosts, 1);
        assert.equal(f.events.filter((e) => e === "brand-admission").length, 1);
      },
    );
    await t.test(
      "generic, quota and permission failures do not qualify",
      async () => {
        for (const error of [
          Error("fixture error"),
          new GmailError(401),
          new GmailError(403),
          new GmailError(429),
        ]) {
          const f = fixture();
          f.directFailure(error);
          await assert.rejects(f.run());
          assert.equal(f.proxyPosts, 0);
          assert.ok(!f.events.includes("simple_mail_fallback_begin"));
        }
      },
    );
    await t.test("a direct POST timeout never starts fallback", async () => {
      const f = fixture();
      f.afterWire();
      await assert.rejects(f.run());
      assert.equal(f.directPosts, 1);
      assert.equal(f.proxyPosts, 0);
      assert.ok(!f.events.includes("simple_mail_fallback_begin"));
    });
    await t.test(
      "missing durable no-emission acknowledgment blocks fallback",
      async () => {
        const f = fixture();
        f.finishFailure();
        await assert.rejects(f.run());
        assert.equal(f.proxyPosts, 0);
        assert.ok(!f.events.includes("simple_mail_fallback_begin"));
      },
    );
    await t.test(
      "included usage, revocation and changed configuration stop before wire",
      async () => {
        for (const change of ["noFree", "revoked", "stale"] as const) {
          const f = fixture();
          f[change]();
          await assert.rejects(f.run());
          assert.equal(f.proxyPosts, 0);
        }
      },
    );
    await t.test(
      "uncertain fallback has exactly one POST and no recursive retry",
      async () => {
        const f = fixture();
        f.timeout();
        await assert.rejects(f.run());
        assert.equal(f.proxyPosts, 1);
        assert.equal(f.directPosts, 0);
        assert.equal(
          f.events.filter((e) => e === "simple_mail_fallback_begin").length,
          1,
        );
        assert.ok(f.events.includes("mail_transport_finish:uncertain"));
      },
    );
    await t.test("default closed mode preserves old behavior", async () => {
      process.env.SIMPLE_MAIL_ENABLED = "false";
      const f = fixture();
      await assert.rejects(f.run());
      assert.equal(f.proxyPosts, 0);
    });
  } finally {
    if (prior === undefined) delete process.env.SIMPLE_MAIL_ENABLED;
    else process.env.SIMPLE_MAIL_ENABLED = prior;
  }
});
