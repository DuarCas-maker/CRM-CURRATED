import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { featureDatabase } from "./feature-database";
import {
  countLeadTabs,
  verificationProgress,
  verificationBatchStatus,
  type LeadPreparationOverview,
  type VerificationBatch,
} from "../src/lib/lead-preparation";
import {
  LeadDate,
  LeadVerifications,
} from "../src/components/lead-preparation-tracking";
import { demoWorkspace } from "../src/lib/demo";

test("verification progress uses finished results; errors stay visible and never complete a request", () => {
  const batch: VerificationBatch = {
    id: "request",
    started_at: "2026-10-20T14:00:00Z",
    completed_at: null,
    total: 4,
    completed: 1,
    pending: 1,
    errors: 1,
    review: 1,
    valid: 1,
    invalid: 0,
    uncertain: 0,
  };
  assert.equal(verificationProgress(batch), 25);
  assert.equal(verificationBatchStatus(batch), "review");
  const html = renderToStaticMarkup(
    createElement(LeadVerifications, {
      batches: [batch],
      locale: "es",
      loading: false,
      refresh() {},
    }),
  );
  assert.match(html, /aria-valuenow="1"/);
  assert.match(html, /aria-valuemax="4"/);
  assert.match(html, /25%/);
  assert.match(html, /1 errores técnicos/);
  assert.match(html, /Requiere revisión/);
  assert.equal(
    verificationBatchStatus({
      ...batch,
      completed: 4,
      errors: 0,
      review: 0,
      pending: 0,
    }),
    "completed",
  );
  assert.equal(
    verificationBatchStatus({
      ...batch,
      completed: 0,
      errors: 0,
      review: 0,
      pending: 4,
    }),
    "running",
  );
  assert.equal(verificationProgress({ ...batch, total: 0, completed: 0 }), 0);
  const demo = demoWorkspace();
  const counts = countLeadTabs(demo.leads);
  assert.equal(
    counts.preparing + counts.converted + counts.risk,
    demo.leads.length,
  );
});

test("lead dates show the year and missing history is explicit", () => {
  const html = renderToStaticMarkup(
    createElement(LeadDate, { value: "2026-10-20T01:00:00Z", locale: "es" }),
  );
  assert.match(html, /2026/);
  assert.match(html, /19/); // Bogotá date, rather than the UTC day.
  assert.match(
    renderToStaticMarkup(createElement(LeadDate, { locale: "es" })),
    /Sin registro/,
  );
});

