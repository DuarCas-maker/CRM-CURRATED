import test from "node:test";
import assert from "node:assert/strict";
import { connectStoreCompositionFixture } from "./fixtures/pipeline-os-s02-connect-store-composition";
import { composioProductOperationEnabled } from "../src/lib/server/mail-transport/runtime-context";
test("CW3 local SQL composes with R06; rollback restores ACL and existing function bodies", async () => {
  const f = await connectStoreCompositionFixture(false);
  try {
    await f.owner();
    const before = await f.scalar(
      "select md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' order by oid::regprocedure::text)) v from pg_proc where pronamespace='public'::regnamespace and prokind='f'",
    );
    await assert.rejects(f.db.exec(f.sourceSql), /CONNECT_T009_LOCAL_ONLY/);
    await f.db.exec("rollback");
    await f.db.exec("begin");
    await f.installMemory();
    await f.db.exec("rollback");
    assert.equal(
      await f.scalar("select to_regnamespace('composio_connect_runtime') v"),
      null,
    );
    await f.installMemory();
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        await f.scalar(
          "select has_table_privilege($1,'composio_connect_runtime.runtime','select,insert,update,delete') v",
          [role],
        ),
        false,
      );
    assert.equal(
      await f.scalar(
        "select has_function_privilege('authenticated','public.composio_connect_command(uuid,text,bigint,text,uuid,uuid)','execute') v",
      ),
      false,
    );
    await f.rollbackMemory();
    assert.equal(
      await f.scalar(
        "select md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' order by oid::regprocedure::text)) v from pg_proc where pronamespace='public'::regnamespace and prokind='f'",
      ),
      before,
    );
  } finally {
    await f.db.close();
  }
});
test("CW3 durable candidate remains inactive; C2 and R06 are explicit independent steps", async () => {
  const f = await connectStoreCompositionFixture();
  try {
    const a = await f.begin();
    const e = await f.connect(a);
    assert.equal(a.snapshot.attempt.state, "awaiting_brand");
    await f.adopt(a);
    const completed = await e.register(f.request(a));
    await f.load(a);
    assert.equal(completed.composio_enabled, false);
    assert.equal(a.snapshot.attempt.state, "completed");
    const account = a.snapshot.attempt
      .account_id as (typeof f.accounts)[number];
    await f.owner();
    const row = await f.scalar<{
      status: string;
      live_enabled: boolean;
      sync_enabled: boolean;
    }>("select to_jsonb(a) v from mail_accounts a where id=$1", [account]);
    assert.equal(row.status, "disconnected");
    assert.equal(row.live_enabled, false);
    assert.equal(row.sync_enabled, false);
    for (const table of ["mail_credentials", "mail_permissions"])
      assert.equal(
        await f.scalar(
          `select count(*)::int v from ${table} where account_id=$1`,
          [account],
        ),
        0,
      );
    assert.equal(
      await f.scalar(
        "select count(*)::int v from mail_runtime.routes where account_id=$1",
        [account],
      ),
      0,
    );
    await assert.rejects(
      f
        .run("prepare_transition", "composio", account)
        .then(() => f.run("commit_transition", "composio", account)),
      /R06_EVIDENCE_REQUIRED/,
    );
    await f.run("cancel_transition", "composio", account);
    await f.verifyAndConfirm(account);
    await f.run("prepare_transition", "composio", account);
    await f.run("commit_transition", "composio", account);
    await f.owner();
    assert.equal(
      await f.scalar(
        "select provider v from mail_runtime.routes where account_id=$1",
        [account],
      ),
      "composio",
    );
    assert.equal(
      await f.scalar(
        "select live_enabled or sync_enabled v from mail_accounts where id=$1",
        [account],
      ),
      false,
    );
    assert.equal(composioProductOperationEnabled, false);
    assert.equal(f.counters.links, 1);
    assert.equal(f.counters.reads, 3);
  } finally {
    await f.db.close();
  }
});
test("CW3 private state is encrypted and uncertain link never reopens or permits rollback", async () => {
  const f = await connectStoreCompositionFixture();
  try {
    const a = await f.begin();
    await f.owner();
    const text = await f.scalar<string>(
      "select to_jsonb(r)::text v from composio_connect_runtime.runtime r where attempt_id=$1",
      [a.snapshot.attempt.id],
    );
    assert(!text.includes(a.state));
    assert(!text.includes(a.proof));
    const e = await f.engine(a, undefined, true);
    await assert.rejects(e.start(f.request(a)));
    await assert.rejects(e.start(f.request(a)));
    assert.equal(f.counters.links, 1);
    await f.owner();
    assert.equal(
      await f.scalar(
        "select state v from composio_connect_runtime.runtime where attempt_id=$1",
        [a.snapshot.attempt.id],
      ),
      "uncertain",
    );
    await assert.rejects(f.rollbackMemory(), /CONNECT_T009_OPEN_ATTEMPTS/);
  } finally {
    await f.db.close();
  }
});
test("CW3 foreign mailbox is rejected without account materialization or candidate", async () => {
  const f = await connectStoreCompositionFixture();
  try {
    const a = await f.begin();
    await assert.rejects(f.connect(a, "other@cw3.test"));
    await f.owner();
    assert.equal(
      await f.scalar(
        "select state v from composio_connect_runtime.runtime where attempt_id=$1",
        [a.snapshot.attempt.id],
      ),
      "rejected",
    );
    assert.equal(
      await f.scalar("select count(*)::int v from mail_accounts where id=$1", [
        a.snapshot.attempt.account_id,
      ]),
      0,
    );
  } finally {
    await f.db.close();
  }
});
