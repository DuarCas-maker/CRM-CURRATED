import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { flowOwnerFixture } from "./campaign-flow-owner";
import { defaultFundingModel } from "../../src/lib/funding-options";
import { campaignPresets, fundingPreset } from "../../src/lib/campaign-presets";
export const fundingRoot = "docs/specs/pipeline-os/funding-template-20261125/";
export async function exerciseFunding(
  f: Awaited<ReturnType<typeof flowOwnerFixture>>,
) {
  const { db, users } = f;
  await db.exec("reset role");
  await db.exec(await readFile(fundingRoot + "up.sql", "utf8"));
  const p = fundingPreset;
  const rows = (
    await db.query<any>(
      "select id,email,name,verification from contacts where id=any($1) order by id",
      [f.contacts],
    )
  ).rows;
  const before = (
    await db.query<any>(
      "select (select count(*) from contacts)::int contacts,(select count(*) from leads)::int leads",
    )
  ).rows[0];
  const entries = rows.map((r: any) => ({
    email: r.email.toUpperCase(),
    monthly_income: 100000,
  }));
  await f.asUser(users.admin);
  await assert.rejects(
    db.query("select recover_import_monthly_income($1,$2)", [f.batch, entries]),
    /permission denied/,
  );
  await db.exec("set role service_role");
  const apply = async (es = entries) =>
    (
      await db.query<any>("select recover_import_monthly_income($1,$2) r", [
        f.batch,
        es,
      ])
    ).rows[0].r;
  assert.equal((await apply()).updated, 4);
  assert.equal((await apply()).unchanged, 4);
  await assert.rejects(
    apply([
      { ...entries[0], monthly_income: 5 },
      { ...entries[0], monthly_income: 10 },
    ]),
    /Conflicting/,
  );
  assert.equal(
    (await apply([{ email: "absent@example.test", monthly_income: 100 }]))
      .unmatched,
    1,
  );
  await db.exec("reset role");
  assert.deepEqual(
    (
      await db.query<any>(
        "select (select count(*) from contacts)::int contacts,(select count(*) from leads)::int leads",
      )
    ).rows[0],
    before,
  );
  assert.deepEqual(
    (
      await db.query<any>(
        "select id,email,name,verification from contacts where id=any($1) order by id",
        [f.contacts],
      )
    ).rows,
    rows,
  );
  await f.asUser(users.admin, "aal1");
  await assert.rejects(
    db.query("select save_campaign_template($1,$2)", [
      { ...p, id: undefined },
      randomUUID(),
    ]),
    /MFA|Administrator/,
  );
  await f.asUser(users.admin);
  const id = (
    await db.query<any>("select save_campaign_template($1,$2) id", [
      { ...p, id: undefined },
      randomUUID(),
    ])
  ).rows[0].id;
  assert.deepEqual(
    (
      await db.query<any>(
        "select snapshot->'funding_model' model from email_template_versions where template_id=$1",
        [id],
      )
    ).rows[0].model,
    defaultFundingModel,
  );
  await db.exec("reset role");
  await db.query("update contacts set monthly_income=null where id=$1", [
    f.contacts[0],
  ]);
  await f.asUser(users.admin);
  await assert.rejects(
    f.launch({ ...f.p, template_id: id }),
    /CF_TEMPLATE_DATA/,
  );
  await db.exec("reset role");
  await db.query("update contacts set monthly_income=100000 where id=$1", [
    f.contacts[0],
  ]);
  await f.asUser(users.admin);
  const launched = await f.launch({ ...f.p, template_id: id });
  await db.exec("reset role");
  const camp = (
    await db.query<any>("select funding_model from campaigns where id=$1", [
      launched.id,
    ])
  ).rows[0];
  assert.deepEqual(camp.funding_model, defaultFundingModel);
  assert.equal(
    (
      await db.query<any>(
        "select min(funding_income_snapshot)::text income from campaign_enrollments where campaign_id=$1",
        [launched.id],
      )
    ).rows[0].income,
    "100000.00",
  );
  await db.query("update contacts set monthly_income=200000 where id=any($1)", [
    f.contacts,
  ]);
  assert.equal(
    (
      await db.query<any>(
        "select min(funding_income_snapshot)::text income from campaign_enrollments where campaign_id=$1",
        [launched.id],
      )
    ).rows[0].income,
    "100000.00",
  );
  await assert.rejects(
    db.query("update campaigns set funding_model=null where id=$1", [
      launched.id,
    ]),
    /frozen/,
  );
  await assert.rejects(
    db.query(
      "update campaign_enrollments set funding_income_snapshot=1 where campaign_id=$1",
      [launched.id],
    ),
    /frozen/,
  );
  await f.asUser(users.admin);
  const cfg = structuredClone(defaultFundingModel);
  cfg.options[0].multiplier = 1.5;
  await db.query("select save_campaign_template($1,$2)", [
    { ...p, id, expected_version: 1, funding_model: cfg },
    randomUUID(),
  ]);
  assert.deepEqual(
    (
      await db.query<any>("select funding_model from campaigns where id=$1", [
        launched.id,
      ])
    ).rows[0].funding_model,
    defaultFundingModel,
  );
  await db.exec("reset role");
  assert.equal(
    (await db.query<any>("select count(*)::int n from outbox")).rows[0].n,
    0,
  );
  const batch = randomUUID();
  await db.query(
    "insert into import_batches(id,name,total,storage_path,mapping,created_by,request_key) values($1,'Income.xlsx',1,'fixture-income.xlsx','{}',$2,$3)",
    [batch, users.admin, randomUUID()],
  );
  await db.exec("set role service_role");
  const imported = [
    {
      valid: true,
      email: rows[0].email,
      contact: "DO NOT OVERWRITE",
      monthly_income: 300000,
      row_number: 2,
    },
  ];
  await db.query("select ingest_import_chunk($1,$2)", [batch, imported]);
  await db.query("select ingest_import_chunk($1,$2)", [batch, imported]);
  await db.exec("reset role");
  const updated = (
    await db.query<any>(
      "select monthly_income::text income,name,verification from contacts where id=$1",
      [rows[0].id],
    )
  ).rows[0];
  assert.equal(updated.income, "300000.00");
  assert.equal(updated.name, rows[0].name);
  assert.equal(updated.verification, rows[0].verification);
  assert.deepEqual(
    (
      await db.query<any>(
        "select (select count(*) from contacts)::int contacts,(select count(*) from leads)::int leads",
      )
    ).rows[0],
    before,
  );
  assert.equal(
    (
      await db.query<any>("select processed from import_batches where id=$1", [
        batch,
      ])
    ).rows[0].processed,
    1,
  );
  return {
    recovered: 4,
    idempotent: true,
    uniquePreserved: true,
    mfa: true,
    snapshotsFrozen: true,
    reimportUpdatesOnlyIncome: true,
    missingIncomeBlocked: true,
    providerRequests: 0,
  };
}
