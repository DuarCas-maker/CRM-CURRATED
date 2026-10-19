import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "./feature-database";
import { campaignCsv, responseRate } from "../src/lib/campaign-center";

test("response rates use confirmed contacts and CSV neutralizes formulas", () => {
  assert.equal(responseRate({ sent: 0, replied: 0 }), 0);
  assert.equal(responseRate({ sent: 3, replied: 1 }), 33.3);
  assert.equal(
    campaignCsv([['=HYPERLINK("x")', "a,b", "normal", "  +SUM(1)"]]),
    '\ufeff"\'=HYPERLINK(""x"")","a,b","normal","\'  +SUM(1)"',
  );
});

test("contact pages and campaign lists retain full authorized totals", async () => {
  const f = await fixture();
  const { db, users, asUser } = f;
  try {
    for (let i = 0; i < 57; i++) await f.lead();
    const campaign = await f.create();
    const metrics = await f.summary(campaign);
    assert.equal(metrics.enrolled, 57);
    assert.equal(metrics.pending, 57);
    const readPage = async (page: number) =>
      (
        await db.query<{
          p: { total: number; rows: { contact_id: string }[] };
        }>("select campaign_contacts_page($1,'','all',$2) p", [campaign, page])
      ).rows[0].p;
    const first = await readPage(0),
      second = await readPage(1);
    assert.equal(first.total, 57);
    assert.equal(first.rows.length, 50);
    assert.equal(second.rows.length, 7);
    assert.equal(
      new Set([...first.rows, ...second.rows].map((r) => r.contact_id)).size,
      57,
    );
    const idempotencyKey = randomUUID();
    const input = {
      name: "Empty draft",
      account_id: f.account,
      seller_id: users.seller,
      daily_limit: 80,
      timezone: "UTC",
      start_hour: 0,
      end_hour: 24,
      subject: "Hello",
      body: "Hi {{unsubscribe_url}}",
      steps: [],
      selected_contact_ids: [],
    };
    const draft = await f.command("create_campaign", input, idempotencyKey);
    assert.equal(
      (await f.command("create_campaign", input, idempotencyKey)).id,
      draft.id,
    );
    const filtered = (
      await db.query<{ p: { total: number; campaigns: unknown[] } }>(
        "select campaign_center('Empty draft',0,'draft') p",
      )
    ).rows[0].p;
    assert.equal(filtered.total, 1);
    assert.equal(filtered.campaigns.length, 1);
    await asUser(users.outsider);
    assert.equal(
      (await db.query<{ p: { total: number } }>("select campaign_center() p"))
        .rows[0].p.total,
      0,
    );
  } finally {
    await db.close();
  }
});

test("replies from another campaign never transfer, and missing headers require an unambiguous Gmail thread", async () => {
  const f = await fixture();
  const { db, users, asUser, command } = f;
  try {
    const lead = await f.lead(),
      first = await f.create([lead.id]);
    await command("activate_campaign", { id: first });
    const a = await f.queue(first, lead);
    await db.query("select mark_sent($1,'first','same-thread')", [a.id]);
    const second = randomUUID();
    // A historical campaign can share a thread with another historical send.
    await db.query(
      "insert into campaigns(id,name,account_id,seller_id,created_by,daily_limit,timezone,start_hour,end_hour,subject,body) values($1,'Historical',$2,$3,$4,80,'UTC',0,24,'Hello','Hi {{unsubscribe_url}}')",
      [second, f.account, users.seller, users.admin],
    );
    await db.query(
      "insert into campaign_enrollments(campaign_id,contact_id,opportunity_id) values($1,$2,$3)",
      [second, lead.id, lead.opportunity],
    );
    const b = await f.queue(second, lead);
    await db.query("select mark_sent($1,'second','same-thread')", [b.id]);
    const conv = (
      await db.query<{ conversation_id: string }>(
        "select conversation_id from outbox where id=$1",
        [b.id],
      )
    ).rows[0].conversation_id;
    const reply = async (ref: string) =>
      db.query(
        "insert into messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status,references_header,nature) values($1,$2,'inbound',$3,'Reply',now()+interval '1 second','received',$4,'personal')",
        [conv, randomUUID(), `${lead.id}@client.test`, ref],
      );
    await reply(b.header);
    assert.equal((await f.summary(first)).replied, 0);
    assert.equal((await f.summary(second)).replied, 1);
    await db.exec("reset role");
    await reply("");
    assert.equal(
      (await f.summary(first)).replied,
      0,
      "ambiguous thread is not attribution evidence",
    );
    await db.exec("reset role");
    await reply(a.header);
    assert.equal((await f.summary(first)).replied, 1);
    await asUser(users.admin);
    const events = (
      await db.query<{ p: { rows: { kind: string }[] } }>(
        "select campaign_activity_page() p",
      )
    ).rows[0].p.rows;
    assert.equal(
      events.filter((e) => e.kind === "replied").length,
      2,
      "each proven inbound message is an activity event",
    );
  } finally {
    await db.close();
  }
});

