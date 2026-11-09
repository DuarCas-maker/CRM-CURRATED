import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { abcFinalFixture } from "./fixtures/pipeline-os-abc-final";
import {
  runtimeCatalog,
  runtimeDdl,
  runtimeSources,
  runtimeReleaseRoot as root,
  runtimeMigration,
  renderRuntimeRelease,
  type RuntimeContract,
} from "../scripts/pipeline-os/mail-runtime-release";
import nextConfig from "../next.config";

let f: Awaited<ReturnType<typeof abcFinalFixture>>,
  migration: string,
  post: string,
  pre: string,
  c: RuntimeContract;
const run = async (sql: string) => {
  await f.admin();
  try {
    return await f.db.exec(sql);
  } catch (e) {
    await f.db.exec("rollback");
    throw e;
  }
};
const catalog = async () => {
  await f.admin();
  await f.db.exec("set search_path=pg_catalog,pg_temp");
  return (await f.db.query<{ snapshot: unknown }>(runtimeCatalog)).rows[0]
    .snapshot;
};
const report = (rows: Awaited<ReturnType<typeof run>>, key: string) =>
  (rows.flatMap((r) => r.rows) as Record<string, Record<string, any>>[]).find(
    (r) => r[key],
  )?.[key] as Record<string, any>;
const publicRows = async () => {
  await f.admin();
  const tables = (
    await f.db.query<{ name: string }>(
      "select tablename name from pg_tables where schemaname='public' order by tablename",
    )
  ).rows;
  const result = [];
  for (const t of tables)
    result.push({
      name: t.name,
      rows: (
        await f.db.query(
          `select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]')::text) digest from public.${JSON.stringify(t.name)} x`,
        )
      ).rows,
    });
  return result;
};
before(async () => {
  f = await abcFinalFixture(true);
  await f.admin();
  await f.db.exec(
    await readFile(
      "docs/specs/pipeline-os/s02/release/abc-final/049_integrate_mail_identity_brands_and_bindings.sql",
      "utf8",
    ),
  );
  await f.db.exec(
    "create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),refreshed_at timestamptz default now(),not_after timestamptz)",
  );
  [migration, pre, post] = await Promise.all(
    [runtimeMigration, "preflight.sql", "postflight.sql"].map((p) =>
      readFile(root + p, "utf8"),
    ),
  );
  c = JSON.parse(await readFile(root + "contract.json", "utf8"));
});
after(async () => {
  await f?.db.close();
});

