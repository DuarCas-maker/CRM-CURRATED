import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";
import {
  installBrandDelivery,
  bindFixtureAccount,
} from "./fixtures/pipeline-os-s02-brand-delivery";
import {
  campaignImportStatusSchema,
  importCampaignHref,
} from "../src/lib/campaign-import";
import {
  readImportCampaign,
  writeImportCampaign,
  importCampaignError,
  type ImportCampaignContext,
} from "../src/lib/server/campaign-import";
const sqlRoot =
  "docs/specs/pipeline-os/campaign-import-flow-20261116/migrations/";

test("CI: HTTP creation validates sender brand and preserves file scope before the atomic RPC", async () => {
  const batch = randomUUID(),
    account = randomUUID(),
    actor = randomUUID(),
    brand = randomUUID(),
    template = randomUUID(),
    campaign = randomUUID();
  const calls: { name: string; args: any }[] = [];
  const ctx = {
    profile: { role: "superadmin" },
    db: {
      rpc: async (name: string, args: any) => {
        calls.push({ name, args });
        return {
          error: null,
          data:
            name === "brand_prepare_context"
              ? {
                  version: 1,
                  brand_id: brand,
                  brand_code: "fixture",
                  brand_name: "Fixture",
                  brand_revision: 1,
                  account_id: account,
                  account_revision: 1,
                  actor_id: actor,
                  purpose: "campaign",
                  authorization: "human_aal2",
                  prepared_at: "2026-11-16T12:00:00Z",
                }
              : { id: campaign },
        };
      },
    },
  } as unknown as ImportCampaignContext;
  const result = await writeImportCampaign(
    {
      kind: "create",
      request_key: randomUUID(),
      payload: {
        import_batch_id: batch,
        account_id: account,
        seller_id: actor,
        template_id: template,
        template_version: 1,
        name: "Fixture campaign",
        subject: "Hello",
        body: "Hello {{unsubscribe_url}}",
        steps: [
          {
            subject: "Old followup",
            body: "Hi {{unsubscribe_url}}",
            wait_days: 3,
          },
        ],
        daily_limit: "100",
        timezone: "UTC",
        start_hour: "9",
        end_hour: "17",
        brand_preparation: {
          brand_id: brand,
          brand_revision: 1,
          account_revision: 1,
        },
      },
    },
    ctx,
  );
  assert.deepEqual(result, { id: campaign });
  assert.deepEqual(
    calls.map((x) => x.name),
    ["brand_prepare_context", "campaign_create_from_import"],
  );
  assert.equal(calls[1].args.p.import_batch_id, batch);
  assert.equal(calls[1].args.p.daily_limit, 100);
  assert.deepEqual(calls[1].args.p.steps, []);
  assert.equal(importCampaignError(new SyntaxError("bad JSON")).status, 400);
});
test("CI: installed brand guards preserve the trusted snapshot while freezing file recipients", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    await installBrandDelivery(f);
    const preparation = await bindFixtureAccount(f, f.account);
    const batch = await f.batch(),
      other = await f.batch(),
      inside = await f.contact(batch),
      outside = await f.contact(other);
    const payload = { ...f.payload(batch), brand_preparation: preparation };
    await assert.rejects(
      f.rpc("campaign_create_from_import", [f.payload(batch), randomUUID()]),
      /BRAND_PREPARATION_(REQUIRED|STALE)/,
    );
    const key = randomUUID();
    const created = await f.rpc("campaign_create_from_import", [payload, key]);
    assert.equal(
      (await f.rpc("campaign_create_from_import", [payload, key])).id,
      created.id,
    );
    const saved = (
      await db.query<any>(
        "select batch_id,selected_contact_ids,brand_snapshot,status from campaigns where id=$1",
        [created.id],
      )
    ).rows[0];
    assert.equal(saved.batch_id, batch);
    assert.equal(saved.status, "draft");
    assert.deepEqual(saved.selected_contact_ids, [inside]);
    assert.equal(saved.brand_snapshot.brand_id, preparation.brand_id);
    assert.equal(saved.brand_snapshot.actor_id, f.users.admin);
    assert.equal(
      (
        await db.query<any>(
          "select current_setting('pipeline_os.brand_context',true) v",
        )
      ).rows[0].v,
      "",
    );
    await assert.rejects(
      f.rpc("campaign_create_from_import", [
        {
          ...payload,
          brand_preparation: { ...preparation, account_revision: 999 },
        },
        randomUUID(),
      ]),
      /BRAND_PREPARATION_STALE/,
    );
    await f.asUser(f.users.admin);
    await f.command("activate_campaign", {
      id: created.id,
      brand_preparation: preparation,
    });
    const enrolled = (
      await db.query<any>(
        "select contact_id from campaign_enrollments where campaign_id=$1",
        [created.id],
      )
    ).rows.map((x: any) => x.contact_id);
    assert.deepEqual(enrolled, [inside]);
    assert(!enrolled.includes(outside));
    await f.db.exec("reset role");
    await assert.rejects(
      db.query("update campaigns set selected_contact_ids=$2 where id=$1", [
        created.id,
        [outside],
      ]),
      /BRAND_PREPARATION_REQUIRED/,
    );
  } finally {
    await db.close();
  }
});

