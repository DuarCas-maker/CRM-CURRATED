import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import {
  abcFinalRoot,
  abcFinalFixture,
  abcSnapshot,
} from "./fixtures/pipeline-os-abc-final";
import { bindFixtureAccount } from "./fixtures/pipeline-os-s02-brand-delivery";

let f: Awaited<ReturnType<typeof abcFinalFixture>>;
let sql: string, post: string, contract: any;
let beforeCatalog: Awaited<ReturnType<typeof abcSnapshot>>;
let beforeRows: unknown;
let originalColumns: { name: string; columns: string[] }[];
let receipt: any;
let legacyDocument: string;
const run = async (text: string, admin = true) => {
  if (admin) await f.admin();
  try {
    return await f.db.exec(text);
  } catch (error) {
    await f.db.exec("rollback");
    throw error;
  }
};
const observe = async () =>
  (await run(post))
    .flatMap((r) => r.rows)
    .find((r: any) => r.pipeline_os_abc_postflight)
    ?.pipeline_os_abc_postflight as any;
const oldRows = async () => {
  await f.admin();
  const result = [];
  for (const t of originalColumns) {
    const fields = t.columns.map((n) => JSON.stringify(n)).join(",");
    result.push({
      table: t.name,
      rows: (
        await f.db.query(
          `select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]')::text) hash from(select ${fields} from public.${JSON.stringify(t.name)}) r`,
        )
      ).rows[0],
    });
  }
  return result;
};
before(async () => {
  f = await abcFinalFixture();
  sql = await readFile(
    abcFinalRoot + "049_integrate_mail_identity_brands_and_bindings.sql",
    "utf8",
  );
  post = await readFile(abcFinalRoot + "postflight.sql", "utf8");
  contract = JSON.parse(await readFile(abcFinalRoot + "contract.json", "utf8"));
  legacyDocument = randomUUID();
  await f.admin();
  await f.db.query(
    "insert into public.documents(id,opportunity_id,name,kind,storage_path,content_hash) values($1,$2,'AF fixture','af_unknown','af-path','af-hash')",
    [legacyDocument, f.opportunity],
  );
  await f.db.query(
    "insert into public.document_versions(document_id,storage_path,content_hash,source) values($1,'af-path','af-hash','fixture')",
    [legacyDocument],
  );
  beforeCatalog = await abcSnapshot(f);
  originalColumns = (
    await f.db.query<{ name: string; columns: string[] }>(
      `select c.relname name,array_agg(a.attname order by a.attnum) columns from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped where n.nspname='public' and c.relkind='r' group by c.relname order by c.relname`,
    )
  ).rows;
  beforeRows = await oldRows();
});
after(async () => {
  await f?.db.close();
});

