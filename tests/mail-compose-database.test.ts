import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

test("manual email is transactional, permissioned, idempotent, recoverable and associated with its case", async () => {
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
      other = randomUUID(),
      closer = randomUUID(),
      account = randomUUID();
    for (const [id, role] of [
      [seller, "seller"],
      [other, "seller"],
      [closer, "closer"],
    ]) {
      await db.query("insert into auth.users values($1,$2)", [
        id,
        `${id}@example.com`,
      ]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,$2::text,$3,$2::app_role)",
        [id, role, `${id}@example.com`],
      );
    }
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id,status) values($1,'owner@example.com','fixture',$2,'connected')",
      [account, seller],
    );
    await db.query(
      "insert into mail_permissions values($1,$2,true),($1,$3,true)",
      [account, seller, closer],
    );
    const contact = randomUUID(),
      caseId = randomUUID(),
      foreignCase = randomUUID();
    await db.query(
      "insert into contacts(id,name,email,verification) values($1,'Client','client@example.com','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Client LLC',$3),($4,$2,'Other LLC',$5)",
      [caseId, contact, seller, foreignCase, other],
    );
    const approved = randomUUID(),
      foreignFile = randomUUID(),
      pendingFile = randomUUID();
    await db.query(
      "insert into documents(id,opportunity_id,name,kind,status,storage_path,period) values($1,$2,'Approved','additional','approved','private/approved.pdf','approved'),($3,$4,'Other case','additional','approved','private/other.pdf','other'),($5,$2,'Unreviewed','additional','received','private/pending.pdf','pending')",
      [approved, caseId, foreignFile, foreignCase, pendingFile],
    );
    const asUser = async (id: string, aal = "aal2") => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, aal }),
      ]);
      await db.exec("set role authenticated");
    };
    const queue = async (
      key = randomUUID(),
      subject = "Prueba",
      docs: string[] = [],
      target = caseId,
    ) =>
      (
        await db.query<{ id: string }>(
          "select queue_manual_email($1,$2,$3,$4,$5,$6,$7,$8) id",
          [
            target,
            account,
            "test@example.com",
            subject,
            "Mensaje personal",
            docs,
            [],
            key,
          ],
        )
      ).rows[0].id;
    await asUser(seller, "aal1");
    await assert.rejects(queue(), /read-only/);
    await asUser(seller);
    await assert.rejects(
      queue(randomUUID(), "Subject\r\nBcc: injected@example.com"),
      /Invalid email fields/,
    );
    await assert.rejects(
      queue(randomUUID(), "Test", [randomUUID()]),
      /Approved case attachments/,
    );
    await assert.rejects(
      queue(randomUUID(), "Test", [foreignFile]),
      /Approved case attachments/,
    );
    await assert.rejects(
      queue(randomUUID(), "Test", [pendingFile]),
      /Approved case attachments/,
    );
    await assert.rejects(
      queue(randomUUID(), "Test", [], foreignCase),
      /read-only/,
    );
    await asUser(other);
    await assert.rejects(
      queue(randomUUID(), "Test", [], foreignCase),
      /Sender permission/,
    );
    await asUser(seller);
    const key = randomUUID(),
      send = await queue(key, "Prueba", [approved]);
    assert.equal(await queue(key, "Prueba", [approved]), send);
    await assert.rejects(queue(key, "Changed"), /Request key reused/);
    assert.equal(
      (await db.query("select * from mail_send_status($1)", [[caseId]])).rows
        .length,
      1,
    );
    await asUser(other);
    assert.equal(
      (await db.query("select * from mail_send_status($1)", [[caseId]])).rows
        .length,
      0,
    );
    await db.exec("reset role");
    // Convert this fixture to the independently approved historical path; its
    // contact remains unverified. The delivery gate must preserve this exception.
    await db.query(
      "update opportunities set email_qualified_at=null,historical_approved_at=now() where id=$1",
      [caseId],
    );
    await db.query("update contacts set verification='pending' where id=$1", [
      contact,
    ]);
    const claimed = (
      await db.query<{ id: string; send_attempts: number }>(
        "select * from claim_outbox()",
      )
    ).rows[0];
    assert.equal(claimed.id, send);
    assert.equal(claimed.send_attempts, 1);
    await db.query(
      "select defer_gmail_send($1,7200,'GMAIL_HTTP_403_rateLimitExceeded')",
      [send],
    );
    assert.equal(
      (await db.query("select * from claim_outbox()")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from mail_accounts where id=$1",
          [account],
        )
      ).rows[0].status,
      "connected",
    );
    await asUser(seller);
    const second = await queue();
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from claim_outbox()")).rows.length,
      0,
      "New messages also respect the account wait",
    );
    assert.ok(
      (
        await db.query<{ waiting: boolean }>(
          "select available_at>now()+interval '119 minutes' as waiting from outbox where id=$1",
          [second],
        )
      ).rows[0].waiting,
    );
    await db.query("update mail_accounts set send_retry_at=null where id=$1", [
      account,
    ]);
    await db.query(
      "update outbox set available_at=now()-interval '1 second' where id=$1",
      [send],
    );
    assert.equal(
      (await db.query<{ id: string }>("select * from claim_outbox()")).rows[0]
        .id,
      send,
    );
    await db.query("select mark_sent($1,'gmail-id','new-thread')", [send]);
    await db.query("select mark_sent($1,'gmail-id','new-thread')", [send]);
    const thread = (
      await db.query<{ opportunity_id: string; recipient_email: string }>(
        "select * from conversations where gmail_thread_id='new-thread'",
      )
    ).rows[0];
    assert.equal(thread.opportunity_id, caseId);
    assert.equal(thread.recipient_email, "test@example.com");
    assert.equal(
      (
        await db.query(
          "select * from messages where gmail_message_id='gmail-id'",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from verifications")).rows.length,
      0,
      "Manual historical mail never starts Bouncer",
    );
    // Handoff requires a closer and keeps seller access read-only; sending client
    // mail in the closer phase does not invent a lender submission.
    await db.query(
      "update opportunities set handed_off_at=now(),closer_id=$2 where id=$1",
      [caseId, closer],
    );
    await asUser(seller);
    await assert.rejects(queue(), /read-only/);
    await asUser(closer);
    const closerSend = await queue();
    await db.exec("reset role");
    await db.query("update outbox set status='sending' where id=$1", [
      closerSend,
    ]);
    await db.query("select mark_sent($1,'closer-id','closer-thread')", [
      closerSend,
    ]);
    assert.equal(
      (
        await db.query<{ area: string }>(
          "select area from conversations where gmail_thread_id='closer-thread'",
        )
      ).rows[0].area,
      "closer",
    );
    await asUser(seller);
    assert.equal(
      (
        await db.query("select * from mail_send_status($1)", [[caseId]])
      ).rows.some((r: any) => r.id === closerSend),
      false,
    );
  } finally {
    await db.close();
  }
});
