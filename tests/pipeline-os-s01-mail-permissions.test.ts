import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";

const oldFetch = globalThis.fetch;
let network = 0;
globalThis.fetch = async () => {
  network++;
  throw Error("I02_NETWORK_DISABLED");
};
after(() => {
  globalThis.fetch = oldFetch;
  assert.equal(network, 0);
});
const root = "tests/fixtures/pipeline-os-s01/";

async function fixture() {
  const f = await featureDatabase();
  const company = randomUUID(),
    contact = randomUUID(),
    caseId = randomUUID();
  const account = randomUUID(),
    conversation = randomUUID();
  await f.db.query("insert into companies(id,name) values($1,'I02 fixture')", [
    company,
  ]);
  await f.db.query(
    "insert into contacts(id,company_id,email,name,verification) values($1,$2,'client@i02.test','Fixture','valid')",
    [contact, company],
  );
  await f.db.query(
    "insert into opportunities(id,company_id,contact_id,company,seller_id,closer_id,handed_off_at) values($1,$2,$3,'I02 fixture',$4,$5,'2026-01-02')",
    [caseId, company, contact, f.users.seller, f.users.closer],
  );
  await f.db.query(
    "insert into mail_accounts(id,email,organization,owner_id) values($1,'sender@i02.test','fixture',$2)",
    [account, f.users.seller],
  );
  await f.db.query(
    "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true),($1,$3,true)",
    [account, f.users.seller, f.users.closer],
  );
  await f.db.query(
    "insert into conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area) values($1,$2,$3,'mixed','Hidden closer subject','seller')",
    [conversation, caseId, account],
  );
  const seller = randomUUID(),
    closer = randomUUID();
  for (const [id, date, body] of [
    [seller, "2026-01-01", "Seller visible"],
    [closer, "2026-01-03", "Closer hidden"],
  ])
    await f.db.query(
      "insert into messages(id,conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1::uuid,$2,$1::uuid::text,'inbound','client@i02.test',$3,$4,'received')",
      [id, conversation, body, date],
    );
  return { ...f, caseId, account, conversation, seller, closer };
}

