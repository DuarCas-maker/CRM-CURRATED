import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectV2Fixture } from "./fixtures/pipeline-os-s02-connect-v2";
import { connectProviderConfigSchema } from "../src/lib/server/mail-accounts/composio-connect/config";
import { reserveConnectProfileQuota } from "../src/lib/server/mail-accounts/composio-connect/profile-quota";
import { connectAuthority } from "../src/lib/server/mail-accounts/composio-connect/session";
import {
  connectViewHttp,
  connectBeginHttp,
} from "../src/lib/composio-connect-http";

async function begin(
  f: Awaited<ReturnType<typeof connectV2Fixture>>,
  value?: unknown,
) {
  const body = connectBeginHttp.parse(value ?? (await f.newIntent())),
    res = await f.begin(body);
  assert.equal(res.status, 200, await res.clone().text());
  const a = connectViewHttp.parse(await res.json()).status!;
  const started = await f.action(a.id, "start", {
    expected_revision: a.revision,
    idempotency_key: randomUUID(),
  });
  assert.equal(
    started.status,
    200,
    (await started.clone().text()) + " " + JSON.stringify(f.rpcErrors),
  );
  const material = f.config.material(f.session, body.idempotency_key);
  const url =
    f.origin +
    "/api/mail/composio/connect/callback?" +
    new URLSearchParams({
      state: material.state,
      status: "success",
      connected_account_id: "ca_" + a.id.replaceAll("-", ""),
    });
  return { id: a.id, url, body };
}

test("Connect v2: new mailbox reserves profile before materialization and registers only a candidate", async () => {
  const f = await connectV2Fixture();
  try {
    const { id, url } = await begin(f);
    await f.owner();
    assert.equal(
      await f.scalar(
        "select count(*)::int v from composio_connect.subjects where account_id is not null and id=(select subject_id from composio_connect.attempts where id=$1)",
        [id],
      ),
      0,
    );
    assert.equal((await f.callback(url)).status, 303);
    assert.equal(f.calls.length, 4);
    assert.equal((await f.callback(url)).status, 303);
    assert.equal(f.calls.length, 4);
    await f.owner();
    const ledger = await f.scalar<{ admitted: boolean; count: number }>(
      "select jsonb_build_object('admitted',bool_and(admitted_at is not null),'count',count(*)) v from composio_connect.profile_reservations",
    );
    assert.deepEqual(ledger, { admitted: true, count: 1 });
    const review = connectViewHttp.parse(await (await f.status(id)).json());
    assert.equal(review.status?.state, "awaiting_brand");
    assert(review.pending);
    const row = await f.scalar<{
      revision: number;
      expected_account_revision: number;
    }>("select to_jsonb(r) v from mail_account_brand_reviews r where id=$1", [
      review.pending.review_id,
    ]);
    await f.human();
    await f.brandCommand("brand_mapping_confirm", {
      review_id: review.pending.review_id,
      expected_review_revision: row.revision,
      expected_account_revision: row.expected_account_revision,
      acknowledge_conflict: false,
    });
    const adopted = await f.action(id, "adopt", {
      idempotency_key: randomUUID(),
    });
    assert.equal(adopted.status, 200, await adopted.clone().text());
    const ready = connectViewHttp.parse(await adopted.json()).status!;
    const done = await f.action(id, "register", {
      expected_revision: ready.revision,
      idempotency_key: randomUUID(),
    });
    assert.equal(done.status, 200, await done.clone().text());
    const status = connectViewHttp.parse(await done.json()).status!;
    assert.equal(status.state, "completed");
    assert.equal(status.composio_enabled, false);
    await f.owner();
    const binding = await f.scalar<{
      version: number;
      google: string | null;
      status: string;
      policy: string;
    }>(
      "select jsonb_build_object('version',quota_contract_version,'google',google_quota_project_id,'status',status,'policy',quota_policy_id) v from mail_provider_bindings where id=$1",
      [status.binding_id],
    );
    assert.deepEqual(binding, {
      version: 2,
      google: null,
      status: "candidate",
      policy: f.policy.policy_id,
    });
    assert.equal(
      await f.scalar(
        "select count(*)::int v from mail_permissions where account_id=$1",
        [status.account_id],
      ),
      0,
    );
    assert.equal(
      await f.scalar(
        "select count(*)::int v from mail_runtime.routes where account_id=$1",
        [status.account_id],
      ),
      0,
    );
  } finally {
    await f.db.close();
  }
});

