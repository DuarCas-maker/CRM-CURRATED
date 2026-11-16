import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const lit = (x: unknown) => "'" + String(x).replaceAll("'", "''") + "'";
const json = (x: unknown) => lit(JSON.stringify(x)) + "::jsonb";
test(
  "native PG15 serializes two physical claimants, isolates mailboxes and restores old DDL",
  {
    skip: process.env.MANUAL_MAIL_PG15 !== "1",
    timeout: 120000,
  },
  async () => {
    const runtime = process.env.MANUAL_MAIL_PGROOT;
    assert(runtime);
    assert.equal(process.versions.node.split(".")[0], "22");
    const bin = join(runtime, "pgsql/bin"),
      run = join(runtime, "runs", randomUUID()),
      cluster = join(run, "cluster");
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PATH: bin + ";" + process.env.SystemRoot + "\\System32",
      PGCLIENTENCODING: "UTF8",
    };
    const exec = (name: string, args: string[], input?: string) =>
      execFileSync(join(bin, name + ".exe"), args, {
        input,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: name === "pg_ctl" ? "ignore" : ["pipe", "pipe", "pipe"],
      });
    const { mkdirSync } = await import("node:fs");
    mkdirSync(run, { recursive: true });
    const port = 56000 + Math.floor(Math.random() * 3000);
    const args = [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      "postgres",
    ];
    const sql = (text: string) => exec("psql", args, text).trim();
    let started = false;
    try {
      exec("initdb", [
        "-D",
        cluster,
        "-U",
        "postgres",
        "-A",
        "trust",
        "--no-locale",
        "-E",
        "UTF8",
      ]);
      exec("pg_ctl", [
        "-D",
        cluster,
        "-l",
        join(run, "postgres.log"),
        "-o",
        "-h 127.0.0.1 -p " + port,
        "-w",
        "start",
      ]);
      started = true;
      const bootstrap = [
        "create role anon;create role authenticated;create role service_role bypassrls;",
        "create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);",
        "create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;",
        "create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;",
        "create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
        "create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;",
        "grant usage on schema public,auth,storage to authenticated,anon,service_role;grant select on storage.objects to authenticated;",
      ].join("\n");
      sql(
        bootstrap +
          readdirSync("supabase/migrations")
            .filter((f) => f.endsWith(".sql"))
            .sort()
            .map((f) => readFileSync(join("supabase/migrations", f), "utf8"))
            .join("\n"),
      );
      const integration = "docs/specs/pipeline-os/s02/integration/";
      sql(
        "set pipeline_os.block_a_local='in_memory_test';set pipeline_os.block_b1_local='in_memory_test';set pipeline_os.block_b2_local='in_memory_test';" +
          [
            "migrations/a-brand-foundation.local.sql",
            "migrations/a-mail-permissions.local.sql",
            "block-b/migrations/b-brand-management.local.sql",
            "block-b/migrations/b-brand-delivery.local.sql",
          ]
            .map((f) => readFileSync(integration + f, "utf8"))
            .join("\n"),
      );
      const admin = randomUUID(),
        seller = randomUUID(),
        contact = randomUUID(),
        caseId = randomUUID(),
        caseB = randomUUID(),
        contactB = randomUUID(),
        a = randomUUID(),
        b = randomUUID();
      sql(
        "insert into auth.users values(" +
          lit(admin) +
          ",'admin@latency.test'),(" +
          lit(seller) +
          ",'seller@latency.test');" +
          "insert into profiles(id,name,email,role) values(" +
          lit(admin) +
          ",'Admin','admin@latency.test','superadmin'),(" +
          lit(seller) +
          ",'Seller','seller@latency.test','seller');" +
          "insert into contacts(id,name,email,verification) values(" +
          lit(contact) +
          ",'Fixture','client@latency.test','valid');" +
          "insert into contacts(id,name,email,verification) values(" +
          lit(contactB) +
          ",'Fixture B','client-b@latency.test','valid');" +
          "insert into opportunities(id,contact_id,company,seller_id) values(" +
          lit(caseId) +
          "," +
          lit(contact) +
          ",'Fixture'," +
          lit(seller) +
          "),(" +
          lit(caseB) +
          "," +
          lit(contactB) +
          ",'Fixture B'," +
          lit(seller) +
          ");" +
          "insert into mail_accounts(id,email,organization) values(" +
          lit(a) +
          ",'one@latency.test','fixture'),(" +
          lit(b) +
          ",'two@latency.test','fixture');",
      );
      const asUser = (id: string, q: string) =>
        sql(
          "set request.jwt.claims=" +
            lit(JSON.stringify({ sub: id, aal: "aal2" })) +
            ";set role authenticated;" +
            q,
        );
      const command = (kind: string, p: unknown) =>
        JSON.parse(
          asUser(
            admin,
            "select crm_command(" +
              lit(kind) +
              "," +
              json(p) +
              "," +
              lit(randomUUID()) +
              ");",
          ),
        );
      const bind = (account: string) => {
        const brand = command("brand_create", {
          code: "B_" + randomUUID().slice(0, 8),
          name: "Fixture",
          active: true,
        }).id;
        const review = command("brand_mapping_propose", {
          account_id: account,
          proposed_brand_id: brand,
          expected_account_revision: 0,
          evidence_reference: "fixture",
        }).id;
        command("brand_mapping_confirm", {
          review_id: review,
          expected_review_revision: 1,
          expected_account_revision: 0,
          acknowledge_conflict: true,
        });
        command("brand_membership_set", {
          brand_id: brand,
          user_id: seller,
          active: true,
          expected_revision: 0,
        });
        sql(
          "insert into mail_permissions(account_id,user_id,can_send) values(" +
            lit(account) +
            "," +
            lit(seller) +
            ",true);",
        );
        return { brand_id: brand, brand_revision: 1, account_revision: 1 };
      };
      const prepA = bind(a),
        prepB = bind(b);
      const queue = (account: string, prep: unknown) =>
        asUser(
          seller,
          "select brand_queue_mail('queue_mail_email'," +
            json({
              case_id: account === a ? caseId : caseB,
              account,
              recipient:
                account === a ? "client@latency.test" : "client-b@latency.test",
              subject_text: "Fixture",
              body_text: "Fixture",
              files: [],
              gmail_files: [],
              uploads: [],
              copies: [],
              hidden_copies: [],
              process: null,
              conversation: null,
              reply_message: null,
              submission: null,
              signature: "",
              display_name: "",
              request: randomUUID(),
            }) +
            "," +
            json(prep) +
            ") #>> '{}';",
        );
      queue(a, prepA);
      queue(a, prepA);
      queue(b, prepB);
      const oldHash = sql(
        "select md5(prosrc) from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure;",
      );
      const dir = "docs/specs/pipeline-os/manual-mail-latency/migrations/";
      sql(readFileSync(dir + "manual-mail-latency.sql", "utf8"));
      const app = "manual-holder-" + randomUUID();
      const held = spawn(join(bin, "psql.exe"), args, {
        env: { ...env, PGAPPNAME: app },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "",
        error = "";
      held.stdout.on("data", (x) => {
        output += x;
      });
      held.stderr.on("data", (x) => {
        error += x;
      });
      const finished = new Promise<number | null>((res, rej) => {
        held.once("error", rej);
        held.once("exit", res);
      });
      held.stdin.end(
        "begin;set role service_role;select id from claim_manual_outbox(" +
          lit(a) +
          ");select pg_sleep(3);commit;",
      );
      const deadline = Date.now() + 10000;
      while (
        sql(
          "select count(*) from pg_stat_activity where application_name=" +
            lit(app) +
            " and wait_event='PgSleep';",
        ) !== "1"
      ) {
        assert(Date.now() < deadline, "holder never reached its barrier");
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(
        sql(
          "set statement_timeout='800ms';set role service_role;select count(*) from claim_manual_outbox(" +
            lit(a) +
            ");",
        ),
        "0",
      );
      assert.equal(
        sql(
          "set statement_timeout='800ms';set role service_role;select count(*) from claim_manual_outbox(" +
            lit(b) +
            ");",
        ),
        "1",
      );
      assert.equal(await finished, 0, error);
      assert.match(output, /[a-f0-9-]{36}/);
      assert.equal(
        sql(
          "set role service_role;select count(*) from claim_manual_outbox(" +
            lit(a) +
            ");",
        ),
        "0",
      );
      assert.equal(
        sql(
          "select count(*) from outbox where account_id=" +
            lit(a) +
            " and status='sending';",
        ),
        "1",
      );
      const count = sql("select count(*) from outbox;");
      sql(readFileSync(dir + "manual-mail-latency.rollback.sql", "utf8"));
      assert.equal(
        sql(
          "select md5(prosrc) from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure;",
        ),
        oldHash,
      );
      assert.equal(sql("select count(*) from outbox;"), count);
      sql(readFileSync(dir + "manual-mail-latency.sql", "utf8"));
    } finally {
      if (started) exec("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "stop"]);
    }
  },
);