test("MR01: deterministic final files retain six functional guards and replace only fixture wrappers", async () => {
  const ddl = runtimeDdl(
      await Promise.all(runtimeSources.map(([p]) => readFile(p, "utf8"))),
    ),
    a = renderRuntimeRelease(c, ddl);
  assert.equal(a.migration, migration);
  assert.equal(a.preflight, pre);
  assert.equal(a.postflight, post);
  assert.equal(a.contract, await readFile(root + "contract.json", "utf8"));
  for (const s of [
    "WORKER_PILOT_CLAIM_BASE_MISMATCH",
    "R06_I02_BASE_MISMATCH",
    "R06_I03_BASE_MISMATCH",
    "R06_I03_ANCHOR_MISMATCH",
  ])
    assert(migration.includes(s));
  assert(!migration.includes("in_memory_test"));
  assert(!migration.includes("f2_connect_owner"));
  assert.match(migration, /begin isolation level serializable;/);
  assert.match(migration, /commit;\s*$/);
});
test("MR02: preflight is READ ONLY and preserves rows/catalog; reports unpaused queue separately", async () => {
  const cat = await catalog(),
    rows = await publicRows();
  const r = report(await run(pre), "pipeline_os_mail_runtime_preflight");
  assert.equal(r.catalogOk, true);
  assert.equal(r.queueOk, true);
  assert.equal(r.readyToApply, false);
  assert.deepEqual(await catalog(), cat);
  assert.deepEqual(await publicRows(), rows);
});
test("MR02: foreign actor, missing Auth shape and existing target schema fail before DDL", async () => {
  await assert.rejects(
    f.db.exec("set role authenticated;" + migration),
    /permission denied|MR_CONTEXT_MISMATCH/,
  );
  await f.db.exec("rollback");
  await f.admin();
  await f.db.exec(
    "alter table auth.sessions rename column not_after to other_name",
  );
  await assert.rejects(run(migration), /MR_CONTEXT_MISMATCH/);
  await f.admin();
  await f.db.exec(
    "alter table auth.sessions rename column other_name to not_after",
  );
  await f.db.exec("create schema mail_runtime");
  await assert.rejects(
    run(migration),
    /MR_BASE_MISMATCH|MR_ALREADY_OR_PARTIALLY_APPLIED/,
  );
  await f.admin();
  await f.db.exec("drop schema mail_runtime");
});
test("MR02: running jobs block before install without consuming or changing them", async () => {
  await f.admin();
  const job = (
    await f.db.query<{ id: string }>(
      "insert into public.jobs(kind,status,payload,dedupe_key) values('gmail_sync','running','{}','mr-fixture-only') returning id",
    )
  ).rows[0].id;
  await assert.rejects(run(migration), /MR_QUEUE_NOT_QUIESCENT/);
  await f.admin();
  assert.equal(
    (
      await f.db.query<{ status: string }>(
        "select status from public.jobs where id=$1",
        [job],
      )
    ).rows[0].status,
    "running",
  );
  await f.db.query("delete from public.jobs where id=$1", [job]);
});
test("MR03/04: exact final file applies in a transaction and rollback restores catalog, rows and ACL", async () => {
  const cat = await catalog(),
    rows = await publicRows();
  const tx = migration.replace(/commit;\s*$/, "rollback;");
  const r = report(await run(tx), "pipeline_os_mail_runtime_application");
  assert.equal(r.targetsOk, true);
  assert.equal(r.preservationMatches, true);
  assert.deepEqual(await catalog(), cat);
  assert.deepEqual(await publicRows(), rows);
});
test("MR04: final contract failure rolls back all DDL; no partial schemas survive", async () => {
  const cat = await catalog();
  const anchor = "do $mr_final$";
  assert.equal(migration.split(anchor).length, 2);
  const bad = migration.replace(
    anchor,
    "alter function public.mail_transport_schedule() rename to changed_schedule;\n" +
      anchor,
  );
  await assert.rejects(run(bad), /MR_FINAL_CONTRACT_MISMATCH/);
  assert.deepEqual(await catalog(), cat);
});
test("MR02/04: CRLF installer and inherited OAuth bodies keep source pins and rollback intact", async () => {
  await f.admin();
  const definitions = [];
  for (const signature of [
    "public.brand_oauth_begin(text,text,jsonb)",
    "public.brand_oauth_finish(text,uuid,text,text,boolean)",
  ]) {
    const d = (
      await f.db.query<{ d: string }>(
        "select pg_get_functiondef($1::regprocedure) d",
        [signature],
      )
    ).rows[0].d;
    definitions.push(d);
    await f.db.exec(d.replaceAll("\n", "\r\n"));
  }
  const before = await catalog();
  const r = report(
    await run(
      migration.replace(/commit;\s*$/, "rollback;").replaceAll("\n", "\r\n"),
    ),
    "pipeline_os_mail_runtime_application",
  );
  assert.equal(r.targetsOk, true);
  assert.deepEqual(await catalog(), before);
  await f.admin();
  for (const d of definitions) await f.db.exec(d);
});
test("MR03: real COMMIT, fresh postflight, fenced old APIs, private tables and no configuration/route activation", async () => {
  const rows = await publicRows();
  assert.equal(
    report(await run(migration), "pipeline_os_mail_runtime_application")
      .targetsOk,
    true,
  );
  assert.deepEqual(await publicRows(), rows);
  const r = report(await run(post), "pipeline_os_mail_runtime_postflight");
  assert.equal(r.targetsOk, true);
  assert.equal(r.mismatchCount, 0);
  assert.equal(r.composioEnabledExpected, false);
  await f.admin();
  for (const table of [
    "composio_connect.configuration",
    "composio_connect.attempts",
    "worker_pilot.trials",
    "mail_runtime.routes",
    "composio_connect_runtime.runtime",
    "composio_connect_runtime.contexts",
  ]) {
    assert.equal(
      (await f.db.query<{ n: number }>(`select count(*)::int n from ${table}`))
        .rows[0].n,
      0,
    );
    for (const role of ["anon", "authenticated", "service_role"])
      for (const priv of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "TRIGGER",
        "REFERENCES",
      ])
        assert.equal(
          (
            await f.db.query<{ allowed: boolean }>(
              "select has_table_privilege($1,$2,$3) allowed",
              [role, table, priv],
            )
          ).rows[0].allowed,
          false,
        );
  }
  for (const role of ["anon", "authenticated", "service_role"])
    assert.equal(
      (
        await f.db.query<{ allowed: boolean }>(
          "select has_function_privilege($1,'public.composio_connect_publish(jsonb)','execute') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  await assert.rejects(
    run(migration),
    /MR_BASE_MISMATCH|MR_ALREADY_OR_PARTIALLY_APPLIED/,
  );
});
test("MR04: postflight rejects an additional private function and a new PUBLIC grant", async () => {
  await f.admin();
  await f.db.exec(
    "create function mail_runtime.unlisted() returns boolean language sql as 'select true'",
  );
  assert.equal(
    report(await run(post), "pipeline_os_mail_runtime_postflight").targetsOk,
    false,
  );
  await f.admin();
  await f.db.exec("drop function mail_runtime.unlisted()");
  await f.db.exec(
    "grant execute on function public.mail_transport_schedule() to public",
  );
  assert.equal(
    report(await run(post), "pipeline_os_mail_runtime_postflight").targetsOk,
    false,
  );
  await f.admin();
  await f.db.exec(
    "revoke execute on function public.mail_transport_schedule() from public",
  );
  assert.equal(
    report(await run(post), "pipeline_os_mail_runtime_postflight").targetsOk,
    true,
  );
});
test("MR02/05: CRLF function source accepted while changed body rejected; CSP narrowly admits reviewed consent hosts", async () => {
  await f.admin();
  const d = (
    await f.db.query<{ d: string }>(
      "select pg_get_functiondef('public.mail_transport_schedule()'::regprocedure) d",
    )
  ).rows[0].d;
  await f.db.exec(d.replaceAll("\n", "\r\n"));
  assert.equal(
    report(await run(post), "pipeline_os_mail_runtime_postflight").targetsOk,
    true,
  );
  await f.admin();
  await f.db.exec(d.replace("begin", "begin\n perform 1;"));
  assert.equal(
    report(await run(post), "pipeline_os_mail_runtime_postflight").targetsOk,
    false,
  );
  await f.admin();
  await f.db.exec(d);
  const h = await nextConfig.headers!();
  assert(Array.isArray(h));
  const policy = h[0].headers.find(
      (x) => x.key === "Content-Security-Policy",
    )!.value,
    form = policy
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("form-action"));
  assert.equal(
    form,
    "form-action 'self' https://accounts.google.com https://connect.composio.dev",
  );
  assert(!form.includes("*"));
  assert(
    !policy
      .split(";")
      .find((s) => s.trim().startsWith("connect-src"))!
      .includes("composio.dev"),
  );
});
