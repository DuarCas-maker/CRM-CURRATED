import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";

test("the imported-contact index preserves aggregates and RLS while providing a selective access path", async () => {
  const { db, users, asUser } = await featureDatabase({
    beforeMigration: "058_workspace_imported_contact_index.sql",
  });
  const root = "docs/specs/application-performance-20261118/database/";
  try {
    const contacts = [randomUUID(), randomUUID()],
      batch = randomUUID();
    for (let i = 0; i < contacts.length; i++) {
      await db.query(
        "insert into contacts(id,email,verification) values($1,$2,'valid')",
        [contacts[i], `index-${i}@fixture.test`],
      );
      await db.query(
        "insert into opportunities(contact_id,company,seller_id,amount,stage) values($1,$2,$3,$4,'new')",
        [
          contacts[i],
          `Index fixture ${i}`,
          i ? users.outsider : users.seller,
          100 + i,
        ],
      );
    }
    await db.query(
      "insert into import_batches(id,name,storage_path,mapping,created_by,request_key) values($1,'Index fixture','fixture.csv','{}',$2,$3)",
      [batch, users.admin, randomUUID()],
    );
    await db.query(
      "insert into import_rows(batch_id,row_number,contact_id,result) values($1,1,$2,'imported'),($1,2,$2,'imported'),($1,3,$3,'imported')",
      [batch, ...contacts],
    );
    await db.query(
      "insert into import_rows(batch_id,row_number,result) select $1,n,'skipped' from generate_series(4,5000)n",
      [batch],
    );
    const guards = (
      await db.query(
        "select md5(prosrc) as body,proacl::text acl from pg_proc where oid='public.workspace_stats(text,text,uuid,uuid,timestamptz)'::regprocedure",
      )
    ).rows;
    const actors: [
      [string, string],
      [string, string],
      [string, string],
      [string, string],
    ] = [
      [users.admin, "aal2"],
      [users.seller, "aal2"],
      [users.outsider, "aal2"],
      [users.seller, "aal1"],
    ];
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select workspace_stats()"),
      /permission denied/i,
    );
    await db.exec("reset role;begin");
    const baseline = [];
    for (const [actor, aal] of actors) {
      await asUser(actor, aal);
      baseline.push(
        (
          await db.query<{ value: unknown }>(
            "select workspace_stats() as value",
          )
        ).rows[0].value,
      );
    }
    await db.exec("reset role");
    const bootstrap = await readFile(
      "supabase/migrations/058_workspace_imported_contact_index.sql",
      "utf8",
    );
    const concurrent = await readFile(root + "index.sql", "utf8");
    const statement = (text: string) => text.replace(/^--.*$/gm, "").trim();
    assert.equal(
      statement(concurrent).replace("CREATE INDEX CONCURRENTLY", "CREATE INDEX"),
      statement(bootstrap),
      "bootstrap and reviewed live DDL must create exactly the same index",
    );
    // PGlite is single-user; use the canonical bootstrap migration here.
    await db.exec(bootstrap);
    await db.exec("analyze public.import_rows");
    for (let i = 0; i < actors.length; i++) {
      await asUser(...actors[i]);
      assert.deepEqual(
        (
          await db.query<{ value: unknown }>(
            "select workspace_stats() as value",
          )
        ).rows[0].value,
        baseline[i],
      );
    }
    await asUser(users.admin);
    const plan = await db.query(
      "explain(format json) select contact_id from import_rows where contact_id=$1 and result='imported'",
      [contacts[0]],
    );
    assert(
      JSON.stringify(plan.rows).includes(
        "workspace_import_rows_imported_contact_idx",
      ),
    );
    assert.equal(
      (baseline[0] as { imported: number }).imported,
      2,
      "duplicate import rows never double-count an opportunity",
    );
    assert.equal((baseline[1] as { imported: number }).imported, 1);
    assert.equal((baseline[2] as { imported: number }).imported, 1);
    await db.exec("reset role;savepoint anon_check;set role anon");
    await assert.rejects(
      db.query("select workspace_stats()"),
      /permission denied/i,
    );
    await db.exec("rollback to savepoint anon_check");
    await db.exec("reset role");
    assert.deepEqual(
      (
        await db.query(
          "select md5(prosrc) as body,proacl::text acl from pg_proc where oid='public.workspace_stats(text,text,uuid,uuid,timestamptz)'::regprocedure",
        )
      ).rows,
      guards,
    );
    await db.exec(
      (await readFile(root + "down.sql", "utf8")).replace(
        "DROP INDEX CONCURRENTLY",
        "DROP INDEX",
      ),
    );
    assert.equal(
      (
        await db.query<{ index: string | null }>(
          "select to_regclass('public.workspace_import_rows_imported_contact_idx') as index",
        )
      ).rows[0].index,
      null,
    );
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});
