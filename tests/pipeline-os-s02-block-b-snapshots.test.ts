import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  featureDatabase,
  installBrandDelivery,
  bindFixtureAccount,
  queueFixtureMail,
} from "./fixtures/pipeline-os-s02-brand-delivery";
test("B2 SQL: trusted snapshots, source isolation and legacy", async (t) => {
  const f = await featureDatabase(),
    { db, users, asUser } = f;
  const account = randomUUID(),
    other = randomUUID(),
    contact = randomUUID(),
    caseId = randomUUID(),
    legacy = randomUUID();
  const owner = () => db.exec("reset role");
  const service = async () => {
    await owner();
    await db.exec(
      'set request.jwt.claims=\'{"role":"service_role"}\';set role service_role',
    );
  };
  const row = async (sql: string, params: unknown[] = []) =>
    (await db.query<Record<string, unknown>>(sql, params)).rows[0];
  try {
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,'lead@b2.test','Fixture','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fixture',$3)",
      [caseId, contact, users.seller],
    );
    await db.query(
      "insert into mail_accounts(id,email,organization) values($1,'sender@b2.test','fixture'),($2,'other@b2.test','fixture')",
      [account, other],
    );
    await db.query(
      "insert into outbox(id,account_id,opportunity_id,to_email,subject,body,area,message_id_header,requested_by,request_key) values($1,$2,$3,'lead@b2.test','Legacy','Unchanged','seller','<legacy@b2.test>',$4,'legacy-b2')",
      [legacy, account, caseId, users.seller],
    );
    const catalog = (
      await db.query(
        "select p.oid::regprocedure::text sig,md5(pg_get_functiondef(p.oid)) hash,p.proacl::text acl from pg_proc p where proname like 'instantly_webhook_%' order by sig",
      )
    ).rows;
    await installBrandDelivery(f);
    const preparation = await bindFixtureAccount(f, account, users.seller),
      otherPrep = await bindFixtureAccount(f, other, users.outsider);
    const args = (extra: object = {}) => ({
      case_id: caseId,
      account,
      recipient: "lead@b2.test",
      subject_text: "Fixture",
      body_text: "Body",
      files: [],
      gmail_files: [],
      uploads: [],
      copies: [],
      hidden_copies: [],
      process: null,
      conversation: null,
      reply_message: null,
      submission: null,
      signature: "",
      display_name: "",
      request: randomUUID(),
      ...extra,
    });
    await t.test(
      "missing/forged/stale preparation and AAL1 rejected before insert",
      async () => {
        await asUser(users.seller);
        for (const p of [
          null,
          { ...preparation, brand_id: otherPrep.brand_id },
          { ...preparation, account_revision: 2 },
          { ...preparation, actor_id: users.admin },
        ])
          await assert.rejects(
            db.query("select brand_queue_mail('queue_mail_email',$1,$2)", [
              args(),
              p,
            ]),
            /BRAND_PREPARATION/,
          );
        await asUser(users.seller, "aal1");
        await assert.rejects(
          db.query("select brand_prepare_context($1,$2,$3,$4)", [
            account,
            preparation,
            "mail",
            caseId,
          ]),
          /BRAND_DELIVERY_FORBIDDEN/,
        );
      },
    );
    let message = "";
    await t.test(
      "valid human intent derives actor, revisions, area and timestamp from SQL",
      async () => {
        message = await queueFixtureMail(
          f,
          account,
          users.seller,
          caseId,
          preparation,
        );
        const m = await row("select brand_snapshot from outbox where id=$1", [
          message,
        ]);
        const s = m.brand_snapshot as Record<string, unknown>;
        assert.equal(s.actor_id, users.seller);
        assert.equal(s.authorization, "human_aal2");
        assert.equal(s.brand_id, preparation.brand_id);
        assert.equal(s.case_id, caseId);
        assert.equal(s.area, "seller");
        assert.equal(s.actor_revision, 1);
        assert.equal(s.permission_revision, 1);
        assert.equal(s.membership_revision, 1);
        assert.ok(s.prepared_at);
      },
    );
    await t.test(
      "raw human/service insertion and snapshot/content replacement cannot bypass preparation",
      async () => {
        await service();
        await assert.rejects(
          db.query(
            "insert into outbox(account_id,opportunity_id,to_email,subject,body,area,message_id_header,requested_by,request_key) values($1,$2,'lead@b2.test','X','X','seller','<raw@b2.test>',$3,'raw-b2')",
            [account, caseId, users.seller],
          ),
          /BRAND_PREPARATION_REQUIRED/,
        );
        await assert.rejects(
          db.query("update outbox set brand_snapshot='{}' where id=$1", [
            message,
          ]),
          /BRAND_SNAPSHOT_IMMUTABLE/,
        );
        await assert.rejects(
          db.query("update outbox set body='changed' where id=$1", [message]),
          /BRAND_INTENT_IMMUTABLE/,
        );
        await assert.rejects(
          db.query("update outbox set requested_by=$1 where id=$2", [
            users.admin,
            message,
          ]),
          /BRAND_INTENT_IMMUTABLE/,
        );
      },
    );
    await t.test(
      "mail permission, membership and case area are separate; five role limits remain",
      async () => {
        for (const role of [
          "seller_admin",
          "seller",
          "closer_admin",
          "closer",
        ]) {
          await owner();
          await db.query("update profiles set role=$1 where id=$2", [
            role,
            users.outsider,
          ]);
          await asUser(users.outsider);
          await assert.rejects(
            db.query("select brand_prepare_context($1,$2,$3,$4)", [
              account,
              preparation,
              "mail",
              caseId,
            ]),
            /BRAND_DELIVERY_FORBIDDEN/,
          );
          if (role.startsWith("closer"))
            await assert.rejects(
              db.query("select brand_prepare_context($1,$2,$3)", [
                other,
                otherPrep,
                "campaign",
              ]),
              /BRAND_DELIVERY_FORBIDDEN/,
            );
        }
        await owner();
        await db.query("update profiles set role='seller' where id=$1", [
          users.outsider,
        ]);
        await asUser(users.admin);
        assert.ok(
          (
            await row("select brand_prepare_context($1,$2,$3,$4) s", [
              account,
              preparation,
              "mail",
              caseId,
            ])
          ).s,
        );
        await asUser(users.seller);
        await assert.rejects(
          db.query("select brand_prepare_context($1,$2,$3)", [
            account,
            preparation,
            "campaign",
          ]),
          /BRAND_DELIVERY_FORBIDDEN/,
        );
      },
    );
    await t.test(
      "member catalog and technical sender permissions expose only own brand capabilities",
      async () => {
        await asUser(users.seller);
        const caps = (
          await db.query<{ c: { account_id: string } }>(
            "select brand_sender_capabilities() c",
          )
        ).rows;
        assert.deepEqual(
          caps.map((c) => c.c.account_id),
          [account],
        );
        assert.equal(
          (await db.query("select id from mail_accounts where id=$1", [other]))
            .rows.length,
          0,
        );
        await assert.rejects(
          db.query("select account_delivery_usage($1)", [other]),
          /BRAND_DELIVERY_FORBIDDEN/,
        );
      },
    );
    await t.test(
      "draft stores normalized sender snapshot; fabricated snapshot is ignored; legacy remains readable/deletable",
      async () => {
        await asUser(users.seller);
        const draft = randomUUID();
        await db.query(
          "insert into mail_drafts(id,user_id,opportunity_id,payload,brand_snapshot) values($1,$2,$3,$4,$5)",
          [
            draft,
            users.seller,
            caseId,
            { account_id: account, brand_preparation: preparation },
            { forged: true },
          ],
        );
        const d = await row(
          "select brand_account_id,brand_snapshot from mail_drafts where id=$1",
          [draft],
        );
        assert.equal(d.brand_account_id, account);
        assert.equal(
          (d.brand_snapshot as Record<string, unknown>).actor_id,
          users.seller,
        );
        await db.query("delete from mail_drafts where id=$1", [draft]);
      },
    );
    await t.test(
      "campaign create requires reviewed brand; code/source frozen, snapshots survive role restoration",
      async () => {
        await asUser(users.admin);
        const c = await f.command("create_campaign", {
          name: "B2 campaign",
          account_id: account,
          seller_id: users.seller,
          subject: "Hello",
          body: "Body {{unsubscribe_url}}",
          steps: [],
          daily_limit: 2,
          timezone: "UTC",
          start_hour: 0,
          end_hour: 23,
          selected_contact_ids: [],
          brand_preparation: preparation,
        });
        await owner();
        const stored = await row(
          "select brand_snapshot from campaigns where id=$1",
          [c.id],
        );
        assert.equal(
          (stored.brand_snapshot as Record<string, unknown>).actor_id,
          users.admin,
        );
        await service();
        await assert.rejects(
          db.query("update campaigns set body='other' where id=$1", [c.id]),
          /BRAND_SNAPSHOT_IMMUTABLE/,
        );
        await asUser(users.outsider);
        assert.equal(
          (await db.query("select id from campaigns where id=$1", [c.id])).rows
            .length,
          0,
        );
        const center = await row("select campaign_center('',0,'all') p");
        assert.equal((center.p as { total: number }).total, 0);
      },
    );
    await t.test(
      "campaign test stays with operator; scheduler rows derive approved campaign snapshot and reject altered source",
      async () => {
        await owner();
        await db.query(
          "insert into leads(contact_id,company,seller_id,opportunity_id) values($1,'Fixture',$2,$3)",
          [contact, users.seller, caseId],
        );
        await asUser(users.admin);
        const c = await f.command("create_campaign", {
          name: "B2 active",
          account_id: account,
          seller_id: users.seller,
          subject: "Hello",
          body: "Body {{unsubscribe_url}}",
          steps: [],
          daily_limit: 10,
          timezone: "UTC",
          start_hour: 0,
          end_hour: 23,
          selected_contact_ids: [contact],
          brand_preparation: preparation,
        });
        const test = await row(
          "select queue_brand_campaign_test($1,$2,'[PRUEBA] Hello','Body','<p>Body</p>',$3,$4) id",
          [c.id, contact, randomUUID(), preparation],
        );
        await owner();
        assert.equal(
          (await row("select to_email from outbox where id=$1", [test.id]))
            .to_email,
          "admin@team.test",
        );
        await asUser(users.admin);
        await f.command("activate_campaign", {
          id: c.id,
          brand_preparation: preparation,
        });
        await owner();
        const e = await row(
          "select id,opportunity_id from campaign_enrollments where campaign_id=$1",
          [c.id],
        );
        assert.ok(e.id);
        await service();
        const p = [account, e.opportunity_id, e.id, users.admin, randomUUID()];
        const insert =
          "insert into outbox(account_id,opportunity_id,enrollment_id,to_email,subject,body,area,message_id_header,requested_by,request_key,brand_snapshot) values($1,$2,$3,'lead@b2.test','Hello','Body','seller','<'||$5::text||'@fixture.test>',$4,$5::text,$6) returning id";
        await assert.rejects(
          db.query(insert, [...p, {}]),
          /BRAND_SNAPSHOT_IMMUTABLE/,
        );
        const queued = await row(insert, [...p, null]);
        await owner();
        const s = (
          await row("select brand_snapshot from outbox where id=$1", [
            queued.id,
          ])
        ).brand_snapshot as Record<string, unknown>;
        assert.equal(s.campaign_id, c.id);
        assert.equal(s.actor_id, users.admin);
        await service();
        await assert.rejects(
          db.query(
            "update campaigns set selected_contact_ids='{}' where id=$1",
            [c.id],
          ),
          /BRAND_PREPARATION_REQUIRED/,
        );
      },
    );
    await t.test(
      "notification has system provenance and no borrowed human; recipient/preference/source validated",
      async () => {
        await owner();
        const n = randomUUID();
        await db.query(
          "insert into notifications(id,user_id,title,body,event_key) values($1::uuid,$2,'Update','Open app','fixture:'||$1::text)",
          [n, users.seller],
        );
        await db.query(
          "insert into notification_preferences(user_id,email) values($1,true) on conflict(user_id) do update set email=true",
          [users.seller],
        );
        await service();
        const r = await row(
          "select queue_brand_notification($1,$2,'https://crm.fixture.test') id",
          [n, account],
        );
        await owner();
        const m = await row(
          "select requested_by,brand_snapshot,to_email from outbox where id=$1",
          [r.id],
        );
        assert.equal(m.requested_by, null);
        assert.equal(
          (m.brand_snapshot as Record<string, unknown>).authorization,
          "system_notification",
        );
        await service();
        await assert.rejects(
          db.query(
            "select queue_brand_notification($1,$2,'https://crm.fixture.test')",
            [randomUUID(), account],
          ),
          /BRAND_DELIVERY_FORBIDDEN/,
        );
        await owner();
        await db.query(
          "update notification_preferences set email=false where user_id=$1",
          [users.seller],
        );
        await service();
        await assert.rejects(
          db.query(
            "select queue_brand_notification($1,$2,'https://crm.fixture.test')",
            [n, account],
          ),
          /BRAND_DELIVERY_FORBIDDEN/,
        );
        await asUser(users.seller);
        await assert.rejects(
          db.query(
            "select queue_brand_notification($1,$2,'https://crm.fixture.test')",
            [n, account],
          ),
          /permission denied/,
        );
      },
    );
    await t.test(
      "explicit campaign re-review has one receipt/audit and revalidates the actor before replay",
      async () => {
        await asUser(users.admin);
        const c = await f.command("create_campaign", {
          name: "Review fixture",
          account_id: account,
          seller_id: users.seller,
          subject: "Hello",
          body: "Body {{unsubscribe_url}}",
          steps: [],
          daily_limit: 2,
          timezone: "UTC",
          start_hour: 0,
          end_hour: 23,
          selected_contact_ids: [],
          brand_preparation: preparation,
        });
        const key = randomUUID(),
          p = { id: c.id, brand_preparation: preparation };
        assert.equal((await f.command("prepare_campaign", p, key)).id, c.id);
        assert.equal((await f.command("prepare_campaign", p, key)).id, c.id);
        await owner();
        assert.equal(
          (
            await row(
              "select count(*) n from audit_log where entity_id=$1 and action='brand_campaign_prepared'",
              [c.id],
            )
          ).n,
          1,
        );
        await asUser(users.admin);
        await assert.rejects(
          f.command("prepare_campaign", { ...p, id: randomUUID() }, key),
        );
        await owner();
        await db.query("update profiles set active=false where id=$1", [
          users.admin,
        ]);
        await asUser(users.admin);
        await assert.rejects(
          f.command("prepare_campaign", p, key),
          /BRAND_DELIVERY_FORBIDDEN/,
        );
        await owner();
        await db.query("update profiles set active=true where id=$1", [
          users.admin,
        ]);
      },
    );
    await t.test(
      "legacy is held without inferring brand; migration leaves 046/047 unchanged and helpers private",
      async () => {
        await owner();
        await db.query("update outbox set status='cancelled' where id<>$1", [
          legacy,
        ]);
        await service();
        assert.equal(
          (await db.query("select * from claim_outbox()")).rows.length,
          0,
        );
        await owner();
        const r = await row(
          "select status,body,brand_snapshot,message_id_header from outbox where id=$1",
          [legacy],
        );
        assert.equal(r.status, "paused");
        assert.equal(r.brand_snapshot, null);
        assert.equal(r.body, "Unchanged");
        assert.equal(r.message_id_header, "<legacy@b2.test>");
        assert.deepEqual(
          (
            await db.query(
              "select p.oid::regprocedure::text sig,md5(pg_get_functiondef(p.oid)) hash,p.proacl::text acl from pg_proc p where proname like 'instantly_webhook_%' order by sig",
            )
          ).rows,
          catalog,
        );
        await db.exec("set role anon");
        await assert.rejects(
          db.exec("select * from mail_brand_dispatch_admissions"),
          /permission denied/,
        );
        await db.exec("reset role;set role service_role");
        await assert.rejects(
          db.exec("select * from mail_brand_dispatch_admissions"),
          /permission denied/,
        );
        await assert.rejects(
          db.exec("select * from claim_outbox_v7()"),
          /permission denied/,
        );
      },
    );
  } finally {
    await db.close();
  }
});

