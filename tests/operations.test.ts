import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "./feature-database";
import { demoOperationalDashboard } from "../src/lib/operations";
import type { OperationalData } from "../src/lib/operations";
import { demoWorkspace } from "../src/lib/demo";
test("operational counts represent clients once, even with multiple overdue tasks", () => {
  const data = demoWorkspace();
  const o = data.opportunities[0];
  data.tasks = [
    {
      id: "1",
      opportunity_id: o.id,
      owner_id: o.seller_id,
      title: "First",
      due_at: "2020-01-01",
      status: "open",
      area: "seller",
    },
    {
      id: "2",
      opportunity_id: o.id,
      owner_id: o.seller_id,
      title: "Second",
      due_at: "2020-01-02",
      status: "open",
      area: "seller",
    },
  ];
  const dashboard = demoOperationalDashboard(data, [o]);
  assert.equal(dashboard.counts.overdue, 1);
  assert.equal(dashboard.rows[0].overdue_tasks, 2);
  assert.equal(dashboard.counts.attention, 1);
});
test("dashboard paginates after priorities and permissions, keeps global counts and configurable deadlines", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const account = randomUUID(),
      caseId = randomUUID(),
      contact = randomUUID();
    await db.query(
      "insert into mail_accounts(id,email,organization,status,daily_limit,timezone) values($1,'dashboard@team.test','Test','connected',100,'UTC')",
      [account],
    );
    await db.query(
      "insert into contacts(id,email,verification) values($1,'dashboard@fictional.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id,next_action,next_action_at) values($1,$2,'Urgent customer',$3,'Call client',now()-interval '1 hour')",
      [caseId, contact, users.seller],
    );
    for (let i = 0; i < 2; i++) {
      const conversation = randomUUID();
      await db.query(
        "insert into conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area,needs_attention) values($1,$2,$3,$4,'Fictional reply','seller',true)",
        [conversation, caseId, account, `dashboard-${i}`],
      );
      await db.query(
        "insert into messages(gmail_message_id,conversation_id,direction,sender,body,sent_at,status) values(gen_random_uuid()::text,$1,'inbound','dashboard@fictional.test','Test',now()-interval '30 hours','received')",
        [conversation],
      );
      await db.query(
        "insert into tasks(opportunity_id,owner_id,title,due_at,area) values($1,$2,'Call',now()-interval '1 hour','seller')",
        [caseId, users.seller],
      );
    }
    await db.query(
      "with c as (insert into contacts(email,verification) select 'dash-'||i||'@fictional.test','valid' from generate_series(1,60) i returning id) insert into opportunities(contact_id,company,seller_id,next_action,next_action_at) select id,'Scheduled client',$1,'Follow up',now()+interval '1 month' from c",
      [users.seller],
    );
    const foreign = randomUUID(),
      foreignContact = randomUUID();
    await db.query(
      "insert into contacts(id,email,verification) values($1,'private@fictional.test','valid')",
      [foreignContact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Private customer',$3)",
      [foreign, foreignContact, users.outsider],
    );
    await db.query(
      "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true)",
      [account, users.seller],
    );
    const get = async (filter = "all", offset = 0) =>
      (
        await db.query<{ result: OperationalData }>(
          "select operational_dashboard('',null,null,null,null,$1,$2) result",
          [filter, offset],
        )
      ).rows[0].result;
    await asUser(users.seller, "aal1");
    await assert.rejects(get(), /MFA/);
    await asUser(users.seller);
    const first = await get();
    assert.equal(first.counts.active, 61);
    assert.equal(first.counts.reply, 1);
    assert.equal(first.counts.attention, 1);
    assert.equal(first.rows.length, 50);
    assert.equal(first.rows[0].id, caseId);
    assert.equal(first.rows[0].reply_count, 2);
    assert.equal(first.rows[0].overdue_tasks, 2);
    assert(!first.rows.some((r) => r.id === foreign));
    assert(first.rows.slice(1).every((r) => r.needs_attention === false));
    const second = await get("all", 50);
    assert.equal(second.rows.length, 11);
    assert.equal(second.counts.reply, 1);
    assert.equal((await get("reply")).total, 1);
    await asUser(users.outsider);
    assert.equal((await get()).counts.active, 1);
    await assert.rejects(
      db.query("select save_operational_settings($1,$2)", [
        {
          reply_hours: 12,
          followup_hours: 72,
          offer_warning_hours: 24,
          expected_version: 1,
        },
        randomUUID(),
      ]),
      /Superadmin/,
    );
    await asUser(users.admin);
    const payload = {
        reply_hours: 12,
        followup_hours: 72,
        offer_warning_hours: 24,
        expected_version: 1,
      },
      key = randomUUID();
    await db.query("select save_operational_settings($1,$2)", [payload, key]);
    await db.query("select save_operational_settings($1,$2)", [payload, key]);
    await assert.rejects(
      db.query("select save_operational_settings($1,$2)", [
        payload,
        randomUUID(),
      ]),
      /changed/,
    );
    const updated = await get("reply");
    assert.equal(updated.settings.version, 2);
    assert.equal(
      Date.parse(updated.rows[0].reply_due_at!) -
        Date.parse(updated.rows[0].reply_since!),
      12 * 3600000,
    );
    // Latest outbound mail clears a legacy pending-reply signal.
    await db.exec("reset role");
    await db.query(
      "insert into messages(gmail_message_id,conversation_id,direction,sender,body,sent_at,status) select gen_random_uuid()::text,id,'outbound','dashboard@team.test','Replied',now(),'sent' from conversations where opportunity_id=$1",
      [caseId],
    );
    await asUser(users.seller);
    assert.equal((await get()).counts.reply, 0);
    await db.exec("reset role");
    const lenderCase = randomUUID(),
      lenderContact = randomUUID(),
      conversation = randomUUID(),
      archive = randomUUID();
    await db.query(
      "insert into contacts(id,email,verification) values($1,'negotiation@fictional.test','valid')",
      [lenderContact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id,closer_id,handed_off_at,stage) values($1,$2,'Negotiating client',$3,$4,now()-interval '1 day','negotiation')",
      [lenderCase, lenderContact, users.seller, users.closer],
    );
    const lender = (
      await db.query<{ id: string }>(
        "select id from lenders where archived_at is null limit 1",
      )
    ).rows[0].id;
    const submission = (
      await db.query<{ id: string }>(
        "insert into submissions(opportunity_id,lender_id,closer_id,status,channel,next_action,next_action_at) values($1,$2,$3,'reviewing','email','Request lender update',now()+interval '1 day') returning id",
        [lenderCase, lender, users.closer],
      )
    ).rows[0].id;
    await db.query(
      "insert into conversations(id,opportunity_id,submission_id,account_id,gmail_thread_id,subject,area) values($1,$2,$3,$4,'wait-thread','Fictional lender','closer')",
      [conversation, lenderCase, submission, account],
    );
    await db.query(
      "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,subject,sent_at,direction,nature,participants,encrypted_payload) values($1,$2,'wait-message','wait-thread','Fictional lender',now()-interval '6 days','outbound','personal','[]','fixture')",
      [archive, account],
    );
    await db.query(
      "insert into mail_waits(opportunity_id,conversation_id,area,waiting_for,since_at,source_message_id,draft) values($1,$2,'closer','lender',now()-interval '6 days',$3,'Follow up')",
      [lenderCase, conversation, archive],
    );
    await db.query(
      "insert into offers(submission_id,opportunity_id,product,amount,expires_at) values($1,$2,'MCA',10000,now()+interval '12 hours')",
      [submission, lenderCase],
    );
    await asUser(users.closer);
    const negotiating = await get("lender");
    assert.equal(negotiating.total, 1);
    assert.equal(negotiating.counts.negotiation, 1);
    assert.equal(negotiating.counts.offers, 1);
    assert.equal(negotiating.rows[0].waiting_for, "lender");
    assert.equal(negotiating.rows[0].overdue, true);
    assert.equal(negotiating.rows[0].owner_id, users.closer);
    assert.equal(negotiating.rows[0].lenders[0].id, lender);
    await asUser(users.seller);
    assert.equal(
      (await db.query<{result:OperationalData}>("select operational_dashboard('Negotiating client') result")).rows[0].result.rows[0]?.lenders.length,
      0,
      "seller does not receive closer negotiation details",
    );
  } finally {
    await db.close();
  }
});
