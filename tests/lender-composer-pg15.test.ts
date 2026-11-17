import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { guardLenderMigration } from "../scripts/lender-composer-release-plan.mjs";

const lit = (v: unknown) => `'${String(v).replaceAll("'", "''")}'`;
test(
  "AC004/007 native PG15: accepted 049 + 055 + 056 install, template concurrent CAS, grants and lossless rollback",
  { skip: !process.env.LENDER_COMPOSER_PGROOT, timeout: 120000 },
  async () => {
    const binDir = join(
      resolve(process.env.LENDER_COMPOSER_PGROOT!),
      "pgsql/bin",
    );
    const root = join(tmpdir(), "lender-composer-pg15", randomUUID());
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
      PGAPPNAME: "lender-composer-local-qa",
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
      "lender_qa",
      "-d",
      "postgres",
    ];
    const sql = (s: string) => {
      try {
        return bin(
          "psql",
          args,
          "set client_min_messages=warning;set statement_timeout='15s';set lock_timeout='5s';" +
            s,
        ).trim();
      } catch (e) {
        throw Error(String((e as { stderr?: string }).stderr || e));
      }
    };
    const value = (s: string) => {
      const result = sql(s).split(/\r?\n/).filter(Boolean).at(-1)!;
      return result === "t"
        ? true
        : result === "f"
          ? false
          : JSON.parse(result);
    };
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
        p.stdin.end(s);
      });
    let started = false;
    try {
      bin("initdb", [
        "-D",
        cluster,
        "-U",
        "lender_qa",
        "--auth-local=trust",
        "--auth-host=trust",
        "--encoding=UTF8",
        "--locale=C",
      ]);
      bin("pg_ctl", [
        "-D",
        cluster,
        "-l",
        join(root, "server.log"),
        "-o",
        `-h 127.0.0.1 -p ${port}`,
        "-w",
        "start",
      ]);
      started = true;
      assert.ok(
        value("select current_setting('server_version_num')::int") >= 150000,
      );
      sql(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_admin superuser;
      create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon,service_role;grant select on storage.objects to authenticated;`);
      sql(
        "set role supabase_admin;" +
          readdirSync("supabase/migrations")
            .filter((n) => /^\d{3}_.*\.sql$/.test(n) && n < "055")
            .sort()
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
      const before = value(
        "select to_jsonb(pg_get_functiondef('public.queue_mail_lenders(jsonb)'::regprocedure));",
      );
      const preflightFunctions = value(
        "set search_path=pg_catalog,public,pg_temp;select jsonb_agg(jsonb_build_object('name',p.proname,'hash',md5(pg_get_functiondef(p.oid)))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('queue_mail_lenders','queue_lender_emails');",
      );
      sql(
        "alter default privileges for role supabase_admin in schema public grant all on tables to anon,authenticated,service_role;",
      );
      const guarded = guardLenderMigration(
        readFileSync("supabase/migrations/056_lender_composer.sql", "utf8"),
        { functions: preflightFunctions },
      );
      assert.match(guarded, /do \$\$begin/);
      sql("set role supabase_admin;" + guarded);
      assert.equal(
        value(
          "select has_table_privilege('authenticated','public.lender_email_templates','update')",
        ),
        true,
        "Exercise the actual Supabase default grant behavior",
      );
      sql(
        "set role supabase_admin;" +
          readFileSync(
            "supabase/migrations/057_lender_template_grants.sql",
            "utf8",
          ),
      );
      assert.equal(
        value(
          "select has_table_privilege('anon','public.lender_email_templates','select')",
        ),
        false,
      );
      const after = value(
        "select to_jsonb(pg_get_functiondef('public.queue_mail_lenders(jsonb)'::regprocedure));",
      );
      assert.match(after, /s01_i02.assert_sources/);
      assert.match(after, /can_area/);
      assert.match(after, /target->>'body_html'/);
      assert.doesNotMatch(after, /not between 1 and 20/);
      assert.equal(
        value(
          "select has_function_privilege('anon','public.save_lender_email_template(jsonb,uuid)','execute')",
        ),
        false,
      );
      assert.equal(
        value(
          "select has_table_privilege('authenticated','public.lender_email_templates','update')",
        ),
        false,
      );
      const admin = randomUUID(),
        other = randomUUID(),
        id = randomUUID();
      sql(
        `insert into auth.users values(${lit(admin)},'admin@example.test'),(${lit(other)},'other@example.test');insert into profiles(id,name,email,role) values(${lit(admin)},'QA admin','admin@example.test','superadmin'),(${lit(other)},'QA admin 2','other@example.test','seller_admin');`,
      );
      const auth = (actor = admin) =>
        `begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify({ sub: actor, aal: "aal2" }))};`;
      const p = {
        id,
        expected_version: 0,
        name: "Fictional",
        subject: "{{company}}",
        body: "Hello {{lender_name}}",
        body_format: "plain",
        archived: false,
      };
      const call = (version: number, key = randomUUID()) =>
        `select public.save_lender_email_template(${lit(JSON.stringify({ ...p, expected_version: version }))}::jsonb,${lit(key)}::uuid);`;
      sql(auth() + call(0) + "commit;");
      const first = concurrent(auth() + call(1) + "select pg_sleep(1);commit;");
      const second = concurrent(auth(other) + call(1) + "commit;");
      const results = await Promise.allSettled([first, second]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        results.filter(
          (r) =>
            r.status === "rejected" &&
            /Template changed/.test(String(r.reason)),
        ).length,
        1,
      );
      assert.equal(
        value(`select version from lender_email_templates where id=${lit(id)}`),
        2,
      );
      const releaseSmoke = value(
        readFileSync(
          "docs/specs/lender-composer-20261116/publication/fixture-smoke.sql",
          "utf8",
        ),
      );
      assert.equal(releaseSmoke.template_crud, true);
      assert.equal(releaseSmoke.selection_73, true);
      assert.equal(releaseSmoke.inactive_read_blocked, true);
      assert.equal(releaseSmoke.aal1_blocked, true);
      assert.equal(releaseSmoke.mail_queued, false);
      sql(
        "set role supabase_admin;" +
          readFileSync(
            "docs/specs/lender-composer-20261116/rollback.sql",
            "utf8",
          ),
      );
      assert.equal(
        value(
          "select to_jsonb(pg_get_functiondef('public.queue_mail_lenders(jsonb)'::regprocedure));",
        ),
        before,
      );
      assert.equal(
        value("select count(*)::int from lender_email_template_versions"),
        2,
      );
      assert.equal(value("select count(*)::int from outbox"), 0);
    } finally {
      if (started) bin("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "stop"]);
    }
  },
);