test("Connect v2: existing mailbox keeps direct credentials and transport while adding a v2 candidate", async () => {
  const f = await connectV2Fixture();
  try {
    await f.owner();
    await f.db.exec(
      "update outbox set status='cancelled' where status='queued'",
    );
    const account = f.accounts[0],
      ctx = await f.scalar<{
        brand_id: string;
        brand_revision: number;
        account_revision: number;
        head: number;
      }>(
        "select jsonb_build_object('brand_id',b.id,'brand_revision',b.revision,'account_revision',a.brand_revision,'head',coalesce(h.revision,0)) v from mail_accounts a join operating_brands b on b.id=a.operating_brand_id left join mail_provider_binding_heads h on h.account_id=a.id where a.id=$1",
        [account],
      );
    const protectedBefore = await f.scalar(
      "select jsonb_build_object('credentials',(select to_jsonb(c) from mail_credentials c where account_id=$1),'permissions',(select jsonb_agg(p) from mail_permissions p where account_id=$1),'route',(select to_jsonb(r) from mail_runtime.routes r where account_id=$1)) v",
      [account],
    );
    const { id, url } = await begin(f, {
      mode: "existing",
      account_id: account,
      brand_id: ctx.brand_id,
      expected_brand_revision: ctx.brand_revision,
      expected_account_revision: ctx.account_revision,
      expected_head_revision: ctx.head,
      expected_config_generation: 3,
      idempotency_key: randomUUID(),
    });
    assert.equal((await f.callback(url)).status, 303);
    let view = connectViewHttp.parse(await (await f.status(id)).json());
    if (view.pending) {
      const row = await f.scalar<{
        revision: number;
        expected_account_revision: number;
      }>("select to_jsonb(r) v from mail_account_brand_reviews r where id=$1", [
        view.pending.review_id,
      ]);
      await f.human();
      await f.brandCommand("brand_mapping_confirm", {
        review_id: view.pending.review_id,
        expected_review_revision: row.revision,
        expected_account_revision: row.expected_account_revision,
        acknowledge_conflict: false,
      });
      const adopted = await f.action(id, "adopt", {
        idempotency_key: randomUUID(),
      });
      assert.equal(adopted.status, 200, await adopted.clone().text());
      view = connectViewHttp.parse(await adopted.json());
    }
    const done = await f.action(id, "register", {
      expected_revision: view.status!.revision,
      idempotency_key: randomUUID(),
    });
    assert.equal(done.status, 200, await done.clone().text());
    assert.equal((await done.json()).status.state, "completed");
    await f.owner();
    assert.deepEqual(
      await f.scalar(
        "select jsonb_build_object('credentials',(select to_jsonb(c) from mail_credentials c where account_id=$1),'permissions',(select jsonb_agg(p) from mail_permissions p where account_id=$1),'route',(select to_jsonb(r) from mail_runtime.routes r where account_id=$1)) v",
        [account],
      ),
      protectedBefore,
    );
  } finally {
    await f.db.close();
  }
});

test("Connect v2: full quota window closes before profile emission or account materialization", async () => {
  const f = await connectV2Fixture();
  try {
    const { id, url } = await begin(f);
    await f.owner();
    await f.db.exec(
      "insert into mail_quota.usage values(date_trunc('minute',clock_timestamp()),75000000) on conflict(minute) do update set units=75000000",
    );
    await f.callback(url);
    assert.equal(
      f.calls.filter((c) => c.path.endsWith("/tools/execute/proxy")).length,
      0,
    );
    await f.owner();
    assert.equal(
      await f.scalar(
        "select count(*)::int v from composio_connect.profile_reservations where attempt_id=$1",
        [id],
      ),
      0,
    );
    assert.equal(
      await f.scalar(
        "select count(*)::int v from composio_connect.subjects where account_id is not null and id=(select subject_id from composio_connect.attempts where id=$1)",
        [id],
      ),
      0,
    );
  } finally {
    await f.db.close();
  }
});

test("Connect v2: publisher CAS and strict context reject stale/extra settings without changing live generation", async () => {
  const f = await connectV2Fixture();
  try {
    await f.service();
    await assert.rejects(
      f.scalar("select composio_connect_v2_publish($1,0,0,0) v", [
        {
          ...f.config.descriptor,
          config: { ...f.config.descriptor.config, generation: 4 },
        },
      ]),
    );
    await assert.rejects(
      f.scalar("select composio_connect_v2_publish($1,0,0,3) v", [
        {
          ...f.config.descriptor,
          config: { ...f.config.descriptor.config, generation: 4 },
          context: { ...f.config.descriptor.context, unexpected: true },
        },
      ]),
    );
    await f.owner();
    assert.equal(
      await f.scalar(
        "select generation::int v from composio_connect.configuration where id=1",
      ),
      3,
    );
  } finally {
    await f.db.close();
  }
});

test("Connect v2: wrong Gmail consumes only the bounded profile and never materializes a candidate", async () => {
  const f = await connectV2Fixture();
  try {
    const { id, url } = await begin(f);
    f.wrongMailbox();
    assert.equal((await f.callback(url)).status, 303);
    const state = connectViewHttp.parse(
      await (await f.status(id)).json(),
    ).status!;
    assert.equal(state.state, "rejected");
    await f.owner();
    assert.equal(
      await f.scalar(
        "select count(*)::int v from composio_connect.subjects where account_id is not null and id=(select subject_id from composio_connect.attempts where id=$1)",
        [id],
      ),
      0,
    );
  } finally {
    await f.db.close();
  }
});

