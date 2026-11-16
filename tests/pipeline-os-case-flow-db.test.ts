import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "./feature-database";
import { readFile } from "node:fs/promises";

test("FLOW AC02: new lender evaluation belongs to current owner without handoff; sender grant remains mandatory; no delivery worker", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const caseId = randomUUID(),
      contact = randomUUID(),
      account = randomUUID(),
      lender = randomUUID(),
      process = randomUUID();
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,'fixture@example.invalid','Fixture','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id,historical_approved_at) values($1,$2,'Caso ficticio',$3,now())",
      [caseId, contact, users.seller],
    );
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id) values($1,'sender@example.invalid','Fictional',$2)",
      [account, users.seller],
    );
    await db.query(
      "insert into financing_processes(id,opportunity_id,sequence_number,classification,started_at,label) values($1,$2,1,'active',now(),'Operación ficticia')",
      [process, caseId],
    );
    await db.query(
      "insert into lenders(id,name,email,channel) values($1,'Lender ficticio','lender@example.invalid','email')",
      [lender],
    );
    for (let i = 0; i < 5; i++)
      await db.query(
        "insert into documents(opportunity_id,name,kind,period,status,storage_path,content_hash) values($1,'Fuente ficticia',$2,$3,'approved',$4,$5)",
        [
          caseId,
          i === 0 ? "application" : "bank_statement",
          `2026-0${i + 1}`,
          `fixture/${i}.pdf`,
          `hash-${i}`,
        ],
      );
    const queue = () =>
      db.query(
        "select queue_lender_emails($1,$2,$3,$4,'Prueba ficticia','Cuerpo ficticio','{}','{}',$5)",
        [
          caseId,
          account,
          process,
          [{ lender_id: lender, email: "lender@example.invalid" }],
          randomUUID(),
        ],
      );
    await asUser(users.seller);
    await assert.rejects(queue, /Sender permission|required|access/i);
    await db.exec("reset role");
    await db.query(
      "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true)",
      [account, users.seller],
    );
    await asUser(users.seller);
    await queue();
    const evaluations = await db.query<{ closer_id: string }>(
      "select closer_id from submissions where opportunity_id=$1",
      [caseId],
    );
    assert.equal(evaluations.rows.length, 1);
    assert.equal(evaluations.rows[0].closer_id, users.seller);
    await db.exec("reset role");
    const outbox = await db.query<{ status: string }>(
      "select status from outbox where opportunity_id=$1",
      [caseId],
    );
    assert.equal(outbox.rows.length, 1);
    assert.notEqual(outbox.rows[0].status, "sent");
  } finally {
    await db.close();
  }
});

