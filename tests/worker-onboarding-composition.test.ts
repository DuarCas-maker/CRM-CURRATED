import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { c1Fixture } from "./fixtures/pipeline-os-s02-composio-bindings";

const connectPath =
  "docs/specs/pipeline-os/s02/connect-gmail/migrations/connect-t002.local.sql";
const wcPath =
  "docs/specs/pipeline-os/s02/worker-control/migrations/worker-control.local.sql";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const config = {
  generation: 1,
  project_id: "pr_connect_fixture",
  auth_config_id: "ac_connect_fixture",
  quota_project_id: "google-connect-fixture",
  policy_reviewed: true,
  max_age_seconds: 3600,
  inactivity_seconds: 1800,
};

// Only the native host guard is adapted, in memory. The checked-in SQL retains it.
function memoryConnect(sql: string) {
  const marker = "create schema composio_connect;";
  assert.equal(sql.split(marker).length, 2);
  const guard = sql.slice(0, sql.indexOf(marker));
  for (const expected of [
    "CONNECT_T002_LOCAL_ONLY",
    "CONNECT_T002_BASE_REQUIRED",
    "f2_connect_owner",
    "inet_server_addr()",
    "^f2_connect_[a-f0-9]{12}$",
  ])
    assert(guard.includes(expected));
  assert.match(sql, /commit;\s*$/);
  return `do $$begin
    if current_setting('pipeline_os.connect_wc_composition',true) is distinct from 'in_memory_test'
      or to_regnamespace('composio_c1') is null or to_regclass('auth.sessions') is null
    then raise exception 'CW_FIXTURE_REQUIRED';end if;end$$;
    ${sql.slice(sql.indexOf(marker)).replace(/commit;\s*$/, "")}`;
}

