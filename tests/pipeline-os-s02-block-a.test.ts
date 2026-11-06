import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "./feature-database";

const root = "docs/specs/pipeline-os/s02/integration/migrations/";
const fixtures = "tests/fixtures/pipeline-os-s01/";
type Database = Awaited<ReturnType<typeof featureDatabase>>["db"];

// Names and definitions, never OIDs: compare two independent in-memory bases.
async function catalog(db: Database) {
  return (
    await db.query<{ kind: string; name: string; definition: string }>(`
    select 'function' kind,p.oid::regprocedure::text name,
      jsonb_build_array(pg_get_functiondef(p.oid),p.proacl::text,pg_get_userbyid(p.proowner))::text definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','s01_i02') and p.prokind='f'
    union all select 'relation',n.nspname||'.'||c.relname,
      jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
      pg_get_userbyid(c.relowner),case when c.relkind='v' then pg_get_viewdef(c.oid) end,c.reloptions)::text
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','storage') and c.relkind in ('r','v')
    union all select 'column',c.table_schema||'.'||c.table_name||'.'||c.column_name,
      jsonb_build_array(c.data_type,c.udt_name,c.is_nullable,c.column_default,c.ordinal_position)::text
      from information_schema.columns c where c.table_schema in ('public','storage')
    union all select 'column_grant',n.nspname||'.'||c.relname||'.'||a.attname,a.attacl::text
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','storage') and a.attnum>0 and not a.attisdropped and a.attacl is not null
    union all select 'constraint',n.nspname||'.'||c.relname||'.'||x.conname,pg_get_constraintdef(x.oid)
      from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','storage')
    union all select 'index',schemaname||'.'||indexname,indexdef from pg_indexes where schemaname in ('public','storage')
    union all select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid)
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where not t.tgisinternal and n.nspname in ('public','storage')
    union all select 'policy',schemaname||'.'||tablename||'.'||policyname,
      jsonb_build_array(permissive,roles,cmd,qual,with_check)::text from pg_policies where schemaname in ('public','storage')
    order by kind,name
  `)
  ).rows;
}

test("A SQL: local marker is required; candidates contain explicit definitions, no session rewriting", async () => {
  const { db } = await featureDatabase();
  try {
    for (const name of [
      "a-brand-foundation.local.sql",
      "a-mail-permissions.local.sql",
    ]) {
      const sql = await readFile(root + name, "utf8");
      assert.doesNotMatch(
        sql,
        /create temporary|pg_get_functiondef|execute definition/i,
      );
      await assert.rejects(
        db.exec(sql),
        /sandbox marker|in-memory sandbox marker/,
      );
      await db.exec("rollback");
    }
    assert.equal(
      (
        await db.query<{ name: string | null }>(
          "select to_regclass('public.operating_brands') name",
        )
      ).rows[0].name,
      null,
    );
  } finally {
    await db.close();
  }
});

test("A SQL: static candidates equal reviewed fixtures over 001-047, including grants and Instantly", async () => {
  const a = await featureDatabase();
  const b = await featureDatabase();
  try {
    const before = (await catalog(a.db)).filter((r) =>
      r.name.includes("instantly_webhook"),
    );
    const jobsBefore = (
      await a.db.query("select to_jsonb(j) value from jobs j order by id")
    ).rows;
    await a.db.exec("set pipeline_os.block_a_local='in_memory_test'");
    await a.db.exec(
      await readFile(root + "a-brand-foundation.local.sql", "utf8"),
    );
    await a.db.exec(
      await readFile(root + "a-mail-permissions.local.sql", "utf8"),
    );
    await b.db.exec(
      "set pipeline_os.i01_sandbox='in_memory_test';set pipeline_os.i02_sandbox='in_memory_test'",
    );
    await b.db.exec(
      await readFile(fixtures + "t01-02-i01-foundation.sql", "utf8"),
    );
    await b.db.exec(
      await readFile(fixtures + "t01-02-i02-mail-permissions.sql", "utf8"),
    );
    const actual = await catalog(a.db);
    assert.deepEqual(actual, await catalog(b.db));
    assert.deepEqual(
      actual.filter((r) => r.name.includes("instantly_webhook")),
      before,
    );
    assert.equal(
      (
        await a.db.query<{ name: string | null }>(
          "select to_regclass('pg_temp.s01_i02_original_functions') name",
        )
      ).rows[0].name,
      null,
    );
    assert.equal(
      (
        await a.db.query<{ n: number }>(
          "select count(*)::int n from operating_brands",
        )
      ).rows[0].n,
      0,
    );
    assert.deepEqual(
      (await a.db.query("select to_jsonb(j) value from jobs j order by id"))
        .rows,
      jobsBefore,
    );
  } finally {
    await a.db.close();
    await b.db.close();
  }
});