test("FLOW AC02/04/05/06: owner without handoff, RLS, evidence, atomic lender choice, manual CAS and funding separation", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const caseId = randomUUID(),
      other = randomUUID(),
      contact = randomUUID(),
      document = randomUUID(),
      foreignDoc = randomUUID(),
      lenderA = randomUUID(),
      lenderB = randomUUID();
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,'fixture@example.invalid','Persona ficticia','valid')",
      [contact],
    );
    for (const id of [caseId, other])
      await db.query(
        "insert into opportunities(id,contact_id,company,seller_id,historical_approved_at) values($1,$2,'Empresa ficticia',$3,now())",
        [id, contact, users.seller],
      );
    for (const [id, parent] of [
      [document, caseId],
      [foreignDoc, other],
    ])
      await db.query(
        "insert into documents(id,opportunity_id,name,kind,storage_path) values($1,$2,'Respaldo ficticio','other','fixture/proof.pdf')",
        [id, parent],
      );
    for (const [id, email] of [
      [lenderA, "a@lender.example"],
      [lenderB, "b@lender.example"],
    ])
      await db.query(
        "insert into lenders(id,name,email,products,channel) values($1,'Lender ficticio',$2,array['MCA'],'email')",
        [id, email],
      );
    const command = async (p: object, target = caseId) =>
      (
        await db.query<{ result: { process_id: string; event_id: string } }>(
          "select case_flow_command($1,$2) result",
          [target, p],
        )
      ).rows[0].result;
    const base = {
      request_key: randomUUID(),
      process_id: null,
      archive_message_id: null,
      document_id: document,
      reason: "Confirmación ficticia con respaldo",
    };
    await asUser(users.outsider);
    assert.equal(
      (await db.query("select * from opportunities where id=$1", [caseId])).rows
        .length,
      0,
    );
    await assert.rejects(
      () =>
        command({
          ...base,
          operation: "confirmation",
          milestone: "statements",
          decision: "confirmed",
          expected_event_id: null,
        }),
      /access denied/i,
    );
    await asUser(users.seller, "aal1");
    await assert.rejects(
      () =>
        command({
          ...base,
          operation: "confirmation",
          milestone: "statements",
          decision: "confirmed",
          expected_event_id: null,
        }),
      /access denied/i,
    );
    await asUser(users.seller);
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select can_manage_case_flow($1) allowed",
          [caseId],
        )
      ).rows[0].allowed,
      true,
    );
    await assert.rejects(
      () =>
        command({
          ...base,
          document_id: foreignDoc,
          operation: "confirmation",
          milestone: "statements",
          decision: "confirmed",
          expected_event_id: null,
        }),
      /another case/i,
    );
    const confirmation = {
      ...base,
      operation: "confirmation",
      milestone: "statements",
      decision: "confirmed",
      expected_event_id: null,
    };
    const first = await command(confirmation);
    assert.deepEqual(await command(confirmation), first);
    await assert.rejects(
      () => command({ ...confirmation, reason: "different" }),
      /key conflict/i,
    );
    await assert.rejects(
      () => command({ ...confirmation, request_key: randomUUID() }),
      /changed/i,
    );
    await command({
      ...confirmation,
      request_key: randomUUID(),
      decision: "automatic",
      expected_event_id: first.event_id,
    });
    await assert.rejects(
      () =>
        command({
          ...confirmation,
          request_key: randomUUID(),
          milestone: "review",
        }),
      /Structured evidence/,
    );
    const lender = {
      ...base,
      operation: "lender",
      expected_event_id: null,
      conversation_id: null,
      lender_id: lenderA,
      state: "offer",
      offered_amount: 50000,
      agreed_amount: null,
      request_key: randomUUID(),
    };
    const a = await command(lender);
    const b = await command({
      ...lender,
      process_id: a.process_id,
      lender_id: lenderB,
      offered_amount: 60000,
      expected_event_id: a.event_id,
      request_key: randomUUID(),
    });
    const selectedA = await command({
      ...lender,
      process_id: a.process_id,
      state: "selected",
      expected_event_id: b.event_id,
      request_key: randomUUID(),
    });
    assert.equal(
      (
        await db.query(
          "select * from offers where opportunity_id=$1 and status='selected'",
          [caseId],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from offers where opportunity_id=$1 and status='received'",
          [caseId],
        )
      ).rows.length,
      1,
    );
    await assert.rejects(
      () =>
        command({
          ...lender,
          process_id: a.process_id,
          lender_id: lenderB,
          state: "selected",
          expected_event_id: b.event_id,
          request_key: randomUUID(),
        }),
      /changed/,
    );
    const selectedB = await command({
      ...lender,
      process_id: a.process_id,
      lender_id: lenderB,
      state: "selected",
      expected_event_id: selectedA.event_id,
      request_key: randomUUID(),
    });
    const agreed = await command({
      ...lender,
      process_id: a.process_id,
      lender_id: lenderB,
      state: "agreed_amount",
      agreed_amount: 55000,
      expected_event_id: selectedB.event_id,
      request_key: randomUUID(),
    });
    const funding = (
      await db.query<{
        actual_funded_amount: number | null;
        funded_lender_id: string | null;
      }>(
        "select actual_funded_amount,funded_lender_id from financing_processes where id=$1",
        [a.process_id],
      )
    ).rows[0];
    assert.equal(funding.actual_funded_amount, null);
    assert.equal(funding.funded_lender_id, null);
    await db.exec("reset role");
    await db.query(
      "insert into submissions(id,opportunity_id,process_id,lender_id,closer_id,status,channel,next_action,next_action_at) values('00000000-0000-4000-8000-000000000001',$1,$2,$3,$4,'draft','email','Duplicado ficticio',now())",
      [caseId, a.process_id, lenderB, users.seller],
    );
    await asUser(users.seller);
    const corrected = await command({
      ...lender,
      process_id: a.process_id,
      lender_id: lenderB,
      state: "agreed_amount",
      agreed_amount: 54000,
      expected_event_id: agreed.event_id,
      request_key: randomUUID(),
    });
    const audit = (
      await db.query<{
        workflow_value: {
          previous_agreed_amount: number;
          agreed_amount: number;
        };
      }>("select workflow_value from case_events where id=$1", [
        corrected.event_id,
      ])
    ).rows[0].workflow_value;
    assert.equal(audit.previous_agreed_amount, 55000);
    assert.equal(audit.agreed_amount, 54000);
    await command({
      ...base,
      process_id: a.process_id,
      operation: "closing",
      state: "contract_sent",
      funded_amount: null,
      lender_id: null,
      request_key: randomUUID(),
    });
    await assert.rejects(
      () =>
        command({
          ...lender,
          process_id: a.process_id,
          lender_id: lenderA,
          state: "selected",
          expected_event_id: corrected.event_id,
          request_key: randomUUID(),
        }),
      /Contract already recorded/,
    );
    await assert.rejects(
      () =>
        command({
          ...base,
          process_id: a.process_id,
          operation: "closing",
          state: "disbursed",
          lender_id: lenderB,
          funded_amount: 0,
          request_key: randomUUID(),
        }),
      /funding amount/,
    );
    await command({
      ...base,
      process_id: a.process_id,
      operation: "closing",
      state: "disbursed",
      lender_id: lenderB,
      funded_amount: 55000,
      request_key: randomUUID(),
    });
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from financing_processes where id=$1",
          [a.process_id],
        )
      ).rows[0].state,
      "disbursed",
    );
    await assert.rejects(
      () =>
        command({
          ...lender,
          process_id: a.process_id,
          request_key: randomUUID(),
        }),
      /read-only/,
    );
    await db.exec("reset role");
    const countBefore = (
      await db.query("select id from case_events where opportunity_id=$1", [
        caseId,
      ])
    ).rows.length;
    await db.exec(
      await readFile("docs/specs/case-flow-20261116/rollback.sql", "utf8"),
    );
    assert.equal(
      (
        await db.query("select id from case_events where opportunity_id=$1", [
          caseId,
        ])
      ).rows.length,
      countBefore,
    );
    assert.equal(
      (
        await db.query<{ agreed_amount: string }>(
          "select agreed_amount from submissions where process_id=$1 and lender_id=$2 and agreed_amount is not null",
          [a.process_id, lenderB],
        )
      ).rows[0].agreed_amount,
      "54000.00",
    );
    await db.exec(
      await readFile("supabase/migrations/055_case_flow.sql", "utf8"),
    );
    await asUser(users.seller);
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select can_manage_case_flow($1) allowed",
          [caseId],
        )
      ).rows[0].allowed,
      true,
    );
  } finally {
    await db.close();
  }
});

