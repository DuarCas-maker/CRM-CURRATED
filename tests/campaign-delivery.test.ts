import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "./feature-database";
import {
  renderCampaignContent,
  missingCampaignFields,
} from "../src/lib/campaign-content";

test("formatted campaigns escape contact data and raw HTML, validate links, and retain a plain alternative", () => {
  const values = {
    name: "<img src=x onerror=alert(1)> **injected**",
    unsubscribe_url: "https://crm.test/unsubscribe/token",
  };
  const result = renderCampaignContent(
    "**Hola {{name}}**\n- Una opción\n[Baja]({{unsubscribe_url}})\n<script>alert(1)</script>",
    values,
    "markdown",
  );
  assert.match(result.html, /<strong>Hola &lt;img/);
  assert(!result.html.includes("<script>"));
  assert(!result.html.includes("<img"));
  assert(result.html.includes("**injected**"));
  assert(result.html.includes('<a href="https://crm.test/unsubscribe/token"'));
  assert(result.text.includes("Baja (https://crm.test/unsubscribe/token)"));
  assert.throws(
    () => renderCampaignContent("[x](javascript:alert)", {}, "markdown"),
    /https/,
  );
  assert.throws(
    () =>
      renderCampaignContent(
        "[x]({{url}})",
        { url: "javascript:alert" },
        "markdown",
      ),
    /https/,
  );
  assert.deepEqual(
    missingCampaignFields("{{name}}", "{{phone}}", { name: "Alex", phone: "" }),
    ["phone"],
  );
});

async function setup() {
  const fixture = await featureDatabase();
  const { db, users, asUser, command } = fixture;
  const account = randomUUID();
  await db.query(
    "insert into mail_accounts(id,email,organization,status,daily_limit,campaign_daily_limit,operational_reserve,external_usage_synced_at) values($1,'sender@team.test','Test','connected',120,100,20,now())",
    [account],
  );
  async function contact(name = "Alex", phone = "555", verification = "valid") {
    const id = randomUUID(),
      opportunity = randomUUID();
    await db.exec("reset role");
    await db.query(
      "insert into contacts(id,email,name,phone,verification) values($1,$2,$3,$4,$5)",
      [id, `${id}@client.test`, name, phone, verification],
    );
    if (verification === "valid")
      await db.query(
        "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Client company',$3)",
        [opportunity, id, users.seller],
      );
    return { id, opportunity };
  }
  async function campaign(body = "Hi {{name}} {{unsubscribe_url}}") {
    await asUser(users.admin);
    return (
      await command("create_campaign", {
        name: "Campaign",
        account_id: account,
        seller_id: users.seller,
        daily_limit: 100,
        timezone: "UTC",
        start_hour: 0,
        end_hour: 24,
        subject: "Hello {{company}}",
        body,
        steps: [],
      })
    ).id;
  }
  async function queued(
    campaignId: string,
    contactId: string,
    opportunity: string,
  ) {
    await db.exec("reset role");
    const enrollment = (
      await db.query<{ id: string }>(
        "select id from campaign_enrollments where campaign_id=$1 and contact_id=$2",
        [campaignId, contactId],
      )
    ).rows[0].id;
    const id = randomUUID();
    await db.query(
      "insert into outbox(id,account_id,opportunity_id,enrollment_id,to_email,subject,body,area,message_id_header,requested_by,request_key) values($1,$2,$3,$4,$5,'Hello','Hi','seller',$6,$7,$1::uuid::text)",
      [
        id,
        account,
        opportunity,
        enrollment,
        `${contactId}@client.test`,
        `<${id}@test>`,
        users.admin,
      ],
    );
    return id;
  }
  return { ...fixture, account, contact, campaign, queued };
}

