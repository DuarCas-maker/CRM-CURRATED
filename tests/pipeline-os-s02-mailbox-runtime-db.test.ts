import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  mailboxFixture,
  mailboxSqlPath,
} from "./fixtures/pipeline-os-s02-mailbox-runtime";
import { digest } from "./fixtures/pipeline-os-s02-transport-selection";
import {
  executeRuntimeMail,
  withMailRuntime,
  type RuntimeCallbacks,
} from "../src/lib/server/mail-transport/runtime-context";
import { GmailError } from "../src/lib/gmail-errors";
import { syncSelectedMailbox } from "../src/lib/server/mail-transport/mailbox-sync";
const callbacks: RuntimeCallbacks = {
  direct: async () => ({
    quotaProjectId: "fixture-direct",
    transport: {
      provider: "gmail_oauth",
      execute: async () =>
        ({ historyId: "9007199254740993123456789" }) as never,
    },
  }),
  quota: async () => {},
};
test("R06-I03 SQL: marker, exact sources, rollback and least privilege", async (t) => {
  const f = await mailboxFixture(false);
  try {
    await f.owner();
    const sql = await readFile(mailboxSqlPath, "utf8");
    const before = await f.scalar(
      "select pg_get_functiondef('public.brand_oauth_finish(text,uuid,text,text,boolean)'::regprocedure) v",
    );
    await assert.rejects(f.db.exec(sql), /R06_I03_LOCAL_MARKER_REQUIRED/);
    await f.db.exec("set pipeline_os.r06_i03_local='in_memory_test'");
    await f.db.exec("begin");
    await f.db.exec(sql);
    await f.db.exec("rollback");
    assert.equal(
      await f.scalar("select to_regclass('mail_runtime.sync_cycles') v"),
      null,
    );
    assert.equal(
      await f.scalar(
        "select pg_get_functiondef('public.brand_oauth_finish(text,uuid,text,text,boolean)'::regprocedure) v",
      ),
      before,
    );
    await t.test("unknown base cannot be overwritten", async () => {
      await f.db.exec("begin");
      await f.db.exec(
        "create or replace function public.brand_oauth_finish(state_hash text,actor_id uuid,mailbox_email text,encrypted_token text,watch_enabled boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$begin return null;end$$",
      );
      await assert.rejects(f.db.exec(sql), /R06_I03_BASE_MISMATCH/);
      await f.db.exec("rollback");
    });
    await f.db.exec(sql);
    for (const sig of [
      "mail_sync_begin(uuid,bigint,text)",
      "mail_sync_validate(uuid,text)",
      "mail_sync_acquire(uuid,text,text,text,text)",
      "mail_sync_complete(uuid,text,text)",
      "mail_sync_abort(uuid,text)",
      "mail_transport_schedule()",
      "mail_direct_job(uuid)",
    ]) {
      for (const role of ["anon", "authenticated"])
        assert.equal(
          await f.scalar("select has_function_privilege($1,$2,'execute') v", [
            role,
            "public." + sig,
          ]),
          false,
        );
      assert.equal(
        await f.scalar(
          "select has_function_privilege('service_role',$1,'execute') v",
          ["public." + sig],
        ),
        true,
      );
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const table of ["sync_cycles", "sync_requests"])
        assert.equal(
          await f.scalar(
            "select has_table_privilege($1,$2,'select,insert,update,delete') v",
            [role, "mail_runtime." + table],
          ),
          false,
        );
    }
    assert.equal(
      await f.scalar(
        "select has_function_privilege('service_role','public.mail_transport_review(uuid)','execute') v",
      ),
      false,
    );
    await f.human(f.users.admin, "aal1");
    await assert.rejects(
      f.scalar("select mail_transport_review($1) v", [f.accounts[0]]),
      /CONNECT_FORBIDDEN/,
    );
  } finally {
    await f.db.close();
  }
});
test("R06-I03 durable cycle: stale jobs, flags, capability, unresolved and no TTL takeover", async (t) => {
  const f = await mailboxFixture();
  try {
    await f.run("bootstrap_direct");
    const account = f.accounts[0];
    await assert.rejects(
      f.deps.rpc("mail_sync_begin", {
        account,
        expected_revision: 1,
        capability_hash: digest("cycle"),
      }),
      /R06_NOT_READY/,
    );
    await f.receiving();
    await assert.rejects(
      f.deps.rpc("mail_sync_begin", {
        account,
        expected_revision: 0,
        capability_hash: digest("cycle"),
      }),
      /R06_NOT_READY/,
    );
    const c = (await f.deps.rpc("mail_sync_begin", {
      account,
      expected_revision: 1,
      capability_hash: digest("cycle"),
    })) as { id: string };
    const args = { cycle: c.id, capability: "cycle" };
    await assert.rejects(
      f.deps.rpc("mail_sync_validate", { ...args, capability: "other" }),
      /R06_DENIED/,
    );
    await assert.rejects(
      f.deps.rpc("mail_sync_begin", {
        account,
        expected_revision: 1,
        capability_hash: digest("another"),
      }),
      /R06_BUSY/,
    );
    await assert.rejects(
      f.deps.rpc("mail_sync_complete", { ...args, checkpoint: "123" }),
      /R06_UNRESOLVED/,
    );
    await assert.rejects(
      f.deps.rpc("mail_sync_acquire", {
        ...args,
        operation: "send",
        resource: randomUUID(),
        capability_hash: digest("request"),
      }),
      /R06_NOT_READY/,
    );
    const ticket = (await f.deps.rpc("mail_sync_acquire", {
      ...args,
      operation: "profile",
      resource: "profile",
      capability_hash: digest("request"),
    })) as { id: string };
    assert.equal(await f.deps.rpc("mail_sync_abort", args), "uncertain");
    await f.owner();
    await f.db.query(
      "update mail_runtime.sync_cycles set deadline=created_at+interval '1 millisecond' where id=$1",
      [c.id],
    );
    await assert.rejects(
      f.deps.rpc("mail_sync_begin", {
        account,
        expected_revision: 1,
        capability_hash: digest("again"),
      }),
      /R06_BUSY/,
    );
    await f.run("prepare_transition", "gmail_oauth");
    await assert.rejects(
      f.run("commit_transition", "gmail_oauth"),
      /R06_UNRESOLVED/,
    );
    await f.owner();
    assert.equal(
      await f.scalar("select state v from mail_runtime.attempts where id=$1", [
        ticket.id,
      ]),
      "reserved",
    );
    await f.owner();
    assert.equal(
      await f.scalar(
        "select history_id v from mail_runtime.sync_checkpoints where account_id=$1",
        [account],
      ),
      null,
    );
  } finally {
    await f.db.close();
  }
});
test("R06-I03 actual runtime composition: exact large cursor and fresh Composio has no direct credentials", async () => {
  const f = await mailboxFixture();
  try {
    const fresh = await f.composio();
    await f.receiving(fresh.account);
    await f.owner();
    assert.equal(
      await f.scalar(
        "select count(*)::int v from mail_credentials where account_id=$1",
        [fresh.account],
      ),
      0,
    );
    const scheduled = (await f.deps.rpc("mail_transport_schedule", {})) as {
      account_id: string;
      provider: string;
      route_revision: number;
    }[];
    const selected = scheduled.find((a) => a.account_id === fresh.account)!;
    assert.equal(selected.provider, "composio");
    let wire = 0,
      direct = 0,
      ingested = 0;
    f.deps.fetchImpl = async () => {
      wire++;
      return Response.json({
        status: 200,
        data:
          wire === 1
            ? {
                emailAddress: fresh.email,
                historyId: "9007199254740993123456789",
              }
            : wire === 2
              ? { messages: [] }
              : {},
      });
    };
    await syncSelectedMailbox(fresh.account, selected.route_revision, f.deps, {
      request: (path) =>
        executeRuntimeMail(
          { account: fresh.account, path, init: {} },
          {
            ...callbacks,
            direct: async () => {
              direct++;
              throw Error("NO_DIRECT_TOKEN");
            },
          },
        ),
      ingest: async () => {
        ingested++;
      },
    });
    assert.equal(wire, 2);
    assert.equal(direct, 0);
    assert.equal(ingested, 0);
    await f.owner();
    assert.equal(
      await f.scalar(
        "select history_id v from mail_runtime.sync_checkpoints where account_id=$1",
        [fresh.account],
      ),
      "9007199254740993123456789",
    );
    assert.equal(
      await f.scalar(
        "select count(*)::int v from mail_runtime.sync_requests s join mail_runtime.attempts a on a.id=s.attempt_id where a.state='finished'",
      ),
      2,
    );
  } finally {
    await f.db.close();
  }
});
test("R06-I03 read failure keeps cursor and admission uncertain; no repeated provider request", async () => {
  const f = await mailboxFixture();
  try {
    await f.run("bootstrap_direct");
    await f.receiving();
    const account = f.accounts[0];
    let wire = 0;
    await assert.rejects(
      syncSelectedMailbox(account, 1, f.deps, {
        request: (path) =>
          executeRuntimeMail(
            { account, path, init: {} },
            {
              ...callbacks,
              direct: async () => ({
                quotaProjectId: "fake",
                transport: {
                  provider: "gmail_oauth",
                  execute: async () => {
                    wire++;
                    throw Error("network dropped");
                  },
                },
              }),
            },
          ),
        ingest: async () => {},
      }),
    );
    assert.equal(wire, 1);
    await f.owner();
    assert.equal(
      await f.scalar("select state v from mail_runtime.sync_cycles"),
      "uncertain",
    );
    assert.equal(
      await f.scalar(
        "select history_id v from mail_runtime.sync_checkpoints where account_id=$1",
        [account],
      ),
      null,
    );
  } finally {
    await f.db.close();
  }
});
test("R06-I03 review contains CAS but no external tuple; late direct OAuth guarded", async () => {
  const f = await mailboxFixture();
  try {
    await f.run("bootstrap_direct");
    await f.human();
    const review = await f.scalar<Record<string, unknown>>(
      "select mail_transport_review($1) v",
      [f.accounts[0]],
    );
    assert.equal(
      (review.expected as { expected_revision: number }).expected_revision,
      1,
    );
    assert.equal("token_hash" in review, false);
    await f.run("prepare_transition", "composio");
    await f.owner();
    await assert.rejects(
      f.scalar("select mail_runtime.assert_direct_oauth($1) v", [
        f.accounts[0],
      ]),
      /R06_NOT_READY/,
    );
    const source = await f.scalar<string>(
      "select prosrc v from pg_proc where oid='public.brand_oauth_finish(text,uuid,text,text,boolean)'::regprocedure",
    );
    assert(
      source.indexOf("assert_direct_oauth") <
        source.indexOf("update public.mail_accounts set status"),
    );
  } finally {
    await f.db.close();
  }
});
test("R06-I03 a claimed direct callback cannot change credentials after a transport transition", async () => {
  const f = await mailboxFixture();
  try {
    await f.run("bootstrap_direct");
    await f.owner();
    const a = await f.scalar<{
      id: string;
      email: string;
      organization: string;
      operating_brand_id: string;
      brand_revision: number;
    }>("select to_jsonb(a) v from mail_accounts a where id=$1", [
      f.accounts[0],
    ]);
    const brandRevision = await f.scalar(
      "select revision v from operating_brands where id=$1",
      [a.operating_brand_id],
    );
    const before = await f.scalar(
      "select to_jsonb(c) v from mail_credentials c where account_id=$1",
      [a.id],
    );
    const state = digest(randomUUID());
    await f.human();
    await f.scalar("select brand_oauth_begin($1,$2,$3) v", [
      state,
      a.organization,
      {
        mode: "reconnect",
        brand_id: a.operating_brand_id,
        expected_brand_revision: brandRevision,
        account_id: a.id,
        expected_account_revision: a.brand_revision,
      },
    ]);
    await f.service();
    await f.scalar("select brand_oauth_claim($1,$2) v", [state, f.users.admin]);
    await f.run("prepare_transition", "composio");
    await f.service();
    await assert.rejects(
      f.scalar("select brand_oauth_finish($1,$2,$3,$4,true) v", [
        state,
        f.users.admin,
        a.email,
        "fictional-new-token",
      ]),
      /R06_NOT_READY/,
    );
    await f.owner();
    assert.deepEqual(
      await f.scalar(
        "select to_jsonb(c) v from mail_credentials c where account_id=$1",
        [a.id],
      ),
      before,
    );
    assert.equal(
      await f.scalar(
        "select count(*)::int v from jobs where dedupe_key like '%:brand-oauth:'||$1",
        [state],
      ),
      0,
    );
    await f.human();
    await assert.rejects(
      f.scalar("select brand_oauth_begin($1,$2,$3) v", [
        digest(randomUUID()),
        a.organization,
        {
          mode: "reconnect",
          brand_id: a.operating_brand_id,
          expected_brand_revision: brandRevision,
          account_id: a.id,
          expected_account_revision: a.brand_revision,
        },
      ]),
      /R06_NOT_READY/,
    );
  } finally {
    await f.db.close();
  }
});
test("R06-I03 contractual quota rejection releases the cycle without advancing or repeating a request", async () => {
  const f = await mailboxFixture();
  try {
    await f.run("bootstrap_direct");
    await f.receiving();
    const account = f.accounts[0];
    let wire = 0;
    await assert.rejects(
      syncSelectedMailbox(account, 1, f.deps, {
        request: (path) =>
          executeRuntimeMail(
            { account, path, init: {} },
            {
              ...callbacks,
              direct: async () => ({
                quotaProjectId: "fixture",
                transport: {
                  provider: "gmail_oauth",
                  execute: async () => {
                    wire++;
                    throw new GmailError(429);
                  },
                },
              }),
            },
          ),
        ingest: async () => {},
      }),
      GmailError,
    );
    assert.equal(wire, 1);
    await f.owner();
    assert.equal(
      await f.scalar("select state v from mail_runtime.sync_cycles"),
      "aborted",
    );
    assert.equal(
      await f.scalar("select state v from mail_runtime.attempts"),
      "known_rejection",
    );
    assert.equal(
      await f.scalar(
        "select history_id v from mail_runtime.sync_checkpoints where account_id=$1",
        [account],
      ),
      null,
    );
    assert(
      await f.deps.rpc("mail_sync_begin", {
        account,
        expected_revision: 1,
        capability_hash: digest("next-cycle"),
      }),
    );
  } finally {
    await f.db.close();
  }
});
test("R06-I03 epoch and cursor CAS are checked again before durable completion", async () => {
  const f = await mailboxFixture();
  try {
    await f.run("bootstrap_direct");
    await f.receiving();
    const account = f.accounts[0];
    const c = (await f.deps.rpc("mail_sync_begin", {
      account,
      expected_revision: 1,
      capability_hash: digest("cycle"),
    })) as { id: string };
    const args = { cycle: c.id, capability: "cycle" };
    const requestCapability = digest("fixture-request-capability");
    const ticket = (await f.deps.rpc("mail_sync_acquire", {
      ...args,
      operation: "profile",
      resource: "profile",
      capability_hash: digest(requestCapability),
    })) as { id: string };
    await f.deps.rpc("mail_transport_validate_context", {
      attempt: ticket.id,
      capability: requestCapability,
      context_digest: null,
      config_generation: 0,
      admit: true,
    });
    await f.deps.rpc("mail_transport_finish", {
      attempt: ticket.id,
      capability: requestCapability,
      outcome: "finished",
    });
    await f.owner();
    await f.db.query(
      "update mail_runtime.sync_checkpoints set revision=revision+1 where account_id=$1",
      [account],
    );
    await assert.rejects(
      f.deps.rpc("mail_sync_complete", {
        ...args,
        checkpoint: "12345678901234567890",
      }),
      /R06_STALE/,
    );
    await f.owner();
    assert.equal(
      await f.scalar(
        "select history_id v from mail_runtime.sync_checkpoints where account_id=$1",
        [account],
      ),
      null,
    );
    await f.db.query(
      "update mail_runtime.routes set account_epoch=account_epoch+1 where account_id=$1",
      [account],
    );
    assert.equal(await f.deps.rpc("mail_sync_validate", args), false);
  } finally {
    await f.db.close();
  }
});
test("R06-I03 missing session/configuration policy blocks both review and provider admission", async () => {
  const f = await mailboxFixture();
  try {
    const fresh = await f.composio();
    await f.owner();
    await f.db.exec("delete from composio_connect.configuration");
    await f.human();
    await assert.rejects(
      f.scalar("select mail_transport_review($1) v", [fresh.account]),
      /CONNECT_UNAVAILABLE/,
    );
    await assert.rejects(
      f.deps.rpc("mail_transport_snapshot", { account: fresh.account }),
      /R06_NOT_READY/,
    );
    await f.owner();
    assert.equal(
      await f.scalar(
        "select state v from mail_runtime.routes where account_id=$1",
        [fresh.account],
      ),
      "ready",
    );
  } finally {
    await f.db.close();
  }
});
