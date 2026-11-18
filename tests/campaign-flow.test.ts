import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { flowFixture as fixture } from "./fixtures/campaign-flow";
import { queueFixture } from "./fixtures/campaign-control";
import { launchFlow, readFlow } from "../src/lib/server/campaign-flow";
import { campaignFlowCases } from "../src/lib/server/campaign-flow-cases";
import { defaultReminders, nextReminderLocal } from "../src/lib/campaign-flow";
const root = "docs/specs/pipeline-os/campaign-flow-20261117/migrations/";
test("CF calendar: calendar intervals, Sunday shift and actual delayed anchor", () => {
  let d = "2026-11-17T10:30:00";
  const result = defaultReminders.map(
    (s) => (d = nextReminderLocal(d, s.wait_days)),
  );
  assert.deepEqual(result, [
    "2026-11-19T10:30:00",
    "2026-11-23T10:30:00",
    "2026-11-26T10:30:00",
    "2026-12-01T10:30:00",
  ]);
  assert.equal(
    nextReminderLocal("2026-11-24T10:30:00", 3),
    "2026-11-27T10:30:00",
  );
});
test("CF SQL: exact pool launch, immutable four steps, replay and advisor preservation", async () => {
  const f = await fixture();
  try {
    const pool = (await f.db.query<any>("select campaign_flow_pool() r"))
      .rows[0].r;
    assert.equal(pool.total, 4);
    const key = randomUUID(),
      r = await f.launch(f.p, key);
    assert.deepEqual(await f.launch(f.p, key), r);
    await f.db.exec("reset role");
    const c = (
      await f.db.query<any>("select * from campaigns where id=$1", [r.id])
    ).rows[0];
    assert.equal(c.first_contact, false);
    assert.equal(c.steps.length, 4);
    assert.equal(c.start_hour, 0);
    assert.equal(c.end_hour, 24);
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*)::int n from campaign_enrollments where campaign_id=$1",
          [r.id],
        )
      ).rows[0].n,
      4,
    );
    assert(
      (await f.db.query<any>("select seller_id from opportunities")).rows.every(
        (o) => o.seller_id === f.users.seller,
      ),
    );
    await f.asUser(f.users.admin);
    assert.equal(
      (await f.db.query<any>("select campaign_flow_pool() r")).rows[0].r.total,
      0,
    );
    await assert.rejects(
      f.launch({ ...f.p, contact_ids: [f.contacts[0]] }, key),
      /CF_STALE/,
    );
  } finally {
    await f.db.close();
  }
});
test("CF SQL: negative MFA, stale template, unavailable contacts and duplicates leave no campaign", async () => {
  const f = await fixture();
  try {
    await f.asUser(f.users.admin, "aal1");
    await assert.rejects(f.launch(), /CF_FORBIDDEN/);
    await f.asUser(f.users.outsider);
    await assert.rejects(f.launch(), /CF_FORBIDDEN/);
    await f.asUser(f.users.admin);
    await assert.rejects(f.launch({ ...f.p, template_version: 2 }), /CF_STALE/);
    await assert.rejects(
      f.launch({ ...f.p, contact_ids: [f.contacts[0], f.contacts[0]] }),
      /CF_STALE/,
    );
    await f.db.exec("reset role");
    await f.db.query("update contacts set verification='invalid' where id=$1", [
      f.contacts[0],
    ]);
    await f.asUser(f.users.admin);
    await assert.rejects(f.launch(), /CF_STALE/);
    assert.equal((await f.read()).total, 0);
  } finally {
    await f.db.close();
  }
});

test("CF SQL: PostgreSQL civil calendar preserves local hour across DST and moves only Sunday", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    const dates = (
      await f.db.query<any>(
        "select (campaign_flow_v1.next_date('2026-10-31 13:30Z',2,'America/New_York') at time zone 'UTC')::text dst,(campaign_flow_v1.next_date('2026-11-19 15:30Z',3,'America/Bogota') at time zone 'UTC')::text sunday,(campaign_flow_v1.next_date('2026-11-26 15:30Z',5,'America/Bogota') at time zone 'UTC')::text last",
      )
    ).rows[0];
    assert.match(dates.dst, /2026-11-02 14:30/);
    assert.match(dates.sunday, /2026-11-23 15:30/);
    assert.match(dates.last, /2026-12-01 15:30/);
  } finally {
    await f.db.close();
  }
});

