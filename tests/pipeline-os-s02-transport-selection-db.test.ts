import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  transportFixture,
  r06SqlPath,
  digest,
} from "./fixtures/pipeline-os-s02-transport-selection";
import { bindingExpected } from "../src/lib/composio-bindings";

test("R06 SQL: additive rollback, pinned C2 and least privilege", async (t) => {
  const f = await transportFixture(false),
    { db, scalar, owner } = f;
  try {
    const sql = await readFile(r06SqlPath, "utf8");
    await owner();
    const before = await db.query<{
      oid: number;
      definition: string;
      acl: string | null;
    }>(
      "select p.oid,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','composio_c1','brand_b2') and p.prokind='f' order by p.oid",
    );
    await t.test(
      "marker required; full rehearsal rolls back DDL, trigger and C2 definitions",
      async () => {
        await assert.rejects(db.exec(sql), /R06_LOCAL_MARKER_REQUIRED/);
        await db.exec("set pipeline_os.r06_local='in_memory_test'");
        await db.exec("begin");
        await db.exec(sql);
        await db.exec("rollback");
        assert.equal(
          await scalar("select to_regnamespace('mail_runtime') v"),
          null,
        );
        assert.equal(
          await scalar(
            "select count(*)::int v from pg_trigger where tgname='runtime_account_epoch'",
          ),
          0,
        );
        assert.deepEqual(
          (
            await db.query(
              "select p.oid,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p where p.oid=any($1::oid[]) order by p.oid",
              [before.rows.map((r) => r.oid)],
            )
          ).rows,
          before.rows,
        );
      },
    );
    await t.test(
      "source guard rejects an unexpected C2 definition without leaving partial DDL",
      async () => {
        await db.exec("set pipeline_os.r06_local='in_memory_test'");
        await db.exec("begin");
        await db.exec(
          "create or replace function composio_c1.row_dto(b public.mail_provider_bindings,ctx jsonb) returns jsonb language sql stable set search_path='' as $$select '{}'::jsonb$$",
        );
        await db.exec("savepoint bad");
        await assert.rejects(db.exec(sql), /R06_C2_BASE_MISMATCH/);
        await db.exec("rollback");
        assert.equal(
          await scalar("select to_regnamespace('mail_runtime') v"),
          null,
        );
      },
    );
    await db.exec("set pipeline_os.r06_local='in_memory_test'");
    await db.exec(sql);
    await t.test(
      "only four pinned C2 bodies change; existing ACL and all other bodies preserved",
      async () => {
        const after = await db.query<{
          oid: number;
          definition: string;
          acl: string | null;
        }>(
          "select p.oid,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p where p.oid=any($1::oid[]) order by p.oid",
          [before.rows.map((r) => r.oid)],
        );
        const changed = after.rows.filter(
          (r, i) => r.definition !== before.rows[i].definition,
        );
        assert.equal(changed.length, 4);
        for (let i = 0; i < before.rows.length; i++)
          assert.equal(after.rows[i].acl, before.rows[i].acl);
        for (const table of ["routes", "attempts", "sync_checkpoints"]) {
          assert.equal(
            await scalar(
              "select relrowsecurity v from pg_class where oid=$1::regclass",
              ["mail_runtime." + table],
            ),
            true,
          );
          for (const role of ["anon", "authenticated", "service_role"])
            for (const access of [
              "select",
              "insert",
              "update",
              "delete",
              "truncate",
              "references",
              "trigger",
            ])
              assert.equal(
                await scalar("select has_table_privilege($1,$2,$3) v", [
                  role,
                  "mail_runtime." + table,
                  access,
                ]),
                false,
              );
        }
        assert.equal(
          await scalar(
            "select has_function_privilege('anon','public.mail_transport_command(uuid,text,jsonb,uuid)','execute') v",
          ),
          false,
        );
        assert.equal(
          await scalar(
            "select has_function_privilege('service_role','public.mail_transport_command(uuid,text,jsonb,uuid)','execute') v",
          ),
          false,
        );
        assert.equal(
          await scalar(
            "select has_function_privilege('authenticated','public.mail_transport_acquire(uuid,bigint,text,text,text)','execute') v",
          ),
          false,
        );
        assert.equal(
          await scalar("select status v from outbox where id=$1", [f.queued]),
          "queued",
        );
      },
    );
  } finally {
    await db.close();
  }
});