async function fixture() {
  const f = await featureDatabase();
  const { db, users, asUser, command } = f;
  const account = randomUUID();
  await db.query(
    "insert into mail_accounts(id,email,organization,status,daily_limit,campaign_daily_limit,operational_reserve,external_usage_synced_at) values($1,'sender@team.test','Test','connected',120,100,20,now())",
    [account],
  );
  async function lead(verification = "valid", stage = "new", source = true) {
    await db.exec("reset role");
    const id = randomUUID();
    await db.query(
      "insert into contacts(id,email,name,phone,verification) values($1,$2,'Alex','555',$3)",
      [id, `${id}@client.test`, verification],
    );
    let opportunity: string | null = null;
    if (source) {
      await db.query(
        "insert into leads(contact_id,company,seller_id) values($1,'Company',$2)",
        [id, users.seller],
      );
      opportunity = (
        await db.query<{ opportunity_id: string }>(
          "select opportunity_id from leads where contact_id=$1",
          [id],
        )
      ).rows[0].opportunity_id;
    } else if (verification === "valid") {
      opportunity = randomUUID();
      await db.query(
        "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Other source',$3)",
        [opportunity, id, users.seller],
      );
    }
    if (opportunity && stage !== "new")
      await db.query("update opportunities set stage=$1 where id=$2", [
        stage,
        opportunity,
      ]);
    return { id, opportunity };
  }
  async function create(ids?: string[], extra: Record<string, unknown> = {}) {
    await asUser(users.admin);
    return (
      await command("create_campaign", {
        name: "First contact",
        account_id: account,
        seller_id: users.seller,
        daily_limit: 80,
        timezone: "UTC",
        start_hour: 0,
        end_hour: 24,
        subject: "Hello {{company}}",
        body: "Hi {{name}} {{unsubscribe_url}}",
        steps: [
          {
            subject: "Legacy followup",
            body: "Hi {{unsubscribe_url}}",
            wait_days: 2,
          },
        ],
        ...(ids ? { selected_contact_ids: ids } : {}),
        ...extra,
      })
    ).id;
  }
  async function queue(
    campaign: string,
    contact: { id: string; opportunity: string | null },
    status = "queued",
  ) {
    await db.exec("reset role");
    const enrollment = (
      await db.query<{ id: string }>(
        "select id from campaign_enrollments where campaign_id=$1 and contact_id=$2",
        [campaign, contact.id],
      )
    ).rows[0].id;
    const id = randomUUID(),
      header = `<${enrollment}.0@crm.curated.local>`;
    await db.query(
      "insert into outbox(id,account_id,opportunity_id,enrollment_id,to_email,subject,body,area,message_id_header,requested_by,request_key,status) values($1,$2,$3,$4,$5,'Hello','Hello','seller',$6,$7,$8,$9)",
      [
        id,
        account,
        contact.opportunity,
        enrollment,
        `${contact.id}@client.test`,
        header,
        users.admin,
        `campaign:${enrollment}:0`,
        status,
      ],
    );
    return { id, header, enrollment };
  }
  const summary = async (c: string) => {
    await asUser(users.admin);
    return (
      await db.query<{ m: Record<string, number> }>(
        "select campaign_contact_summary($1) m",
        [c],
      )
    ).rows[0].m;
  };
  return { ...f, account, lead, create, queue, summary };
}

