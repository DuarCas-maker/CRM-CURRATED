// New release test derived from the public F1 native fixture setup; frozen original remains unchanged.
import {
  connectProviderConfigSchema,
  type ConnectProviderConfiguration,
} from "../src/lib/server/mail-accounts/composio-connect/config";
import { mailQuotaPolicySchema } from "../src/lib/mail-quota-policy";
import { reserveConnectProfileQuota } from "../src/lib/server/mail-accounts/composio-connect/profile-quota";
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
  "Connect v2 native PG15: pre-account quota, candidate, concurrency and recovery",
  {
    timeout: 180000,
    skip: process.env.PIPELINE_OS_CONNECT_V2_NATIVE !== "1",
  },
  async (t) => {
    const root = realpathSync(process.cwd()),
      doc = "docs/specs/pipeline-os/s02/connect-gmail",
      runtime = resolve(root, ".local/f2-connect-t002");
    const pg =
      process.env.PIPELINE_OS_CONNECT_PG_BIN ??
      join(runtime, "toolchains/postgresql-15.19/pgsql/bin");
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
    let configuration: ConnectProviderConfiguration = {
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
    const configFor = (config: ConnectProviderConfiguration["config"]) => ({
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
          expected_config_generation: configuration.config.generation,
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
    let profilePause: (() => Promise<void>) | undefined;
    let profileEmissions = 0;
    async function engine(f: FixtureAttempt, connectionOverride?: string) {
      const cfg = await api.bindConfiguration({
        attempt_id: f.snapshot.attempt.id,
        authority: authority(f),
      });
      const fetchImpl = (async (url, init) => {
        counters.requests++;
        const path = new URL(String(url)).pathname,
          body = init?.body ? JSON.parse(String(init.body)) : null;
        if (
          "contract_version" in cfg.context &&
          path.endsWith("/tools/execute/proxy")
        ) {
          await profilePause?.();
          const snapshot = await api.store.load({
            attempt_id: f.intent.attempt_id,
            authority: authority(f),
          });
          const a = (snapshot as ConnectSnapshot).attempt;
          const lease = await reserveConnectProfileQuota({
            attempt: a.id,
            phase: a.phase!.id,
            authority: authority(f),
            policy: cfg.context.policy,
            deadline: a.deadline_ms,
            now: Date.now,
            authorize: async () => {
              await api.store.load({
                attempt_id: a.id,
                authority: authority(f),
              });
            },
            rpc: async (name, input) => {
              try {
                if (
                  ![
                    "composio_connect_profile_reserve",
                    "composio_connect_profile_admit",
                  ].includes(name)
                )
                  throw Error("RPC denied");
                return {
                  error: null,
                  data: value(
                    `begin;set local role service_role;select public.${name}(${lit(input.attempt)},${lit(input.phase)},${json(input.authority)});commit;`,
                  ),
                };
              } catch {
                return {
                  data: null,
                  error: { message: "CONNECT_UNAVAILABLE" },
                };
              }
            },
          });
          await lease.emit(async () => {
            profileEmissions++;
          });
        }
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
      // This new release uses the reviewed 21198cf public snapshot and delivery-manifest hashes.
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

      const transportRoot = join(
        root,
        "docs/specs/pipeline-os/s02/transport-selection/migrations",
      );
      for (const [name, marker] of [
        ["r06.local.sql", "create schema mail_runtime;"],
        ["r06-i02.local.sql", "alter table mail_runtime.attempts"],
        ["r06-i03.local.sql", "create table mail_runtime.sync_cycles"],
      ]) {
        const source = readFileSync(join(transportRoot, name), "utf8");
        const at = source.indexOf(marker);
        assert(at > 0);
        sql(source.slice(at));
      }
      const quotaRoot = join(
        root,
        "docs/specs/pipeline-os/s02/quota-policy-reuse/migrations",
      );
      const quotaSource = readFileSync(
        join(quotaRoot, "quota-policy-v2.local.sql"),
        "utf8",
      );
      sql(quotaSource.slice(quotaSource.indexOf("create schema mail_quota;")));
      const quotaAdmission = readFileSync(
        join(quotaRoot, "quota-i03.local.sql"),
        "utf8",
      );
      sql(
        quotaAdmission.slice(
          quotaAdmission.indexOf("alter table mail_quota.reservations"),
        ),
      );
      const delta = readFileSync(
        join(root, doc, "production-completion/connect-v2.delta.sql"),
        "utf8",
      );
      const reverse = readFileSync(
        join(root, doc, "production-completion/connect-v2.rollback.sql"),
        "utf8",
      );
      const oldCatalog = catalog();
      await check(
        "USE-N01: native additive installation and unused reversal restore functions and nullability",
        () => {
          sql(delta);
          sql(reverse);
          assert.equal(catalog(), oldCatalog);
          assert.equal(
            value(
              "select attnotnull from pg_attribute where attrelid='composio_connect.configuration'::regclass and attname='quota_project_id'",
            ),
            true,
          );
          sql(delta);
        },
      );
      const policy = {
        contract_version: 2,
        policy_id: randomUUID(),
        generation: 1,
        mode: "crm_shared_conservative",
        state: "enabled",
        limits: {
          group_units_per_minute: 4500,
          account_units_per_minute: 4500,
          group_units_per_window: 75000000,
          window_seconds: 86460,
        },
        google_project: { provenance: "unknown", project_id: null },
      };
      humanSql(
        `public.mail_quota_publish(${json(policy)},0,true,${lit(randomUUID())})`,
      );
      configuration = {
        ...configuration,
        config: {
          ...configuration.config,
          generation: 3,
          quota_project_id: null,
        },
        context: {
          contract_version: 2,
          composio_project_id: configuration.context.composio_project_id,
          credential_version: configuration.context.credential_version,
          auth_config_revision: configuration.context.auth_config_revision,
          provenance_reference: "native-v2-fixture",
          project_provenance: "server_reviewed",
          policy: mailQuotaPolicySchema.parse(policy),
        },
      };
      serviceSql(
        `public.composio_connect_v2_publish(${json(configuration)},0,0,2)`,
      );
      await check(
        "USE-N02: native new mailbox profile has one reservation/admission, v2 candidate and no transport",
        async () => {
          const f = await begin();
          const e = await connect(f);
          assert.equal(f.snapshot.attempt.state, "awaiting_brand");
          assert.equal(
            value(
              `select count(*)::int from composio_connect.profile_reservations where attempt_id=${lit(f.intent.attempt_id)} and admitted_at is not null`,
            ),
            1,
          );
          await adopt(f);
          await e.register(request(f));
          await load(f);
          assert.equal(f.snapshot.attempt.state, "completed");
          const b = value(
            `select json_build_object('version',quota_contract_version,'google',google_quota_project_id,'status',status,'policy',quota_policy_id) from public.mail_provider_bindings where id=${lit(f.snapshot.attempt.binding_id)}`,
          );
          assert.deepEqual(b, {
            version: 2,
            google: null,
            status: "candidate",
            policy: policy.policy_id,
          });
          assert.equal(
            value(
              `select count(*)::int from public.mail_permissions where account_id=${lit(f.snapshot.attempt.account_id)}`,
            ),
            0,
          );
          assert.equal(operations(), beforeOperations);
        },
      );
      await check(
        "USE-N03: native API roles cannot read private ledger or call service-only RPCs",
        () => {
          for (const role of ["anon", "authenticated", "service_role"])
            assert.throws(
              () =>
                sql(
                  `set role ${role};select * from composio_connect.profile_reservations`,
                ),
              /permission denied/,
            );
          for (const role of ["anon", "authenticated"])
            assert.throws(
              () =>
                sql(
                  `set role ${role};select public.composio_connect_profile_reserve(${lit(randomUUID())},${lit(randomUUID())},'{}')`,
                ),
              /permission denied/,
            );
        },
      );
      await check(
        "USE-N04: native concurrent reservations debit once and concurrent admissions permit exactly one",
        async () => {
          const f = await begin(),
            e = await engine(f);
          await e.start(request(f));
          await load(f);
          const entered = gate<void>(),
            release = gate<void>();
          profilePause = async () => {
            entered.resolve();
            await release.promise;
          };
          const pending = e.callback({
            ...request(f),
            state: f.state,
            status: "success",
            connected_account_id: f.snapshot.attempt.connection_id,
          });
          await entered.promise;
          await load(f);
          const phase = f.snapshot.attempt.phase!.id,
            params = `${lit(f.intent.attempt_id)},${lit(phase)},${json(authority(f))}`;
          const used = value(
            "select coalesce(sum(units),0)::int from mail_quota.usage",
          );
          const reserve = `begin;set local role service_role;select public.composio_connect_profile_reserve(${params});select pg_sleep(0.1);commit;`;
          await Promise.all([sqlAsync(reserve), sqlAsync(reserve)]);
          assert.equal(
            value(
              `select count(*)::int from composio_connect.profile_reservations where phase_id=${lit(phase)}`,
            ),
            1,
          );
          assert.equal(
            value("select coalesce(sum(units),0)::int from mail_quota.usage"),
            used + 1,
          );
          const admit = `begin;set local role service_role;select public.composio_connect_profile_admit(${params});commit;`;
          const results = await Promise.all([sqlAsync(admit), sqlAsync(admit)]);
          assert.deepEqual(results.map((v) => v.trim()).sort(), ["f", "t"]);
          const emittedBefore = profileEmissions;
          profilePause = undefined;
          release.resolve();
          await assert.rejects(
            pending,
            (e: unknown) => e instanceof ConnectError,
          );
          assert.equal(profileEmissions, emittedBefore);
        },
      );
      await check(
        "USE-N05: native foreign authority and policy closure cannot consume or emit profile",
        async () => {
          const f = await begin(),
            e = await engine(f);
          await e.start(request(f));
          await load(f);
          const entered = gate<void>(),
            release = gate<void>();
          profilePause = async () => {
            entered.resolve();
            await release.promise;
          };
          const pending = e.callback({
            ...request(f),
            state: f.state,
            status: "success",
            connected_account_id: f.snapshot.attempt.connection_id,
          });
          await entered.promise;
          await load(f);
          assert.throws(
            () =>
              serviceSql(
                `public.composio_connect_profile_reserve(${lit(f.intent.attempt_id)},${lit(f.snapshot.attempt.phase!.id)},${json({ ...authority(f), actor_id: fixture.other })})`,
              ),
            /CONNECT_FORBIDDEN/,
          );
          sql("update mail_quota.head set closed=true where id=1");
          const emittedBefore = profileEmissions;
          profilePause = undefined;
          release.resolve();
          await assert.rejects(
            pending,
            (e: unknown) => e instanceof ConnectError,
          );
          assert.equal(profileEmissions, emittedBefore);
          sql("update mail_quota.head set closed=false where id=1");
        },
      );
      await check(
        "USE-N06: native actor deactivation before profile prevents emission",
        async () => {
          const f = await begin(),
            e = await engine(f);
          await e.start(request(f));
          await load(f);
          const entered = gate<void>(),
            release = gate<void>();
          profilePause = async () => {
            entered.resolve();
            await release.promise;
          };
          const pending = e.callback({
            ...request(f),
            state: f.state,
            status: "success",
            connected_account_id: f.snapshot.attempt.connection_id,
          });
          await entered.promise;
          sql(
            `update public.profiles set active=false where id=${lit(fixture.actor)}`,
          );
          const emittedBefore = profileEmissions;
          profilePause = undefined;
          release.resolve();
          await assert.rejects(
            pending,
            (e: unknown) => e instanceof ConnectError,
          );
          assert.equal(profileEmissions, emittedBefore);
        },
      );
      await check(
        "USE-N07: used v2 reversal stops before dropping evidence and legacy account remains unchanged",
        () => {
          assert.throws(
            () => sql(reverse),
            /CONNECT_V2_IN_USE_CLOSE_FLAG_AND_PRESERVE/,
          );
          assert.equal(
            value(
              "select to_regclass('composio_connect.profile_reservations') is not null",
            ),
            true,
          );
          assert.equal(operations(), beforeOperations);
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
            candidateInstalled: true,
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