test("R06 SQL: direct defaults, human commands, drainage and cursor CAS", async (t) => {
  const f = await transportFixture(),
    { db, scalar, owner, service, human, accounts } = f;
  try {
    await t.test(
      "no implicit selection; MFA/session/role required",
      async () => {
        await service();
        await assert.rejects(
          scalar(
            "select mail_transport_acquire($1,0,'profile','profile',$2) v",
            [accounts[0], digest(randomUUID())],
          ),
          /R06_NOT_READY/,
        );
        const p = await f.expected();
        await human(f.users.seller);
        await assert.rejects(
          scalar(
            "select mail_transport_command($1,'bootstrap_direct',$2,$3) v",
            [accounts[0], p, randomUUID()],
          ),
          /CONNECT_FORBIDDEN/,
        );
        await human(f.users.admin, "aal1");
        await assert.rejects(
          scalar(
            "select mail_transport_command($1,'bootstrap_direct',$2,$3) v",
            [accounts[0], p, randomUUID()],
          ),
          /CONNECT_FORBIDDEN/,
        );
        await owner();
        await db.query(
          "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",
          [f.sessions.get(f.users.admin)],
        );
        await human();
        await assert.rejects(
          scalar(
            "select mail_transport_command($1,'bootstrap_direct',$2,$3) v",
            [accounts[0], p, randomUUID()],
          ),
          /CONNECT_FORBIDDEN/,
        );
        await owner();
        await db.query("update auth.sessions set not_after=null where id=$1", [
          f.sessions.get(f.users.admin),
        ]);
      },
    );
    await t.test(
      "bootstrap/idempotency preserve data and expose only sanitized page",
      async () => {
        await owner();
        await db.query(
          "update mail_credentials set history_id='900719925474099312345',last_reconciled_at='2026-01-01Z' where account_id=$1",
          [accounts[0]],
        );
        const p = await f.expected(),
          key = randomUUID();
        const a = await f.run(
            "bootstrap_direct",
            "gmail_oauth",
            accounts[0],
            p,
            key,
          ),
          b = await f.run(
            "bootstrap_direct",
            "gmail_oauth",
            accounts[0],
            p,
            key,
          );
        assert.deepEqual(a, b);
        assert.equal(a.revision, 1);
        await assert.rejects(
          f.run("pause", "gmail_oauth", accounts[0], p, key),
          /R06_IDEMPOTENCY_CONFLICT/,
        );
        assert.deepEqual(Object.keys(a).sort(), [
          "account_id",
          "binding_id",
          "provider",
          "revision",
          "state",
          "target_provider",
        ]);
        await owner();
        assert.equal(
          await scalar(
            "select history_id v from mail_runtime.sync_checkpoints where account_id=$1",
            [accounts[0]],
          ),
          "900719925474099312345",
        );
        assert.equal(
          await scalar(
            "select encrypted_refresh_token v from mail_credentials where account_id=$1",
            [accounts[0]],
          ),
          "fictional-encrypted-token",
        );
      },
    );
    await t.test(
      "cutover cannot resume an old queued message; an explicit pause preserves it",
      async () => {
        await f.run("prepare_transition");
        await assert.rejects(f.run("commit_transition"), /R06_UNRESOLVED/);
        await f.run("cancel_transition");
        await owner();
        await db.query("update outbox set status='paused' where id=$1", [
          f.queued,
        ]);
        await f.run("prepare_transition");
        await f.run("commit_transition");
        await owner();
        assert.equal(
          await scalar("select status v from outbox where id=$1", [f.queued]),
          "paused",
        );
      },
    );
    await t.test(
      "drain denies new/revalidated attempts, but proven pre-wire cancellation can finish",
      async () => {
        const { ticket, cap } = await f.acquire();
        await f.run("prepare_transition");
        await service();
        assert.equal(
          await scalar("select mail_transport_validate($1,$2,true) v", [
            ticket.id,
            cap,
          ]),
          false,
        );
        await assert.rejects(f.acquire(), /R06_NOT_READY/);
        await assert.rejects(f.run("commit_transition"), /R06_UNRESOLVED/);
        await service();
        await db.query(
          "select mail_transport_finish($1,$2,'cancelled_before_wire')",
          [ticket.id, cap],
        );
        assert.equal((await f.run("commit_transition")).state, "ready");
      },
    );
    await t.test(
      "expired reservation and wrong capability cannot silently free a transition",
      async () => {
        const { ticket, cap } = await f.acquire();
        await owner();
        await db.query(
          "update mail_runtime.attempts set deadline=created_at+interval '1 millisecond' where id=$1",
          [ticket.id],
        );
        await service();
        assert.equal(
          await scalar("select mail_transport_validate($1,$2,true) v", [
            ticket.id,
            cap,
          ]),
          false,
        );
        await assert.rejects(
          db.query(
            "select mail_transport_finish($1,$2,'cancelled_before_wire')",
            [ticket.id, "a".repeat(64)],
          ),
          /R06_FORBIDDEN/,
        );
        await f.run("prepare_transition");
        await assert.rejects(f.run("commit_transition"), /R06_UNRESOLVED/);
        await service();
        await db.query(
          "select mail_transport_finish($1,$2,'cancelled_before_wire')",
          [ticket.id, cap],
        );
        await f.run("commit_transition");
      },
    );
    await t.test(
      "checkpoint uses exact decimal strings, CAS and one use; other account untouched",
      async () => {
        const { ticket, cap } = await f.acquire("history");
        assert.equal(
          await scalar("select mail_transport_validate($1,$2,true) v", [
            ticket.id,
            cap,
          ]),
          true,
        );
        await db.query("select mail_transport_finish($1,$2,'finished')", [
          ticket.id,
          cap,
        ]);
        await assert.rejects(
          scalar(
            "select mail_sync_checkpoint($1,$2,0,'900719925474099312344') v",
            [ticket.id, cap],
          ),
          /R06_STALE/,
        );
        assert.equal(
          await scalar(
            "select mail_sync_checkpoint($1,$2,0,'900719925474099312346') v",
            [ticket.id, cap],
          ),
          1,
        );
        await assert.rejects(
          scalar(
            "select mail_sync_checkpoint($1,$2,1,'900719925474099312347') v",
            [ticket.id, cap],
          ),
          /R06_STALE/,
        );
        await owner();
        assert.equal(
          await scalar(
            "select history_id v from mail_credentials where account_id=$1",
            [accounts[0]],
          ),
          "900719925474099312345",
        );
        assert.equal(
          await scalar(
            "select count(*)::int v from mail_runtime.routes where account_id=$1",
            [accounts[1]],
          ),
          0,
        );
      },
    );
    await t.test(
      "a completed read ticket cannot advance a cursor after pause/revision change",
      async () => {
        const { ticket, cap } = await f.acquire("history");
        await db.query("select mail_transport_validate($1,$2,true)", [
          ticket.id,
          cap,
        ]);
        await db.query("select mail_transport_finish($1,$2,'finished')", [
          ticket.id,
          cap,
        ]);
        await f.run("pause");
        await service();
        await assert.rejects(
          scalar(
            "select mail_sync_checkpoint($1,$2,1,'900719925474099312348') v",
            [ticket.id, cap],
          ),
          /R06_STALE/,
        );
      },
    );
  } finally {
    await db.close();
  }
});