test("system templates are authoritative, versions and archives are durable, and test sends don't alter the client", async () => {
  const f = await setup();
  const { db, users, asUser, command, account } = f;
  try {
    const lead = await f.contact();
    await asUser(users.admin);
    const payload = {
      name: "Pitch",
      subject: "{{company}}",
      body: "**Hi {{name}}** {{unsubscribe_url}}",
      body_format: "markdown",
      steps: [],
      asset_ids: [],
    };
    const saved = (
      await db.query<{ id: string }>(
        "select save_campaign_template($1,$2) id",
        [payload, randomUUID()],
      )
    ).rows[0].id;
    const input = {
      name: "Campaign",
      account_id: account,
      seller_id: users.seller,
      daily_limit: 100,
      timezone: "UTC",
      start_hour: 0,
      end_hour: 24,
      subject: "tampered",
      body: "tampered {{unsubscribe_url}}",
      steps: [],
      template_id: saved,
      template_version: 1,
    };
    const key = randomUUID(),
      campaign = (await command("create_campaign", input, key)).id;
    const row = (
      await db.query<{ body: string; body_format: string }>(
        "select body,body_format from campaign_workspace where id=$1",
        [campaign],
      )
    ).rows[0];
    assert.equal(row.body, payload.body);
    assert.equal(row.body_format, "markdown");
    await command("archive_campaign_template", {
      id: saved,
      expected_version: 1,
      archived: true,
    });
    assert.equal(
      (await command("create_campaign", input, key)).id,
      campaign,
      "retry returns its original result even after archival",
    );
    await assert.rejects(command("create_campaign", input), /Template changed/);
    assert.equal(
      (
        await db.query(
          "select * from email_template_versions where template_id=$1",
          [saved],
        )
      ).rows.length,
      2,
    );
    const testKey = randomUUID();
    const queue = () =>
      db.query<{ id: string }>(
        "select queue_campaign_test($1,$2,'[PRUEBA] Hello','Hi','<p>Hi</p>',$3) id",
        [campaign, lead.id, testKey],
      );
    const testId = (await queue()).rows[0].id;
    assert.equal((await queue()).rows[0].id, testId);
    await db.exec("reset role");
    const message = (
      await db.query<{ to_email: string; enrollment_id: null }>(
        "select * from outbox where id=$1",
        [testId],
      )
    ).rows[0];
    assert.equal(message.to_email, "admin@team.test");
    assert.equal(message.enrollment_id, null);
    await db.query("select mark_sent($1,'test-gmail','test-thread')", [testId]);
    assert.equal(
      (
        await db.query<{ stage: string }>(
          "select stage from opportunities where id=$1",
          [lead.opportunity],
        )
      ).rows[0].stage,
      "new",
    );
    assert.equal(
      (
        await db.query("select * from conversations where opportunity_id=$1", [
          lead.opportunity,
        ])
      ).rows.length,
      0,
    );
    await asUser(users.seller);
    await assert.rejects(
      command("archive_campaign_template", { id: saved, expected_version: 2 }),
      /administrator/,
    );
    await assert.rejects(
      db.query("select reserve_gmail_api($1,'project',100)", [account]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("audience review blocks incomplete data, honors exclusions and rechecks suppression immediately before Gmail", async () => {
  const f = await setup();
  const { db, users, asUser, command } = f;
  try {
    const complete = await f.contact(),
      incomplete = await f.contact("Alex", ""),
      unverified = await f.contact("Other", "", "pending");
    const campaign = await f.campaign(
      "Hi {{name}} {{phone}} {{unsubscribe_url}}",
    );
    const audience = () =>
      db.query<{
        contact_id: string;
        reason: string;
        missing_fields: string[];
      }>("select * from campaign_audience($1)", [campaign]);
    const rows = (await audience()).rows;
    assert.equal(
      rows.find((c) => c.contact_id === complete.id)?.reason,
      "eligible",
    );
    assert.deepEqual(
      rows.find((c) => c.contact_id === incomplete.id)?.missing_fields,
      ["phone"],
    );
    assert.equal(
      rows.find((c) => c.contact_id === unverified.id)?.reason,
      "unverified",
    );
    await assert.rejects(
      command("activate_campaign", { id: campaign }),
      /datos faltantes/,
    );
    await command("campaign_audience_settings", {
      id: campaign,
      excluded_contact_ids: [incomplete.id],
    });
    await command("activate_campaign", { id: campaign });
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select * from campaign_enrollments where campaign_id=$1",
          [campaign],
        )
      ).rows.length,
      1,
    );
    const id = await f.queued(campaign, complete.id, complete.opportunity);
    assert.equal(
      (await db.query("select * from claim_outbox()")).rows.length,
      1,
    );
    await db.query("insert into suppressions(email,reason) values($1,'test')", [
      `${complete.id}@client.test`,
    ]);
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select recheck_outbox_delivery($1) ok",
          [id],
        )
      ).rows[0].ok,
      false,
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from outbox where id=$1",
          [id],
        )
      ).rows[0].status,
      "cancelled",
    );
    await asUser(users.seller);
    await assert.rejects(audience(), /access required/);
  } finally {
    await db.close();
  }
});

