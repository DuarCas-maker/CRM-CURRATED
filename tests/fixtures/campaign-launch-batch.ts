import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { flowOwnerFixture } from "./campaign-flow-owner";
import { fundingPreset } from "../../src/lib/campaign-presets";
export const launchBatchRoot =
  "docs/specs/pipeline-os/campaign-launch-batch-20261126/";
export async function exerciseLaunchBatch(
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
  // The deployed command body uses CRLF; rollback must preserve it too.
  await db.exec("do $$begin execute replace(pg_get_functiondef('public.crm_command_before_brand_b1(text,jsonb,uuid)'::regprocedure),E'\\r\\n',E'\\n')::text;end$$;");
  await db.exec("do $$begin execute replace(pg_get_functiondef('public.crm_command_before_brand_b1(text,jsonb,uuid)'::regprocedure),E'\\n',E'\\r\\n');end$$;");
  const originals = (
    await db.query<any>(
      "select oid::regprocedure::text signature,md5(prosrc) hash,proacl::text acl,proowner from pg_proc where oid in('public.campaign_flow_launch(jsonb,uuid)'::regprocedure,'public.crm_command_before_brand_b1(text,jsonb,uuid)'::regprocedure) order by 1",
    )
  ).rows;
  await db.exec(await readFile(launchBatchRoot + "up.sql", "utf8"));
  const after = (
    await db.query<any>(
      "select oid::regprocedure::text signature,proacl::text acl,proowner from pg_proc where oid in('public.campaign_flow_launch(jsonb,uuid)'::regprocedure,'public.crm_command_before_brand_b1(text,jsonb,uuid)'::regprocedure) order by 1",
    )
  ).rows;
  assert.deepEqual(
    after,
    originals.map(({ hash, ...r }) => r),
  );
  await db.query("update contacts set monthly_income=100000 where id=any($1)", [
    f.contacts,
  ]);
  await f.asUser(users.admin);
  const template = (
    await db.query<any>("select save_campaign_template($1,$2) id", [
      { ...fundingPreset, id: undefined },
      randomUUID(),
    ])
  ).rows[0].id;
  const p = { ...f.p, template_id: template };
  await assert.rejects(
    db.query("select * from campaign_launch_v1.candidates($1,$2,$3,null,$4)", [
      fundingPreset.subject,
      fundingPreset.body,
      f.accounts[0],
      f.contacts,
    ]),
    /permission denied/,
  );
  await f.asUser(users.admin, "aal1");
  await assert.rejects(f.launch(p), /CF_FORBIDDEN/);
  await f.asUser(users.outsider);
  await assert.rejects(f.launch(p), /CF_FORBIDDEN/);
  await f.asUser(users.admin);
  await assert.rejects(f.launch({ ...p, template_version: 2 }), /CF_STALE/);
  await assert.rejects(
    f.launch({ ...p, contact_ids: [p.contact_ids[0], p.contact_ids[0]] }),
    /CF_STALE/,
  );
  await db.exec("reset role");
  await db.query("update contacts set monthly_income=null where id=$1", [
    f.contacts[0],
  ]);
  await f.asUser(users.admin);
  await assert.rejects(f.launch(p), /CF_TEMPLATE_DATA/);
  await db.exec("reset role");
  await db.query(
    "update contacts set monthly_income=100000,verification='invalid' where id=$1",
    [f.contacts[0]],
  );
  await f.asUser(users.admin);
  await assert.rejects(f.launch(p), /CF_STALE/);
  await db.exec("reset role");
  await db.query(
    "insert into suppressions(email,reason) select email,'Fixture bounce' from contacts where id=$1",
    [f.contacts[1]],
  );
  const legacy = (
    await db.query<any>(
      "select * from first_contact_candidates($1,$2,$3) where contact_id=any($4) order by contact_id,opportunity_id",
      [fundingPreset.subject, fundingPreset.body, f.accounts[0], f.contacts],
    )
  ).rows;
  const bounded = (
    await db.query<any>(
      "select * from campaign_launch_v1.candidates($1,$2,$3,null,$4) order by contact_id,opportunity_id",
      [fundingPreset.subject, fundingPreset.body, f.accounts[0], f.contacts],
    )
  ).rows;
  assert.deepEqual(bounded, legacy);
  await f.asUser(users.admin);
  await assert.rejects(f.launch(p), /CF_STALE/);
  await db.exec("reset role");
  await db.query(
    "delete from suppressions where email=(select email from contacts where id=$1)",
    [f.contacts[1]],
  );
  await f.asUser(users.admin);
  assert.equal(
    (await db.query<any>("select count(*)::int n from campaigns")).rows[0].n,
    0,
  );
  await db.exec("reset role");
  await db.query("update contacts set verification='valid' where id=$1", [
    f.contacts[0],
  ]);
  await f.asUser(users.admin);
  const key = randomUUID(),
    result = await f.launch(p, key);
  assert.deepEqual(await f.launch(p, key), result);
  await assert.rejects(
    f.launch({ ...p, contact_ids: [f.contacts[0]] }, key),
    /CF_STALE/,
  );
  await db.exec("reset role");
  const camp = (
    await db.query<any>(
      "select funding_model,steps,jsonb_array_length(steps) n from campaigns where id=$1",
      [result.id],
    )
  ).rows[0];
  assert.deepEqual(camp.funding_model, fundingPreset.funding_model);
  assert.equal(camp.n, 4);
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int n from campaign_enrollments where campaign_id=$1 and funding_income_snapshot=100000",
        [result.id],
      )
    ).rows[0].n,
    4,
  );
  assert.equal(
    (await db.query<any>("select count(*)::int n from outbox")).rows[0].n,
    0,
  );
  assert(
    (await db.query<any>("select seller_id from opportunities")).rows.every(
      (r) => r.seller_id === users.admin,
    ),
  );
  await assert.rejects(
    db.query("update campaigns set funding_model=null where id=$1", [
      result.id,
    ]),
    /frozen/,
  );
  await db.exec(await readFile(launchBatchRoot + "down.sql", "utf8"));
  assert.deepEqual(
    (
      await db.query<any>(
        "select oid::regprocedure::text signature,md5(prosrc) hash,proacl::text acl,proowner from pg_proc where oid in('public.campaign_flow_launch(jsonb,uuid)'::regprocedure,'public.crm_command_before_brand_b1(text,jsonb,uuid)'::regprocedure) order by 1",
      )
    ).rows,
    originals,
  );
  return {
    negativeCases: true,
    readerEquivalent: true,
    privateReader: true,
    receipts: true,
    fundingSnapshots: true,
    creator: true,
    grantsPreserved: true,
    rollback: true,
    providerRequests: 0,
    outboxWrites: 0,
  };
}