test("R06 SQL: one send, B2 admission and uncertainty without replay", async (t) => {
  const f = await transportFixture(),
    { db, scalar, owner, service, accounts, queued } = f;
  try {
    await f.run("bootstrap_direct");
    await service();
    const claimed = (
      await db.query<{ id: string; brand_claim_token: string }>(
        "select * from claim_outbox()",
      )
    ).rows[0];
    assert.equal(claimed.id, queued);
    const { ticket, cap } = await f.acquire("send", queued);
    await t.test(
      "send cannot bypass B2 or reserve the same message twice",
      async () => {
        assert.equal(
          await scalar("select mail_transport_validate($1,$2,true) v", [
            ticket.id,
            cap,
          ]),
          false,
        );
        await assert.rejects(f.acquire("send", queued), /R06_CONFLICT/);
        await db.query("select admit_brand_dispatch($1,$2)", [
          queued,
          claimed.brand_claim_token,
        ]);
        await owner();
        await db.exec("begin");
        await db.query(
          "update mail_permissions set can_send=false where account_id=$1",
          [accounts[0]],
        );
        await service();
        assert.equal(
          await scalar("select mail_transport_validate($1,$2,true) v", [
            ticket.id,
            cap,
          ]),
          false,
        );
        await db.exec("rollback");
        await service();
        assert.equal(
          await scalar("select mail_transport_validate($1,$2,true) v", [
            ticket.id,
            cap,
          ]),
          true,
        );
        assert.equal(
          await scalar("select mail_transport_validate($1,$2,true) v", [
            ticket.id,
            cap,
          ]),
          false,
        );
      },
    );
    await t.test(
      "admitted/uncertain cannot be cancelled or called finished without accepted DB result",
      async () => {
        await assert.rejects(
          db.query(
            "select mail_transport_finish($1,$2,'cancelled_before_wire')",
            [ticket.id, cap],
          ),
          /R06_UNRESOLVED/,
        );
        await assert.rejects(
          db.query("select mail_transport_finish($1,$2,'finished')", [
            ticket.id,
            cap,
          ]),
          /R06_UNRESOLVED/,
        );
        await db.query("select mail_transport_finish($1,$2,'uncertain')", [
          ticket.id,
          cap,
        ]);
        await f.run("prepare_transition");
        await assert.rejects(f.run("commit_transition"), /R06_UNRESOLVED/);
      },
    );
    await t.test(
      "existing accepted-result reconciliation closes the ledger, never replays the send",
      async () => {
        await service();
        await db.query("select mark_sent($1,'abc123','def456')", [queued]);
        await db.query("select mail_transport_finish($1,$2,'finished')", [
          ticket.id,
          cap,
        ]);
        await db.query("select mail_transport_finish($1,$2,'finished')", [
          ticket.id,
          cap,
        ]);
        assert.equal((await f.run("commit_transition")).state, "ready");
        await assert.rejects(f.acquire("send", queued), /R06_NOT_READY/);
        await owner();
        assert.equal(
          await scalar(
            "select count(*)::int v from mail_runtime.attempts where resource=$1",
            [queued],
          ),
          1,
        );
        assert.equal(
          await scalar("select status v from outbox where id=$1", [queued]),
          "sent",
        );
      },
    );
  } finally {
    await db.close();
  }
});

