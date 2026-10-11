import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { attachmentPreviewType } from "../src/lib/gmail-attachments";
import { copyGmailAttachment } from "../worker/gmail-archive";
import { encrypt } from "../src/lib/server/crypto";
test("preview detects safe supported content and rejects HTML and SVG regardless of filename", () => {
  assert.equal(
    attachmentPreviewType(Buffer.from("%PDF-1.7\nfixture")),
    "application/pdf",
  );
  assert.equal(
    attachmentPreviewType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/png",
  );
  assert.equal(
    attachmentPreviewType(Buffer.from([255, 216, 255])),
    "image/jpeg",
  );
  assert.equal(attachmentPreviewType(Buffer.from("GIF89a")), "image/gif");
  assert.equal(
    attachmentPreviewType(Buffer.from('<svg onload="alert(1)"></svg>')),
    null,
  );
  assert.equal(
    attachmentPreviewType(Buffer.from("<html>not a PDF</html>")),
    null,
  );
});
test("attachment selection is empty by default, filtered, persistent, permissioned and required before import", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to authenticated,anon,service_role;grant select on storage.objects to authenticated;`);
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const admin = randomUUID(),
      seller = randomUUID(),
      stranger = randomUUID(),
      closer = randomUUID(),
      account = randomUUID(),
      run = randomUUID(),
      message = randomUUID(),
      caseId = randomUUID(),
      process = randomUUID(),
      contact = randomUUID();
    for (const [id, role] of [
      [admin, "superadmin"],
      [seller, "seller"],
      [stranger, "seller"],
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
    const asUser = async (id: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, aal: "aal2" }),
      ]);
      await db.exec("set role authenticated");
    };
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id,status) values($1,'owner@example.com','org',$2,'connected')",
      [account, seller],
    );
    await db.query(
      "insert into gmail_runs(id,account_id,purpose,status,from_at,until_at,copy_since,created_by) values($1,$2,'historical','review',now()-interval '1 year',now(),now()-interval '2 months',$3)",
      [run, account, admin],
    );
    const files = [
      {
        part_id: "0.1",
        name: "bank.pdf",
        mime_type: "application/pdf",
        size: 100,
      },
      { part_id: "0.2", name: "scan.png", mime_type: "image/png", size: 90 },
      {
        part_id: "0.3",
        name: "image001.png",
        mime_type: "image/png",
        size: 80,
      },
      {
        part_id: "0.4",
        name: "detail.xlsx",
        mime_type: "application/octet-stream",
        size: 70,
      },
    ];
    await db.query(
      "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,subject,sent_at,direction,nature,participants,attachment_index,encrypted_payload) values($1,$2,'message','thread','Application',now(),'inbound','personal','[{\"email\":\"client@example.com\",\"role\":\"from\"}]',$3,'fixture')",
      [message, account, JSON.stringify(files)],
    );
    await db.query("insert into gmail_run_messages values($1,$2)", [
      run,
      message,
    ]);
    const candidate = randomUUID();
    await db.query(
      "insert into gmail_candidates(id,run_id,email,name,company_name,participant_kind,classification,message_count,inbound_count,outbound_count,campaign_count,attachment_count,copy_count,first_at,last_at,evidence_ids,selected) values($1,$2,'client@example.com','Client','Company','client','active',1,1,0,0,4,4,now(),now(),array[$3::uuid],true)",
      [candidate, run, message],
    );
    type Listing = {
      files: { part_id: string; copied: boolean; decision: string }[];
      total: number;
      selected_count: number;
      hidden_count: number;
      reviewed: boolean;
    };
    const list = async (
      formats: string[] = [],
      inline = false,
      cand: string | null = null,
      cid: string | null = null,
    ) =>
      (
        await db.query<{ value: Listing }>(
          "select gmail_attachment_list($1,$2,$3,$4,$5,0) value",
          [cid ? null : run, cand, cid, formats, inline],
        )
      ).rows[0].value;
    const select = async (
      choices: unknown[],
      review = false,
      cid: string | null = null,
    ) =>
      db.query("select gmail_select_attachments($1,$2,$3,$4)", [
        cid ? null : run,
        cid,
        JSON.stringify(choices),
        review,
      ]);
    const pdf = { archive_message_id: message, part_id: "0.1", included: true };
    await asUser(admin);
    assert.equal((await list()).total, 3);
    assert.equal((await list()).selected_count, 0);
    assert.equal((await list()).hidden_count, 1);
    assert.equal((await list(["PDF"])).total, 1);
    assert.equal((await list([], true, candidate)).total, 4);
    await db.exec("reset role");
    await assert.rejects(
      db.query("select gmail_confirm_import($1,$2)", [run, admin]),
      /Review attachment/,
    );
    await asUser(stranger);
    await assert.rejects(list(), /Import access/);
    await assert.rejects(select([pdf]), /Finish analysis/);
    await asUser(admin);
    await assert.rejects(
      select([{ ...pdf, archive_message_id: randomUUID() }]),
      /Attachment access/,
    );
    await assert.rejects(list([], true, randomUUID()), /another import/);
    await select([], true);
    assert.equal((await list()).selected_count, 0);
    assert.equal((await list()).reviewed, true);
    // The user can confirm with no files selected; preparation must not enqueue copies.
    await db.exec("reset role");
    await db.query("select gmail_confirm_import($1,$2)", [run, admin]);
    assert.equal(
      (await db.query("select * from jobs where kind='gmail_copy_attachment'"))
        .rows.length,
      0,
    );
    // Restore only this isolated fixture to test selecting files before confirmation.
    await db.query(
      "update gmail_runs set status='review',phase='preview' where id=$1",
      [run],
    );
    await asUser(admin);
    await select([pdf], true);
    await select([pdf], true);
    assert.equal((await list()).selected_count, 1);
    assert.equal((await list(["PNG"])).selected_count, 1);
    assert.equal((await list()).reviewed, true);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from gmail_attachment_choices")).rows.length,
      1,
    );
    await db.query("select gmail_confirm_import($1,$2)", [run, admin]);
    await db.query("select gmail_confirm_import($1,$2)", [run, admin]);
    assert.equal(
      (await db.query("select * from jobs where kind='gmail_archive'")).rows
        .length,
      1,
    );
    await asUser(admin);
    await assert.rejects(
      select([{ ...pdf, included: false }]),
      /Finish analysis/,
    );
    await db.exec("reset role");
    await db.query(
      "insert into contacts(id,email,verification) values($1,'client@example.com','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Company',$3)",
      [caseId, contact, seller],
    );
    await db.query(
      "insert into financing_processes(id,opportunity_id,sequence_number,started_at,classification,label) values($1,$2,1,now(),'active','Current')",
      [process, caseId],
    );
    await db.query(
      "insert into gmail_saved_attachments(archive_message_id,opportunity_id,process_id,part_id,name,mime_type,size,received_at,area) select $1,$2,$3,a->>'part_id',a->>'name',a->>'mime_type',(a->>'size')::int,now(),case when a->>'part_id'='0.4' then 'closer'::case_area else 'seller'::case_area end from jsonb_array_elements($4::jsonb) a",
      [message, caseId, process, JSON.stringify(files)],
    );
    await assert.rejects(
      db.query(
        "update gmail_saved_attachments set storage_path='private/implicit' where part_id='0.2'",
      ),
      /selection required/,
    );
    await db.query(
      "update gmail_saved_attachments set storage_path='private/selected',status='received' where part_id='0.1'",
    );
    await asUser(seller);
    assert.equal((await list([], true, null, caseId)).total, 3);
    await assert.rejects(
      select(
        [{ archive_message_id: message, part_id: "0.4", included: true }],
        false,
        caseId,
      ),
      /Attachment access/,
    );
    await select(
      [{ archive_message_id: message, part_id: "0.2", included: true }],
      false,
      caseId,
    );
    await select(
      [{ archive_message_id: message, part_id: "0.2", included: true }],
      false,
      caseId,
    );
    await select([{ ...pdf, included: false }], false, caseId);
    assert.equal(
      (await list([], true, null, caseId)).files.find(
        (f) => f.part_id === "0.1",
      )?.copied,
      true,
    );
    await asUser(stranger);
    await assert.rejects(list([], true, null, caseId), /Case access/);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ decision: string }>(
          "select decision from gmail_attachment_choices where part_id='0.1'",
        )
      ).rows[0].decision,
      "included",
    );
    assert.equal(
      (await db.query("select * from jobs where kind='gmail_copy_attachment'"))
        .rows.length,
      1,
    );
    await db.exec(
      "update jobs set status='failed',attempts=8,last_error='fixture' where kind='gmail_copy_attachment'",
    );
    await asUser(seller);
    await select(
      [{ archive_message_id: message, part_id: "0.2", included: true }],
      false,
      caseId,
    );
    await db.exec("reset role");
    const recovered = (
      await db.query<{ status: string; attempts: number }>(
        "select status,attempts from jobs where kind='gmail_copy_attachment'",
      )
    ).rows;
    assert.deepEqual(recovered, [{ status: "queued", attempts: 0 }]);
    assert.equal((await db.query("select * from outbox")).rows.length, 0);
  } finally {
    await db.close();
  }
});
test("worker never fetches or uploads unselected future or historical files, and selected retries preserve stored copies", async () => {
  const previousFetch = globalThis.fetch,
    keys = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "INTEGRATION_ENCRYPTION_KEY",
    ] as const,
    env = keys.map((k) => process.env[k]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://attachment-fixture.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    "base64",
  );
  let included = false,
    stored = false,
    reads = 0,
    uploads = 0,
    updates = 0;
  const message = randomUUID(),
    file = randomUUID();
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/gmail_saved_attachments")) {
      if (init?.method === "PATCH") {
        stored = true;
        updates++;
        return Response.json(null);
      }
      return Response.json({
        id: file,
        archive_message_id: message,
        part_id: "0.1",
        opportunity_id: "case",
        process_id: "process",
        name: "fixture.pdf",
        size: 20,
        storage_path: stored ? "private/path" : null,
      });
    }
    if (path.endsWith("/gmail_attachment_choices"))
      return Response.json(included ? { decision: "included" } : null);
    if (path.endsWith("/gmail_archive_messages")) {
      reads++;
      return Response.json({
        id: message,
        account_id: "account",
        encrypted_payload: encrypt(
          JSON.stringify({
            attachments: [
              {
                part_id: "0.1",
                data: Buffer.from("%PDF-1.7 fixture").toString("base64url"),
              },
            ],
          }),
        ),
      });
    }
    if (path.includes("/storage/v1/object/")) {
      uploads++;
      return Response.json({ Key: "private/path" });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    await copyGmailAttachment(file);
    assert.equal(reads, 0);
    assert.equal(uploads, 0);
    included = true;
    await copyGmailAttachment(file);
    await copyGmailAttachment(file);
    assert.equal(reads, 1);
    assert.equal(uploads, 1);
    assert.equal(updates, 1);
  } finally {
    globalThis.fetch = previousFetch;
    keys.forEach((k, i) => {
      if (env[i] === undefined) delete process.env[k];
      else process.env[k] = env[i];
    });
  }
});