test("FLOW AC01/02: approve the generated report, reject with audit, invalidate on source change; owner/admin/MFA and mailbox boundaries", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const caseId = randomUUID(),
      contact = randomUUID(),
      doc = randomUUID(),
      account = randomUUID();
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,'review@example.invalid','Persona ficticia','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id,historical_approved_at) values($1,$2,'Caso de prueba',$3,now())",
      [caseId, contact, users.seller],
    );
    await db.query(
      "insert into documents(id,opportunity_id,name,kind,period,status,storage_path,content_hash) values($1,$2,'Fuente ficticia','application','2026-10','approved','fixture/application.pdf','fixture-hash')",
      [doc, caseId],
    );
    const snapshot = [
      {
        id: doc,
        kind: "application",
        period: "2026-10",
        content_hash: "fixture-hash",
      },
    ];
    const report = {
      summary: "Conclusión del informe ficticio",
      strategy: "Recomendación del informe ficticio",
      missing_information: [],
      lender_matches: [],
    };
    const runs = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of runs)
      await db.query(
        "insert into underwriting_runs(id,opportunity_id,status,requested_by,request_key,model,prompt,prompt_version,max_output_tokens,document_snapshot,lender_snapshot,report) values($1,$2,'draft',$3,$4,'fictional','fixture',1,1000,$5,'[]',$6)",
        [id, caseId, users.seller, randomUUID(), snapshot, report],
      );
    const decide = (run_id: string, decision: string, reason = "") =>
      db.query("select case_flow_command($1,$2)", [
        caseId,
        {
          operation: "report",
          request_key: randomUUID(),
          run_id,
          decision,
          locale: "es",
          reason,
        },
      ]);
    await asUser(users.seller);
    await decide(runs[0], "approved");
    await decide(runs[1], "approved");
    const approved = await db.query<{
      summary: string;
      structured_report: object;
    }>(
      "select summary,structured_report from analyses where opportunity_id=$1 and is_current",
      [caseId],
    );
    assert.equal(approved.rows.length, 2);
    assert.equal(approved.rows[0].summary, report.summary);
    assert.deepEqual(approved.rows[0].structured_report, report);
    await assert.rejects(() => decide(runs[0], "rejected"), /Reason required/);
    await decide(
      runs[0],
      "rejected",
      "Se corrige la decisión, con revisión del informe",
    );
    assert.equal(
      (
        await db.query(
          "select * from analyses where opportunity_id=$1 and is_current",
          [caseId],
        )
      ).rows.length,
      1,
    );
    await decide(runs[2], "rejected");
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from underwriting_runs where id=$1",
          [runs[2]],
        )
      ).rows[0].status,
      "rejected",
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select * from audit_log where entity_id=$1 and action='approval_corrected'",
          [runs[0]],
        )
      ).rows.length,
      1,
    );
    await db.query(
      "update documents set content_hash='changed-fixture' where id=$1",
      [doc],
    );
    await asUser(users.seller);
    await assert.rejects(
      () => decide(runs[1], "approved"),
      /Documents changed|draft required/,
    );
    await db.exec("reset role");
    await db.query(
      "update opportunities set closer_id=$1,handed_off_at=now() where id=$2",
      [users.closer, caseId],
    );
    await asUser(users.seller);
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select can_manage_case_flow($1) allowed",
          [caseId],
        )
      ).rows[0].allowed,
      false,
    );
    await asUser(users.closer);
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select can_manage_case_flow($1) allowed",
          [caseId],
        )
      ).rows[0].allowed,
      true,
    );
    assert.equal(
      (
        await db.query<{ allowed: boolean }>("select can_send($1) allowed", [
          account,
        ])
      ).rows[0].allowed,
      false,
    );
    await db.exec("reset role");
    await db.query("update profiles set active=false where id=$1", [
      users.closer,
    ]);
    await asUser(users.closer);
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select can_manage_case_flow($1) allowed",
          [caseId],
        )
      ).rows[0].allowed,
      false,
    );
    for (const role of ["seller_admin", "closer_admin", "superadmin"]) {
      await db.exec("reset role");
      await db.query("update profiles set role=$1 where id=$2", [
        role,
        users.admin,
      ]);
      await asUser(users.admin);
      assert.equal(
        (
          await db.query<{ allowed: boolean }>(
            "select can_manage_case_flow($1) allowed",
            [caseId],
          )
        ).rows[0].allowed,
        true,
      );
    }
    await db.exec("reset role;set role anon");
    await assert.rejects(
      () => decide(runs[0], "approved"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
