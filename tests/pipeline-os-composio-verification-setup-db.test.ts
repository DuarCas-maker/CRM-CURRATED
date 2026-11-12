import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
import { bindingPageV2Schema } from "../src/lib/composio-bindings-v2";
import {
  bindingCommandV2,
  type BindingV2Ports,
} from "../src/lib/server/mail-accounts/composio-binding-v2";

import {
  verificationSetupPage,
  verificationSetupCommand,
  type VerificationSetupPorts,
} from "../src/lib/server/mail-accounts/composio-verification-setup";
import { bindingExpected } from "../src/lib/composio-bindings";
const read = (path: string) => readFileSync(path, "utf8");
const lit = (v: unknown): string =>
  v === null
    ? "null"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;
const json = (v: unknown) => lit(JSON.stringify(v)) + "::jsonb";

test(
  "CT native PG15 human callers and budget replay",
  {
    timeout: 240_000,
    // Ordinary test runs never start a server. No download, install, remote URL or env-file loader.
    skip: process.env.PIPELINE_OS_DV_SETUP_NATIVE !== "1",
  },
  async (t) => {
    assert.equal(process.versions.node.split(".")[0], "22");
    const root = realpathSync(process.cwd());
    const pgBin = realpathSync(
      process.env.PIPELINE_OS_QGR_PG_BIN ?? "missing-authorized-PG15-binaries",
    );
    const runtime = resolve(root, ".local/pipeline-os/dv-setup");
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
      PGAPPNAME: "dv-setup-local",
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
    const template = "dv_setup_base_" + suffix;
    const db = template;
    let started = false;
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
    let prefix =
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
    const passed: string[] = [];
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
      prefix += "set role supabase_admin;";
      const migrations = readdirSync(join(root, "supabase/migrations"))
        .filter((n) => /^\d{3}_.*\.sql$/.test(n))
        .sort();
      assert.equal(migrations.length, 47);
      sql(
        migrations
          .map((n) => read(join(root, "supabase/migrations", n)))
          .join("\n"),
      );
      const prm = JSON.parse(
        read(
          "docs/specs/pipeline-os/s02/release/permission-remediation/final/release-contract.json",
        ),
      );
      for (const target of prm.targets) {
        sql(
          "revoke all on table " +
            target.key +
            " from anon,authenticated;" +
            (target.authenticated.length
              ? "grant " +
                target.authenticated.join(",") +
                " on table " +
                target.key +
                " to authenticated;"
              : ""),
        );
      }
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
      const oldPage = human(
        "public.composio_binding_page(" + lit(accountA) + ")",
      );
      human(
        "public.composio_binding_command(" +
          lit(accountA) +
          "," +
          lit("register_candidate") +
          "," +
          json({
            composio_project_id: "pr_fixture",
            auth_config_id: "ac_fixture",
            connected_account_id: "ca_old",
            composio_user_id: "old-owner",
            google_quota_project_id: "legacy-project",
            expected_head_revision: oldPage.head_revision,
            expected_account_revision: oldPage.account.account_revision,
            expected_brand_revision: oldPage.account.brand_revision,
            expected_context_hash: oldPage.account.context_hash,
          }) +
          "," +
          lit(randomUUID()) +
          ")",
      );
      sql(
        "insert into public.gmail_api_usage values('qa-legacy',date_trunc('minute',now()),17)",
      );
      sql(
        read(
          "docs/specs/pipeline-os/s02/release/workspace-stats-compat-20261109/051_fix_workspace_stats_visible_mail.sql",
        ),
      );

      const finalPath =
        "docs/specs/pipeline-os/s02/release/quota-final/052_integrate_mail_quota_and_existing_bindings.sql";
      const manifest = JSON.parse(
        read("docs/specs/pipeline-os/s02/release/quota-final/manifest.json"),
      );
      const app = read(finalPath);
      assert.equal(
        createHash("sha256").update(readFileSync(finalPath)).digest("hex"),
        manifest.artifacts.find((a: { path: string }) => a.path === finalPath)
          .sha256,
      );
      sql(app); // Synthetic schema preparation only, not the accepted052 rehearsal suite.
      const check = async (name: string, fn: () => Promise<void>) => {
        await t.test(name, fn);
        passed.push(name);
      };
      let actorClaims = claims();
      const inputSql = (v: unknown) =>
        typeof v === "object" && v !== null
          ? json(v)
          : typeof v === "boolean"
            ? String(v)
            : lit(v);
      const allowed = new Set([
        "composio_binding_authorize_v2",
        "composio_binding_page_v2",
        "mail_quota_snapshot",
        "mail_quota_publish",
        "composio_binding_command_v2",
        "composio_binding_check_context_v2",
        "composio_binding_budget_v2",
      ]);
      const rpc =
        (role: "human" | "service") =>
        async (name: string, input: Record<string, unknown> = {}) => {
          assert.ok(allowed.has(name), "Only setup/candidate RPCs permitted");
          const call =
            "public." +
            name +
            "(" +
            Object.entries(input)
              .map(([k, v]) => k + "=>" + inputSql(v))
              .join(",") +
            ")";
          try {
            return {
              data: role === "human" ? human(call, actorClaims) : service(call),
              error: null,
            };
          } catch (e) {
            const msg = String(e);
            return {
              data: null,
              error: {
                message:
                  msg.match(/(?:QGR_|C_BINDING_)[A-Z_]+/)?.[0] ??
                  "UNEXPECTED_DB_ERROR",
              },
            };
          }
        };
      const descriptor = {
        context: {
          contract_version: 2,
          composio_project_id: "pr_fixture",
          credential_version: "cred_fixture",
          auth_config_revision: "rev_fixture",
          provenance_reference: "review_fixture",
          project_provenance: "server_reviewed",
          policy: policy(),
        },
        auth_config_id: "ac_fixture",
      };
      const p: VerificationSetupPorts = {
        enabled: true,
        targetAccount: accountA,
        quotaEnabled: true,
        binding: {
          enabled: true,
          checksEnabled: true,
          human: { rpc: rpc("human") } as unknown as BindingV2Ports["human"],
          service: () =>
            ({ rpc: rpc("service") }) as unknown as BindingV2Ports["human"],
          descriptor: () => descriptor,
          apiKey: () => {
            throw Error("NO_KEY");
          },
          fetchImpl: async () => {
            throw Error("NO_PROVIDER");
          },
          now: Date.now,
        },
      };
      let publication: Record<string, unknown>;
      await check(
        "CT-PG01 GET reads only and real MFA/account grants deny before service",
        async () => {
          const before = sql("select count(*) from mail_quota.policies"),
            r = await verificationSetupPage(p, accountA);
          assert.equal(r.policy.can_publish, true);
          assert.equal(sql("select count(*) from mail_quota.policies"), before);
          actorClaims = claims(admin, sid, "aal1");
          await assert.rejects(verificationSetupPage(p, accountA), {
            code: "SETUP_FORBIDDEN",
          });
          actorClaims = claims(seller, sellerSid);
          await assert.rejects(verificationSetupPage(p, accountA), {
            code: "SETUP_FORBIDDEN",
          });
          actorClaims = claims();
        },
      );
      await check(
        "CT-PG02 human policy publication captures legacy usage17; same-key replay preserves it",
        async () => {
          const r = await verificationSetupPage(p, accountA);
          publication = {
            action: "publish_policy",
            setup_revision: r.setup_revision,
            expected_generation: 0,
            quiescent: true,
            idempotency_key: randomUUID(),
          };
          await verificationSetupCommand(p, accountA, publication);
          const used = sql("select sum(units) from mail_quota.usage");
          assert.equal(used, "17");
          await verificationSetupCommand(p, accountA, publication);
          assert.equal(sql("select sum(units) from mail_quota.usage"), used);
          assert.equal(
            sql("select count(*) from mail_quota.publications"),
            "1",
          );
        },
      );
      await check(
        "CT-PG03 register fictitious v2 candidate through existing command without provider",
        async () => {
          const a = bindingPageV2Schema.parse(
            human("public.composio_binding_page_v2(" + lit(accountA) + ")"),
          );
          await bindingCommandV2(p.binding, accountA, {
            contract_version: 2,
            kind: "register_candidate",
            payload: {
              ...bindingExpected(a),
              composio_project_id: "pr_fixture",
              auth_config_id: "ac_fixture",
              connected_account_id: "ca_fixture",
              composio_user_id: "fixture-owner",
            },
            idempotency_key: randomUUID(),
          });
          assert.equal(
            (await verificationSetupPage(p, accountA)).can_grant,
            true,
          );
        },
      );
      await check(
        "CT-PG04 budget maximum4 and exact expiry; replay preserves used2 and actor/session",
        async () => {
          const r = await verificationSetupPage(p, accountA),
            expiry = new Date(Date.now() + 540000).toISOString();
          const body = {
            action: "grant_budget",
            setup_revision: r.setup_revision,
            binding_id: r.candidate_id,
            included_confirmed: true,
            expires_at: expiry,
            idempotency_key: randomUUID(),
          };
          await verificationSetupCommand(p, accountA, body);
          assert.equal(
            sql("select maximum from mail_quota.binding_budgets"),
            "4",
          );
          sql("update mail_quota.binding_budgets set used=2");
          const before = sql(
            "select to_jsonb(b)::text from mail_quota.binding_budgets b",
          );
          await verificationSetupCommand(p, accountA, body);
          assert.equal(
            sql("select to_jsonb(b)::text from mail_quota.binding_budgets b"),
            before,
          );
          assert.equal(sql("select used from mail_quota.binding_budgets"), "2");
          await assert.rejects(
            verificationSetupCommand(p, accountA, { ...body, maximum: 99 }),
            { code: "SETUP_INVALID_INPUT" },
          );
          await assert.rejects(
            verificationSetupCommand(p, accountA, {
              ...body,
              expires_at: new Date(Date.now() + 700000).toISOString(),
            }),
            { code: "SETUP_INVALID_INPUT" },
          );
          assert.equal(sql("select used from mail_quota.binding_budgets"), "2");
          assert.equal(
            sql("select session_id::text from mail_quota.binding_budgets"),
            sid,
          );
          assert.equal(
            sql("select actor_id::text from mail_quota.binding_budgets"),
            admin,
          );
          assert.equal(
            sql("select count(*) from mail_quota.binding_checks"),
            "0",
          );
          assert.equal(sql("select count(*) from public.outbox"), "0");
        },
      );
      writeFileSync(
        join(runRoot, "result.json"),
        JSON.stringify(
          {
            protocol: "CT-PG15-r1",
            postgres: context.version,
            passed,
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
        const p = join(runRoot, "result.json");
        if (existsSync(p)) {
          const r = JSON.parse(read(p));
          r.clusterStopped = true;
          writeFileSync(p, JSON.stringify(r, null, 2));
        }
      }
    }
  },
);
