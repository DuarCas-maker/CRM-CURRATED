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
import { bindingPageV2Schema } from "../src/lib/composio-bindings-v2";
import {
  bindingCheckV2,
  type BindingV2Ports,
} from "../src/lib/server/mail-accounts/composio-binding-v2";
import { withMailQuota } from "../src/lib/server/mail-quota";
import { requiredComposioScopes } from "../src/lib/server/mail-accounts/composio-verifier";

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
  "QGR-I04 native PG15: binding v2 and runtime",
  {
    timeout: 240_000,
    // Ordinary test runs never start a server. No download, install, remote URL or env-file loader.
    skip: process.env.PIPELINE_OS_QGR_I04_NATIVE !== "1",
  },
  async (t) => {
    assert.equal(process.versions.node.split(".")[0], "22");
    const root = realpathSync(process.cwd());
    const pgBin = realpathSync(
      process.env.PIPELINE_OS_QGR_PG_BIN ?? "missing-authorized-PG15-binaries",
    );
    const runtime = resolve(root, ".local/pipeline-os/qgr-i04");
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
      PGAPPNAME: "qgr-i04-local",
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
    const template = "qgr_i02_i04_base_" + suffix;
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
          .at(-1)!
          .replace(/^t$/, "true")
          .replace(/^f$/, "false") || "null",
      );
    const service = (call: string) =>
      JSON.parse(
        sql(`begin;set local role service_role;select ${call};commit;`)
          .split(/\r?\n/)
          .at(-1)!
          .replace(/^t$/, "true")
          .replace(/^f$/, "false") || "null",
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
        db = "qgr_i02_i04_" + suffix + "_" + ++sequence;
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
      const i04 = read(join(root, doc, "migrations/quota-i04.local.sql"));
      const i03 = read(join(root, doc, "migrations/quota-i03.local.sql"));
      const i04marker = "set pipeline_os.qgr_i04_local='isolated_test';\n";
      const contextV2 = () => ({
        contract_version: 2,
        composio_project_id: "pr_fixture",
        credential_version: "cred1",
        auth_config_revision: "rev1",
        provenance_reference: "review1",
        project_provenance: "server_reviewed",
        policy: policy(),
      });
      const digest = () =>
        createHash("sha256")
          .update("QGR-C2-v2\0" + JSON.stringify(contextV2()))
          .digest("hex");
      const configure = () => {
        publish();
        service(
          `public.composio_binding_check_context_v2(${lit(accountA)},'ac_fixture',${lit(JSON.stringify(contextV2()))},${lit(digest())})`,
        );
      };
      const page2 = () =>
        bindingPageV2Schema.parse(
          human(`public.composio_binding_page_v2(${lit(accountA)},null,25)`),
        );
      const expected2 = () => {
        const p = page2();
        return {
          expected_head_revision: p.head_revision,
          expected_account_revision: p.account.account_revision,
          expected_brand_revision: p.account.brand_revision,
          expected_context_hash: p.account.context_hash,
        };
      };
      const candidate = () =>
        human(
          `public.composio_binding_command_v2(${lit(accountA)},'register_candidate',${json({ ...expected2(), composio_project_id: "pr_fixture", auth_config_id: "ac_fixture", connected_account_id: "ca_fixture", composio_user_id: "fixture-owner" })},${lit(randomUUID())})`,
        );
      const budget = () =>
        human(
          `public.composio_binding_budget_v2(${lit(accountA)},${lit(digest())},4,${lit(new Date(Date.now() + 120000).toISOString())},${lit(randomUUID())},true)`,
        );
      const begin2 = (
        binding: string,
        key = randomUUID(),
        nonce = "a".repeat(64),
      ) =>
        human(
          `public.composio_binding_check_begin_v2(${lit(accountA)},${lit(binding)},${json(expected2())},${lit(digest())},${lit(createHash("sha256").update(nonce).digest("hex"))},${lit(key)})`,
        );
      const ticket2 = (id: string, nonce = "a".repeat(64)) =>
        `${lit(id)},${lit(nonce)},${lit(digest())}`;
      const facts2 = {
        contract_version: 2,
        project: true,
        config: true,
        connection: true,
        owner: true,
        toolkit: true,
        active: true,
        mailbox: true,
        permissions: true,
        quota_policy: true,
        configuration: true,
        reason: null,
      };
      const finish2 = (
        id: string,
        evidence = {
          source: "google-tokeninfo-proxy-v1",
          observed_at_ms: Date.now() - 500,
          valid_until_ms: Date.now() + 20000,
        },
      ) =>
        service(
          `public.composio_binding_check_finish_v2(${ticket2(id)},${json(facts2)},${json(evidence)})`,
        );
      const confirm2 = (binding: string, id: string, key = randomUUID()) =>
        human(
          `public.composio_binding_command_v2(${lit(accountA)},'confirm_binding',${json({ ...expected2(), binding_id: binding, check_id: id })},${lit(key)})`,
        );
      const completed = () => {
        configure();
        const b = candidate();
        budget();
        const c = begin2(b.id);
        for (let i = 1; i <= 4; i++)
          service(
            `public.composio_binding_check_admit_v2(${ticket2(c.id)},${i})`,
          );
        finish2(c.id);
        return { b, c };
      };
      const check4 = async (name: string, action: () => void | Promise<void>) =>
        check(name, async () => {
          sql(marker + i03);
          sql(i04marker + i04);
          await action();
        });
      await check4(
        "A2 install, private ACL, RLS and no implicit routing or budget",
        () => {
          const postflight = JSON.parse(
            sql(
              i04marker +
                read(join(root, doc, "migrations/quota-i04.postflight.sql")),
            ),
          );
          assert.equal(
            postflight.pipeline_os_quota_i04_postflight.targetsOk,
            true,
          );
          configure();
          const b = candidate();
          const p = page2();
          assert.equal(p.contract_version, 2);
          assert.equal(p.current?.id, b.id);
          assert.equal(p.can_confirm, false);
          assert.equal(p.verification_available, false);
          assert.equal(parse("select count(*) from mail_runtime.routes"), 0);
          for (const role of ["anon", "authenticated", "service_role"])
            for (const table of [
              "binding_checks",
              "binding_contexts",
              "binding_budgets",
            ])
              assert.equal(
                parse(
                  `select has_table_privilege('${role}','mail_quota.${table}','SELECT')`,
                ),
                false,
              );
          assert.throws(
            () =>
              service(`public.composio_binding_authorize_v2(${lit(accountA)})`),
            /permission denied/,
          );
          assert.throws(
            () =>
              human(
                `public.composio_binding_authorize_v2(${lit(accountA)})`,
                claims(seller, sellerSid),
              ),
            /FORBIDDEN/,
          );
          assert.throws(
            () =>
              human(
                `public.composio_binding_authorize_v2(${lit(accountA)})`,
                claims(admin, sid, "aal1"),
              ),
            /FORBIDDEN/,
          );
          assert.throws(() => begin2(b.id), /UNAVAILABLE/);
        },
      );
      await check4(
        "A2 four durable admissions, actual receipt, explicit confirmation and replay",
        () => {
          configure();
          const b = candidate();
          budget();
          const key = randomUUID();
          const c = begin2(b.id, key);
          assert.equal(begin2(b.id, key).replay, true);
          assert.throws(() => begin2(b.id), /CONFLICT/);
          assert.throws(
            () =>
              service(
                `public.composio_binding_check_admit_v2(${ticket2(c.id)},2)`,
              ),
            /UNAVAILABLE/,
          );
          assert.throws(
            () =>
              service(
                `public.composio_binding_check_admit_v2(${ticket2(c.id, "b".repeat(64))},1)`,
              ),
            /EVIDENCE/,
          );
          for (let i = 1; i <= 4; i++)
            assert.equal(
              service(
                `public.composio_binding_check_admit_v2(${ticket2(c.id)},${i})`,
              ),
              true,
            );
          assert.throws(
            () =>
              service(
                `public.composio_binding_check_admit_v2(${ticket2(c.id)},4)`,
              ),
            /UNAVAILABLE/,
          );
          assert.throws(
            () =>
              finish2(c.id, {
                source: "google-tokeninfo-proxy-v1",
                observed_at_ms: Date.now() - 10000,
                valid_until_ms: Date.now() - 1,
              }),
            /EVIDENCE/,
          );
          finish2(c.id);
          assert.equal(page2().current?.status, "candidate");
          assert.equal(page2().can_confirm, true);
          const k = randomUUID(),
            exp = expected2(),
            call = `public.composio_binding_command_v2(${lit(accountA)},'confirm_binding',${json({ ...exp, binding_id: b.id, check_id: c.id })},${lit(k)})`;
          assert.equal(human(call).status, "verified");
          assert.deepEqual(human(call), human(call));
          assert.equal(page2().current?.stale, false);
          assert.equal(
            parse("select sum(used) from mail_quota.binding_budgets"),
            4,
          );
          assert.equal(parse("select count(*) from mail_runtime.routes"), 0);
        },
      );
      await check4(
        "A2 stale actor, session, policy and expired evidence block confirmation",
        () => {
          const { b, c } = completed();
          sql(`delete from auth.sessions where id=${lit(sid)}`);
          assert.throws(() => confirm2(b.id, c.id), /FORBIDDEN/);
          assert.equal(
            parse(
              `select status='candidate' from public.mail_provider_bindings where id=${lit(b.id)}`,
            ),
            true,
          );
        },
      );
      await check4(
        "A2 rotated context blocks further admission without refund",
        () => {
          configure();
          const b = candidate();
          budget();
          const c = begin2(b.id);
          service(`public.composio_binding_check_admit_v2(${ticket2(c.id)},1)`);
          sql(
            `update public.mail_accounts set live_enabled=not live_enabled where id=${lit(accountA)}`,
          );
          assert.throws(
            () =>
              service(
                `public.composio_binding_check_admit_v2(${ticket2(c.id)},2)`,
              ),
            /STALE/,
          );
          assert.equal(
            parse("select sum(used) from mail_quota.binding_budgets"),
            1,
          );
          assert.equal(page2().can_confirm, false);
        },
      );
      await check4(
        "A2 expired actual receipt blocks confirmation without deleting evidence",
        () => {
          const { b, c } = completed();
          sql(
            `update mail_quota.binding_checks set valid_until=clock_timestamp()-interval '1 second' where id=${lit(c.id)}`,
          );
          assert.equal(page2().can_confirm, false);
          assert.throws(() => confirm2(b.id, c.id), /EVIDENCE/);
          assert.equal(
            parse("select count(*) from mail_quota.binding_checks"),
            1,
          );
        },
      );
      await check4(
        "A2 closed policy blocks confirmation while local revocation works",
        () => {
          const { b, c } = completed();
          sql("update mail_quota.head set closed=true where id=1");
          assert.equal(page2().can_confirm, false);
          assert.throws(() => confirm2(b.id, c.id), /UNAVAILABLE/);
          const r = human(
            `public.composio_binding_command_v2(${lit(accountA)},'revoke_binding',${json({ ...expected2(), binding_id: b.id, reason: "operator_revoked" })},${lit(randomUUID())})`,
          );
          assert.equal(r.status, "revoked");
        },
      );
      await check4(
        "A2 competing PostgreSQL transactions admit a step only once",
        async () => {
          configure();
          const b = candidate();
          budget();
          const c = begin2(b.id);
          const call = `select public.composio_binding_check_admit_v2(${ticket2(c.id)},1);`;
          const first = concurrent(
            `begin;set local role service_role;${call}select 'LOCK_HELD';select pg_sleep(1);commit;`,
            "i04-first",
          );
          await first.held();
          const second = concurrent(
            `begin;set local role service_role;${call}commit;`,
            "i04-second",
          );
          await blocked("i04-second");
          const [a, b2] = await Promise.all([first.done, second.done]);
          assert.equal(a.code, 0, a.err);
          assert.notEqual(b2.code, 0);
          assert.match(b2.err, /UNAVAILABLE/);
          assert.equal(
            parse("select sum(used) from mail_quota.binding_budgets"),
            1,
          );
        },
      );
      await check4(
        "R1 v2 cutover, exact ticket, quota/config invalidation and direct rollback",
        () => {
          const { b, c } = completed();
          confirm2(b.id, c.id);
          const command = (kind: string, target = "composio") => {
            const r = human(`public.mail_transport_review(${lit(accountA)})`);
            return human(
              `public.mail_transport_command(${lit(accountA)},${lit(kind)},${json({ ...r.expected, target_provider: target })},${lit(randomUUID())})`,
            );
          };
          command("bootstrap_direct", "gmail_oauth");
          command("prepare_transition");
          command("commit_transition");
          const s = service(`public.mail_transport_snapshot(${lit(accountA)})`);
          assert.equal(s.quota_contract_version, 2);
          assert.equal(s.quota_project_id, null);
          assert.equal(s.quota_policy_id, policyId);
          const cap = "c".repeat(64),
            hash = createHash("sha256").update(cap).digest("hex");
          const ticket = service(
            `public.mail_transport_acquire(${lit(accountA)},${s.revision},'profile','profile',${lit(hash)})`,
          );
          assert.equal(ticket.binding.quotaContractVersion, 2);
          assert.equal(ticket.binding.quotaProjectId, null);
          assert.equal(
            service(
              `public.mail_transport_validate_context(${lit(ticket.id)},${lit(cap)},${lit(digest())},1,false)`,
            ),
            true,
          );
          assert.equal(
            service(
              `public.mail_transport_validate_context(${lit(ticket.id)},${lit(cap)},${lit("f".repeat(64))},1,false)`,
            ),
            false,
          );
          assert.throws(
            () =>
              command("prepare_transition", "gmail_oauth") &&
              command("commit_transition", "gmail_oauth"),
            /UNRESOLVED/,
          );
          service(
            `public.mail_transport_finish(${lit(ticket.id)},${lit(cap)},'cancelled_before_wire')`,
          );
          sql("update mail_quota.head set closed=true where id=1");
          command("commit_transition", "gmail_oauth");
          assert.equal(
            service(`public.mail_transport_snapshot(${lit(accountA)})`)
              .provider,
            "gmail_oauth",
          );
          assert.equal(
            parse("select count(*) from mail_quota.binding_checks"),
            1,
          );
          assert.equal(
            parse("select sum(used) from mail_quota.binding_budgets"),
            4,
          );
          const receipts = sql(
            "select jsonb_agg(to_jsonb(c) order by id) from mail_quota.binding_checks c;",
          );
          const counters = snapshot();
          sql(
            i04marker +
              read(join(root, doc, "migrations/quota-i04.rollback.sql")),
          );
          assert.equal(
            sql(
              "select jsonb_agg(to_jsonb(c) order by id) from mail_quota.binding_checks c;",
            ),
            receipts,
          );
          assert.equal(snapshot(), counters);
          assert.throws(() => page2(), /permission denied/);
        },
      );
      await check(
        "I04 transactional DDL rollback restores catalog, credentials and counters",
        () => {
          sql(marker + i03);
          const before = catalog(),
            data = operational(),
            counts = snapshot();
          sql(
            "begin;" +
              i04marker +
              i04.replace(/\bbegin;/, "").replace(/commit;\s*$/, "") +
              "rollback;",
          );
          assert.equal(catalog(), before);
          assert.equal(operational(), data);
          assert.equal(snapshot(), counts);
          assert.equal(
            parse("select to_regclass('mail_quota.binding_checks') is null"),
            true,
          );
        },
      );
      await check4(
        "A3 real PG15 RPC orchestration with synthetic provider and durable quota reservations",
        async () => {
          configure();
          const b = candidate();
          budget();
          let wires = 0;
          const adapter = (who: "human" | "service") =>
            ({
              rpc: async (name: string, p: Record<string, unknown>) => {
                assert.match(name, /^[a-z0-9_]+$/);
                const call = `public.${name}(${Object.values(p)
                  .map((v) => (v && typeof v === "object" ? json(v) : lit(v)))
                  .join(",")})`;
                try {
                  return {
                    data: who === "human" ? human(call) : service(call),
                    error: null,
                  };
                } catch (e) {
                  return {
                    data: null,
                    error: {
                      message:
                        String(e).match(/ERROR:\s+([^\r\n]+)/)?.[1] ??
                        "C_BINDING_UNAVAILABLE",
                    },
                  };
                }
              },
            }) as unknown as BindingV2Ports["human"];
          const h = adapter("human"),
            s = adapter("service");
          const ports: BindingV2Ports = {
            enabled: true,
            checksEnabled: true,
            human: h,
            service: () => s,
            descriptor: () => ({
              context: contextV2(),
              auth_config_id: "ac_fixture",
            }),
            apiKey: () => "synthetic-never-real",
            now: Date.now,
            fetchImpl: async (input, init) => {
              wires++;
              const url = String(input);
              if (url.endsWith("/connected_accounts/ca_fixture"))
                return Response.json({
                  id: "ca_fixture",
                  user_id: "fixture-owner",
                  authScheme: "OAUTH2",
                  toolkit: { slug: "gmail" },
                  auth_config: {
                    id: "ac_fixture",
                    auth_scheme: "OAUTH2",
                    is_disabled: false,
                  },
                  status: "ACTIVE",
                  is_disabled: false,
                  updated_at: "connection1",
                });
              if (url.endsWith("/auth_configs/ac_fixture"))
                return Response.json({
                  id: "ac_fixture",
                  toolkit: { slug: "gmail" },
                  auth_scheme: "OAUTH2",
                  status: "ENABLED",
                  last_updated_at: "rev1",
                });
              const body = JSON.parse(String(init?.body));
              assert.equal(body.connected_account_id, "ca_fixture");
              assert.equal(body.user_id, "fixture-owner");
              if (body.endpoint === "https://oauth2.googleapis.com/tokeninfo")
                return Response.json({
                  status: 200,
                  data: {
                    aud: "fake.apps.example.test",
                    scope: requiredComposioScopes.join(" "),
                    expires_in: 3600,
                  },
                });
              assert.equal(
                body.endpoint,
                "https://gmail.googleapis.com/gmail/v1/users/me/profile",
              );
              return Response.json({
                status: 200,
                data: { emailAddress: "a@example.test" },
              });
            },
          };
          const q = {
            enabled: true,
            now: Date.now,
            uuid: randomUUID,
            sleep: async (ms: number) => {
              await sleep(ms);
            },
            rpc: async (name: string, p: Record<string, unknown>) => {
              const r = await s.rpc(name, p);
              if (r.error) throw Error(r.error.message);
              return r.data;
            },
          };
          const r = await withMailQuota(q, () =>
            bindingCheckV2(ports, accountA, {
              contract_version: 2,
              binding_id: b.id,
              expected: expected2(),
              idempotency_key: randomUUID(),
            }),
          );
          assert.equal(r.status, "completed");
          assert.equal(wires, 4);
          assert.equal(page2().current?.status, "candidate");
          assert.equal(page2().can_confirm, true);
          assert.equal(
            parse("select sum(used) from mail_quota.binding_budgets"),
            4,
          );
          assert.equal(
            parse("select count(*) from mail_quota.reservations"),
            1,
          );
          confirm2(b.id, r.id);
          assert.equal(page2().current?.status, "verified");
          assert.equal(parse("select count(*) from mail_runtime.routes"), 0);
        },
      );
      writeFileSync(
        join(runRoot, "result.json"),
        JSON.stringify(
          {
            protocol: "QGR-I04-PG15-r1",
            postgres: context.version,
            passed,
            failed: sequence - passed.length,
            clusterStopped: false,
            providerCalls: 0,
            remoteChanges: 0,
            instantlyConsumed: 43,
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