test("only eligible prepared leads are frozen; new campaigns discard followups and preserve idempotency", async () => {
  const f = await fixture();
  const { db, users, asUser, command } = f;
  try {
    const eligible = await f.lead(),
      invalid = await f.lead("invalid"),
      advanced = await f.lead("valid", "analysis"),
      foreign = await f.lead("valid", "new", false),
      blocked = await f.lead();
    await db.query(
      "insert into suppressions(email,reason) values($1,'unsubscribe')",
      [`${blocked.id}@client.test`],
    );
    const campaign = await f.create();
    const saved = (
      await db.query<{
        steps: unknown[];
        selected_contact_ids: string[];
        first_contact: boolean;
      }>(
        "select steps,selected_contact_ids,first_contact from campaigns where id=$1",
        [campaign],
      )
    ).rows[0];
    assert.deepEqual(saved.steps, []);
    assert.equal(saved.first_contact, true);
    assert.deepEqual(saved.selected_contact_ids, [eligible.id]);
    for (const contact of [invalid, advanced, foreign, blocked])
      await assert.rejects(f.create([contact.id]), /eligible leads/);
    const later = await f.lead();
    await asUser(users.admin);
    await command("activate_campaign", { id: campaign });
    const rows = (
      await db.query<{ contact_id: string }>(
        "select * from campaign_enrollments where campaign_id=$1",
        [campaign],
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => r.contact_id),
      [eligible.id],
    );
    assert(!rows.some((r) => r.contact_id === later.id));
    await assert.rejects(f.create([eligible.id]), /eligible leads/);
    await asUser(users.seller);
    await assert.rejects(
      db.query("select first_contact_candidates('a','b',$1)", [f.account]),
      /access required/,
    );
    await asUser(users.admin, "aal1");
    await assert.rejects(
      db.query("select first_contact_candidates('a','b',$1)", [f.account]),
      /access required/,
    );
  } finally {
    await db.close();
  }
});

test("scheduling persists enrollment without sending early, and final delivery rechecks advanced cases", async () => {
  const f = await fixture();
  const { db, users, asUser, command } = f;
  try {
    const lead = await f.lead(),
      campaign = await f.create([lead.id]);
    await command("schedule_campaign", {
      id: campaign,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    });
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from due_campaign_enrollments(false)")).rows
        .length,
      0,
    );
    const out = await f.queue(campaign, lead, "sending");
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select recheck_outbox_delivery($1) ok",
          [out.id],
        )
      ).rows[0].ok,
      false,
    );
    await db.query("update campaigns set scheduled_at=null where id=$1", [
      campaign,
    ]);
    await db.query("update opportunities set stage='analysis' where id=$1", [
      lead.opportunity,
    ]);
    await db.query("update outbox set status='sending' where id=$1", [out.id]);
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select recheck_outbox_delivery($1) ok",
          [out.id],
        )
      ).rows[0].ok,
      false,
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from outbox where id=$1",
          [out.id],
        )
      ).rows[0].status,
      "cancelled",
    );
    await asUser(users.admin);
    const events = (
      await db.query<{ kind: string }>(
        "select * from campaign_events where campaign_id=$1",
        [campaign],
      )
    ).rows;
    assert(events.some((e) => e.kind === "scheduled"));
    const manual = await f.lead();
    const second = await f.create([manual.id]);
    await command("activate_campaign", { id: second });
    const queued = await f.queue(second, manual, "sending");
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select recheck_outbox_delivery($1) ok",
          [queued.id],
        )
      ).rows[0].ok,
      true,
    );
    await db.query(
      "update opportunities set stage='contacting',last_contact=now() where id=$1",
      [manual.opportunity],
    );
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select recheck_outbox_delivery($1) ok",
          [queued.id],
        )
      ).rows[0].ok,
      false,
      "a manual contact after activation prevents a duplicate first email",
    );
  } finally {
    await db.close();
  }
});

