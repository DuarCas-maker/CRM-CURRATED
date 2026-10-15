import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
test("incremental approvals, pending team links, historical duplicate matching and independent lender sends are persistent and permissioned", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    grant usage on schema public,auth,storage to authenticated,anon,service_role;`);
    const migrations = (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of migrations.filter((f) => Number(f.slice(0, 3)) <= 18))
      await db.exec(await readFile(`supabase/migrations/${f}`, "utf8"));
    const legacyActor = randomUUID(),
      legacyAccount = randomUUID(),
      legacyRun = randomUUID(),
      legacyCandidate = randomUUID(),
      legacyMessage = randomUUID();
    await db.query(
      "insert into auth.users values($1,'legacy-admin@team.test')",
      [legacyActor],
    );
    await db.query(
      "insert into profiles(id,name,email,role) values($1,'Legacy admin','legacy-admin@team.test','superadmin')",
      [legacyActor],
    );
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id,status) values($1,'legacy@team.test','fixture',$2,'connected')",
      [legacyAccount, legacyActor],
    );
    await db.query(
      "insert into gmail_runs(id,account_id,purpose,status,phase,from_at,until_at,copy_since,created_by,approved_by,approved_at) values($1,$2,'historical','importing','import',now()-interval '1 year',now(),now()-interval '2 months',$3,$3,now())",
      [legacyRun, legacyAccount, legacyActor],
    );
    await db.query(
      "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,subject,sent_at,direction,nature,participants,encrypted_payload) values($1,$2,'legacy-message','legacy-thread','Historical customer',now(),'inbound','personal','[{\"role\":\"from\",\"email\":\" LEGACY@CLIENT.TEST \"}]','preserved-ciphertext')",
      [legacyMessage, legacyAccount],
    );
    await db.query(
      "insert into gmail_candidates(id,run_id,email,name,company_name,participant_kind,classification,message_count,inbound_count,outbound_count,campaign_count,attachment_count,copy_count,first_at,last_at,evidence_ids,selected) values($1,$2,'legacy@client.test','Legacy customer','Legacy LLC','client','active',1,1,0,0,0,0,now(),now(),array[$3::uuid],true)",
      [legacyCandidate, legacyRun, legacyMessage],
    );
    for (const f of migrations.filter((f) => Number(f.slice(0, 3)) > 18))
      await db.exec(await readFile(`supabase/migrations/${f}`, "utf8"));
    assert.equal(
      (
        await db.query(
          "select * from gmail_known_emails where email='legacy@client.test'",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from gmail_candidates where id=$1 and import_requested_at is not null",
          [legacyCandidate],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ encrypted_payload: string }>(
          "select encrypted_payload from gmail_archive_messages where id=$1",
          [legacyMessage],
        )
      ).rows[0].encrypted_payload,
      "preserved-ciphertext",
    );
    const admin = randomUUID(),
      seller = randomUUID(),
      outsider = randomUUID(),
      account = randomUUID(),
      run = randomUUID();
    for (const [id, role] of [
      [admin, "superadmin"],
      [seller, "seller"],
      [outsider, "seller"],
    ]) {
      await db.query("insert into auth.users values($1,$2)", [
        id,
        `${id}@team.test`,
      ]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,$2::text,$3,$2::app_role)",
        [id, role, `${id}@team.test`],
      );
    }
    const asUser = async (id: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, aal: "aal2" }),
      ]);
      await db.exec("set role authenticated");
    };
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id,status) values($1,'daniel@team.test','fixture',$2,'connected')",
      [account, seller],
    );
    await db.query(
      "insert into gmail_runs(id,account_id,purpose,from_at,until_at,copy_since,created_by,status,phase) values($1,$2,'historical',now()-interval '1 year',now(),now()-interval '2 months',$3,'review','preview')",
      [run, account, admin],
    );
    const archive = randomUUID(),
      teamArchive = randomUUID();
    await db.query(
      "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,subject,sent_at,direction,nature,participants,encrypted_payload) values($1,$2,'customer-1','client-thread','Application - Client A',now(),'inbound','personal',$3,'fixture'),($4,$2,'team-1','team-thread','Funding - Client A',now(),'inbound','personal',$5,'fixture')",
      [
        archive,
        account,
        JSON.stringify([
          { role: "from", email: "client-a@client.test" },
          { role: "to", email: "daniel@team.test" },
        ]),
        teamArchive,
        JSON.stringify([
          { role: "from", email: "valentina@team.test" },
          { role: "to", email: "daniel@team.test" },
        ]),
      ],
    );
    await db.query("insert into gmail_run_messages values($1,$2),($1,$3)", [
      run,
      archive,
      teamArchive,
    ]);
    await db.query(
      "insert into gmail_team_members(email,name,affiliation,team_role,updated_by) values('valentina@team.test','Valentina','internal','seller',$1)",
      [admin],
    );
    const candidate = randomUUID(),
      nextCandidate = randomUUID(),
      teamCandidate = randomUUID();
    await db.query(
      "insert into gmail_candidates(id,run_id,email,name,company_name,participant_kind,classification,message_count,inbound_count,outbound_count,campaign_count,attachment_count,copy_count,first_at,last_at,evidence_ids,selected) values($1,$4,'client-a@client.test','A','Client A','client','active',1,1,0,0,0,0,now(),now(),array[$5::uuid],true),($2,$4,'client-b@client.test','B','Client B','client','active',0,0,0,0,0,0,now(),now(),'{}',true),($3,$4,'valentina@team.test','Valentina','','team','unknown',1,1,0,0,0,0,now(),now(),array[$6::uuid],false)",
      [candidate, nextCandidate, teamCandidate, run, archive, teamArchive],
    );
    await db.query("select gmail_prepare_association($1,$2,$3,$4)", [
      teamCandidate,
      candidate,
      teamArchive,
      admin,
    ]);
    assert.equal(
      (await db.query("select * from opportunities")).rows.length,
      0,
    );
    await asUser(seller);
    await assert.rejects(
      db.query("select * from gmail_known_emails"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select crm_command('create_lead',$1,$2)", [
        JSON.stringify({
          email: " CLIENT-A@CLIENT.TEST ",
          contact: "A",
          company: "Client A",
        }),
        randomUUID(),
      ]),
      /historial de Gmail/,
    );
    await db.exec("reset role");
    const batch = randomUUID();
    await db.query(
      "select register_import($1,'fixture.csv','private', '{}','',1,$2,$3)",
      [batch, admin, randomUUID()],
    );
    await db.query("select ingest_import_chunk($1,$2)", [
      batch,
      JSON.stringify([
        {
          row_number: 2,
          valid: true,
          email: "CLIENT-A@CLIENT.TEST",
          contact: "A",
          company: "Client A",
        },
      ]),
    ]);
    assert.equal(
      (
        await db.query<{ result: string }>(
          "select result from import_rows where batch_id=$1",
          [batch],
        )
      ).rows[0].result,
      "duplicate",
    );
    assert.equal((await db.query("select * from leads")).rows.length, 0);
    await db.query(
      "update gmail_candidates set attachment_count=1 where id=$1",
      [candidate],
    );
    await assert.rejects(
      db.query("select gmail_confirm_candidates($1,$2,$3)", [
        run,
        admin,
        candidate,
      ]),
      /Review attachment/,
    );
    await asUser(seller);
    await assert.rejects(
      db.query("select gmail_review_candidate_attachments($1,$2)", [
        candidate,
        run,
      ]),
      /Finish analysis/,
    );
    await asUser(admin);
    await db.query("select gmail_review_candidate_attachments($1,$2)", [
      candidate,
      run,
    ]);
    await db.exec("reset role");
    await db.query("select gmail_confirm_candidates($1,$2,$3)", [
      run,
      admin,
      candidate,
    ]);
    await db.query("select gmail_confirm_candidates($1,$2,$3)", [
      run,
      admin,
      candidate,
    ]);
    assert.equal(
      (await db.query("select * from jobs where kind='gmail_archive'")).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from gmail_candidates where id=$1 and import_requested_at is null",
          [nextCandidate],
        )
      ).rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        "update gmail_candidates set company_name='Changed during import' where id=$1",
        [candidate],
      ),
      /already queued/,
    );
    const lease = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [run],
      )
    ).rows[0].lease_token;
    const apply = async (c: string, l: string) =>
      (
        await db.query<{ id: string }>(
          "select gmail_apply_candidate($1,$2) id",
          [c, l],
        )
      ).rows[0].id;
    assert.equal(await apply(nextCandidate, lease), null);
    const caseId = await apply(candidate, lease);
    assert.equal(await apply(candidate, lease), caseId);
    assert.ok(
      (
        await db.query(
          "select * from gmail_pending_associations where applied_at is not null",
        )
      ).rows.length,
    );
    assert.equal(
      (await db.query("select * from verifications")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from gmail_thread_links where opportunity_id=$1",
          [caseId],
        )
      ).rows.length,
      2,
    );
    await db.query("select gmail_confirm_candidates($1,$2,$3)", [
      run,
      admin,
      nextCandidate,
    ]);
    assert.equal(
      (
        await db.query<{ done: boolean }>(
          "select gmail_finish_incremental_import($1,$2) done",
          [run, lease],
        )
      ).rows[0].done,
      false,
    );
    await apply(nextCandidate, lease);
    assert.equal(
      (
        await db.query<{ done: boolean }>(
          "select gmail_finish_incremental_import($1,$2) done",
          [run, lease],
        )
      ).rows[0].done,
      true,
    );
    assert.equal(
      (await db.query("select * from opportunities")).rows.length,
      2,
    );
    const third = randomUUID(),
      continuous = randomUUID();
    await db.query(
      "insert into gmail_candidates(id,run_id,email,name,company_name,participant_kind,classification,message_count,inbound_count,outbound_count,campaign_count,attachment_count,copy_count,first_at,last_at,evidence_ids,selected) values($1,$2,'client-c@client.test','C','Client C','client','active',0,0,0,0,0,0,now(),now(),'{}',true)",
      [third, run],
    );
    await db.query(
      "insert into gmail_runs(id,account_id,purpose,from_at,until_at,copy_since,created_by,status,phase) values($1,$2,'continuous',now()-interval '1 day',now(),now(),$3,'analyzing','list')",
      [continuous, account, admin],
    );
    await db.query("select gmail_confirm_candidates($1,$2,$3)", [
      run,
      admin,
      third,
    ]);
    await db.query("select gmail_activate_pending_imports()");
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from gmail_runs where id=$1",
          [run],
        )
      ).rows[0].status,
      "completed",
    );
    await db.query("update gmail_runs set status='completed' where id=$1", [
      continuous,
    ]);
    await db.query("select gmail_activate_pending_imports()");
    const renewed = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [run],
      )
    ).rows[0].lease_token;
    await apply(third, renewed);
    assert.equal(
      (
        await db.query<{ done: boolean }>(
          "select gmail_finish_incremental_import($1,$2) done",
          [run, renewed],
        )
      ).rows[0].done,
      true,
    );
    await db.query("select gmail_link_message($1,$2)", [
      teamArchive,
      JSON.stringify({ body: "We have the documents" }),
    ]);
    const process = (
      await db.query<{ id: string }>(
        "select id from financing_processes where opportunity_id=$1",
        [caseId],
      )
    ).rows[0].id;
    const lenders = [randomUUID(), randomUUID()];
    await db.query(
      "insert into lenders(id,name,email,channel) values($1,'Lender A','anthony@lender.test','email'),($2,'Lender B','other@lender.test','email')",
      lenders,
    );
    await asUser(admin);
    await db.query("select register_lender_contact($1,'submit@lender.test')", [
      lenders[0],
    ]);
    await assert.rejects(
      db.query("select register_lender_contact($1,'submit@lender.test')", [
        lenders[1],
      ]),
      /another lender/,
    );
    const request = randomUUID(),
      targets = JSON.stringify([
        { lender_id: lenders[0], email: "anthony@lender.test" },
        { lender_id: lenders[1], email: "other@lender.test" },
      ]);
    await db.exec("reset role");
    await db.query("select initialize_checklist($1,'MCA')", [caseId]);
    await db.query(
      "update documents set status='approved',storage_path='fixture.pdf',content_hash=repeat(md5(id::text),2) where opportunity_id=$1 and kind in ('application','bank_statement')",
      [caseId],
    );
    await asUser(admin);
    const queue = async (key = request, subject = "Client A") =>
      db.query(
        "select queue_lender_emails($1,$2,$3,$4,$5,'Please evaluate','{}','{}',$6)",
        [caseId, account, process, targets, subject, key],
      );
    await queue();
    await queue();
    await assert.rejects(queue(request, "Changed"), /different input/);
    await db.exec("reset role");
    const outbox = (
      await db.query<{ id: string; submission_id: string; to_email: string }>(
        "select * from outbox where opportunity_id=$1 order by to_email",
        [caseId],
      )
    ).rows;
    assert.equal(outbox.length, 2);
    assert.notEqual(outbox[0].submission_id, outbox[1].submission_id);
    assert.equal(
      (await db.query("select * from submissions where status='draft'")).rows
        .length,
      2,
    );
    await db.query(
      "update outbox set status='sending',sending_at=now() where id=$1",
      [outbox[0].id],
    );
    await db.query("select mark_sent($1,'sent-1','new-lender-thread')", [
      outbox[0].id,
    ]);
    await db.query("select mark_sent($1,'sent-1','new-lender-thread')", [
      outbox[0].id,
    ]);
    assert.equal(
      (await db.query("select * from messages where gmail_message_id='sent-1'"))
        .rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from conversation_lenders")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query("select * from conversations where process_id=$1", [
          process,
        ])
      ).rows.length,
      2,
    );
    await asUser(outsider);
    await assert.rejects(queue(randomUUID()), /Closer case editing/);
    assert.equal(
      (await db.query("select * from conversation_lenders")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
