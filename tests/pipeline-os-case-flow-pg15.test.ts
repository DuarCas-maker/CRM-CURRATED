import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

const lit = (v: unknown) =>
  v === null ? "null" : `'${String(v).replaceAll("'", "''")}'`;
test(
  "FLOW native PG15: separate-session CAS, idempotency, RLS, install and lossless rollback",
  { skip: !process.env.CASE_FLOW_PGROOT, timeout: 120000 },
  async () => {
    const binDir = join(resolve(process.env.CASE_FLOW_PGROOT!), "pgsql/bin");
    const root = resolve(
      "C:/Users/Usuario/Downloads/Curated-Case-Flow-QA-20261116/native",
      randomUUID(),
    );
    mkdirSync(root, { recursive: true });
    const cluster = join(root, "cluster");
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PATH: binDir + ";" + process.env.SystemRoot + "\\System32",
      PGCLIENTENCODING: "UTF8",
      PGAPPNAME: "case-flow-055-local-qa",
    };
    const bin = (name: string, args: string[], input?: string) =>
      execFileSync(join(binDir, name + ".exe"), args, {
        input,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 12 * 1024 * 1024,
        stdio: name === "pg_ctl" ? "ignore" : ["pipe", "pipe", "pipe"],
      });
    const listener = createServer();
    await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((r) => listener.close(() => r()));
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
      "case_flow_qa",
      "-d",
      "postgres",
    ];
    const prefix =
      "set client_min_messages=warning;set statement_timeout='10s';set lock_timeout='5s';\n";
    const sql = (s: string) => {
      try {
        return bin("psql", args, prefix + s).trim();
      } catch (e) {
        throw Error(String((e as { stderr?: string }).stderr ?? e));
      }
    };
    const value = (s: string) =>
      JSON.parse(sql(s).split(/\r?\n/).filter(Boolean).at(-1)!);
    const concurrent = (s: string) =>
      new Promise<string>((resolve, reject) => {
        const p = spawn(join(binDir, "psql.exe"), args, {
          env,
          windowsHide: true,
          stdio: "pipe",
        });
        let out = "",
          err = "";
        p.stdout.on("data", (c) => (out += c));
        p.stderr.on("data", (c) => (err += c));
        p.on("error", reject);
        p.on("close", (code) =>
          code === 0 ? resolve(out) : reject(Error(err)),
        );
        p.stdin.end(prefix + s);
      });
    const seller = randomUUID(),
      outsider = randomUUID(),
      contact = randomUUID(),
      caseId = randomUUID(),
      doc = randomUUID(),
      lenders = [randomUUID(), randomUUID()];
    const auth = (id = seller) =>
      `begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify({ sub: id, aal: "aal2" }))};`;
    const input = (
      lender: string,
      state = "offer",
      process_id: string | null = null,
      expected_event_id: string | null = null,
    ) => ({
      operation: "lender",
      request_key: randomUUID(),
      process_id,
      expected_event_id,
      lender_id: lender,
      conversation_id: null,
      state,
      offered_amount: 50000,
      agreed_amount: null,
      reason: "Respaldo ficticio",
      archive_message_id: null,
      document_id: doc,
    });
    const call = (p: object) =>
      `case_flow_command(${lit(caseId)},${lit(JSON.stringify(p))}::jsonb)`;
    const human = (p: object) =>
      value(`${auth()}select ${call(p)};commit;`) as {
        process_id: string;
        event_id: string;
      };
    let started = false;
    try {
      bin("initdb", [
        "-D",
        cluster,
        "-U",
        "case_flow_qa",
        "--auth-local=trust",
        "--auth-host=trust",
        "--encoding=UTF8",
        "--locale=C",
      ]);
      bin("pg_ctl", [
        "-D",
        cluster,
        "-l",
        join(root, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -c unix_socket_directories=`,
        "-w",
        "start",
      ]);
      started = true;
      const version = value(
        "select current_setting('server_version_num')::int;",
      );
      assert.ok(version >= 150000 && version < 160000);
      sql(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_admin superuser;
      create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon,service_role;grant select on storage.objects to authenticated;`);
      const files = readdirSync("supabase/migrations")
        .filter((n) => /^\d{3}_.*\.sql$/.test(n) && n < "055")
        .sort();
      sql(
        "set role supabase_admin;" +
          files
            .map((n) => readFileSync(join("supabase/migrations", n), "utf8"))
            .join("\n"),
      );
      const accepted = readFileSync(
        "docs/specs/pipeline-os/s02/release/abc-final/049_integrate_mail_identity_brands_and_bindings.sql",
        "utf8",
      );
      const payload = accepted.slice(
        accepted.indexOf(
          "-- Source docs/specs/pipeline-os/s02/integration/migrations/a-brand-foundation.local.sql",
        ),
        accepted.indexOf("do $af_check$"),
      );
      assert.ok(payload.length > 10000);
      sql(
        "set role supabase_admin;begin;set local search_path=pg_catalog,public,pg_temp;" +
          payload +
          "commit;",
      );
      sql(
        "set role supabase_admin;" +
          readFileSync("supabase/migrations/055_case_flow.sql", "utf8"),
      );
      sql(`insert into auth.users values(${lit(seller)},'owner@example.invalid'),(${lit(outsider)},'other@example.invalid');
      insert into profiles(id,name,email,role) values(${lit(seller)},'QA owner','owner@example.invalid','seller'),(${lit(outsider)},'QA other','other@example.invalid','seller');
      insert into contacts(id,email,name,verification) values(${lit(contact)},'fixture@example.invalid','Fixture','valid');
      insert into opportunities(id,contact_id,company,seller_id,historical_approved_at) values(${lit(caseId)},${lit(contact)},'Caso ficticio',${lit(seller)},now());
      insert into documents(id,opportunity_id,name,kind,storage_path) values(${lit(doc)},${lit(caseId)},'Respaldo','other','fixture/proof.pdf');
      insert into lenders(id,name,email,channel) values(${lit(lenders[0])},'Lender A','a@example.invalid','email'),(${lit(lenders[1])},'Lender B','b@example.invalid','email');`);
      assert.equal(
        value(
          `${auth(outsider)}select count(*) from opportunities where id=${lit(caseId)};commit;`,
        ),
        0,
      );
      assert.equal(
        value(
          `select to_json(s01_i02.actor_can_write(${lit(seller)},${lit(caseId)},'closer',null));`,
        ),
        true,
      );
      assert.equal(
        value(
          `select to_json(s01_i02.actor_can_write(${lit(seller)},${lit(caseId)},'closer',${lit(randomUUID())}));`,
        ),
        false,
      );
      assert.throws(
        () => sql(`${auth(outsider)}select ${call(input(lenders[0]))};commit;`),
        /access denied/,
      );
      const a = human(input(lenders[0]));
      const b = human(input(lenders[1], "offer", a.process_id, a.event_id));
      const choice = input(lenders[0], "selected", a.process_id, b.event_id),
        competing = input(lenders[1], "selected", a.process_id, b.event_id);
      const results = await Promise.allSettled([
        concurrent(
          `${auth()}select ${call(choice)};select pg_sleep(0.25);commit;`,
        ),
        concurrent(`${auth()}select ${call(competing)};commit;`),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      assert.match(rejected.reason.message, /Flow changed/);
      const winner = results[0].status === "fulfilled" ? choice : competing;
      const before = value(
        `select count(*) from case_events where opportunity_id=${lit(caseId)};`,
      );
      human(winner);
      assert.equal(
        value(
          `select count(*) from case_events where opportunity_id=${lit(caseId)};`,
        ),
        before,
      );
      assert.equal(
        value(
          `select count(*) from offers where opportunity_id=${lit(caseId)} and status='selected';`,
        ),
        1,
      );
      assert.equal(
        value(
          `select count(*) from offers where opportunity_id=${lit(caseId)} and status='received';`,
        ),
        1,
      );
      sql(
        "set role supabase_admin;" +
          readFileSync("docs/specs/case-flow-20261116/rollback.sql", "utf8"),
      );
      assert.equal(
        value(
          `select count(*) from case_events where opportunity_id=${lit(caseId)};`,
        ),
        before,
      );
      sql(
        "set role supabase_admin;" +
          readFileSync("supabase/migrations/055_case_flow.sql", "utf8"),
      );
      assert.equal(
        value(
          `${auth()}select to_json(can_manage_case_flow(${lit(caseId)}));commit;`,
        ),
        true,
      );
      console.log(
        JSON.stringify({
          engine: version,
          isolatedLoopback: true,
          contention: "one commit, one conflict",
          rollback: "events retained",
          remoteCalls: 0,
        }),
      );
    } finally {
      if (started) bin("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "stop"]);
    }
  },
);
