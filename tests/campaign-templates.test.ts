import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "./feature-database";
import {
  campaignTemplateSchema,
  requiresApplication,
} from "../src/lib/campaign-templates";
test("templates require unsubscribe and known merge fields in every step", () => {
  const draft = {
    name: "Pitch",
    subject: "{{company}} {{amount}}",
    body: "Hi {{name}} {{unsubscribe_url}}",
    steps: [],
    asset_ids: [],
  };
  assert(campaignTemplateSchema.safeParse(draft).success);
  assert(
    !campaignTemplateSchema.safeParse({ ...draft, subject: "{{secret}}" })
      .success,
  );
  assert(
    !campaignTemplateSchema.safeParse({
      ...draft,
      steps: [{ subject: "Hi", body: "Hi", wait_days: 3 }],
    }).success,
  );
  assert(
    !campaignTemplateSchema.safeParse({ ...draft, subject: "Unsafe\nSubject" })
      .success,
  );
  assert.equal(requiresApplication(draft.subject, draft.body), false);
  assert.equal(requiresApplication("Hello", "{{ application_url }}"), true);
});
test("template permissions, versions, immutable campaign attachments and generic delivery", async () => {
  const { db, users, asUser, command } = await featureDatabase();
  try {
    const account = randomUUID(),
      asset = randomUUID(),
      contact = randomUUID(),
      caseId = randomUUID();
    await db.query(
      "insert into mail_accounts(id,email,organization,status,daily_limit,timezone,external_usage_synced_at) values($1,'sender@team.test','Test','connected',100,'UTC',now())",
      [account],
    );
    await db.query(
      "insert into campaign_assets(id,created_by,request_key,name,mime_type,size,storage_path,content_hash) values($1,$2,$3,'Brochure.pdf','application/pdf',100,'test/brochure.pdf','hash')",
      [asset, users.admin, randomUUID()],
    );
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,'client@fictional.test','Alex','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id,application_complete) values($1,$2,'Fictional',$3,true)",
      [caseId, contact, users.seller],
    );
    const payload = {
        name: "General outreach",
        subject: "Hello {{company}}",
        body: "Hi {{name}} {{unsubscribe_url}}",
        steps: [],
        asset_ids: [asset],
      },
      key = randomUUID();
    const save = (p = payload, k = key) =>
      db.query<{ id: string }>("select save_campaign_template($1,$2) id", [
        p,
        k,
      ]);
    await asUser(users.seller);
    await assert.rejects(save(), /Administrator/);
    await asUser(users.admin, "aal1");
    await assert.rejects(save(), /MFA/);
    await asUser(users.admin);
    const id = (await save()).rows[0].id;
    assert.equal((await save()).rows[0].id, id);
    const campaignInput = {
      name: "Fictional outreach",
      account_id: account,
      seller_id: users.seller,
      daily_limit: 50,
      timezone: "UTC",
      start_hour: 0,
      end_hour: 24,
      subject: payload.subject,
      body: payload.body,
      steps: [],
      template_id: id,
      template_version: 1,
    };
    const campaignKey = randomUUID(),
      campaign = await command("create_campaign", campaignInput, campaignKey);
    await save(
      {
        ...payload,
        id,
        expected_version: 1,
        body: "Changed {{unsubscribe_url}}",
        asset_ids: [],
      } as typeof payload,
      randomUUID(),
    );
    assert.equal(
      (await command("create_campaign", campaignInput, campaignKey)).id,
      campaign.id,
    );
    await assert.rejects(
      command("create_campaign", campaignInput),
      /Template changed/,
    );
    const stored = (
      await db.query<{
        body: string;
        requires_application: boolean;
        asset_snapshot: { id: string }[];
      }>(
        "select body,requires_application,asset_snapshot from campaigns where id=$1",
        [campaign.id],
      )
    ).rows[0];
    assert.equal(stored.body, payload.body);
    assert.equal(stored.requires_application, false);
    assert.equal(stored.asset_snapshot[0].id, asset);
    await command("activate_campaign", { id: campaign.id });
    await db.exec("reset role");
    const enrollment = (
      await db.query<{ id: string }>(
        "select id from campaign_enrollments where campaign_id=$1",
        [campaign.id],
      )
    ).rows[0];
    assert(enrollment);
    await db.query(
      "insert into outbox(account_id,opportunity_id,enrollment_id,to_email,subject,body,area,message_id_header,requested_by,request_key,campaign_asset_snapshot) values($1,$2,$3,'client@fictional.test','Hi','Hi','seller','<fictional@test>',$4,'fictional-campaign',$5)",
      [account, caseId, enrollment.id, users.admin, stored.asset_snapshot],
    );
    assert.equal(
      (await db.query("select * from claim_outbox()")).rows.length,
      1,
      "generic campaigns can deliver after application completion",
    );
    await asUser(users.outsider);
    assert.equal(
      (await db.query("select * from campaign_workspace")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
