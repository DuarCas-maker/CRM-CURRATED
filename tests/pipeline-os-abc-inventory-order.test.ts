import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  abcFinalRoot,
  abcFinalFixture,
} from "./fixtures/pipeline-os-abc-final";
const compare = `select $1::jsonb=$2::jsonb ordered,
 (select coalesce(jsonb_object_agg(k,true),'{}') from jsonb_array_elements_text($1::jsonb) k)
 = (select coalesce(jsonb_object_agg(k,true),'{}') from jsonb_array_elements_text($2::jsonb) k) exact_set`;

test("AF-INV-AC01: collation identity differs between direct catalog signatures and JSON keys", async () => {
  const db = new PGlite();
  try {
    const rows = (
      await db.query(`select
      pg_collation_for(format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes))) direct_collation,
      pg_collation_for(k) json_key_collation
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join lateral jsonb_object_keys(jsonb_build_object(format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)),true)) k limit 1`)
    ).rows;
    assert.deepEqual(rows, [
      { direct_collation: '"C"', json_key_collation: '"default"' },
    ]);
  } finally {
    await db.close();
  }
});

test("AF-INV-AC01: same206 signatures in a different locale order reproduce the old false rejection", async () => {
  const db = new PGlite();
  try {
    const contract = JSON.parse(
      await readFile(abcFinalRoot + "contract.json", "utf8"),
    );
    const expected = contract.basePublicFunctionNames as string[];
    const locale = [...expected].sort(new Intl.Collator("en-US").compare);
    assert.equal(expected.length, 206);
    assert.equal(new Set(expected).size, 206);
    assert.notDeepEqual(expected, locale);
    assert.deepEqual(
      (
        await db.query(compare, [
          JSON.stringify(expected),
          JSON.stringify(locale),
        ])
      ).rows,
      [{ ordered: false, exact_set: true }],
    );
  } finally {
    await db.close();
  }
});
test("AF-INV-AC02: exact-set guard still rejects missing, extra, replacement and case-different signatures", async () => {
  const db = new PGlite();
  try {
    const expected = ["public.alpha(uuid)", "public.beta()"];
    for (const actual of [
      expected.slice(1),
      [...expected, "public.extra()"],
      [expected[0], "public.extra()"],
      [expected[0], "public.Beta()"],
    ])
      assert.equal(
        (
          await db.query<{ exact_set: boolean }>(compare, [
            JSON.stringify(expected),
            JSON.stringify(actual),
          ])
        ).rows[0].exact_set,
        false,
      );
  } finally {
    await db.close();
  }
});
test("AF-INV-AC03: corrected exact SQL and postflight apply offline without changing contract or source bodies", async () => {
  const f = await abcFinalFixture();
  try {
    const sql = await readFile(
      abcFinalRoot + "049_integrate_mail_identity_brands_and_bindings.sql",
      "utf8",
    );
    const post = await readFile(abcFinalRoot + "postflight.sql", "utf8");
    assert(!sql.includes("jsonb_agg(fn_name order by fn_name)"));
    assert(!post.includes("jsonb_agg(fn_name order by fn_name)"));
    assert.equal(
      (sql.match(/jsonb_object_agg\(fn_name,true\)/g) || []).length,
      4,
    );
    assert.equal(
      (post.match(/jsonb_object_agg\(fn_name,true\)/g) || []).length,
      2,
    );
    const contract = JSON.parse(
      await readFile(abcFinalRoot + "contract.json", "utf8"),
    );
    for (const file of contract.sourceFiles) {
      const s = await readFile(file.path, "utf8");
      const start = s.indexOf(
        file.path.includes("a-brand-foundation")
          ? "create table public.operating_brands"
          : "create schema ",
      );
      assert(sql.includes(s.slice(start).replace(/commit;\s*$/, "")));
    }
    const result = (await f.db.exec(sql))
      .flatMap((r) => r.rows)
      .find((r: any) => r.pipeline_os_abc_application)
      ?.pipeline_os_abc_application as any;
    const observed = (await f.db.exec(post))
      .flatMap((r) => r.rows)
      .find((r: any) => r.pipeline_os_abc_postflight)
      ?.pipeline_os_abc_postflight as any;
    assert(
      result.targetsOk &&
        result.preservationMatches &&
        observed.targetsOk &&
        observed.rolesOk,
    );
    assert.equal(result.protectedAfter, observed.protectedFingerprint);
    assert.equal(result.contractSha256, observed.contractSha256);
  } finally {
    await f.db.close();
  }
});
test("AF-INV-AC03: proposed READ ONLY diagnostic distinguishes a real extra function", async () => {
  const f = await abcFinalFixture();
  try {
    const diagnostic = await readFile(
      abcFinalRoot + "inventory-r2/diagnostic.sql",
      "utf8",
    );
    const observe = async () =>
      (await f.db.exec(diagnostic))
        .flatMap((r) => r.rows)
        .find((r: any) => r.pipeline_os_abc_inventory_diagnostic)
        ?.pipeline_os_abc_inventory_diagnostic as any;
    const clean = await observe();
    assert(clean.exactSetMatch);
    assert.equal(clean.missingCount, 0);
    assert.equal(clean.extraCount, 0);
    assert.equal(clean.readOnly, "on");
    await f.db.exec(
      "create function public.af_inventory_extra() returns integer language sql as $$select 1$$",
    );
    const changed = await observe();
    assert.equal(changed.exactSetMatch, false);
    assert.equal(changed.extraCount, 1);
    assert.deepEqual(changed.extraFirst25, ["public.af_inventory_extra()"]);
  } finally {
    await f.db.close();
  }
});
