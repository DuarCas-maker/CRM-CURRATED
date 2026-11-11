import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
const doc = "docs/specs/pipeline-os/s02/quota-policy-reuse/migrations/";
const lit = (v: unknown) => `'${String(v).replaceAll("'", "''")}'`;
test(
  "QGR-I03 native PG15 quota admission delta",
  { skip: process.env.PIPELINE_OS_QGR_I03_NATIVE !== "1", timeout: 120000 },
  async (t) => {
    const binDir = realpathSync(
      process.env.PIPELINE_OS_QGR_PG_BIN ?? "missing-authorized-binaries",
    );
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12),
      run = resolve(".local/pipeline-os/qgr-i03/runs", suffix),
      cluster = join(run, "cluster");
    mkdirSync(run, { recursive: true });
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PATH: binDir + ";" + process.env.SystemRoot + "\\System32",
      PGAPPNAME: "qgr-i03-local",
      PGCLIENTENCODING: "UTF8",
    };
    const bin = (name: string, args: string[], input?: string) =>
      execFileSync(join(binDir, name + ".exe"), args, {
        env,
        input,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: name === "pg_ctl" ? "ignore" : ["pipe", "pipe", "pipe"],
      });
    assert.match(bin("postgres", ["--version"]), /PostgreSQL\) 15\./);
    const listener = createServer();
    await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
    const address = listener.address();
    assert(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((r) => listener.close(() => r()));
    const template = "qgr_i02_i03_base_" + suffix;
    let db = template,
      started = false,
      n = 0;
    const passed: string[] = [];
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
      "set client_min_messages='warning';set statement_timeout='10s';set lock_timeout='5s';";
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
      const v = sql(value).split(/\r?\n/).filter(Boolean).at(-1)!;
      return v === "t" ? true : v === "f" ? false : JSON.parse(v);
    };
    const marker = "set pipeline_os.qgr_local='isolated_test';";
    const install = readFileSync(doc + "quota-i03.local.sql", "utf8"),
      rollback = readFileSync(doc + "quota-i03.rollback.sql", "utf8");
    const actor = randomUUID(),
      session = randomUUID(),
      account = randomUUID(),
      policyId = randomUUID();
    const policy = (gen = 1, state = "enabled") => ({
      contract_version: 2,
      policy_id: policyId,
      generation: gen,
      state,
      mode: "crm_shared_conservative",
      limits: {
        group_units_per_minute: 900000,
        account_units_per_minute: 4500,
        group_units_per_window: 75000000,
        window_seconds: 86460,
      },
    });
    const publish = (gen = 1, state = "enabled") =>
      sql(
        `begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify({ sub: actor, session_id: session, aal: "aal2", exp: Math.floor(Date.now() / 1000) + 3600 }))};select public.mail_quota_publish(${lit(JSON.stringify(policy(gen, state)))}::jsonb,${gen - 1},true,${lit(randomUUID())});commit;`,
      );
    const service = (call: string) =>
      parse(`begin;set local role service_role;select ${call};commit;`);
    const reserve = (
      key = randomUUID(),
      end = new Date(Date.now() + 60000).toISOString(),
      acct = account,
    ) => ({
      key,
      result: service(
        `public.mail_quota_reserve(${lit(acct)},'gmail_oauth',1,${lit(policyId)},1,${lit(key)},${lit(end)},'fixture-project')`,
      ),
    });
    const admit = (key: string) =>
      service(`public.mail_quota_admit(${lit(key)})`);
    const usage = () =>
      parse("select coalesce(sum(units),0)::int from mail_quota.usage;");
    const check = async (
      name: string,
      fn: () => void | Promise<void>,
      overlay = true,
    ) => {
      await t.test(name, async () => {
        db = "qgr_i02_i03_" + suffix + "_" + ++n;
        sql(`create database ${db} template ${template};`, "postgres");
        if (overlay) sql(marker + install);
        await fn();
        passed.push(name);
      });
    };
    const concurrent = (text: string, application: string) => {
      const child = spawn(join(binDir, "psql.exe"), args(), {
        env: { ...env, PGAPPNAME: application },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "",
        err = "";
      child.stdout.on("data", (b: Buffer) => {
        out += b.toString();
      });
      child.stderr.on("data", (b: Buffer) => {
        err += b.toString();
      });
      const done = new Promise<{
        code: number | null;
        out: string;
        err: string;
      }>((r, reject) => {
        child.on("error", reject);
        child.on("close", (code) => r({ code, out, err }));
      });
      child.stdin.end(prefix + text);
      return {
        done,
        held: async () => {
          for (let i = 0; i < 100 && !out.includes("HELD"); i++)
            await new Promise((r) => setTimeout(r, 10));
          assert(out.includes("HELD"), err);
        },
      };
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
        join(run, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -c unix_socket_directories= -c shared_buffers=32MB -c max_connections=20 -c fsync=off`,
        "-w",
        "start",
      ]);
      started = true;
      sql(`create database ${template};`, "postgres");
      const data = sql("show data_directory;");
      assert.equal(realpathSync(data), realpathSync(cluster));
      assert.equal(sql("select inet_server_addr()::text;"), "127.0.0.1/32");
      // Focused synthetic dependencies only. Full accepted application catalog/DDL remains covered by I02.
      sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema mail_runtime;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create table public.profiles(id uuid primary key,active boolean not null default true,role text not null);
      create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now(),refreshed_at timestamp,not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
      create table public.mail_accounts(id uuid primary key,status text not null default 'connected');
      create table public.mail_provider_bindings(id uuid primary key,google_quota_project_id text not null,status text not null default 'candidate');
      create table public.outbox(status text);create table public.jobs(status text);
      create table public.mail_provider_binding_checks(status text);create table mail_runtime.attempts(state text);create table mail_runtime.sync_cycles(state text);
      insert into public.profiles values(${lit(actor)},true,'superadmin');insert into auth.sessions(id,user_id) values(${lit(session)},${lit(actor)});insert into mail_accounts(id) values(${lit(account)});`);
      const legacy = readFileSync(
        "supabase/migrations/039_campaign_delivery_controls.sql",
        "utf8",
      );
      const a = legacy.indexOf("create table public.gmail_api_slots("),
        b = legacy.indexOf("create function public.recheck_outbox_delivery", a);
      assert(a > 0 && b > a);
      sql(legacy.slice(a, b));
      sql(marker + readFileSync(doc + "quota-policy-v2.local.sql", "utf8"));
      await check(
        "overlay local guard and atomic DDL failure",
        () => {
          assert.throws(() => sql(install), /QGR_LOCAL_ONLY/);
          assert.throws(
            () =>
              sql(
                marker + install.replace(/commit;\s*$/, "select 1/0;commit;"),
              ),
            /division by zero/,
          );
          assert.equal(
            parse(
              "select to_regprocedure('public.mail_quota_snapshot()') is null;",
            ),
            true,
          );
          assert.equal(
            parse(
              "select count(*)::int from pg_attribute where attrelid='mail_quota.reservations'::regclass and attname='admitted_at' and not attisdropped;",
            ),
            0,
          );
        },
        false,
      );
      await check(
        "snapshot starts closed to operation and only service has RPC execute",
        () => {
          assert.deepEqual(service("public.mail_quota_snapshot()"), {
            closed: false,
            policy: null,
          });
          for (const role of ["anon", "authenticated"]) {
            assert.throws(
              () =>
                sql(`set role ${role};select public.mail_quota_snapshot();`),
              /permission denied/,
            );
            assert.throws(
              () =>
                sql(
                  `set role ${role};select public.mail_quota_admit(${lit(randomUUID())});`,
                ),
              /permission denied/,
            );
          }
          assert.throws(
            () =>
              sql(
                "set role service_role;select * from mail_quota.reservations;",
              ),
            /permission denied/,
          );
        },
      );
      await check(
        "published policy snapshot and durable admission only once",
        () => {
          publish();
          assert.deepEqual(service("public.mail_quota_snapshot()"), {
            closed: false,
            policy: policy(),
          });
          const r = reserve();
          assert.equal(admit(r.key), true);
          assert.equal(admit(r.key), false);
          assert.equal(usage(), 1);
        },
      );
      await check("unknown account cannot get a quota receipt", () => {
        publish();
        assert.throws(
          () =>
            reserve(
              randomUUID(),
              new Date(Date.now() + 60000).toISOString(),
              randomUUID(),
            ),
          /QGR_ACCOUNT_UNAVAILABLE/,
        );
        assert.equal(usage(), 0);
      });
      await check("receipt without versioned deadline cannot admit", () => {
        publish();
        const r = reserve();
        sql(
          `update mail_quota.reservations set input=input-'deadline_epoch' where request_key=${lit(r.key)};`,
        );
        assert.equal(admit(r.key), false);
        assert.equal(usage(), 1);
      });
      await check(
        "expired receipt never admits; consumption remains conservative",
        () => {
          publish();
          const r = reserve(
            randomUUID(),
            new Date(Date.now() + 500).toISOString(),
          );
          sql("select pg_sleep(0.6);");
          assert.equal(admit(r.key), false);
          assert.equal(usage(), 1);
        },
      );
      await check(
        "changed policy rejects a pending receipt without resetting consumption",
        () => {
          publish();
          const r = reserve();
          publish(2, "disabled");
          assert.equal(admit(r.key), false);
          assert.equal(usage(), 1);
        },
      );
      await check("disconnected account rejects pending admission", () => {
        publish();
        const r = reserve();
        sql(
          `update public.mail_accounts set status='disconnected' where id=${lit(account)};`,
        );
        assert.equal(admit(r.key), false);
        assert.equal(usage(), 1);
      });
      await check(
        "database rejects emission before reserved pacing time",
        () => {
          publish();
          sql(
            "update mail_quota.slot set next_at=clock_timestamp()+interval '1 second';",
          );
          const r = reserve();
          assert(r.result.wait_ms > 500);
          assert.equal(admit(r.key), false);
          sql("select pg_sleep(1.1);");
          assert.equal(admit(r.key), true);
        },
      );
      await check(
        "two physical sessions contend for the same emission, one succeeds",
        async () => {
          publish();
          const r = reserve();
          const first = concurrent(
            `begin;set local role service_role;select public.mail_quota_admit(${lit(r.key)});\n\\echo HELD\nselect pg_sleep(1);commit;`,
            "qgr-i03-a",
          );
          await first.held();
          const second = concurrent(
            `begin;set local role service_role;select public.mail_quota_admit(${lit(r.key)});commit;`,
            "qgr-i03-b",
          );
          let observed = false;
          for (let i = 0; i < 60; i++) {
            if (
              parse(
                "select exists(select 1 from pg_stat_activity where application_name='qgr-i03-b' and wait_event_type='Lock');",
              )
            ) {
              observed = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 10));
          }
          assert(observed);
          const [one, two] = await Promise.all([first.done, second.done]);
          assert.equal(one.code, 0, one.err);
          assert.equal(two.code, 0, two.err);
          assert.equal(one.out.split(/\r?\n/)[0], "t");
          assert.equal(two.out.trim(), "f");
          assert.equal(usage(), 1);
        },
      );
      await check(
        "overlay rollback retains receipts/admission and closes the policy",
        () => {
          publish();
          const r = reserve();
          assert.equal(admit(r.key), true);
          const before = sql(
            "select jsonb_agg(x order by request_key) from mail_quota.reservations x;",
          );
          sql(marker + rollback);
          assert.equal(
            sql(
              "select jsonb_agg(x order by request_key) from mail_quota.reservations x;",
            ),
            before,
          );
          assert.equal(
            parse("select closed from mail_quota.head where id=1;"),
            true,
          );
          assert.equal(usage(), 1);
        },
      );
      writeFileSync(
        join(run, "result.json"),
        JSON.stringify(
          {
            protocol: "QGR-I03-PG15-r1",
            passed,
            failed: n - passed.length,
            clusterStopped: false,
            providerCalls: 0,
            remoteChanges: 0,
          },
          null,
          2,
        ),
      );
    } finally {
      if (started || existsSync(join(cluster, "postmaster.pid"))) {
        bin("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "stop"]);
        const path = join(run, "result.json");
        if (existsSync(path)) {
          const r = JSON.parse(readFileSync(path, "utf8"));
          r.clusterStopped = true;
          writeFileSync(path, JSON.stringify(r, null, 2));
        }
      }
    }
  },
);
