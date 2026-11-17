import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";

test(
  "AC003/004: SQL 056 applies, catalog lot atomic/idempotent, personal selection RLS, template CAS/versions/roles and lossless rollback",
  { timeout: 120000 },
  async () => {
    const { db, users, asUser } = await featureDatabase();
    try {
      const contact = randomUUID(),
        caseId = randomUUID(),
        account = randomUUID(),
        process = randomUUID();
      await db.query(
        "insert into contacts(id,email,name,verification) values($1,'fixture@example.test','Fixture','valid')",
        [contact],
      );
      await db.query(
        "insert into opportunities(id,contact_id,company,seller_id,historical_approved_at) values($1,$2,'Fictional LLC',$3,now())",
        [caseId, contact, users.seller],
      );
      await db.query(
        "insert into mail_accounts(id,email,organization,owner_id,status,send_retry_at) values($1,'sender@example.test','Fictional',$2,'connected',now()+interval '2 hours')",
        [account, users.seller],
      );
      await db.query(
        "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true)",
        [account, users.seller],
      );
      await db.query(
        "insert into financing_processes(id,opportunity_id,sequence_number,classification,started_at,label) values($1,$2,1,'active',now(),'Fictional operation')",
        [process, caseId],
      );
      const files: string[] = [];
      for (let i = 0; i < 5; i++) {
        const id = randomUUID();
        files.push(id);
        await db.query(
          "insert into documents(id,opportunity_id,name,kind,period,status,storage_path,content_hash) values($1,$2,'Fictional document',$3,$4,'approved',$5,$6)",
          [
            id,
            caseId,
            i ? "bank_statement" : "application",
            `2026-0${i + 1}`,
            `fixture/${i}`,
            `fixture-${i}`,
          ],
        );
      }
      const targets: {
        lender_id: string;
        email: string;
        cc_emails: string[];
        subject_text: string;
        body_text: string;
        body_html: string;
      }[] = [];
      for (let i = 0; i < 73; i++) {
        const id = randomUUID(),
          email = `lender${i}@example.test`,
          copy = `copy${i}@example.test`;
        await db.query(
          "insert into lenders(id,name,email,channel) values($1,$2,$3,'email')",
          [id, "Fictional lender " + i, email],
        );
        await db.query(
          "insert into lender_contacts(email,lender_id) values($1,$2)",
          [copy, id],
        );
        targets.push({
          lender_id: id,
          email,
          cc_emails: [copy],
          subject_text: "Fictional " + i,
          body_text: "Body " + i,
          body_html: "<strong>Body " + i + "</strong>",
        });
      }
      const input = {
        case_id: caseId,
        account,
        process,
        request: randomUUID(),
        recipient: targets[0].email,
        subject_text: "Source",
        body_text: "Source",
        files,
        gmail_files: [],
        uploads: [],
        copies: [],
        hidden_copies: [],
        signature: "",
        display_name: "Fictional",
        targets,
      };
      const queue = async (p = input) =>
        (
          await db.query<{ result: { id: string }[] }>(
            "select queue_mail_lenders($1) result",
            [p],
          )
        ).rows[0].result;
      await asUser(users.outsider);
      await assert.rejects(() => queue(), /access|Choose/i);
      await asUser(users.seller);
      const invalid = targets.map((t) => ({ ...t }));
      invalid[72].email = "missing@example.test";
      await assert.rejects(
        () => queue({ ...input, targets: invalid }),
        /Confirm the lender contact/,
      );
      await db.exec("reset role");
      assert.equal((await db.query("select * from outbox")).rows.length, 0);
      assert.equal(
        (await db.query("select * from submissions")).rows.length,
        0,
      );
      await asUser(users.seller);
      const result = await queue();
      assert.equal(result.length, 73);
      assert.deepEqual(await queue(), result);
      await assert.rejects(
        () => queue({ ...input, targets: targets.slice(0, 72) }),
        /Request key reused/,
      );
      await db.query(
        "insert into mail_recipient_selections(user_id,name,targets) values($1,'Catalog',$2)",
        [
          users.seller,
          targets.map(({ lender_id, email, cc_emails }) => ({
            lender_id,
            email,
            cc_emails,
          })),
        ],
      );
      await asUser(users.outsider);
      assert.equal(
        (await db.query("select * from mail_recipient_selections")).rows.length,
        0,
      );
      await db.exec("reset role");
      const outbox = (
        await db.query<{
          to_email: string;
          cc_emails: string[];
          subject: string;
          body_html: string;
          waiting: boolean;
        }>(
          "select *,available_at>now()+interval '119 minutes' waiting from outbox",
        )
      ).rows;
      assert.equal(outbox.length, 73);
      targets.forEach((t) => {
        const m = outbox.find((o) => o.to_email === t.email)!;
        assert.deepEqual(m.cc_emails, t.cc_emails);
        assert.equal(m.subject, t.subject_text);
        assert.equal(m.body_html, t.body_html);
        assert.equal(m.waiting, true);
      });
      const template = {
        id: randomUUID(),
        expected_version: 0,
        name: "Fictional template",
        subject: "{{company}}",
        body: "Hello {{lender_name}}",
        body_format: "plain",
        archived: false,
      };
      const save = async (p = template, key = randomUUID()) =>
        (
          await db.query<{ result: { version: number } }>(
            "select save_lender_email_template($1,$2) result",
            [p, key],
          )
        ).rows[0].result;
      await asUser(users.seller);
      await assert.rejects(() => save(), /Administrator required/);
      await asUser(users.admin, "aal1");
      await assert.rejects(() => save(), /Administrator required/);
      await asUser(users.admin);
      const key = randomUUID();
      assert.equal((await save(template, key)).version, 1);
      assert.equal((await save(template, key)).version, 1);
      assert.equal(
        (await save({ ...template, expected_version: 1, name: "Updated" }))
          .version,
        2,
      );
      await assert.rejects(
        () => save({ ...template, expected_version: 1 }),
        /Template changed/,
      );
      await assert.rejects(
        () => save({ ...template, id: randomUUID(), body: "{{unknown}}" }),
        /Unknown merge field/,
      );
      await asUser(users.seller);
      assert.equal(
        (await db.query("select * from lender_email_templates")).rows.length,
        1,
      );
      assert.equal(
        (await db.query("select * from lender_email_template_versions")).rows
          .length,
        2,
      );
      await assert.rejects(
        () => db.query("update lender_email_templates set name='Bypass'"),
        /permission denied/,
      );
      await db.exec("reset role; set role anon");
      await assert.rejects(
        () => db.query("select * from lender_email_templates"),
        /permission denied/,
      );
      await db.exec("reset role");
      await db.exec(
        await readFile(
          "docs/specs/lender-composer-20261116/rollback.sql",
          "utf8",
        ),
      );
      assert.equal(
        (await db.query("select * from lender_email_template_versions")).rows
          .length,
        2,
      );
      assert.match(
        (
          await db.query<{ definition: string }>(
            "select pg_get_functiondef('public.queue_mail_lenders(jsonb)'::regprocedure) definition",
          )
        ).rows[0].definition,
        /not between 1 and 20/,
      );
      assert.equal((await db.query("select * from outbox")).rows.length, 73);
    } finally {
      await db.close();
    }
  },
);
