import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  realpathSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createServer } from "node:net";
import {
  ConnectError,
  type ConnectSnapshot,
  type ConnectStoreCommand,
  type ConnectLease,
} from "../src/lib/composio-connect";
import { createConnectSecrets } from "../src/lib/server/mail-accounts/composio-connect/secrets";
import {
  createConnectStore,
  type ConnectRpcClient,
} from "../src/lib/server/mail-accounts/composio-connect/store";
import {
  connectAuthority,
  connectDigest,
} from "../src/lib/server/mail-accounts/composio-connect/session";
import { createComposioConnectOrchestrator } from "../src/lib/server/mail-accounts/composio-connect/orchestrator";
import { createConnectProvider } from "../src/lib/server/mail-accounts/composio-connect/provider";

const lit = (v: unknown): string =>
  v === null
    ? "null"
    : typeof v === "number"
      ? String(v)
      : "'" + String(v).replaceAll("'", "''") + "'";
const json = (v: unknown) => lit(JSON.stringify(v)) + "::jsonb";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) assert.fail("Fixture phase not reached");
    await pause(15);
  }
}
const reject = (code: string) => (e: unknown) =>
  e instanceof ConnectError && e.code === code;
function gate<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test(
  "T-009 native PG15: durable store, encrypted state, tickets, composition and real contention",
  {
    timeout: 180000,
    skip: process.env.PIPELINE_OS_CONNECT_T009_NATIVE !== "1",
  },
  async (t) => {
    const root = realpathSync(process.cwd()),
      doc = "docs/specs/pipeline-os/s02/connect-gmail",
      runtime = resolve(root, ".local/f2-connect-t002");
    const pg = join(runtime, "toolchains/postgresql-15.19/pgsql/bin");
    assert.equal(process.versions.node.split(".")[0], "22");
    assert.ok(existsSync(join(pg, "postgres.exe")));
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12),
      database = "f2_connect_" + suffix,
      runRoot = join(runtime, "runs", "t009-" + suffix),
      cluster = join(runRoot, "cluster");
    assert.ok(
      !isAbsolute(relative(runtime, runRoot)) &&
        !relative(runtime, runRoot).startsWith(".."),
    );
    mkdirSync(runRoot, { recursive: true });
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PATH: pg + ";" + process.env.SystemRoot + "\\System32",
      PGAPPNAME: "f2-connect-t009",
      PGCLIENTENCODING: "UTF8",
    };
    const bin = (name: string, args: string[], input?: string) =>
      execFileSync(join(pg, name + ".exe"), args, {
        env,
        input,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: name === "pg_ctl" ? "ignore" : ["pipe", "pipe", "pipe"],
      });
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((r, no) => server.close((e) => (e ? no(e) : r())));
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
    const prefix =
      "set client_min_messages='warning';set statement_timeout='15s';set lock_timeout='5s';\n";
    const sql = (text: string, db = database) => {
      const a = [...args];
      a[a.length - 1] = db;
      try {
        return bin("psql", a, prefix + text).trim();
      } catch (e) {
        throw Error(
          String((e as { stderr?: unknown }).stderr ?? "Local SQL unavailable"),
        );
      }
    };
    const value = (text: string) => {
      const last = sql(text).split(/\r?\n/).filter(Boolean).at(-1)!;
      if (last === "t") return true;
      if (last === "f") return false;
      try {
        return JSON.parse(last);
      } catch {
        return last;
      }
    };
    const sqlAsync = (text: string) =>
      new Promise<string>((yes, no) => {
        const p = spawn(join(pg, "psql.exe"), args, {
          env,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "",
          err = "";
        p.stdout.on("data", (b) => {
          out += b;
        });
        p.stderr.on("data", (b) => {
          err += b;
        });
        p.on("error", no);
        p.on("close", (code) => (code === 0 ? yes(out) : no(Error(err))));
        p.stdin.end(prefix + text);
      });
    const fixture = {
      actor: randomUUID(),
      other: randomUUID(),
      seller: randomUUID(),
      sid: randomUUID(),
      otherSid: randomUUID(),
      sellerSid: randomUUID(),
      secondSid: randomUUID(),
      brand: randomUUID(),
      old: randomUUID(),
    };
    const session = {
      actor_id: fixture.actor,
      session_id: fixture.sid,
      role: "superadmin",
      active: true,
      aal: "aal2",
      authorization_revision: 1,
      expires_at_ms: Date.now() + 3600000,
    };
    const claims = () => ({
      sub: session.actor_id,
      session_id: session.session_id,
      aal: session.aal,
      exp: Math.floor(session.expires_at_ms / 1000),
    });
    const humanSql = (call: string) =>
      sql(
        `begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify(claims()))};select ${call};commit;`,
      );
    const serviceSql = (call: string) =>
      sql(`begin;set local role service_role;select ${call};commit;`);
    const configuration = {
      enabled: true as const,
      config: {
        generation: 2,
        project_id: "pr_t009_fixture",
        auth_config_id: "ac_t009_fixture",
        quota_project_id: "google_t009_fixture",
        owner_id: "fixture_owner",
        callback_mode: "standard" as const,
      },
      context: {
        composio_project_id: "pr_t009_fixture",
        credential_version: "fixture_v1",
        google_quota_project_id: "google_t009_fixture",
        auth_config_revision: "fixture_r1",
        provenance_reference: "fixture_review",
        project_provenance: "server_reviewed" as const,
        quota_provenance: "oauth_client_reviewed" as const,
      },
      callback_origin: "https://crm.example.test",
    };
    const configFor = (config: typeof configuration.config) => ({
      ...configuration,
      config: { ...config },
    });
    let delayClaim = false,
      loseAck = "",
      intercept:
        | ((operation: string, p: Record<string, unknown>) => Promise<void>)
        | undefined;
    const counters = { requests: 0, create: 0, read: 0 };
    const client = (role: "human" | "service"): ConnectRpcClient => ({
      async rpc(name, p) {
        const operation = p.operation as string;
        if (intercept) await intercept(operation, p);
        const params = name.endsWith("authorize")
          ? `${lit(operation)},${json(p.p)}`
          : name.endsWith("execute") || name.endsWith("register")
            ? `${lit(operation)},${json(p.p)},${json(p.ticket)}`
            : `${lit(operation)},${json(p.p)}`;
        const delay =
          delayClaim && name.endsWith("execute") && operation === "claim";
        if (delay) delayClaim = false;
        const auth =
          role === "human"
            ? `set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify(claims()))};`
            : `set local role service_role;`;
        try {
          const out = await sqlAsync(
            `begin;${auth}select public.${name}(${params});${delay ? "select pg_sleep(0.8);" : ""}commit;`,
          );
          if (
            ((name.endsWith("execute") && operation !== "register") ||
              name.endsWith("register")) &&
            operation === loseAck
          ) {
            loseAck = "";
            throw Error("fixture-ack-lost");
          }
          const last = out.split(/\r?\n/).filter(Boolean).at(-1);
          return { data: last ? JSON.parse(last) : null, error: null };
        } catch (e) {
          const text = String(e),
            match = text.match(/\b(CONNECT_[A-Z_]+)\b/);
          return {
            data: null,
            error: { message: match?.[1] ?? "CONNECT_UNAVAILABLE" },
          };
        }
      },
    });
    const secrets = createConnectSecrets({
      activeKeyId: "fixture",
      keys: { fixture: randomBytes(32) },
      randomBytes,
    });
    const api = createConnectStore({
      human: client("human"),
      service: client("service"),
      secrets,
      session: async () => ({ ...session }),
      now: Date.now,
      uuid: randomUUID,
      proof: () => randomBytes(32).toString("base64url"),
      configuration: (config) => configFor(config),
    });
    const clock = {
      now: Date.now,
      setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimer: (h: unknown) =>
        clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    type FixtureAttempt = Awaited<ReturnType<typeof begin>>;
    async function begin(overrides: Record<string, unknown> = {}) {
      const proof = randomUUID(),
        state = randomUUID(),
        intent = {
          attempt_id: randomUUID(),
          idempotency_key: randomUUID(),
          browser_proof: proof,
          callback_state: state,
          mode: "new",
          email: randomUUID() + "@example.test",
          organization: "fixture",
          brand_id: fixture.brand,
          expected_brand_revision: 1,
          expected_account_revision: 0,
          expected_head_revision: 0,
          expected_config_generation: 2,
          ...overrides,
        };
      const result = await api.beginIntent(intent);
      return { intent, proof, state, snapshot: result.snapshot };
    }
    const authority = (f: FixtureAttempt) =>
      connectAuthority(
        session as Parameters<typeof connectAuthority>[0],
        f.proof,
      );
    const load = async (f: FixtureAttempt) => {
      f.snapshot = (await api.store.load({
        attempt_id: f.snapshot.attempt.id,
        authority: authority(f),
      })) as ConnectSnapshot;
      return f.snapshot;
    };
    const request = (f: FixtureAttempt) => ({
      attempt_id: f.snapshot.attempt.id,
      expected_revision: f.snapshot.attempt.revision,
      idempotency_key: randomUUID(),
      browser_proof: f.proof,
    });
    const command = (
      f: FixtureAttempt,
      kind: ConnectStoreCommand["command"] = "start",
    ): ConnectStoreCommand => ({
      attempt_id: f.snapshot.attempt.id,
      expected_revision: f.snapshot.attempt.revision,
      idempotency_key: randomUUID(),
      fingerprint: connectDigest(randomUUID()),
      command: kind,
      authority: authority(f),
      expected_context_hash: f.snapshot.attempt.context_hash,
    });
    async function engine(f: FixtureAttempt, connectionOverride?: string) {
      const cfg = await api.bindConfiguration({
        attempt_id: f.snapshot.attempt.id,
        authority: authority(f),
      });
      const fetchImpl = (async (url, init) => {
        counters.requests++;
        const path = new URL(String(url)).pathname,
          body = init?.body ? JSON.parse(String(init.body)) : null;
        let data: unknown,
          status = 200;
        if (path.endsWith("/link")) {
          counters.create++;
          status = 201;
          data = {
            connected_account_id:
              connectionOverride ??
              "ca_" + f.intent.attempt_id.replaceAll("-", ""),
            redirect_url: "https://connect.composio.dev/link/ln_fixture",
            expires_at: new Date(Date.now() + 600000).toISOString(),
            link_token: "fixture-discard",
          };
        } else if (path.includes("/connected_accounts/")) {
          counters.read++;
          data = {
            id: f.snapshot.attempt.connection_id,
            user_id: cfg.config.owner_id,
            toolkit: { slug: "gmail" },
            authScheme: "OAUTH2",
            auth_config: {
              id: cfg.config.auth_config_id,
              auth_scheme: "OAUTH2",
              is_disabled: false,
            },
            status: "ACTIVE",
            is_disabled: false,
          };
        } else if (path.includes("/auth_configs/")) {
          counters.read++;
          data = {
            id: cfg.config.auth_config_id,
            toolkit: { slug: "gmail" },
            auth_scheme: "OAUTH2",
            status: "ENABLED",
          };
        } else {
          counters.read++;
          assert.equal(
            body.connected_account_id,
            f.snapshot.attempt.connection_id,
          );
          assert.equal(
            body.endpoint,
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          );
          data = {
            status: 200,
            data: { emailAddress: f.snapshot.attempt.expected_mailbox_email },
          };
        }
        return new Response(JSON.stringify(data), {
          status,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
      const provider = createConnectProvider({
        configuration: cfg,
        expectedConfiguration: cfg,
        credential: { version: "fixture_v1", api_key: "synthetic_fixture_key" },
        fetchImpl,
        clock,
      });
      return createComposioConnectOrchestrator({
        store: api.store,
        provider,
        session: { readCurrent: async () => ({ ...session }) },
        clock,
        callbackOrigin: cfg.callback_origin,
      });
    }
    async function connect(f: FixtureAttempt) {
      const e = await engine(f);
      await e.start(request(f));
      await load(f);
      await e.callback({
        ...request(f),
        state: f.state,
        status: "success",
        connected_account_id: f.snapshot.attempt.connection_id,
      });
      await load(f);
      return e;
    }
    async function adopt(f: FixtureAttempt) {
      const row = value(
        `select row_to_json(x) from public.mail_account_brand_reviews x where id=(select review_id from composio_connect.attempts where id=${lit(f.snapshot.attempt.id)});`,
      );
      humanSql(
        `public.crm_command('brand_mapping_confirm',${json({ review_id: row.id, expected_review_revision: row.revision, expected_account_revision: row.expected_account_revision, acknowledge_conflict: false })},${lit(randomUUID())})`,
      );
      f.snapshot = await api.adoptBrand(command(f, "register"), row.id);
      return row.id;
    }
    const catalog = () =>
      sql(
        `select json_agg(x order by signature) from(select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','auth','brand_b1','brand_b2','composio_c1','composio_connect','s01_i02') and p.prokind='f' and p.proname not like 'composio_connect_runtime_%')x;`,
      );
    const operations = () =>
      sql(
        `select json_build_object('old',(select row_to_json(x) from public.mail_accounts x where id=${lit(fixture.old)}),'credentials',(select json_agg(x order by account_id) from public.mail_credentials x),'permissions',(select json_agg(x order by account_id,user_id) from public.mail_permissions x),'jobs',(select count(*) from public.jobs),'outbox',(select count(*) from public.outbox),'campaigns',(select count(*) from public.campaigns));`,
      );
    const marker = "set pipeline_os.connect_t009_local='isolated_test';",
      install = readFileSync(
        join(root, doc, "migrations/connect-t009.local.sql"),
        "utf8",
      ),
      rollback = readFileSync(
        join(root, doc, "migrations/connect-t009.rollback.sql"),
        "utf8",
      );
    let started = false,
      attempted = 0;
    const results: string[] = [];
    const check = async (name: string, fn: () => Promise<void> | void) => {
      attempted++;
      await t.test(name, async () => {
        await fn();
        results.push(name);
      });
    };
    const originalFetch = globalThis.fetch;
    let realFetch = 0;
    globalThis.fetch = (async () => {
      realFetch++;
      throw Error("Real provider forbidden");
    }) as typeof fetch;
    try {
      for (const name of [
        "t002-verification.json",
        "t003-verification.json",
        "t004-verification.json",
      ]) {
        for (const row of JSON.parse(
          readFileSync(join(root, doc, name), "utf8"),
        ).files)
          assert.equal(
            createHash("sha256")
              .update(readFileSync(join(root, row.path)))
              .digest("hex"),
            row.sha256,
          );
      }
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
        ),
        from = accepted.indexOf(
          "-- Source docs/specs/pipeline-os/s02/integration/migrations/a-brand-foundation.local.sql",
        ),
        to = accepted.indexOf("do $af_check$");
      assert.ok(from > 0 && to > from);
      sql(
        "begin;set local search_path=pg_catalog,public,pg_temp;" +
          accepted.slice(from, to) +
          "commit;",
      );
      for (const [actor, sid, role] of [
        [fixture.actor, fixture.sid, "superadmin"],
        [fixture.other, fixture.otherSid, "superadmin"],
        [fixture.seller, fixture.sellerSid, "seller"],
      ])
        sql(
          `insert into auth.users values(${lit(actor)},${lit(role + actor + "@example.test")});insert into public.profiles(id,name,email,role)values(${lit(actor)},'Fixture',${lit(role + actor + "@example.test")},${lit(role)});insert into auth.sessions(id,user_id)values(${lit(sid)},${lit(actor)});`,
        );
      sql(
        `insert into auth.sessions(id,user_id)values(${lit(fixture.secondSid)},${lit(fixture.actor)});insert into public.operating_brands(id,code,name,active,created_by,updated_by)values(${lit(fixture.brand)},'T009_QA','Fixture',true,${lit(fixture.actor)},${lit(fixture.actor)});insert into public.mail_accounts(id,email,organization)values(${lit(fixture.old)},'old@example.test','fixture');insert into public.mail_credentials(account_id,encrypted_refresh_token)values(${lit(fixture.old)},'fixture-token');`,
      );
      sql(
        "set pipeline_os.connect_t002_local='isolated_test';" +
          readFileSync(
            join(root, doc, "migrations/connect-t002.local.sql"),
            "utf8",
          ),
      );
      serviceSql(
        `public.composio_connect_publish(${json({ generation: 1, project_id: configuration.config.project_id, auth_config_id: configuration.config.auth_config_id, quota_project_id: configuration.config.quota_project_id, policy_reviewed: true, max_age_seconds: 3600, inactivity_seconds: 1800 })})`,
      );
      const beforeCatalog = catalog(),
        beforeOperations = operations();
      assert.throws(() => sql(install), /CONNECT_T009_LOCAL_ONLY/);
      sql(marker + install);
      serviceSql(
        `public.composio_connect_runtime_publish(${json(configuration)})`,
      );

      await check(
        "T009-TEST01: RLS and old-entry fencing deny direct reads/writes and alternate completion",
        () => {
          assert.equal(
            value(
              "select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='composio_connect_runtime' and c.relkind='r' and c.relrowsecurity;",
            ),
            5,
          );
          for (const role of ["anon", "authenticated", "service_role"]) {
            for (const table of [
              "contexts",
              "runtime",
              "phases",
              "receipts",
              "tickets",
            ]) {
              for (const text of [
                `select * from composio_connect_runtime.${table}`,
                `delete from composio_connect_runtime.${table}`,
                `insert into composio_connect_runtime.${table} default values`,
                `update composio_connect_runtime.${table} set ${table === "contexts" ? "generation=generation" : table === "runtime" ? "attempt_id=attempt_id" : table === "receipts" ? "actor_id=actor_id" : "id=id"}`,
              ])
                assert.throws(
                  () => sql(`set role ${role};${text};`),
                  /permission denied/,
                );
            }
            for (const signature of [
              "composio_connect_publish(jsonb)",
              "composio_connect_begin(jsonb,uuid)",
              "composio_connect_observe(uuid,bigint,text,jsonb)",
              "composio_connect_uncertain(uuid,bigint,text)",
              "composio_connect_command(uuid,text,bigint,text,uuid,uuid)",
            ])
              assert.equal(
                value(
                  `select has_function_privilege(${lit(role)},${lit("public." + signature)},'EXECUTE');`,
                ),
                false,
              );
          }
          assert.throws(
            () =>
              sql(
                "set role authenticated;select public.composio_connect_runtime_execute('identity','{}','{}');",
              ),
            /permission denied/,
          );
          assert.throws(
            () =>
              serviceSql(
                "public.composio_connect_runtime_execute('identity','{}','{}')",
              ),
            /CONNECT_FORBIDDEN/,
          );
          assert.throws(
            () =>
              humanSql(
                "public.composio_connect_runtime_register('register','{}','{}')",
              ),
            /CONNECT_FORBIDDEN/,
          );
        },
      );
      await check(
        "T009-TEST02: live original session, AAL2 and single-use exact tickets",
        async () => {
          const f = await begin(),
            saved = { ...session };
          for (const change of [
            { actor_id: fixture.other, session_id: fixture.otherSid },
            { session_id: fixture.secondSid },
            { aal: "aal1" },
            { expires_at_ms: Date.now() - 1000 },
          ]) {
            Object.assign(session, change);
            await assert.rejects(
              api.store.load({
                attempt_id: f.snapshot.attempt.id,
                authority: authority(f),
              }),
            );
            Object.assign(session, saved);
          }
          const payload = {
              attempt_id: f.snapshot.attempt.id,
              authority: authority(f),
            },
            ticket = JSON.parse(
              humanSql(
                `public.composio_connect_runtime_authorize('load',${json(payload)})`,
              ),
            );
          assert.throws(
            () =>
              serviceSql(
                `public.composio_connect_runtime_execute('load',${json({ ...payload, extra: true })},${json(ticket)})`,
              ),
            /CONNECT_FORBIDDEN/,
          );
          serviceSql(
            `public.composio_connect_runtime_execute('load',${json(payload)},${json(ticket)})`,
          );
          assert.throws(
            () =>
              serviceSql(
                `public.composio_connect_runtime_execute('load',${json(payload)},${json(ticket)})`,
              ),
            /CONNECT_FORBIDDEN/,
          );
          const expired = JSON.parse(
            humanSql(
              `public.composio_connect_runtime_authorize('load',${json(payload)})`,
            ),
          );
          sql(
            `update composio_connect_runtime.tickets set expires_at=clock_timestamp()-interval '1 second' where id=${lit(expired.id)};`,
          );
          assert.throws(
            () =>
              serviceSql(
                `public.composio_connect_runtime_execute('load',${json(payload)},${json(expired)})`,
              ),
            /CONNECT_FORBIDDEN/,
          );
          sql(
            `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${lit(fixture.sid)};`,
          );
          await assert.rejects(load(f));
          sql(
            `update auth.sessions set not_after=null where id=${lit(fixture.sid)};`,
          );
        },
      );
      await check(
        "T009-TEST03: configuration/head/actor drift blocks current and historical authority",
        async () => {
          const f = await begin();
          sql(
            `update public.profiles set active=false where id=${lit(fixture.actor)};`,
          );
          await assert.rejects(load(f));
          sql(
            `update public.profiles set active=true where id=${lit(fixture.actor)};`,
          );
          // Revision bump is permanent; stale attempts remain invalid. Future fixtures use the current actor revision.
          session.authorization_revision = value(
            `select mail_authorization_revision from public.profiles where id=${lit(fixture.actor)};`,
          );
          const g = await begin();
          sql(
            "update composio_connect_runtime.contexts set descriptor=jsonb_set(descriptor,'{context,credential_version}','\"fixture_rotated\"') where generation=2;",
          );
          await assert.rejects(load(g));
          sql(
            `update composio_connect_runtime.contexts set descriptor=${json(configuration)} where generation=2;`,
          );
          const h = await begin(),
            firstEngine = await connect(h);
          await adopt(h);
          await firstEngine.register(request(h));
          await load(h);
          // An actual second registration changes the head while preserving the old attempt/history.
          const newer = await begin({
            mode: "reconnect",
            email: undefined,
            organization: undefined,
            account_id: h.snapshot.attempt.account_id,
            expected_account_revision: 1,
            expected_head_revision: 1,
          });
          const secondEngine = await connect(newer);
          await secondEngine.register(request(newer));
          await assert.rejects(load(h));
        },
      );
      await check(
        "T009-TEST04: ciphertext and hashes are persisted without raw state/navigation",
        async () => {
          const f = await begin(),
            e = await engine(f);
          await e.start(request(f));
          await load(f);
          const row = value(
            `select row_to_json(x) from composio_connect_runtime.runtime x where attempt_id=${lit(f.snapshot.attempt.id)};`,
          );
          assert.doesNotMatch(JSON.stringify(row), new RegExp(f.state));
          assert.doesNotMatch(JSON.stringify(row), /https:\/\/connect/);
          assert.match(row.state_ciphertext, /^1\.fixture\./);
          assert.equal(
            (
              await e.resume({
                attempt_id: f.snapshot.attempt.id,
                browser_proof: f.proof,
              })
            ).url,
            "https://connect.composio.dev/link/ln_fixture",
          );
          await e.cancel(request(f));
        },
      );
      await check(
        "T009-TEST05: two PostgreSQL connections contend and only one start emits",
        async () => {
          const f = await begin(),
            e = await engine(f),
            input = request(f),
            before = counters.create;
          delayClaim = true;
          const first = e.start(input),
            second = e.start(input);
          let observed = false;
          for (let i = 0; i < 30 && !observed; i++) {
            observed = value(
              "select exists(select 1 from pg_stat_activity where application_name='f2-connect-t009' and wait_event_type='Lock');",
            );
            if (!observed) await pause(20);
          }
          await Promise.all([first, second]);
          assert.equal(counters.create - before, 1);
          assert.equal(observed, true);
          await load(f);
          const callback = {
            ...request(f),
            state: f.state,
            status: "success",
            connected_account_id: f.snapshot.attempt.connection_id,
          };
          const reads = counters.read;
          delayClaim = true;
          await Promise.all([e.callback(callback), e.callback(callback)]);
          assert.equal(counters.read - reads, 3);
          await load(f);
          assert.equal(f.snapshot.attempt.state, "awaiting_brand");
          await e.cancel(request(f));
        },
      );
      await check(
        "T009-TEST06: lost claim/save/register ACK never duplicates provider or candidates",
        async () => {
          const f = await begin(),
            e = await engine(f),
            input = request(f),
            before = counters.create;
          loseAck = "claim";
          await assert.rejects(e.start(input));
          assert.equal(counters.create, before);
          assert.equal((await e.start(input)).state, "link_pending");
          await load(f);
          await e.cancel(request(f));
          const g = await begin(),
            eg = await engine(g);
          loseAck = "save";
          await eg.start(request(g));
          await load(g);
          assert.equal(g.snapshot.attempt.state, "awaiting_consent");
          await eg.callback({
            ...request(g),
            state: g.state,
            status: "success",
            connected_account_id: g.snapshot.attempt.connection_id,
          });
          await load(g);
          await adopt(g);
          const reg = request(g);
          loseAck = "register";
          await assert.rejects(eg.register(reg));
          assert.equal((await eg.register(reg)).state, "completed");
        },
      );
      await check(
        "T009-TEST07: cancel beats late creation; uncertain and expiry never reopen blindly",
        async () => {
          const f = await begin(),
            hold = gate<unknown>(),
            count = { create: 0 };
          const e = createComposioConnectOrchestrator({
            store: api.store,
            session: { readCurrent: async () => ({ ...session }) },
            clock,
            callbackOrigin: configuration.callback_origin,
            provider: {
              createLink: async () => {
                count.create++;
                return hold.promise;
              },
              readIdentity: async () => {
                throw Error("unexpected");
              },
            },
          });
          const pending = e.start(request(f)),
            failure = assert.rejects(pending);
          await until(() => count.create === 1);
          await load(f);
          await e.cancel(request(f));
          hold.resolve({
            connected_account_id: "ca_late_fixture",
            url: "https://connect.composio.dev/link/ln_fixture",
            expires_at_ms: Date.now() + 600000,
          });
          await failure;
          assert.equal((await load(f)).attempt.state, "cancelled");
          assert.equal(f.snapshot.attempt.cleanup_required, true);
          const g = await begin(),
            c = command(g),
            raw = (await api.store.claimPhase({ ...c, phase: "link" })) as {
              lease: ConnectLease;
            };
          await api.store.markUncertain({
            attempt_id: g.snapshot.attempt.id,
            lease: raw.lease,
            reason: "provider_unknown",
          });
          sql(
            `update composio_connect.attempts set deadline=created_at+interval '1 millisecond' where id=${lit(g.snapshot.attempt.id)};`,
          );
          await api.store.releaseClaim({ command: c, lease: raw.lease });
          assert.equal((await load(g)).attempt.state, "uncertain");
          await assert.rejects(begin({ email: g.intent.email }));
          const expired = await begin();
          const reserved = expired.snapshot.attempt.account_id;
          sql(
            `update composio_connect.attempts set deadline=created_at+interval '1 millisecond' where id=${lit(expired.snapshot.attempt.id)};`,
          );
          const originalSid = session.session_id;
          session.session_id = fixture.secondSid;
          try {
            const replacement = await begin({ email: expired.intent.email });
            assert.equal(replacement.snapshot.attempt.account_id, reserved);
            assert.notEqual(
              replacement.snapshot.attempt.id,
              expired.snapshot.attempt.id,
            );
          } finally {
            session.session_id = originalSid;
          }
        },
      );
      await check(
        "T009-TEST08: identity mismatch cannot materialize and correct mailbox stays inactive",
        async () => {
          const f = await begin(),
            e = await engine(f);
          await e.start(request(f));
          await load(f);
          const c = command(f, "callback"),
            claimed = (await api.store.claimPhase({
              ...c,
              phase: "identity",
            })) as { lease: ConnectLease };
          await assert.rejects(
            api.store.finishIdentity({
              command: c,
              lease: claimed.lease,
              identity: {
                connected_account_id: f.snapshot.attempt.connection_id!,
                project_id: configuration.config.project_id,
                auth_config_id: configuration.config.auth_config_id,
                owner_id: f.snapshot.attempt.config.owner_id,
                primary_email: "wrong@example.test",
                toolkit: "gmail",
                active: true,
              },
            }),
            reject("CONNECT_IDENTITY_MISMATCH"),
          );
          assert.equal(
            value(
              `select count(*)::int from public.mail_accounts where id=${lit(f.snapshot.attempt.account_id)};`,
            ),
            0,
          );
          await api.store.reject({
            command: c,
            lease: claimed.lease,
            reason: "identity_mismatch",
          });
          assert.equal((await load(f)).attempt.state, "rejected");
          const g = await begin();
          await connect(g);
          assert.deepEqual(
            value(
              `select json_build_array(status,live_enabled,sync_enabled) from public.mail_accounts where id=${lit(g.snapshot.attempt.account_id)};`,
            ),
            ["disconnected", false, false],
          );
        },
      );
      await check(
        "T009-TEST09: explicit brand adoption and registration preserve identity and create candidate only",
        async () => {
          const f = await begin(),
            e = await connect(f);
          assert.equal(f.snapshot.attempt.state, "awaiting_brand");
          await assert.rejects(e.register(request(f)));
          const account = f.snapshot.attempt.account_id;
          const review = await adopt(f);
          assert.ok(review);
          const input = request(f),
            done = await e.register(input);
          assert.equal(done.state, "completed");
          assert.equal(done.account_id, account);
          assert.equal((await e.register(input)).binding_id, done.binding_id);
          assert.equal(
            value(
              `select status from public.mail_provider_bindings where id=${lit(done.binding_id)};`,
            ),
            "candidate",
          );
          const recon = await begin({
            mode: "reconnect",
            email: undefined,
            organization: undefined,
            account_id: account,
            expected_account_revision: 1,
            expected_head_revision: 1,
          });
          const re = await connect(recon);
          assert.equal(recon.snapshot.attempt.state, "ready_to_register");
          const second = await re.register(request(recon));
          assert.equal(second.account_id, account);
          assert.notEqual(second.binding_id, done.binding_id);
          assert.equal(
            value(
              `select status from public.mail_provider_bindings where id=${lit(done.binding_id)};`,
            ),
            "superseded",
          );
          const occupied = value(
            `select connected_account_id from public.mail_provider_bindings where id=${lit(second.binding_id)};`,
          );
          const blocked = await begin(),
            be = await engine(blocked, occupied);
          await be.start(request(blocked));
          await load(blocked);
          await be.callback({
            ...request(blocked),
            state: blocked.state,
            status: "success",
            connected_account_id: blocked.snapshot.attempt.connection_id,
          });
          await load(blocked);
          await adopt(blocked);
          await assert.rejects(be.register(request(blocked)));
          assert.equal(
            value(
              `select status from public.mail_provider_bindings where id=${lit(second.binding_id)};`,
            ),
            "candidate",
          );
          assert.equal(
            value(
              `select count(*)::int from public.mail_provider_bindings where account_id=${lit(blocked.snapshot.attempt.account_id)};`,
            ),
            0,
          );
        },
      );
      await check(
        "T009-TEST10: composed motor/store/REST parsers use exactly one creation and three fake reads",
        async () => {
          const f = await begin(),
            create = counters.create,
            reads = counters.read,
            e = await connect(f);
          await adopt(f);
          const input = request(f);
          const done = await e.register(input);
          assert.equal(done.composio_enabled, false);
          assert.equal(counters.create - create, 1);
          assert.equal(counters.read - reads, 3);
          assert.equal(realFetch, 0);
        },
      );
      await check(
        "T009-TEST11: B1 revision race invalidates finish; protected catalog definitions and operations remain intact",
        async () => {
          const f = await begin(),
            e = await engine(f);
          await e.start(request(f));
          await load(f);
          // A native writer commits a brand change while the next phase waits. The subsequent CAS must reject.
          const writer = sqlAsync(
            `begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify(claims()))};select public.crm_command('brand_update',${json({ brand_id: fixture.brand, name: "Fixture revised", expected_revision: 1 })},${lit(randomUUID())});select pg_sleep(0.3);commit;`,
          );
          await pause(50);
          await assert.rejects(
            e.callback({
              ...request(f),
              state: f.state,
              status: "success",
              connected_account_id: f.snapshot.attempt.connection_id,
            }),
          );
          await writer;
          assert.equal(
            value(
              `select count(*)::int from public.mail_accounts where id=${lit(f.snapshot.attempt.account_id)};`,
            ),
            0,
          );
          assert.equal(operations(), beforeOperations);
        },
      );
      await check(
        "T009-TEST12: closed-fixture reversal restores exact T-002 ACL/catalog and preserves business",
        () => {
          assert.throws(
            () => sql(marker + rollback),
            /CONNECT_T009_OPEN_ATTEMPTS/,
          );
          // Explicit owner-only cleanup of known synthetic fixtures, not an application reconciliation command.
          assert.equal(realFetch, 0);
          sql(
            "begin;update composio_connect_runtime.runtime set state='cancelled',phase_id=null,state_ciphertext=null,navigation_ciphertext=null,navigation_expires_ms=null where state not in('completed','cancelled','expired','rejected');update composio_connect.attempts a set state='cancelled' from composio_connect_runtime.runtime r where r.attempt_id=a.id and r.state='cancelled';commit;",
          );
          const business = sql("select count(*) from public.mail_accounts;"),
            bindings = sql(
              "select count(*) from public.mail_provider_bindings;",
            );
          sql(marker + rollback);
          assert.equal(catalog(), beforeCatalog);
          assert.equal(operations(), beforeOperations);
          assert.equal(
            sql("select count(*) from public.mail_accounts;"),
            business,
          );
          assert.equal(
            sql("select count(*) from public.mail_provider_bindings;"),
            bindings,
          );
        },
      );
      assert.equal(
        results.length,
        attempted,
        "Do not publish success after a failed native subtest",
      );
      writeFileSync(
        join(runRoot, "result.json"),
        JSON.stringify(
          {
            checks: results,
            passed: results.length,
            providerRequests: 0,
            realFetch,
            postgres: "15.19",
            catalogRestored: catalog() === beforeCatalog,
            operationsPreserved: operations() === beforeOperations,
          },
          null,
          2,
        ) + "\n",
      );
      t.diagnostic(
        `Own disposable cluster ${suffix}; ${results.length} native checks, real provider requests0`,
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (started || existsSync(join(cluster, "postmaster.pid")))
        bin("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "stop"]);
      assert.equal(realFetch, 0);
    }
  },
);