test("R06 SQL: R05 new account, C2 bridge and operational approval", async (t) => {
  const f = await transportFixture(),
    { db, scalar, owner, service } = f;
  try {
    const fresh = await f.onboard();
    await t.test(
      "new R05 account remains disconnected without credential or send permission",
      async () => {
        await owner();
        assert.equal(
          await scalar("select status v from mail_accounts where id=$1", [
            fresh.account,
          ]),
          "disconnected",
        );
        assert.equal(
          await scalar(
            "select count(*)::int v from mail_credentials where account_id=$1",
            [fresh.account],
          ),
          0,
        );
        await assert.rejects(
          f.run("bootstrap_direct", "gmail_oauth", fresh.account),
          /R06_NOT_READY/,
        );
        await f.human();
        assert.equal((await f.page(fresh.account)).account.ready, false);
      },
    );
    const verified = await f.verifyAndConfirm(fresh.account);
    await t.test(
      "only completed R05 enables disconnected verification; general C1 ready is unchanged",
      async () => {
        await f.human();
        const page = await f.page(fresh.account);
        assert.equal(page.current!.status, "verified");
        assert.equal(page.account.ready, false);
        await owner();
        const ctx = await scalar("select mail_runtime.context($1) v", [
          fresh.account,
        ]);
        assert.equal(
          await scalar("select mail_runtime.verification_ready($1,$2) v", [
            ctx,
            f.users.admin,
          ]),
          true,
        );
        assert.equal(
          await scalar("select mail_runtime.verification_ready($1,$2) v", [
            ctx,
            f.users.seller,
          ]),
          false,
        );
        const fake = { ...(ctx as object), account_id: f.accounts[2] };
        assert.equal(
          await scalar("select mail_runtime.verification_ready($1,$2) v", [
            fake,
            f.users.admin,
          ]),
          false,
        );
        await f.human();
        await assert.rejects(
          f.commandC(
            "register_candidate",
            {
              ...bindingExpected(await f.page(fresh.account)),
              composio_project_id: "pr_other",
              auth_config_id: "ac_other",
              connected_account_id: "ca_other",
              composio_user_id: "other",
              google_quota_project_id: "quota",
            },
            fresh.account,
          ),
          /C_BINDING_ACCOUNT_NOT_READY/,
        );
      },
    );
    await t.test(
      "explicit reviewed commit creates operational selection without resuming live/sync or granting send",
      async () => {
        await f.run("prepare_transition", "composio", fresh.account);
        const page = await f.run(
          "commit_transition",
          "composio",
          fresh.account,
        );
        assert.equal(page.provider, "composio");
        assert.equal(page.state, "ready");
        await f.human();
        assert.equal((await f.page(fresh.account)).current!.stale, false);
        await owner();
        const row = await scalar(
          "select jsonb_build_object('status',status,'live',live_enabled,'sync',sync_enabled,'permissions',(select count(*) from mail_permissions p where p.account_id=a.id),'credentials',(select count(*) from mail_credentials c where c.account_id=a.id)) v from mail_accounts a where id=$1",
          [fresh.account],
        );
        assert.deepEqual(row, {
          status: "connected",
          live: false,
          sync: false,
          permissions: 0,
          credentials: 0,
        });
        assert.equal(
          await scalar(
            "select account_context->>'status' v from mail_provider_bindings where id=$1",
            [verified.id],
          ),
          "disconnected",
        );
      },
    );
    await t.test(
      "resolver ticket binds exact connection; watch/foreign signature denied and no credential needed",
      async () => {
        const { ticket, cap } = await f.acquire(
          "thread",
          "abc123",
          fresh.account,
        );
        assert.equal(ticket.provider, "composio");
        assert.equal(ticket.binding!.accountId, fresh.account);
        await db.query(
          "select mail_transport_finish($1,$2,'cancelled_before_wire')",
          [ticket.id, cap],
        );
        await assert.rejects(
          f.acquire("watch", "watch", fresh.account),
          /R06_INVALID_INPUT/,
        );
        await assert.rejects(
          f.acquire("signature", "other@example.test", fresh.account),
          /R06_INVALID_INPUT/,
        );
      },
    );
    await t.test(
      "non-identity updates preserve operational approval; identity ABA invalidates even when restored",
      async () => {
        await owner();
        await db.query(
          "update mail_accounts set live_enabled=true where id=$1",
          [fresh.account],
        );
        const ok = await f.acquire("profile", "profile", fresh.account);
        await db.query(
          "select mail_transport_finish($1,$2,'cancelled_before_wire')",
          [ok.ticket.id, ok.cap],
        );
        await owner();
        await db.exec("begin");
        await db.query(
          "update mail_accounts set email='changed@example.test' where id=$1",
          [fresh.account],
        );
        await db.query("update mail_accounts set email=$2 where id=$1", [
          fresh.account,
          fresh.email,
        ]);
        await db.exec("savepoint changed");
        await assert.rejects(
          f.acquire("profile", "profile", fresh.account),
          /R06_NOT_READY/,
        );
        await db.exec("rollback");
        const still = await f.acquire("profile", "profile", fresh.account);
        await db.query(
          "select mail_transport_finish($1,$2,'cancelled_before_wire')",
          [still.ticket.id, still.cap],
        );
      },
    );
    await t.test(
      "config/head changes revoke tickets before dispatch, no default direct fallback",
      async () => {
        const { ticket, cap } = await f.acquire(
          "profile",
          "profile",
          fresh.account,
        );
        await owner();
        await db.exec("begin");
        await service();
        await db.query("select composio_connect_publish($1)", [
          { ...f.config, generation: 2 },
        ]);
        assert.equal(
          await scalar("select mail_transport_validate($1,$2,true) v", [
            ticket.id,
            cap,
          ]),
          false,
        );
        await db.exec("rollback");
        await f.human();
        const p = await f.page(fresh.account);
        await f.commandC(
          "revoke_binding",
          {
            ...bindingExpected(p),
            binding_id: p.current!.id,
            reason: "operator_revoked",
          },
          fresh.account,
        );
        await service();
        assert.equal(
          await scalar("select mail_transport_validate($1,$2,true) v", [
            ticket.id,
            cap,
          ]),
          false,
        );
        await assert.rejects(
          f.acquire("profile", "profile", fresh.account),
          /R06_NOT_READY/,
        );
        await db.query(
          "select mail_transport_finish($1,$2,'cancelled_before_wire')",
          [ticket.id, cap],
        );
      },
    );
  } finally {
    await db.close();
  }
});