test("CI: inherited service privilege correction is source guarded and changes only the five ACLs", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    await db.exec("create role supabase_admin superuser");
    const names = [
      "public.campaign_import_contact_rows(uuid)",
      "public.campaign_import_status(uuid)",
      "public.campaign_import_leads_page(uuid,uuid,uuid,text,int)",
      "public.campaign_verify_import(uuid,int,uuid)",
      "public.campaign_create_from_import(jsonb,uuid)",
    ];
    for (const name of names)
      await db.exec(
        `alter function ${name} owner to supabase_admin;grant execute on function ${name} to service_role`,
      );
    const sources = async () =>
      (
        await db.query<any>(
          "select oid::regprocedure::text signature,md5(prosrc) source from pg_proc where pronamespace='public'::regnamespace order by oid",
        )
      ).rows;
    const before = await sources();
    const sql = await readFile(
      sqlRoot + "revoke-inherited-service.sql",
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual(await sources(), before);
    for (const name of names)
      assert.equal(
        (
          await db.query<any>(
            "select has_function_privilege('service_role',$1::regprocedure,'execute') v",
            [name],
          )
        ).rows[0].v,
        false,
      );
    await db.exec(`alter function ${names[0]} owner to postgres`);
    await assert.rejects(db.exec(sql), /CI_PRIVILEGE_SOURCE_DRIFT/);
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});

