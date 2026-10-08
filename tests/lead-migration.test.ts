import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { demoWorkspace } from "../src/lib/demo";
import { demoAction } from "../src/lib/demo-actions";

test("demo imports and new leads stay outside opportunities", () => {
  const d = demoWorkspace();
  assert.ok(d.opportunities.every((o) => o.verification === "valid"));
  const changed = demoAction(d, d.profile, "import_demo", {
    name: "test.csv",
    mapping: { email: "Email", contact: "Name", company: "Company" },
    rows: [
      { Email: "new@example.com", Name: "New Person", Company: "New LLC" },
    ],
  });
  assert.equal(changed.opportunities.length, d.opportunities.length);
  assert.equal(changed.leads.length, d.leads.length + 1);
  assert.equal(changed.leads.at(-1)?.opportunity_id, null);
});

test("upgrade preserves an unverified legacy case and reactivates its exact history only after validation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon,service_role; grant select on storage.objects to authenticated;`);
    const files = (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files.filter((f) => f < "008"))
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const owner = randomUUID(),
      contact = randomUUID(),
      company = randomUUID(),
      opportunity = randomUUID();
    await db.query(
      "insert into auth.users(id,email) values($1,'legacy-seller@example.com')",
      [owner],
    );
    await db.query(
      "insert into profiles(id,name,email,role) values($1,'Legacy seller','legacy-seller@example.com','seller')",
      [owner],
    );
    await db.query(
      "insert into companies(id,name) values($1,'Legacy company')",
      [company],
    );
    await db.query(
      "insert into contacts(id,company_id,email,name) values($1,$2,'legacy@example.com','Legacy contact')",
      [contact, company],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company_id,company,seller_id,stage) values($1,$2,$3,'Legacy company',$4,'replied')",
      [opportunity, contact, company, owner],
    );
    await db.query(
      "insert into activities(opportunity_id,actor_id,type,area,body) values($1,$2,'note','seller','Preserve this history')",
      [opportunity, owner],
    );
    await db.query("select initialize_checklist($1,'Business loan')", [
      opportunity,
    ]);
    await db.exec(
      await readFile("supabase/migrations/008_lead_preparation.sql", "utf8"),
    );
    assert.equal(
      (await db.query("select * from opportunities where id=$1", [opportunity]))
        .rows.length,
      1,
    );
    assert.equal(
      (
        await db.query("select * from activities where opportunity_id=$1", [
          opportunity,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query("select * from documents where opportunity_id=$1", [
          opportunity,
        ])
      ).rows.length,
      5,
    );
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: owner, aal: "aal2" }),
    ]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select * from opportunity_workspace")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from lead_workspace where opportunity_id is null",
        )
      ).rows.length,
      1,
    );
    await assert.rejects(
      db.query("select promote_verified_lead($1)", [contact]),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query(
      "insert into verifications(contact_id,request_key,result,state,provider_batch_id) values($1,'legacy-check','pending','submitted','legacy-batch')",
      [contact],
    );
    await db.query("select apply_verification_results('legacy-batch',$1)", [
      JSON.stringify([
        {
          email: "legacy@example.com",
          result: "valid",
          reason: "accepted_email",
        },
      ]),
    ]);
    await db.exec("set role authenticated");
    const restored = (
      await db.query<{ id: string; stage: string }>(
        "select id,stage from opportunity_workspace",
      )
    ).rows;
    assert.deepEqual(restored, [{ id: opportunity, stage: "replied" }]);
    assert.equal(
      (
        await db.query(
          "select * from lead_workspace where opportunity_id is null",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from activities where opportunity_id=$1", [
          opportunity,
        ])
      ).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
