import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { remediationFixture } from "./fixtures/pipeline-os-permission-remediation";
import { remediationRoot } from "../scripts/pipeline-os/permission-remediation";

const dir = remediationRoot + "final/";
let f: Awaited<ReturnType<typeof remediationFixture>>;
let sql: string, postflight: string, contract: any;
let committedFingerprint: string;
before(async () => {
  f = await remediationFixture();
  sql = await readFile(
    dir + "048_restore_scoped_public_permissions.sql",
    "utf8",
  );
  postflight = await readFile(dir + "postflight.sql", "utf8");
  contract = JSON.parse(await readFile(dir + "release-contract.json", "utf8"));
  await f.admin();
  // PG18 ALL includes MAINTAIN; the observed target is PG15, where it does not
  // exist. Reproduce exactly PG15's observed seven table operations for this QA.
  for (const t of f.targets)
    await f.db.exec(
      `revoke maintain on table ${t.key} from anon,authenticated`,
    );
});
after(async () => {
  await f?.db.close();
});
const run = async (text = sql) => {
  await f.admin();
  try {
    return await f.db.exec(text);
  } catch (e) {
    await f.db.exec("rollback");
    throw e;
  }
};
const observe = async () =>
  (await run(postflight))
    .flatMap((r) => r.rows)
    .find((r: any) => r.pipeline_os_prm1_postflight)
    ?.pipeline_os_prm1_postflight as any;
const roleHas = async (relation: string, privilege: string) => {
  await f.admin();
  return (
    await f.db.query<{ access: boolean }>(
      "select has_table_privilege('anon',$1,$2) access",
      [relation, privilege],
    )
  ).rows[0].access;
};

