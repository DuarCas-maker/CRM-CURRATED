import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  featureDatabase,
  installBrandDelivery,
  bindFixtureAccount,
  queueFixtureMail,
} from "./fixtures/pipeline-os-s02-brand-delivery";
test("B2 cut boundary: revocation, one admission, quotas and reconciliation", async (t) => {
  const f = await featureDatabase(),
    { db, users, asUser } = f;
  const account = randomUUID(),
    caseId = randomUUID(),
    contact = randomUUID();
  const owner = () => db.exec("reset role");
  const service = async () => {
    await owner();
    await db.exec(
      'set request.jwt.claims=\'{"role":"service_role"}\';set role service_role',
    );
  };
  const row = async (sql: string, p: unknown[] = []) =>
    (await db.query<Record<string, unknown>>(sql, p)).rows[0];
  try {
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,'client@cut.test','Fixture','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fixture',$3)",
      [caseId, contact, users.seller],
    );
    await db.query(
      "insert into mail_accounts(id,email,organization) values($1,'sender@cut.test','fixture')",
      [account],
    );
    await installBrandDelivery(f);
    const preparation = await bindFixtureAccount(f, account);
    const fresh = async () => {
      await owner();
      await db.exec(
        "update outbox set status='cancelled',sending_at=null where status in ('queued','sending');update outbox set sending_at=now()-interval '2 minutes' where sending_at is not null",
      );
      return queueFixtureMail(f, account, users.seller, caseId, preparation);
    };
    const claim = async () => {
      await service();
      return (
        await db.query<Record<string, unknown>>("select * from claim_outbox()")
      ).rows[0];
    };
    const admit = async (m: Record<string, unknown>) => {
      await service();
      return (
        await row("select admit_brand_dispatch($1,$2) id", [
          m.id,
          m.brand_claim_token,
        ])
      ).id;
    };
    await t.test(
      "revocation before claim pauses instead of consuming an admission",
      async () => {
        const id = await fresh();
        await owner();
        await db.query(
          "update mail_permissions set can_send=false where account_id=$1",
          [account],
        );
        assert.equal(await claim(), undefined);
        await owner();
        assert.equal(
          (await row("select status from outbox where id=$1", [id])).status,
          "paused",
        );
        assert.equal(
          (
            await row(
              "select count(*) n from mail_brand_dispatch_admissions where outbox_id=$1",
              [id],
            )
          ).n,
          0,
        );
        await db.query(
          "update mail_permissions set can_send=true where account_id=$1",
          [account],
        );
      },
    );
    await t.test(
      "revocation at the barrier after claim and before cut gives no permit",
      async () => {
        await fresh();
        const m = await claim();
        assert.ok(m);
        await owner();
        await db.query("update profiles set active=false where id=$1", [
          users.seller,
        ]);
        assert.equal(await admit(m), null);
        await owner();
        assert.equal(
          (await row("select status from outbox where id=$1", [m.id])).status,
          "paused",
        );
        await db.query("update profiles set active=true where id=$1", [
          users.seller,
        ]);
      },
    );
    await t.test(
      "wrong claim token cannot admit; a claim supports exactly one permit",
      async () => {
        await fresh();
        const m = await claim();
        await service();
        assert.equal(
          (
            await row("select admit_brand_dispatch($1,$2) id", [
              m.id,
              randomUUID(),
            ])
          ).id,
          null,
        );
        const permit = await admit(m);
        assert.ok(permit);
        assert.equal(await admit(m), null);
        await owner();
        assert.equal(
          (
            await row(
              "select count(*) n from mail_brand_dispatch_admissions where outbox_id=$1",
              [m.id],
            )
          ).n,
          1,
        );
      },
    );
    await t.test(
      "expiry/crash never frees a second POST, even if no response was recorded",
      async () => {
        await fresh();
        const m = await claim();
        const permit = await admit(m);
        await owner();
        await db.query(
          "update mail_brand_dispatch_admissions set admitted_at=now()-interval '10 minutes',deadline=now()-interval '5 minutes' where id=$1",
          [permit],
        );
        assert.equal(await admit(m), null);
        await service();
        await assert.rejects(
          db.query("update outbox set status='queued' where id=$1", [m.id]),
          /BRAND_RECONCILIATION_REQUIRED/,
        );
        await db.query("select brand_dispatch_uncertain($1,$2)", [
          m.id,
          permit,
        ]);
        assert.equal(await admit(m), null);
      },
    );
    await t.test(
      "known quota retains backoff and allows only a new revalidated claim/admission",
      async () => {
        await fresh();
        const m = await claim(),
          first = await admit(m);
        await service();
        await db.query(
          "select defer_gmail_send($1,60,'GMAIL_HTTP_429_rateLimitExceeded')",
          [m.id],
        );
        await owner();
        assert.equal(
          (
            await row(
              "select outcome from mail_brand_dispatch_admissions where id=$1",
              [first],
            )
          ).outcome,
          "known_quota",
        );
        assert.equal(
          (await row("select status from outbox where id=$1", [m.id])).status,
          "queued",
        );
        await db.query(
          "update mail_accounts set send_retry_at=now()-interval '1 second' where id=$1",
          [account],
        );
        await db.query(
          "update outbox set available_at=now()-interval '1 second' where id=$1",
          [m.id],
        );
        const again = await claim();
        assert.ok(again);
        assert.notEqual(again.brand_claim_token, m.brand_claim_token);
        const second = await admit(again);
        assert.ok(second);
        assert.notEqual(second, first);
      },
    );
    await t.test(
      "revocation after admission does not falsify the admitted attempt or historical label",
      async () => {
        await fresh();
        const m = await claim(),
          permit = await admit(m);
        assert.ok(permit);
        await asUser(users.admin);
        await f.command("brand_membership_set", {
          brand_id: preparation.brand_id,
          user_id: users.seller,
          active: false,
          expected_revision: 1,
        });
        await service();
        await db.query(
          "select mark_sent($1,'gmail-fixture','thread-fixture')",
          [m.id],
        );
        await owner();
        assert.equal(
          (await row("select status from outbox where id=$1", [m.id])).status,
          "sent",
        );
        assert.equal(
          (
            await row(
              "select outcome from mail_brand_dispatch_admissions where id=$1",
              [permit],
            )
          ).outcome,
          "accepted",
        );
        const history = await row(
          "select id,conversation_id,brand_snapshot,brand_provenance from messages where internet_message_id=$1",
          [m.message_id_header],
        );
        assert.equal(history.brand_provenance, "dispatch_snapshot");
        assert.deepEqual(Object.keys(history.brand_snapshot as object).sort(), [
          "brand_code",
          "brand_id",
          "brand_name",
        ]);
        const other = randomUUID();
        await db.query(
          "insert into mail_accounts(id,email,organization) values($1,'other@cut.test','fixture')",
          [other],
        );
        const otherPrep = await bindFixtureAccount(f, other);
        await assert.rejects(
          queueFixtureMail(f, other, users.admin, caseId, otherPrep, {
            conversation: history.conversation_id,
            reply_message: history.id,
          }),
          /BRAND_REPLY_MISMATCH/,
        );
        await asUser(users.admin);
        await f.command("brand_membership_set", {
          brand_id: preparation.brand_id,
          user_id: users.seller,
          active: true,
          expected_revision: 2,
        });
      },
    );
    await t.test(
      "a membership restored after queue does not refresh the original snapshot",
      async () => {
        const id = await fresh();
        await asUser(users.admin);
        await f.command("brand_membership_set", {
          brand_id: preparation.brand_id,
          user_id: users.seller,
          active: false,
          expected_revision: 3,
        });
        await f.command("brand_membership_set", {
          brand_id: preparation.brand_id,
          user_id: users.seller,
          active: true,
          expected_revision: 4,
        });
        assert.equal(await claim(), undefined);
        await owner();
        assert.equal(
          (await row("select status from outbox where id=$1", [id])).status,
          "paused",
        );
      },
    );
    await t.test(
      "case handoff before cut cannot extend seller access to closer content",
      async () => {
        await fresh();
        const m = await claim();
        await owner();
        await db.query(
          "update opportunities set handed_off_at=now(),closer_id=$1 where id=$2",
          [users.closer, caseId],
        );
        assert.equal(await admit(m), null);
        await owner();
        await db.query(
          "update opportunities set handed_off_at=null,closer_id=null where id=$1",
          [caseId],
        );
      },
    );
    await t.test(
      "deleting and regranting a technical permission does not rejuvenate queued authorization",
      async () => {
        const id = await fresh();
        await owner();
        const before = await row(
          "select authorization_revision r from mail_permissions where account_id=$1 and user_id=$2",
          [account, users.seller],
        );
        await db.query(
          "delete from mail_permissions where account_id=$1 and user_id=$2",
          [account, users.seller],
        );
        await db.query(
          "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true) on conflict(account_id,user_id) do update set can_send=true",
          [account, users.seller],
        );
        assert.ok(
          Number(
            (
              await row(
                "select authorization_revision r from mail_permissions where account_id=$1 and user_id=$2",
                [account, users.seller],
              )
            ).r,
          ) > Number(before.r),
        );
        assert.equal(await claim(), undefined);
        await owner();
        assert.equal(
          (await row("select status from outbox where id=$1", [id])).status,
          "paused",
        );
      },
    );
    await t.test(
      "notification claim/admission checks the real recipient and preferences again at cut",
      async () => {
        await owner();
        await db.exec(
          "update outbox set status='cancelled',sending_at=null where status in ('queued','sending')",
        );
        await db.query(
          "insert into notification_preferences(user_id,email) values($1,true) on conflict(user_id) do update set email=true",
          [users.seller],
        );
        const queue = async () => {
          await owner();
          const n = randomUUID();
          await db.query(
            "insert into notifications(id,user_id,title,body,event_key) values($1::uuid,$2,'Update','Open app','fixture:'||$1::text)",
            [n, users.seller],
          );
          await service();
          return (
            await row(
              "select queue_brand_notification($1,$2,'https://crm.fixture.test') id",
              [n, account],
            )
          ).id;
        };
        const id = await queue();
        await service();
        const m = (
          await db.query<Record<string, unknown>>(
            "select * from claim_notification_outbox()",
          )
        ).rows[0];
        assert.equal(m?.id, id);
        assert.equal(m.requested_by, null);
        assert.ok(await admit(m));
        await owner();
        await db.query(
          "select mark_sent($1,'notification-fixture','notification-thread')",
          [id],
        );
        await db.query(
          "update outbox set sending_at=now()-interval '2 minutes' where id=$1",
          [id],
        );
        const denied = await queue();
        await service();
        const next = (
          await db.query<Record<string, unknown>>(
            "select * from claim_notification_outbox()",
          )
        ).rows[0];
        assert.equal(next?.id, denied);
        await owner();
        await db.query(
          "update notification_preferences set email=false where user_id=$1",
          [users.seller],
        );
        assert.equal(await admit(next), null);
        await owner();
        assert.equal(
          (await row("select status from outbox where id=$1", [denied])).status,
          "paused",
        );
      },
    );
    await t.test(
      "no raw helper or old boolean endpoint is a reusable send authorization",
      async () => {
        await service();
        assert.equal(
          (
            await row("select recheck_outbox_delivery($1) allowed", [
              randomUUID(),
            ])
          ).allowed,
          false,
        );
        await assert.rejects(
          db.exec("select * from claim_notification_outbox_v15()"),
          /permission denied/,
        );
        await assert.rejects(
          db.exec("select * from mail_brand_dispatch_admissions"),
          /permission denied/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
