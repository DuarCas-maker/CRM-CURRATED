import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  realpathSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createServer } from "node:net";

const root = realpathSync(process.cwd());
const doc = "docs/specs/pipeline-os/s02/connect-gmail";
const runtime = resolve(root, ".local/f2-connect-t002");
const pgBin = join(runtime, "toolchains/postgresql-15.19/pgsql/bin");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const lit = (value: unknown): string =>
  value === null
    ? "null"
    : typeof value === "number"
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;
const json = (value: unknown) => lit(JSON.stringify(value)) + "::jsonb";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test(
  "T-002 native PG15: authorization, inactive onboarding, C1 preservation and real concurrency",
  {
    timeout: 180_000,
    // Native local integration is explicitly opted in; ordinary pnpm test must not start a server.
    skip: process.env.PIPELINE_OS_CONNECT_T002_NATIVE !== "1",
  },
  async (t) => {
    assert.equal(
      process.versions.node.split(".")[0],
      "22",
      "Run with the approved local Node22",
    );
    assert.ok(
      existsSync(join(pgBin, "postgres.exe")),
      "Provision the authorized local PostgreSQL toolchain first",
    );
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const database = "f2_connect_" + suffix;
    const runRoot = join(runtime, "runs", suffix);
    const delta = relative(runtime, runRoot);
    assert.ok(!isAbsolute(delta) && !delta.startsWith(".."));
    mkdirSync(runRoot, { recursive: true });
    const cluster = join(runRoot, "cluster");
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PATH: pgBin + ";" + process.env.SystemRoot + "\\System32",
      PGAPPNAME: "f2-connect-t002",
      PGCLIENTENCODING: "UTF8",
    };
    const bin = (name: string, args: string[], input?: string) =>
      execFileSync(join(pgBin, name + ".exe"), args, {
        env,
        input,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
        // Windows descendants can inherit pipe handles after pg_ctl exits.
        // Its daemon writes to the explicit local logfile; do not wait on inherited pipes.
        stdio: name === "pg_ctl" ? "ignore" : ["pipe", "pipe", "pipe"],
      });
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((r, reject) =>
      server.close((e) => (e ? reject(e) : r())),
    );
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
      "f2_connect_owner",
      "-d",
      database,
    ];
    const sql = (text: string, db = database) => {
      const actual = [...args];
      actual[actual.length - 1] = db;
      try {
        return bin(
          "psql",
          actual,
          "set client_min_messages='warning';set statement_timeout='15s';set lock_timeout='5s';\n" +
            text,
        ).trim();
      } catch (error) {
        const e = error as { stderr?: string | Buffer };
        throw new Error(String(e.stderr ?? error));
      }
    };
    const parse = (text: string) => {
      const last = sql(text).split(/\r?\n/).filter(Boolean).at(-1)!;
      return last === "t" ? true : last === "f" ? false : JSON.parse(last);
    };
    const users = {
      admin: randomUUID(),
      other: randomUUID(),
      seller: randomUUID(),
    };
    const sessions = {
      admin: randomUUID(),
      other: randomUUID(),
      seller: randomUUID(),
      second: randomUUID(),
    };
    const claims = (
      user: string = users.admin,
      sid: string = sessions.admin,
      aal = "aal2",
    ) => ({
      sub: user,
      session_id: sid,
      aal,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const authPrefix = (
      user: string = users.admin,
      sid: string = sessions.admin,
      aal = "aal2",
    ) =>
      `begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify(claims(user, sid, aal)))};`;
    const human = (
      call: string,
      user: string = users.admin,
      sid: string = sessions.admin,
      aal = "aal2",
    ) =>
      JSON.parse(
        sql(`${authPrefix(user, sid, aal)}select ${call};commit;`)
          .split(/\r?\n/)
          .at(-1)!,
      );
    const service = (call: string) =>
      JSON.parse(
        sql(`begin;set local role service_role;select ${call};commit;`)
          .split(/\r?\n/)
          .at(-1)!,
      );
    const configuration = {
      generation: 1,
      project_id: "pr_connect_fixture",
      auth_config_id: "ac_connect_fixture",
      quota_project_id: "google-connect-fixture",
      policy_reviewed: true,
      max_age_seconds: 3600,
      inactivity_seconds: 1800,
    };
    const publish = (p = configuration) =>
      sql(
        `begin;set local role service_role;select public.composio_connect_publish(${json(p)});commit;`,
      );
    const brand = randomUUID();
    const oldAccount = randomUUID();
    const marker = "set pipeline_os.connect_t002_local='isolated_test';";
    const install = readFileSync(
      join(root, doc, "migrations/connect-t002.local.sql"),
      "utf8",
    );
    const rollback = readFileSync(
      join(root, doc, "migrations/connect-t002.rollback.sql"),
      "utf8",
    );
    const catalog = () =>
      sql(`select json_agg(x order by n,signature)::text from (
    select n.nspname n,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','auth','brand_b1','brand_b2','composio_c1','s01_i02')
    and p.proname not like 'composio_connect_%' and p.prokind='f') x;`);
    const operational = () =>
      sql(`select json_build_object('credentials',(select json_agg(x order by account_id) from public.mail_credentials x),
   'permissions',(select json_agg(x order by account_id,user_id) from public.mail_permissions x),
   'jobs',(select count(*) from public.jobs),'outbox',(select count(*) from public.outbox),'campaigns',(select count(*) from public.campaigns),
   'old_account',(select row_to_json(x) from public.mail_accounts x where id=${lit(oldAccount)}))::text;`);
    let started = false;
    let preservedCatalog = "";
    let preservedOperational = "";
    const results: string[] = [];
    let attemptedChecks = 0;
    const check = async (name: string, fn: () => void | Promise<void>) => {
      attemptedChecks++;
      await t.test(name, async () => {
        await fn();
        results.push(name);
      });
    };
    function begin(
      email = `${randomUUID()}@example.test`,
      overrides: Record<string, unknown> = {},
      key = randomUUID(),
    ) {
      const proof = randomUUID(),
        capability = randomUUID();
      const p = {
        mode: "new",
        email,
        organization: "fixture",
        brand_id: brand,
        expected_brand_revision: 1,
        expected_account_revision: 0,
        expected_head_revision: 0,
        expected_config_generation: 1,
        state_hash: sha(randomUUID()),
        browser_hash: sha(proof),
        capability_hash: sha(capability),
        ...overrides,
      };
      const result = human(
        `public.composio_connect_begin(${json(p)},${lit(key)})`,
      );
      return { result, p, key, proof, capability };
    }
    type Attempt = ReturnType<typeof begin>;
    const privateAttempt = (a: Attempt) =>
      parse(
        `select row_to_json(x) from composio_connect.attempts x where id=${lit(a.result.id)};`,
      );
    const observe = (
      a: Attempt,
      extra: Record<string, unknown> = {},
      cap: string = a.capability,
    ) => {
      const stored = privateAttempt(a);
      const facts = {
        project_id: stored.project_id,
        auth_config_id: stored.auth_config_id,
        owner_id: stored.owner_id,
        connection_id: "ca_" + randomUUID().replaceAll("-", ""),
        primary_email: a.p.email,
        active: true,
        toolkit: "gmail",
        ...extra,
      };
      a.result = service(
        `public.composio_connect_observe(${lit(a.result.id)},${a.result.revision},${lit(cap)},${json(facts)})`,
      );
      return facts;
    };
    const command = (
      a: Attempt,
      kind: string,
      review: string | null = null,
      key = randomUUID(),
      revision = a.result.revision,
      proof: string = a.proof,
    ) => {
      const call = `public.composio_connect_command(${lit(a.result.id)},${lit(kind)},${revision},${lit(proof)},${lit(key)},${lit(review)})`;
      const result = human(call);
      a.result = result;
      return { result, call, key };
    };
    const materialize = (a: Attempt) => command(a, "materialize");
    const confirmBrand = (a: Attempt) => {
      const r = parse(
        `select row_to_json(x) from public.mail_account_brand_reviews x where id=${lit(a.result.review_id)};`,
      );
      human(
        `public.crm_command('brand_mapping_confirm',${json({ review_id: r.id, expected_review_revision: r.revision, expected_account_revision: r.expected_account_revision, acknowledge_conflict: false })},${lit(randomUUID())})`,
      );
      command(a, "adopt_brand", r.id);
    };
    try {
      bin("initdb", [
        "-D",
        cluster,
        "-U",
        "f2_connect_owner",
        "--auth-local=trust",
        "--auth-host=trust",
        "--encoding=UTF8",
        "--locale=C",
      ]);
      bin("pg_ctl", [
        "-D",
        cluster,
        "-l",
        join(runRoot, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -c unix_socket_directories=`,
        "-w",
        "start",
      ]);
      started = true;
      sql(`create database ${database};`, "postgres");
      const version = parse(
        "select current_setting('server_version_num')::integer;",
      );
      assert.ok(version >= 150000 && version < 160000);
      sql(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_admin superuser;
      create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),refreshed_at timestamptz default now(),not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon,service_role;grant select on storage.objects to authenticated;`);
      const migrations = readdirSync(join(root, "supabase/migrations"))
        .filter((n) => /^\d{3}_.*\.sql$/.test(n))
        .sort();
      assert.equal(migrations.length, 47);
      sql(
        migrations
          .map((n) =>
            readFileSync(join(root, "supabase/migrations", n), "utf8"),
          )
          .join("\n"),
      );
      const accepted = readFileSync(
        join(
          root,
          "docs/specs/pipeline-os/s02/release/abc-final/049_integrate_mail_identity_brands_and_bindings.sql",
        ),
        "utf8",
      );
      const start = accepted.indexOf(
        "-- Source docs/specs/pipeline-os/s02/integration/migrations/a-brand-foundation.local.sql",
      );
      const end = accepted.indexOf("do $af_check$");
      assert.ok(start > 0 && end > start);
      // Materialize accepted DDL+ACL as a fresh fixture. Never run049 preflight/postflight/application protocol.
      sql(
        "begin;set local search_path=pg_catalog,public,pg_temp;\n" +
          accepted.slice(start, end) +
          "\ncommit;",
      );
      for (const [name, id] of Object.entries(users)) {
        sql(`insert into auth.users values(${lit(id)},${lit(name + "@example.test")});
        insert into public.profiles(id,name,email,role) values(${lit(id)},${lit(name)},${lit(name + "@example.test")},${lit(name === "seller" ? "seller" : "superadmin")});
        insert into auth.sessions(id,user_id) values(${lit(sessions[name as keyof typeof users])},${lit(id)});`);
      }
      sql(`insert into auth.sessions(id,user_id) values(${lit(sessions.second)},${lit(users.admin)});
      insert into public.operating_brands(id,code,name,active,created_by,updated_by) values(${lit(brand)},'CONNECT_QA','Connect fixture',true,${lit(users.admin)},${lit(users.admin)});
      insert into public.mail_accounts(id,email,organization) values(${lit(oldAccount)},'existing@example.test','fixture');
      insert into public.mail_credentials(account_id,encrypted_refresh_token) values(${lit(oldAccount)},'fixture-not-a-provider-token');
      insert into public.mail_permissions(account_id,user_id,can_send) values(${lit(oldAccount)},${lit(users.admin)},true);`);
      const oldReview = human(
        `public.crm_command('brand_mapping_propose',${json({ account_id: oldAccount, proposed_brand_id: brand, expected_account_revision: 0, evidence_reference: "fixture-old-review" })},${lit(randomUUID())})`,
      );
      human(
        `public.crm_command('brand_mapping_confirm',${json({ review_id: oldReview.id, expected_review_revision: oldReview.revision, expected_account_revision: oldReview.account_revision, acknowledge_conflict: false })},${lit(randomUUID())})`,
      );
      preservedCatalog = catalog();
      preservedOperational = operational();
      await check("local marker required before any DDL", () => {
        assert.throws(() => sql(install), /CONNECT_T002_LOCAL_ONLY/);
        assert.equal(
          parse("select to_regnamespace('composio_connect') is null;"),
          true,
        );
      });
      sql(marker + install);
      publish();
      await check(
        "RLS and deny direct SELECT/DML including service_role; private helpers are not public",
        () => {
          assert.equal(
            parse(
              "select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='composio_connect' and c.relrowsecurity;",
            ),
            3,
          );
          for (const role of ["anon", "authenticated", "service_role"]) {
            for (const table of ["configuration", "subjects", "attempts"]) {
              for (const operation of [
                `select * from composio_connect.${table}`,
                `delete from composio_connect.${table}`,
                `insert into composio_connect.${table} default values`,
                `update composio_connect.${table} set id=id`,
              ]) {
                assert.throws(
                  () => sql(`set role ${role};${operation};`),
                  /permission denied/,
                );
              }
            }
            assert.throws(
              () => sql(`set role ${role};select composio_connect.human();`),
              /permission denied/,
            );
          }
          assert.throws(
            () =>
              sql(
                "set role anon;select public.composio_connect_publish('{}');",
              ),
            /permission denied/,
          );
          assert.throws(
            () =>
              sql(
                "set role service_role;select public.composio_connect_begin('{}',gen_random_uuid());",
              ),
            /permission denied/,
          );
        },
      );
      await check(
        "superadmin AAL2 and live session required; no-session/seller/AAL1 rejected",
        () => {
          const valid = begin();
          for (const [u, s, a] of [
            [users.seller, sessions.seller, "aal2"],
            [users.admin, sessions.admin, "aal1"],
            [users.admin, randomUUID(), "aal2"],
          ]) {
            assert.throws(
              () =>
                human(
                  `public.composio_connect_begin(${json(valid.p)},${lit(randomUUID())})`,
                  u,
                  s,
                  a,
                ),
              /CONNECT_FORBIDDEN/,
            );
          }
          command(valid, "cancel");
        },
      );
      await check(
        "durable subject, idempotent begin and payload conflict without duplicate audits",
        () => {
          const a = begin();
          const again = human(
            `public.composio_connect_begin(${json(a.p)},${lit(a.key)})`,
          );
          assert.equal(again.id, a.result.id);
          assert.throws(
            () =>
              human(
                `public.composio_connect_begin(${json({ ...a.p, email: "different@example.test" })},${lit(a.key)})`,
              ),
            /CONNECT_IDEMPOTENCY_CONFLICT/,
          );
          const original = privateAttempt(a);
          command(a, "cancel");
          const b = begin(a.p.email);
          assert.equal(
            b.result.reserved_account_id,
            a.result.reserved_account_id,
          );
          assert.equal(privateAttempt(b).owner_id, original.owner_id);
          assert.notEqual(b.result.id, a.result.id);
          command(b, "cancel");
        },
      );
      await check(
        "provider observation restricted to service capability and exact identity",
        () => {
          const a = begin();
          assert.throws(() => observe(a, {}, "wrong"), /CONNECT_FORBIDDEN/);
          for (const extra of [
            { primary_email: "wrong@example.test" },
            { auth_config_id: "ac_other" },
            { owner_id: "wrong" },
            { active: false },
            { toolkit: "github" },
            { connection_id: "ca_bad", unexpected: true },
          ]) {
            assert.throws(() => observe(a, extra), /CONNECT_IDENTITY_MISMATCH/);
          }
          observe(a);
          assert.equal(a.result.state, "identity_ready");
          command(a, "cancel");
        },
      );
      await check(
        "new account stays inactive, creates no token/permissions/jobs and preserves C1 ready",
        () => {
          const a = begin();
          observe(a);
          materialize(a);
          const row = parse(
            `select row_to_json(x) from public.mail_accounts x where id=${lit(a.result.account_id)};`,
          );
          assert.equal(row.status, "disconnected");
          assert.equal(row.live_enabled, false);
          assert.equal(row.sync_enabled, false);
          assert.equal(a.result.state, "awaiting_brand");
          assert.throws(() => command(a, "register"), /CONNECT_NOT_READY/);
          confirmBrand(a);
          assert.equal(a.result.state, "ready_to_register");
          assert.equal(a.result.account_revision, 1);
          const call = command(a, "register");
          assert.equal(a.result.state, "completed");
          const page = human(
            `public.composio_binding_page(${lit(a.result.account_id)},null,25)`,
          );
          assert.equal(page.account.ready, false);
          assert.equal(page.current.status, "candidate");
          assert.equal(page.can_confirm, false);
          assert.equal(page.composio_enabled, false);
          const fakeConfirmation = {
            expected_head_revision: page.head_revision,
            expected_account_revision: page.account.account_revision,
            expected_brand_revision: page.account.brand_revision,
            expected_context_hash: page.account.context_hash,
            binding_id: page.current.id,
            check_id: randomUUID(),
          };
          assert.throws(
            () =>
              human(
                `public.composio_binding_command(${lit(a.result.account_id)},'confirm_binding',${json(fakeConfirmation)},${lit(randomUUID())})`,
              ),
            /C_BINDING_EVIDENCE_REQUIRED/,
          );
          const again = human(call.call);
          assert.equal(again.binding_id, a.result.binding_id);
          assert.equal(operational(), preservedOperational);
          assert.equal(catalog(), preservedCatalog);
        },
      );
      await check(
        "same session/browser required, including replay after completion",
        () => {
          const a = begin();
          observe(a);
          materialize(a);
          confirmBrand(a);
          const registered = command(a, "register");
          assert.throws(
            () => human(registered.call, users.other, sessions.other),
            /CONNECT_FORBIDDEN/,
          );
          assert.throws(
            () => human(registered.call, users.admin, sessions.second),
            /CONNECT_FORBIDDEN/,
          );
          assert.throws(
            () =>
              command(
                a,
                "register",
                null,
                randomUUID(),
                a.result.revision,
                "bad-browser",
              ),
            /CONNECT_FORBIDDEN/,
          );
        },
      );
      await check(
        "revoked session and expired/inactive policies reject otherwise valid JWT",
        () => {
          const a = begin();
          sql(
            `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${lit(sessions.admin)};`,
          );
          assert.throws(() => command(a, "cancel"), /CONNECT_FORBIDDEN/);
          sql(
            `update auth.sessions set not_after=null,refreshed_at=clock_timestamp()-interval '2 hours' where id=${lit(sessions.admin)};`,
          );
          assert.throws(() => command(a, "cancel"), /CONNECT_FORBIDDEN/);
          sql(
            `update auth.sessions set refreshed_at=clock_timestamp() where id=${lit(sessions.admin)};delete from auth.sessions where id=${lit(sessions.admin)};`,
          );
          assert.throws(() => command(a, "cancel"), /CONNECT_FORBIDDEN/);
          sql(
            `insert into auth.sessions(id,user_id) values(${lit(sessions.admin)},${lit(users.admin)});`,
          );
          command(a, "cancel");
        },
      );
      await check(
        "cancel and deadline win before delayed observation or registration",
        () => {
          const cancelled = begin();
          command(cancelled, "cancel");
          assert.throws(() => observe(cancelled), /CONNECT_CLOSED/);
          const late = service(
            `public.composio_connect_uncertain(${lit(cancelled.result.id)},0,${lit(cancelled.capability)})`,
          );
          assert.equal(late.state, "cancelled");
          assert.equal(late.cleanup_required, true);
          assert.equal(
            parse(
              `select count(*)::int from public.mail_accounts where email=${lit(cancelled.p.email)};`,
            ),
            0,
          );
          const expired = begin();
          observe(expired);
          sql(
            `update composio_connect.attempts set deadline=created_at-interval '1 second' where id=${lit(expired.result.id)};`,
          );
          assert.throws(() => materialize(expired), /CONNECT_CLOSED/);
          const replacement = begin(expired.p.email);
          assert.equal(
            replacement.result.reserved_account_id,
            expired.result.reserved_account_id,
          );
          command(replacement, "cancel");
        },
      );
      await check(
        "brand mutation after explicit adoption rejects stale registration",
        () => {
          const a = begin();
          observe(a);
          materialize(a);
          confirmBrand(a);
          sql(
            `update public.operating_brands set name='Changed fixture',revision=revision+1 where id=${lit(brand)};`,
          );
          assert.throws(() => command(a, "register"), /CONNECT_STALE/);
          sql(
            `update public.operating_brands set revision=revision-1 where id=${lit(brand)};`,
          );
          command(a, "cancel");
        },
      );
      await check(
        "actual two PostgreSQL connections contend on same subject; only one attempt commits",
        async () => {
          const template = begin();
          command(template, "cancel");
          const p = {
            ...template.p,
            email: "race-" + suffix + "@example.test",
            state_hash: sha(randomUUID()),
          };
          const firstKey = randomUUID(),
            secondKey = randomUUID();
          const holder = spawn(join(pgBin, "psql.exe"), args, {
            env,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
          });
          let output = "",
            errors = "";
          holder.stdout.on("data", (d) => {
            output += String(d);
          });
          holder.stderr.on("data", (d) => {
            errors += String(d);
          });
          const exited = new Promise<number | null>((r) =>
            holder.on("exit", r),
          );
          holder.stdin.write(
            `${authPrefix()}select public.composio_connect_begin(${json(p)},${lit(firstKey)});\n\\echo CONNECT_HELD\n`,
          );
          try {
            for (let i = 0; i < 100 && !output.includes("CONNECT_HELD"); i++) {
              if (holder.exitCode !== null) throw new Error(errors);
              await delay(25);
            }
            assert.match(output, /CONNECT_HELD/);
            const racer = spawn(join(pgBin, "psql.exe"), args, {
              env: { ...env, PGAPPNAME: "connect_racer" },
              windowsHide: true,
              stdio: ["pipe", "pipe", "pipe"],
            });
            let raceError = "";
            racer.stderr.on("data", (d) => {
              raceError += String(d);
            });
            const raceExited = new Promise<number | null>((r) =>
              racer.on("exit", r),
            );
            racer.stdin.end(
              `${authPrefix()}select public.composio_connect_begin(${json({ ...p, state_hash: sha(randomUUID()) })},${lit(secondKey)});commit;`,
            );
            let waiting = false;
            for (let i = 0; i < 30 && !waiting; i++) {
              await delay(30);
              waiting = parse(
                "select exists(select 1 from pg_stat_activity where application_name='connect_racer' and wait_event_type='Lock');",
              );
            }
            assert.equal(
              waiting,
              true,
              "Second real backend must wait on a lock",
            );
            holder.stdin.end("commit;\n");
            assert.equal(await exited, 0, errors);
            assert.notEqual(await raceExited, 0);
            assert.match(raceError, /CONNECT_CONFLICT/);
            assert.equal(
              parse(
                `select count(*)::int from composio_connect.attempts a join composio_connect.subjects s on s.id=a.subject_id where s.email=${lit(p.email)};`,
              ),
              1,
            );
          } finally {
            if (holder.exitCode === null) holder.stdin.end("rollback;\n");
            await exited;
          }
        },
      );
      await check(
        "existing account reconnects in place, keeps owner/history and supersedes only after valid registration",
        () => {
          const params = {
            mode: "reconnect",
            email: undefined,
            organization: undefined,
            account_id: oldAccount,
            expected_account_revision: 1,
          };
          const a = begin("unused@example.test", params);
          observe(a, { primary_email: "existing@example.test" });
          materialize(a);
          assert.equal(a.result.state, "ready_to_register");
          command(a, "register");
          assert.equal(a.result.account_id, oldAccount);
          const firstBinding = a.result.binding_id;
          const firstOwner = privateAttempt(a).owner_id;
          const b = begin("unused@example.test", {
            ...params,
            expected_head_revision: 1,
          });
          assert.equal(privateAttempt(b).owner_id, firstOwner);
          assert.throws(
            () => observe(b, { primary_email: "wrong@example.test" }),
            /CONNECT_IDENTITY_MISMATCH/,
          );
          assert.equal(
            sql(
              `select current_binding_id::text from public.mail_provider_binding_heads where account_id=${lit(oldAccount)};`,
            ),
            firstBinding,
          );
          observe(b, { primary_email: "existing@example.test" });
          materialize(b);
          command(b, "register");
          assert.notEqual(b.result.binding_id, firstBinding);
          assert.equal(
            sql(
              `select status from public.mail_provider_bindings where id=${lit(firstBinding)};`,
            ),
            "superseded",
          );
          assert.equal(operational(), preservedOperational);
        },
      );
      await check(
        "occupied connection rejects the whole register transaction without replacing the first binding",
        () => {
          const source = begin();
          observe(source);
          materialize(source);
          confirmBrand(source);
          command(source, "register");
          const connection = privateAttempt(source).connection_id;
          const other = begin();
          observe(other, { connection_id: connection });
          materialize(other);
          confirmBrand(other);
          assert.throws(() => command(other, "register"), /CONNECT_CONFLICT/);
          assert.equal(privateAttempt(other).result_binding_id, null);
          assert.equal(
            sql(
              `select status from public.mail_provider_bindings where id=${lit(source.result.binding_id)};`,
            ),
            "candidate",
          );
          assert.equal(
            parse(
              `select count(*)::int from public.mail_provider_binding_heads where account_id=${lit(other.result.account_id)};`,
            ),
            0,
          );
          command(other, "cancel");
        },
      );
      await check(
        "ambiguous creation remains uncertain and blocks a fresh attempt after deadline",
        () => {
          const a = begin();
          const call = `public.composio_connect_uncertain(${lit(a.result.id)},0,${lit(a.capability)})`;
          assert.throws(() => human(call), /permission denied/);
          a.result = service(call);
          assert.equal(a.result.state, "uncertain");
          assert.equal(a.result.cleanup_required, true);
          assert.equal(service(call).revision, a.result.revision);
          sql(
            `update composio_connect.attempts set deadline=created_at-interval '1 second' where id=${lit(a.result.id)};`,
          );
          assert.throws(() => begin(a.p.email), /CONNECT_CONFLICT/);
          assert.throws(() => materialize(a), /CONNECT_CLOSED/);
          assert.equal(
            parse(
              `select count(*)::int from public.mail_accounts where email=${lit(a.p.email)};`,
            ),
            0,
          );
        },
      );
      await check(
        "inactive or changed actor cannot reuse an old authorization or service capability",
        () => {
          const a = begin();
          sql(
            `update public.profiles set active=false where id=${lit(users.admin)};`,
          );
          assert.throws(
            () =>
              human(
                `public.composio_connect_begin(${json(a.p)},${lit(a.key)})`,
              ),
            /CONNECT_FORBIDDEN/,
          );
          sql(
            `update public.profiles set active=true where id=${lit(users.admin)};`,
          );
          assert.throws(() => observe(a), /CONNECT_STALE/);
        },
      );
      await check(
        "configuration rotation invalidates pending state without touching prior candidates",
        () => {
          const a = begin();
          observe(a);
          publish({ ...configuration, generation: 2 });
          assert.throws(() => materialize(a), /CONNECT_STALE/);
        },
      );
      await check(
        "catalog and operational state preserved; additive reversal is isolated",
        () => {
          assert.equal(catalog(), preservedCatalog);
          assert.equal(operational(), preservedOperational);
          sql(marker + rollback);
          assert.equal(
            parse("select to_regnamespace('composio_connect') is null;"),
            true,
          );
          assert.equal(catalog(), preservedCatalog);
          assert.equal(operational(), preservedOperational);
        },
      );
      assert.equal(
        results.length,
        attemptedChecks,
        "Do not publish a successful report after a failed subtest",
      );
      writeFileSync(
        join(runRoot, "result.json"),
        JSON.stringify(
          {
            date: "2026-11-08",
            engine: "PostgreSQL15.19",
            runId: suffix,
            checks: results,
            passed: results.length,
            catalogPreserved: catalog() === preservedCatalog,
            operationalPreserved: operational() === preservedOperational,
            providerRequests: 0,
          },
          null,
          2,
        ) + "\n",
      );
      t.diagnostic(
        `Own disposable cluster ${suffix}, PostgreSQL15.19, ${results.length} checks; provider requests0`,
      );
    } finally {
      if (started || existsSync(join(cluster, "postmaster.pid")))
        bin("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "stop"]);
    }
  },
);