test("PF-AC01: final artifact preserves scope, binds its contract and has no fixture bypass", async () => {
  assert.equal(contract.targets.length, 28);
  assert.equal(
    contract.columns.reduce((n: number, t: any) => n + t.columns.length, 0),
    329,
  );
  assert.equal(contract.footprint.length, 39);
  const hash = createHash("sha256")
    .update(await readFile(dir + "release-contract.json"))
    .digest("hex");
  assert(sql.includes(hash));
  assert(postflight.includes(hash));
  assert(!sql.includes("offline_fixture_only"));
  assert(!sql.includes("PRM_OFFLINE_GUARD"));
  const code = sql.replace(/--[^\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");
  assert(
    !/\b(grant|alter|truncate|delete|insert|update|create|drop|cascade)\b/i.test(
      code,
    ),
  );
  assert.match(sql, /begin isolation level serializable;/);
  assert.match(sql, /checked_before_commit/);
  assert.match(sql, /commit;\s*$/);
});

test("PF-AC02/03: exact final SQL applies, repeats safely and matches independent postflight", async () => {
  const before = await f.protectedSnapshot();
  const results = await run();
  const receipt = results
    .flatMap((r) => r.rows)
    .find((r: any) => r.pipeline_os_prm1_application)
    ?.pipeline_os_prm1_application as any;
  assert.equal(receipt.stage, "checked_before_commit");
  assert(receipt.preservationMatches);
  assert.equal(receipt.protectedBefore, receipt.protectedAfter);
  committedFingerprint = receipt.protectedAfter;
  const observed = await observe();
  assert(
    observed.objectsOk &&
      observed.allTargetsOk &&
      observed.humanRolesOk &&
      observed.footprintMatches &&
      observed.serviceRoleReady,
  );
  assert.equal(observed.protectedFingerprint, committedFingerprint);
  assert.equal(observed.relations.length, 28);
  for (const t of f.targets) {
    const row = observed.relations.find((r: any) => r.key === t.key);
    assert(row.targetOk);
    assert.deepEqual(row.anon, []);
    assert.deepEqual(row.authenticated, t.authenticated);
  }
  assert.deepEqual(await f.protectedSnapshot(), before);
  await run();
  assert.equal((await observe()).protectedFingerprint, committedFingerprint);
});

test("PF-AC03: postflight detects human grant drift even when protected service hash matches", async () => {
  await f.admin();
  await f.db.exec("grant select on public.campaign_assets to anon");
  try {
    const observed = await observe();
    assert.equal(observed.allTargetsOk, false);
    assert.equal(observed.protectedFingerprint, committedFingerprint);
  } finally {
    await f.admin();
    await f.db.exec("revoke select on public.campaign_assets from anon");
  }
});
test("PF-AC03: postflight detects lost service access even when all human targets match", async () => {
  await f.admin();
  await f.db.exec("revoke select on public.mail_drafts from service_role");
  try {
    const observed = await observe();
    assert(observed.allTargetsOk);
    assert.notEqual(observed.protectedFingerprint, committedFingerprint);
  } finally {
    await f.admin();
    await f.db.exec("grant select on public.mail_drafts to service_role");
  }
  assert.equal((await observe()).protectedFingerprint, committedFingerprint);
});
test("PF-AC02: new column contract aborts before any excess is revoked", async () => {
  await f.admin();
  await f.db.exec(
    "alter table public.campaign_assets add column prm_final_drift text;grant select on public.campaign_events to anon",
  );
  try {
    await assert.rejects(run(), /PRM_FINAL_COLUMNS_DRIFT/);
    assert(await roleHas("public.campaign_events", "SELECT"));
  } finally {
    await f.admin();
    await f.db.exec(
      "alter table public.campaign_assets drop column prm_final_drift;revoke select on public.campaign_events from anon",
    );
  }
});
test("PF-AC03: Storage schema change is detected without reading any Storage object data", async () => {
  await f.admin();
  await f.db.exec(
    "alter table storage.objects add column prm_final_storage_drift text",
  );
  try {
    const observed = await observe();
    assert(observed.allTargetsOk);
    assert.notEqual(observed.protectedFingerprint, committedFingerprint);
  } finally {
    await f.admin();
    await f.db.exec(
      "alter table storage.objects drop column prm_final_storage_drift",
    );
  }
  assert.equal((await observe()).protectedFingerprint, committedFingerprint);
});
test("PF-AC02/03: server role flag drift is rejected and reported despite unchanged human targets", async () => {
  await f.admin();
  await f.db.exec("alter role service_role nobypassrls");
  try {
    await assert.rejects(run(), /PRM_ROLE_DRIFT/);
    const observed = await observe();
    assert(observed.allTargetsOk);
    assert.equal(observed.serviceRoleReady, false);
    assert.notEqual(observed.protectedFingerprint, committedFingerprint);
  } finally {
    await f.admin();
    await f.db.exec("alter role service_role bypassrls");
  }
});
test("PF-AC03: schema ACL drift changes protected fingerprint without hiding matching table targets", async () => {
  await f.admin();
  await f.db.exec("revoke usage on schema public from service_role");
  try {
    const observed = await observe();
    assert(observed.allTargetsOk);
    assert.notEqual(observed.protectedFingerprint, committedFingerprint);
  } finally {
    await f.admin();
    await f.db.exec("grant usage on schema public to service_role");
  }
  assert.equal((await observe()).protectedFingerprint, committedFingerprint);
});
for (const key of [
  "public.campaign_workspace",
  "public.opportunity_inbox",
  "public.opportunity_tasks",
])
  test(`PF-AC02: accepted definition guard rejects drift in ${key}`, async () => {
    const original = (await f.definitions())
      .find((d) => d.key === key)!
      .definition.replace(/;\s*$/, "");
    await f.admin();
    try {
      await f.db.exec(
        `create or replace view ${key} with(security_invoker=true) as select * from (${original}) fixture where false`,
      );
      await assert.rejects(run(), /PRM_FINAL_ACCEPTED_VIEW_DRIFT/);
    } finally {
      await f.admin();
      await f.db.exec(
        `create or replace view ${key} with(security_invoker=true) as ${original}`,
      );
    }
  });
test("PF-AC02: unexpected PG18 MAINTAIN is rejected instead of widening PG15 correction", async () => {
  await f.admin();
  await f.db.exec("grant maintain on public.campaign_assets to anon");
  try {
    await assert.rejects(run(), /PRM_FINAL_UNEXPECTED_PRIVILEGE/);
    assert.equal((await observe()).allTargetsOk, false);
  } finally {
    await f.admin();
    await f.db.exec("revoke maintain on public.campaign_assets from anon");
  }
});
test("PF-AC02: changed recursive view footprint is rejected before locking new relations", async () => {
  await f.admin();
  const original = (await f.definitions())
    .find((d) => d.key === "public.campaign_workspace")!
    .definition.replace(/;\s*$/, "");
  try {
    await f.db.exec(
      `create table public.prm_unexpected_relation(id integer);create or replace view public.campaign_workspace with(security_invoker=true) as select fixture.* from (${original}) fixture where exists(select 1 from public.prm_unexpected_relation)`,
    );
    await assert.rejects(run(), /PRM_FINAL_LOCK_FOOTPRINT_DRIFT/);
  } finally {
    await f.admin();
    await f.db.exec(
      `create or replace view public.campaign_workspace with(security_invoker=true) as ${original};drop table public.prm_unexpected_relation`,
    );
  }
});
test("PF-AC02: failure after revocation rolls back and cannot return a successful receipt", async () => {
  await f.admin();
  await f.db.exec("grant select on public.campaign_assets to anon");
  try {
    await assert.rejects(
      run(
        sql.replace(
          " protected_after:=",
          " raise exception 'PF_INJECTED_FAILURE'; protected_after:=",
        ),
      ),
      /PF_INJECTED_FAILURE/,
    );
    assert(await roleHas("public.campaign_assets", "SELECT"));
  } finally {
    await f.admin();
    await f.db.exec("revoke select on public.campaign_assets from anon");
  }
});
test("PF-AC03: postflight is catalog-only and enforces READ ONLY", async () => {
  const code = postflight
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
  assert(
    !/\b(grant|revoke|alter|truncate|delete|insert|update|create|drop|call|do)\b/i.test(
      code,
    ),
  );
  assert(!/\b(from|join)\s+(public|auth|storage)\./i.test(code));
  assert.equal((await observe()).context.readOnly, "on");
  await assert.rejects(
    run(
      postflight.replace(
        /rollback;\s*$/,
        "insert into public.mail_recipient_selections(user_id,name,targets) values(gen_random_uuid(),'Fixture','[]');rollback;",
      ),
    ),
    (e: any) => e.code === "25006",
  );
});
test("PF-AC02: actual local relation locks equal the 39-object catalog footprint", async () => {
  const probe = sql.replace(
    "select current_setting('pipeline_os.prm1_receipt')::jsonb pipeline_os_prm1_application;\ncommit;",
    `select jsonb_agg(n.nspname||'.'||c.relname order by n.nspname,c.relname) fixture_locks from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and l.mode='AccessExclusiveLock' and l.granted;rollback;`,
  );
  assert.notEqual(probe, sql);
  const locks = (await run(probe))
    .flatMap((r) => r.rows)
    .find((r: any) => r.fixture_locks)?.fixture_locks;
  assert.deepEqual(locks, contract.footprint);
  const observed = await observe();
  assert(observed.allTargetsOk);
  assert.equal(observed.protectedFingerprint, committedFingerprint);
});