test("CF SQL: bounded import consent is atomic, owner-scoped, idempotent and never retries prior errors", async () => {
  const f = await fixture();
  try {
    const key = randomUUID(),
      batch = randomUUID();
    const p = {
      batch_id: batch,
      request_key: key,
      file_name: "Fixture.xlsx",
      storage_path: `${f.users.admin}/${key}.xlsx`,
      mapping: { email: "Email" },
      sheet: "Sheet1",
      total: 4,
      max_count: 4,
    };
    const register = async (x = p) =>
      (
        await f.db.query<any>("select campaign_flow_register_import($1) id", [
          x,
        ])
      ).rows[0].id;
    assert.equal(await register(), batch);
    assert.equal(await register(), batch);
    await assert.rejects(register({ ...p, max_count: 3 }), /CF_INVALID_INPUT/);
    await f.asUser(f.users.outsider);
    await assert.rejects(register(), /CF_FORBIDDEN/);
    await f.asUser(f.users.admin);
    await assert.rejects(
      register({
        ...p,
        request_key: randomUUID(),
        storage_path: `${f.users.seller}/${randomUUID()}.xlsx`,
      }),
      /CF_INVALID_INPUT/,
    );
    await f.db.exec("reset role");
    const fresh = randomUUID(),
      failed = randomUUID();
    for (const id of [fresh, failed]) {
      await f.db.query(
        "insert into contacts(id,email,verification) values($1,$2,'pending')",
        [id, id + "@example.test"],
      );
      await f.db.query(
        "insert into leads(contact_id,company,seller_id) values($1,'Fixture',$2)",
        [id, f.users.admin],
      );
    }
    await f.db.query(
      "insert into verifications(contact_id,request_key,result,state) values($1,$2,'pending','uncertain_request')",
      [failed, randomUUID()],
    );
    for (const [n, id, result] of [
      [1, fresh, "imported"],
      [2, fresh, "duplicate"],
      [3, failed, "duplicate"],
      [4, f.contacts[0], "duplicate"],
    ] as const)
      await f.db.query(
        "insert into import_rows(batch_id,row_number,contact_id,result) values($1,$2,$3,$4)",
        [batch, n, id, result],
      );
    assert.equal(
      (
        await f.db.query<any>(
          "select queued from campaign_flow_v1.import_consents where batch_id=$1",
          [batch],
        )
      ).rows[0].queued,
      1,
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*)::int n from verifications where contact_id=$1",
          [fresh],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*)::int n from verifications where contact_id=$1",
          [failed],
        )
      ).rows[0].n,
      1,
    );
    await f.asUser(f.users.admin);
    await assert.rejects(
      f.db.query("select * from campaign_flow_v1.import_consents"),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});

