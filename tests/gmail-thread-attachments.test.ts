import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

test("an import sees, selects and incorporates later thread attachments across scans and live directories without crossing mailboxes", async () => {
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
    for (const file of migrations.filter((f) => Number(f.slice(0, 3)) < 25))
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const admin = randomUUID(),
      seller = randomUUID(),
      account = randomUUID(),
      otherAccount = randomUUID(),
      run = randomUUID(),
      newerRun = randomUUID(),
      directory = randomUUID();
    for (const [id, role] of [
      [admin, "superadmin"],
      [seller, "seller"],
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
      "insert into mail_accounts(id,email,organization,owner_id,status) values($1,'seller@team.test','fixture',$2,'connected'),($3,'other@team.test','fixture',$2,'connected')",
      [account, seller, otherAccount],
    );
    for (const [id, live] of [
      [run, false],
      [newerRun, false],
      [directory, true],
    ])
      await db.query(
        "insert into gmail_runs(id,account_id,purpose,status,phase,from_at,until_at,copy_since,created_by,is_live_directory) values($1,$2,'continuous','review','preview','2026-10-01','2026-10-14','2026-10-01',$3,$4)",
        [id, account, admin, live],
      );
    const files = Array.from({ length: 10 }, (_, i) => ({
      part_id: `0.${i + 1}`,
      name: `bank-${i + 1}.pdf`,
      mime_type: "application/pdf",
      size: 100,
    }));
    const archive = async (
      id: string,
      acct: string,
      thread: string,
      direction: string,
      parts: unknown[],
      participants: unknown[],
      date: string,
    ) => {
      await db.query(
        "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,subject,sent_at,direction,nature,participants,attachment_index,encrypted_payload) values($1::uuid,$2,$1::text,$3,'Application',$4,$5,'personal',$6,$7,'fixture')",
        [
          id,
          acct,
          thread,
          date,
          direction,
          JSON.stringify(participants),
          JSON.stringify(parts),
        ],
      );
    };
    const sent = randomUUID(),
      reply = randomUUID(),
      foreign = randomUUID(),
      unrelated = randomUUID();
    await archive(
      sent,
      account,
      "original-thread",
      "outbound",
      [],
      [
        { email: "seller@team.test", role: "from" },
        { email: "client@yahoo.test", role: "to" },
      ],
      "2026-10-12T16:00:00Z",
    );
    // The attachment sender can be another participant/alias in the same thread.
    await archive(
      reply,
      account,
      "original-thread",
      "inbound",
      files,
      [
        { email: "documents@alias.test", role: "from" },
        { email: "seller@team.test", role: "to" },
      ],
      "2026-10-13T17:00:00Z",
    );
    await archive(
      foreign,
      otherAccount,
      "original-thread",
      "inbound",
      files,
      [{ email: "client@yahoo.test", role: "from" }],
      "2026-10-14T18:00:00Z",
    );
    await archive(
      unrelated,
      account,
      "different-thread",
      "inbound",
      files,
      [{ email: "another@client.test", role: "from" }],
      "2026-10-14T19:00:00Z",
    );
    await db.query("insert into gmail_run_messages values($1,$2),($3,$4)", [
      run,
      sent,
      newerRun,
      reply,
    ]);
    const candidate = randomUUID(),
      liveCandidate = randomUUID();
    for (const [id, source] of [
      [candidate, run],
      [liveCandidate, directory],
    ])
      await db.query(
        "insert into gmail_candidates(id,run_id,email,name,company_name,participant_kind,classification,message_count,inbound_count,outbound_count,campaign_count,attachment_count,copy_count,first_at,last_at,evidence_ids,selected) values($1,$2,'client@yahoo.test','Client','Client LLC','client','active',1,0,1,0,0,0,'2026-10-12','2026-10-12',array[$3::uuid],true)",
        [id, source, sent],
      );
    const asUser = async (id: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, aal: "aal2" }),
      ]);
      await db.exec("set role authenticated");
    };
    const list = async (source = run, person: string | null = candidate) =>
      (
        await db.query<{
          value: {
            all_count: number;
            selected_count: number;
            files: { archive_message_id: string; part_id: string }[];
          };
        }>("select gmail_attachment_list($1,$2,null,'{}',false,0) value", [
          source,
          person,
        ])
      ).rows[0].value;
    const choice = [
      { archive_message_id: reply, part_id: "0.1", included: true },
    ];
    await asUser(admin);
    assert.equal(
      (await list()).all_count,
      0,
      "Reproduce the production bug: only the original sent email belongs to this scan",
    );
    await assert.rejects(
      db.query("select gmail_select_attachments($1,null,$2,false)", [
        run,
        JSON.stringify(choice),
      ]),
      /Attachment access/,
    );
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/026_gmail_import_thread_attachments.sql",
        "utf8",
      ),
    );
    await asUser(admin);
    const repaired = await list();
    assert.equal(repaired.all_count, 10);
    assert.deepEqual(
      [...new Set(repaired.files.map((f) => f.archive_message_id))],
      [reply],
    );
    assert.equal(
      (await list(directory, liveCandidate)).all_count,
      10,
      "A live directory needs no original run-message membership",
    );
    assert.equal(
      (await list(run, null)).all_count,
      10,
      "Run-wide review and per-participant review use the same scope",
    );
    await assert.rejects(list(directory, candidate), /another import/);
    await db.query("select gmail_select_attachments($1,null,$2,false)", [
      run,
      JSON.stringify(choice),
    ]);
    assert.equal((await list()).selected_count, 1);
    await db.query("select gmail_review_candidate_attachments($1,$2)", [
      candidate,
      run,
    ]);
    await db.exec("reset role");
    await db.query("select gmail_refresh_candidate_thread_stats($1)", [
      candidate,
    ]);
    const counters = (
      await db.query<{
        message_count: number;
        inbound_count: number;
        outbound_count: number;
        attachment_count: number;
        evidence_ids: string[];
        last_received_at: string;
      }>("select * from gmail_candidates where id=$1", [candidate])
    ).rows[0];
    assert.equal(counters.message_count, 2);
    assert.equal(counters.inbound_count, 1);
    assert.equal(counters.outbound_count, 1);
    assert.equal(counters.attachment_count, 10);
    assert.deepEqual(new Set(counters.evidence_ids), new Set([sent, reply]));
    assert.equal(
      new Date(counters.last_received_at).toISOString(),
      "2026-10-13T17:00:00.000Z",
    );
    // A later live refresh from the alias must update the original participant too.
    await db.query(
      "update gmail_candidates set attachment_count=0 where id=$1",
      [candidate],
    );
    await db.query("select gmail_record_reply($1,'review')", [reply]);
    assert.equal(
      (
        await db.query<{ attachment_count: number }>(
          "select attachment_count from gmail_candidates where id=$1",
          [candidate],
        )
      ).rows[0].attachment_count,
      10,
    );
    await db.query("select gmail_confirm_candidates($1,$2,$3)", [
      run,
      admin,
      candidate,
    ]);
    const lease = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [run],
      )
    ).rows[0].lease_token;
    await db.query("select gmail_apply_candidate($1,$2)", [candidate, lease]);
    const page = (
      await db.query<{ id: string }>(
        "select * from gmail_import_message_page($1,0)",
        [run],
      )
    ).rows;
    assert.deepEqual(
      new Set(page.map((m) => m.id)),
      new Set([sent, reply]),
      "Import the later message too, not only display its files",
    );
    for (const row of page)
      await db.query("select gmail_link_message($1,$2)", [
        row.id,
        JSON.stringify({ body: "Fixture" }),
      ]);
    assert.equal(
      (
        await db.query(
          "select * from gmail_saved_attachments where archive_message_id=$1",
          [reply],
        )
      ).rows.length,
      10,
    );
    assert.equal(
      (
        await db.query(
          "select * from gmail_saved_attachments where archive_message_id in ($1,$2)",
          [foreign, unrelated],
        )
      ).rows.length,
      0,
    );
    await asUser(admin);
    await db.query("select gmail_select_attachments($1,null,$2,false)", [
      run,
      JSON.stringify(choice),
    ]);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from jobs where kind='gmail_copy_attachment'"))
        .rows.length,
      1,
      "Selected files outside the old scan can be queued for copying",
    );
    await asUser(seller);
    await assert.rejects(list(), /Import access/);
    await assert.rejects(
      db.query("select * from gmail_import_message_ids($1,$2)", [
        run,
        candidate,
      ]),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
