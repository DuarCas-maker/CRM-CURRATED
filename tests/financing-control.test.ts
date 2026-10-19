import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";
import {
  stageDuration,
  demoFinancingControl,
  type FinancingControlData,
} from "../src/lib/financing-control";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoWorkspace } from "../src/lib/demo";

test("financing control aggregates independent units, evidence, permissions, filters and audited time", async (t) => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const caseId = randomUUID(),
      contact = randomUUID(),
      p1 = randomUUID(),
      p2 = randomUUID(),
      account = randomUUID();
    await db.query(
      "insert into contacts(id,email,verification) values($1,'control@fictional.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id,closer_id,handed_off_at,stage,amount,application_complete,application_signed) values($1,$2,'Control fixture',$3,$4,now(),'lenders',100000,true,true)",
      [caseId, contact, users.seller, users.closer],
    );
    for (const [id, seq] of [
      [p1, 1],
      [p2, 2],
    ])
      await db.query(
        "insert into financing_processes(id,opportunity_id,sequence_number,started_at,classification,label,state) values($1,$2,$3,now(),'active','Fixture process','prepared')",
        [id, caseId, seq],
      );
    const get = async (
      filter = "all",
      offset = 0,
      state: string | null = null,
      stalled: number | null = null,
      since: string | null = null,
    ) =>
      (
        await db.query<{ result: FinancingControlData }>(
          "select financing_control_dashboard('Control',null,null,null,$5,$1,$2,$3,$4) result",
          [filter, offset, state, stalled, since],
        )
      ).rows[0].result;
    await t.test(
      "two processes share one opportunity amount and one documentary denominator",
      async () => {
        await asUser(users.closer);
        const d = await get();
        assert.equal(d.summary.active_opportunities, 1);
        assert.equal(d.summary.total_opportunities, 1);
        assert.equal(d.summary.active_processes, 2);
        assert.equal(d.summary.total_processes, 2);
        assert.equal(d.summary.pipeline_amount, 100000);
        assert.equal(d.summary.required_documents, 5);
        assert.equal(d.rows.length, 2);
        assert.equal(d.rows[0].missing_count, 5);
        assert.equal(d.summary.complete_cases, 0);
        assert.equal(d.rows[0].risk_status, "blocked");
        assert.equal(d.stages.prepared, 2);
        assert.equal(d.total, 2);
      },
    );
    await t.test(
      "received and approved differ; duplicate statements do not satisfy requirements",
      async () => {
        await db.exec("reset role");
        for (let i = 0; i < 5; i++)
          await db.query(
            "insert into documents(opportunity_id,name,kind,status,storage_path,content_hash,required,reviewed_by,reviewed_at) values($1,$2,$3,'received',$4,$5,$6,null,null)",
            [
              caseId,
              "File " + i,
              i === 0 ? "application" : "bank_statement",
              "fixture/file" + i,
              i === 4 ? "hash3" : "hash" + i,
              i === 0,
            ],
          );
        await asUser(users.closer);
        let d = await get();
        assert.equal(d.rows[0].received_count, 4);
        assert.equal(d.rows[0].approved_count, 0);
        assert.equal(d.rows[0].review_count, 5);
        assert.equal(
          d.summary.application_counts.received,
          1,
          "A stale signed flag cannot certify a replacement file",
        );
        assert.equal(d.summary.complete_cases, 0);
        await db.exec("reset role");
        await db.query(
          "update documents set status='approved',reviewed_by=$2,reviewed_at=now() where opportunity_id=$1",
          [caseId, users.closer],
        );
        await asUser(users.closer);
        d = await get();
        assert.equal(d.summary.complete_cases, 0);
        assert.equal(d.rows[0].approved_count, 4);
        await db.exec("reset role");
        await db.query(
          "update documents set content_hash='unique4',status='approved',reviewed_by=$2,reviewed_at=now() where opportunity_id=$1 and name='File 4'",
          [caseId, users.closer],
        );
        await asUser(users.closer);
        d = await get();
        assert.equal(d.summary.complete_cases, 1);
        assert.equal(d.summary.approved_documents, 5);
        assert.equal(d.rows[0].risk_status, "not_started");
      },
    );
    await t.test(
      "draft at 100 percent is not human approval and changed sources invalidate it",
      async () => {
        await db.exec("reset role");
        const run = randomUUID();
        await db.query(
          "insert into underwriting_runs(id,opportunity_id,requested_by,request_key,status,model,prompt,prompt_version,max_output_tokens,document_snapshot,lender_snapshot,report) values($1,$2,$3,gen_random_uuid(),'draft','fixture','fixture',1,8000,'[]','[]','{}')",
          [run, caseId, users.closer],
        );
        await asUser(users.closer);
        let d = await get();
        assert.equal(d.summary.risk_counts.draft, 1);
        assert.equal(d.rows[0].risk_status, "draft");
        await db.exec("reset role");
        await db.query(
          "update documents set status='correction' where opportunity_id=$1 and kind='application'",
          [caseId],
        );
        await asUser(users.closer);
        d = await get();
        assert.equal(d.summary.risk_counts.outdated, 1);
        assert.equal(d.summary.complete_cases, 0);
      },
    );
    let s1 = "",
      s2 = "";
    await t.test(
      "queued and uncertain mail never counts; two lenders never duplicate the pipeline",
      async () => {
        await db.exec("reset role");
        await db.query(
          "insert into mail_accounts(id,email,organization,status,daily_limit,timezone) values($1,'control@team.test','Fixture','connected',100,'UTC')",
          [account],
        );
        const lenders = (
          await db.query<{ id: string }>("select id from lenders limit 2")
        ).rows;
        for (const [i, l] of lenders.entries()) {
          const sid = randomUUID(),
            cid = randomUUID(),
            out = randomUUID();
          if (!i) s1 = sid;
          else s2 = sid;
          await db.query(
            "insert into submissions(id,opportunity_id,process_id,lender_id,closer_id,status,channel,next_action,next_action_at) values($1,$2,$3,$4,$5,'submitted','email','Follow up',now()+interval '1 day')",
            [sid, caseId, p1, l.id, users.closer],
          );
          await db.query(
            "insert into conversations(id,opportunity_id,process_id,submission_id,account_id,gmail_thread_id,subject,area) values($1,$2,$3,$4,$5,$6,'Fixture','closer')",
            [cid, caseId, p1, sid, account, cid],
          );
          await db.query(
            "insert into outbox(id,account_id,opportunity_id,process_id,submission_id,conversation_id,to_email,subject,body,area,message_id_header,request_key,status) values($1,$2,$3,$4,$5,$6,'lender@fixture.test','Fixture','Fixture','closer',$7,$7,$8)",
            [
              out,
              account,
              caseId,
              p1,
              sid,
              cid,
              out,
              i ? "uncertain" : "queued",
            ],
          );
        }
        await asUser(users.closer);
        let d = await get();
        assert.equal(d.summary.confirmed_submissions, 0);
        assert.equal(d.summary.confirmed_processes, 0);
        await db.exec("reset role");
        const outs = (
          await db.query<{ id: string; conversation_id: string }>(
            "select id,conversation_id from outbox where opportunity_id=$1",
            [caseId],
          )
        ).rows;
        for (const o of outs) {
          await db.query(
            "update outbox set status='sent',sent_at=now()-interval '2 hours',gmail_message_id=$2 where id=$1",
            [o.id, o.id],
          );
          await db.query(
            "insert into messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1,$2,'outbound','control@team.test','Fixture',now()-interval '2 hours','sent')",
            [o.conversation_id, o.id],
          );
        }
        // A second confirmed email to the same submission is still one submission.
        await db.query(
          "insert into outbox(account_id,opportunity_id,submission_id,to_email,subject,body,area,message_id_header,request_key,status,sent_at,gmail_message_id) select account_id,opportunity_id,submission_id,to_email,subject,body,area,gen_random_uuid()::text,gen_random_uuid()::text,status,sent_at,gmail_message_id from outbox where id=$1",
          [outs[0].id],
        );
        await db.query(
          "insert into messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1,'reply','inbound','lender@fixture.test','Fixture reply',now()-interval '1 hour','received')",
          [outs[0].conversation_id],
        );
        await asUser(users.closer);
        d = await get();
        assert.equal(d.summary.confirmed_submissions, 2);
        assert.equal(d.summary.confirmed_processes, 1);
        assert.equal(d.summary.responded_submissions, 1);
        assert.equal(d.summary.pipeline_amount, 100000);
        assert.equal(d.summary.application_sent_cases, 0);
        assert.equal(d.summary.lender_counts?.length, 2);
        assert.equal((await get("lender")).total, 1);
        assert.equal((await get("lender")).summary.pipeline_amount, 100000);
      },
    );
    await t.test(
      "application sent needs a frozen version and offers take priority only before expiry",
      async () => {
        await db.exec("reset role");
        const out = (
          await db.query<{ id: string; sent_at: string }>(
            "select id,sent_at from outbox where submission_id=$1 limit 1",
            [s1],
          )
        ).rows[0];
        const doc = (
          await db.query<{ id: string }>(
            "select id from documents where opportunity_id=$1 and kind='application' limit 1",
            [caseId],
          )
        ).rows[0];
        await db.query(
          "insert into submission_documents(outbox_id,document_id,submission_id,storage_path,content_hash,sent_at) values($1,$2,$3,'frozen/approved.pdf','approved-version',$4)",
          [out.id, doc.id, s1, out.sent_at],
        );
        await db.query(
          "insert into offers(submission_id,opportunity_id,product,amount,expires_at) values($1,$2,'Fixture',10000,now()+interval '12 hours'),($1,$2,'Fixture',11000,now()-interval '1 hour')",
          [s1, caseId],
        );
        await asUser(users.closer);
        const d = await get();
        assert.equal(d.summary.application_sent_cases, 1);
        assert.equal(d.summary.active_offers, 1);
        assert.equal(d.summary.expiring_offers, 1);
        assert.equal(d.rows[0].priority, "offers");
        assert.equal(d.rows[0].expired_offers, 1);
      },
    );
    await t.test(
      "process clocks use real state transitions, never case updates or repeated states",
      async () => {
        await db.exec("reset role");
        await db.query(
          "update process_state_history set entered_at=now()-interval '8 days' where process_id=$1",
          [p1],
        );
        await db.query(
          "delete from process_state_history where process_id=$1",
          [p2],
        );
        await db.query(
          "update opportunities set updated_at=now() where id=$1",
          [caseId],
        );
        await db.query(
          "update financing_processes set state='prepared',label='Same stage' where id=$1",
          [p1],
        );
        await asUser(users.closer);
        let d = await get();
        assert(d.rows.find((r) => r.process_id === p1)?.stage_entered_at);
        assert.equal(
          d.rows.find((r) => r.process_id === p2)?.stage_entered_at,
          null,
        );
        assert.equal((await get("all", 0, null, 7)).total, 1);
        await db.exec("reset role");
        await db.query(
          "update financing_processes set state='lender_evaluation' where id=$1",
          [p1],
        );
        await asUser(users.closer);
        d = await get("all", 0, "lender_evaluation");
        assert.equal(d.total, 1);
        assert.equal((await get("all", 0, null, 7)).total, 0);
      },
    );
    await t.test(
      "seller, outsider and MFA do not expose closer facts or private cases",
      async () => {
        await asUser(users.seller, "aal1");
        await assert.rejects(get(), /MFA/);
        await asUser(users.outsider);
        assert.equal((await get()).total, 0);
        await asUser(users.seller);
        const d = await get();
        assert.equal(d.summary.funded_amount, null);
        assert.equal(d.summary.confirmed_submissions, null);
        assert.equal(d.summary.lender_counts, null);
        assert(d.rows.every((r) => r.lenders.length === 0));
        assert.equal(
          d.rows.find((r) => r.process_id === p1)?.process_state,
          "restricted",
        );
        assert.equal((await get("all", 0, "lender_evaluation")).total, 0);
      },
    );
    await t.test(
      "funding period uses event date, not case creation, and avoids historical duplication",
      async () => {
        await db.exec("reset role");
        const lender = (
          await db.query<{ id: string }>("select id from lenders limit 1")
        ).rows[0].id;
        await db.query(
          "update opportunities set created_at=now()-interval '200 days',funded_at=now()-interval '1 day',funded_amount=90000,funded_lender_id=$2 where id=$1",
          [caseId, lender],
        );
        await db.query(
          "update financing_processes set actual_funded_amount=90000,funded_lender_id=$2 where id=$1",
          [p2, lender],
        );
        await asUser(users.closer);
        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const d = await get("all", 0, null, null, since);
        assert.equal(d.summary.active_opportunities, 0);
        assert.equal(d.summary.funded_amount, 90000);
        assert.equal(d.summary.funded_count, 1);
        assert.equal(d.summary.historical_funding_records, 1);
      },
    );
    await t.test(
      "large aggregates and filtered totals precede pagination; no read mutates state",
      async () => {
        await db.exec("reset role");
        await db.query(
          "with c as(insert into contacts(email,verification) select 'control-'||i||'@fictional.test','valid' from generate_series(1,65) i returning id) insert into opportunities(contact_id,company,seller_id,closer_id,handed_off_at,stage,amount) select id,'Control page',$1,$2,now(),'lenders',1000 from c",
          [users.seller, users.closer],
        );
        const before = (
          await db.query(
            "select (select count(*) from jobs) jobs,(select count(*) from outbox) outbox,(select count(*) from process_state_history) history",
          )
        ).rows[0];
        await asUser(users.closer);
        const a = await get(),
          b = await get("all", 50);
        assert.equal(a.rows.length, 50);
        assert.equal(a.total, 67);
        assert.equal(b.rows.length, 17);
        assert.equal(a.summary.pipeline_amount, 165000);
        assert.equal(b.summary.pipeline_amount, 165000);
        // History and outbox are protected for authenticated readers; compare as database owner.
        await db.exec("reset role");
        const actual = (
          await db.query(
            "select (select count(*) from jobs) jobs,(select count(*) from outbox) outbox,(select count(*) from process_state_history) history",
          )
        ).rows[0];
        assert.deepEqual(actual, before);
        await db.query(
          "with c as(insert into contacts(email,verification) select 'control-bulk-'||i||'@fictional.test','valid' from generate_series(1,1000) i returning id) insert into opportunities(contact_id,company,seller_id,closer_id,handed_off_at,stage,amount) select id,'Control bulk',$1,$2,now(),'lenders',1000 from c",
          [users.seller, users.closer],
        );
        await asUser(users.closer);
        const large = await get("all", 1000);
        assert.equal(large.total, 1067);
        assert.equal(large.rows.length, 50);
        assert.equal(large.summary.pipeline_amount, 1165000);
        await asUser(users.admin);
        assert.equal((await get()).summary.pipeline_amount, 1165000);
      },
    );
    await t.test(
      "rollback preserves v1 and reapplying installs v2 without rewriting process history",
      async () => {
        await db.exec("reset role");
        await db.exec(
          await readFile(
            "supabase/rollbacks/042_financing_control_dashboard.sql",
            "utf8",
          ),
        );
        await asUser(users.closer);
        await db.query("select operational_dashboard()");
        await db.exec("reset role");
        await db.exec(
          await readFile(
            "supabase/migrations/042_financing_control_dashboard.sql",
            "utf8",
          ),
        );
        const n = (
          await db.query<{ n: number }>(
            "select count(*)::int n from process_state_history",
          )
        ).rows[0].n;
        assert.equal(n, 0);
      },
    );
  } finally {
    await db.close();
  }
});
test("stage duration never uses missing or future timestamps", () => {
  assert.equal(
    stageDuration(null, "2026-10-19T12:00:00Z", "es"),
    "Sin fecha verificable",
  );
  assert.equal(
    stageDuration("2026-10-20T12:00:00Z", "2026-10-19T12:00:00Z", "en"),
    "No verified date",
  );
  assert.equal(
    stageDuration("2026-10-18T09:00:00Z", "2026-10-19T12:00:00Z", "es"),
    "1 d · 3 h",
  );
});
test("KPI reference totals and chart explanations are visible and keyboard operable in both languages", async () => {
  const cssHook = registerHooks({
    load(url, context, nextLoad) {
      return url.endsWith(".css")
        ? { format: "module", source: "", shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  const { FinancingControlDashboard } =
    await import("../src/components/financing-control-dashboard");
  cssHook.deregister();
  const workspace = demoWorkspace(),
    data = demoFinancingControl(workspace, workspace.opportunities, "all", 0);
  for (const locale of ["es", "en"] as const) {
    const html = renderToStaticMarkup(
      createElement(FinancingControlDashboard, {
        data,
        locale,
        filter: "all",
        setFilter: () => {},
        page: 0,
        setPage: () => {},
        processState: "",
        setProcessState: () => {},
        stalled: "",
        setStalled: () => {},
        open: () => {},
        period: "all",
      }),
    );
    assert.equal((html.match(/class="control-kpi-total"/g) || []).length, 6);
    assert((html.match(/<summary aria-label=/g) || []).length >= 8);
    assert(
      html.includes(
        locale === "es" ? "Sin fecha verificable" : "No verified date",
      ),
    );
    assert(
      html.includes(
        locale === "es"
          ? "no mide conversión histórica"
          : "does not measure historical conversion",
      ),
    );
    assert(html.includes(locale === "es" ? "No disponible" : "Not available"));
    assert.equal((html.match(/<article class="control-kpi/g) || []).length, 6);
  }
});
