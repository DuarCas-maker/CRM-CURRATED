import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

test("lender directory upgrade backfills mixed history and queues company-specific replies without crossing case, company, account or evaluation permissions", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      grant usage on schema public,auth,storage to authenticated,anon,service_role;`);
    const files = (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files.filter((f) => Number(f.slice(0, 3)) < 22))
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const seller = randomUUID(),
      outsider = randomUUID(),
      admin = randomUUID();
    for (const [id, role, email] of [
      [seller, "seller", "daniel@curatedfinancial.com"],
      [outsider, "seller", "outsider@curatedfinancial.com"],
      [admin, "superadmin", "admin@curatedfinancial.com"],
    ]) {
      await db.query("insert into auth.users values($1,$2)", [id, email]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,$2,$3,$4::app_role)",
        [id, role, email, role],
      );
    }
    const account = randomUUID(),
      second = randomUUID(),
      contact = randomUUID(),
      caseId = randomUUID(),
      process = randomUUID(),
      conversation = randomUUID(),
      fundpro = randomUUID(),
      submission = randomUUID();
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id) values($1,'daniel@curatedfinancial.com','org',$3),($2,'laura@curatedfinancial.com','org',$3)",
      [account, second, seller],
    );
    await db.query(
      "insert into mail_permissions values($1,$3,true),($2,$3,true)",
      [account, second, seller],
    );
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,'newday@gmail.com','New Day','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id,email_qualified_at) values($1,$2,'RUDRA SG HOLDINGS LLC',$3,now())",
      [caseId, contact, seller],
    );
    await db.query(
      "insert into financing_processes(id,opportunity_id,sequence_number,label,started_at,classification) values($1,$2,1,'Funding application',now(),'active')",
      [process, caseId],
    );
    await db.query(
      "insert into lenders(id,name,email,channel,notes) values($1,'Fund Pro LLC','brandon@fundprollc.com','email','Keep existing notes')",
      [fundpro],
    );
    await db.query(
      "insert into submissions(id,opportunity_id,lender_id,closer_id,channel,next_action,next_action_at,process_id) values($1,$2,$3,$4,'email','Follow up',now(),$5)",
      [submission, caseId, fundpro, admin, process],
    );
    await db.query(
      "insert into conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area,process_id,submission_id) values($1,$2,$3,'shared-gmail-thread','Funding application','closer',$4,$5)",
      [conversation, caseId, account, process, submission],
    );
    const original = randomUUID(),
      fpReply = randomUUID(),
      fantasticReply = randomUUID();
    const insert = async (
      id: string,
      sender: string,
      direction = "inbound",
      to: string[] = ["daniel@curatedfinancial.com"],
      nature = "personal",
    ) => {
      await db.query(
        "insert into messages(id,conversation_id,gmail_message_id,direction,sender,body,sent_at,status,internet_message_id,references_header,participants,nature) values($1::uuid,$2,$1::text,$3,$4,'Original content',now(),'received',$5,'<original>', $6::jsonb,$7)",
        [
          id,
          conversation,
          direction,
          sender,
          `<${id}>`,
          JSON.stringify(to.map((email) => ({ role: "to", email }))),
          nature,
        ],
      );
    };
    await insert(original, "daniel@curatedfinancial.com", "outbound", [
      "brandon@fundprollc.com",
      "uw@fantastic-funding.com",
    ]);
    await insert(fpReply, "brandon@fundprollc.com");
    await insert(fantasticReply, "uw@fantastic-funding.com");
    const before = (await db.query("select * from messages order by id")).rows;
    await db.exec(
      await readFile(
        "supabase/migrations/022_lender_company_conversations.sql",
        "utf8",
      ),
    );
    assert.deepEqual(
      (await db.query("select * from messages order by id")).rows,
      before,
      "migration cannot rewrite stored messages",
    );
    assert.equal(
      (await db.query("select * from lenders where name='Fund Pro LLC'")).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query<{ notes: string }>(
          "select notes from lenders where id=$1",
          [fundpro],
        )
      ).rows[0].notes,
      "Keep existing notes",
    );
    assert.equal(
      (
        await db.query(
          "select * from lenders where notes not like '[Provisional]%'",
        )
      ).rows.length,
      32,
    );
    assert.equal(
      (await db.query("select * from lender_contacts where name<>''")).rows
        .length,
      55,
    );
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select name from lender_contacts where email='brandon@fundprollc.com'",
        )
      ).rows[0].name,
      "Brandon",
    );
    const fantastic = (
      await db.query<{ id: string }>(
        "select id from lenders where email='uw@fantastic-funding.com'",
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query(
          "select * from conversation_lenders where conversation_id=$1",
          [conversation],
        )
      ).rows.length,
      2,
    );
    assert.equal(
      (
        await db.query<{ firm: string }>(
          "select mail_lender_for('OTHER@FUNDPROLLC.COM') firm",
        )
      ).rows[0].firm,
      fundpro,
    );
    assert.equal(
      (
        await db.query<{ firm: string }>(
          "select mail_lender_for('random@gmail.com') firm",
        )
      ).rows[0].firm,
      null,
    );
    await insert(randomUUID(), "anna@fantastic-funding.com");
    await insert(
      randomUUID(),
      "notifications@automatic-mail.test",
      "inbound",
      undefined,
      "automatic",
    );
    await insert(randomUUID(), "newday@gmail.com");
    assert.equal((await db.query("select * from lenders")).rows.length, 33);
    assert.equal(
      (
        await db.query<{ lender_id: string }>(
          "select lender_id from lender_contacts where email='anna@fantastic-funding.com'",
        )
      ).rows[0].lender_id,
      fantastic,
    );
    const asUser = async (id: string, aal = "aal2") => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, aal }),
      ]);
      await db.exec("set role authenticated");
    };
    const input = {
      case_id: caseId,
      account,
      lender: fantastic,
      conversation,
      reply_message: fantasticReply,
      recipient: "uw@fantastic-funding.com",
      copies: ["laura@curatedfinancial.com"],
      hidden_copies: [],
      subject_text: "Funding application",
      body_text: "Thank you",
      files: [],
      gmail_files: [],
      uploads: [],
      process,
      submission: null,
      signature: "",
      display_name: "",
      request: randomUUID(),
    };
    const queue = async (changes = {}) =>
      (
        await db.query<{ id: string }>(
          "select queue_lender_reply($1::jsonb) id",
          [JSON.stringify({ ...input, ...changes })],
        )
      ).rows[0].id;
    await asUser(seller);
    const send = await queue();
    assert.equal(await queue(), send, "retry must not create another send");
    await db.exec("reset role");
    const row = (
      await db.query<{
        to_email: string;
        submission_id: string | null;
        reply_message_id: string;
        gmail_thread_id: string;
      }>("select * from outbox where id=$1", [send])
    ).rows[0];
    assert.equal(row.to_email, "uw@fantastic-funding.com");
    assert.equal(row.submission_id, null);
    assert.equal(row.reply_message_id, fantasticReply);
    assert.equal(row.gmail_thread_id, "shared-gmail-thread");
    await asUser(seller);
    await assert.rejects(
      queue({ recipient: "newday@gmail.com", request: randomUUID() }),
      /Recipient must belong/,
    );
    await assert.rejects(
      queue({ copies: ["newday@gmail.com"], request: randomUUID() }),
      /Customer recipients/,
    );
    await assert.rejects(
      queue({ copies: ["brandon@fundprollc.com"], request: randomUUID() }),
      /Copies cannot include/,
    );
    await assert.rejects(
      queue({ reply_message: fpReply, request: randomUUID() }),
      /Reply must belong/,
    );
    await assert.rejects(
      queue({ submission, request: randomUUID() }),
      /Evaluation belongs/,
    );
    const otherSend = await queue({
      account: second,
      reply_message: original,
      request: randomUUID(),
    });
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ gmail_thread_id: string | null }>(
          "select gmail_thread_id from outbox where id=$1",
          [otherSend],
        )
      ).rows[0].gmail_thread_id,
      null,
      "another mailbox uses RFC headers rather than a foreign mailbox's Gmail thread ID",
    );
    await asUser(outsider);
    await assert.rejects(
      queue({ request: randomUUID() }),
      /Case access required/,
    );
    await asUser(seller, "aal1");
    await assert.rejects(
      queue({ request: randomUUID() }),
      /Case access required/,
    );
    await asUser(seller);
    await assert.rejects(
      queue({ account: randomUUID(), request: randomUUID() }),
      /sender access required/,
    );
    await assert.rejects(
      db.query("select mail_index_lender_message($1,true)", [fantasticReply]),
      /permission denied/,
    );
    await db.query(
      "select register_mail_contact($1,'sales@fundprollc.com','Sales contact',$2)",
      [caseId, fundpro],
    );
    await asUser(admin);
    await db.query(
      "select register_named_lender_contact($1,'support@fundprollc.com','Support')",
      [fundpro],
    );
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select name from lender_contacts where email='sales@fundprollc.com'",
        )
      ).rows[0].name,
      "Sales contact",
    );
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select name from lender_contacts where email='support@fundprollc.com'",
        )
      ).rows[0].name,
      "Support",
    );
    // Exercise the new upgrade on historical identities, including a false
    // internal lender and an alias with actual commercial/routing references.
    await db.exec("reset role");
    const incorrect = randomUUID(),
      alias = randomUUID(),
      aliasSubmission = randomUUID();
    await db.query(
      "insert into lenders(id,name,email,channel,notes) values($1,'Por confirmar · curatedfinancial.com','ricardo@curatedfinancial.com','email','[Provisional]'),($2,'Por confirmar · fundingfutures.biz','sarahs@fundingfutures.biz','email','[Provisional]')",
      [incorrect, alias],
    );
    await db.query(
      "insert into conversation_lenders values($1,$2),($1,$3) on conflict do nothing",
      [conversation, incorrect, alias],
    );
    await db.query(
      "insert into submissions(id,opportunity_id,lender_id,closer_id,channel,next_action,next_action_at,process_id) values($1,$2,$3,$4,'email','Follow up',now(),$5)",
      [aliasSubmission, caseId, alias, admin, process],
    );
    const historyBefore = (await db.query("select * from messages order by id"))
      .rows;
    await db.exec(
      await readFile(
        "supabase/migrations/023_lender_directory_portals.sql",
        "utf8",
      ),
    );
    assert.deepEqual(
      (await db.query("select * from messages order by id")).rows,
      historyBefore,
    );
    assert.equal(
      (
        await db.query(
          "select * from lender_contacts where email='' or email='ricardo@curatedfinancial.com'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from conversation_lenders where lender_id=$1",
          [incorrect],
        )
      ).rows.length,
      0,
    );
    assert(
      (
        await db.query<{ archived_at: string }>(
          "select archived_at from lenders where id=$1",
          [incorrect],
        )
      ).rows[0].archived_at,
    );
    assert.equal(
      (
        await db.query(
          "select * from lenders where archived_at is null and channel='portal' and email=''",
        )
      ).rows.length,
      3,
    );
    assert.equal(
      (await db.query("select * from lenders where archived_at is null")).rows
        .length,
      67,
    );
    const futures = (
      await db.query<{ id: string }>(
        "select id from lenders where name='Funding Futures' and archived_at is null",
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query<{ lender_id: string }>(
          "select lender_id from submissions where id=$1",
          [aliasSubmission],
        )
      ).rows[0].lender_id,
      futures,
    );
    assert.equal(
      (
        await db.query<{ lender_id: string }>(
          "select lender_id from lender_contacts where email='sarahs@fundingfutures.biz'",
        )
      ).rows[0].lender_id,
      futures,
    );
    assert.equal(
      (
        await db.query<{ lender_id: string }>(
          "select lender_id from lender_contacts where email='fundmefastllc@gmail.com'",
        )
      ).rows[0].lender_id,
      (
        await db.query<{ lender_id: string }>(
          "select lender_id from lender_contacts where email='subs@fundsmefast.com'",
        )
      ).rows[0].lender_id,
    );
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select mail_lender_for('ricardo@curatedfinancial.com') id",
        )
      ).rows[0].id,
      null,
    );
    const itria = (
      await db.query<{ lender_id: string }>(
        "select lender_id from lender_contacts where email='aaron.smith@biz2credit.com'",
      )
    ).rows[0].lender_id;
    assert.equal(
      (
        await db.query<{ lender_id: string }>(
          "select lender_id from lender_contacts where email='mitchell@bellprocessingsolutions.com'",
        )
      ).rows[0].lender_id,
      itria,
    );
    await asUser(seller);
    await assert.rejects(
      db.query("select crm_command('create_lender',$1,$2)", [
        JSON.stringify({
          name: "Unauthorized portal",
          email: "",
          products: "",
          channel: "portal",
          notes: "Portal: https://portal.example.test",
        }),
        randomUUID(),
      ]),
      /administrator required/,
    );
    await asUser(admin);
    for (const name of ["Portal one", "Portal two"])
      await db.query("select crm_command('create_lender',$1,$2)", [
        JSON.stringify({
          name,
          email: "",
          products: "",
          channel: "portal",
          notes: "Portal: https://portal.example.test",
        }),
        randomUUID(),
      ]);
    await assert.rejects(
      db.query("select crm_command('create_lender',$1,$2)", [
        JSON.stringify({
          name: "No email",
          email: "",
          products: "",
          channel: "email",
        }),
        randomUUID(),
      ]),
      /Portal URL required/,
    );
    await assert.rejects(
      db.query(
        "select register_named_lender_contact($1,'ricardo@curatedfinancial.com','Ricardo')",
        [fundpro],
      ),
      /Internal address/,
    );
  } finally {
    await db.close();
  }
});
