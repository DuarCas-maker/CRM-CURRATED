import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { mailQuotaPolicySchema } from "../src/lib/mail-quota-policy";

const doc = "docs/specs/pipeline-os/s02/quota-policy-reuse";
const read = (path: string) => readFileSync(path, "utf8");
const lit = (v: unknown): string =>
  v === null
    ? "null"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;
const json = (v: unknown) => lit(JSON.stringify(v)) + "::jsonb";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test(
  "QGR-I02 native PG15: reserves, compatibility, permissions, rollback and contention",
  {
    timeout: 240_000,
    // Ordinary test runs never start a server. No download, install, remote URL or env-file loader.
    skip: process.env.PIPELINE_OS_QGR_I02_NATIVE !== "1",
  },
  async (t) => {
    assert.equal(process.versions.node.split(".")[0], "22");
    const root = realpathSync(process.cwd());
    const pgBin = realpathSync(
      process.env.PIPELINE_OS_QGR_PG_BIN ?? "missing-authorized-PG15-binaries",
    );
    const runtime = resolve(root, ".local/pipeline-os/qgr-i02");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const runRoot = join(runtime, "runs", suffix),
      cluster = join(runRoot, "cluster");
    mkdirSync(runRoot, { recursive: true });
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PATH: pgBin + ";" + process.env.SystemRoot + "\\System32",
      PGAPPNAME: "qgr-i02-local",
      PGCLIENTENCODING: "UTF8",
    };
    const bin = (name: string, args: string[], input?: string) =>
      execFileSync(join(pgBin, name + ".exe"), args, {
        env,
        input,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: name === "pg_ctl" ? "ignore" : ["pipe", "pipe", "pipe"],
      });
    assert.match(bin("postgres", ["--version"]), /PostgreSQL\) 15\./);
    const listener = createServer();
    await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((r, reject) =>
      listener.close((e) => (e ? reject(e) : r())),
    );
    const template = "qgr_i02_base_" + suffix;
    let db = template,
      started = false,
      sequence = 0;
    const args = (database = db) => [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      "qgr_fixture_owner",
      "-d",
      database,
    ];
    const prefix =
      "set client_min_messages='warning';set statement_timeout='15s';set lock_timeout='5s';\n";
    const sql = (value: string, database = db) => {
      try {
        return bin("psql", args(database), prefix + value).trim();
      } catch (e) {
        throw new Error(
          String((e as { stderr?: string | Buffer }).stderr ?? e),
        );
      }
    };
    const parse = (value: string) => {
      const last = sql(value).split(/\r?\n/).filter(Boolean).at(-1)!;
      return last === "t" ? true : last === "f" ? false : JSON.parse(last);
    };
    const marker = "set pipeline_os.qgr_local='isolated_test';\n";
    const install = read(
      join(root, doc, "migrations/quota-policy-v2.local.sql"),
    );
    const rollback = read(
      join(root, doc, "migrations/quota-policy-v2.rollback.sql"),
    );
    const admin = randomUUID(),
      seller = randomUUID(),
      other = randomUUID();
    const sid = randomUUID(),
      sellerSid = randomUUID(),
      otherSid = randomUUID();
    const accountA = randomUUID(),
      accountB = randomUUID(),
      brand = randomUUID(),
      policyId = randomUUID();
    const claims = (
      user = admin,
      session = sid,
      aal = "aal2",
      exp = Math.floor(Date.now() / 1000) + 3600,
    ) => ({ sub: user, session_id: session, aal, exp });
    const auth = (c = claims()) =>
      `begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify(c))};`;
    const human = (call: string, c = claims()) =>
      JSON.parse(
        sql(auth(c) + `select ${call};commit;`)
          .split(/\r?\n/)
          .at(-1)!,
      );
    const service = (call: string) =>
      JSON.parse(
        sql(`begin;set local role service_role;select ${call};commit;`)
          .split(/\r?\n/)
          .at(-1)!,
      );
    const policy = (
      generation = 1,
      state = "enabled",
      window = 75_000_000,
    ) => ({
      contract_version: 2,
      policy_id: policyId,
      generation,
      mode: "crm_shared_conservative",
      state,
      limits: {
        group_units_per_minute: 900_000,
        account_units_per_minute: 4500,
        group_units_per_window: window,
        window_seconds: 86460,
      },
    });
    const publishCall = (
      p = policy(),
      expected = p.generation - 1,
      quiet = true,
      key = randomUUID(),
    ) =>
      `public.mail_quota_publish(${json(p)},${expected},${quiet},${lit(key)})`;
    const publish = (p = policy()) => human(publishCall(p));
    const deadline = () => new Date(Date.now() + 120_000).toISOString();
    const reserve = (
      options: {
        account?: string;
        provider?: string;
        units?: number;
        generation?: number;
        key?: string;
        deadline?: string;
        project?: string | null;
      } = {},
    ) => {
      const provider = options.provider ?? "composio";
      return `public.mail_quota_reserve(${lit(options.account ?? accountA)},${lit(provider)},${options.units ?? 100},${lit(policyId)},${options.generation ?? 1},${lit(options.key ?? randomUUID())},${lit(options.deadline ?? deadline())},${lit(options.project ?? (provider === "gmail_oauth" ? "fixture-project" : null))})`;
    };
    const usage = () =>
      parse("select coalesce(sum(units),0)::bigint from mail_quota.usage;");
    const snapshot = () =>
      sql(`select jsonb_build_object('usage',(select jsonb_agg(x order by minute) from mail_quota.usage x),
    'slots',(select jsonb_agg(x order by scope) from public.gmail_api_slots x),
    'group',(select to_jsonb(x) from mail_quota.slot x),
    'legacy',(select jsonb_agg(x order by project,minute) from public.gmail_api_usage x),
    'observed',(select jsonb_agg(x order by project,minute) from mail_quota.legacy_observed x),
    'receipts',(select jsonb_agg(x order by request_key) from mail_quota.reservations x))::text;`);
    const catalog = () =>
      sql(`select jsonb_agg(x order by signature)::text from (
    select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f'
    and n.nspname in('public','brand_b1','brand_b2','composio_c1','s01_i02','mail_runtime','composio_connect','worker_pilot','composio_connect_runtime')
    and p.proname not like 'mail_quota_%') x;`);
    const operational = () =>
      sql(`select jsonb_build_object('credentials',(select jsonb_agg(x order by account_id) from public.mail_credentials x),
    'accounts',(select jsonb_agg(x order by id) from public.mail_accounts x),
    'permissions',(select jsonb_agg(x order by account_id,user_id) from public.mail_permissions x),
    'bindings',(select jsonb_agg(to_jsonb(x)-array['quota_contract_version','quota_policy_id','quota_policy_generation'] order by id) from public.mail_provider_bindings x),
    'checks',(select jsonb_agg(x order by id) from public.mail_provider_binding_checks x),
    'jobs',(select count(*) from public.jobs),'outbox',(select count(*) from public.outbox))::text;`);
    const passed: string[] = [];
    const check = async (
      name: string,
      fn: () => void | Promise<void>,
      installed = true,
    ) => {
      await t.test(name, async () => {
        db = "qgr_i02_" + suffix + "_" + ++sequence;
        sql(`create database ${db} template ${template};`, "postgres");
        if (installed) sql(marker + install);
        await fn();
        passed.push(name);
      });
    };
    // Async psql lets real transactions contend; failures are collected, not swallowed.
    const concurrent = (value: string, application: string) => {
      const child = spawn(join(pgBin, "psql.exe"), args(), {
        env: { ...env, PGAPPNAME: application },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "",
        err = "",
        ready = false;
      child.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        ready ||= out.includes("LOCK_HELD");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        err += chunk.toString();
      });
      const done = new Promise<{
        code: number | null;
        out: string;
        err: string;
      }>((r, reject) => {
        child.on("error", reject);
        child.on("close", (code) => r({ code, out, err }));
      });
      child.stdin.end(prefix + value);
      return {
        done,
        held: async () => {
          for (let i = 0; i < 100 && !ready; i++) await sleep(20);
          assert.ok(ready, err || out);
        },
      };
    };
    const blocked = async (application: string) => {
      for (let i = 0; i < 60; i++) {
        if (
          parse(
            `select exists(select 1 from pg_stat_activity where application_name=${lit(application)} and wait_event_type='Lock');`,
          )
        )
          return;
        await sleep(20);
      }
      assert.fail(
        "Second PostgreSQL connection did not observe the expected lock",
      );
    };
    let catalogBefore = "",
      operationalBefore = "";
    try {
      bin("initdb", [
        "-D",
        cluster,
        "-U",
        "qgr_fixture_owner",
        "--auth-local=trust",
        "--auth-host=trust",
        "--encoding=UTF8",
        "--locale=C",
      ]);
      writeFileSync(
        join(cluster, "pg_hba.conf"),
        "host all all 127.0.0.1/32 trust\n",
      );
      bin("pg_ctl", [
        "-D",
        cluster,
        "-l",
        join(runRoot, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -c unix_socket_directories= -c shared_buffers=32MB -c max_connections=20 -c fsync=off`,
        "-w",
        "start",
      ]);
      started = true;
      sql(`create database ${template};`, "postgres");
      const context = parse(
        "select json_build_object('version',current_setting('server_version_num')::int,'host',inet_server_addr()::text,'data',current_setting('data_directory'),'user',current_user);",
      );
      assert.ok(context.version >= 150000 && context.version < 160000);
      assert.equal(context.host, "127.0.0.1/32");
      assert.equal(realpathSync(context.data), realpathSync(cluster));
      assert.equal(context.user, "qgr_fixture_owner");
      sql(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_admin superuser;
      create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),refreshed_at timestamp without time zone default timezone('UTC',now()),not_after timestamptz);
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
          .map((n) => read(join(root, "supabase/migrations", n)))
          .join("\n"),
      );
      for (const [path, startMark, endMark] of [
        [
          "abc-final/049_integrate_mail_identity_brands_and_bindings.sql",
          "\n-- Source docs/specs/pipeline-os/s02/integration/migrations/a-brand-foundation.local.sql",
          "\ndo $af_check$",
        ],
        [
          "mail-runtime-final/050_integrate_mail_runtime_and_connect.sql",
          "\ncreate schema composio_connect;",
          "\ndo $mr_final$",
        ],
      ]) {
        const s = read(join(root, "docs/specs/pipeline-os/s02/release", path));
        const a = s.indexOf(startMark),
          b = s.indexOf(endMark, a);
        assert.ok(a > 0 && b > a);
        // Fresh synthetic fixture only: no execution of049/050 application protocols or remote scripts.
        sql(
          "begin;set local search_path=pg_catalog,public,pg_temp;" +
            s.slice(a, b) +
            "\ncommit;",
        );
      }
      for (const [id, session, name, role] of [
        [admin, sid, "admin", "superadmin"],
        [seller, sellerSid, "seller", "seller"],
        [other, otherSid, "other", "superadmin"],
      ]) {
        sql(
          `insert into auth.users values(${lit(id)},${lit(name + "@example.test")});insert into public.profiles(id,name,email,role) values(${lit(id)},${lit(name)},${lit(name + "@example.test")},${lit(role)});insert into auth.sessions(id,user_id) values(${lit(session)},${lit(id)});`,
        );
      }
      sql(`insert into public.operating_brands(id,code,name,active,created_by,updated_by) values(${lit(brand)},'QGR_QA','Quota fixture',true,${lit(admin)},${lit(admin)});
      insert into public.mail_accounts(id,email,organization) values(${lit(accountA)},'a@example.test','fixture'),(${lit(accountB)},'b@example.test','fixture');
      insert into public.mail_credentials(account_id,encrypted_refresh_token) values(${lit(accountA)},'fixture-not-a-token');
      insert into public.mail_permissions(account_id,user_id,can_send) values(${lit(accountA)},${lit(admin)},true);`);
      const review = human(
        `public.crm_command('brand_mapping_propose',${json({ account_id: accountA, proposed_brand_id: brand, expected_account_revision: 0, evidence_reference: "fixture" })},${lit(randomUUID())})`,
      );
      human(
        `public.crm_command('brand_mapping_confirm',${json({ review_id: review.id, expected_review_revision: review.revision, expected_account_revision: review.account_revision, acknowledge_conflict: false })},${lit(randomUUID())})`,
      );
      // A real v1 command, not a hand-written facsimile. No provider/Google request.
      const page = human(`public.composio_binding_page(${lit(accountA)})`);
      const v1Call = `public.composio_binding_command(${lit(accountA)},'register_candidate',${json(
        {
          composio_project_id: "pr_fixture",
          auth_config_id: "ac_fixture",
          connected_account_id: "ca_fixture",
          composio_user_id: "legacy-owner",
          google_quota_project_id: "google-fixture",
          expected_head_revision: page.head_revision,
          expected_account_revision: page.account.account_revision,
          expected_brand_revision: page.account.brand_revision,
          expected_context_hash: page.account.context_hash,
        },
      )},${lit(randomUUID())})`;
      const v1Result = human(v1Call);
      const v1Page = human(`public.composio_binding_page(${lit(accountA)})`);
      catalogBefore = catalog();
      operationalBefore = operational();

      await check(
        "local marker/base guards reject before DDL",
        () => {
          assert.throws(() => sql(install), /QGR_LOCAL_ONLY/);
          assert.equal(
            parse("select to_regnamespace('mail_quota') is null;"),
            true,
          );
          sql(
            "alter function public.reserve_gmail_api(uuid,text,integer) rename to fixture_old_quota;",
          );
          assert.throws(() => sql(marker + install), /QGR_BASE_MISMATCH/);
        },
        false,
      );
      await check(
        "installation is atomic if a final statement fails before COMMIT",
        () => {
          assert.throws(
            () =>
              sql(
                marker + install.replace(/commit;\s*$/, "select 1/0;commit;"),
              ),
            /division by zero/,
          );
          assert.equal(
            parse("select to_regnamespace('mail_quota') is null;"),
            true,
          );
          assert.equal(catalog(), catalogBefore);
          assert.equal(operational(), operationalBefore);
        },
        false,
      );
      await check(
        "closed default; v1 rows, credentials and existing catalog preserved",
        () => {
          assert.deepEqual(human(v1Call), v1Result);
          assert.deepEqual(
            human(`public.composio_binding_page(${lit(accountA)})`),
            v1Page,
          );
          assert.equal(catalog(), catalogBefore);
          assert.equal(operational(), operationalBefore);
          assert.throws(() => service(reserve()), /QGR_STALE/);
          publish(policy(1, "disabled"));
          assert.throws(() => service(reserve()), /QGR_DISABLED/);
          assert.equal(
            parse(
              "select bool_and(quota_contract_version=1 and quota_policy_id is null and google_quota_project_id is not null) from public.mail_provider_bindings;",
            ),
            true,
          );
          assert.ok(
            Number(
              sql(
                `set role service_role;select public.reserve_gmail_api(${lit(accountA)},'legacy-direct',5);`,
              ),
            ) >= 0,
          );
        },
      );
      await check(
        "private tables/helpers deny all API roles; RPC grants separated",
        () => {
          assert.equal(
            parse(
              "select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='mail_quota' and c.relrowsecurity;",
            ),
            7,
          );
          for (const role of ["anon", "authenticated", "service_role"]) {
            for (const table of [
              "policies",
              "head",
              "publications",
              "usage",
              "slot",
              "legacy_observed",
              "reservations",
            ]) {
              for (const op of [
                `select * from mail_quota.${table}`,
                `delete from mail_quota.${table}`,
                `insert into mail_quota.${table} default values`,
                `update mail_quota.${table} set ${table === "head" ? "id=id" : table === "slot" ? "scope=scope" : table === "usage" ? "units=units" : table === "policies" ? "generation=generation" : table === "legacy_observed" ? "units=units" : "request_key=request_key"}`,
              ])
                assert.throws(
                  () => sql(`set role ${role};${op};`),
                  /permission denied/,
                );
            }
            assert.throws(
              () =>
                sql(
                  `set role ${role};select mail_quota.capture_legacy(now());`,
                ),
              /permission denied/,
            );
          }
          assert.throws(
            () => sql(`set role service_role;select ${publishCall()};`),
            /permission denied/,
          );
          assert.throws(() => human(reserve()), /permission denied/);
          assert.throws(
            () => sql(`set role anon;select ${reserve()};`),
            /permission denied/,
          );
        },
      );
      await check(
        "SQL validator agrees with pure I01, including Google optional and strict inputs",
        () => {
          const base = policy();
          const cases: unknown[] = [
            base,
            { ...base, google_project: null },
            {
              ...base,
              google_project: { provenance: "unknown", project_id: null },
            },
            {
              ...base,
              google_project: {
                provenance: "oauth_client_reviewed",
                project_id: "real-reviewed-fixture",
              },
            },
            { ...base, policy_id: policyId.toUpperCase() },
            { ...base, policy_id: "00000000-0000-0000-0000-000000000000" },
            { ...base, policy_id: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
            { ...base, policy_id: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" },
            { ...base, contract_version: 1 },
            { ...base, state: null },
            { ...base, state: undefined },
            { ...base, extra: true },
            {
              ...base,
              google_project: { provenance: "unknown", project_id: "invented" },
            },
            { ...base, generation: 1.5 },
            { ...base, generation: 0 },
            { ...base, limits: { ...base.limits, window_seconds: 86400 } },
            {
              ...base,
              limits: { ...base.limits, account_units_per_minute: 9000 },
            },
            { ...base, limits: { ...base.limits, group_units_per_minute: 10 } },
            {
              ...base,
              limits: { ...base.limits, group_units_per_window: 75000001 },
            },
            null,
            [],
            "bad",
          ];
          for (const item of cases) {
            const parsed = mailQuotaPolicySchema.safeParse(item);
            if (parsed.success)
              assert.deepEqual(
                parse(`select mail_quota.policy(${json(item)});`),
                parsed.data,
              );
            else
              assert.throws(
                () => sql(`select mail_quota.policy(${json(item)});`),
                /QGR_POLICY_INVALID/,
              );
          }
        },
      );
      await check(
        "human/session/MFA authorization occurs before policy replay",
        () => {
          const call = publishCall(policy(1, "disabled"));
          human(call);
          for (const c of [
            claims(seller, sellerSid),
            claims(admin, sid, "aal1"),
            claims(admin, randomUUID()),
            claims(admin, sid, "aal2", 1),
          ])
            assert.throws(() => human(call, c), /QGR_FORBIDDEN/);
          assert.throws(
            () =>
              sql(
                `begin;set local role authenticated;set local request.jwt.claims=${json({ ...claims(), exp: "NaN" }).replace(/::jsonb$/, "")};select ${call};commit;`,
              ),
            /QGR_FORBIDDEN/,
          );
          sql(
            `update public.profiles set active=false where id=${lit(admin)};`,
          );
          assert.throws(() => human(call), /QGR_FORBIDDEN/);
          sql(`update public.profiles set active=true where id=${lit(admin)};`);
          sql(
            `update auth.sessions set not_after=now()-interval '1 second' where id=${lit(sid)};`,
          );
          assert.throws(() => human(call), /QGR_FORBIDDEN/);
          assert.throws(
            () => human(call, claims(other, otherSid)),
            /QGR_STALE/,
          );
        },
      );
      await check(
        "CAS, exact publication replay, changed input conflict and stale replay",
        () => {
          const key = randomUUID(),
            p = policy(1, "disabled"),
            call = publishCall(p, 0, true, key);
          assert.deepEqual(human(call), human(call));
          assert.throws(
            () => human(publishCall(policy(1), 0, true, key)),
            /QGR_CONFLICT/,
          );
          assert.throws(() => publish(policy(3)), /QGR_STALE/);
          publish(policy(2));
          assert.throws(() => human(call), /QGR_STALE/);
          assert.equal(
            parse("select count(*)::int from mail_quota.policies;"),
            2,
          );
        },
      );
      await check(
        "enable requires quiescent acknowledgment; prior usage and pacing carry forward",
        () => {
          assert.throws(
            () => human(publishCall(policy(), 0, false)),
            /QGR_QUIESCENCE_REQUIRED/,
          );
          sql(`insert into public.gmail_api_usage values('old-a',date_trunc('minute',now())-interval '3 minutes',123),('old-b',date_trunc('minute',now())-interval '2 minutes',77),('out-of-window',now()-interval '26 hours',999);
        insert into public.gmail_api_slots values('project:old-a',now()+interval '2 seconds'),('account:'||${lit(accountA)},now()+interval '3 seconds');`);
          const before = sql(
            "select jsonb_agg(x order by project,minute) from public.gmail_api_usage x;",
          );
          publish();
          assert.equal(usage(), 200);
          const r = service(reserve());
          assert.equal(r.reserved, true);
          assert.ok(r.wait_ms > 2000 && r.wait_ms <= 3000);
          assert.equal(usage(), 300);
          assert.equal(
            sql(
              "select jsonb_agg(x order by project,minute) from public.gmail_api_usage x;",
            ),
            before,
          );
        },
      );
      await check(
        "direct and Composio share group/account; direct project debited once",
        () => {
          publish();
          service(reserve({ provider: "gmail_oauth", units: 100 }));
          service(reserve({ units: 100 }));
          service(reserve({ account: accountB, units: 100 }));
          assert.equal(usage(), 300);
          assert.equal(
            parse("select sum(units)::bigint from public.gmail_api_usage;"),
            100,
          );
          assert.equal(
            parse("select sum(units)::bigint from mail_quota.legacy_observed;"),
            100,
          );
          assert.equal(parse("select count(*)::int from mail_quota.slot;"), 1);
          assert.equal(
            parse(
              "select count(*)::int from public.gmail_api_slots where scope like 'account:%';",
            ),
            2,
          );
        },
      );
      await check(
        "reservation replay is exact; changed tuple conflicts without a debit",
        () => {
          publish();
          const call = reserve(),
            r = service(call),
            before = snapshot();
          assert.deepEqual(service(call), r);
          assert.equal(snapshot(), before);
          const otherZone = JSON.parse(
            sql(
              `begin;set local role service_role;set local timezone='Asia/Tokyo';select ${call};commit;`,
            )
              .split(/\r?\n/)
              .at(-1)!,
          );
          assert.deepEqual(otherZone, r);
          assert.equal(snapshot(), before);
          assert.throws(
            () => service(call.replace(",100,", ",101,")),
            /QGR_CONFLICT/,
          );
          assert.equal(snapshot(), before);
        },
      );
      await check(
        "generation/reenable retains group and imports only new legacy delta",
        () => {
          publish();
          service(reserve({ units: 10 }));
          publish(policy(2, "disabled"));
          sql(
            `set role service_role;select public.reserve_gmail_api(${lit(accountB)},'legacy-later',7);`,
          );
          publish(policy(3));
          assert.equal(usage(), 17);
          service(
            reserve({ generation: 3, provider: "gmail_oauth", units: 3 }),
          );
          publish(policy(4));
          assert.equal(usage(), 20);
          assert.throws(() => service(reserve()), /QGR_STALE/);
          assert.equal(usage(), 20);
        },
      );
      await check(
        "exhausted window rejects new units and replays rejection without mutation",
        () => {
          publish(policy(1, "enabled", 10));
          assert.equal(service(reserve({ units: 10 })).reserved, true);
          const call = reserve({ units: 1 }),
            r = service(call),
            before = snapshot();
          assert.equal(r.reserved, false);
          assert.deepEqual(service(call), r);
          assert.equal(snapshot(), before);
          assert.equal(usage(), 10);
        },
      );
      await check(
        "deadline, invalid tuple, account status and stale policy deny before replay",
        () => {
          publish();
          const call = reserve();
          service(call);
          for (const broken of [
            reserve({ units: 0 }),
            reserve({ provider: "other" }),
            reserve({ deadline: new Date(Date.now() - 1000).toISOString() }),
            reserve({ deadline: new Date(Date.now() + 700000).toISOString() }),
          ])
            assert.throws(() => service(broken), /QGR_INVALID_INPUT/);
          sql(
            `update public.mail_accounts set status='disconnected' where id=${lit(accountA)};`,
          );
          assert.throws(() => service(call), /QGR_ACCOUNT_UNAVAILABLE/);
          publish(policy(2, "disabled"));
          assert.throws(() => service(call), /QGR_STALE/);
        },
      );
      await check(
        "legacy counter regression fails closed without modifying history",
        () => {
          sql(
            "insert into public.gmail_api_usage values('legacy',date_trunc('minute',now()),25);",
          );
          publish();
          sql(
            "update public.gmail_api_usage set units=24 where project='legacy';",
          );
          const before = snapshot();
          assert.throws(() => service(reserve()), /QGR_LEGACY_REGRESSION/);
          assert.equal(snapshot(), before);
        },
      );
      await check(
        "receipt failure rolls back every debit and pacing write",
        () => {
          publish();
          const before = snapshot();
          sql(
            "alter table mail_quota.reservations add constraint fixture_fail check(false) not valid;",
          );
          assert.throws(
            () => service(reserve({ provider: "gmail_oauth" })),
            /fixture_fail/,
          );
          assert.equal(snapshot(), before);
        },
      );
      await check(
        "two sessions serialize the final available unit under an observed lock",
        async () => {
          publish(policy(1, "enabled", 10));
          const a = concurrent(
            `begin;set local role service_role;select ${reserve({ units: 10 })};\n\\echo LOCK_HELD\nselect pg_sleep(1.5);commit;`,
            "qgr-race-a",
          );
          await a.held();
          const b = concurrent(
            `begin;set local role service_role;select ${reserve({ account: accountB, units: 1 })};commit;`,
            "qgr-race-b",
          );
          await blocked("qgr-race-b");
          const [ra, rb] = await Promise.all([a.done, b.done]);
          assert.equal(ra.code, 0, ra.err);
          assert.equal(rb.code, 0, rb.err);
          assert.equal(JSON.parse(rb.out.trim()).reserved, false);
          assert.equal(usage(), 10);
        },
      );
      await check(
        "simultaneous identical requests debit exactly once",
        async () => {
          publish();
          const call = reserve();
          const a = concurrent(
            `begin;set local role service_role;select ${call};\n\\echo LOCK_HELD\nselect pg_sleep(1.5);commit;`,
            "qgr-replay-a",
          );
          await a.held();
          const b = concurrent(
            `begin;set local role service_role;select ${call};commit;`,
            "qgr-replay-b",
          );
          await blocked("qgr-replay-b");
          const [ra, rb] = await Promise.all([a.done, b.done]);
          assert.equal(ra.code, 0, ra.err);
          assert.equal(rb.code, 0, rb.err);
          assert.deepEqual(
            JSON.parse(ra.out.split(/\r?\n/)[0]),
            JSON.parse(rb.out.trim()),
          );
          assert.equal(usage(), 100);
        },
      );
      await check(
        "generation change while waiting is rechecked after acquiring the lock",
        async () => {
          publish();
          const a = concurrent(
            auth() +
              `select ${publishCall(policy(2, "disabled"))};\n\\echo LOCK_HELD\nselect pg_sleep(1.5);commit;`,
            "qgr-disable-a",
          );
          await a.held();
          const b = concurrent(
            `begin;set local role service_role;select ${reserve()};commit;`,
            "qgr-disable-b",
          );
          await blocked("qgr-disable-b");
          const [ra, rb] = await Promise.all([a.done, b.done]);
          assert.equal(ra.code, 0, ra.err);
          assert.notEqual(rb.code, 0);
          assert.match(rb.err, /QGR_STALE/);
          assert.equal(usage(), 0);
        },
      );
      await check(
        "expired deadline after lock wait never reserves",
        async () => {
          publish();
          const a = concurrent(
            "begin;select pg_advisory_xact_lock(19681110,2);\n\\echo LOCK_HELD\nselect pg_sleep(1.5);commit;",
            "qgr-expire-a",
          );
          await a.held();
          const b = concurrent(
            `begin;set local role service_role;select ${reserve({ deadline: new Date(Date.now() + 700).toISOString() })};commit;`,
            "qgr-expire-b",
          );
          await blocked("qgr-expire-b");
          const [ra, rb] = await Promise.all([a.done, b.done]);
          assert.equal(ra.code, 0, ra.err);
          assert.notEqual(rb.code, 0);
          assert.match(rb.err, /QGR_EXPIRED/);
          assert.equal(usage(), 0);
        },
      );
      await check(
        "v2 references real policy, omits Google and cannot be confirmed by legacy code",
        () => {
          publish();
          const insert = (
            version: number,
            policyRef: string | null,
            google: string | null,
          ) => `begin;set local request.jwt.claims=${lit(JSON.stringify(claims()))};set local pipeline_os.c1_command=${lit(admin)};
        insert into public.mail_provider_bindings(account_id,revision,composio_project_id,auth_config_id,connected_account_id,composio_user_id,google_quota_project_id,expected_mailbox_email,account_context,created_by,quota_contract_version,quota_policy_id,quota_policy_generation)
        values(${lit(accountB)},1,'pr_fixture','ac_fixture','ca_v2','legacy-owner',${lit(google)},'b@example.test','{}',${lit(admin)},${version},${lit(policyRef)},${policyRef ? 1 : "null"});commit;`;
          assert.throws(
            () => sql(insert(1, null, null)),
            /binding_quota_contract_check/,
          );
          assert.throws(
            () => sql(insert(2, randomUUID(), null)),
            /binding_quota_policy_fk/,
          );
          sql(insert(2, policyId, null));
          assert.throws(
            () =>
              sql(`begin;set local request.jwt.claims=${lit(JSON.stringify(claims()))};set local pipeline_os.c1_command=${lit(admin)};set local pipeline_os.c2_write='confirm';
        update public.mail_provider_bindings set status='verified',reviewed_by=${lit(admin)},reviewed_at=now() where account_id=${lit(accountB)};commit;`),
            /binding_quota_contract_check/,
          );
          assert.throws(
            () =>
              sql(`begin;set local request.jwt.claims=${lit(JSON.stringify(claims()))};set local pipeline_os.c1_command=${lit(admin)};
        update public.mail_provider_bindings set status='revoked',quota_policy_generation=2 where account_id=${lit(accountB)};commit;`),
            /QGR_BINDING_IMMUTABLE/,
          );
          assert.equal(catalog(), catalogBefore);
        },
      );
      await check(
        "enable rejects known in-flight runtime operations despite acknowledgment",
        () => {
          sql(`insert into mail_runtime.routes(account_id) values(${lit(accountA)});
            insert into mail_runtime.attempts(account_id,route_revision,provider,operation,resource,token_hash,deadline)
            values(${lit(accountA)},0,'gmail_oauth','profile','fixture',repeat('a',64),clock_timestamp()+interval '1 minute');`);
          assert.throws(() => publish(), /QGR_QUIESCENCE_REQUIRED/);
          assert.equal(
            parse("select count(*)::int from mail_quota.policies;"),
            0,
          );
        },
      );
      await check(
        "legacy RPC contends with v2; its later debit is captured exactly once",
        async () => {
          publish();
          const a = concurrent(
            `begin;set local role service_role;select ${reserve({ units: 10 })};\n\\echo LOCK_HELD\nselect pg_sleep(1.5);commit;`,
            "qgr-legacy-a",
          );
          await a.held();
          const b = concurrent(
            `begin;set local role service_role;select public.reserve_gmail_api(${lit(accountB)},'legacy-mixed',7);commit;`,
            "qgr-legacy-b",
          );
          await blocked("qgr-legacy-b");
          const [ra, rb] = await Promise.all([a.done, b.done]);
          assert.equal(ra.code, 0, ra.err);
          assert.equal(rb.code, 0, rb.err);
          service(reserve({ units: 3 }));
          assert.equal(usage(), 20);
          assert.equal(
            parse("select sum(units)::bigint from public.gmail_api_usage;"),
            7,
          );
        },
      );
      await check(
        "wait is max of group/account/project, with minute-bucket accounting",
        () => {
          const p = policy();
          p.limits.group_units_per_minute = 100;
          p.limits.account_units_per_minute = 100;
          publish(p);
          service(reserve({ units: 10 }));
          const r = service(reserve({ units: 1 }));
          assert.ok(r.wait_ms >= 5000 && r.wait_ms <= 6000, JSON.stringify(r));
          assert.equal(
            parse(
              "select bool_and(extract(second from minute)=0) from mail_quota.usage;",
            ),
            true,
          );
          assert.equal(usage(), 11);
        },
      );
      await check(
        "session expiry while publishing waits is revalidated before replay",
        async () => {
          const call = publishCall(policy(1, "disabled"));
          human(call);
          const a = concurrent(
            "begin;select pg_advisory_xact_lock(19681110,2);\n\\echo LOCK_HELD\nselect pg_sleep(2);commit;",
            "qgr-auth-a",
          );
          await a.held();
          const b = concurrent(
            auth(
              claims(admin, sid, "aal2", Math.floor(Date.now() / 1000) + 1),
            ) + `select ${call};commit;`,
            "qgr-auth-b",
          );
          await blocked("qgr-auth-b");
          const [ra, rb] = await Promise.all([a.done, b.done]);
          assert.equal(ra.code, 0, ra.err);
          assert.notEqual(rb.code, 0);
          assert.match(rb.err, /QGR_FORBIDDEN/);
          assert.equal(
            parse("select count(*)::int from mail_quota.policies;"),
            1,
          );
        },
      );
      await check(
        "empty reversal restores old schema and preservation fingerprints",
        () => {
          sql(
            marker +
              "set pipeline_os.qgr_rollback_mode='remove_empty';" +
              rollback,
          );
          assert.equal(
            parse("select to_regnamespace('mail_quota') is null;"),
            true,
          );
          assert.equal(
            parse(
              "select attnotnull from pg_attribute where attrelid='public.mail_provider_bindings'::regclass and attname='google_quota_project_id';",
            ),
            true,
          );
          assert.equal(catalog(), catalogBefore);
          assert.equal(operational(), operationalBefore);
        },
      );
      await check(
        "history rollback closes without deletion, rejects replay and empty removal",
        () => {
          const call = publishCall();
          human(call);
          const request = reserve();
          service(request);
          const before = snapshot();
          assert.throws(
            () =>
              sql(
                marker +
                  "set pipeline_os.qgr_rollback_mode='remove_empty';" +
                  rollback,
              ),
            /QGR_HISTORY_RETAINED/,
          );
          assert.equal(snapshot(), before);
          sql(marker + rollback);
          assert.equal(snapshot(), before);
          assert.throws(() => service(request), /QGR_CLOSED/);
          assert.throws(() => human(call), /QGR_CLOSED/);
          assert.equal(
            parse("select count(*)::int from mail_quota.policies;"),
            1,
          );
        },
      );
      writeFileSync(
        join(runRoot, "result.json"),
        JSON.stringify(
          {
            protocol: "QGR-I02-PG15-r1",
            postgres: context.version,
            passed,
            failed: sequence - passed.length,
            clusterStopped: false,
            providerCalls: 0,
            remoteChanges: 0,
            instantlyConsumed: 43,
            sourceSha256: createHash("sha256").update(install).digest("hex"),
          },
          null,
          2,
        ),
      );
    } finally {
      if (started || existsSync(join(cluster, "postmaster.pid"))) {
        bin("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "stop"]);
        const resultPath = join(runRoot, "result.json");
        try {
          const result = JSON.parse(read(resultPath));
          result.clusterStopped = true;
          writeFileSync(resultPath, JSON.stringify(result, null, 2));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
    }
  },
);
