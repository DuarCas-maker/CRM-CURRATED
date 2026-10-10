import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

test("Gmail history is controlled, recoverable, permissioned, and separate from new-lead validation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon,service_role;grant select on storage.objects to authenticated;`);
    const migrationFiles = (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const upgrade = await readFile(
      "supabase/install/gmail-history.sql",
      "utf8",
    );
    for (const file of migrationFiles) {
      const migration = await readFile(`supabase/migrations/${file}`, "utf8");
      if (Number(file.slice(0, 3)) <= 8) await db.exec(migration);
      else if (Number(file.slice(0, 3)) <= 15)
        assert.ok(
          upgrade.includes(
            migration.replace(/^\s*(begin|commit);\s*$/gim, "").trim(),
          ),
          `Upgrade bundle differs from ${file}`,
        );
    }
    await db.exec(upgrade);
    for (const file of migrationFiles.filter((f) => Number(f.slice(0, 3)) > 15))
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const admin = randomUUID(),
      seller = randomUUID(),
      other = randomUUID(),
      account = randomUUID(),
      run = randomUUID();
    for (const [id, role] of [
      [admin, "superadmin"],
      [seller, "seller"],
      [other, "seller"],
    ]) {
      await db.query("insert into auth.users values($1,$2)", [
        id,
        `${id}@example.com`,
      ]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,$2::text,$3,$2::public.app_role)",
        [id, role, `${id}@example.com`],
      );
    }
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id) values($1,'seller@example.com','org',$2)",
      [account, seller],
    );
    await db.query(
      "insert into mail_permissions values($1,$2,true),($1,$3,true)",
      [account, seller, other],
    );
    await db.query(
      "insert into gmail_runs(id,account_id,purpose,from_at,until_at,copy_since,created_by) values($1,$2,'historical',now()-interval '1 year',now(),now()-interval '2 months',$3)",
      [run, account, admin],
    );
    const claim = async () =>
      (
        await db.query<{ lease_token: string }>(
          "select * from gmail_claim_run($1)",
          [run],
        )
      ).rows[0]?.lease_token;
    let lease = await claim();
    assert.ok(lease);
    assert.equal(await claim(), undefined);
    const sentAt = new Date(Date.now() - 7 * 86400000).toISOString();
    const entry = {
      gmail_message_id: "m1",
      gmail_thread_id: "thread1",
      subject: "Campaign prospect",
      sent_at: sentAt,
      direction: "outbound",
      nature: "campaign",
      participants: [
        { email: "customer@customer.com", name: "Customer", role: "to" },
        { email: "copy@copied.com", name: "Copy", role: "cc" },
      ],
      attachment_index: [
        {
          part_id: "0.1",
          name: "statement.pdf",
          size: 20,
          mime_type: "application/pdf",
        },
      ],
      encrypted_payload: "encrypted-fixture",
    };
    const store = async () =>
      (
        await db.query<{ id: string }>(
          "select gmail_store_message($1,$2,$3) id",
          [run, lease, JSON.stringify(entry)],
        )
      ).rows[0].id;
    const archiveId = await store();
    assert.equal(await store(), archiveId);
    assert.equal(
      (
        await db.query<{ scanned: number }>(
          "select scanned from gmail_runs where id=$1",
          [run],
        )
      ).rows[0].scanned,
      1,
    );
    await db.query(
      "update gmail_runs set status='paused',resume_status='analyzing',lease_token=null,lease_until=null where id=$1",
      [run],
    );
    await assert.rejects(store(), /lease lost|paused/);
    await db.query("update gmail_runs set status='analyzing' where id=$1", [
      run,
    ]);
    lease = await claim();
    await db.query("select gmail_build_preview($1,$2)", [run, lease]);
    assert.equal(
      (await db.query("select * from opportunities")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from contacts")).rows.length, 0);
    assert.equal(
      (await db.query("select * from verifications")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from outbox")).rows.length, 0);
    const candidate = (
      await db.query<{ id: string; copied_only: boolean }>(
        "select * from gmail_candidates where email='customer@customer.com' and run_id=$1",
        [run],
      )
    ).rows[0];
    assert.equal(candidate.copied_only, false);
    assert.equal(
      (
        await db.query<{ copied_only: boolean }>(
          "select copied_only from gmail_candidates where email='copy@copied.com'",
        )
      ).rows[0].copied_only,
      true,
    );
    await db.query(
      "update gmail_candidates set selected=true,participant_kind='client',classification='active',company_name='Customer LLC' where id=$1",
      [candidate.id],
    );
    await db.query(
      "update gmail_runs set status='importing',phase='import',approved_by=$2,approved_at=now() where id=$1",
      [run, admin],
    );
    lease = await claim();
    const apply = async () =>
      (
        await db.query<{ id: string }>(
          "select gmail_apply_candidate($1,$2) id",
          [candidate.id, lease],
        )
      ).rows[0].id;
    const caseId = await apply();
    assert.equal(await apply(), caseId);
    assert.equal(
      (await db.query("select * from opportunities")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from financing_processes")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ verification: string }>(
          "select verification from contacts where email='customer@customer.com'",
        )
      ).rows[0].verification,
      "pending",
    );
    assert.equal(
      (await db.query("select * from verifications")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from outbox")).rows.length, 0);
    const link = async (nature = "campaign", body = "Campaign text") => {
      await db.query(
        "update gmail_archive_messages set nature=$2 where id=$1",
        [archiveId, nature],
      );
      return db.query("select gmail_link_message($1,$2)", [
        archiveId,
        JSON.stringify({ body }),
      ]);
    };
    await link();
    await link();
    assert.equal((await db.query("select * from messages")).rows.length, 1);
    assert.equal(
      (await db.query("select * from gmail_saved_attachments")).rows.length,
      1,
    );
    assert.equal((await db.query("select * from mail_waits")).rows.length, 0);
    await link("personal", "Personal follow up");
    await db.query("select gmail_followups()");
    await db.query("select gmail_followups()");
    assert.equal(
      (await db.query("select * from tasks where automated")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ waiting_for: string }>(
          "select waiting_for from mail_waits",
        )
      ).rows[0].waiting_for,
      "client",
    );
    const asUser = async (id: string, aal = "aal2") => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, aal }),
      ]);
      await db.exec("set role authenticated");
    };
    await asUser(seller);
    assert.equal(
      (await db.query("select * from opportunity_workspace")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from gmail_archive_messages")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from case_events")).rows.length, 2);
    await assert.rejects(
      db.query("select gmail_apply_candidate($1,$2)", [candidate.id, lease]),
      /permission denied/,
    );
    await asUser(other);
    assert.equal(
      (await db.query("select * from opportunity_workspace")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from messages")).rows.length, 0);
    assert.equal(
      (await db.query("select * from gmail_saved_attachments")).rows.length,
      0,
    );
    await asUser(seller, "aal1");
    assert.equal((await db.query("select * from case_events")).rows.length, 0);
    await asUser(admin);
    const stats = (
      await db.query<{ stats: { messages: number; candidates: number } }>(
        "select gmail_preview_stats($1) stats",
        [run],
      )
    ).rows[0].stats;
    assert.equal(stats.messages, 1);
    assert.equal(stats.candidates, 2);
    await db.exec("reset role");
    await db.query("select gmail_transfer_case($1,$2,$3,$4)", [
      caseId,
      other,
      account,
      admin,
    ]);
    await db.query("update gmail_runs set status='completed' where id=$1", [
      run,
    ]);
    const undo = (
      await db.query<{ result: { retained: number } }>(
        "select gmail_undo_import($1,$2) result",
        [run, admin],
      )
    ).rows[0].result;
    assert.equal(undo.retained, 1);
    assert.equal(
      (await db.query("select * from gmail_archive_messages")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from opportunities where archived_at is null"))
        .rows.length,
      1,
    );
    const newCompany = randomUUID(),
      newContact = randomUUID();
    await db.query("insert into companies(id,name) values($1,'Normal lead')", [
      newCompany,
    ]);
    await db.query(
      "insert into contacts(id,company_id,email) values($1,$2,'new@example.com')",
      [newContact, newCompany],
    );
    await assert.rejects(
      db.query(
        "insert into opportunities(contact_id,company,company_id,seller_id) values($1,'Normal lead',$2,$3)",
        [newContact, newCompany, seller],
      ),
      /Verify the lead/,
    );
    // Checkpoints cannot move backwards after a delayed historical run.
    await db.query("select gmail_archive_checkpoint($1,'900')", [account]);
    await db.query("select gmail_archive_checkpoint($1,'800')", [account]);
    assert.equal(
      (
        await db.query<{ history_id: string }>(
          "select history_id from gmail_sync_state where account_id=$1",
          [account],
        )
      ).rows[0].history_id,
      "900",
    );

    // One real cycle, with an idempotent request, is distinct from the unclassified archive.
    const request = randomUUID();
    const createProcess = async () =>
      (
        await db.query<{ id: string }>(
          "select gmail_new_process($1,'October renewal','active',now(),$2,$3) id",
          [caseId, request, admin],
        )
      ).rows[0].id;
    const process = await createProcess();
    assert.equal(await createProcess(), process);
    await db.query("select gmail_move_thread($1,$2,$3,$4)", [
      caseId,
      archiveId,
      process,
      admin,
    ]);
    assert.equal(
      (
        await db.query<{ process_id: string }>(
          "select process_id from gmail_saved_attachments where archive_message_id=$1",
          [archiveId],
        )
      ).rows[0].process_id,
      process,
    );
    const lenders = [randomUUID(), randomUUID(), randomUUID()],
      submissions = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < lenders.length; i++) {
      await db.query(
        "insert into lenders(id,name,email,channel) values($1,$2,$3,'email')",
        [lenders[i], `Lender ${i}`, `lender${i}@example.com`],
      );
      await db.query(
        "insert into submissions(id,opportunity_id,lender_id,closer_id,status,channel,next_action,next_action_at,process_id) values($1,$2,$3,$4,$5,'email','Review',now(),$6)",
        [
          submissions[i],
          caseId,
          lenders[i],
          admin,
          i === 2 ? "rejected" : "offer",
          process,
        ],
      );
      if (i !== 2)
        await db.query(
          "insert into offers(submission_id,opportunity_id,product,amount) values($1,$2,'MCA',20000)",
          [submissions[i], caseId],
        );
    }
    await db.query("select gmail_select_lender($1,$2,$3,$4)", [
      process,
      submissions[0],
      archiveId,
      admin,
    ]);
    assert.equal(
      (
        await db.query<{ status: string; withdrawal_reason: string }>(
          "select status,withdrawal_reason from submissions where id=$1",
          [submissions[1]],
        )
      ).rows[0].withdrawal_reason,
      "selected_other_offer",
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from submissions where id=$1",
          [submissions[2]],
        )
      ).rows[0].status,
      "rejected",
    );
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from financing_processes where id=$1",
          [process],
        )
      ).rows[0].state,
      "lender_selected",
    );
    assert.equal(
      (
        await db.query<{ stage: string }>(
          "select stage from opportunities where id=$1",
          [caseId],
        )
      ).rows[0].stage,
      "new",
    );
    await assert.rejects(
      db.query(
        "select gmail_record_process($1,'disbursed',$2,null,'No proof of amount',now(),$3,null,null)",
        [process, archiveId, admin],
      ),
      /historical_funding_evidence/,
    );
    await assert.rejects(
      db.query(
        "select gmail_record_process($1,'offers',null,null,'Guess',now(),$2,null,null)",
        [process, admin],
      ),
      /evidence required/,
    );

    // A new Gmail thread for this exact contact is linked, but cannot undo a manual transfer.
    await db.query("update mail_accounts set sync_enabled=true where id=$1", [
      account,
    ]);
    const continuous = randomUUID();
    await db.query(
      "insert into gmail_runs(id,account_id,purpose,from_at,until_at,copy_since,created_by) values($1,$2,'continuous',now()-interval '1 day',now(),now()-interval '2 months',$3)",
      [continuous, account, admin],
    );
    const continuousLease = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [continuous],
      )
    ).rows[0].lease_token;
    const nextArchive = (
      await db.query<{ id: string }>(
        "select gmail_store_message($1,$2,$3) id",
        [
          continuous,
          continuousLease,
          JSON.stringify({
            ...entry,
            gmail_message_id: "m2",
            gmail_thread_id: "thread2",
            internet_message_id: "<unique@example.com>",
            nature: "personal",
          }),
        ],
      )
    ).rows[0].id;
    await db.query("select gmail_associate_continuous($1)", [nextArchive]);
    await db.query("select gmail_link_message($1,$2)", [
      nextArchive,
      JSON.stringify({ body: "New thread" }),
    ]);
    assert.equal(
      (
        await db.query<{ seller_id: string }>(
          "select seller_id from opportunities where id=$1",
          [caseId],
        )
      ).rows[0].seller_id,
      other,
    );
    assert.equal(
      (
        await db.query<{ opportunity_id: string }>(
          "select opportunity_id from gmail_thread_links where gmail_thread_id='thread2'",
        )
      ).rows[0].opportunity_id,
      caseId,
    );
    // A second connected mailbox carrying the same Internet Message-ID cannot double count.
    const secondAccount = randomUUID(),
      secondRun = randomUUID();
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id,sync_enabled) values($1,'second@example.com','org',$2,true)",
      [secondAccount, seller],
    );
    await db.query(
      "insert into gmail_runs(id,account_id,purpose,from_at,until_at,copy_since,created_by) values($1,$2,'continuous',now()-interval '1 day',now(),now()-interval '2 months',$3)",
      [secondRun, secondAccount, admin],
    );
    const secondLease = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [secondRun],
      )
    ).rows[0].lease_token;
    const duplicate = (
      await db.query<{ id: string }>(
        "select gmail_store_message($1,$2,$3) id",
        [
          secondRun,
          secondLease,
          JSON.stringify({
            ...entry,
            gmail_message_id: "copy-m2",
            gmail_thread_id: "copy-thread2",
            internet_message_id: "<unique@example.com>",
            nature: "personal",
          }),
        ],
      )
    ).rows[0].id;
    await db.query("select gmail_associate_continuous($1)", [duplicate]);
    await db.query("select gmail_link_message($1,$2)", [
      duplicate,
      JSON.stringify({ body: "New thread" }),
    ]);
    assert.equal(
      (
        await db.query(
          "select * from messages where internet_message_id='<unique@example.com>'",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from case_events where dedupe_key like 'message:%'",
        )
      ).rows.length,
      2,
    );
    await asUser(other);
    assert.equal(
      (
        await db.query<{ stats: { sent: number } }>(
          "select gmail_case_mail_stats($1) stats",
          [caseId],
        )
      ).rows[0].stats.sent,
      2,
    );
    await db.exec("reset role");
    // Undo archives an untouched imported case but keeps its archive and attachment references.
    const untouchedRun = randomUUID();
    await db.query(
      "update gmail_runs set status='completed' where id in ($1,$2)",
      [continuous, secondRun],
    );
    await db.query(
      "insert into gmail_runs(id,account_id,purpose,from_at,until_at,copy_since,created_by) values($1,$2,'historical',now()-interval '1 year',now(),now()-interval '2 months',$3)",
      [untouchedRun, account, admin],
    );
    let untouchedLease = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [untouchedRun],
      )
    ).rows[0].lease_token;
    const untouchedArchive = (
      await db.query<{ id: string }>(
        "select gmail_store_message($1,$2,$3) id",
        [
          untouchedRun,
          untouchedLease,
          JSON.stringify({
            ...entry,
            gmail_message_id: "untouched",
            gmail_thread_id: "untouched",
            participants: [
              {
                email: "untouched@customer.com",
                role: "to",
                name: "Untouched",
              },
              {
                email: "untouched@customer.com",
                role: "cc",
                name: "Untouched",
              },
            ],
          }),
        ],
      )
    ).rows[0].id;
    await db.query("select gmail_build_preview($1,$2)", [
      untouchedRun,
      untouchedLease,
    ]);
    const untouchedCandidate = (
      await db.query<{ id: string; attachment_count: number }>(
        "select id,attachment_count from gmail_candidates where run_id=$1",
        [untouchedRun],
      )
    ).rows[0];
    assert.equal(untouchedCandidate.attachment_count, 1);
    await db.query(
      "update gmail_candidates set selected=true,classification='active',participant_kind='client',company_name='Untouched LLC' where id=$1",
      [untouchedCandidate.id],
    );
    await db.query(
      "update gmail_runs set status='importing',approved_by=$2,approved_at=now() where id=$1",
      [untouchedRun, admin],
    );
    untouchedLease = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [untouchedRun],
      )
    ).rows[0].lease_token;
    const untouchedCase = (
      await db.query<{ id: string }>("select gmail_apply_candidate($1,$2) id", [
        untouchedCandidate.id,
        untouchedLease,
      ])
    ).rows[0].id;
    await db.query("select gmail_link_message($1,$2)", [
      untouchedArchive,
      JSON.stringify({ body: "History only" }),
    ]);
    await db.query("update gmail_runs set status='completed' where id=$1", [
      untouchedRun,
    ]);
    assert.equal(
      (
        await db.query<{ result: { archived: number } }>(
          "select gmail_undo_import($1,$2) result",
          [untouchedRun, admin],
        )
      ).rows[0].result.archived,
      1,
    );
    assert.ok(
      (
        await db.query<{ archived_at: string }>(
          "select archived_at from opportunities where id=$1",
          [untouchedCase],
        )
      ).rows[0].archived_at,
    );
    assert.equal(
      (
        await db.query(
          "select * from gmail_saved_attachments where archive_message_id=$1",
          [untouchedArchive],
        )
      ).rows.length,
      1,
    );
    // Reimport cannot overwrite existing contact facts, commercial stage or a manual owner.
    const reimport = randomUUID();
    await db.query(
      "update contacts set name='Reviewed name',phone='12345' where email='customer@customer.com'",
    );
    await db.query(
      "insert into gmail_runs(id,account_id,purpose,from_at,until_at,copy_since,created_by) values($1,$2,'historical',now()-interval '1 year',now(),now()-interval '2 months',$3)",
      [reimport, secondAccount, admin],
    );
    let reimportLease = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [reimport],
      )
    ).rows[0].lease_token;
    const existingArchive = (
      await db.query<{ id: string }>(
        "select gmail_store_message($1,$2,$3) id",
        [
          reimport,
          reimportLease,
          JSON.stringify({
            ...entry,
            gmail_message_id: "existing-contact",
            gmail_thread_id: "existing-thread",
            direction: "inbound",
            nature: "personal",
            participants: [
              {
                email: "customer@customer.com",
                name: "Unreviewed name",
                role: "from",
              },
            ],
          }),
        ],
      )
    ).rows[0].id;
    await db.query("select gmail_build_preview($1,$2)", [
      reimport,
      reimportLease,
    ]);
    const reimportCandidate = (
      await db.query<{ id: string }>(
        "select id from gmail_candidates where run_id=$1",
        [reimport],
      )
    ).rows[0].id;
    await db.query(
      "update gmail_candidates set selected=true,participant_kind='client',classification='active',phone='99999',selected_opportunity_id=$2,selected_process_id=$3 where id=$1",
      [reimportCandidate, caseId, process],
    );
    await db.query(
      "update gmail_runs set status='importing',approved_by=$2,approved_at=now() where id=$1",
      [reimport, admin],
    );
    reimportLease = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [reimport],
      )
    ).rows[0].lease_token;
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select gmail_apply_candidate($1,$2) id",
          [reimportCandidate, reimportLease],
        )
      ).rows[0].id,
      caseId,
    );
    await db.query("select gmail_link_message($1,$2)", [
      existingArchive,
      JSON.stringify({ body: "Historical reply" }),
    ]);
    assert.equal(
      (
        await db.query("select * from gmail_import_message_page($1,0)", [
          reimport,
        ])
      ).rows.length,
      1,
    );
    await db.query("update gmail_candidates set selected=false where id=$1", [
      reimportCandidate,
    ]);
    assert.equal(
      (
        await db.query("select * from gmail_import_message_page($1,0)", [
          reimport,
        ])
      ).rows.length,
      0,
    );
    await db.query("update gmail_candidates set selected=true where id=$1", [
      reimportCandidate,
    ]);
    const retainedContact = (
      await db.query<{ name: string; phone: string }>(
        "select name,phone from contacts where email='customer@customer.com'",
      )
    ).rows[0];
    assert.equal(retainedContact.name, "Reviewed name");
    assert.equal(retainedContact.phone, "12345");
    const retainedCase = (
      await db.query<{ stage: string; seller_id: string }>(
        "select stage,seller_id from opportunities where id=$1",
        [caseId],
      )
    ).rows[0];
    assert.equal(retainedCase.stage, "new");
    assert.equal(retainedCase.seller_id, other);
    // A recovered old reply must not stop a new campaign. Only a subsequent
    // personal reply from the exact recipient can cancel its queued follow-up.
    const campaign = randomUUID(),
      enrollment = randomUUID();
    await db.query(
      "insert into campaigns(id,name,account_id,seller_id,created_by,daily_limit,timezone,start_hour,end_hour,subject,body) values($1,'Live campaign',$2,$3,$4,100,'UTC',0,24,'Offer','Offer')",
      [campaign, secondAccount, other, admin],
    );
    await db.query(
      "insert into campaign_enrollments(id,campaign_id,contact_id,opportunity_id) select $1,$2,contact_id,id from opportunities where id=$3",
      [enrollment, campaign, caseId],
    );
    await db.query(
      "insert into outbox(account_id,opportunity_id,enrollment_id,to_email,subject,body,area,status,sent_at,message_id_header,request_key) values($1,$2,$3,'customer@customer.com','Offer','Offer','seller','sent',now(),'<campaign-sent@example.com>','campaign-sent'),($1,$2,$3,'customer@customer.com','Follow-up','Follow-up','seller','queued',null,'<campaign-followup@example.com>','campaign-followup')",
      [secondAccount, caseId, enrollment],
    );
    const campaignState = async () =>
      (
        await db.query<{ status: string }>(
          "select status from campaign_enrollments where id=$1",
          [enrollment],
        )
      ).rows[0].status;
    await db.query("select gmail_process_live_reply($1)", [existingArchive]);
    assert.equal(await campaignState(), "active");
    await db.query(
      "update gmail_archive_messages set sent_at=now()+interval '1 second',nature='automatic' where id=$1",
      [existingArchive],
    );
    await db.query("select gmail_process_live_reply($1)", [existingArchive]);
    assert.equal(await campaignState(), "active");
    await db.query(
      "update gmail_archive_messages set nature='personal' where id=$1",
      [existingArchive],
    );
    await db.query("select gmail_process_live_reply($1)", [existingArchive]);
    assert.equal(await campaignState(), "replied");
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from outbox where request_key='campaign-followup'",
        )
      ).rows[0].status,
      "cancelled",
    );
    await db.query("select gmail_process_live_reply($1)", [existingArchive]);
    assert.equal(await campaignState(), "replied");
  } finally {
    await db.close();
  }
});