test("B2 candidate has explicit marker and rolls back schema/ACL/functions in the isolated database", async () => {
  const f = await featureDatabase();
  try {
    await installBrandDelivery(f, false);
    const sql = await readFile(
      "docs/specs/pipeline-os/s02/integration/block-b/migrations/b-brand-delivery.local.sql",
      "utf8",
    );
    await f.db.exec("reset pipeline_os.block_b2_local");
    await assert.rejects(f.db.exec(sql), /explicit in-memory marker/);
    await f.db.exec("rollback");
    const before = (
      await f.db.query(
        "select md5(pg_get_functiondef('public.crm_command(text,jsonb,uuid)'::regprocedure)) hash",
      )
    ).rows;
    await f.db.exec(
      "begin;set local pipeline_os.block_b2_local='in_memory_test'",
    );
    await f.db.exec(
      sql
        .replace(/^([\s\S]*?)begin;/, (_m, comment) => comment)
        .replace(/commit;\s*$/, ""),
    );
    await f.db.exec("rollback");
    assert.equal(
      (
        await f.db.query<{ x: string | null }>(
          "select to_regnamespace('brand_b2')::text x",
        )
      ).rows[0].x,
      null,
    );
    assert.deepEqual(
      (
        await f.db.query(
          "select md5(pg_get_functiondef('public.crm_command(text,jsonb,uuid)'::regprocedure)) hash",
        )
      ).rows,
      before,
    );
  } finally {
    await f.db.close();
  }
});
