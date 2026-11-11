import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  reserveGmailQuota,
  withMailQuota,
  assertMailQuotaEmission,
} from "../src/lib/server/mail-quota";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";
import { directGmailTransport } from "../src/lib/server/mail-transport/gmail-direct";
import {
  executeRuntimeMail,
  withMailRuntime,
  composioProductOperationEnabled,
  type RuntimeDependencies,
} from "../src/lib/server/mail-transport/runtime-context";
const req = (f: ReturnType<typeof quotaFixture>) => ({
  account: f.account,
  provider: "gmail_oauth" as const,
  path: "profile",
  project: "fixture-project",
  authorize: f.authorize,
  legacy: f.legacyCall,
});
test("QGR-I03 disabled policy still respects an explicit request deadline", async () => {
  const f = quotaFixture();
  f.policy.state = "disabled";
  await withMailQuota(f.deps, async () => {
    const lease = await reserveGmailQuota({
      ...req(f),
      deadline: new Date(f.now + 50).toISOString(),
    });
    f.advance(60);
    await assert.rejects(lease.emit(f.emit), /QGR_EXPIRED/);
  });
  assert.equal(f.emitted, 0);
});

test("QGR-I03 disabled feature preserves direct path without v2 RPC", async () => {
  const f = quotaFixture();
  f.deps.enabled = false;
  await withMailQuota(f.deps, async () => {
    const lease = await reserveGmailQuota(req(f));
    assert.equal(await lease.emit(f.emit), "fixture");
  });
  assert.equal(f.legacy, 1);
  assert.equal(f.emitted, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(composioProductOperationEnabled, false);
});
test("QGR-I03 disabled policy permits direct legacy; Composio/v2 still closed", async () => {
  const f = quotaFixture();
  f.policy.state = "disabled";
  await withMailQuota(f.deps, async () => {
    const lease = await reserveGmailQuota(req(f));
    await lease.emit(f.emit);
    await assert.rejects(
      reserveGmailQuota({ ...req(f), provider: "composio" }),
      /QGR_DENIED/,
    );
    await assert.rejects(
      reserveGmailQuota({ ...req(f), requiresV2: true }),
      /QGR_DENIED/,
    );
  });
  assert.equal(f.legacy, 1);
  assert.equal(
    f.calls.filter((c) => c.name === "mail_quota_reserve").length,
    0,
  );
});
for (const [path, method, cost] of [
  ["profile", "GET", 1],
  ["history?startHistoryId=1", "GET", 2],
  ["messages", "GET", 5],
  ["messages/a1?format=full", "GET", 60],
  ["threads/b1?format=metadata", "GET", 40],
  ["messages/a1/attachments/part", "GET", 20],
  ["messages/send", "POST", 100],
  ["watch", "POST", 100],
  ["stop", "POST", 100],
] as const)
  test("QGR-I03 cost " + path, async () => {
    const f = quotaFixture();
    await withMailQuota(f.deps, async () => {
      const lease = await reserveGmailQuota({ ...req(f), path, method });
      await lease.emit(f.emit);
    });
    const r = f.calls.find((c) => c.name === "mail_quota_reserve")!;
    assert.equal(r.input.units, cost);
    assert.equal(r.input.direct_project, "fixture-project");
    assert.equal(f.legacy, 0);
    assert.equal(f.emitted, 1);
  });
for (const reason of ["revoked", "policy", "deadline", "abort"])
  test("QGR-I03 cancels after pacing: " + reason, async () => {
    const f = quotaFixture(),
      abort = new AbortController();
    f.wait(100);
    f.afterSleep(async () => {
      if (reason === "revoked") f.revoke();
      if (reason === "policy") f.policy = { ...f.policy, generation: 2 };
      if (reason === "deadline") f.advance(120000);
      if (reason === "abort") abort.abort();
    });
    await withMailQuota(f.deps, async () => {
      await assert.rejects(
        reserveGmailQuota({ ...req(f), signal: abort.signal }),
      );
    });
    assert.equal(f.emitted, 0);
    assert.equal(
      f.calls.filter((c) => c.name === "mail_quota_admit").length,
      0,
    );
  });
test("QGR-I03 lease emits once; rejected durable admission does not emit", async () => {
  const f = quotaFixture();
  await withMailQuota(f.deps, async () => {
    const l = await reserveGmailQuota(req(f));
    await l.emit(f.emit);
    await assert.rejects(l.emit(f.emit), /QGR_REPLAY/);
  });
  assert.equal(f.emitted, 1);
  const b = quotaFixture();
  b.denyAdmit();
  await withMailQuota(b.deps, async () => {
    const l = await reserveGmailQuota(req(b));
    await assert.rejects(l.emit(b.emit), /QGR_REPLAY/);
  });
  assert.equal(b.emitted, 0);
});
test("QGR-I03 malformed/missing policy and receipt never fall back", async () => {
  for (const raw of [
    {},
    null,
    { closed: true, policy: null },
    { closed: false, policy: {} },
  ]) {
    const f = quotaFixture();
    f.snapshot(raw === null ? {} : raw);
    await withMailQuota(f.deps, () =>
      assert.rejects(reserveGmailQuota(req(f))),
    );
    assert.equal(f.legacy, 0);
    assert.equal(f.emitted, 0);
  }
  for (const raw of [
    { reserved: true },
    -1,
    { reserved: true, wait_ms: -1 },
    {
      reserved: false,
      reason: "window_exhausted",
      group_scope: "gmail:crm:shared",
    },
  ]) {
    const f = quotaFixture();
    f.receipt(raw);
    await withMailQuota(f.deps, () =>
      assert.rejects(reserveGmailQuota(req(f))),
    );
    assert.equal(f.legacy, 0);
  }
});
test("QGR-I03 low-level transport rejects bypass, path substitution and second wire", async () => {
  const f = quotaFixture();
  let wires = 0;
  const transport = directGmailTransport("fixture-only-token", async () => {
    wires++;
    return Response.json({ historyId: "1" });
  });
  await withMailQuota(f.deps, async () => {
    await assert.rejects(transport.execute({ path: "profile" }), /QGR_DENIED/);
    const l = await reserveGmailQuota(req(f));
    await l.emit(async () => {
      await transport.execute({ path: "profile" });
      await assert.rejects(
        transport.execute({ path: "profile" }),
        /QGR_DENIED/,
      );
    });
    const next = await reserveGmailQuota(req(f));
    await assert.rejects(
      next.emit(() => transport.execute({ path: "messages" })),
      /QGR_DENIED/,
    );
  });
  assert.equal(wires, 1);
});
test("QGR-I03 provider failure is not retried or switched", async () => {
  const f = quotaFixture();
  let calls = 0;
  await withMailQuota(f.deps, async () => {
    const l = await reserveGmailQuota(req(f));
    await assert.rejects(
      l.emit(async () => {
        calls++;
        throw Error("fixture timeout");
      }),
    );
    await assert.rejects(l.emit(f.emit), /QGR_REPLAY/);
  });
  assert.equal(calls, 1);
  assert.equal(f.emitted, 0);
});
test("QGR-I03 request snapshot cannot be widened after reservation; deadline checked at transport", async () => {
  const f = quotaFixture();
  await withMailQuota(f.deps, async () => {
    const input = req(f),
      lease = await reserveGmailQuota(input);
    input.path = "messages";
    await assert.rejects(
      lease.emit(async () =>
        assertMailQuotaEmission("gmail_oauth", "messages"),
      ),
      /QGR_DENIED/,
    );
    const late = await reserveGmailQuota(req(f));
    await assert.rejects(
      late.emit(async () => {
        f.advance(120001);
        assertMailQuotaEmission("gmail_oauth", "profile");
      }),
      /QGR_EXPIRED/,
    );
  });
});
test("QGR-I03 runtime passes its actual attempt/deadline/provider and admits once", async () => {
  const f = quotaFixture(),
    id = randomUUID(),
    outcomes: string[] = [];
  const deps: RuntimeDependencies = {
    composioEnabled: false,
    configuration: () => {
      throw Error("no Composio config expected");
    },
    fetchImpl: async () => {
      throw Error("no implicit fetch");
    },
    now: () => f.now,
    rpc: async (name, p) => {
      if (name === "mail_transport_snapshot")
        return {
          account_id: f.account,
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
          id,
          account_id: f.account,
          provider: "gmail_oauth",
          revision: 1,
          operation: p.operation,
          resource: p.resource,
          deadline: new Date(f.now + 30000).toISOString(),
          binding: null,
        };
      if (name === "mail_transport_validate_context") return true;
      if (name === "mail_transport_finish") {
        outcomes.push(String(p.outcome));
        return null;
      }
      throw Error("unexpected");
    },
  };
  await withMailQuota(f.deps, () =>
    withMailRuntime(deps, () =>
      executeRuntimeMail(
        { account: f.account, path: "profile", init: {} },
        {
          direct: async () => ({
            quotaProjectId: "fixture-project",
            transport: {
              provider: "gmail_oauth",
              execute: async <T>() => {
                assertMailQuotaEmission("gmail_oauth", "profile");
                return (await f.emit()) as T;
              },
            },
          }),
          quota: (project, ticket) => {
            assert.equal(ticket!.id, id);
            return reserveGmailQuota({
              ...req(f),
              project,
              key: ticket!.id,
              deadline: ticket!.deadline,
            });
          },
        },
      ),
    ),
  );
  assert.equal(
    f.calls.find((c) => c.name === "mail_quota_reserve")!.input.request_key,
    id,
  );
  assert.deepEqual(outcomes, ["finished"]);
  assert.equal(f.emitted, 1);
});
