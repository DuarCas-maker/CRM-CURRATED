import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";
import type { CampaignReadiness } from "../src/lib/campaign-center";

test("readiness shares enrollment rules, distinguishes preparation, and keeps totals across pages/search", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const account = randomUUID();
    await db.query(
      "insert into mail_accounts(id,email,organization,status) values($1,'sender@team.test','Test','connected')",
      [account],
    );
    const contacts: string[] = [];
    for (let i = 0; i < 57; i++) {
      const id = randomUUID();
      contacts.push(id);
      await db.query(
        "insert into contacts(id,email,name,verification) values($1,$2,'Test','valid')",
        [id, `lead${String(i).padStart(2, "0")}@example.test`],
      );
      await db.query(
        "insert into leads(contact_id,company,seller_id) values($1,'Prepared company',$2)",
        [id, users.seller],
      );
    }
    const pending = randomUUID();
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,'pending@example.test','Pending','pending')",
      [pending],
    );
    await db.query(
      "insert into leads(contact_id,company,seller_id) values($1,'Pending company',$2)",
      [pending, users.seller],
    );
    await db.query(
      "insert into suppressions(email,reason) values('lead00@example.test','unsubscribe')",
    );
    await db.query(
      "update opportunities set stage='analysis' where contact_id=$1",
      [contacts[1]],
    );
    await asUser(users.admin);
    const page = async (filter = "eligible", search = "", number = 0) =>
      (
        await db.query<{ p: CampaignReadiness }>(
          "select campaign_readiness_page($1,$2,$3) p",
          [search, filter, number],
        )
      ).rows[0].p;
    const first = await page(),
      second = await page("eligible", "", 1);
    assert.equal(first.summary.total, 58);
    assert.equal(first.summary.preparing, 1);
    assert.equal(first.summary.converted, 57);
    assert.equal(first.summary.eligible, 55);
    assert.equal(first.summary.excluded, 3);
    assert.equal(first.rows.length, 50);
    assert.equal(second.rows.length, 5);
    assert.equal(second.total, 55);
    const eligible = (
      await db.query<{ contact_id: string }>(
        "select contact_id from first_contact_candidates('','',$1)",
        [account],
      )
    ).rows;
    const actual = new Set(
      [...first.rows, ...second.rows].map((r) => r.contact_id),
    );
    // The enrollment function returns exclusions too; compare only eligible rows.
    const enrollment = (
      await db.query<{ contact_id: string }>(
        "select contact_id from first_contact_candidates('','',$1) where reason='eligible'",
        [account],
      )
    ).rows;
    assert.equal(eligible.length, 58);
    assert.deepEqual(actual, new Set(enrollment.map((r) => r.contact_id)));
    const searched = await page("all", "Pending company");
    assert.equal(searched.total, 1);
    assert.equal(searched.summary.total, 58);
    assert.deepEqual(searched.summary.reasons, {
      unverified: 1,
      suppressed: 1,
      advanced_case: 1,
    });
    await asUser(users.seller);
    assert.equal((await page()).total, 55);
    await assert.rejects(
      db.query("select * from campaign_prepared_leads('','',null)"),
      /permission denied/,
    );
    await asUser(users.outsider);
    assert.equal((await page("all")).total, 0);
    await asUser(users.closer);
    await assert.rejects(page(), /Seller access/);
    await asUser(users.admin, "aal1");
    await assert.rejects(page(), /MFA/);
    await asUser(users.admin);
    await assert.rejects(page("invalid"), /Invalid readiness/);
    await db.exec("reset role");
    await db.exec(
      await readFile("supabase/rollbacks/045_campaign_readiness.sql", "utf8"),
    );
    await asUser(users.admin);
    assert.equal(
      (
        await db.query(
          "select * from first_contact_candidates('','',$1) where reason='eligible'",
          [account],
        )
      ).rows.length,
      55,
    );
    await assert.rejects(page(), /does not exist/);
  } finally {
    await db.close();
  }
});

test("readiness counts unique confirmed initial contacts, excluding tests, followups, errors and uncertain sends", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const account = randomUUID(),
      campaign = randomUUID();
    await db.query(
      "insert into mail_accounts(id,email,organization,status) values($1,'sender@team.test','Test','connected')",
      [account],
    );
    await db.query(
      "insert into campaigns(id,name,account_id,seller_id,created_by,subject,body,daily_limit,timezone,start_hour,end_hour) values($1,'Historical',$2,$3,$4,'Test','Test',80,'UTC',0,24)",
      [campaign, account, users.seller, users.admin],
    );
    for (const [i, status, step, isTest] of [
      [0, "sent", 0, false],
      [1, "sent", 1, false],
      [2, "uncertain", 0, false],
      [3, "failed", 0, false],
      [4, "sent", 0, true],
      [5, "sent", 0, false],
    ] as const) {
      const contact = randomUUID(),
        enrollment = randomUUID(),
        outbox = randomUUID();
      await db.query(
        "insert into contacts(id,email,name,verification) values($1,$2,'Test','valid')",
        [contact, `state${i}@example.test`],
      );
      await db.query(
        "insert into leads(contact_id,company,seller_id) values($1,'Company',$2)",
        [contact, users.seller],
      );
      const opportunity = (
        await db.query<{ opportunity_id: string }>(
          "select opportunity_id from leads where contact_id=$1",
          [contact],
        )
      ).rows[0].opportunity_id;
      await db.query(
        "insert into campaign_enrollments(id,campaign_id,contact_id,opportunity_id,status) values($1,$2,$3,$4,'active')",
        [enrollment, campaign, contact, opportunity],
      );
      await db.query(
        "insert into outbox(id,account_id,opportunity_id,enrollment_id,to_email,subject,body,area,message_id_header,request_key,status,campaign_test,gmail_message_id,sent_at) values($1,$2,$3,$4,$5,'Test','Test','seller',$6,$7,$8,$9,$10,$11)",
        [
          outbox,
          account,
          opportunity,
          enrollment,
          `state${i}@example.test`,
          `<${enrollment}.${step}@crm.curated.local>`,
          `campaign:${enrollment}:${step}`,
          status,
          isTest,
          status === "sent" ? "gmail-id" : null,
          status === "sent" && i !== 5 ? new Date().toISOString() : null,
        ],
      );
    }
    await asUser(users.admin);
    const value = (
      await db.query<{ p: CampaignReadiness }>(
        "select campaign_readiness_page('','all',0) p",
      )
    ).rows[0].p;
    assert.equal(value.summary.sent, 1);
    assert.equal(value.summary.reserved, 5);
    assert.equal(value.summary.eligible, 0);
    assert.equal(value.summary.excluded, 0);
    assert.equal(value.rows.filter((r) => r.sent).length, 1);
    assert.equal(value.rows.filter((r) => r.reserved).length, 5);
    assert.deepEqual(value.summary.reasons, {});
  } finally {
    await db.close();
  }
});
