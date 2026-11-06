import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { featureDatabase } from "./feature-database";

const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error("I01_NETWORK_DISABLED");
};
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkAttempts, 0);
});

const root = "tests/fixtures/pipeline-os-s01/";
const tables = [
  "operating_brands",
  "operating_brand_memberships",
  "mail_account_brand_reviews",
] as const;
type Fixture = Awaited<ReturnType<typeof featureDatabase>>;

async function owner(f: Fixture) {
  await f.db.exec(
    "reset role;select set_config('request.jwt.claims','',false)",
  );
}
async function marker(f: Fixture) {
  await f.db.exec("set pipeline_os.i01_sandbox='in_memory_test'");
}
async function catalog(f: Fixture) {
  return (
    await f.db.query(`
      select 'policy' kind, schemaname||'.'||tablename||'.'||policyname name,
        jsonb_build_array(permissive,roles,cmd,qual,with_check)::text definition
      from pg_policies where schemaname in ('public','storage')
        and tablename not in ('operating_brands','operating_brand_memberships','mail_account_brand_reviews')
      union all
      select 'function',p.oid::regprocedure::text,pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' and p.proname<>'s01_i01_guard_confirmed_review'
      union all
      select 'view',schemaname||'.'||viewname,definition from pg_views where schemaname='public'
      order by kind,name
    `)
  ).rows;
}
async function legacy(f: Fixture) {
  return (
    await f.db.query(`
      select 'account' kind,id::text id,(to_jsonb(a)-'operating_brand_id'-'brand_revision')::text data
      from mail_accounts a
      union all select 'case',id::text,to_jsonb(o)::text from opportunities o
      union all select 'contact',id::text,to_jsonb(c)::text from contacts c
      union all select 'company',id::text,to_jsonb(c)::text from companies c
      union all select 'permission',account_id::text||':'||user_id::text,to_jsonb(p)::text from mail_permissions p
      order by kind,id
    `)
  ).rows;
}