test("A SQL: existing account, history and permissions survive; unknown brand stays unknown and area is enforced", async () => {
  const f = await featureDatabase();
  const account = randomUUID(),
    contact = randomUUID(),
    caseId = randomUUID(),
    thread = randomUUID();
  const sellerMessage = randomUUID(),
    closerMessage = randomUUID();
  try {
    await f.db.query(
      "insert into contacts(id,email,name,verification) values($1,'client@block-a.test','Fixture','valid')",
      [contact],
    );
    await f.db.query(
      "insert into opportunities(id,contact_id,company,seller_id,closer_id,handed_off_at) values($1,$2,'Fixture',$3,$4,'2026-01-02')",
      [caseId, contact, f.users.seller, f.users.closer],
    );
    await f.db.query(
      "insert into mail_accounts(id,email,organization) values($1,'mailbox@block-a.test','fixture')",
      [account],
    );
    await f.db.query(
      "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true),($1,$3,true)",
      [account, f.users.seller, f.users.closer],
    );
    await f.db.query(
      "insert into conversations(id,account_id,opportunity_id,gmail_thread_id,subject,area) values($1,$2,$3,'retained-thread','Private closer subject','seller')",
      [thread, account, caseId],
    );
    for (const [id, date, body] of [
      [sellerMessage, "2026-01-01", "Seller content"],
      [closerMessage, "2026-01-03", "Private closer content"],
    ])
      await f.db.query(
        "insert into messages(id,conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1,$2,$1::uuid::text,'inbound','client@block-a.test',$3,$4,'received')",
        [id, thread, body, date],
      );
    const snapshot = async () =>
      (
        await f.db.query(`
      select 'account' kind,id::text id,(to_jsonb(a)-'operating_brand_id'-'brand_revision')::text value from mail_accounts a
      union all select 'message',id::text,to_jsonb(m)::text from messages m
      union all select 'permission',account_id::text||':'||user_id::text,to_jsonb(p)::text from mail_permissions p
      union all select 'conversation',id::text,to_jsonb(c)::text from conversations c order by kind,id
    `)
      ).rows;
    const before = await snapshot();
    await f.db.exec("set pipeline_os.block_a_local='in_memory_test'");
    await f.db.exec(
      await readFile(root + "a-brand-foundation.local.sql", "utf8"),
    );
    await f.db.exec(
      await readFile(root + "a-mail-permissions.local.sql", "utf8"),
    );
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      (
        await f.db.query(
          "select operating_brand_id,brand_revision::int from mail_accounts where id=$1",
          [account],
        )
      ).rows[0],
      { operating_brand_id: null, brand_revision: 0 },
    );
    await f.asUser(f.users.seller);
    assert.deepEqual(
      (await f.db.query("select id from messages order by id")).rows,
      [{ id: sellerMessage }],
    );
    const visible = (
      await f.db.query<{ subject: string; can_reply: boolean }>(
        "select subject,can_reply from mail_conversations_visible where id=$1",
        [thread],
      )
    ).rows[0];
    assert.equal(visible.can_reply, false);
    assert.notEqual(visible.subject, "Private closer subject");
    assert.equal(
      (
        await f.db.query<{ context: { can_write: boolean } }>(
          "select mail_access_context($1) context",
          [caseId],
        )
      ).rows[0].context.can_write,
      false,
    );
    await assert.rejects(
      f.db.query("select subject from conversations where id=$1", [thread]),
      /permission denied/,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(
      f.db.query("select mail_access_context($1)", [caseId]),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});
