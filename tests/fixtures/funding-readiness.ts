import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { flowOwnerFixture } from "./campaign-flow-owner";
import { fundingPreset } from "../../src/lib/campaign-presets";
import { defaultReminders } from "../../src/lib/campaign-sequence";
export const readinessRoot =
  "docs/specs/pipeline-os/funding-readiness-20261126/";
export async function exerciseFundingReadiness(
  f: Awaited<ReturnType<typeof flowOwnerFixture>>,
) {
  const { db, users } = f;
  await db.exec("reset role");
  await db.exec(
    await readFile(
      "docs/specs/pipeline-os/funding-template-20261125/up.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "docs/specs/pipeline-os/campaign-flow-20261117/revisions/lead-funnel/up.sql",
      "utf8",
    ),
  );
  const originals = (
    await db.query<any>(
      "select oid::regprocedure::text signature,md5(prosrc) hash from pg_proc where proname in('campaign_flow_leads','campaign_flow_pool','campaign_flow_launch','campaign_prepared_leads') order by 1",
    )
  ).rows;
  await db.exec(await readFile(readinessRoot + "up.sql", "utf8"));
  await db.query("update contacts set monthly_income=100000 where id=any($1)", [
    f.contacts.slice(0, 2),
  ]);
  await f.asUser(users.admin);
  const template = (
    await db.query<any>("select save_campaign_template($1,$2) id", [
      { ...fundingPreset, id: undefined },
      randomUUID(),
    ])
  ).rows[0].id;
  const check = async (
    id = template,
    ids = f.contacts,
    account = f.accounts[0],
    version = 1,
  ) =>
    (
      await db.query<any>(
        "select campaign_template_readiness($1,$2,$3,$4,$5) r",
        [id, version, ids, account, JSON.stringify(defaultReminders)],
      )
    ).rows[0].r;
  const pool = async (income = "all", page = 0, search = "") =>
    (
      await db.query<any>("select campaign_income_pool($1,$2,20,$3) r", [
        search,
        page,
        income,
      ])
    ).rows[0].r;
  const leads = async (income = "all", filter = "all") =>
    (
      await db.query<any>("select campaign_income_leads($1,'',0,50,$2) r", [
        filter,
        income,
      ])
    ).rows[0].r;
  const before = (await db.query<any>("select count(*)::int n from outbox"))
    .rows[0].n;
  const mixed = await check();
  assert.equal(mixed.checked_count, 4);
  assert.equal(mixed.ready_count, 2);
  assert.equal(mixed.attention_count, 2);
  assert.deepEqual(
    new Set(
      mixed.rows.filter((r: any) => !r.ready).map((r: any) => r.contact_id),
    ),
    new Set(f.contacts.slice(2)),
  );
  assert(
    mixed.rows
      .filter((r: any) => !r.ready)
      .every(
        (r: any) => JSON.stringify(r.missing_fields) === '["monthly_income"]',
      ),
  );
  const normal = await check(f.template);
  assert.equal(
    normal.ready_count,
    4,
    "income is not mandatory for a normal template",
  );
  assert.equal((await pool("all")).total, 4);
  assert.equal((await pool("with")).total, 2);
  assert.equal((await pool("without")).total, 2);
  const a = await leads(),
    b = await leads("without");
  assert.deepEqual(a.income_summary.all, { with_income: 2, without_income: 2 });
  assert.equal(b.total, 2);
  assert.deepEqual(a.funnel, b.funnel);
  assert(
    (await pool("without")).rows.every((r: any) => r.monthly_income === null),
  );
  await assert.rejects(
    check(template, [...f.contacts, randomUUID()]),
    /CF_FORBIDDEN/,
  );
  await assert.rejects(
    check(template, f.contacts, randomUUID()),
    /CF_FORBIDDEN/,
  );
  await assert.rejects(
    check(template, f.contacts, f.accounts[0], 999),
    /CF_STALE/,
  );
  await assert.rejects(
    check(template, [f.contacts[0], f.contacts[0]]),
    /CF_INVALID_INPUT/,
  );
  await assert.rejects(pool("bad"), /CF_INVALID_INPUT/);
  await db.exec("reset role");
  await db.query("update contacts set name='' where id=$1", [f.contacts[0]]);
  await db.query("update leads set company='' where contact_id=$1", [
    f.contacts[0],
  ]);
  await f.asUser(users.admin);
  const names = (await check()).rows.find(
    (r: any) => r.contact_id === f.contacts[0],
  );
  assert(names.missing_fields.includes("name"));
  assert(names.missing_fields.includes("company"));
  assert.equal(names.ready, false);
  await f.asUser(users.admin, "aal1");
  await assert.rejects(leads(), /CF_FORBIDDEN/);
  await assert.rejects(check(), /CF_FORBIDDEN/);
  await f.asUser(users.outsider);
  await assert.rejects(pool(), /CF_FORBIDDEN/);
  await db.exec("set role anon");
  await assert.rejects(pool(), /permission denied/);
  await db.exec("reset role");
  for (let i = 0; i < 44; i++) {
    const id = randomUUID();
    await db.query(
      "insert into contacts(id,email,name,verification,monthly_income) values($1,$2,'Example lead','valid',$3)",
      [
        id,
        `income-${String(i).padStart(3, "0")}@example.test`,
        i % 2 ? 50000 : null,
      ],
    );
    await db.query(
      "insert into leads(contact_id,company,seller_id) values($1,'Example Business',$2)",
      [id, users.seller],
    );
  }
  await f.asUser(users.admin);
  const p1 = await pool("with", 0),
    p2 = await pool("with", 1);
  // One of the original income contacts is now missing name/company; still
  // available for templates that do not request those fields, as before.
  assert.equal(p1.total, 24);
  assert.equal(p1.rows.length, 20);
  assert.equal(p2.rows.length, 4);
  assert.equal(
    new Set([...p1.rows, ...p2.rows].map((r: any) => r.contact_id)).size,
    24,
  );
  assert.equal((await pool("without", 0, "income-001")).total, 0);
  assert.equal((await pool("with", 0, "income-001")).total, 1);
  await db.exec("reset role");
  assert.equal(
    (await db.query<any>("select count(*)::int n from outbox")).rows[0].n,
    before,
  );
  assert.equal(
    (await db.query<any>("select count(*)::int n from campaigns")).rows[0].n,
    0,
  );
  assert.deepEqual(
    (
      await db.query<any>(
        "select oid::regprocedure::text signature,md5(prosrc) hash from pg_proc where proname in('campaign_flow_leads','campaign_flow_pool','campaign_flow_launch','campaign_prepared_leads') order by 1",
      )
    ).rows,
    originals,
  );
  await db.exec(await readFile(readinessRoot + "down.sql", "utf8"));
  assert.equal(
    (
      await db.query<any>(
        "select to_regprocedure('public.campaign_income_pool(text,integer,integer,text)') r",
      )
    ).rows[0].r,
    null,
  );
  return {
    mixedBatch: true,
    missingNamesAndCompanies: true,
    incomeOptionalForOtherTemplates: true,
    filteringBeforePaging: true,
    mfaAndScope: true,
    previousFunctionsUnchanged: true,
    rollback: true,
    campaignWrites: 0,
    providerRequests: 0,
  };
}
