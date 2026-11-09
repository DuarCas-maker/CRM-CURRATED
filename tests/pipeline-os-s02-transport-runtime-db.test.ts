import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  runtimeFixture,
  runtimeSqlPath,
} from "./fixtures/pipeline-os-s02-transport-runtime";
import { queueFixtureMail } from "./fixtures/pipeline-os-s02-brand-delivery";
import {
  executeRuntimeMail,
  withMailRuntime,
  withMailDispatch,
  type RuntimeCallbacks,
} from "../src/lib/server/mail-transport/runtime-context";
import { GmailError } from "../src/lib/gmail-errors";
test("R06-I02 SQL: marker, source pin, additive rollback and ACL", async (t) => {
  const f = await runtimeFixture(false);
  try {
    await f.owner();
    const sql = await readFile(runtimeSqlPath, "utf8");
    const before = await f.scalar(
      "select pg_get_functiondef('public.mail_transport_finish(uuid,text,text)'::regprocedure) v",
    );
    await t.test(
      "marker required and external rollback restores I01 body/index/constraint",
      async () => {
        await assert.rejects(f.db.exec(sql), /R06_I02_LOCAL_MARKER_REQUIRED/);
        await f.db.exec("set pipeline_os.r06_i02_local='in_memory_test'");
        await f.db.exec("begin");
        await f.db.exec(sql);
        await f.db.exec("rollback");
        assert.equal(
          await f.scalar(
            "select pg_get_functiondef('public.mail_transport_finish(uuid,text,text)'::regprocedure) v",
          ),
          before,
        );
        assert.equal(
          await f.scalar(
            "select to_regprocedure('public.mail_transport_snapshot(uuid)') v",
          ),
          null,
        );
        assert.equal(
          await f.scalar(
            "select count(*)::int v from pg_trigger where tgname='runtime_outbox_hold'",
          ),
          0,
        );
      },
    );
    await t.test(
      "source mismatch rejects instead of replacing an unknown finish contract",
      async () => {
        await f.db.exec("begin");
        await f.db.exec(
          "create or replace function public.mail_transport_finish(attempt uuid,capability text,outcome text) returns void language plpgsql security definer set search_path='' as $$begin null;end$$",
        );
        await assert.rejects(f.db.exec(sql), /R06_I02_BASE_MISMATCH/);
        await f.db.exec("rollback");
      },
    );
    await f.db.exec(sql);
    await t.test(
      "service-only new RPC; no direct private table grants or human approval bypass",
      async () => {
        for (const signature of [
          "public.mail_transport_snapshot(uuid)",
          "public.mail_transport_validate_context(uuid,text,text,bigint,boolean)",
          "public.mail_transport_settle_dispatch(uuid,text)",
        ]) {
          for (const role of ["anon", "authenticated"])
            assert.equal(
              await f.scalar(
                "select has_function_privilege($1,$2,'execute') v",
                [role, signature],
              ),
              false,
            );
          assert.equal(
            await f.scalar(
              "select has_function_privilege('service_role',$1,'execute') v",
              [signature],
            ),
            true,
          );
        }
        assert.equal(
          await f.scalar(
            "select has_table_privilege('service_role','mail_runtime.attempts','update') v",
          ),
          false,
        );
        assert.equal(
          await f.scalar(
            "select has_function_privilege('service_role','public.mail_transport_command(uuid,text,jsonb,uuid)','execute') v",
          ),
          false,
        );
      },
    );
  } finally {
    await f.db.close();
  }
});
test("R06-I02 SQL lifecycle: B2 acceptance and proven Google quota", async (t) => {
  const f = await runtimeFixture();
  try {
    let pending: Record<string, unknown> = {};
    const originalRpc = f.deps.rpc;
    f.deps.rpc = async (name, p) => {
      if (name === "mail_transport_finish") pending = p;
      return originalRpc(name, p);
    };
    await f.run("bootstrap_direct");
    await f.service();
    let msg = (
      await f.db.query<{ id: string; brand_claim_token: string }>(
        "select * from claim_outbox()",
      )
    ).rows[0];
    const callbacks: RuntimeCallbacks = {
      direct: async () => ({
        quotaProjectId: "fixture",
        transport: {
          provider: "gmail_oauth",
          execute: async <T>() => ({ id: "abc123", threadId: "def456" }) as T,
        },
      }),
      quota: async () => {},
    };
    await t.test(
      "finish stays blocked until actual mark_sent/B2 accepted; scope closes afterwards",
      async () => {
        await withMailRuntime(f.deps, () =>
          withMailDispatch(f.accounts[0], msg.id, async () => {
            await executeRuntimeMail(
              {
                account: f.accounts[0],
                path: "messages/send",
                init: { method: "POST", body: "{}" },
                beforeRequest: async () => {
                  await f.service();
                  await f.db.query("select admit_brand_dispatch($1,$2)", [
                    msg.id,
                    msg.brand_claim_token,
                  ]);
                },
              },
              callbacks,
            );
            await f.owner();
            assert.equal(
              await f.scalar(
                "select state v from mail_runtime.attempts where resource=$1",
                [msg.id],
              ),
              "admitted",
            );
            await f.service();
            await f.db.query("select mark_sent($1,'abc123','def456')", [
              msg.id,
            ]);
          }),
        );
        await f.owner();
        assert.equal(
          await f.scalar(
            "select state v from mail_runtime.attempts where resource=$1",
            [msg.id],
          ),
          "finished",
        );
      },
    );
    await t.test(
      "quota exception alone cannot release a send; persisted B2 known_quota can",
      async () => {
        await f.owner();
        await f.db.query(
          "update outbox set sending_at=now()-interval '2 minutes' where id=$1",
          [msg.id],
        );
        const next = await queueFixtureMail(
          f,
          f.accounts[0],
          f.users.seller,
          f.opportunity,
          f.brandA,
        );
        await f.service();
        msg = (
          await f.db.query<{ id: string; brand_claim_token: string }>(
            "select * from claim_outbox()",
          )
        ).rows[0];
        assert.equal(msg.id, next);
        callbacks.direct = async () => ({
          quotaProjectId: "fixture",
          transport: {
            provider: "gmail_oauth",
            execute: async () => {
              throw new GmailError(429, "rateLimitExceeded", 60);
            },
          },
        });
        await withMailRuntime(f.deps, () =>
          withMailDispatch(f.accounts[0], msg.id, async () => {
            await assert.rejects(
              executeRuntimeMail(
                {
                  account: f.accounts[0],
                  path: "messages/send",
                  init: { method: "POST", body: "{}" },
                  beforeRequest: async () => {
                    await f.service();
                    await f.db.query("select admit_brand_dispatch($1,$2)", [
                      msg.id,
                      msg.brand_claim_token,
                    ]);
                  },
                },
                callbacks,
              ),
              (e: unknown) => e instanceof GmailError && e.status === 429,
            );
            await f.owner();
            assert.equal(
              await f.scalar(
                "select state v from mail_runtime.attempts where resource=$1",
                [msg.id],
              ),
              "uncertain",
            );
            await f.service();
            await assert.rejects(
              f.db.query(
                "select mail_transport_finish($1,$2,'known_rejection')",
                [pending.attempt, pending.capability],
              ),
              /R06_UNRESOLVED/,
            );
            await f.db.query(
              "select defer_gmail_send($1,60,'GMAIL_HTTP_429_rateLimitExceeded')",
              [msg.id],
            );
          }),
        );
        await f.owner();
        assert.equal(
          await f.scalar(
            "select state v from mail_runtime.attempts where resource=$1",
            [msg.id],
          ),
          "known_rejection",
        );
        await f.db.query(
          "update mail_accounts set send_retry_at=null where id=$1",
          [f.accounts[0]],
        );
        await f.db.query(
          "update outbox set available_at=now()-interval '1 second' where id=$1",
          [msg.id],
        );
        await f.service();
        assert.equal(
          (await f.db.query<{ id: string }>("select id from claim_outbox()"))
            .rows[0].id,
          msg.id,
        );
        const retry = await f.acquire("send", msg.id);
        await f.db.query(
          "select mail_transport_finish($1,$2,'cancelled_before_wire')",
          [retry.ticket.id, retry.cap],
        );
        await f.owner();
        assert.equal(
          await f.scalar(
            "select count(*)::int v from mail_runtime.attempts where resource=$1",
            [msg.id],
          ),
          2,
        );
      },
    );
  } finally {
    await f.db.close();
  }
});