test("I02 characterization: 021 exposes a closer message and raw header to the assigned seller", async () => {
  const f = await fixture();
  try {
    await f.asUser(f.users.seller);
    assert.equal(
      (
        await f.db.query<{ allowed: boolean }>(
          "select can_area($1,'closer') allowed",
          [f.caseId],
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (await f.db.query("select id from messages where id=$1", [f.closer])).rows
        .length,
      1,
    );
    assert.equal(
      (
        await f.db.query<{ subject: string }>(
          "select subject from conversations where id=$1",
          [f.conversation],
        )
      ).rows[0].subject,
      "Hidden closer subject",
    );
  } finally {
    await f.db.close();
  }
});

test("I02 regression: seller cannot read closer sources or a raw conversation header", async () => {
  const f = await fixture();
  try {
    const legacy = randomUUID();
    await f.db.query(
      "insert into documents(id,opportunity_id,name,kind,storage_path,content_hash) values($1,$2,'Legacy','legacy','legacy-path','legacy-hash')",
      [legacy, f.caseId],
    );
    await f.db.query(
      "insert into document_versions(document_id,storage_path,content_hash,source) values($1,'legacy-path','legacy-hash','fixture')",
      [legacy],
    );
    await f.db.exec("set pipeline_os.i02_sandbox='in_memory_test'");
    await f.db.exec(
      await readFile(root + "t01-02-i02-mail-permissions.sql", "utf8"),
    );
    await f.asUser(f.users.seller);
    assert.equal(
      (await f.db.query("select id from documents where id=$1", [legacy])).rows
        .length,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "select id from document_versions where document_id=$1",
          [legacy],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await f.db.query("select id from messages where id=$1", [f.closer])).rows
        .length,
      0,
    );
    assert.equal(
      (await f.db.query("select id from messages where id=$1", [f.seller])).rows
        .length,
      1,
    );
    await assert.rejects(
      f.db.query("select subject from conversations where id=$1", [
        f.conversation,
      ]),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});

test("I02 expands and reverses an empty business baseline without touching historical objects", async () => {
  const f = await featureDatabase();
  try {
    const before = (
      await f.db.query(
        "select count(*) n from conversations union all select count(*) from documents union all select count(*) from outbox",
      )
    ).rows;
    await f.db.exec("set pipeline_os.i02_sandbox='in_memory_test'");
    await f.db.exec(
      await readFile(root + "t01-02-i02-mail-permissions.sql", "utf8"),
    );
    await f.db.exec(
      await readFile(root + "t01-02-i02-mail-permissions.rollback.sql", "utf8"),
    );
    assert.deepEqual(
      (
        await f.db.query(
          "select count(*) n from conversations union all select count(*) from documents union all select count(*) from outbox",
        )
      ).rows,
      before,
    );
    assert.equal(
      (
        await f.db.query<{ name: string | null }>(
          "select to_regnamespace('s01_i02')::text name",
        )
      ).rows[0].name,
      null,
    );
  } finally {
    await f.db.close();
  }
});

test("I02 matrix, metadata invariance, version scope and queue revocation", async (t) => {
  const f = await fixture();
  try {
    const up = await readFile(root + "t01-02-i02-mail-permissions.sql", "utf8");
    const down = await readFile(
      root + "t01-02-i02-mail-permissions.rollback.sql",
      "utf8",
    );
    async function owner() {
      await f.db.exec(
        "reset role;select set_config('request.jwt.claims','',false)",
      );
    }
    async function projection() {
      return (
        await f.db.query("select * from mail_conversations_visible order by id")
      ).rows;
    }
    const before = (
      await f.db.query(
        "select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname",
      )
    ).rows;
    const oldFunctions = (
      await f.db.query(
        "select oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by signature",
      )
    ).rows;
    const oldGrants = (
      await f.db.query(
        "select c.oid::regclass::text relation,x.grantee,x.privilege_type,x.is_grantable from pg_class c cross join lateral aclexplode(c.relacl) x where c.oid in ('public.conversations'::regclass,'public.outbox'::regclass) order by relation,x.grantee,x.privilege_type",
      )
    ).rows;
    await assert.rejects(f.db.exec(up), /sandbox marker/);
    await f.db.exec("rollback;set pipeline_os.i02_sandbox='in_memory_test'");
    await f.db.exec(up);

    await t.test(
      "five roles, outsider, AAL1, inactive and untrusted metadata",
      async () => {
        for (const role of ["seller_admin", "closer_admin", "seller", "closer"])
          for (let peer = 0; peer < 2; peer++) {
            const id = randomUUID();
            await owner();
            await f.db.query("insert into auth.users values($1,$2)", [
              id,
              id + "@i02.test",
            ]);
            await f.db.query(
              "insert into profiles(id,name,email,role) values($1,$2,$3,$4)",
              [id, role, id + "@i02.test", role],
            );
            await f.asUser(id);
            assert.equal(
              (await f.db.query("select id from messages")).rows.length,
              role === "seller_admin" ? 1 : role === "closer_admin" ? 2 : 0,
            );
          }
        for (const [id, count] of [
          [f.users.seller, 1],
          [f.users.closer, 2],
          [f.users.admin, 2],
          [f.users.outsider, 0],
        ] as const) {
          await f.asUser(id);
          assert.equal(
            (await f.db.query("select id from messages")).rows.length,
            count,
          );
        }
        await f.asUser(f.users.seller, "aal1");
        assert.deepEqual(await projection(), []);
        await owner();
        await f.db.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({
            sub: f.users.outsider,
            aal: "aal2",
            user_metadata: { role: "superadmin" },
          }),
        ]);
        await f.db.exec("set role authenticated");
        assert.equal(
          (await f.db.query("select id from messages")).rows.length,
          0,
        );
        await assert.rejects(
          f.db.query("select s01_i02.phase($1)", [f.caseId]),
          /permission denied/,
        );
        await owner();
        await f.db.query("update profiles set active=false where id=$1", [
          f.users.admin,
        ]);
        await f.asUser(f.users.admin);
        assert.deepEqual(await projection(), []);
        await owner();
        await f.db.query("update profiles set active=true where id=$1", [
          f.users.admin,
        ]);
        await f.db.exec("set role anon");
        await assert.rejects(
          f.db.query("select * from mail_conversations_visible"),
          /permission denied/,
        );
      },
    );

    await t.test(
      "reading history of M2 does not require its membership or inherit closer area",
      async () => {
        await owner();
        await f.db.exec("set pipeline_os.i01_sandbox='in_memory_test'");
        await f.db.exec(
          await readFile(root + "t01-02-i01-foundation.sql", "utf8"),
        );
        const m1 = randomUUID(),
          m2 = randomUUID();
        await f.db.query(
          "insert into operating_brands(id,code,name,created_by,updated_by) values($1,'M1','M1',$3,$3),($2,'M2','M2',$3,$3)",
          [m1, m2, f.users.admin],
        );
        await f.db.query(
          "insert into operating_brand_memberships(brand_id,user_id,assigned_by) values($1,$2,$3)",
          [m1, f.users.seller, f.users.admin],
        );
        await f.db.query(
          "update mail_accounts set operating_brand_id=$1,brand_revision=1 where id=$2",
          [m2, f.account],
        );
        await f.asUser(f.users.seller);
        assert.equal(
          (await f.db.query("select id from messages where id=$1", [f.seller]))
            .rows.length,
          1,
        );
        assert.equal(
          (await f.db.query("select id from messages where id=$1", [f.closer]))
            .rows.length,
          0,
        );
        assert.equal(
          (
            await f.db.query(
              "select user_id from operating_brand_memberships where brand_id=$1",
              [m2],
            )
          ).rows.length,
          0,
        );
        // I01 has its own session reversal; restore that fixture before testing I02 rollback.
        await owner();
        await f.db.exec(
          await readFile(root + "t01-02-i01-foundation.rollback.sql", "utf8"),
        );
      },
    );

    await t.test(
      "adding hidden closer activity leaves seller metadata and stats unchanged",
      async () => {
        await owner();
        const empty = randomUUID(),
          visibleProcess = randomUUID();
        await f.db.query(
          "insert into financing_processes(id,opportunity_id,sequence_number,started_at,classification,label) values($1,$2,10,'2026-01-01','active','Label later overwritten by closer')",
          [visibleProcess, f.caseId],
        );
        await f.db.query(
          "insert into case_events(opportunity_id,process_id,area,kind,body,evidence_type,occurred_at) values($1,$2,'seller','fixture','Visible source','manual','2026-01-01')",
          [f.caseId, visibleProcess],
        );
        await f.db.query(
          "insert into conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area) values($1,$2,$3,'empty','Unknown subject','seller')",
          [empty, f.caseId, f.account],
        );
        await f.asUser(f.users.seller);
        const visible = await projection();
        const stats = (
          await f.db.query("select mail_case_stats($1) stats", [f.caseId])
        ).rows;
        await owner();
        await f.db.query(
          "update conversations set subject='Hidden empty update',updated_at='2026-09-01',needs_attention=true where id=$1",
          [empty],
        );
        await f.db.exec(
          "create policy fixture_permissive_leak on messages for select to authenticated using(true)",
        );
        await f.db.query(
          "update conversations set subject='Another hidden negotiation',needs_attention=true,updated_at='2026-08-01' where id=$1",
          [f.conversation],
        );
        await f.db.query(
          "insert into messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1,'later-hidden','inbound','private@i02.test','Hidden lender answer','2026-08-01','received')",
          [f.conversation],
        );
        await f.db.query(
          "insert into financing_processes(opportunity_id,sequence_number,started_at,classification,label) values($1,99,now(),'active','Hidden lender decision')",
          [f.caseId],
        );
        await f.asUser(f.users.seller);
        assert.deepEqual(await projection(), visible);
        assert.deepEqual(
          (await f.db.query("select mail_case_stats($1) stats", [f.caseId]))
            .rows,
          stats,
        );
        const processes = (
          await f.db.query<{
            id: string;
            label: string;
            classification: string;
            sequence_number: number;
          }>("select * from mail_processes_visible")
        ).rows;
        assert.equal(processes.length, 1);
        assert.equal(processes[0].id, visibleProcess);
        assert.equal(processes[0].label, "Process");
        assert.equal(processes[0].classification, "unknown");
        assert.equal(processes[0].sequence_number, 1);
        assert.equal(
          (await f.db.query("select id from messages where id=$1", [f.closer]))
            .rows.length,
          0,
          "restrictive bound survives a permissive OR",
        );
        await assert.rejects(
          f.db.query("select bcc_emails from outbox"),
          /permission denied/,
        );
      },
    );

    await t.test(
      "current closer file cannot hide a visible seller version or expose a closer review",
      async () => {
        await owner();
        // A new seller content version is created in its verified phase.
        await f.db.query(
          "update opportunities set closer_id=null,handed_off_at=null where id=$1",
          [f.caseId],
        );
        const doc = randomUUID(),
          oldVersion = randomUUID(),
          newVersion = randomUUID(),
          legacy = randomUUID();
        await f.db.query(
          "insert into documents(id,opportunity_id,name,kind,storage_path,content_hash) values($1,$2,'Original','fixture','seller-path','seller-hash')",
          [doc, f.caseId],
        );
        await f.db.query(
          "insert into document_versions(id,document_id,storage_path,content_hash,source) values($1,$2,'seller-path','seller-hash','fixture')",
          [oldVersion, doc],
        );
        await f.db.query(
          "update opportunities set handed_off_at='2026-01-02',closer_id=$2 where id=$1",
          [f.caseId, f.users.closer],
        );
        await f.db.query(
          "insert into document_versions(id,document_id,storage_path,content_hash,source) values($1,$2,'closer-path','closer-hash','fixture')",
          [newVersion, doc],
        );
        await f.db.query(
          "update documents set name='Closer replacement',storage_path='closer-path',content_hash='closer-hash' where id=$1",
          [doc],
        );
        await f.db.query(
          "insert into document_reviews(document_id,content_hash,status,reviewer_id) values($1,'closer-hash','approved',$2),($1,'seller-hash','received',$2)",
          [doc, f.users.closer],
        );
        await f.db.query(
          "insert into storage.objects(bucket_id,name) values('case-documents','seller-path'),('case-documents','closer-path')",
        );
        await f.db.query(
          "select notify_user($1,$2,'Private document update')",
          [f.users.seller, "document:" + doc + ":closer-hash"],
        );
        assert.equal(
          (
            await f.db.query(
              "select id from notifications where event_key=$1",
              ["document:" + doc + ":closer-hash"],
            )
          ).rows.length,
          0,
        );
        await f.db.query(
          "insert into notifications(user_id,title,body,event_key) values($1,'Legacy private','Fixture',$2)",
          [f.users.seller, "document:" + doc + ":closer-hash"],
        );
        const sent = randomUUID();
        const snapshot = {
          id: doc,
          name: "Old visible file",
          content_hash: "seller-hash",
          storage_path: "seller-path",
          bucket: "case-documents",
        };
        await f.db.query(
          "insert into outbox(id,account_id,opportunity_id,to_email,subject,body,area,status,message_id_header,request_key,attachment_snapshot) values($1,$2,$3,'client@i02.test','Old','Fixture','seller','sent',$4,$4,$5)",
          [sent, f.account, f.caseId, randomUUID(), JSON.stringify([snapshot])],
        );
        await f.asUser(f.users.seller);
        assert.equal(
          (
            await f.db.query(
              "select id from notifications where event_key=$1",
              ["document:" + doc + ":closer-hash"],
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await f.db.query<{ allowed: boolean }>(
              "select mail_snapshot_allowed($1,$2) allowed",
              [sent, doc],
            )
          ).rows[0].allowed,
          true,
        );
        assert.equal(
          (await f.db.query("select * from documents where id=$1", [doc])).rows
            .length,
          0,
        );
        assert.deepEqual(
          (
            await f.db.query<{ id: string }>(
              "select id from document_versions where document_id=$1",
              [doc],
            )
          ).rows.map((r) => r.id),
          [oldVersion],
        );
        assert.deepEqual(
          (
            await f.db.query<{ content_hash: string }>(
              "select content_hash from document_reviews where document_id=$1",
              [doc],
            )
          ).rows.map((r) => r.content_hash),
          ["seller-hash"],
        );
        assert.deepEqual(
          (
            await f.db.query<{ name: string }>(
              "select name from storage.objects where name in ('seller-path','closer-path')",
            )
          ).rows.map((r) => r.name),
          ["seller-path"],
        );
        assert.equal(
          (
            await f.db.query<{ allowed: boolean }>(
              "select mail_source_allowed('version',$1,null) allowed",
              [newVersion],
            )
          ).rows[0].allowed,
          false,
        );
        await owner();
        await f.db.query(
          "update outbox set attachment_snapshot=$2 where id=$1",
          [sent, JSON.stringify([{ ...snapshot, bucket: "campaign-assets" }])],
        );
        await f.asUser(f.users.seller);
        assert.equal(
          (
            await f.db.query<{ allowed: boolean }>(
              "select mail_snapshot_allowed($1,$2) allowed",
              [sent, doc],
            )
          ).rows[0].allowed,
          false,
        );
        await owner();
        await assert.rejects(
          f.db.query(
            "update document_versions set access_area='seller' where id=$1",
            [newVersion],
          ),
          /Immutable/,
        );
        await f.db.query(
          "insert into documents(id,opportunity_id,name,kind) values($1,$2,'Unknown legacy','unknown')",
          [legacy, f.caseId],
        );
        // Simulate an indeterminate row from before installation without changing a fixture's bytes.
        await f.db.exec("alter table documents disable trigger s01_i02_scope");
        await f.db.query("update documents set access_area=null where id=$1", [
          legacy,
        ]);
        await f.db.exec("alter table documents enable trigger s01_i02_scope");
        await f.asUser(f.users.seller);
        assert.equal(
          (await f.db.query("select id from documents where id=$1", [legacy]))
            .rows.length,
          0,
        );
      },
    );

    await t.test(
      "seller after handoff cannot queue, forward or replay a lender receipt",
      async () => {
        await f.asUser(f.users.seller);
        await assert.rejects(
          f.db.query("select crm_command('reply',$1,$2)", [
            JSON.stringify({
              conversation_id: f.conversation,
              body: "Fixture",
            }),
            randomUUID(),
          ]),
          /area access/,
        );
        await assert.rejects(
          f.db.query(
            "select queue_mail_email($1,$2,'client@i02.test','Subject','Body','{}','{}','{}','{}','{}',null,null,null,null,'','', $3)",
            [f.caseId, f.account, randomUUID()],
          ),
          /area access/,
        );
        for (const fn of ["queue_mail_forward", "queue_mail_lenders"])
          await assert.rejects(
            f.db.query(`select ${fn}($1)`, [
              JSON.stringify({
                case_id: f.caseId,
                forward_message_id: f.closer,
                files: [],
                gmail_files: [],
                uploads: [],
              }),
            ]),
            /area access/,
          );
        await assert.rejects(
          f.db.query("insert into mail_drafts values($1,$2,$3,'{}',now())", [
            randomUUID(),
            f.caseId,
            f.users.seller,
          ]),
          /row-level security/,
        );
      },
    );

    await t.test(
      "authorized pre-handoff mail remains idempotent and uploads cannot spoof an area",
      async () => {
        await owner();
        await f.db.query(
          "update opportunities set handed_off_at=null,closer_id=null where id=$1",
          [f.caseId],
        );
        const key = randomUUID();
        await f.asUser(f.users.seller);
        const send = () =>
          f.db.query<{ id: string }>(
            "select queue_mail_email($1,$2,'client@i02.test','Subject','Body','{}','{}','{}','{}','{}',null,null,null,null,'','',$3) id",
            [f.caseId, f.account, key],
          );
        const first = (await send()).rows[0].id;
        assert.equal((await send()).rows[0].id, first);
        await owner();
        await f.db.query(
          "update opportunities set handed_off_at='2026-01-02',closer_id=$2 where id=$1",
          [f.caseId, f.users.closer],
        );
        const upload = randomUUID();
        await assert.rejects(
          f.db.query(
            "insert into mail_uploads(id,opportunity_id,uploaded_by,name,mime_type,size,storage_path,content_hash,access_area) values($1,$2,$3,'Fixture','text/plain',1,'upload-path','upload-hash','seller')",
            [upload, f.caseId, f.users.seller],
          ),
          /area access/,
        );
        await f.db.query(
          "insert into mail_uploads(id,opportunity_id,uploaded_by,name,mime_type,size,storage_path,content_hash,access_area) values($1,$2,$3,'Fixture','text/plain',1,'upload-path','upload-hash','seller')",
          [upload, f.caseId, f.users.closer],
        );
        assert.equal(
          (
            await f.db.query<{ access_area: string }>(
              "select access_area from mail_uploads where id=$1",
              [upload],
            )
          ).rows[0].access_area,
          "closer",
        );
        await f.asUser(f.users.seller);
        assert.equal(
          (
            await f.db.query("select id from mail_uploads where id=$1", [
              upload,
            ])
          ).rows.length,
          0,
        );
        await f.asUser(f.users.closer);
        assert.equal(
          (
            await f.db.query("select id from mail_uploads where id=$1", [
              upload,
            ])
          ).rows.length,
          1,
        );
      },
    );

    await t.test(
      "a queued actor loses authority at claim and again at the final transport guard",
      async () => {
        await owner();
        const pending = randomUUID();
        await f.db.query(
          "insert into outbox(id,account_id,opportunity_id,to_email,subject,body,area,message_id_header,request_key,requested_by) values($1,$2,$3,'client@i02.test','Fixture','Body','closer',$4,$4,$5)",
          [pending, f.account, f.caseId, randomUUID(), f.users.seller],
        );
        assert.equal(
          (await f.db.query("select * from claim_outbox()")).rows.length,
          0,
        );
        assert.equal(
          (
            await f.db.query<{ status: string }>(
              "select status from outbox where id=$1",
              [pending],
            )
          ).rows[0].status,
          "paused",
        );
        await f.db.query(
          "update outbox set status='sending',requested_by=$2 where id=$1",
          [pending, f.users.closer],
        );
        assert.equal(
          (
            await f.db.query<{ allowed: boolean }>(
              "select recheck_outbox_delivery($1) allowed",
              [pending],
            )
          ).rows[0].allowed,
          true,
        );
        await f.db.query("delete from mail_permissions where user_id=$1", [
          f.users.closer,
        ]);
        assert.equal(
          (
            await f.db.query<{ allowed: boolean }>(
              "select recheck_outbox_delivery($1) allowed",
              [pending],
            )
          ).rows[0].allowed,
          false,
        );
        assert.equal(
          (
            await f.db.query<{ status: string }>(
              "select status from outbox where id=$1",
              [pending],
            )
          ).rows[0].status,
          "paused",
        );
      },
    );

    await t.test(
      "administrative diagnostics preserve general outbox while malformed snapshots fail closed",
      async () => {
        await owner();
        const general = randomUUID(),
          bad = randomUUID(),
          notification = randomUUID();
        await f.db.query(
          "insert into notifications(id,user_id,title,body,event_key) values($1,$2,'General','Fixture','fixture-general')",
          [notification, f.users.admin],
        );
        await f.db.query(
          "insert into outbox(id,account_id,notification_id,to_email,subject,body,area,message_id_header,request_key,bcc_emails) values($1,$2,$4,'client@i02.test','General','Fixture','general',$3,$3,array['private@fixture.test'])",
          [general, f.account, randomUUID(), notification],
        );
        await f.db.query(
          "insert into outbox(id,account_id,opportunity_id,to_email,subject,body,area,message_id_header,request_key,attachment_snapshot) values($1,$2,$3,'client@i02.test','Malformed','Fixture','seller',$4,$4,'{}'::jsonb)",
          [bad, f.account, f.caseId, randomUUID()],
        );
        await f.asUser(f.users.seller);
        assert.equal(
          (await f.db.query("select id from outbox where id=$1", [bad])).rows
            .length,
          0,
        );
        assert.equal(
          (
            await f.db.query<{ allowed: boolean }>(
              "select mail_snapshot_allowed($1,$2) allowed",
              [bad, randomUUID()],
            )
          ).rows[0].allowed,
          false,
        );
        assert.deepEqual(
          (await f.db.query("select * from mail_admin_outbox_visible")).rows,
          [],
        );
        await f.asUser(f.users.admin);
        assert.equal(
          (await f.db.query("select id from outbox where id=$1", [general]))
            .rows.length,
          1,
        );
        assert.equal(
          (
            await f.db.query(
              "select bcc_emails from mail_admin_outbox_visible where id=$1",
              [general],
            )
          ).rows.length,
          1,
        );
      },
    );

    await t.test(
      "fixture-only reversal restores policies and grants; reapplication succeeds",
      async () => {
        await owner();
        await f.db.exec(down);
        assert.deepEqual(
          (
            await f.db.query(
              "select oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by signature",
            )
          ).rows,
          oldFunctions,
        );
        assert.deepEqual(
          (
            await f.db.query(
              "select c.oid::regclass::text relation,x.grantee,x.privilege_type,x.is_grantable from pg_class c cross join lateral aclexplode(c.relacl) x where c.oid in ('public.conversations'::regclass,'public.outbox'::regclass) order by relation,x.grantee,x.privilege_type",
            )
          ).rows,
          oldGrants,
        );
        assert.deepEqual(
          (
            await f.db.query(
              "select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname",
            )
          ).rows,
          before,
        );
        await f.asUser(f.users.seller);
        assert.ok(
          (await f.db.query("select subject from conversations")).rows.length,
        );
        await owner();
        await f.db.exec(up);
        await f.db.exec(down);
      },
    );
  } finally {
    await f.db.close();
  }
});
