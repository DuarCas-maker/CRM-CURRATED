import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { buildMime } from "../worker/mime";
import { snapshotMessage } from "../src/lib/gmail-history";
import {
  defaultReplyAccount,
  mailCopies,
  outgoingMailSchema,
} from "../src/lib/mail-manager";

test("mail keeps received sender defaults, excludes hidden copies from replies and preserves HTML signature with Unicode attachments", () => {
  assert.equal(
    defaultReplyAccount("daniel", ["valentina", "daniel"]),
    "daniel",
  );
  assert.equal(defaultReplyAccount("restricted", ["valentina"]), "");
  assert.deepEqual(mailCopies("a@b.test; A@b.test, c@d.test", ["c@d.test"]), [
    "a@b.test",
  ]);
  const raw = Buffer.from(
    buildMime({
      from: "daniel@team.test",
      senderName: "Daniel Pérez",
      to: "client@test.example",
      cc: ["review@team.test"],
      bcc: ["hidden@team.test"],
      subject: "Solicitud",
      body: "Please review <the request>.",
      messageId: "<current@crm.curated.local>",
      inReplyTo: "<original@test.example>",
      references: "<root@test.example> <original@test.example>",
      signatureHtml:
        '<b>Daniel</b><br><a href="https://example.test">Curated</a><img src="https://example.test/logo.png">',
      attachments: [
        {
          name: "Información.xlsx",
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          bytes: Buffer.from("fixture"),
        },
      ],
    }),
    "base64url",
  ).toString();
  assert.match(raw, /multipart\/alternative/);
  assert.match(raw, /In-Reply-To: <original@test.example>/);
  assert.match(raw, /References: <root@test.example> <original@test.example>/);
  assert.match(raw, /Bcc: hidden@team.test/);
  assert.match(raw, /filename\*=UTF-8''Informaci%C3%B3n.xlsx/);
  const parts = [
    ...raw.matchAll(
      /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g,
    ),
  ].map((m) => Buffer.from(m[1], "base64").toString());
  assert.ok(
    parts.some(
      (p) =>
        p.includes("&lt;the request&gt;") &&
        p.includes('<img src="https://example.test/logo.png">'),
    ),
  );
  assert.throws(() =>
    buildMime({
      from: "a@b.test",
      to: "c@d.test",
      bcc: ["x@y.test\r\nInjected: yes"],
      subject: "Test",
      body: "Test",
      messageId: "<x@y.test>",
    }),
  );
  assert.equal(
    outgoingMailSchema.safeParse({
      opportunity_id: randomUUID(),
      account_id: randomUUID(),
      mode: "reply",
      to_email: "a@b.test",
      subject: "Subject",
      body: "Body",
    }).success,
    false,
  );
  const subject = "  Solicitud de financiación " + "á🙂".repeat(80) + "  ";
  const parsed = outgoingMailSchema.parse({
    opportunity_id: randomUUID(),
    account_id: randomUUID(),
    mode: "reply",
    conversation_id: randomUUID(),
    reply_message_id: randomUUID(),
    to_email: "a@b.test",
    subject,
    body: "Reply",
  });
  assert.equal(parsed.subject, subject);
  const folded = Buffer.from(
    buildMime({
      from: "a@b.test",
      to: "c@d.test",
      subject,
      body: "Body",
      messageId: "<folded@test.example>",
    }),
    "base64url",
  ).toString();
  const encodedWords = [...folded.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
  assert.ok(encodedWords.every((m) => m[0].length <= 75));
  assert.equal(
    encodedWords.map((m) => Buffer.from(m[1], "base64").toString()).join(""),
    subject,
  );
  const snapshot = snapshotMessage(
    {
      id: "unicode-message",
      threadId: "unicode-thread",
      internalDate: String(Date.now()),
      payload: {
        headers: [
          {
            name: "Subject",
            value:
              "=?UTF-8?Q?An=C3=A1lisis_?=\r\n =?UTF-8?B?ZmluYW5jaWVybw==?=",
          },
          {
            name: "From",
            value: `=?UTF-8?B?${Buffer.from("Valentina <fake@example.test>").toString("base64")}?= <actual@example.test>`,
          },
          {
            name: "References",
            value: "<root@example.test>\r\n <parent@example.test>",
          },
        ],
      },
    },
    "owner@example.test",
  );
  assert.equal(snapshot.subject, "Análisis financiero");
  assert.equal(snapshot.participants[0].email, "actual@example.test");
  assert.equal(snapshot.participants[0].name, "Valentina <fake@example.test>");
  assert.equal(
    snapshot.references_header,
    "<root@example.test> <parent@example.test>",
  );
});

test("live mail works before historical import, requires manual new-thread association, shares case mail and queues independent lender sends", async () => {
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
      closer = randomUUID(),
      outsider = randomUUID();
    for (const [id, role] of [
      [seller, "seller"],
      [closer, "closer"],
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
    const account = randomUUID(),
      secondAccount = randomUUID(),
      contact = randomUUID(),
      caseId = randomUUID(),
      foreignCase = randomUUID();
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id) values($1,'daniel@team.test','org',$3),($2,'valentina@team.test','org',$4)",
      [account, secondAccount, seller, closer],
    );
    await db.query(
      "insert into mail_permissions values($1,$3,true),($2,$3,true),($1,$4,true),($2,$4,true)",
      [account, secondAccount, seller, closer],
    );
    assert.equal(
      (
        await db.query<{ live_enabled: boolean; sync_enabled: boolean }>(
          "select live_enabled,sync_enabled from mail_accounts where id=$1",
          [account],
        )
      ).rows[0].live_enabled,
      true,
    );
    assert.equal(
      (
        await db.query<{ sync_enabled: boolean }>(
          "select sync_enabled from mail_accounts where id=$1",
          [account],
        )
      ).rows[0].sync_enabled,
      false,
    );
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,'client@customer.test','Client','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$3,'Client LLC',$4),($2,$3,'Foreign LLC',$5)",
      [caseId, foreignCase, contact, seller, outsider],
    );
    const asUser = async (id: string, aal = "aal2") => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, aal }),
      ]);
      await db.exec("set role authenticated");
    };
    const base = {
      case_id: caseId,
      account,
      recipient: "test@customer.test",
      subject_text: "Prueba Gmail",
      body_text: "Please reply",
      files: [],
      gmail_files: [],
      uploads: [],
      copies: ["review@customer.test"],
      hidden_copies: ["private@team.test"],
      process: null,
      conversation: null,
      reply_message: null,
      submission: null,
      signature: "<b>Daniel</b>",
      display_name: "Daniel",
      request: randomUUID(),
    };
    const queue = async (p: Record<string, unknown> = {}) => {
      const input = { ...base, ...p };
      return (
        await db.query<{ id: string }>(
          "select queue_mail_email($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) id",
          Object.values(input),
        )
      ).rows[0].id;
    };
    await asUser(seller, "aal1");
    await assert.rejects(queue(), /access required/);
    await asUser(seller);
    const send = await queue();
    assert.equal(await queue(), send);
    await assert.rejects(
      queue({ copies: ["changed@customer.test"] }),
      /reused/,
    );
    await assert.rejects(
      queue({ request: randomUUID(), uploads: [randomUUID()] }),
      /attachments required/,
    );
    await assert.rejects(
      db.query("select crm_command('create_opportunity',$1,$2)", [
        JSON.stringify({ email: "client@customer.test" }),
        randomUUID(),
      ]),
      /Añadir proceso/,
    );
    await db.exec("reset role");
    await db.query("select mark_sent($1,'sent-message','test-thread')", [send]);
    const conversation = (
      await db.query<{ id: string; process_id: string }>(
        "select id,process_id from conversations where gmail_thread_id='test-thread'",
      )
    ).rows[0];
    const archive = randomUUID();
    const participants = [
      { role: "from", email: "test@customer.test" },
      { role: "to", email: "daniel@team.test" },
    ];
    await db.query(
      "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,internet_message_id,subject,sent_at,direction,nature,participants,encrypted_payload) values($1,$2,'reply-message','test-thread','<reply@customer.test>','Prueba Gmail',now(),'inbound','personal',$3,'fixture')",
      [archive, account, JSON.stringify(participants)],
    );
    await db.query("select gmail_associate_continuous($1)", [archive]);
    await db.query("select gmail_link_message($1,$2)", [
      archive,
      JSON.stringify({ body: "Reply from the test mailbox" }),
    ]);
    await db.query("select gmail_track_live_wait($1)", [archive]);
    const reply = (
      await db.query<{ id: string }>(
        "select id from messages where gmail_message_id='reply-message'",
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query<{ conversation_id: string }>(
          "select conversation_id from messages where id=$1",
          [reply],
        )
      ).rows[0].conversation_id,
      conversation.id,
    );
    assert.equal(
      (
        await db.query<{ waiting_for: string }>(
          "select waiting_for from mail_waits where conversation_id=$1",
          [conversation.id],
        )
      ).rows[0].waiting_for,
      "team",
    );
    await db.query("select gmail_link_message($1,$2)", [
      archive,
      JSON.stringify({ body: "Replay" }),
    ]);
    assert.equal(
      (
        await db.query(
          "select id from messages where gmail_message_id='reply-message'",
        )
      ).rows.length,
      1,
    );
    await asUser(seller);
    const switched = await queue({
      request: randomUUID(),
      account: secondAccount,
      recipient: "test@customer.test",
      conversation: conversation.id,
      reply_message: reply,
      process: conversation.process_id,
      body_text: "Reply from Valentina",
      signature: "<b>Valentina</b>",
    });
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ gmail_thread_id: string | null }>(
          "select gmail_thread_id from outbox where id=$1",
          [switched],
        )
      ).rows[0].gmail_thread_id,
      null,
    );
    await db.query(
      "select mark_sent($1,'switched-message','second-mailbox-thread')",
      [switched],
    );
    assert.equal(
      (
        await db.query<{ opportunity_id: string; process_id: string }>(
          "select opportunity_id,process_id from conversations where gmail_thread_id='second-mailbox-thread'",
        )
      ).rows[0].opportunity_id,
      caseId,
    );
    assert.equal(
      (
        await db.query<{ process_id: string }>(
          "select process_id from conversations where gmail_thread_id='second-mailbox-thread'",
        )
      ).rows[0].process_id,
      conversation.process_id,
    );
    const unlinked = randomUUID();
    await db.query(
      "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,internet_message_id,subject,sent_at,direction,nature,participants,encrypted_payload) values($1,$2,'new-message','new-thread','<new@customer.test>','Another subject',now(),'inbound','personal',$3,'fixture')",
      [
        unlinked,
        account,
        JSON.stringify([{ role: "from", email: "client@customer.test" }]),
      ],
    );
    await db.query("select gmail_associate_continuous($1)", [unlinked]);
    assert.equal(
      (
        await db.query(
          "select * from gmail_thread_links where gmail_thread_id='new-thread'",
        )
      ).rows.length,
      0,
    );
    const review = (
      await db.query<{ id: string }>(
        "select id from mail_review where gmail_message_id='new-message'",
      )
    ).rows[0].id;
    await db.query("insert into mail_permissions values($1,$2,true)", [
      account,
      outsider,
    ]);
    await asUser(outsider);
    assert.equal(
      (
        await db.query<{ r: { total: number } }>(
          "select mail_pending_threads(0) r",
        )
      ).rows[0].r.total,
      0,
    );
    await assert.rejects(
      db.query("select associate_live_mail($1,$2,$3,null)", [
        review,
        caseId,
        conversation.process_id,
      ]),
      /access required/,
    );
    await assert.rejects(
      db.query("select associate_live_mail($1,$2,null,null)", [
        review,
        foreignCase,
      ]),
      /Mailbox access required/,
    );
    await asUser(seller);
    await db.query("select associate_live_mail($1,$2,$3,null)", [
      review,
      caseId,
      conversation.process_id,
    ]);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from jobs where kind='gmail_live_thread'")).rows
        .length,
      1,
    );
    await db.query(
      "update opportunities set handed_off_at=now(),closer_id=$2 where id=$1",
      [caseId, closer],
    );
    const lenders = [randomUUID(), randomUUID()];
    await db.query("select initialize_checklist($1,'MCA')", [caseId]);
    await db.query(
      "update documents set status='approved',storage_path='fixture.pdf',content_hash=repeat(md5(id::text),2) where opportunity_id=$1 and kind in ('application','bank_statement')",
      [caseId],
    );
    const packageFiles = (
      await db.query<{ id: string }>(
        "select id from documents where opportunity_id=$1 and kind in ('application','bank_statement')",
        [caseId],
      )
    ).rows.map((d) => d.id);
    await db.query(
      "insert into lenders(id,name,email,channel) values($1,'Lender A','a@lender.test','email'),($2,'Lender B','b@lender.test','email')",
      lenders,
    );
    await db.query(
      "insert into lender_contacts(lender_id,email,name) values($1,'review@lender.test','Review contact')",
      [lenders[0]],
    );
    const upload = randomUUID();
    await db.query(
      "insert into mail_uploads(id,opportunity_id,uploaded_by,name,mime_type,size,storage_path,content_hash) values($1,$2,$3,'Workbook.xlsx','application/octet-stream',20,'private/fixture','hash')",
      [upload, caseId, seller],
    );
    await asUser(seller);
    assert.equal(
      (
        await db.query<{ can_edit_case: boolean }>("select can_edit_case($1)", [
          caseId,
        ])
      ).rows[0].can_edit_case,
      false,
    );
    const batch = {
      ...base,
      copies: [],
      hidden_copies: [],
      request: randomUUID(),
      process: conversation.process_id,
      uploads: [upload],
      files: packageFiles,
      targets: lenders.map((lender_id, i) => ({
        lender_id,
        email: i === 0 ? "a@lender.test" : "b@lender.test",
        cc_emails: i === 0 ? ["review@lender.test"] : [],
      })),
    };
    await assert.rejects(
      db.query("select queue_mail_lenders($1)", [
        { ...batch, request: randomUUID(), files: [] },
      ]),
      /Include the approved application/,
    );
    await assert.rejects(
      db.query("select queue_mail_lenders($1)", [
        {
          ...batch,
          request: randomUUID(),
          targets: [{ ...batch.targets[0], cc_emails: ["b@lender.test"] }],
        },
      ]),
      /must belong to this lender/,
    );
    const result = (
      await db.query<{ sends: { id: string }[] }>(
        "select queue_mail_lenders($1) sends",
        [JSON.stringify(batch)],
      )
    ).rows[0].sends;
    assert.equal(result.length, 2);
    await db.exec("reset role");
    const queued = (
      await db.query<{
        to_email: string;
        cc_emails: string[];
        attachment_ids: string[];
      }>(
        "select to_email,cc_emails,attachment_ids from outbox where id=any($1) order by to_email",
        [result.map((r) => r.id)],
      )
    ).rows;
    assert.deepEqual(queued[0].cc_emails, ["review@lender.test"]);
    assert.deepEqual(queued[1].cc_emails, []);
    assert.deepEqual(queued[0].attachment_ids, queued[1].attachment_ids);
    const frozen = (
      await db.query<{
        attachment_snapshot: {
          id: string;
          content_hash: string;
          storage_path: string;
        }[];
      }>("select attachment_snapshot from outbox where id=$1", [result[0].id])
    ).rows[0].attachment_snapshot;
    assert.equal(frozen.length, packageFiles.length);
    assert.ok(
      frozen.every((d) => !!d.content_hash && d.storage_path === "fixture.pdf"),
    );
    await asUser(seller);
    assert.deepEqual(
      (
        await db.query<{ sends: unknown }>(
          "select queue_mail_lenders($1) sends",
          [JSON.stringify(batch)],
        )
      ).rows[0].sends,
      result,
    );
    await assert.rejects(
      db.query("select queue_mail_lenders($1)", [
        JSON.stringify({ ...batch, targets: batch.targets.slice(0, 1) }),
      ]),
      /reused/,
    );
    await db.exec("reset role");
    for (let i = 0; i < result.length; i++)
      await db.query("select mark_sent($1,$2,$3)", [
        result[i].id,
        `lender-message-${i}`,
        `lender-thread-${i}`,
      ]);
    await db.query("update outbox set attachment_snapshot=$2 where id=$1", [
      result[0].id,
      JSON.stringify([
        {
          id: upload,
          name: "Workbook.xlsx",
          bucket: "gmail-documents",
          storage_path: "private/fixture",
          content_hash: "hash",
        },
      ]),
    ]);
    const originalMessage = (
      await db.query<{ id: string }>(
        "select id from messages where gmail_message_id='lender-message-0'",
      )
    ).rows[0].id;
    await asUser(seller);
    const forward = {
      ...base,
      request: randomUUID(),
      subject_text: "Fwd: Workbook",
      process: conversation.process_id,
      forward_message_id: originalMessage,
      forward_file_ids: [upload],
    };
    const forwardId = (
      await db.query<{ id: string }>("select queue_mail_forward($1) id", [
        JSON.stringify(forward),
      ])
    ).rows[0].id;
    assert.equal(
      (
        await db.query<{ id: string }>("select queue_mail_forward($1) id", [
          JSON.stringify(forward),
        ])
      ).rows[0].id,
      forwardId,
    );
    await assert.rejects(
      db.query("select queue_mail_forward($1)", [
        JSON.stringify({
          ...forward,
          request: randomUUID(),
          forward_file_ids: [randomUUID()],
        }),
      ]),
      /original attachments/,
    );
    await db.exec("reset role");
    await db.query(
      "update financing_processes set classification='active',is_unclassified_archive=false where id=$1",
      [conversation.process_id],
    );
    await db.query(
      "update opportunities set stage='funded',funded_amount=10000,funded_at=now(),funded_lender_id=$2 where id=$1",
      [caseId, lenders[0]],
    );
    await db.query(
      "update mail_waits set waiting_for='client',since_at=now()-interval '6 days' where conversation_id=$1",
      [conversation.id],
    );
    await db.query("select gmail_followups()");
    assert.equal(
      (
        await db.query(
          "select * from tasks where title='Five calendar days: waiting for client'",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query<{ id: string }>("select id from claim_outbox()")).rows[0]
        .id,
      forwardId,
      "The assigned seller may deliver authorized case mail after handoff",
    );
    const hidden = (
      await db.query<{ participants: { role: string }[] }>(
        "select participants from messages where gmail_message_id='sent-message'",
      )
    ).rows[0].participants;
    assert.ok(!hidden.some((p) => p.role === "bcc"));
    await asUser(seller);
    await db.query(
      "select register_mail_contact($1,'alias@customer.test','Secondary contact',null)",
      [caseId],
    );
    await assert.rejects(
      db.query("select crm_command('create_opportunity',$1,$2)", [
        JSON.stringify({ email: "alias@customer.test" }),
        randomUUID(),
      ]),
      /Añadir proceso/,
    );
    assert.equal(
      (
        await db.query<{ stats: { lenders_contacted: number } }>(
          "select mail_case_stats($1) stats",
          [caseId],
        )
      ).rows[0].stats.lenders_contacted,
      2,
    );
    assert.equal(
      (
        await db.query("select * from conversations where opportunity_id=$1", [
          caseId,
        ])
      ).rows.length,
      5,
    );
    const draft = randomUUID();
    await db.query("insert into mail_drafts values($1,$2,$3,$4,now())", [
      draft,
      caseId,
      seller,
      JSON.stringify({ subject: "Saved draft" }),
    ]);
    await asUser(outsider);
    assert.equal(
      (
        await db.query("select * from conversations where opportunity_id=$1", [
          caseId,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from mail_drafts where id=$1", [draft])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("select * from mail_uploads where id=$1", [upload])).rows
        .length,
      0,
    );
    await db.exec("reset role");
    const liveArchive = randomUUID();
    await db.query(
      "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,subject,sent_at,direction,nature,participants,encrypted_payload,is_live) values($1,$2,'new-live-client','new-live-thread','New client',now(),'inbound','personal',$3,'fixture',true)",
      [
        liveArchive,
        account,
        JSON.stringify([{ role: "from", email: "new-live@customer.test" }]),
      ],
    );
    await asUser(seller);
    await db.query("select crm_command('create_lead',$1,$2)", [
      JSON.stringify({
        email: "new-live@customer.test",
        company: "New live client",
        contact: "Client",
        seller_id: seller,
      }),
      randomUUID(),
    ]);
    assert.equal(
      (
        await db.query(
          "select * from lead_workspace where email='new-live@customer.test' and verification='pending'",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from opportunity_workspace where email='new-live@customer.test'",
        )
      ).rows.length,
      0,
      "Receiving mail never bypasses lead qualification",
    );
    await db.exec("reset role");
    await db.query(
      "insert into gmail_archive_messages(account_id,gmail_message_id,gmail_thread_id,subject,sent_at,direction,nature,participants,encrypted_payload) values($1,'historical-client','historical-thread','Historical',now()-interval '2 months','inbound','personal',$2,'fixture')",
      [
        account,
        JSON.stringify([
          { role: "from", email: "historical-only@customer.test" },
        ]),
      ],
    );
    await asUser(seller);
    await assert.rejects(
      db.query("select crm_command('create_lead',$1,$2)", [
        JSON.stringify({
          email: "historical-only@customer.test",
          company: "History",
          contact: "Historical",
          seller_id: seller,
        }),
        randomUUID(),
      ]),
      /historial de Gmail/,
    );
  } finally {
    await db.close();
  }
});
