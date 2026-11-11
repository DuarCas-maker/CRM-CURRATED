import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectHttpFixture } from "./fixtures/pipeline-os-s02-connect-http";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";
import { withMailQuota } from "../src/lib/server/mail-quota";
async function setup(existing = true) {
  const f = await connectHttpFixture(),
    q = quotaFixture();
  try {
    const body: Record<string, unknown> = { ...(await f.intent()) };
    if (existing) {
      await f.owner();
      await f.db.exec(
        "update outbox set status='cancelled' where status='queued';",
      );
      const a = await f.scalar<{
        brand: string;
        account_revision: number;
        brand_revision: number;
        head: number;
      }>(
        `select jsonb_build_object('brand',a.operating_brand_id,'account_revision',a.brand_revision,'brand_revision',b.revision,'head',coalesce(h.revision,0)) v
        from mail_accounts a join operating_brands b on b.id=a.operating_brand_id left join mail_provider_binding_heads h on h.account_id=a.id where a.id=$1`,
        [f.accounts[0]],
      );
      delete body.email;
      delete body.organization;
      Object.assign(body, {
        mode: "existing",
        account_id: f.accounts[0],
        brand_id: a.brand,
        expected_account_revision: a.account_revision,
        expected_brand_revision: a.brand_revision,
        expected_head_revision: a.head,
      });
    }
    const begun = await f.begin(body);
    assert.equal(begun.status, 200, await begun.clone().text());
    const initial = await begun.json();
    const id = initial.status.id;
    const started = await f.action(id, "start", {
      expected_revision: initial.status.revision,
      idempotency_key: randomUUID(),
    });
    assert.equal(started.status, 200, await started.clone().text());
    const material = f.config.material(f.session, String(body.idempotency_key)),
      connection = "ca_" + id.replaceAll("-", "");
    const url =
      f.origin +
      "/api/mail/composio/connect/callback?" +
      new URLSearchParams({
        state: material.state,
        status: "success",
        connected_account_id: connection,
      });
    return {
      f,
      q,
      id,
      url,
      callback: () => withMailQuota(q.deps, () => f.callback(url)),
    };
  } catch (e) {
    await f.db.close();
    throw e;
  }
}
test("QGR-I03 Connect existing profile is quota-reserved and admitted; no legacy double debit", async () => {
  const { f, q, callback } = await setup();
  try {
    const result = await callback();
    assert.equal(result.status, 303, await result.clone().text());
    assert.equal(
      f.calls.filter((c) => c.path.endsWith("/tools/execute/proxy")).length,
      1,
    );
    const r = q.calls.find((c) => c.name === "mail_quota_reserve")!;
    assert.equal(r.input.account, f.accounts[0]);
    assert.equal(r.input.units, 1);
    assert.equal(r.input.provider, "composio");
    assert.equal(
      q.calls.filter((c) => c.name === "mail_quota_admit").length,
      1,
    );
  } finally {
    await f.db.close();
  }
});
test("QGR-I03 Connect policy changes while pacing cancel before profile proxy", async () => {
  const { f, q, callback } = await setup();
  try {
    q.wait(10);
    q.afterSleep(async () => {
      q.policy = { ...q.policy, generation: 2 };
    });
    await callback();
    assert.equal(
      f.calls.filter((c) => c.path.endsWith("/tools/execute/proxy")).length,
      0,
    );
    assert.equal(
      q.calls.filter((c) => c.name === "mail_quota_admit").length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("QGR-I03 Connect new mailbox closes v2 before profile until pre-account quota scope exists", async () => {
  const { f, q, callback } = await setup(false);
  try {
    const rpc = q.deps.rpc;
    q.deps.rpc = async (name, p) => {
      // The projection has a reserved UUID, not a materialized CRM account. Model the I02 FK/account check.
      const value = await rpc(name, p);
      if (
        name === "mail_quota_reserve" &&
        !f.accounts.some((account) => account === p.account)
      )
        throw Error("QGR_ACCOUNT_UNAVAILABLE");
      return value;
    };
    await callback();
    assert.equal(
      f.calls.filter((c) => c.path.endsWith("/tools/execute/proxy")).length,
      0,
    );
    assert.equal(
      q.calls.filter((c) => c.name === "mail_quota_admit").length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