test("Connect v2: policy closure before link denies all provider calls", async () => {
  const f = await connectV2Fixture();
  try {
    const body = await f.newIntent(),
      a = connectViewHttp.parse(await (await f.begin(body)).json()).status!;
    await f.owner();
    await f.db.exec("update mail_quota.head set closed=true where id=1");
    await f.action(a.id, "start", {
      expected_revision: a.revision,
      idempotency_key: randomUUID(),
    });
    assert.equal(f.calls.length, 0);
  } finally {
    await f.db.close();
  }
});

test("Connect v2: policy closure on return prevents profile emission", async () => {
  const f = await connectV2Fixture();
  try {
    const { url } = await begin(f);
    await f.owner();
    await f.db.exec("update mail_quota.head set closed=true where id=1");
    await f.callback(url);
    assert.equal(f.calls.length, 1);
  } finally {
    await f.db.close();
  }
});

test("Connect v2: private ledger and RPCs deny anon/authenticated; foreign authority and replay deny service", async () => {
  const f = await connectV2Fixture();
  try {
    const { id, url } = await begin(f);
    assert.equal((await f.callback(url)).status, 303);
    await f.owner();
    const phase = await f.scalar<string>(
      "select phase_id v from composio_connect.profile_reservations where attempt_id=$1",
      [id],
    );
    const authority = connectAuthority(f.session, f.cookie(id).proof);
    for (const role of ["anon", "authenticated"]) {
      await f.owner();
      await f.db.exec("set role " + role);
      await assert.rejects(
        f.db.exec("select * from composio_connect.profile_reservations"),
      );
      await assert.rejects(
        f.scalar("select composio_connect_profile_admit($1,$2,$3) v", [
          id,
          phase,
          authority,
        ]),
      );
    }
    await f.service();
    await assert.rejects(
      f.scalar("select composio_connect_profile_reserve($1,$2,$3) v", [
        id,
        phase,
        { ...authority, actor_id: randomUUID() },
      ]),
    );
    // The phase is complete: a stale admission must never emit again.
    assert.equal(
      await f.scalar("select composio_connect_profile_admit($1,$2,$3) v", [
        id,
        phase,
        authority,
      ]),
      false,
    );
  } finally {
    await f.db.close();
  }
});

test("Connect v2: descriptor cannot mix Google project provenance or disabled policy", async () => {
  const f = await connectV2Fixture();
  try {
    assert.equal(
      connectProviderConfigSchema.safeParse({
        ...f.config.descriptor,
        config: { ...f.config.descriptor.config, quota_project_id: "invented" },
      }).success,
      false,
    );
    const context = f.config.descriptor.context;
    if (!("contract_version" in context)) throw Error("Expected v2");
    assert.equal(
      connectProviderConfigSchema.safeParse({
        ...f.config.descriptor,
        context: {
          ...context,
          policy: { ...context.policy, state: "disabled" },
        },
      }).success,
      false,
    );
  } finally {
    await f.db.close();
  }
});

test("Connect v2 profile lease: abort, denial and one-use emit stay closed without network", async () => {
  const policy = {
    contract_version: 2,
    policy_id: randomUUID(),
    generation: 1,
    mode: "crm_shared_conservative",
    state: "enabled",
    limits: {
      group_units_per_minute: 4500,
      account_units_per_minute: 4500,
      group_units_per_window: 75000000,
      window_seconds: 86460,
    },
  };
  const phase = randomUUID(),
    deadline = Date.now() + 10000;
  let actions = 0,
    admissions = 0;
  const options = {
    attempt: randomUUID(),
    phase,
    authority: {
      actor_id: randomUUID(),
      session_hash: "a".repeat(64),
      authorization_revision: 1,
      browser_hash: "b".repeat(64),
    },
    policy,
    deadline,
    now: Date.now,
    authorize: async () => {},
    rpc: async (name: string) => ({
      error: null,
      data: name.endsWith("reserve")
        ? {
            reserved: true,
            phase_id: phase,
            policy_id: policy.policy_id,
            generation: 1,
            wait_ms: 0,
            deadline_ms: deadline,
          }
        : (admissions++, true),
    }),
  };
  const lease = await reserveConnectProfileQuota(options);
  assert.equal(await lease.emit(async () => ++actions), 1);
  await assert.rejects(lease.emit(async () => ++actions));
  assert.equal(actions, 1);
  assert.equal(admissions, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    reserveConnectProfileQuota({ ...options, signal: controller.signal }),
  );
  const denied = await reserveConnectProfileQuota({
    ...options,
    rpc: async (name) => ({
      error: null,
      data: name.endsWith("reserve")
        ? {
            reserved: true,
            phase_id: phase,
            policy_id: policy.policy_id,
            generation: 1,
            wait_ms: 0,
            deadline_ms: deadline,
          }
        : false,
    }),
  });
  await assert.rejects(denied.emit(async () => ++actions));
  assert.equal(actions, 1);
});