for (const order of ["connect-first", "worker-first"] as const) {
  test(`CW composition (${order}): inactive onboarding and isolated pilot`, async (t) => {
    const f = await c1Fixture(),
      { db, users, brandA, accounts, queued } = f;
    const owner = () => db.exec("reset role;set request.jwt.claims='{}'");
    const service = async () => {
      await owner();
      await db.exec("set role service_role");
    };
    const scalar = async <T>(sql: string, args: unknown[] = []) =>
      (await db.query<{ v: T }>(sql, args)).rows[0].v;
    const session = randomUUID();
    const human = async () => {
      await owner();
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          sub: users.admin,
          session_id: session,
          aal: "aal2",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ]);
      await db.exec("set role authenticated");
    };
    const publish = (generation: number) =>
      scalar("select composio_connect_publish($1) v", [
        { ...config, generation },
      ]);
    try {
      await owner();
      await db.exec(
        "create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),refreshed_at timestamptz default now(),not_after timestamptz)",
      );
      await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
        session,
        users.admin,
      ]);
      const baseline = await db.query<{
        oid: number;
        definition: string;
        acl: string | null;
      }>(
        "select p.oid,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','brand_b2','composio_c1') and p.prokind='f' order by p.oid",
      );
      const beforeCounts = await scalar<Record<string, number>>(
        "select jsonb_build_object('accounts',(select count(*) from mail_accounts),'credentials',(select count(*) from mail_credentials),'outbox',(select count(*) from outbox),'jobs',(select count(*) from jobs)) v",
      );
      const original = await readFile(connectPath, "utf8"),
        connect = memoryConnect(original),
        wc = await readFile(wcPath, "utf8");
      await db.exec(
        "set pipeline_os.connect_wc_composition='in_memory_test';set pipeline_os.worker_control_local='in_memory_test'",
      );
      const install = async () => {
        for (const sql of order === "connect-first"
          ? [connect, wc]
          : [wc, connect])
          await db.exec(sql);
      };
      await t.test(
        "both additive schemas roll back together without touching the original queue",
        async () => {
          await db.exec("begin");
          await install();
          await db.exec("rollback");
          assert.equal(
            await scalar("select to_regnamespace('composio_connect') v"),
            null,
          );
          assert.equal(
            await scalar("select to_regnamespace('worker_pilot') v"),
            null,
          );
          assert.equal(
            await scalar("select status v from outbox where id=$1", [queued]),
            "queued",
          );
        },
      );
      await install();
      await t.test(
        "existing functions and ACL preserved; private tables stay inaccessible",
        async () => {
          const after = await db.query(
            "select p.oid,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p where p.oid=any($1::oid[]) order by p.oid",
            [baseline.rows.map((r) => r.oid)],
          );
          assert.deepEqual(after.rows, baseline.rows);
          for (const table of [
            "composio_connect.attempts",
            "worker_pilot.trials",
          ])
            for (const role of ["anon", "authenticated", "service_role"])
              for (const permission of ["select", "insert", "update", "delete"])
                assert.equal(
                  await scalar("select has_table_privilege($1,$2,$3) v", [
                    role,
                    table,
                    permission,
                  ]),
                  false,
                );
          assert.equal(
            await scalar(
              "select has_function_privilege('authenticated','public.worker_pilot_acquire(uuid,text)','execute') v",
            ),
            false,
          );
          assert.equal(
            await scalar(
              "select has_function_privilege('authenticated','public.composio_connect_publish(jsonb)','execute') v",
            ),
            false,
          );
        },
      );
      await service();
      await publish(1);
      await t.test(
        "configuration rejects an older generation interleaved after its initial check",
        async () => {
          // Deterministic check/write interleaving, NOT physical multi-connection concurrency.
          await owner();
          const definition = await scalar<string>(
            "select pg_get_functiondef('public.composio_connect_publish(jsonb)'::regprocedure) v",
          );
          const insertion =
            " insert into composio_connect.configuration values";
          assert.equal(definition.split(insertion).length, 2);
          // Fixture-only scheduling point before the INSERT statement. A trigger on
          // that INSERT would instead cause PostgreSQL's same-command cardinality error.
          await db.exec(
            definition.replace(
              insertion,
              ` if (p->>'generation')::bigint=2 then
          perform public.composio_connect_publish(p || '{"generation":3}'::jsonb);
        end if;\n${insertion}`,
            ),
          );
          await service();
          try {
            await assert.rejects(publish(2), /CONNECT_STALE/);
          } finally {
            await owner();
            await db.exec(definition);
          }
          // The rejected statement also rolls back the nested fixture write.
          assert.equal(
            await scalar(
              "select generation::int v from composio_connect.configuration",
            ),
            1,
          );
        },
      );
      const proof = randomUUID(),
        capability = randomUUID();
      const input = {
        mode: "new",
        email: `${randomUUID()}@example.test`,
        organization: "fixture",
        brand_id: brandA.brand_id,
        expected_brand_revision: 1,
        expected_account_revision: 0,
        expected_head_revision: 0,
        expected_config_generation: 1,
        state_hash: sha(randomUUID()),
        browser_hash: sha(proof),
        capability_hash: sha(capability),
      };
      let attempt: {
        id: string;
        revision: number;
        state: string;
        review_id?: string;
      };
      await human();
      attempt = await scalar("select composio_connect_begin($1,$2) v", [
        input,
        randomUUID(),
      ]);
      await t.test(
        "identity observation and materialization do not activate or schedule mail",
        async () => {
          await owner();
          const stored = await scalar<Record<string, string>>(
            "select to_jsonb(a) v from composio_connect.attempts a where id=$1",
            [attempt.id],
          );
          await service();
          attempt = await scalar(
            "select composio_connect_observe($1,$2,$3,$4) v",
            [
              attempt.id,
              attempt.revision,
              capability,
              {
                project_id: stored.project_id,
                auth_config_id: stored.auth_config_id,
                owner_id: stored.owner_id,
                connection_id: "ca_" + randomUUID().replaceAll("-", ""),
                primary_email: input.email,
                active: true,
                toolkit: "gmail",
              },
            ],
          );
          await human();
          attempt = await scalar(
            "select composio_connect_command($1,'materialize',$2,$3,$4) v",
            [attempt.id, attempt.revision, proof, randomUUID()],
          );
          assert.equal(attempt.state, "awaiting_brand");
          await owner();
          const account = await scalar<Record<string, unknown>>(
            "select jsonb_build_object('status',status,'live',live_enabled,'sync',sync_enabled,'credentials',(select count(*) from mail_credentials c where c.account_id=m.id),'permissions',(select count(*) from mail_permissions p where p.account_id=m.id)) v from mail_accounts m where email=$1",
            [input.email],
          );
          assert.deepEqual(account, {
            status: "disconnected",
            live: false,
            sync: false,
            credentials: 0,
            permissions: 0,
          });
          assert.deepEqual(
            await scalar(
              "select jsonb_build_object('accounts',(select count(*) from mail_accounts),'credentials',(select count(*) from mail_credentials),'outbox',(select count(*) from outbox),'jobs',(select count(*) from jobs)) v",
            ),
            { ...beforeCounts, accounts: Number(beforeCounts.accounts) + 1 },
          );
        },
      );
      await t.test(
        "a revoked onboarding session cannot complete; WC still claims only its own message",
        async () => {
          await owner();
          await db.query("delete from auth.sessions where id=$1", [session]);
          await human();
          await assert.rejects(
            scalar("select composio_connect_command($1,'cancel',$2,$3,$4) v", [
              attempt.id,
              attempt.revision,
              proof,
              randomUUID(),
            ]),
            /CONNECT_FORBIDDEN/,
          );
          await service();
          const pilot = await scalar<string>(
            "select worker_pilot_prepare($1,$2,'client@fixture.test','gmail_oauth',clock_timestamp()+interval '10 minutes',2,1,0) v",
            [accounts[0], queued],
          );
          const key = "e".repeat(64);
          assert.equal(
            await scalar("select worker_pilot_acquire($1,$2) v", [pilot, key]),
            true,
          );
          assert.deepEqual(
            (
              await db.query<{ id: string }>(
                "select id from worker_pilot_claim($1,$2)",
                [pilot, key],
              )
            ).rows.map((r) => r.id),
            [queued],
          );
          await db.query("select worker_pilot_close($1,$2)", [pilot, key]);
          await owner();
          assert.equal(
            await scalar(
              "select state v from composio_connect.attempts where id=$1",
              [attempt.id],
            ),
            "awaiting_brand",
          );
        },
      );
      await t.test(
        "committed config rotation is monotone and duplicate generations are stale",
        async () => {
          await service();
          await publish(3);
          await assert.rejects(publish(2), /CONNECT_STALE/);
          await assert.rejects(publish(3), /CONNECT_STALE/);
          await owner();
          assert.equal(
            await scalar(
              "select generation::int v from composio_connect.configuration",
            ),
            3,
          );
        },
      );
    } finally {
      await db.close();
    }
  });
}