test("CF SQL: first accepted send advances once from actual confirmation; reply prevents the pending reminder", async () => {
  const f = await fixture();
  try {
    const r = await f.launch();
    await f.db.exec("reset role");
    await f.db.query(
      "select set_config('pipeline_os.brand_context',(select brand_snapshot::text from campaigns where id=$1),false)",
      [r.id],
    );
    await f.db.query("update campaigns set scheduled_at=null where id=$1", [
      r.id,
    ]);
    await f.db.query("update campaign_enrollments set next_at=now() where campaign_id=$1",[r.id]);
    await f.db.exec("set pipeline_os.brand_context=''");
    await queueFixture(f, r.id);
    await f.db.exec("set role service_role");
    const message = (await f.db.query<any>("select * from claim_outbox()"))
      .rows[0];
    assert(message);
    const admission = (
      await f.db.query<any>("select admit_brand_dispatch($1,$2) id", [
        message.id,
        message.brand_claim_token,
      ])
    ).rows[0].id;
    assert(admission);
    await f.db.query("select mark_sent($1,$2,$3)", [
      message.id,
      "fixture-gmail-accepted",
      "fixture-thread",
    ]);
    await f.db.query("select mark_sent($1,$2,$3)", [
      message.id,
      "fixture-gmail-accepted",
      "fixture-thread",
    ]);
    await f.db.exec("reset role");
    const row = (
      await f.db.query<any>(
        "select e.step,e.next_at=campaign_flow_v1.next_date(o.sent_at,2,c.timezone) correct,e.opportunity_id from campaign_enrollments e join outbox o on o.enrollment_id=e.id join campaigns c on c.id=e.campaign_id where o.id=$1",
        [message.id],
      )
    ).rows[0];
    assert.equal(row.step, 1);
    assert.equal(row.correct, true);
    await f.asUser(f.users.admin);
    const cases = (
      await f.db.query<any>("select campaign_flow_cases($1) r", [
        [row.opportunity_id],
      ])
    ).rows[0].r;
    assert.equal(cases[0].initial_sent, true);
    const progress = (
      await f.db.query<any>("select campaign_flow_progress($1) r", [r.id])
    ).rows[0].r;
    assert.equal(progress.steps[0].sent, 1);
    assert.equal(progress.steps[1].waiting, 1);
    await f.db.exec("reset role");
    await f.db.query("select stop_contact_sequence($1,'replied')", [
      message.to_email === undefined
        ? ""
        : (
            await f.db.query<any>(
              "select contact_id from campaign_enrollments where id=$1",
              [message.enrollment_id],
            )
          ).rows[0].contact_id,
    ]);
    assert.equal(
      (
        await f.db.query<any>(
          "select status from campaign_enrollments where id=$1",
          [message.enrollment_id],
        )
      ).rows[0].status,
      "replied",
    );
    await assert.rejects(
      f.db.exec(await readFile(root + "down.sql", "utf8")),
      /CF_ROLLBACK_HAS_HISTORY/,
    );
    await f.db.exec("rollback");
  } finally {
    await f.db.close();
  }
});

test("CF SQL: a reply to a reminder on a new Gmail thread counts once and opens its actual conversation",async()=>{
 const f=await fixture();try{
  const campaign=await f.launch({...f.p,contact_ids:[f.contacts[0]]});await f.db.exec('reset role');
  await f.db.query("select set_config('pipeline_os.brand_context',(select brand_snapshot::text from campaigns where id=$1),false)",[campaign.id]);await f.db.query('update campaigns set scheduled_at=null where id=$1',[campaign.id]);await f.db.exec("set pipeline_os.brand_context=''");
  await f.db.query('update campaign_enrollments set next_at=now() where campaign_id=$1',[campaign.id]);await queueFixture(f,campaign.id);
  const accept=async(gmail:string,thread:string)=>{await f.db.exec('set role service_role');const m=(await f.db.query<any>('select * from claim_outbox()')).rows[0];assert(m);assert((await f.db.query<any>('select admit_brand_dispatch($1,$2) id',[m.id,m.brand_claim_token])).rows[0].id);await f.db.query('select mark_sent($1,$2,$3)',[m.id,gmail,thread]);await f.db.exec('reset role');return (await f.db.query<any>('select * from outbox where id=$1',[m.id])).rows[0];};
  const first=await accept('initial-fixture','initial-thread');
  await f.db.query("update outbox set sending_at=now()-interval '1 minute' where id=$1",[first.id]);
  await f.db.query('update campaign_enrollments set next_at=now() where id=$1',[first.enrollment_id]);
  await f.db.query("insert into outbox(account_id,opportunity_id,enrollment_id,to_email,subject,body,area,message_id_header,requested_by,request_key) values($1,$2,$3,$4,'Distinct reminder','Fixture body','seller',$5,$6,$7)",[first.account_id,first.opportunity_id,first.enrollment_id,first.to_email,`<${first.enrollment_id}.1@crm.curated.local>`,f.users.admin,`campaign:${first.enrollment_id}:1`]);
  const reminder=await accept('reminder-fixture','new-physical-thread');assert.notEqual(reminder.conversation_id,first.conversation_id);
  for(const [nature,sender] of [['personal',first.to_email],['autoresponder',first.to_email],['personal','other@example.test']])await f.db.query("insert into messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status,nature,references_header) values($1,$2,'inbound',$3,'Fixture response',now()+interval '1 minute','received',$4,$5)",[reminder.conversation_id,randomUUID(),sender,nature,reminder.message_id_header]);
  await f.asUser(f.users.admin);const rows=(await f.db.query<any>('select * from campaign_reply_rows($1)',[campaign.id])).rows;assert.equal(rows.length,1);
  const facts=(await f.db.query<any>('select * from campaign_contact_facts($1)',[campaign.id])).rows;assert.equal(facts[0].conversation_id,reminder.conversation_id);assert(facts[0].reply_at);
  const overview=await f.read();assert.equal(overview.campaigns[0].metrics.replied,1);assert.equal(overview.campaigns[0].metrics.unanswered,0);
 }finally{await f.db.close();}
});

