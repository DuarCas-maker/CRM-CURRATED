import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  executeRuntimeMail,
  withMailRuntime,
  withMailDispatch,
  composioProductOperationEnabled,
  productRoutingEnabled,
  type RuntimeDependencies,
  type RuntimeCallbacks,
} from "../src/lib/server/mail-transport/runtime-context";
import { verificationContextHash } from "../src/lib/server/mail-accounts/composio-verifier";
import {
  runtimeConfiguration,
  runtimeFixture,
} from "./fixtures/pipeline-os-s02-transport-runtime";
import { withWorkerPilot } from "../src/lib/server/worker-request-control";
import { MailTransportError } from "../src/lib/server/mail-transport/errors";
import { GmailError } from "../src/lib/gmail-errors";

function fake(provider: "gmail_oauth" | "composio" = "gmail_oauth") {
  const account = randomUUID(),
    outbox = randomUUID(),
    id = randomUUID(),
    events: string[] = [],
    b = {
      accountId: account,
      connectedAccountId: "ca_fixture",
      authConfigId: "ac_fixture",
      userId: "fixture-owner",
      mailboxEmail: "one@example.test",
      verifiedMailboxEmail: "one@example.test",
      identityVerified: true,
      status: "active",
      revision: 1,
      quotaProjectId: "fixture-quota",
    };
  let currentOutcome = "finished";
  const config = runtimeConfiguration();
  const context = {
    ...config.context,
    google_quota_project_id: "fixture-quota",
  };
  const deps: RuntimeDependencies = {
    composioEnabled: true,
    configuration: () => ({ context, apiKey: config.apiKey }),
    now: () => Date.now(),
    rpc: async (name, p) => {
      events.push(name);
      if (name === "mail_transport_snapshot")
        return {
          account_id: account,
          provider,
          revision: 1,
          verification_context_hash:
            provider === "composio" ? verificationContextHash(context) : null,
          config_generation: provider === "composio" ? 1 : 0,
          project_id:
            provider === "composio" ? context.composio_project_id : null,
          auth_config_id: provider === "composio" ? "ac_fixture" : null,
          quota_project_id: provider === "composio" ? "fixture-quota" : null,
        };
      if (name === "mail_transport_acquire")
        return {
          id,
          account_id: account,
          provider,
          revision: 1,
          operation: p.operation,
          resource: p.resource,
          deadline: new Date(Date.now() + 30000).toISOString(),
          binding: provider === "composio" ? b : null,
        };
      if (name === "mail_transport_validate_context") return true;
      if (name === "mail_transport_finish") {
        events.push("finish:" + p.outcome);
        return null;
      }
      if (name === "mail_transport_settle_dispatch") {
        events.push("settle:" + currentOutcome);
        return currentOutcome;
      }
      throw Error("unexpected RPC");
    },
    fetchImpl: async () => {
      events.push("proxy-wire");
      return Response.json({
        status: 200,
        data: { id: "def456", messages: [] },
      });
    },
  };
  const callbacks: RuntimeCallbacks = {
    direct: async () => {
      events.push("direct-token");
      return {
        quotaProjectId: "direct-quota",
        transport: {
          provider: "gmail_oauth",
          execute: async <T>() => {
            events.push("direct-wire");
            return { id: "abc123", threadId: "def456" } as T;
          },
        },
      };
    },
    quota: async (project) => {
      events.push("quota:" + project);
    },
  };
  const read = () =>
    executeRuntimeMail(
      { account, path: "threads/def456?format=full", init: {} },
      callbacks,
    );
  return {
    account,
    outbox,
    id,
    deps,
    callbacks,
    events,
    read,
    setOutcome: (s: string) => {
      currentOutcome = s;
    },
  };
}
test("R06-I02 runtime: routing, scopes, quota and no fallback", async (t) => {
  await t.test("product Composio remains code-disabled", () => {
    assert.equal(composioProductOperationEnabled, false);
  });
  await t.test(
    "invalid compatibility flag cannot silently select legacy direct",
    () => {
      const before = process.env.MAIL_TRANSPORT_ROUTING_ENABLED;
      try {
        process.env.MAIL_TRANSPORT_ROUTING_ENABLED = "invalid";
        assert.throws(productRoutingEnabled, /R06_UNAVAILABLE/);
      } finally {
        if (before === undefined)
          delete process.env.MAIL_TRANSPORT_ROUTING_ENABLED;
        else process.env.MAIL_TRANSPORT_ROUTING_ENABLED = before;
      }
    },
  );
  for (const provider of ["gmail_oauth", "composio"] as const)
    await t.test(
      provider + " resolves before token, uses one quota and finishes read",
      async () => {
        const f = fake(provider);
        await withMailRuntime(f.deps, f.read);
        assert.equal(f.events[0], "mail_transport_snapshot");
        assert(
          f.events.indexOf("mail_transport_acquire") <
            f.events.findIndex((v) => v.endsWith("wire")),
        );
        assert.equal(f.events.filter((x) => x.startsWith("quota:")).length, 1);
        assert(f.events.includes("finish:finished"));
        assert.equal(
          f.events.includes("direct-token"),
          provider === "gmail_oauth",
        );
        assert.equal(f.events.includes("proxy-wire"), provider === "composio");
      },
    );
  await t.test(
    "missing/error snapshot fails before any token and does not expose DB text",
    async () => {
      const f = fake();
      f.deps.rpc = async () => {
        throw Error("fictional-sensitive-db");
      };
      await assert.rejects(withMailRuntime(f.deps, f.read), /R06_UNAVAILABLE/);
      assert(!f.events.includes("direct-token"));
    },
  );
  await t.test(
    "disabled Composio and missing/unproven configuration fail closed",
    async () => {
      const a = fake("composio");
      a.deps.composioEnabled = false;
      await assert.rejects(withMailRuntime(a.deps, a.read), /R06_DENIED/);
      assert(!a.events.includes("direct-token"));
      assert(!a.events.includes("proxy-wire"));
      const b = fake("composio");
      b.deps.configuration = () => ({ context: {}, apiKey: "fictional" });
      await assert.rejects(withMailRuntime(b.deps, b.read), /R06_DENIED/);
      assert(!b.events.includes("proxy-wire"));
    },
  );
  await t.test(
    "configuration rotation during hook prevents proxy dispatch",
    async () => {
      const f = fake("composio");
      let changed = false;
      const old = f.deps.configuration;
      f.deps.configuration = () =>
        changed ? { ...(old() as object), apiKey: "rotated-fictional" } : old();
      await assert.rejects(
        withMailRuntime(f.deps, () =>
          executeRuntimeMail(
            {
              account: f.account,
              path: "threads/def456?format=full",
              init: {},
              beforeRequest: async () => {
                changed = true;
              },
            },
            f.callbacks,
          ),
        ),
        /R06_DENIED/,
      );
      assert(!f.events.includes("proxy-wire"));
    },
  );
  await t.test(
    "a send outside its account/outbox scope is denied before snapshot or token",
    async () => {
      const f = fake();
      await assert.rejects(
        withMailRuntime(f.deps, () =>
          executeRuntimeMail(
            {
              account: f.account,
              path: "messages/send",
              init: { method: "POST", body: "{}" },
            },
            f.callbacks,
          ),
        ),
        /R06_DENIED/,
      );
      assert.deepEqual(f.events, []);
      await assert.rejects(
        withMailRuntime(f.deps, () =>
          withMailDispatch(randomUUID(), f.outbox, () =>
            executeRuntimeMail(
              {
                account: f.account,
                path: "messages/send",
                init: { method: "POST", body: "{}" },
              },
              f.callbacks,
            ),
          ),
        ),
        /R06_DENIED/,
      );
    },
  );
  await t.test(
    "send remains open until persistence then settles once; second send is denied",
    async () => {
      const f = fake();
      await withMailRuntime(f.deps, () =>
        withMailDispatch(f.account, f.outbox, async () => {
          await executeRuntimeMail(
            {
              account: f.account,
              path: "messages/send",
              init: { method: "POST", body: "{}" },
            },
            f.callbacks,
          );
          assert(!f.events.includes("finish:finished"));
          assert(!f.events.some((x) => x.startsWith("settle:")));
          f.events.push("mark_sent");
          await assert.rejects(
            executeRuntimeMail(
              {
                account: f.account,
                path: "messages/send",
                init: { method: "POST", body: "{}" },
              },
              f.callbacks,
            ),
            /R06_DENIED/,
          );
        }),
      );
      assert(
        f.events.indexOf("mark_sent") < f.events.indexOf("settle:finished"),
      );
      assert.equal(f.events.filter((x) => x === "direct-wire").length, 1);
    },
  );
  await t.test(
    "accepted HTTP plus failed persistence remains uncertain and does not report completion",
    async () => {
      const f = fake();
      f.setOutcome("uncertain");
      await assert.rejects(
        withMailRuntime(f.deps, () =>
          withMailDispatch(f.account, f.outbox, async () => {
            await executeRuntimeMail(
              {
                account: f.account,
                path: "messages/send",
                init: { method: "POST", body: "{}" },
              },
              f.callbacks,
            );
            throw Error("persist-failed");
          }),
        ),
        /R06_UNCERTAIN/,
      );
      assert.equal(f.events.filter((x) => x === "direct-wire").length, 1);
      assert(!f.events.includes("finish:finished"));
    },
  );
  await t.test(
    "known Google quota survives error mapping; outer Composio failures never become Google failures",
    async () => {
      const f = fake();
      f.callbacks.direct = async () => ({
        quotaProjectId: "direct-quota",
        transport: {
          provider: "gmail_oauth",
          execute: async () => {
            throw new GmailError(429, "rateLimitExceeded", 10);
          },
        },
      });
      f.setOutcome("known_rejection");
      await withMailRuntime(f.deps, () =>
        withMailDispatch(f.account, f.outbox, async () => {
          await assert.rejects(
            executeRuntimeMail(
              {
                account: f.account,
                path: "messages/send",
                init: { method: "POST", body: "{}" },
              },
              f.callbacks,
            ),
            (e: unknown) => e instanceof GmailError && e.status === 429,
          );
          f.events.push("defer_gmail_send");
        }),
      );
      assert(f.events.includes("finish:uncertain"));
      assert(
        f.events.indexOf("defer_gmail_send") <
          f.events.indexOf("settle:known_rejection"),
      );
      const g = fake("composio");
      g.deps.fetchImpl = async () => new Response("", { status: 401 });
      await assert.rejects(
        withMailRuntime(g.deps, g.read),
        (e: unknown) =>
          e instanceof MailTransportError &&
          e.code === "COMPOSIO_AUTH_REJECTED",
      );
      assert(!g.events.includes("direct-token"));
      assert(g.events.includes("finish:known_rejection"));
    },
  );
  await t.test(
    "pilot validates selected provider and counts HTTP only at the transport boundary",
    async () => {
      const f = fake("composio"),
        reserves: boolean[] = [];
      await withWorkerPilot(
        {
          accountId: f.account,
          outboxId: f.outbox,
          provider: "composio",
          action: "thread",
          threadId: "def456",
          authorize: async (_, reserve) => {
            reserves.push(reserve);
            return true;
          },
        },
        () => withMailRuntime(f.deps, f.read),
      );
      assert.deepEqual(reserves, [false, true]);
      assert.equal(f.events.filter((x) => x === "proxy-wire").length, 1);
    },
  );
  await t.test(
    "parallel dispatch scopes retain their own account and settle capability",
    async () => {
      const a = fake(),
        b = fake();
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      await Promise.all([
        withMailRuntime(a.deps, () =>
          withMailDispatch(a.account, a.outbox, async () => {
            await gate;
            await executeRuntimeMail(
              {
                account: a.account,
                path: "messages/send",
                init: { method: "POST", body: "{}" },
              },
              a.callbacks,
            );
          }),
        ),
        withMailRuntime(b.deps, () =>
          withMailDispatch(b.account, b.outbox, async () => {
            release();
            await executeRuntimeMail(
              {
                account: b.account,
                path: "messages/send",
                init: { method: "POST", body: "{}" },
              },
              b.callbacks,
            );
          }),
        ),
      ]);
      assert.equal(a.events.filter((x) => x === "settle:finished").length, 1);
      assert.equal(b.events.filter((x) => x === "settle:finished").length, 1);
    },
  );
});
test("R06-I02 runtime composed with real isolated SQL and fake provider", async (t) => {
  const f = await runtimeFixture();
  try {
    await f.run("bootstrap_direct");
    await t.test(
      "service ticket accepted by runtime; direct token prepared after acquire only",
      async () => {
        const events: string[] = [];
        await withMailRuntime(f.deps, () =>
          executeRuntimeMail(
            { account: f.accounts[0], path: "profile", init: {} },
            {
              direct: async () => {
                events.push("token");
                return {
                  quotaProjectId: "fictional-quota",
                  transport: {
                    provider: "gmail_oauth",
                    execute: async <T>() => ({ historyId: "123" }) as T,
                  },
                };
              },
              quota: async () => {
                events.push("quota");
              },
            },
          ),
        );
        assert.deepEqual(events, ["token", "quota"]);
        await f.owner();
        assert.equal(
          await f.scalar(
            "select state v from mail_runtime.attempts order by created_at desc limit 1",
          ),
          "finished",
        );
      },
    );
    const fresh = await f.composio();
    await t.test(
      "Composio facade uses persisted tuple/context and no direct credential",
      async () => {
        let proxy = 0;
        f.deps.fetchImpl = async () => {
          proxy++;
          return Response.json({
            status: 200,
            data: {
              historyId: "123",
              emailAddress: fresh.email,
              messagesTotal: 0,
              threadsTotal: 0,
            },
          });
        };
        await withMailRuntime(f.deps, () =>
          executeRuntimeMail(
            { account: fresh.account, path: "profile", init: {} },
            {
              direct: async () => {
                throw Error("DIRECT_MUST_NOT_RUN");
              },
              quota: async (project) => {
                assert.equal(
                  project,
                  runtimeConfiguration().context.google_quota_project_id,
                );
              },
            },
          ),
        );
        assert.equal(proxy, 1);
        await f.owner();
        assert.equal(
          await f.scalar(
            "select count(*)::int v from mail_credentials where account_id=$1",
            [fresh.account],
          ),
          0,
        );
      },
    );
  } finally {
    await f.db.close();
  }
});