test("AF-AC01/06: final SQL binds the exact contract and five unchanged sources", async () => {
  const sha = (v: Buffer) => createHash("sha256").update(v).digest("hex");
  const digest = sha(await readFile(abcFinalRoot + "contract.json"));
  assert(sql.includes(digest) && post.includes(digest));
  assert.equal(contract.sourceFiles.length, 5);
  for (const item of contract.sourceFiles)
    assert.equal(sha(await readFile(item.path)), item.sha256);
  assert(
    !sql.includes("in_memory_test") &&
      !sql.includes("pipeline_os.block_a_local"),
  );
  assert.match(sql, /begin isolation level serializable;/);
  assert.match(sql, /commit;\s*$/);
  assert(
    !/alter default privileges|\bfetch\s*\(/i.test(
      sql.replace(/--[^\n]*/g, ""),
    ),
  );
  assert.equal(contract.ordinal, "049");
});
test("AF-AC02: wrong SQL actor aborts before any product DDL", async () => {
  await f.db.exec("reset role");
  await assert.rejects(run(sql, false), /ABC_CONTEXT_MISMATCH/);
  assert.deepEqual(await abcSnapshot(f), beforeCatalog);
});
test("AF-AC02/04: sending attempt blocks cutover without changing the attempt", async () => {
  await f.admin();
  const account = (
    await f.db.query<{ id: string }>(
      "select id from public.mail_accounts order by id limit 1",
    )
  ).rows[0].id;
  const id = randomUUID();
  await f.db.query(
    "insert into public.outbox(id,account_id,opportunity_id,to_email,subject,body,area,status,message_id_header,request_key) values($1,$2,$3,'af@example.test','Fixture','Fixture','seller','sending',$4,$5)",
    [id, account, f.opportunity, "<" + id + "@example.test>", id],
  );
  try {
    await assert.rejects(run(sql), /ABC_INFLIGHT_DRAIN_REQUIRED/);
    assert.deepEqual(
      (
        await f.db.query(
          "select status,message_id_header from public.outbox where id=$1",
          [id],
        )
      ).rows,
      [{ status: "sending", message_id_header: "<" + id + "@example.test>" }],
    );
    assert.deepEqual(await abcSnapshot(f), beforeCatalog);
  } finally {
    await f.admin();
    await f.db.query("delete from public.outbox where id=$1", [id]);
  }
});
test("AF-AC02/03: unremediated human grant from before048 aborts", async () => {
  await f.admin();
  await f.db.exec("grant select on public.campaign_assets to anon");
  try {
    await assert.rejects(run(sql), /ABC_REQUIRES_ACCEPTED_048/);
  } finally {
    await f.admin();
    await f.db.exec("revoke select on public.campaign_assets from anon");
  }
  assert.deepEqual(await abcSnapshot(f), beforeCatalog);
});
test("AF-AC02: a source-body drift is rejected even if its signature still matches", async () => {
  await f.admin();
  const definition = (
    await f.db.query<{ definition: string }>(
      "select pg_get_functiondef('public.claim_outbox()'::regprocedure) definition",
    )
  ).rows[0].definition;
  assert(definition.includes("AS $function$"));
  await f.db.exec(
    definition.replace(
      "AS $function$",
      "AS $function$\n-- AF synthetic drift\n",
    ),
  );
  try {
    await assert.rejects(run(sql), /ABC_BASE_CONTRACT_MISMATCH/);
  } finally {
    await f.admin();
    await f.db.exec(definition);
  }
  assert.deepEqual(await abcSnapshot(f), beforeCatalog);
});
test("AF-AC02: partial private schema is not adopted or replaced", async () => {
  await f.admin();
  await f.db.exec("create schema brand_b1");
  try {
    await assert.rejects(run(sql), /ABC_ALREADY_OR_PARTIALLY_INSTALLED/);
  } finally {
    await f.admin();
    await f.db.exec("drop schema brand_b1");
  }
  assert.deepEqual(await abcSnapshot(f), beforeCatalog);
});
test("AF-AC02/03: public schema CREATE by an application role blocks type resolution", async () => {
  await f.admin();
  await f.db.exec("grant create on schema public to authenticated");
  try {
    await assert.rejects(run(sql), /ABC_CONTEXT_MISMATCH/);
  } finally {
    await f.admin();
    await f.db.exec("revoke create on schema public from authenticated");
  }
});
test("AF-AC02/04: failure after five bodies rolls all DDL and backfill back", async () => {
  const marker = "-- Explicit final ACL for changed/new objects;";
  assert(sql.includes(marker));
  await assert.rejects(
    run(
      sql.replace(
        marker,
        "do $abort$ begin raise exception 'AF_TEST_ABORT';end $abort$;\n" +
          marker,
      ),
    ),
    /AF_TEST_ABORT/,
  );
  assert.deepEqual(await abcSnapshot(f), beforeCatalog);
  assert.deepEqual(await oldRows(), beforeRows);
});
test("AF-AC01/03/04/05: exact final artifact applies under broad defaults and postflight matches", async () => {
  const rows = await run(sql);
  receipt = rows
    .flatMap((r) => r.rows)
    .find((r: any) => r.pipeline_os_abc_application)
    ?.pipeline_os_abc_application as any;
  assert(receipt.targetsOk && receipt.preservationMatches);
  assert.equal(receipt.stage, "checked_before_commit");
  assert.equal(receipt.protectedBefore, receipt.protectedAfter);
  const observed = await observe();
  assert(observed.targetsOk && observed.rolesOk);
  assert.equal(observed.context.readOnly, "on");
  assert.equal(observed.contractSha256, receipt.contractSha256);
  assert.equal(observed.protectedFingerprint, receipt.protectedAfter);
  assert.deepEqual(await oldRows(), beforeRows);
  await f.admin();
  const counts = (
    await f.db.query<{ v: any }>(
      `select jsonb_build_object('brands',(select count(*) from public.operating_brands),'bindings',(select count(*) from public.mail_provider_bindings),'admissions',(select count(*) from public.mail_brand_dispatch_admissions)) v`,
    )
  ).rows[0].v;
  assert.deepEqual(counts, { brands: 0, bindings: 0, admissions: 0 });
});
test("AF-AC02/04: replay refuses the installed schema and preserves its state", async () => {
  const catalog = await abcSnapshot(f);
  await assert.rejects(run(sql), /ABC_ALREADY_OR_PARTIALLY_INSTALLED/);
  assert.deepEqual(await abcSnapshot(f), catalog);
  assert.deepEqual(await oldRows(), beforeRows);
});
test("AF-AC03/04: unknown legacy content stays unassigned and inaccessible to seller", async () => {
  await f.admin();
  assert.deepEqual(
    (
      await f.db.query("select access_area from public.documents where id=$1", [
        legacyDocument,
      ])
    ).rows,
    [{ access_area: null }],
  );
  assert.deepEqual(
    (
      await f.db.query(
        "select access_area from public.document_versions where document_id=$1",
        [legacyDocument],
      )
    ).rows,
    [{ access_area: null }],
  );
  await f.asUser(f.users.seller);
  assert.equal(
    (
      await f.db.query<{ allowed: boolean }>(
        "select public.mail_source_allowed('document',$1,null) allowed",
        [legacyDocument],
      )
    ).rows[0].allowed,
    false,
  );
});
test("AF-AC03/05: missing service-only boundary is detected separately from protected hash", async () => {
  await f.admin();
  await f.db.exec(
    "grant execute on function public.composio_binding_check_finish(uuid,text,text,jsonb) to authenticated",
  );
  try {
    const observed = await observe();
    assert.equal(observed.targetsOk, false);
    assert.equal(observed.protectedFingerprint, receipt.protectedAfter);
  } finally {
    await f.admin();
    await f.db.exec(
      "revoke execute on function public.composio_binding_check_finish(uuid,text,text,jsonb) from authenticated",
    );
  }
});
test("AF-AC04/05: default ACL drift changes protected fingerprint without changing target objects", async () => {
  await f.admin();
  await f.db.exec(
    "alter default privileges for role supabase_admin in schema public revoke execute on functions from anon",
  );
  try {
    const observed = await observe();
    assert(observed.targetsOk);
    assert.notEqual(observed.protectedFingerprint, receipt.protectedAfter);
  } finally {
    await f.admin();
    await f.db.exec(
      "alter default privileges for role supabase_admin in schema public grant execute on functions to anon",
    );
  }
  assert.equal((await observe()).protectedFingerprint, receipt.protectedAfter);
});
test("AF-AC05: postflight rejects an injected write with READ ONLY", async () => {
  const marker = "select current_setting('pipeline_os.abc_postflight')";
  assert(post.includes(marker));
  await assert.rejects(
    run(
      post.replace(
        marker,
        "insert into public.jobs(kind,payload,dedupe_key) values('gmail_sync','{}','AF_NOT_ALLOWED');\n" +
          marker,
      ),
    ),
    (e: any) => e.code === "25006",
  );
  assert.deepEqual(await oldRows(), beforeRows);
});
test("AF-AC03: roles/MFA and scoped administrative RPC still work with the real owner model", async () => {
  await f.admin();
  const account = (
    await f.db.query<{ id: string }>(
      "select id from public.mail_accounts order by id limit 1",
    )
  ).rows[0].id;
  await f.db.exec("set search_path=pg_catalog,public,pg_temp");
  await f.asUser(f.users.admin, "aal1");
  await assert.rejects(
    f.command("brand_create", {
      code: "AF_LOW_MFA",
      name: "Fixture",
      active: true,
    }),
    /BRAND_FORBIDDEN|MFA|permission denied|Application role/i,
  );
  await bindFixtureAccount(f, account, f.users.seller);
  await f.asUser(f.users.outsider);
  assert.equal(
    (await f.db.query("select id from public.operating_brands")).rows.length,
    0,
  );
  await f.db.exec("reset role;set role anon");
  await assert.rejects(
    f.db.query("select * from public.operating_brands"),
    /permission denied/,
  );
  await assert.rejects(
    f.db.query("select public.composio_binding_page($1,null,25)", [account]),
    /permission denied/,
  );
  await f.asUser(f.users.seller);
  assert.equal(
    (await f.db.query("select id from public.operating_brands")).rows.length,
    1,
  );
  await assert.rejects(
    f.db.query("select public.composio_binding_check_finish($1,'x','y','{}')", [
      account,
    ]),
    /permission denied/,
  );
  assert((await observe()).targetsOk);
});