test("metrics require initial Gmail acceptance and correct reply evidence; paging, attention, tests and RLS stay separate", async () => {
  const f = await fixture();
  const { db, users, asUser, command } = f;
  try {
    const a = await f.lead(),
      b = await f.lead(),
      c = await f.lead(),
      d = await f.lead();
    const campaign = await f.create([a.id, b.id, c.id, d.id]);
    await command("activate_campaign", { id: campaign });
    const accepted = await f.queue(campaign, a),
      silent = await f.queue(campaign, b),
      uncertain = await f.queue(campaign, c, "uncertain");
    await db.query("select mark_sent($1,'accepted-a','thread-a')", [
      accepted.id,
    ]);
    await db.query("select mark_sent($1,'accepted-b','thread-b')", [silent.id]);
    const trial = await f.queue(campaign, d);
    await db.query("update outbox set campaign_test=true where id=$1", [
      trial.id,
    ]);
    await db.query("select mark_sent($1,'test-only','test-thread')", [
      trial.id,
    ]);
    let metrics = await f.summary(campaign);
    assert.equal(metrics.sent, 2);
    assert.equal(metrics.pending, 1);
    assert.equal(metrics.uncertain, 1);
    assert.equal(metrics.unanswered, 2);
    await db.exec("reset role");
    const conversation = (
      await db.query<{ conversation_id: string }>(
        "select conversation_id from outbox where id=$1",
        [accepted.id],
      )
    ).rows[0].conversation_id;
    async function reply(
      ref: string,
      offset: string,
      sender = `${a.id}@client.test`,
      nature = "personal",
    ) {
      await db.query(
        "insert into messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status,references_header,nature,reply_intent) values($1,$2,'inbound',$3,'Reply',now()+$4::interval,'received',$5,$6,'review')",
        [conversation, randomUUID(), sender, offset, ref, nature],
      );
    }
    await reply(accepted.header, "-1 day");
    await reply("<different-campaign@test>", "1 second");
    await reply(accepted.header, "2 seconds", "another@client.test");
    await reply(
      accepted.header,
      "3 seconds",
      `${a.id}@client.test`,
      "automatic",
    );
    metrics = await f.summary(campaign);
    assert.equal(metrics.replied, 0);
    await db.exec("reset role");
    await reply(accepted.header, "4 seconds");
    await reply(accepted.header, "5 seconds");
    await db.query(
      "update conversations set needs_attention=true where id=$1",
      [conversation],
    );
    metrics = await f.summary(campaign);
    assert.equal(metrics.replied, 1);
    assert.equal(metrics.unanswered, 1);
    assert.equal(metrics.attention, 1);
    assert.equal(
      responseRate(metrics as { sent: number; replied: number }),
      50,
    );
    const filtered = (
      await db.query<{ p: { total: number; rows: unknown[] } }>(
        "select campaign_contacts_page($1,'','attention',0) p",
        [campaign],
      )
    ).rows[0].p;
    assert.equal(filtered.total, 1);
    assert.equal(filtered.rows.length, 1);
    const dashboard = (
      await db.query<{ p: { summary: { sent: number; replied: number } } }>(
        "select campaign_center('no match',2) p",
      )
    ).rows[0].p;
    assert.equal(dashboard.summary.sent, 2);
    assert.equal(dashboard.summary.replied, 1);
    const events = (
      await db.query<{ p: { rows: { kind: string; email: string }[] } }>(
        "select campaign_activity_page() p",
      )
    ).rows[0].p.rows;
    assert.equal(
      events.filter((e) => e.kind === "sent").length,
      2,
      "test send excluded from activity",
    );
    await db.exec("reset role");
    await db.query(
      "update conversations set needs_attention=false where id=$1",
      [conversation],
    );
    metrics = await f.summary(campaign);
    assert.equal(metrics.attention, 0);
    assert.equal(metrics.replied, 1);
    await asUser(users.outsider);
    await assert.rejects(
      db.query("select campaign_contact_summary($1)", [campaign]),
      /access required/,
    );
    assert.equal(
      (await db.query<{ p: { total: number } }>("select campaign_center() p"))
        .rows[0].p.total,
      0,
    );
    await asUser(users.closer);
    await assert.rejects(
      db.query("select campaign_contact_summary($1)", [campaign]),
      /access required/,
    );
    assert(uncertain.id);
  } finally {
    await db.close();
  }
});