test("CF SQL: pause/resume cannot discover a fifth recipient and never restarts terminal enrollments", async () => {
  const f = await fixture();
  try {
    const r = await f.launch();
    await f.command("pause", { id: r.id });
    await f.db.exec("reset role");
    const extra = randomUUID();
    await f.db.query(
      "insert into contacts(id,email,verification) values($1,$2,'valid')",
      [extra, extra + "@example.test"],
    );
    await f.db.query(
      "insert into leads(contact_id,company,seller_id) values($1,'Extra',$2)",
      [extra, f.users.seller],
    );
    await f.db.query(
      "update campaign_enrollments set status='replied' where contact_id=$1",
      [f.contacts[0]],
    );
    await f.asUser(f.users.admin);
    await f.command("activate", { id: r.id, senders: [f.payload.senders[0]] });
    await f.db.exec("reset role");
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*)::int n from campaign_enrollments where campaign_id=$1",
          [r.id],
        )
      ).rows[0].n,
      4,
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*)::int n from campaign_enrollments where campaign_id=$1 and status='replied'",
          [r.id],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await f.db.close();
  }
});

test("CF SQL: Sunday final boundary defers without an admission, charge attempt or terminal pause", async () => {
  const f = await fixture();
  try {
    const r = await f.launch();
    await queueFixture(f, r.id);
    await f.db.exec("reset role");
    const o = (
      await f.db.query<any>("select * from outbox order by id limit 1")
    ).rows[0];
    await f.db.query(
      "update outbox set status='sending',sending_at=now(),send_attempts=1,brand_claim_token=gen_random_uuid() where id=$1",
      [o.id],
    );
    const original = (
      await f.db.query<any>(
        "select pg_get_functiondef('public.recheck_outbox_delivery_before_brand_b2(uuid)'::regprocedure) definition",
      )
    ).rows[0].definition;
    // A local fixed clock exercises the exact installed final-boundary function.
    await f.db.exec(
      original.replaceAll("now()", "'2026-11-22 15:30Z'::timestamptz"),
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select recheck_outbox_delivery_before_brand_b2($1) ok",
          [o.id],
        )
      ).rows[0].ok,
      false,
    );
    const after = (
      await f.db.query<any>(
        "select status,send_attempts,brand_admission_id,(available_at at time zone 'America/Bogota')::text next from outbox where id=$1",
        [o.id],
      )
    ).rows[0];
    assert.equal(after.status, "queued");
    assert.equal(after.send_attempts, 0);
    assert.equal(after.brand_admission_id, null);
    assert.match(after.next, /2026-11-23 10:30/);
    await f.db.exec(original);
  } finally {
    await f.db.close();
  }
});