test("I01 brand foundation: constraints, five-role RLS and fixture-only reversal", async (t) => {
  const f = await featureDatabase();
  try {
    const up = await readFile(root + "t01-02-i01-foundation.sql", "utf8");
    const down = await readFile(
      root + "t01-02-i01-foundation.rollback.sql",
      "utf8",
    );
    const admin = f.users.admin;
    const people: { id: string; role: string; brand: number }[] = [];
    for (const role of ["seller_admin", "seller", "closer_admin", "closer"])
      for (const brand of [0, 1]) {
        const id = randomUUID();
        await f.db.query("insert into auth.users values($1,$2)", [
          id,
          `${id}@fixture.test`,
        ]);
        await f.db.query(
          "insert into profiles(id,name,email,role) values($1,$2,$3,$4)",
          [id, "Fixture operator", `${id}@fixture.test`, role],
        );
        people.push({ id, role, brand });
      }
    const inactive = randomUUID();
    await f.db.query(
      "insert into auth.users values($1,'inactive@fixture.test')",
      [inactive],
    );
    await f.db.query(
      "insert into profiles(id,name,email,role,active) values($1,'Inactive','inactive@fixture.test','superadmin',false)",
      [inactive],
    );
    const accounts = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < accounts.length; i++)
      await f.db.query(
        "insert into mail_accounts(id,email,organization) values($1,$2,'fixture')",
        [accounts[i], `a${i + 1}@fixture.test`],
      );
    await f.db.query(
      "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true)",
      [accounts[0], f.users.seller],
    );
    const company = randomUUID(),
      contact = randomUUID(),
      caseId = randomUUID();
    await f.db.query(
      "insert into companies(id,name) values($1,'Fixture company')",
      [company],
    );
    await f.db.query(
      "insert into contacts(id,company_id,email,name,verification) values($1,$2,'client@fixture.test','Fixture','valid')",
      [contact, company],
    );
    await f.db.query(
      "insert into opportunities(id,company_id,contact_id,company,seller_id) values($1,$2,$3,'Fixture company',$4)",
      [caseId, company, contact, f.users.seller],
    );
    const beforeCatalog = await catalog(f),
      beforeLegacy = await legacy(f);

    await t.test("sandbox marker is required before any DDL", async () => {
      await assert.rejects(() => f.db.exec(up), /sandbox marker/);
      await f.db.exec("rollback");
      assert.equal(
        (
          await f.db.query<{ present: string | null }>(
            "select to_regclass('public.operating_brands') present",
          )
        ).rows[0].present,
        null,
      );
    });
    await marker(f);
    await f.db.exec(up);
    const brands = [randomUUID(), randomUUID()];
    for (let i = 0; i < brands.length; i++)
      await f.db.query(
        "insert into operating_brands(id,code,name,active,created_by,updated_by) values($1,$2,$2,$3,$4,$4)",
        [brands[i], `M${i + 1}`, i === 0, admin],
      );
    for (const person of people)
      await f.db.query(
        "insert into operating_brand_memberships(brand_id,user_id,assigned_by) values($1,$2,$3)",
        [brands[person.brand], person.id, admin],
      );
    await f.db.query(
      "insert into operating_brand_memberships(brand_id,user_id,active,assigned_by,revoked_by,revoked_at,revision) values($1,$2,false,$3,$3,now(),2)",
      [brands[1], people[0].id, admin],
    );
    const pending = randomUUID();
    await f.db.query(
      "insert into mail_account_brand_reviews(id,account_id,proposed_brand_id,expected_account_revision,request_key,created_by) values($1,$2,$3,0,$4,$5)",
      [pending, accounts[0], brands[0], randomUUID(), admin],
    );

    await t.test(
      "new tables have RLS and do not alter old mail policies or business data",
      async () => {
        const rls = (
          await f.db.query<{ tablename: string; rowsecurity: boolean }>(
            "select tablename,rowsecurity from pg_tables where schemaname='public' and tablename in ('operating_brands','operating_brand_memberships','mail_account_brand_reviews')",
          )
        ).rows;
        assert.equal(rls.length, 3);
        assert(rls.every((row) => row.rowsecurity));
        assert.deepEqual(await catalog(f), beforeCatalog);
        assert.deepEqual(await legacy(f), beforeLegacy);
        const rows = (
          await f.db.query<{
            operating_brand_id: string | null;
            brand_revision: number | string;
          }>("select operating_brand_id,brand_revision from mail_accounts")
        ).rows;
        assert(
          rows.every(
            (row) =>
              row.operating_brand_id === null &&
              Number(row.brand_revision) === 0,
          ),
        );
      },
    );

    await t.test(
      "all four operating roles see only assigned brands and their own memberships",
      async () => {
        for (const person of people) {
          await f.asUser(person.id);
          assert.deepEqual(
            (
              await f.db.query<{ code: string }>(
                "select code from operating_brands order by code",
              )
            ).rows.map((row) => row.code),
            [`M${person.brand + 1}`],
            person.role,
          );
          const memberships = (
            await f.db.query<{ user_id: string }>(
              "select user_id from operating_brand_memberships",
            )
          ).rows;
          assert(memberships.length > 0);
          assert(memberships.every((row) => row.user_id === person.id));
          assert.equal(
            (await f.db.query("select * from mail_account_brand_reviews")).rows
              .length,
            0,
          );
          assert.equal(
            (
              await f.db.query<{ allowed: boolean }>(
                "select can_send($1) allowed",
                [accounts[0]],
              )
            ).rows[0].allowed,
            false,
          );
        }
        await f.asUser(f.users.seller);
        assert.equal(
          (
            await f.db.query<{ allowed: boolean }>(
              "select can_send($1) allowed",
              [accounts[0]],
            )
          ).rows[0].allowed,
          true,
        );
        assert.equal(
          (await f.db.query("select * from operating_brands")).rows.length,
          0,
        );
      },
    );

    await t.test(
      "superadmin reads all, AAL1 and inactive profiles read no new records",
      async () => {
        await f.asUser(admin);
        assert.equal(
          (await f.db.query("select * from operating_brands")).rows.length,
          2,
        );
        assert.equal(
          (await f.db.query("select * from mail_account_brand_reviews")).rows
            .length,
          1,
        );
        for (const id of [admin, ...people.map((p) => p.id)]) {
          await f.asUser(id, "aal1");
          for (const table of tables)
            assert.equal(
              (await f.db.query(`select * from ${table}`)).rows.length,
              0,
            );
        }
        await f.asUser(inactive);
        for (const table of tables)
          assert.equal(
            (await f.db.query(`select * from ${table}`)).rows.length,
            0,
          );
        await owner(f);
        await f.db.exec("set role anon");
        for (const table of tables)
          await assert.rejects(
            () => f.db.query(`select * from ${table}`),
            /permission denied/,
          );
      },
    );

    await t.test(
      "no human role can directly insert, update or delete the new tables",
      async () => {
        const inserts = [
          [
            "insert into operating_brands(code,name,created_by,updated_by) values('X','Fixture',$1,$1)",
            [admin],
          ],
          [
            "insert into operating_brand_memberships(brand_id,user_id,assigned_by) values($1,$2,$2)",
            [brands[0], admin],
          ],
          [
            "insert into mail_account_brand_reviews(account_id,expected_account_revision,request_key,created_by) values($1,0,$2,$3)",
            [accounts[2], randomUUID(), admin],
          ],
        ] as const;
        for (const id of [admin, ...people.map((p) => p.id)]) {
          await f.asUser(id);
          for (const [sql, args] of inserts)
            await assert.rejects(
              () => f.db.query(sql, [...args]),
              /permission denied|row-level security/,
            );
          for (const table of tables) {
            await assert.rejects(
              () => f.db.query(`update ${table} set revision=revision+1`),
              /permission denied|row-level security/,
            );
            await assert.rejects(
              () => f.db.query(`delete from ${table}`),
              /permission denied|row-level security/,
            );
          }
        }
      },
    );

    await t.test(
      "user metadata does not confer admin access and service reads are explicitly privileged",
      async () => {
        await owner(f);
        await f.db.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({
            sub: people[0].id,
            aal: "aal2",
            user_metadata: { role: "superadmin" },
          }),
        ]);
        await f.db.exec("set role authenticated");
        assert.equal(
          (await f.db.query("select * from mail_account_brand_reviews")).rows
            .length,
          0,
        );
        await owner(f);
        await f.db.exec("set role service_role");
        assert.equal(
          (await f.db.query("select * from operating_brands")).rows.length,
          2,
        );
      },
    );

    await owner(f);
    await t.test(
      "DB constraints reject bad identities, revisions and missing FK targets",
      async () => {
        for (const code of ["m1", " M3", "M 3", "M".repeat(33), "M1"])
          await assert.rejects(() =>
            f.db.query(
              "insert into operating_brands(code,name,created_by,updated_by) values($1,'Fixture',$2,$2)",
              [code, admin],
            ),
          );
        for (const name of ["", "  ", "x".repeat(121)])
          await assert.rejects(() =>
            f.db.query(
              "insert into operating_brands(code,name,created_by,updated_by) values('X',$1,$2,$2)",
              [name, admin],
            ),
          );
        await assert.rejects(() =>
          f.db.query(
            "update operating_brands set revision=9007199254740992 where id=$1",
            [brands[0]],
          ),
        );
        await assert.rejects(() =>
          f.db.query(
            "update mail_accounts set operating_brand_id=$1 where id=$2",
            [brands[0], accounts[0]],
          ),
        );
        await assert.rejects(() =>
          f.db.query(
            "update mail_accounts set operating_brand_id=$1,brand_revision=1 where id=$2",
            [randomUUID(), accounts[0]],
          ),
        );
        await assert.rejects(() =>
          f.db.query(
            "insert into operating_brand_memberships(brand_id,user_id,assigned_by) values($1,$2,$3)",
            [brands[0], randomUUID(), admin],
          ),
        );
        await assert.rejects(() =>
          f.db.query(
            "update operating_brand_memberships set active=false where brand_id=$1 and user_id=$2",
            [brands[0], people[0].id],
          ),
        );
      },
    );

    await t.test(
      "unknown mappings stay separate and competing open proposals cannot coexist",
      async () => {
        const results = await Promise.allSettled(
          [0, 1].map(() =>
            f.db.query(
              "insert into mail_account_brand_reviews(account_id,expected_account_revision,request_key,created_by) values($1,0,$2,$3)",
              [accounts[2], randomUUID(), admin],
            ),
          ),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(results.filter((r) => r.status === "rejected").length, 1);
        const originalRequest = (
          await f.db.query<{ request_key: string }>(
            "select request_key from mail_account_brand_reviews where id=$1",
            [pending],
          )
        ).rows[0].request_key;
        await assert.rejects(
          () =>
            f.db.query(
              "insert into mail_account_brand_reviews(account_id,status,expected_account_revision,request_key,created_by) values($1,'discarded',0,$2,$3)",
              [accounts[1], originalRequest, admin],
            ),
          /duplicate key/,
        );
        assert.equal(
          (
            await f.db.query<{ proposed_brand_id: string | null }>(
              "select proposed_brand_id from mail_account_brand_reviews where account_id=$1",
              [accounts[2]],
            )
          ).rows[0].proposed_brand_id,
          null,
        );
        await assert.rejects(() =>
          f.db.query(
            "insert into mail_account_brand_reviews(account_id,status,expected_account_revision,request_key,created_by) values($1,'conflict',0,$2,$3)",
            [accounts[2], randomUUID(), admin],
          ),
        );
        await assert.rejects(() =>
          f.db.query(
            "insert into mail_account_brand_reviews(account_id,expected_account_revision,request_key,created_by) values($1,0,$2,$3)",
            [randomUUID(), randomUUID(), admin],
          ),
        );
      },
    );

    await t.test(
      "confirmation, historical ranges and confirmed evidence fail closed",
      async () => {
        for (const patch of [
          "status='confirmed'",
          "status='confirmed',proposed_brand_id=null,evidence_reference='proof',reviewed_by=created_by,reviewed_at=now()",
          "history_approved=true",
          "history_from='2026-10-01T00:00:00Z'",
          "history_from='2026-10-02T00:00:00Z',history_to='2026-10-01T00:00:00Z'",
          "history_from='-infinity',history_to='infinity'",
          "evidence_reference='   '",
          "expected_account_revision=-1",
        ])
          await assert.rejects(() =>
            f.db.query(
              `update mail_account_brand_reviews set ${patch} where id=$1`,
              [pending],
            ),
          );
        await f.db.query(
          "update mail_account_brand_reviews set status='confirmed',evidence_reference='proof-01',reviewed_by=created_by,reviewed_at=now(),history_approved=true,history_from='2026-10-01T00:00:00Z',history_to='2026-10-02T00:00:00Z' where id=$1",
          [pending],
        );
        await assert.rejects(
          () =>
            f.db.query(
              "update mail_account_brand_reviews set evidence_reference='other' where id=$1",
              [pending],
            ),
          /immutable/,
        );
        await assert.rejects(
          () =>
            f.db.query("delete from mail_account_brand_reviews where id=$1", [
              pending,
            ]),
          /immutable/,
        );
        await assert.rejects(
          () =>
            f.db.query("delete from operating_brands where id=$1", [brands[0]]),
          /foreign key/,
        );
      },
    );

    await t.test(
      "rollback requires its marker and restores the legacy catalog and data",
      async () => {
        await f.db.exec("set pipeline_os.i01_sandbox=''");
        await assert.rejects(() => f.db.exec(down), /sandbox marker/);
        await f.db.exec("rollback");
        await marker(f);
        await f.db.exec(down);
        assert.deepEqual(await catalog(f), beforeCatalog);
        assert.deepEqual(await legacy(f), beforeLegacy);
        assert.equal(
          (
            await f.db.query<{ present: string | null }>(
              "select to_regclass('public.operating_brands') present",
            )
          ).rows[0].present,
          null,
        );
        assert.equal(
          (
            await f.db.query<{ n: number }>(
              "select count(*)::int n from information_schema.columns where table_schema='public' and table_name='mail_accounts' and column_name in ('operating_brand_id','brand_revision')",
            )
          ).rows[0].n,
          0,
        );
        await f.db.exec(up);
        await f.db.exec(down);
        assert.deepEqual(await catalog(f), beforeCatalog);
      },
    );
  } finally {
    await f.db.close();
  }
});

test("I01 applies and reverses on an empty business baseline; shared SQL is unchanged", async () => {
  const files = (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.equal(files.length, 47);
  assert(files.every((file, index) => Number(file.slice(0, 3)) === index + 1));
  const fingerprint = async () => {
    const rows = await Promise.all(
      files.map(async (name) => {
        const hash = createHash("sha256")
          .update(await readFile(`supabase/migrations/${name}`))
          .digest("hex");
        return `${name}:${hash}\n`;
      }),
    );
    return createHash("sha256").update(rows.join("")).digest("hex");
  };
  const before = await fingerprint();
  const f = await featureDatabase();
  try {
    const baseline = await catalog(f);
    await marker(f);
    await f.db.exec(await readFile(root + "t01-02-i01-foundation.sql", "utf8"));
    for (const table of tables)
      assert.equal((await f.db.query(`select * from ${table}`)).rows.length, 0);
    await f.db.exec(
      await readFile(root + "t01-02-i01-foundation.rollback.sql", "utf8"),
    );
    assert.deepEqual(await catalog(f), baseline);
    assert.equal(await fingerprint(), before);
  } finally {
    await f.db.close();
  }
});
