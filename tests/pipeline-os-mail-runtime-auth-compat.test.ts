import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { abcFinalFixture } from "./fixtures/pipeline-os-abc-final";
import {
  runtimeReleaseRoot as root,
  runtimeMigration,
} from "../scripts/pipeline-os/mail-runtime-release";

for (const type of [
  "timestamp without time zone",
  "timestamp with time zone",
]) {
  test(`MR-AUTH: Auth refreshed_at ${type}`, async (t) => {
    const f = await abcFinalFixture(true),
      sid = randomUUID();
    const scalar = async <T>(sql: string, values: unknown[] = []) =>
      (await f.db.query<{ v: T }>(sql, values)).rows[0].v;
    const run = async (sql: string) => {
      await f.admin();
      try {
        return await f.db.exec(sql);
      } catch (e) {
        await f.db.exec("rollback");
        throw e;
      }
    };
    const report = (rows: Awaited<ReturnType<typeof run>>, key: string) =>
      (rows.flatMap((r) => r.rows) as Record<string, any>[]).find(
        (r) => r[key],
      )?.[key];
    const refreshed = (seconds: number) =>
      type === "timestamp without time zone"
        ? `timezone('UTC',clock_timestamp())-interval '${seconds} seconds'`
        : `clock_timestamp()-interval '${seconds} seconds'`;
    const session = async (
      created = 600,
      refresh: number | null = 30,
      notAfter = "clock_timestamp()+interval '10 minutes'",
    ) => {
      await f.admin();
      await f.db.query(
        `insert into auth.sessions(id,user_id,created_at,refreshed_at,not_after) values($1,$2,clock_timestamp()-interval '${created} seconds',${refresh === null ? "null" : refreshed(refresh)},${notAfter}) on conflict(id) do update set created_at=excluded.created_at,refreshed_at=excluded.refreshed_at,not_after=excluded.not_after`,
        [sid, f.users.admin],
      );
    };
    const live = () =>
      scalar<bigint>(
        "select composio_connect.live_actor($1,composio_connect.digest($2::text)) v",
        [f.users.admin, sid],
      );
    const limit = () =>
      scalar<number>(
        "select extract(epoch from (composio_connect_runtime.session_limit($1,composio_connect.digest($2::text))-clock_timestamp()))::float8 v",
        [f.users.admin, sid],
      );
    const zones = ["UTC", "America/Bogota", "Asia/Tokyo"];
    try {
      await f.admin();
      await f.db.exec(
        await readFile(
          "docs/specs/pipeline-os/s02/release/abc-final/049_integrate_mail_identity_brands_and_bindings.sql",
          "utf8",
        ),
      );
      await f.db.exec(
        `create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz,refreshed_at ${type},not_after timestamptz)`,
      );
      const [pre, install, post] = await Promise.all(
        ["preflight.sql", runtimeMigration, "postflight.sql"].map((p) =>
          readFile(root + p, "utf8"),
        ),
      );
      await t.test(
        "reported shape reproduced, corrected preflight accepts metadata without changing Auth",
        async () => {
          const old = await scalar<boolean>(
            "select count(*)=5 v from pg_attribute a where a.attrelid='auth.sessions'::regclass and not a.attisdropped and a.attnum>0 and ((a.attname in('id','user_id') and a.atttypid='uuid'::regtype) or(a.attname in('created_at','refreshed_at','not_after') and a.atttypid='timestamptz'::regtype))",
          );
          assert.equal(old, type === "timestamp with time zone");
          const r = report(
            await run(pre),
            "pipeline_os_mail_runtime_preflight",
          );
          assert.equal(r.catalogOk, true);
          assert.equal(r.queueOk, true);
          assert.equal(
            await scalar<string>(
              "select format_type(atttypid,atttypmod) v from pg_attribute where attrelid='auth.sessions'::regclass and attname='refreshed_at'",
            ),
            type,
          );
        },
      );
      await t.test(
        "text refreshed_at or naive created_at remains forbidden",
        async () => {
          for (const ddl of [
            "alter table auth.sessions alter column refreshed_at type text",
            "alter table auth.sessions alter column created_at type timestamp without time zone",
          ]) {
            await f.admin();
            await f.db.exec("begin");
            await f.db.exec(ddl);
            await assert.rejects(
              f.db.exec(
                pre.replace(
                  "begin isolation level repeatable read read only;",
                  "",
                ),
              ),
              /MR_CONTEXT_MISMATCH/,
            );
            await f.db.exec("rollback");
          }
        },
      );
      await t.test(
        "exact050 commit/postflight succeeds; Auth column type retained",
        async () => {
          assert.equal(
            report(await run(install), "pipeline_os_mail_runtime_application")
              .targetsOk,
            true,
          );
          assert.equal(
            report(await run(post), "pipeline_os_mail_runtime_postflight")
              .targetsOk,
            true,
          );
          assert.equal(
            await scalar<string>(
              "select format_type(atttypid,atttypmod) v from pg_attribute where attrelid='auth.sessions'::regclass and attname='refreshed_at'",
            ),
            type,
          );
          await f.admin();
          await f.db.exec(
            "insert into composio_connect.configuration(id,generation,project_id,auth_config_id,quota_project_id,policy_reviewed,max_age_seconds,inactivity_seconds) values(1,1,'fixture','ac_fixture','fixture',true,3600,120)",
          );
        },
      );
      await t.test(
        "fresh/null refresh deadlines are invariant across UTC, Bogota and Tokyo",
        async () => {
          for (const zone of zones) {
            await session();
            await f.db.query("select set_config('TimeZone',$1,false)", [zone]);
            await live();
            let seconds = await limit();
            assert(seconds > 80 && seconds <= 91, zone + " refresh deadline");
            await session(30, null, "null");
            await f.db.query("select set_config('TimeZone',$1,false)", [zone]);
            await live();
            seconds = await limit();
            assert(
              seconds > 80 && seconds <= 91,
              zone + " created_at fallback",
            );
          }
        },
      );
      await t.test(
        "inactivity, max age, not_after, revocation and inactive actor remain blocked",
        async () => {
          for (const zone of zones) {
            for (const [created, refresh, notAfter] of [
              [600, 180, "null"],
              [7200, 0, "null"],
              [30, 0, "clock_timestamp()-interval '1 second'"],
            ] as const) {
              await session(created, refresh, notAfter);
              await f.db.query("select set_config('TimeZone',$1,false)", [
                zone,
              ]);
              await assert.rejects(live(), /CONNECT_FORBIDDEN/);
              await assert.rejects(limit(), /CONNECT_FORBIDDEN/);
            }
          }
          await session();
          await f.db.query("delete from auth.sessions where id=$1", [sid]);
          await assert.rejects(live(), /CONNECT_FORBIDDEN/);
          await session();
          await f.db.query(
            "update public.profiles set active=false where id=$1",
            [f.users.admin],
          );
          await assert.rejects(live(), /CONNECT_FORBIDDEN/);
        },
      );
      await t.test(
        "both new overloads are private; unknown session proof fails",
        async () => {
          for (const signature of [
            "composio_connect.refreshed_at_utc(timestamp without time zone)",
            "composio_connect.refreshed_at_utc(timestamp with time zone)",
          ])
            for (const role of ["anon", "authenticated", "service_role"])
              assert.equal(
                await scalar<boolean>(
                  "select has_function_privilege($1,$2,'execute') v",
                  [role, signature],
                ),
                false,
              );
          await f.db.query(
            "update public.profiles set active=true where id=$1",
            [f.users.admin],
          );
          await assert.rejects(
            scalar("select composio_connect.live_actor($1,repeat('0',64)) v", [
              f.users.admin,
            ]),
            /CONNECT_FORBIDDEN/,
          );
        },
      );
    } finally {
      await f.db.close();
    }
  });
}