test("CF SQL: prepared pool is separate from Documents; existing client evidence and historical campaigns are preserved", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    const cases = (
      await f.db.query<any>("select id from opportunities")
    ).rows.map((x) => x.id);
    await f.asUser(f.users.admin);
    const before = (
      await f.db.query<any>("select campaign_flow_cases($1) r", [cases])
    ).rows[0].r;
    assert.equal(before.length, 4);
    assert(before.every((x: any) => !x.initial_sent));
    const old = await f.command("create", f.payload);
    await f.db.exec("reset role");
    const c = (
      await f.db.query<any>(
        "select first_contact,steps from campaigns where id=$1",
        [old.id],
      )
    ).rows[0];
    assert.equal(c.first_contact, true);
    assert.deepEqual(c.steps, []);
    assert.equal(
      (await f.db.query<any>("select count(*)::int n from campaign_flows"))
        .rows[0].n,
      0,
    );
    await f.db.query(
      "update opportunities set stage='contacting' where id=$1",
      [cases[0]],
    );
    await f.asUser(f.users.admin);
    assert.equal(
      (await f.db.query<any>("select campaign_flow_cases($1) r", [cases]))
        .rows[0].r.length,
      3,
    );
  } finally {
    await f.db.close();
  }
});

test("CF SQL: schema reversal is clean before history and does not bypass the original brand boundary", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    const original = (
      await f.db.query<any>(
        "select prosrc from pg_proc where oid='campaign_flow_v1.recheck_outbox_delivery_before_brand_b2(uuid)'::regprocedure",
      )
    ).rows[0].prosrc;
    await f.db.exec(await readFile(root + "down.sql", "utf8"));
    assert.equal(
      (
        await f.db.query<any>(
          "select prosrc from pg_proc where oid='public.recheck_outbox_delivery_before_brand_b2(uuid)'::regprocedure",
        )
      ).rows[0].prosrc,
      original,
    );
    await f.db.exec(await readFile(root + "up.sql", "utf8"));
    await f.asUser(f.users.admin);
    await f.launch();
    assert.equal(
      (await f.db.query<any>("select count(*)::int n from campaign_flows"))
        .rows[0].n,
      1,
    );
    await assert.rejects(
      f.db.query("delete from campaign_flows"),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});

test("CF API: invalid sequence and unauthorized role stop before brand preparation; read queries are bounded", async () => {
  const calls: any[] = [];
  const ctx: any = {
    profile: { role: "superadmin" },
    db: {
      rpc: async (name: string, args: any) => {
        calls.push({ name, args });
        return { data: { total: 0, rows: [] }, error: null };
      },
    },
  };
  await readFlow(
    new URL("https://example.test/api/campaigns/flow?size=50&search=Example"),
    ctx,
  );
  assert.equal(calls.pop().args.page_size, 50);
  await assert.rejects(
    readFlow(new URL("https://example.test/api/campaigns/flow?size=5000"), ctx),
  );
  await assert.rejects(
    launchFlow({ request_key: randomUUID(), payload: {} }, ctx),
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    readFlow(new URL("https://example.test/api/campaigns/flow"), {
      ...ctx,
      profile: { role: "seller" },
    }),
    /MFA/,
  );
});

test("CF Documents: unsent typed campaigns stay out, accepted and advanced cases retain engagement", async () => {
  const all: any[] = [
    { id: "pending", stage: "new" },
    { id: "sent", stage: "contacting" },
    { id: "advanced", stage: "underwriting" },
    { id: "classic", stage: "new" },
  ];
  const db: any = {
    rpc: async () => ({
      data: [
        { id: "pending", initial_sent: false, engagement: "unanswered" },
        { id: "sent", initial_sent: true, engagement: "unanswered" },
        { id: "advanced", initial_sent: false, engagement: "in_progress" },
      ],
      error: null,
    }),
  };
  const rows = await campaignFlowCases(db, all);
  assert.deepEqual(
    rows.map((x) => x.id),
    ["sent", "advanced", "classic"],
  );
  assert.equal(rows[0].campaign_engagement, "unanswered");
  await assert.rejects(
    campaignFlowCases(
      { rpc: async () => ({ data: null, error: null }) } as any,
      all,
    ),
    /estado de envío/,
  );
});