test("rolling account budgets combine campaigns, reserve operational capacity, deduplicate observed Gmail and wait on stale usage", async () => {
  const f = await setup();
  const { db, users, asUser, command, account } = f;
  try {
    const a = await f.contact(),
      campaign = await f.campaign();
    await command("activate_campaign", { id: campaign });
    const id = await f.queued(campaign, a.id, a.opportunity);
    await db.query(
      "update mail_accounts set campaign_daily_limit=1,daily_limit=3,operational_reserve=1,external_usage_synced_at=null where id=$1",
      [account],
    );
    assert.equal(
      (await db.query("select * from claim_outbox()")).rows.length,
      0,
      "wait for first complete external usage check",
    );
    await db.query(
      "update mail_accounts set external_usage_synced_at=now() where id=$1",
      [account],
    );
    await db.query("update outbox set available_at=now() where id=$1", [id]);
    await db.query(
      "insert into gmail_sent_usage values($1,'external-1',null,now()-interval '23 hours',1),($1,'external-old',null,now()-interval '25 hours',1)",
      [account],
    );
    assert.equal(
      (await db.query("select * from claim_outbox()")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select recheck_outbox_delivery($1) ok",
          [id],
        )
      ).rows[0].ok,
      true,
    );
    await db.query(
      "update outbox set status='sent',sent_at=now(),gmail_message_id='crm-1' where id=$1",
      [id],
    );
    await db.query(
      "insert into gmail_sent_usage values($1,'crm-1',null,now(),1)",
      [account],
    );
    const usage = (
      await db.query<{
        u: {
          total_messages: number;
          external_messages: number;
          campaign_remaining: number;
        };
      }>("select account_delivery_usage($1) u", [account])
    ).rows[0].u;
    assert.equal(usage.total_messages, 2);
    assert.equal(usage.external_messages, 1);
    assert.equal(usage.campaign_remaining, 0);
    // Another campaign uses the same budget, even though its own counter is empty.
    const b = await f.contact(),
      second = await f.campaign();
    await command("activate_campaign", { id: second });
    const next = await f.queued(second, b.id, b.opportunity);
    assert.equal(
      (await db.query("select * from claim_outbox()")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from outbox where id=$1",
          [next],
        )
      ).rows[0].status,
      "queued",
    );
    await asUser(users.admin);
    await assert.rejects(
      command("campaign_account_settings", {
        id: account,
        daily_limit: 100,
        campaign_daily_limit: 100,
        operational_reserve: 20,
      }),
      /reserva/,
    );
  } finally {
    await db.close();
  }
});

test("distributed quota reservations serialize one mailbox and share the project budget across mailboxes", async () => {
  const { db } = await featureDatabase();
  try {
    const account = randomUUID();
    const reserve = (id = account) =>
      db.query<{ wait: number }>(
        "select reserve_gmail_api($1,'same-project',100) wait",
        [id],
      );
    assert.equal((await reserve()).rows[0].wait, 0);
    assert((await reserve()).rows[0].wait >= 1000);
    assert(
      (await reserve(randomUUID())).rows[0].wait >= 1000,
      "project timeline is shared",
    );
    await db.query(
      "update gmail_api_usage set units=75000000 where project='same-project'",
    );
    assert.equal(
      (await reserve()).rows[0].wait,
      -1,
      "stop before the standard project's daily free threshold",
    );
  } finally {
    await db.close();
  }
});
