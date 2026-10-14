import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { replyIntent } from "../src/lib/mail-interest";

test("continuous interest activates cases once, retains pending history, sorts receipt dates and preserves closed cases", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      grant usage on schema public,auth,storage to authenticated,anon,service_role;`);
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const seller = randomUUID(),
      admin = randomUUID(),
      account = randomUUID();
    for (const [id, role] of [
      [seller, "seller"],
      [admin, "superadmin"],
    ]) {
      await db.query("insert into auth.users values($1,$2)", [
        id,
        `${id}@team.test`,
      ]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,$2::text,$3,$2::public.app_role)",
        [id, role, `${id}@team.test`],
      );
    }
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id,status) values($1,'seller@team.test','fixture',$2,'connected')",
      [account, seller],
    );
    const receive = async (
      sender: string,
      body: string,
      sent: string,
      thread = sender,
      direction = "inbound",
      nature = "personal",
      references = "",
    ) => {
      const id = randomUUID();
      const participants =
        direction === "inbound"
          ? [
              { email: sender, role: "from", name: "Customer" },
              { email: "seller@team.test", role: "to" },
            ]
          : [
              { email: "seller@team.test", role: "from" },
              { email: sender, role: "to" },
            ];
      await db.query(
        "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,internet_message_id,subject,sent_at,direction,nature,participants,encrypted_payload,references_header) values($1::uuid,$2,$1::text,$3,$4,'Funding',$5,$6,$7,$8,'encrypted',$9)",
        [
          id,
          account,
          thread,
          `<${id}@mail.test>`,
          sent,
          direction,
          nature,
          JSON.stringify(participants),
          references,
        ],
      );
      const intent = replyIntent({ sender, body, direction, nature });
      await db.query("select gmail_record_reply($1,$2)", [id, intent]);
      await db.query("select gmail_associate_continuous($1)", [id]);
      await db.query("select gmail_link_message($1,$2)", [
        id,
        JSON.stringify({ body }),
      ]);
      return id;
    };
    const cases = async () =>
      (
        await db.query<{
          id: string;
          stage: string;
          seller_id: string;
          mail_last_reply_at: string;
        }>("select * from opportunities order by created_at,id")
      ).rows;
    const old = await receive(
      "old@client.test",
      "Send me information",
      "2026-10-13T04:59:59.999Z",
      "old-campaign",
    );
    await receive("maybe@client.test", "Gracias", "2026-10-13T06:00:00Z");
    await receive(
      "no@client.test",
      "No estoy interesado",
      "2026-10-13T07:00:00Z",
    );
    await receive(
      "mailer-daemon@googlemail.com",
      "Send me information",
      "2026-10-13T07:30:00Z",
    );
    await receive(
      "old@client.test",
      "Call me",
      "2026-10-14T18:00:00Z",
      "old-campaign",
      "outbound",
    );
    assert.equal((await cases()).length, 0);
    assert.equal(
      (
        await db.query(
          "select * from gmail_candidate_directory where email='mailer-daemon@googlemail.com'",
        )
      ).rows.length,
      0,
    );
    const pending = (
      await db.query<{ email: string }>(
        "select * from gmail_candidate_directory where imported_at is null order by last_received_at desc nulls last,id",
      )
    ).rows;
    assert.deepEqual(
      pending.map((p) => p.email),
      ["no@client.test", "maybe@client.test", "old@client.test"],
    );

    // A new reply to the old campaign crosses the cutoff and creates both records.
    const positive = await receive(
      "old@client.test",
      "¿Qué tasas tienen?",
      "2026-10-13T08:00:00Z",
      "old-campaign",
    );
    let all = await cases();
    assert.equal(all.length, 1);
    assert.equal(all[0].stage, "replied");
    assert.equal(all[0].seller_id, seller);
    const first = all[0].id;
    assert.equal(
      (await db.query("select * from opportunity_inbox")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from gmail_candidate_directory where email='old@client.test' and imported_at is not null",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ verification: string }>(
          "select verification from contacts where email='old@client.test'",
        )
      ).rows[0].verification,
      "pending",
    );
    await db.query("select gmail_associate_continuous($1)", [positive]);
    assert.equal((await cases()).length, 1);
    await receive(
      "old@client.test",
      "Call me next month",
      "2026-10-13T09:00:00Z",
      "another-thread",
    );
    assert.equal((await cases()).length, 1);
    const negative = await receive(
      "old@client.test",
      "Ya no me interesa",
      "2026-10-13T10:00:00Z",
      "rejection-new-subject",
    );
    assert.equal((await cases())[0].stage, "lost");
    assert.equal(
      (await db.query("select * from opportunity_inbox")).rows.length,
      1,
    );
    // Reclassifying existing mail in the reverse order must reach the same state.
    await db.query(
      "update messages set reply_intent=null where conversation_id in (select id from conversations where opportunity_id=$1)",
      [first],
    );
    await db.query(
      "update opportunities set stage='new',mail_last_reply_at=null where id=$1",
      [first],
    );
    await db.query(
      "update messages set reply_intent='negative' where archive_message_id=$1",
      [negative],
    );
    assert.equal((await cases())[0].stage, "new");
    await db.query(
      "update messages set reply_intent='positive' where archive_message_id=$1",
      [positive],
    );
    assert.equal(
      (await cases())[0].stage,
      "lost",
      "The later rejection wins even when interest is classified last",
    );
    await db.query("select gmail_associate_continuous($1)", [positive]);
    assert.equal(
      (await cases()).length,
      1,
      "replaying old interest must not reopen a lost case",
    );

    const renewed = await receive(
      "old@client.test",
      "Quiero aplicar",
      "2026-10-14T11:00:00Z",
      "old-campaign",
    );
    all = await cases();
    assert.equal(all.length, 2);
    assert.equal(all.find((o) => o.id === first)?.stage, "lost");
    const second = all.find((o) => o.id !== first)!.id;
    assert.equal(all.find((o) => o.id === second)?.stage, "replied");
    const threads = (
      await db.query<{
        opportunity_id: string;
        gmail_thread_id: string;
        gmail_delivery_thread_id: string;
      }>(
        "select * from conversations where gmail_delivery_thread_id='old-campaign'",
      )
    ).rows;
    assert.equal(threads.length, 2);
    assert.equal(new Set(threads.map((t) => t.gmail_thread_id)).size, 2);
    // Backfilled old negatives cannot close the renewed case; evidence stays in both.
    await db.query("select gmail_link_message($1,$2)", [
      old,
      JSON.stringify({ body: "Send me information" }),
    ]);
    await db.query("select gmail_link_message($1,$2)", [
      renewed,
      JSON.stringify({ body: "Quiero aplicar" }),
    ]);
    assert.equal(
      (await cases()).find((o) => o.id === second)?.stage,
      "replied",
    );
    assert.equal(
      (
        await db.query(
          "select * from case_events where kind='mail_rejection' and opportunity_id=$1",
          [first],
        )
      ).rows.length,
      1,
    );

    // Lender rejection does not close the customer's opportunity.
    await db.query(
      "insert into lenders(name,email,channel) values('Funding LLC','deals@lender.test','email')",
    );
    const before = (await cases()).length;
    await receive(
      "deals@lender.test",
      "Not interested",
      "2026-10-14T12:00:00Z",
      "lender-standalone",
    );
    assert.equal((await cases()).length, before);
    assert.equal(
      (
        await db.query(
          "select * from mail_review where gmail_message_id in (select gmail_message_id from gmail_archive_messages where gmail_thread_id='lender-standalone')",
        )
      ).rows.length,
      1,
    );
    await receive(
      "deals@lender.test",
      "Not interested",
      "2026-10-14T12:10:00Z",
      "lender-reply",
      "inbound",
      "personal",
      `<${renewed}@mail.test>`,
    );
    assert.equal(
      (await cases()).find((o) => o.id === second)?.stage,
      "replied",
    );
    assert.equal(
      (
        await db.query(
          "select * from conversations where gmail_thread_id='lender-reply' and inbox_activated_at is not null",
        )
      ).rows.length,
      1,
    );

    // Manual approval is allowed for an ambiguous historical candidate.
    const manual = (
      await db.query<{ id: string; run_id: string }>(
        "select * from gmail_candidate_directory where email='maybe@client.test'",
      )
    ).rows[0];
    await db.query(
      "update gmail_candidates set selected=true,participant_kind='client',classification='active',company_name='Manual LLC' where id=$1",
      [manual.id],
    );
    await db.query("select gmail_confirm_candidates($1,$2,$3)", [
      manual.run_id,
      admin,
      manual.id,
    ]);
    const lease = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [manual.run_id],
      )
    ).rows[0].lease_token;
    await db.query("select gmail_apply_candidate($1,$2)", [manual.id, lease]);
    const evidence = (
      await db.query<{ id: string }>(
        "select id from gmail_archive_messages where gmail_thread_id='maybe@client.test'",
      )
    ).rows[0].id;
    await db.query("select gmail_link_message($1,$2)", [
      evidence,
      JSON.stringify({ body: "Gracias" }),
    ]);
    assert.equal(
      (
        await db.query(
          "select * from conversations where gmail_thread_id='maybe@client.test' and manually_incorporated_at is not null and inbox_activated_at is not null",
        )
      ).rows.length,
      1,
    );
    // A previously imported ambiguous contact can be reviewed without reimporting.
    const beforeReview = (await cases()).length;
    await db.query(
      "update conversations set manually_incorporated_at=null,inbox_activated_at=null where gmail_thread_id='maybe@client.test'",
    );
    await db.query(
      "update gmail_candidates set inbox_approved_at=null where id=$1",
      [manual.id],
    );
    await assert.rejects(
      db.query("select gmail_approve_interest($1,$2)", [manual.id, seller]),
      /Superadmin required/,
    );
    await db.query("select gmail_approve_interest($1,$2)", [manual.id, admin]);
    await db.query("select gmail_approve_interest($1,$2)", [manual.id, admin]);
    assert.equal((await cases()).length, beforeReview);
    assert.equal(
      (
        await db.query(
          "select * from conversations where gmail_thread_id='maybe@client.test' and inbox_activated_at is not null",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query("select * from case_events where dedupe_key=$1", [
          `manual-interest:${manual.id}`,
        ])
      ).rows.length,
      1,
    );
    // Replies in a renewed case still use the physical Gmail thread, not its CRM key.
    await db.query("insert into mail_permissions values($1,$2,true)", [
      account,
      seller,
    ]);
    const reply = (
      await db.query<{ id: string; conversation_id: string }>(
        "select * from messages where archive_message_id=$1 and conversation_id in (select id from conversations where opportunity_id=$2)",
        [renewed, second],
      )
    ).rows[0];
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claims','${JSON.stringify({ sub: seller, aal: "aal2" })}',false)`,
    );
    const queued = (
      await db.query<{ id: string }>(
        "select queue_mail_email($1,$2,'old@client.test','Funding','New reply','{}','{}','{}','{}','{}',null,$3,$4,null,'','Seller',$5) id",
        [second, account, reply.conversation_id, reply.id, randomUUID()],
      )
    ).rows[0].id;
    // Admin-only mailbox directory and service-only classification writes.
    assert.equal(
      (await db.query("select * from gmail_candidate_directory")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select gmail_record_reply($1,'positive')", [old]),
      /permission denied/,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ gmail_thread_id: string }>(
          "select gmail_thread_id from outbox where id=$1",
          [queued],
        )
      ).rows[0].gmail_thread_id,
      "old-campaign",
    );
    await db.query("select mark_sent($1,'accepted-reply','old-campaign')", [
      queued,
    ]);
    await db.query("select mark_sent($1,'accepted-reply','old-campaign')", [
      queued,
    ]);
    const accepted = (
      await db.query<{
        opportunity_id: string;
        gmail_delivery_thread_id: string;
      }>(
        "select c.* from conversations c join messages m on m.conversation_id=c.id where m.gmail_message_id='accepted-reply'",
      )
    ).rows;
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].opportunity_id, second);
    assert.equal(accepted[0].gmail_delivery_thread_id, "old-campaign");
  } finally {
    await db.close();
  }
});
