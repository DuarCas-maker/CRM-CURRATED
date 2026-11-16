import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { c1Fixture } from "./fixtures/pipeline-os-s02-composio-bindings";
import {
  queueFixtureMail,
  bindFixtureAccount,
} from "./fixtures/pipeline-os-s02-brand-delivery";
const dir = "docs/specs/pipeline-os/manual-mail-latency/migrations/";
test("manual fast claims preserve B2 guards, campaign cadence, account isolation and reversible DDL", async (t) => {
  const f = await c1Fixture(false),
    { db, accounts, users, opportunity, brandA } = f;
  const owner = () => db.exec("reset role;set request.jwt.claims='{}'");
  const service = async () => {
    await owner();
    await db.exec("set role service_role");
  };
  const scalar = async <T>(sql: string, p: unknown[] = []) =>
    (await db.query<{ v: T }>(sql, p)).rows[0].v;
  const install = await readFile(dir + "manual-mail-latency.sql", "utf8"),
    rollback = await readFile(dir + "manual-mail-latency.rollback.sql", "utf8");
  const before = await scalar<string>(
    "select md5(prosrc) v from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure",
  );
  const clean = async () => {
    await owner();
    await db.exec(
      "update outbox set status='cancelled' where status in ('queued','sending');update outbox set sending_at=now()-interval '2 minutes' where sending_at is not null;update mail_accounts set send_retry_at=null,daily_limit=250;",
    );
  };
  const queue = () =>
    queueFixtureMail(f, accounts[0], users.seller, opportunity, brandA);
  const claim = async (a: string | null = accounts[0]) => {
    await service();
    return (
      await db.query<Record<string, unknown>>(
        "select * from claim_manual_outbox($1)",
        [a],
      )
    ).rows[0];
  };
  const settle = async (m: Record<string, unknown>) => {
    await service();
    await scalar("select admit_brand_dispatch($1,$2) v", [
      m.id,
      m.brand_claim_token,
    ]);
    await db.query("select mark_sent($1,$2,$3)", [
      m.id,
      randomUUID(),
      randomUUID(),
    ]);
  };
  try {
    await t.test(
      "installation rejects a different owner before changing the catalog",
      async () => {
        await db.exec("set role authenticated");
        await assert.rejects(
          db.exec(install),
          /MANUAL_MAIL_OWNER_MISMATCH|permission denied/,
        );
        await db.exec("rollback");
        await owner();
        assert.equal(
          await scalar(
            "select to_regprocedure('public.claim_manual_outbox(uuid)') v",
          ),
          null,
        );
      },
    );
    await owner();
    const preflight = await db.exec(
      await readFile(dir + "preflight.sql", "utf8"),
    );
    const pre = preflight.find((x) => x.rows.length)?.rows[0]
      ?.jsonb_build_object as Record<string, unknown>;
    assert.equal(pre.fast_already_installed, false);
    assert.equal(pre.claim_source_hash, "0aec6d3a26c490d986324f2f1fc7d50f");
    await db.exec(install);
    const postflight = await db.exec(
      await readFile(dir + "postflight.sql", "utf8"),
    );
    const post = postflight.find((x) => x.rows.length)?.rows[0]
      ?.jsonb_build_object as Record<string, unknown>;
    assert.equal(post.service_can_claim, true);
    assert.equal(post.authenticated_can_claim, false);
    assert.equal(post.anon_can_claim, false);
    assert.equal(post.owners_match, true);
    assert.equal(post.definers_have_empty_path, true);
    await t.test(
      "only service_role can call the RPCs; internal helpers are private",
      async () => {
        for (const role of ["anon", "authenticated"]) {
          await owner();
          await db.exec("set role " + role);
          await assert.rejects(
            db.exec("select manual_mail_ready_accounts()"),
            /permission denied/,
          );
          await assert.rejects(
            db.query("select * from claim_manual_outbox($1)", [accounts[0]]),
            /permission denied/,
          );
        }
        await service();
        assert(
          (
            await scalar<string[]>("select manual_mail_ready_accounts() v")
          ).includes(accounts[0]),
        );
        await assert.rejects(
          db.exec("select brand_b2.is_manual_mail(null::public.outbox)"),
          /permission denied/,
        );
        assert.equal(await claim(null), undefined);
      },
    );
    await t.test(
      "second manual after one second is claimable without the old 30-second delay",
      async () => {
        await clean();
        const first = await queue();
        const m = await claim();
        assert.equal(m.id, first);
        await settle(m);
        await owner();
        await db.query(
          "update outbox set sending_at=now()-interval '2 seconds' where id=$1",
          [first],
        );
        const second = await queue();
        const next = await claim();
        assert.equal(next.id, second);
        await settle(next);
      },
    );
    await t.test(
      "busy mailbox stays serialized while another mailbox can progress",
      async () => {
        await clean();
        await queue();
        const first = await claim();
        assert(first);
        const waiting = await queue();
        assert.equal(await claim(), undefined);
        await owner();
        const a2 = randomUUID();
        await db.query(
          "insert into mail_accounts(id,email,organization) values($1,'second@latency.test','fixture')",
          [a2],
        );
        const b2 = await bindFixtureAccount(f, a2);
        const other = await queueFixtureMail(
          f,
          a2,
          users.seller,
          opportunity,
          b2,
        );
        assert.equal((await claim(a2)).id, other);
        await owner();
        assert.equal(
          await scalar<string>("select status v from outbox where id=$1", [
            waiting,
          ]),
          "queued",
        );
        assert.equal(
          await scalar<boolean>(
            "select available_at<now()+interval '2 seconds' v from outbox where id=$1",
            [waiting],
          ),
          true,
        );
      },
    );
    await t.test(
      "zero quota and Retry-After still defer without dispatch",
      async () => {
        await clean();
        await queue();
        await settle(await claim());
        const id = await queue();
        await owner();
        await db.query("update mail_accounts set daily_limit=1 where id=$1", [
          accounts[0],
        ]);
        assert.equal(await claim(), undefined);
        await owner();
        assert.equal(
          await scalar<string>("select status v from outbox where id=$1", [id]),
          "queued",
        );
        await db.query(
          "update mail_accounts set daily_limit=250,send_retry_at=now()+interval '5 minutes' where id=$1",
          [accounts[0]],
        );
        await db.query("update outbox set available_at=now() where id=$1", [
          id,
        ]);
        assert.equal(await claim(), undefined);
        await owner();
        assert.equal(
          await scalar<boolean>(
            "select available_at>=now()+interval '4 minutes' v from outbox where id=$1",
            [id],
          ),
          true,
        );
      },
    );
    await t.test(
      "revoked permission pauses a queued manual and never emits a claim",
      async () => {
        await clean();
        const id = await queue();
        await owner();
        await db.query(
          "update mail_permissions set can_send=false where account_id=$1 and user_id=$2",
          [accounts[0], users.seller],
        );
        assert.equal(await claim(), undefined);
        await owner();
        assert.equal(
          await scalar<string>("select status v from outbox where id=$1", [id]),
          "paused",
        );
        await db.query(
          "update mail_permissions set can_send=true where account_id=$1 and user_id=$2",
          [accounts[0], users.seller],
        );
      },
    );
    await t.test(
      "campaign tests and notifications are never classified as manual",
      async () => {
        await clean();
        const id = await queue();
        await owner();
        assert.equal(
          await scalar<boolean>(
            "select brand_b2.is_manual_mail(o) v from outbox o where id=$1",
            [id],
          ),
          true,
        );
        assert.equal(
          await scalar<boolean>(
            "select brand_b2.is_manual_mail(jsonb_populate_record(null::public.outbox,to_jsonb(o)||jsonb_build_object('campaign_test',true))) v from outbox o where id=$1",
            [id],
          ),
          false,
        );
        assert.equal(
          await scalar<boolean>(
            "select brand_b2.is_manual_mail(jsonb_populate_record(null::public.outbox,to_jsonb(o)||jsonb_build_object('enrollment_id',gen_random_uuid()))) v from outbox o where id=$1",
            [id],
          ),
          false,
        );
        assert.equal(
          await scalar<boolean>(
            "select brand_b2.is_manual_mail(jsonb_populate_record(null::public.outbox,to_jsonb(o)||jsonb_build_object('notification_id',gen_random_uuid()))) v from outbox o where id=$1",
            [id],
          ),
          false,
        );
      },
    );
    await t.test(
      "notification keeps its 30-second spacing and is excluded from manual discovery",
      async () => {
        await clean();
        await queue();
        const prior = await claim();
        await settle(prior);
        await owner();
        await db.query(
          "update outbox set sending_at=now()-interval '2 seconds' where id=$1",
          [prior.id],
        );
        await db.query(
          "insert into notification_preferences(user_id,email) values($1,true) on conflict(user_id) do update set email=true",
          [users.seller],
        );
        const notification = randomUUID();
        await db.query(
          "insert into notifications(id,user_id,title,body,event_key) values($1,$2,'Fixture','Fixture',$3)",
          [notification, users.seller, "fixture:" + notification],
        );
        await service();
        const id = await scalar<string>(
          "select queue_brand_notification($1,$2,'https://crm.fixture.test') v",
          [notification, accounts[0]],
        );
        assert.equal(
          (
            await scalar<string[]>("select manual_mail_ready_accounts() v")
          ).includes(accounts[0]),
          false,
        );
        assert.equal(await claim(), undefined);
        await service();
        assert.equal(
          (await db.query("select * from claim_notification_outbox()")).rows
            .length,
          0,
        );
        await owner();
        assert.equal(
          await scalar<string>("select status v from outbox where id=$1", [id]),
          "queued",
        );
        assert.equal(
          await scalar<boolean>(
            "select available_at>now()+interval '50 seconds' v from outbox where id=$1",
            [id],
          ),
          true,
        );
      },
    );
    await t.test(
      "a slow active manual prevents another channel from overlapping its mailbox",
      async () => {
        await clean();
        await queue();
        const active = await claim();
        await owner();
        await db.query(
          "update outbox set sending_at=now()-interval '45 seconds' where id=$1",
          [active.id],
        );
        const notice = randomUUID();
        await db.query(
          "insert into notification_preferences(user_id,email) values($1,true) on conflict(user_id) do update set email=true",
          [users.seller],
        );
        await db.query(
          "insert into notifications(id,user_id,title,body,event_key) values($1,$2,'Update','Open app',$3)",
          [notice, users.seller, "fixture:" + notice],
        );
        await service();
        await scalar(
          "select queue_brand_notification($1,$2,'https://crm.fixture.test') v",
          [notice, accounts[0]],
        );
        assert.equal(
          (await db.query("select * from claim_notification_outbox()")).rows
            .length,
          0,
        );
      },
    );
    await t.test(
      "a real campaign test keeps its cadence and never enters the manual lane",
      async () => {
        await clean();
        await queue();
        const prior = await claim();
        await settle(prior);
        await owner();
        await db.query(
          "update outbox set sending_at=now()-interval '2 seconds' where id=$1",
          [prior.id],
        );
        const contact = randomUUID(),
          sampleCase = randomUUID();
        await db.query(
          "insert into contacts(id,name,email,verification) values($1,'Campaign fixture','fresh@latency.test','valid')",
          [contact],
        );
        await db.query(
          "insert into opportunities(id,contact_id,company,seller_id,email_qualified_at) values($1,$2,'Fresh campaign fixture',$3,now())",
          [sampleCase, contact, users.seller],
        );
        await db.query(
          "insert into leads(contact_id,company,seller_id,opportunity_id) values($1,'Fresh campaign fixture',$2,$3)",
          [contact, users.seller, sampleCase],
        );
        await f.asUser(users.admin);
        const campaign = (
          await f.command("create_campaign", {
            name: "Fixture",
            account_id: accounts[0],
            seller_id: users.seller,
            timezone: "UTC",
            daily_limit: 50,
            start_hour: 0,
            end_hour: 24,
            subject: "Fixture",
            body: "Fixture {{unsubscribe_url}}",
            steps: [],
            brand_preparation: brandA,
          })
        ).id;
        const id = await scalar<string>(
          "select queue_brand_campaign_test($1,$2,'Fixture','Fixture',null,$3,$4::jsonb) v",
          [campaign, contact, randomUUID(), JSON.stringify(brandA)],
        );
        assert.equal(await claim(), undefined);
        await service();
        assert.equal(
          (await db.query("select * from claim_outbox()")).rows.length,
          0,
        );
        await owner();
        assert.equal(
          await scalar<string>("select status v from outbox where id=$1", [id]),
          "queued",
        );
        assert.equal(
          await scalar<boolean>(
            "select available_at>now()+interval '50 seconds' v from outbox where id=$1",
            [id],
          ),
          true,
        );
      },
    );
    await t.test(
      "a manual cannot overtake an older deferred manual in the same mailbox",
      async () => {
        await clean();
        const first = await queue();
        await owner();
        await db.query(
          "update outbox set available_at=now()+interval '10 seconds' where id=$1",
          [first],
        );
        await queue();
        assert.equal(await claim(), undefined);
        await service();
        assert.equal(
          (
            await scalar<string[]>("select manual_mail_ready_accounts() v")
          ).includes(accounts[0]),
          false,
        );
        await owner();
        await db.query("update outbox set available_at=now() where id=$1", [
          first,
        ]);
        assert.equal((await claim()).id, first);
      },
    );
    await t.test(
      "rollback restores exact old claim, preserves rows, and reinstall succeeds",
      async () => {
        await owner();
        const n = await scalar<number>("select count(*)::int v from outbox");
        await db.exec(rollback);
        assert.equal(
          await scalar<string>(
            "select md5(prosrc) v from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure",
          ),
          before,
        );
        assert.equal(
          await scalar<number>("select count(*)::int v from outbox"),
          n,
        );
        await db.exec(install);
      },
    );
  } finally {
    await db.close();
  }
});
