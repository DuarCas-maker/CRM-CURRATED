import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  documentReviewSchema,
  incorporateDocumentSchema,
  previewMime,
} from "../src/lib/document-review";

test("document review accepts only supported previews and requires correction notes and a version", () => {
  assert.equal(previewMime(Buffer.from("%PDF-1.7")), "application/pdf");
  assert.equal(previewMime(Buffer.from("<html>unsafe</html>")), null);
  assert.equal(
    previewMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/png",
  );
  const base = {
    opportunity_id: randomUUID(),
    document_id: randomUUID(),
    expected_hash: "a".repeat(64),
    period: "2026-09",
    status: "approved",
  };
  assert.ok(documentReviewSchema.safeParse(base).success);
  assert.ok(
    !documentReviewSchema.safeParse({ ...base, status: "correction" }).success,
  );
  assert.ok(
    !documentReviewSchema.safeParse({ ...base, expected_hash: null }).success,
  );
  assert.ok(
    incorporateDocumentSchema.safeParse({
      ...base,
      expected_hash: null,
      source: "saved",
      source_id: randomUUID(),
    }).success,
  );
});

test("documents stay within their opportunity, review the exact version, preserve evidence and revoke approval on replacement", async () => {
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
      outsider = randomUUID(),
      account = randomUUID(),
      contact = randomUUID(),
      caseId = randomUUID(),
      otherCase = randomUUID();
    for (const id of [seller, outsider]) {
      await db.query("insert into auth.users values($1,$2)", [
        id,
        `${id}@team.test`,
      ]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,'Seller',$2,'seller')",
        [id, `${id}@team.test`],
      );
    }
    await db.query(
      "insert into contacts(id,email,verification) values($1,'client@customer.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$3,'Merchant',$4),($2,$3,'Other request',$4)",
      [caseId, otherCase, contact, seller],
    );
    await db.query("select initialize_checklist($1,'MCA')", [caseId]);
    await db.query("select initialize_checklist($1,'MCA')", [otherCase]);
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id) values($1,'seller@team.test','org',$2)",
      [account, seller],
    );
    const conversation = randomUUID(),
      message = randomUUID(),
      attachment = randomUUID(),
      replacement = randomUUID();
    await db.query(
      "insert into conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area) values($1,$2,$3,'fixture','Statements','seller')",
      [conversation, caseId, account],
    );
    await db.query(
      "insert into messages(id,conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1,$2,'message','inbound','client@customer.test','Files',now(),'received')",
      [message, conversation],
    );
    for (const [id, part] of [
      [attachment, "part1"],
      [replacement, "part2"],
    ])
      await db.query(
        "insert into message_attachments(id,message_id,gmail_attachment_id,name,mime_type,size) values($1,$2,$3,'statement.pdf','application/pdf',100)",
        [id, message, part],
      );
    const docs = (
      await db.query<{ id: string; opportunity_id: string; period: string }>(
        "select id,opportunity_id,period from documents where kind='bank_statement' order by period",
      )
    ).rows;
    const doc = docs.find((d) => d.opportunity_id === caseId)!,
      foreign = docs.find((d) => d.opportunity_id === otherCase)!;
    const hash = "a".repeat(64),
      secondHash = "b".repeat(64),
      path = `${caseId}/${doc.id}/${hash}.pdf`,
      secondPath = `${caseId}/${doc.id}/${secondHash}.pdf`;
    for (const p of [path, secondPath])
      await db.query(
        "insert into storage.objects(bucket_id,name) values('case-documents',$1)",
        [p],
      );
    let currentUser: string = seller;
    async function asUser(id: string, aal = "aal2") {
      currentUser = id;
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, aal }),
      ]);
      await db.exec("set role authenticated");
    }
    const call = async (kind: string, p: object, key = randomUUID()) => {
      if (kind !== "incorporate_document")
        return db.query("select case_document_command($1,$2,$3)", [
          kind,
          JSON.stringify(p),
          key,
        ]);
      await db.exec("reset role;set role service_role");
      try {
        return await db.query("select incorporate_case_document($1,$2,$3)", [
          JSON.stringify(p),
          key,
          currentUser,
        ]);
      } finally {
        await db.exec("reset role;set role authenticated");
      }
    };
    const input = {
      opportunity_id: caseId,
      document_id: doc.id,
      source: "legacy",
      source_id: attachment,
      expected_hash: null,
      content_hash: hash,
      storage_path: path,
    };
    await asUser(outsider);
    await assert.rejects(call("incorporate_document", input), /read-only/);
    await asUser(seller, "aal1");
    await assert.rejects(call("review_document", input), /MFA/);
    await asUser(seller);
    await assert.rejects(
      db.query("select case_document_command('incorporate_document',$1,$2)", [
        JSON.stringify(input),
        randomUUID(),
      ]),
      /Server incorporation/,
    );
    await assert.rejects(
      db.query("select incorporate_case_document($1,$2,$3)", [
        JSON.stringify(input),
        randomUUID(),
        seller,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      call("incorporate_document", {
        ...input,
        opportunity_id: otherCase,
        document_id: foreign.id,
      }),
      /another opportunity/,
    );
    const key = randomUUID();
    await call("incorporate_document", input, key);
    await call("incorporate_document", input, key);
    const state = async () =>
      (
        await db.query<{
          status: string;
          content_hash: string;
          review_notes: string;
        }>(
          "select status,content_hash,review_notes from documents where id=$1",
          [doc.id],
        )
      ).rows[0];
    assert.equal((await state()).status, "received");
    assert.equal(
      (
        await db.query<{ source_attachment_id: string }>(
          "select source_attachment_id from document_versions where document_id=$1",
          [doc.id],
        )
      ).rows[0].source_attachment_id,
      attachment,
    );
    const review = {
      opportunity_id: caseId,
      document_id: doc.id,
      expected_hash: hash,
      status: "approved",
      notes: "Statement and merchant checked",
      period: doc.period,
    };
    await assert.rejects(
      call("review_document", { ...review, status: "correction", notes: "" }),
      /Explain/,
    );
    await assert.rejects(
      call("review_document", { ...review, expected_hash: secondHash }),
      /Document changed/,
    );
    const reviewKey = randomUUID();
    await call("review_document", review, reviewKey);
    await call("review_document", review, reviewKey);
    assert.equal((await state()).status, "approved");
    assert.equal(
      (
        await db.query("select * from document_reviews where document_id=$1", [
          doc.id,
        ])
      ).rows.length,
      1,
    );
    await call("incorporate_document", input);
    assert.equal((await state()).status, "approved");
    await assert.rejects(
      call("incorporate_document", {
        ...input,
        document_id: docs.filter((d) => d.opportunity_id === caseId)[1].id,
      }),
      /already incorporated/,
    );
    await call("incorporate_document", {
      ...input,
      source_id: replacement,
      expected_hash: hash,
      content_hash: secondHash,
      storage_path: secondPath,
    });
    assert.equal((await state()).status, "received");
    assert.equal((await state()).review_notes, "");
    await assert.rejects(call("review_document", review), /Document changed/);
    await assert.rejects(db.query("select crm_command('review_document',$1,$2)",[JSON.stringify({...review,id:doc.id}),randomUUID()]),/Document changed/);
    assert.equal(
      (
        await db.query("select * from document_versions where document_id=$1", [
          doc.id,
        ])
      ).rows.length,
      2,
    );
    await call("review_document", {
      ...review,
      expected_hash: secondHash,
      status: "correction",
      notes: "Missing page 2",
    });
    assert.equal((await state()).review_notes, "Missing page 2");
    // New-mail saved files follow the same incorporation path as legacy attachments.
    await db.exec("reset role");
    const archive = randomUUID(),
      process = randomUUID(),
      saved = randomUUID();
    await db.query(
      "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,subject,sent_at,direction,nature,participants,encrypted_payload) values($1,$2,'saved-message','saved-thread','More statements',now(),'inbound','personal','[]','fixture')",
      [archive, account],
    );
    await db.query(
      "insert into financing_processes(id,opportunity_id,sequence_number,started_at,classification,label) values($1,$2,1,now(),'active','Current request')",
      [process, caseId],
    );
    await db.query(
      "insert into gmail_saved_attachments(id,archive_message_id,opportunity_id,process_id,part_id,name,mime_type,size,received_at) values($1,$2,$3,$4,'part','Saved statement.pdf','application/pdf',100,now())",
      [saved, archive, caseId, process],
    );
    await asUser(seller);
    await call("incorporate_document", {
      ...input,
      source: "saved",
      source_id: saved,
      expected_hash: secondHash,
    });
    assert.equal((await state()).status, "received");
    assert.equal(
      (
        await db.query<{ imported_document_id: string }>(
          "select imported_document_id from gmail_saved_attachments where id=$1",
          [saved],
        )
      ).rows[0].imported_document_id,
      doc.id,
    );
    assert.equal(
      (
        await db.query<{ source_gmail_file_id: string }>(
          "select source_gmail_file_id from document_versions where document_id=$1 and content_hash=$2",
          [doc.id, hash],
        )
      ).rows[0].source_gmail_file_id,
      saved,
    );
    await assert.rejects(
      call("review_document", {
        ...review,
        period: docs.filter((d) => d.opportunity_id === caseId)[1].period,
      }),
      /unique constraint/,
    );
    await asUser(outsider);
    assert.equal(
      (await db.query("select * from document_reviews")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