async function fixture() {
  const f = await featureDatabase();
  const { db, users, asUser } = f;
  // Reproduce the production owner's inherited function grants before applying.
  await db.exec(
    "alter default privileges in schema public grant execute on functions to service_role",
  );
  await db.exec(await readFile(sqlRoot + "up.sql", "utf8"));
  const account = randomUUID(),
    template = randomUUID();
  await db.query(
    "insert into mail_accounts(id,email,organization,status,daily_limit,campaign_daily_limit,operational_reserve,external_usage_synced_at) values($1,'sender@example.test','Test','connected',120,100,20,now())",
    [account],
  );
  await db.query(
    "insert into email_templates(id,name,subject,body,created_by,updated_by) values($1,'Import template','Hello {{company}}','Hi {{name}} {{unsubscribe_url}}',$2,$2)",
    [template, users.admin],
  );
  async function batch(status = "completed") {
    await db.exec("reset role");
    const id = randomUUID();
    await db.query(
      "insert into import_batches(id,name,status,total,processed,storage_path,mapping,created_by,request_key) values($1,'Fixture.xlsx',$2,3,3,'fixture.xlsx','{}',$3,$4)",
      [id, status, users.admin, randomUUID()],
    );
    return id;
  }
  async function contact(b: string, verification = "valid") {
    await db.exec("reset role");
    const id = randomUUID();
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,$2,'Alex',$3)",
      [id, id + "@example.test", verification],
    );
    await db.query(
      "insert into leads(contact_id,company,seller_id) values($1,'Fixture business',$2)",
      [id, users.seller],
    );
    await db.query(
      "insert into import_rows(batch_id,row_number,contact_id,result) select $1,coalesce(max(row_number),0)+1,$2,'imported' from import_rows where batch_id=$1",
      [b, id],
    );
    return id;
  }
  const payload = (b: string) => ({
    import_batch_id: b,
    name: "Scoped campaign",
    account_id: account,
    seller_id: users.seller,
    template_id: template,
    template_version: 1,
    daily_limit: 80,
    timezone: "UTC",
    start_hour: 0,
    end_hour: 24,
    subject: "Hello {{company}}",
    body: "Hi {{name}} {{unsubscribe_url}}",
    steps: [],
  });
  async function rpc<T = any>(name: string, args: unknown[]) {
    await asUser(users.admin);
    return (
      await db.query<{ r: T }>(
        `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) r`,
        args,
      )
    ).rows[0].r;
  }
  return { ...f, account, template, batch, contact, payload, rpc };
}
test("CI: preview, snapshot and manual activation stay inside the chosen file; rollback preserves history", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    const a = await f.batch(),
      b = await f.batch(),
      inside = await f.contact(a),
      outside = await f.contact(b),
      invalid = await f.contact(a, "invalid");
    await db.query(
      "insert into import_rows(batch_id,row_number,contact_id,result) values($1,99,$2,'duplicate')",
      [a, inside],
    );
    const status = campaignImportStatusSchema.parse(
      await f.rpc("campaign_import_status", [a]),
    );
    assert.equal(status.counts.unique_contacts, 2);
    assert.equal(status.counts.valid, 1);
    assert.equal(status.ready, true);
    const preview = await f.rpc("campaign_import_leads_page", [
      a,
      f.template,
      f.account,
      "",
      0,
    ]);
    assert.equal(preview.eligible, 1);
    assert(!preview.rows.some((x: any) => x.contact_id === outside));
    await assert.rejects(
      f.rpc("campaign_create_from_import", [
        { ...f.payload(a), selected_contact_ids: [outside] },
        randomUUID(),
      ]),
      /CI_SELECTION_SCOPE/,
    );
    await assert.rejects(
      f.rpc("campaign_create_from_import", [
        { ...f.payload(a), selected_contact_ids: Array(5001).fill(inside) },
        randomUUID(),
      ]),
      /CI_SELECTION_LIMIT/,
    );
    const key = randomUUID(),
      created = await f.rpc("campaign_create_from_import", [f.payload(a), key]);
    assert.equal(
      (await f.rpc("campaign_create_from_import", [f.payload(a), key])).id,
      created.id,
    );
    await assert.rejects(
      f.rpc("campaign_create_from_import", [
        { ...f.payload(a), name: "Changed" },
        key,
      ]),
      /Idempotency/,
    );
    const saved = (
      await db.query<{
        batch_id: string;
        selected_contact_ids: string[];
        status: string;
      }>(
        "select batch_id,selected_contact_ids,status from campaigns where id=$1",
        [created.id],
      )
    ).rows[0];
    assert.equal(saved.batch_id, a);
    assert.deepEqual(saved.selected_contact_ids, [inside]);
    assert.equal(saved.status, "draft");
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from campaign_enrollments",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from outbox"))
        .rows[0].n,
      0,
    );
    await f.command("activate_campaign", { id: created.id });
    assert.deepEqual(
      (
        await db.query<{ contact_id: string }>(
          "select contact_id from campaign_enrollments where campaign_id=$1",
          [created.id],
        )
      ).rows.map((x) => x.contact_id),
      [inside],
    );
    assert(!saved.selected_contact_ids.includes(invalid));
    await db.exec("reset role");
    await db.exec(await readFile(sqlRoot + "down.sql", "utf8"));
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from campaigns where id=$1",
          [created.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from campaign_enrollments where campaign_id=$1",
          [created.id],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("CI: Bouncer approval freezes the count, is idempotent and never activates or retries uncertain work", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    const batch = await f.batch(),
      pending = await f.contact(batch, "pending");
    await f.contact(batch, "valid");
    await f.contact(batch, "uncertain");
    await assert.rejects(
      f.rpc("campaign_create_from_import", [f.payload(batch), randomUUID()]),
      /CI_VERIFICATION_PENDING/,
    );
    await assert.rejects(
      f.rpc("campaign_verify_import", [batch, 2, randomUUID()]),
      /CI_STALE/,
    );
    await assert.rejects(
      f.rpc("campaign_verify_import", [batch, null, randomUUID()]),
      /CI_INVALID_INPUT/,
    );
    const key = randomUUID(),
      r = await f.rpc("campaign_verify_import", [batch, 1, key]);
    assert.equal(r.queued, 1);
    assert.deepEqual(await f.rpc("campaign_verify_import", [batch, 1, key]), r);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from verifications where contact_id=$1",
          [pending],
        )
      ).rows[0].n,
      1,
    );
    const status = await f.rpc("campaign_import_status", [batch]);
    assert.equal(status.counts.pending, 0);
    assert.equal(status.counts.running, 1);
    assert.equal(status.ready, false);
    await assert.rejects(
      f.rpc("campaign_verify_import", [batch, 1, randomUUID()]),
      /CI_STALE/,
    );
    await db.exec("reset role");
    await db.query(
      "update verifications set state='uncertain_request' where contact_id=$1",
      [pending],
    );
    const review = await f.rpc("campaign_import_status", [batch]);
    assert.equal(review.counts.attention, 1);
    assert.equal(review.next_verification_count, 0);
    const running = await f.batch("running");
    await f.contact(running, "pending");
    await assert.rejects(
      f.rpc("campaign_verify_import", [running, 1, randomUUID()]),
      /CI_IMPORT_RUNNING/,
    );
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from campaigns"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from outbox"))
        .rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("CI: RPCs reject non-admin, aal1, missing batches and unauthorized senders", async () => {
  const f = await fixture();
  const { db, users, asUser } = f;
  try {
    const privileges = (
      await db.query<{ service: boolean; anon: boolean; helper: boolean }>(
        "select has_function_privilege('service_role',p.oid,'execute') service,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') helper from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('campaign_import_contact_rows','campaign_import_status','campaign_import_leads_page','campaign_verify_import','campaign_create_from_import')",
      )
    ).rows;
    assert.equal(privileges.length, 5);
    assert(privileges.every((x) => !x.service && !x.anon));
    assert.equal(privileges.filter((x) => x.helper).length, 4);
    const batch = await f.batch();
    await f.contact(batch);
    await asUser(users.seller);
    await assert.rejects(
      db.query("select campaign_import_status($1)", [batch]),
      /CI_FORBIDDEN/,
    );
    await asUser(users.admin, "aal1");
    await assert.rejects(
      db.query("select campaign_import_status($1)", [batch]),
      /CI_FORBIDDEN/,
    );
    await asUser(users.admin);
    await assert.rejects(
      db.query("select campaign_import_status($1)", [randomUUID()]),
      /CI_BATCH_NOT_FOUND/,
    );
    await asUser(users.admin);
    await assert.rejects(
      db.query("select campaign_import_contact_rows($1)", [batch]),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query("update profiles set role='seller_admin' where id=$1", [
      users.seller,
    ]);
    await asUser(users.seller);
    await assert.rejects(
      db.query("select campaign_import_leads_page($1,$2,$3)", [
        batch,
        f.template,
        f.account,
      ]),
      /sender access required/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select campaign_import_status($1)", [batch]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("CI: HTTP contract fails closed on missing RPC and never falls back to global leads", async () => {
  const calls: string[] = [];
  const ctx = {
    profile: { role: "superadmin" },
    db: {
      rpc: async (name: string) => {
        calls.push(name);
        return { data: null, error: { code: "PGRST202", message: "missing" } };
      },
    },
  } as unknown as ImportCampaignContext;
  await assert.rejects(
    readImportCampaign(
      new URL(
        "https://crm.test" +
          importCampaignHref(randomUUID(), randomUUID(), randomUUID()),
      ),
      ctx,
    ),
    (e: any) => e.status === 503,
  );
  assert.deepEqual(calls, ["campaign_import_leads_page"]);
  await assert.rejects(
    readImportCampaign(
      new URL("https://crm.test" + importCampaignHref(randomUUID())),
      { ...ctx, profile: { role: "seller" } },
    ),
    (e: any) => e.status === 403,
  );
  await assert.rejects(
    writeImportCampaign(
      {
        kind: "verify",
        batch: randomUUID(),
        expected_count: 5001,
        request_key: randomUUID(),
      },
      ctx,
    ),
  );
  const bad = importCampaignError(new Error("sensitive provider details"));
  assert.equal(bad.status, 500);
  assert(!(await bad.text()).includes("sensitive"));
});
