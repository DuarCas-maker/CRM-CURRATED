import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.on(
  "uncaughtException",
  (error: Error & { detail?: string; where?: string; position?: string }) => {
    console.error({
      message: error.message,
      detail: error.detail,
      where: error.where,
      position: error.position,
    });
    process.exit(1);
  },
);
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage; create table auth.users(id uuid primary key,email text);
`);
await db.exec(`create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to authenticated,anon,service_role; grant select on storage.objects to authenticated;`);
for (const file of (await readdir("supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  console.log(`PASS migration ${file}`);
}
const users = Object.fromEntries(
  ["superadmin", "seller_admin", "seller", "closer_admin", "closer"].map(
    (role) => [role, randomUUID()],
  ),
);
const otherSeller = randomUUID();
for (const [role, id] of [...Object.entries(users), ["seller", otherSeller]]) {
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    id,
    `${id}@example.com`,
  ]);
  await db.query(
    "insert into profiles(id,name,email,role) values($1,$2,$3,$4)",
    [id, role, `${id}@example.com`, role],
  );
}
async function asUser(id: string, aal = "aal2") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, aal }),
  ]);
  await db.exec("set role authenticated");
}
async function command(kind: string, p: object, key = randomUUID()) {
  return (
    await db.query<{ result: { id: string } }>(
      "select public.crm_command($1,$2,$3) result",
      [kind, JSON.stringify(p), key],
    )
  ).rows[0].result;
}
await asUser(users.seller);
const input = {
  company: "Permission Test",
  contact: "Sample Owner",
  email: "SAMPLE@example.com",
  product: "Business loan",
  seller_id: otherSeller,
  amount: 50000,
  next_action: "Review application",
  next_action_at: new Date().toISOString(),
};
const key = randomUUID();
await assert.rejects(command("create_opportunity", input), /Verify the lead/);
const createdLead = await command("create_lead", input, key);
const repeated = await command("create_lead", input, key);
assert.equal(createdLead.id, repeated.id);
assert.equal((await db.query("select * from opportunities")).rows.length, 0);
await db.exec("reset role");
await db.query(
  "update contacts set verification='valid' where email='sample@example.com'",
);
const created = (
  await db.query<{ id: string }>(
    "select opportunity_id as id from leads where id=$1",
    [createdLead.id],
  )
).rows[0];
await asUser(users.seller);
assert.equal(
  (
    await db.query<{ seller_id: string }>(
      "select seller_id from opportunities where id=$1",
      [created.id],
    )
  ).rows[0].seller_id,
  users.seller,
);
console.log("PASS idempotent creation and seller assignment cannot be forged");
await assert.rejects(
  command("handoff", { opportunity_id: created.id }),
  /Signed and complete/,
);
await assert.rejects(
  command("transition", {
    opportunity_id: created.id,
    stage: "funded",
    reason: "Test",
  }),
  /dedicated/,
);
console.log("PASS incomplete handoff and direct funding blocked");
await asUser(otherSeller);
assert.equal(
  (await db.query("select * from opportunities where id=$1", [created.id])).rows
    .length,
  0,
);
await assert.rejects(
  command("activity", {
    opportunity_id: created.id,
    type: "note",
    body: "Unauthorized",
  }),
  /inaccessible/,
);
await assert.rejects(
  db.query("update opportunities set seller_id=$1 where id=$2", [
    otherSeller,
    created.id,
  ]),
  /permission/,
);
await asUser(users.seller, "aal1");
assert.equal((await db.query("select * from opportunities")).rows.length, 0);
console.log("PASS RLS denies another seller, direct mutation, and AAL1");
await db.exec("reset role");
await db.query(
  "update opportunities set application_complete=true,application_signed=true where id=$1",
  [created.id],
);
await db.query(
  "update documents set status='approved',storage_path='test/path.pdf',content_hash=repeat(md5(id::text),2) where opportunity_id=$1",
  [created.id],
);
await asUser(users.seller);
await command("analysis", {
  opportunity_id: created.id,
  summary: "Reviewed",
  conclusion: "Proceed",
  recommendations: "Manual recommendation",
  observations: "",
});
await command("handoff", { opportunity_id: created.id });
await assert.rejects(
  command("activity", {
    opportunity_id: created.id,
    type: "note",
    body: "After handoff",
  }),
  /read-only/,
);
await asUser(users.closer_admin);
await command("assign_closer", {
  opportunity_id: created.id,
  closer_id: users.closer,
});
await asUser(users.closer);
await command("activity", {
  opportunity_id: created.id,
  type: "note",
  body: "PRIVATE NEGOTIATION",
});
await asUser(users.seller);
assert.equal(
  (await db.query("select * from activities where body='PRIVATE NEGOTIATION'"))
    .rows.length,
  0,
);
assert.equal(
  (
    await db.query("select * from analyses where opportunity_id=$1", [
      created.id,
    ])
  ).rows.length,
  1,
);
console.log("PASS handoff freezes seller writes and hides closer negotiations");
await asUser(users.superadmin);
const lender = await command("create_lender", {
  name: "Test lender",
  email: "lender@example.com",
  products: "MCA",
  channel: "portal",
  notes: "",
});
await asUser(users.closer);
await command("submission", {
  opportunity_id: created.id,
  lender_id: lender.id,
  channel: "portal",
  next_action: "Follow up",
  next_action_at: new Date().toISOString(),
  external_reference: "TEST",
});
const submission = (
  await db.query<{ id: string }>(
    "select id from submissions where opportunity_id=$1",
    [created.id],
  )
).rows[0];
await command("offer", {
  opportunity_id: created.id,
  submission_id: submission.id,
  product: "MCA",
  amount: 40000,
  cost: "1.25 factor",
  term: "12 months",
  frequency: "Weekly",
});
await command("transition", {
  opportunity_id: created.id,
  stage: "accepted",
  reason: "Client accepted",
});
assert.equal(
  (
    await db.query<{ funded_amount: number | null }>(
      "select funded_amount from opportunities where id=$1",
      [created.id],
    )
  ).rows[0].funded_amount,
  null,
);
await command("fund", {
  opportunity_id: created.id,
  lender_id: lender.id,
  amount: 39000,
  // Use the database date: UTC may already be tomorrow in the local evening.
  funded_at: (
    await db.query<{ date: string }>("select current_date::text as date")
  ).rows[0].date,
});
assert.equal(
  Number(
    (
      await db.query<{ funded_amount: string }>(
        "select funded_amount from opportunities where id=$1",
        [created.id],
      )
    ).rows[0].funded_amount,
  ),
  39000,
);
console.log(
  "PASS accepted and funded are distinct, funding uses actual amount",
);
await db.exec("reset role");
const batch = randomUUID();
await db.query("select register_import($1,$2,$3,$4,$5,$6,$7,$8)", [
  batch,
  "test.csv",
  "test.csv",
  {},
  "",
  2,
  users.seller_admin,
  randomUUID(),
]);
const rows = [
  {
    row_number: 1,
    valid: true,
    email: "sample@example.com",
    contact: "Do not overwrite",
    company: "Different",
  },
  {
    row_number: 2,
    valid: true,
    email: "fresh@example.com",
    contact: "Fresh",
    company: "Fresh LLC",
  },
];
await db.query("select ingest_import_chunk($1,$2)", [
  batch,
  JSON.stringify(rows),
]);
await db.query("select ingest_import_chunk($1,$2)", [
  batch,
  JSON.stringify(rows),
]);
const report = (
  await db.query<{ processed: number; duplicates: number; imported: number }>(
    "select processed,duplicates,imported from import_batches where id=$1",
    [batch],
  )
).rows[0];
assert.deepEqual(report, { processed: 2, duplicates: 1, imported: 1 });
assert.equal(
  (
    await db.query<{ name: string }>(
      "select name from contacts where email='sample@example.com'",
    )
  ).rows[0].name,
  "Sample Owner",
);
console.log(
  "PASS reimport preserves contact, chunk retries do not double count",
);
const freshContact = (
  await db.query<{ id: string }>(
    "select id from contacts where email='fresh@example.com'",
  )
).rows[0].id;
assert.equal(
  (
    await db.query("select * from opportunities where contact_id=$1", [
      freshContact,
    ])
  ).rows.length,
  0,
);
assert.equal(
  (await db.query("select * from leads where contact_id=$1", [freshContact]))
    .rows.length,
  1,
);
await asUser(users.seller_admin);
assert.equal(
  (
    await db.query("select * from lead_workspace where contact_id=$1", [
      freshContact,
    ])
  ).rows.length,
  1,
);
await command("verify_contacts", { contact_ids: [freshContact] });
await asUser(otherSeller);
assert.equal(
  (
    await db.query("select * from lead_workspace where contact_id=$1", [
      freshContact,
    ])
  ).rows.length,
  0,
);
await assert.rejects(
  command("verify_contacts", { contact_ids: [freshContact] }),
  /administrator/,
);
await asUser(users.closer_admin);
assert.equal((await db.query("select * from lead_workspace")).rows.length, 0);
await asUser(users.seller_admin, "aal1");
assert.equal((await db.query("select * from lead_workspace")).rows.length, 0);
await db.exec("reset role");
console.log(
  "PASS imports remain leads, preparation respects ownership, area and MFA",
);
const reserved = (
  await db.query<{ id: string; email: string }>(
    "select * from claim_verifications()",
  )
).rows;
assert.equal(reserved.length, 1);
assert.equal(
  (await db.query("select * from claim_verifications()")).rows.length,
  0,
);
await db.query(
  "update verifications set state='submitted',provider_batch_id='batch-test' where id=$1",
  [reserved[0].id],
);
await db.query("select apply_verification_results($1,$2)", [
  "batch-test",
  JSON.stringify([
    { email: "fresh@example.com", result: "valid", reason: "accepted_email" },
  ]),
]);
assert.equal(
  (
    await db.query<{ verification: string }>(
      "select verification from contacts where id=$1",
      [freshContact],
    )
  ).rows[0].verification,
  "valid",
);
assert.equal(
  (
    await db.query("select * from opportunities where contact_id=$1", [
      freshContact,
    ])
  ).rows.length,
  1,
);
await db.query("select apply_verification_results($1,$2)", [
  "batch-test",
  JSON.stringify([
    { email: "fresh@example.com", result: "valid", reason: "accepted_email" },
  ]),
]);
assert.equal(
  (
    await db.query("select * from opportunities where contact_id=$1", [
      freshContact,
    ])
  ).rows.length,
  1,
);
console.log(
  "PASS valid verification converts exactly once, including provider replay",
);
const account = randomUUID();
await db.query(
  "insert into mail_accounts(id,email,organization,daily_limit) values($1,'sender@example.com','test',100)",
  [account],
);
await asUser(users.superadmin);
const campaign = await command("create_campaign", {
  name: "Test campaign",
  account_id: account,
  seller_id: users.seller,
  daily_limit: 50,
  timezone: "UTC",
  start_hour: 0,
  end_hour: 24,
  subject: "Hi {{company}}",
  body: "Hello {{name}} {{unsubscribe_url}}",
  followup_days: 1,
  followup_subject: "Follow up",
  followup_body: "Hi {{name}} {{unsubscribe_url}}",
});
await command("activate_campaign", { id: campaign.id });
const campaign2 = await command("create_campaign", {
  name: "Overlap campaign",
  account_id: account,
  seller_id: users.seller,
  daily_limit: 50,
  timezone: "UTC",
  start_hour: 0,
  end_hour: 24,
  subject: "Hi {{company}}",
  body: "Hello {{name}} {{unsubscribe_url}}",
  followup_days: 0,
});
await command("activate_campaign", { id: campaign2.id });
await db.exec("reset role");
assert.equal(
  (
    await db.query(
      "select * from campaign_enrollments where contact_id=$1 and status='active'",
      [freshContact],
    )
  ).rows.length,
  1,
);
const enrollment = (
  await db.query<{ id: string; opportunity_id: string }>(
    "select id,opportunity_id from campaign_enrollments where contact_id=$1",
    [freshContact],
  )
).rows[0];
const outbox = randomUUID();
await db.query(
  "insert into outbox(id,account_id,opportunity_id,enrollment_id,to_email,subject,body,area,message_id_header,requested_by,request_key) values($1,$2,$3,$4,'fresh@example.com','Hello','Test','seller',$5,$6,$7)",
  [
    outbox,
    account,
    enrollment.opportunity_id,
    enrollment.id,
    `<${outbox}@test.local>`,
    users.superadmin,
    randomUUID(),
  ],
);
assert.equal((await db.query("select * from claim_outbox()")).rows.length, 1);
await db.query("select mark_sent($1,$2,$3)", [outbox, "gmail-1", "thread-1"]);
await db.query("select mark_sent($1,$2,$3)", [outbox, "gmail-1", "thread-1"]);
assert.equal((await db.query("select * from messages")).rows.length, 1);
await db.query("select stop_contact_sequence($1,$2)", [
  freshContact,
  "replied",
]);
await db.query("select suppress_contact($1,$2)", [freshContact, "unsubscribe"]);
assert.equal(
  (
    await db.query(
      "select * from campaign_enrollments where contact_id=$1 and status='active'",
      [freshContact],
    )
  ).rows.length,
  0,
);
console.log(
  "PASS scrub reservations, exclusive sequence, idempotent send acknowledgement, reply and unsubscribe",
);
const link = randomUUID();
await db.query(
  "insert into application_links(id,token_hash,encrypted_token,opportunity_id,created_by,expires_at) values($1,'hash','encrypted',$2,$3,now()+interval '14 days')",
  [link, enrollment.opportunity_id, users.superadmin],
);
const appKey = randomUUID();
const app = (
  await db.query<{ id: string }>(
    "select persist_application('hash','encrypted payload','payload-hash','v1','Test Signature',$1) id",
    [appKey],
  )
).rows[0].id;
const repeatedApp = (
  await db.query<{ id: string }>(
    "select persist_application('hash','different encryption same payload','payload-hash','v1','Test Signature',$1) id",
    [randomUUID()],
  )
).rows[0].id;
assert.equal(app, repeatedApp);
await assert.rejects(
  db.query(
    "select persist_application('hash','changed payload','new-hash','v1','Test Signature',$1)",
    [randomUUID()],
  ),
  /already submitted/,
);
const applicationDoc = (
  await db.query<{ id: string }>(
    "select id from documents where opportunity_id=$1 and kind='application'",
    [enrollment.opportunity_id],
  )
).rows[0].id;
await db.query("select register_document($1,$2,$3,$4,$5)", [
  applicationDoc,
  "test/file.pdf",
  "filehash",
  "application_pdf",
  null,
]);
await db.query("select register_document($1,$2,$3,$4,$5)", [
  applicationDoc,
  "test/file.pdf",
  "filehash",
  "application_pdf",
  null,
]);
assert.equal(
  (
    await db.query("select * from document_versions where document_id=$1", [
      applicationDoc,
    ])
  ).rows.length,
  1,
);
console.log(
  "PASS application retry returns same receipt, submitted versions immutable, document retry deduplicated",
);
const job = (
  await db.query<{ id: string; lease_token: string }>(
    "select * from claim_job()",
  )
).rows[0];
await db.query("select finish_job($1,$2,true)", [job.id, randomUUID()]);
assert.equal(
  (
    await db.query<{ status: string }>("select status from jobs where id=$1", [
      job.id,
    ])
  ).rows[0].status,
  "running",
);
await db.query("select finish_job($1,$2,true)", [job.id, job.lease_token]);
assert.equal(
  (
    await db.query<{ status: string }>("select status from jobs where id=$1", [
      job.id,
    ])
  ).rows[0].status,
  "completed",
);
console.log("PASS job lease prevents stale worker acknowledgement");
// Sharing the sender never grants access to another seller's cases or files.
await db.exec("reset role");
await db.query(
  "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true)",
  [account, otherSeller],
);
await db.query(
  "insert into storage.objects(bucket_id,name) values('case-documents','test/file.pdf')",
);
await asUser(otherSeller);
assert.equal(
  (await db.query("select * from mail_accounts where id=$1", [account])).rows
    .length,
  1,
);
for (const table of [
  "opportunities",
  "contacts",
  "companies",
  "documents",
  "messages",
  "storage.objects",
])
  assert.equal(
    (await db.query(`select * from ${table}`)).rows.length,
    0,
    table,
  );
const invisibleStats = (
  await db.query<{ result: { total: number } }>(
    "select workspace_stats() result",
  )
).rows[0].result;
assert.equal(invisibleStats.total, 0);
await asUser(users.seller);
assert.equal((await db.query("select * from storage.objects")).rows.length, 1);
console.log(
  "PASS shared sender does not grant cases, identities, private files or aggregate metrics",
);
// Case mail stays shared with the assigned team after handoff; financial writes remain restricted.
await db.exec("reset role");
const privateThread = randomUUID(),
  oldMessage = randomUUID(),
  privateMessage = randomUUID();
await db.query(
  "insert into conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area) values($1,$2,$3,'handoff-thread','Client thread','seller')",
  [privateThread, created.id, account],
);
await db.query(
  "insert into messages(id,conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1,$2,'old','inbound','sample@example.com','SELLER HISTORY',now()-interval '1 day','received'),($3,$2,'new','inbound','sample@example.com','PRIVATE TERMS',now()+interval '1 second','received')",
  [oldMessage, privateThread, privateMessage],
);
await db.query(
  "insert into message_attachments(message_id,gmail_attachment_id,name,mime_type,size) values($1,'att-1','Offer.pdf','application/pdf',10)",
  [privateMessage],
);
for (const user of [users.seller, users.seller_admin]) {
  await asUser(user);
  assert.equal(
    (await db.query("select * from messages where id=$1", [oldMessage])).rows
      .length,
    1,
  );
  assert.equal(
    (await db.query("select * from messages where id=$1", [privateMessage]))
      .rows.length,
    1,
  );
  assert.equal(
    (
      await db.query("select * from message_attachments where message_id=$1", [
        privateMessage,
      ])
    ).rows.length,
    1,
  );
}
await asUser(users.closer);
assert.equal(
  (
    await db.query("select * from messages where conversation_id=$1", [
      privateThread,
    ])
  ).rows.length,
  2,
);
console.log(
  "PASS assigned sellers and closers share messages and attachments after handoff",
);
await db.exec("reset role");
const uncertainId = randomUUID();
await db.query(
  "insert into outbox(id,account_id,opportunity_id,to_email,subject,body,area,message_id_header,requested_by,request_key,status) values($1,$2,$3,'fresh@example.com','Test','Test','seller',$4,$5,$6,'uncertain')",
  [
    uncertainId,
    account,
    enrollment.opportunity_id,
    `<${uncertainId}@crm.curated.local>`,
    users.superadmin,
    randomUUID(),
  ],
);
assert.equal((await db.query("select * from claim_outbox()")).rows.length, 0);
assert.equal(
  (
    await db.query<{ status: string }>(
      "select status from outbox where id=$1",
      [uncertainId],
    )
  ).rows[0].status,
  "uncertain",
);
const sentId = randomUUID();
const sentDoc = (
  await db.query<{ id: string }>(
    "select id from documents where opportunity_id=$1 limit 1",
    [created.id],
  )
).rows[0];
await db.query(
  "insert into outbox(id,account_id,opportunity_id,submission_id,to_email,subject,body,area,message_id_header,requested_by,request_key,attachment_snapshot) values($1,$2,$3,$4,'lender@example.com','Reviewed package','Test','closer',$5,$6,$7,$8)",
  [
    sentId,
    account,
    created.id,
    submission.id,
    `<${sentId}@crm.curated.local>`,
    users.closer,
    randomUUID(),
    JSON.stringify([
      {
        id: sentDoc.id,
        storage_path: "sent/original.pdf",
        content_hash: "original",
      },
    ]),
  ],
);
await db.query("select mark_sent($1,$2,$3)", [
  sentId,
  "lender-sent",
  "lender-thread",
]);
await db.query(
  "update documents set storage_path='changed/later.pdf' where id=$1",
  [sentDoc.id],
);
assert.equal(
  (
    await db.query<{ storage_path: string }>(
      "select storage_path from submission_documents where outbox_id=$1",
      [sentId],
    )
  ).rows[0].storage_path,
  "sent/original.pdf",
);
await asUser(users.seller);
assert.equal(
  (await db.query("select * from submission_documents")).rows.length,
  0,
);
await asUser(users.superadmin);
const filteredStats = (
  await db.query<{
    result: {
      total: number;
      funded_amount: number;
      owners: unknown[];
      stage_days: object;
    };
  }>("select workspace_stats('Permission Test') result")
).rows[0].result;
assert.equal(filteredStats.total, 1);
assert.equal(filteredStats.funded_amount, 39000);
assert.equal(filteredStats.owners.length, 1);
assert.ok(Object.keys(filteredStats.stage_days).length >= 4);
console.log(
  "PASS uncertain sends are never blindly retried; submitted file versions and filtered stage metrics persist",
);
await asUser(users.superadmin);
const multiStepInput = {
  name: "Multi-step test",
  account_id: account,
  seller_id: users.seller,
  daily_limit: 25,
  timezone: "UTC",
  start_hour: 0,
  end_hour: 24,
  subject: "Initial",
  body: "Hi {{name}} {{unsubscribe_url}}",
  steps: [
    {
      subject: "Follow up 1",
      body: "Hi {{name}} {{unsubscribe_url}}",
      wait_days: 2,
    },
    {
      subject: "Follow up 2",
      body: "Hi {{company}} {{unsubscribe_url}}",
      wait_days: 5,
    },
  ],
};
const multiStep = await command("create_campaign", multiStepInput);
assert.equal(
  (
    await db.query<{ steps: unknown[] }>(
      "select steps from campaigns where id=$1",
      [multiStep.id],
    )
  ).rows[0].steps.length,
  2,
);
await assert.rejects(
  command("create_campaign", {
    ...multiStepInput,
    steps: [{ subject: "Bad step", body: "No unsubscribe", wait_days: 2 }],
  }),
  /Each follow-up/,
);
await asUser(users.seller);
await assert.rejects(
  command("update_lender", { id: lender.id, name: "Forbidden" }),
  /administrator/,
);
console.log(
  "PASS multi-step sequences preserve delays and require unsubscribe; sellers cannot change lenders",
);
// No validation outcome other than valid can open a commercial case.
await asUser(users.seller_admin);
const outcomes = ["invalid", "uncertain", "valid", "valid"] as const;
const outcomeContacts: string[] = [];
for (let i = 0; i < outcomes.length; i++) {
  const lead = await command("create_lead", {
    ...input,
    email: `outcome${i}@example.com`,
    company: `Outcome ${i}`,
    seller_id: users.seller_admin,
  });
  const row = (
    await db.query<{ contact_id: string }>(
      "select contact_id from leads where id=$1",
      [lead.id],
    )
  ).rows[0];
  outcomeContacts.push(row.contact_id);
}
await db.exec("reset role");
await db.query("select suppress_contact($1,'Test block')", [
  outcomeContacts[3],
]);
await asUser(users.seller_admin);
await command("verify_contacts", { contact_ids: outcomeContacts });
await db.exec("reset role");
assert.equal(
  (
    await db.query("select * from verifications where contact_id=$1", [
      outcomeContacts[3],
    ])
  ).rows.length,
  0,
);
for (let i = 0; i < 3; i++) {
  await db.query(
    "update verifications set state='submitted',provider_batch_id=$1 where contact_id=$2",
    [`outcome-${i}`, outcomeContacts[i]],
  );
  await db.query("select apply_verification_results($1,$2)", [
    `outcome-${i}`,
    JSON.stringify([
      { email: `outcome${i}@example.com`, result: outcomes[i], reason: "test" },
    ]),
  ]);
  assert.equal(
    (
      await db.query("select * from opportunities where contact_id=$1", [
        outcomeContacts[i],
      ])
    ).rows.length,
    i === 2 ? 1 : 0,
  );
}
await db.query("update contacts set verification='valid' where id=$1", [
  outcomeContacts[3],
]);
assert.equal(
  (
    await db.query("select * from opportunities where contact_id=$1", [
      outcomeContacts[3],
    ])
  ).rows.length,
  0,
);
await assert.rejects(
  db.query(
    "insert into opportunities(contact_id,company,seller_id) values($1,'Bypass',$2)",
    [outcomeContacts[0], users.seller_admin],
  ),
  /Verify the lead/,
);
await asUser(users.seller_admin);
await assert.rejects(
  command("create_opportunity", {
    ...input,
    email: "outcome2@example.com",
    seller_id: users.seller_admin,
  }),
  /Añadir proceso/,
);
const renewalCase = (
  await db.query<{ id: string }>(
    "select id from opportunities where contact_id=$1",
    [outcomeContacts[2]],
  )
).rows[0].id;
await db.exec("reset role");
const renewal = (
  await db.query<{ id: string }>(
    "select gmail_new_process($1,'New financing request','active',now(),$2,$3) id",
    [renewalCase, randomUUID(), users.seller_admin],
  )
).rows[0].id;
assert.ok(renewal);
assert.equal(
  (
    await db.query("select * from opportunities where contact_id=$1", [
      outcomeContacts[2],
    ])
  ).rows.length,
  1,
);
assert.equal(
  (await db.query("select * from contacts where id=$1", [outcomeContacts[2]]))
    .rows.length,
  1,
);
console.log(
  "PASS invalid, uncertain and blocked leads stay in preparation; new financing requests reuse the customer's case",
);
if (process.env.CRM_LOAD_ROWS === "50000") {
  await db.exec("reset role");
  const loadBatch = randomUUID();
  await db.query("select register_import($1,$2,$3,$4,$5,$6,$7,$8)", [
    loadBatch,
    "load-50000.csv",
    "synthetic.csv",
    {},
    "",
    50000,
    users.seller_admin,
    randomUUID(),
  ]);
  const started = performance.now();
  for (let offset = 0; offset < 50000; offset += 250) {
    const rows = Array.from({ length: 250 }, (_, index) => ({
      row_number: offset + index + 2,
      valid: true,
      email: `load-${offset + index}@example.com`,
      contact: `Test ${offset + index}`,
      company: `Synthetic ${offset + index}`,
    }));
    await db.query("select ingest_import_chunk($1,$2)", [
      loadBatch,
      JSON.stringify(rows),
    ]);
    if (offset === 24750)
      await db.query("select ingest_import_chunk($1,$2)", [
        loadBatch,
        JSON.stringify(rows),
      ]);
    if ((offset + 250) % 10000 === 0) console.log(`LOAD ${offset + 250}/50000`);
  }
  const report = (
    await db.query<{ processed: number; imported: number; status: string }>(
      "select processed,imported,status from import_batches where id=$1",
      [loadBatch],
    )
  ).rows[0];
  assert.deepEqual(report, {
    processed: 50000,
    imported: 50000,
    status: "completed",
  });
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from leads where batch_id=$1",
        [loadBatch],
      )
    ).rows[0].n,
    50000,
  );
  assert.equal(
    (
      await db.query(
        "select o.id from opportunities o join leads l on l.contact_id=o.contact_id where l.batch_id=$1",
        [loadBatch],
      )
    ).rows.length,
    0,
  );
  console.log(
    `PASS 50,000 persisted rows in 250-row chunks, including a replay: ${Math.round(performance.now() - started)} ms`,
  );
}
await db.close();
console.log("Database acceptance tests passed.");