test("tracking aggregates whole inboxes, retains promoted leads in requests, paginates, and obeys seller RLS", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const request = randomUUID();
    const contacts: string[] = [];
    for (const [index, verification, state] of [
      [0, "valid", "completed"],
      [1, "pending", "queued"],
      [2, "uncertain", "technical_error"],
      [3, "pending", "uncertain_request"],
    ] as const) {
      const contact = randomUUID();
      contacts.push(contact);
      await db.query(
        "insert into contacts(id,email,name,verification) values($1,$2,'Tracking contact',$3)",
        [contact, `tracking${index}@fictional.test`, verification],
      );
      await db.query(
        "insert into leads(contact_id,company,seller_id,created_at) values($1,'Tracking fixture',$2,'2026-10-01')",
        [contact, users.seller],
      );
      await db.query(
        "insert into verifications(contact_id,request_key,result,state,created_at,verified_at) values($1,$2,$3,$4,'2026-10-02',case when $4='completed' then '2026-10-03'::timestamptz end)",
        [contact, `${request}:${contact}`, verification, state],
      );
    }
    await db.query(
      "insert into contacts(id,email,verification) select gen_random_uuid(),'page'||n||'@fictional.test','pending' from generate_series(1,101) n",
    );
    await db.query(
      "insert into leads(contact_id,company,seller_id) select id,'Page fixture',$1 from contacts where email like 'page%@fictional.test'",
      [users.seller],
    );
    const foreign = randomUUID();
    await db.query(
      "insert into contacts(id,email) values($1,'outsider@fictional.test')",
      [foreign],
    );
    await db.query(
      "insert into leads(contact_id,company,seller_id) values($1,'Other fixture',$2)",
      [foreign, users.outsider],
    );
    await db.query(
      "insert into verifications(contact_id,request_key,result) values($1,$2,'pending')",
      [foreign, randomUUID()],
    );
    const overview = async (
      search = "",
      owner: string | null = null,
      offset = 0,
      since: string | null = null,
      verification: string | null = null,
    ) =>
      (
        await db.query<{ result: LeadPreparationOverview }>(
          "select lead_preparation_overview($1,$2,$3,$4,$5) result",
          [search, owner, since, verification, offset],
        )
      ).rows[0].result;
    await asUser(users.seller);
    const all = await overview();
    assert.deepEqual(all.counts, { preparing: 103, converted: 1, risk: 1 });
    assert.equal(all.verification_total, 1);
    const batch = all.verifications[0];
    assert.deepEqual(
      [batch.total, batch.completed, batch.pending, batch.errors, batch.review],
      [4, 1, 1, 1, 1],
    );
    assert.equal(batch.completed_at, null);
    assert.equal((await overview("Tracking")).counts.preparing, 2);
    assert.equal((await overview("", users.outsider)).verification_total, 0);
    assert.equal(
      (await overview("", null, 0, "2026-10-04")).verification_total,
      0,
    );
    assert.equal(
      (await overview("", null, 0, null, "uncertain")).counts.risk,
      1,
    );
    const row = (
      await db.query<{
        analysis_started_at: string;
        campaign_enrolled: boolean;
      }>("select * from lead_workspace where contact_id=$1", [contacts[0]])
    ).rows[0];
    assert.match(new Date(row.analysis_started_at).toISOString(), /2026-10-02/);
    assert.equal(row.campaign_enrolled, false);
    await db.exec("reset role");
    const account = randomUUID(),
      campaign = randomUUID(),
      enrollment = randomUUID(),
      mail = randomUUID();
    const opportunity = (
      await db.query<{ opportunity_id: string }>(
        "select opportunity_id from leads where contact_id=$1",
        [contacts[0]],
      )
    ).rows[0].opportunity_id;
    await db.query(
      "insert into mail_accounts(id,email,organization) values($1,'tracking@team.test','Fixture')",
      [account],
    );
    await db.query(
      "insert into campaigns(id,name,account_id,seller_id,created_by,daily_limit,timezone,start_hour,end_hour,subject,body) values($1,'Fixture',$2,$3,$3,100,'UTC',0,24,'Hello','Fixture')",
      [campaign, account, users.seller],
    );
    await db.query(
      "insert into campaign_enrollments(id,campaign_id,contact_id,opportunity_id) values($1,$2,$3,$4)",
      [enrollment, campaign, contacts[0], opportunity],
    );
    await db.query(
      "insert into outbox(id,account_id,opportunity_id,enrollment_id,to_email,subject,body,area,message_id_header,request_key,status,campaign_test,sent_at) values($1,$2,$3,$4,'tracking0@fictional.test','Fixture','Fixture','seller',$5,$5,'sent',true,now())",
      [mail, account, opportunity, enrollment, randomUUID()],
    );
    const flags = async () =>
      (
        await db.query<{ campaign_enrolled: boolean; campaign_sent: boolean }>(
          "select campaign_enrolled,campaign_sent from lead_workspace where contact_id=$1",
          [contacts[0]],
        )
      ).rows[0];
    await asUser(users.seller);
    assert.deepEqual(await flags(), {
      campaign_enrolled: true,
      campaign_sent: false,
    });
    assert.equal((await db.query("select * from outbox")).rows.length, 0); // No broader outbox access.
    await db.exec("reset role");
    await db.query("update outbox set campaign_test=false where id=$1", [mail]);
    await asUser(users.seller);
    assert.deepEqual(await flags(), {
      campaign_enrolled: true,
      campaign_sent: true,
    });
    assert.equal(
      (await db.query("select * from lead_campaign_tracking($1)", [foreign]))
        .rows.length,
      0,
    );
    await asUser(users.closer);
    assert.deepEqual((await overview()).counts, {
      preparing: 0,
      converted: 0,
      risk: 0,
    });
    await db.exec("reset role");
    // Separate completed retry receipts remain separate, even for the same contact.
    for (let i = 0; i < 52; i++)
      await db.query(
        "insert into verifications(contact_id,request_key,result,state,created_at,verified_at) values($1,$2,'valid','completed',now(),now())",
        [contacts[0], `${randomUUID()}:${contacts[0]}`],
      );
    await asUser(users.seller);
    assert.equal((await overview()).verification_total, 53);
    assert.equal((await overview()).verifications.length, 50);
    assert.equal((await overview("", null, 50)).verifications.length, 3);
    await asUser(users.admin);
    assert.equal((await overview()).verification_total, 54);
  } finally {
    await db.close();
  }
});
