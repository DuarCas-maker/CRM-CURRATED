import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { remediationFixture } from "./fixtures/pipeline-os-permission-remediation";
import {
  fingerprintView,
  fingerprintCtes,
  maxViewBytes,
  maxViewTokens,
} from "../scripts/pipeline-os/view-fingerprint";
import {
  compareViewReviews,
  loadViewReview,
  maxReviewBytes,
  parseTargets,
  parseViewReview,
  remediationCli,
  remediationRoot,
  RemediationInputError,
  type ViewReview,
} from "../scripts/pipeline-os/permission-remediation";

let f: Awaited<ReturnType<typeof remediationFixture>>, reference: ViewReview;
before(async () => {
  f = await remediationFixture();
  reference = await f.snapshot();
});
after(async () => {
  await f?.db.close();
});
const comparison = (b: ViewReview) =>
  compareViewReviews(reference, b, f.digest);
const clone = () => structuredClone(reference);
const acl = async () => {
  await f.admin();
  return (
    await f.db.query(
      "select n.nspname||'.'||c.relname key,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by key",
    )
  ).rows;
};

test("PRM-AC01/05: exact targets, SQL reproducibility and offline guard", async () => {
  assert.equal(f.targets.length, 28);
  assert.equal(f.correction, await f.fixedCorrection());
  assert.equal(
    f.review,
    await readFile(remediationRoot + "view-review.sql", "utf8"),
  );
  assert.deepEqual(
    reference,
    parseViewReview(
      JSON.parse(
        await readFile(remediationRoot + "local-view-reference.json", "utf8"),
      ),
      f.digest,
    ),
  );
  await f.admin();
  await f.db.exec("reset pipeline_os.prm1_mode");
  try {
    await assert.rejects(f.db.exec(f.correction), /PRM_OFFLINE_GUARD/);
  } finally {
    await f.db.exec("rollback");
  }
  const injected = structuredClone(f.targets);
  injected[0].key = "public.campaign_assets;drop_table";
  assert.throws(() => parseTargets(injected), RemediationInputError);
  const unknown = structuredClone(f.targets);
  unknown[0].key = "public.unknown_object";
  assert.throws(() => parseTargets(unknown), RemediationInputError);
});

test("PRM-AC04/05: VR1 is catalog-only and injected writes fail READ ONLY", async () => {
  const code = f.review
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
  assert(
    !/\b(create|alter|drop|grant|revoke|insert|update|delete|truncate|call|do|copy)\b/i.test(
      code,
    ),
  );
  assert(!/\b(from|join)\s+(public|storage|auth)\./i.test(code));
  const protectedBefore = await f.protectedSnapshot();
  try {
    await assert.rejects(
      f.db.exec(
        f.review.replace(
          /rollback;\s*$/,
          "insert into public.mail_recipient_selections(user_id,name,targets) values(gen_random_uuid(),'Fixture','[]');rollback;",
        ),
      ),
      (e: any) => e.code === "25006",
    );
  } finally {
    await f.db.exec("rollback");
  }
  assert.deepEqual(await f.protectedSnapshot(), protectedBefore);
  assert(comparison(await f.snapshot()).allViewsMatch);
});

const lexerCases = [
  "SELECT a.id, 'Two words'::text FROM public.a a WHERE a.id >= 1;",
  " select\n a.id , 'Two words' ::text from PUBLIC.a A where a.id>=1 ; ",
  `SELECT 'it''s  A', "Mixed Name", 'ñ𝌆'::text;`,
  "SELECT 1.25e-2, (2+3), a[1], a||b, a->>b;",
  "SELECT E'escape';",
  "SELECT 'back\\slash';",
  "SELECT $$hidden$$;",
  "SELECT /* hidden */ 1;",
  "SELECT -- hidden\n1;",
  "SELECT café;",
  "x".repeat(maxViewBytes + 1),
  Array(maxViewTokens + 2)
    .fill("a")
    .join(" "),
];
test("PRM-AC02/04: temporary catalog-name shadow cannot redirect PRM1 or VR1", async () => {
  await f.admin();
  await f.db.exec("create temporary table pg_class(fake integer)");
  try {
    const result = await f.snapshot();
    assert.equal(result.context.searchPath, "pg_catalog, pg_temp");
    assert(comparison(result).allViewsMatch);
    await f.apply(f.correction.replace(/commit;\s*$/, "rollback;"));
  } finally {
    await f.admin();
    await f.db.exec("drop table pg_temp.pg_class");
  }
});
for (const [i, sql] of lexerCases.entries())
  test(`PRM-AC04: lexer JS/SQL agreement case ${i + 1}`, async () => {
    await f.admin();
    const result = await f.db.query<{
      fingerprint: ReturnType<typeof fingerprintView>;
    }>(
      `with recursive definitions(key,definition) as(values ('fixture',$1::text)),${fingerprintCtes()} select fingerprint from fingerprints`,
      [sql],
    );
    const expected = fingerprintView(sql),
      actual = result.rows[0].fingerprint;
    assert.equal(actual.status, expected.status);
    assert.equal(actual.hash, expected.hash);
    assert.equal(actual.quotedHash, expected.quotedHash);
    if (expected.status === "complete")
      assert.equal(actual.count, expected.count);
  });
test("PRM-AC04: whitespace/case equality never erases quoted bytes or operator boundaries", () => {
  assert.equal(
    fingerprintView(lexerCases[0]).hash,
    fingerprintView(lexerCases[1]).hash,
  );
  for (const [a, b] of [
    ["select 'A B'", "select 'AB'"],
    ["select 'A'", "select 'a'"],
    ['select "A"', 'select "a"'],
    ["select a::text", "select a:text"],
    ["select a - - b", "select a--b"],
  ])
    assert.notEqual(fingerprintView(a).hash, fingerprintView(b).hash);
});
test("PRM-AC04: actual three view definitions have matching complete JS/SQL fingerprints", async () => {
  for (const d of await f.definitions())
    assert.deepEqual(
      reference.views.find((v) => v.key === d.key)!.definition.lexical,
      fingerprintView(d.definition),
    );
});

const drifts = [
  [
    "PUBLIC grant",
    "grant select on public.campaign_assets to public",
    "revoke select on public.campaign_assets from public",
    "PRM_ACL_SOURCE_DRIFT",
  ],
  [
    "grant option",
    "grant select on public.campaign_assets to anon with grant option",
    "revoke grant option for select on public.campaign_assets from anon restrict",
    "PRM_ACL_SOURCE_DRIFT",
  ],
  [
    "column ACL",
    "grant select(name) on public.mail_recipient_selections to anon",
    "revoke select(name) on public.mail_recipient_selections from anon",
    "PRM_ACL_SOURCE_DRIFT",
  ],
  [
    "missing legitimate SELECT",
    "revoke select on public.campaign_assets from authenticated",
    "grant select on public.campaign_assets to authenticated",
    "PRM_LEGITIMATE_ACCESS_MISSING",
  ],
  [
    "owner",
    "alter table public.campaign_assets owner to postgres",
    "alter table public.campaign_assets owner to supabase_admin",
    "PRM_OBJECT_DRIFT",
  ],
  [
    "RLS",
    "alter table public.campaign_assets disable row level security",
    "alter table public.campaign_assets enable row level security",
    "PRM_OBJECT_DRIFT",
  ],
  [
    "view security",
    "alter view public.campaign_workspace set(security_invoker=false)",
    "alter view public.campaign_workspace set(security_invoker=true)",
    "PRM_OBJECT_DRIFT",
  ],
  [
    "role inheritance",
    "create role prm_inherited;grant select on public.campaign_assets to prm_inherited;grant prm_inherited to authenticated",
    "revoke prm_inherited from authenticated;revoke select on public.campaign_assets from prm_inherited;drop role prm_inherited",
    "PRM_ROLE_DRIFT",
  ],
  [
    "human bypass",
    "alter role authenticated bypassrls",
    "alter role authenticated nobypassrls",
    "PRM_ROLE_DRIFT",
  ],
  [
    "unknown grantee",
    "create role prm_unknown;grant select on public.campaign_assets to prm_unknown",
    "revoke select on public.campaign_assets from prm_unknown;drop role prm_unknown",
    "PRM_ACL_SOURCE_DRIFT",
  ],
];
for (const [name, mutate, undo, error] of drifts)
  test(`PRM-AC02: fail closed on ${name}, without partial correction`, async () => {
    await f.admin();
    await f.db.exec(mutate);
    const before = await acl();
    try {
      await assert.rejects(f.apply(), new RegExp(error));
      assert.deepEqual(await acl(), before);
    } finally {
      await f.admin();
      await f.db.exec(undo);
    }
  });

test("PRM-AC02: failure after actual revocations rolls back entire transaction", async () => {
  const before = await acl();
  const broken = f.correction.replace(
    "protected_after:=",
    "raise exception 'PRM_INJECTED_MIDWAY'; protected_after:=",
  );
  await assert.rejects(f.apply(broken), /PRM_INJECTED_MIDWAY/);
  assert.deepEqual(await acl(), before);
});
test("PRM-AC01/02/03/06: correction and repeat preserve data, service, views, defaults and functions", async () => {
  const protectedBefore = await f.protectedSnapshot(),
    viewsBefore = await f.snapshot(),
    beforeAcl = await acl();
  const serviceBefore = (
    await f.db.query(
      "select n.nspname||'.'||c.relname key,p,has_table_privilege('service_role',c.oid,p) access from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where n.nspname='public' order by 1,2",
    )
  ).rows;
  await f.apply();
  const first = await acl();
  await f.apply();
  assert.deepEqual(await acl(), first);
  const names = new Set(f.targets.map((t) => t.key));
  assert.deepEqual(
    first.filter((r: any) => !names.has(r.key)),
    beforeAcl.filter((r: any) => !names.has(r.key)),
  );
  assert.deepEqual(await f.protectedSnapshot(), protectedBefore);
  assert.deepEqual(await f.snapshot(), viewsBefore);
  assert.deepEqual(
    (
      await f.db.query(
        "select n.nspname||'.'||c.relname key,p,has_table_privilege('service_role',c.oid,p) access from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where n.nspname='public' order by 1,2",
      )
    ).rows,
    serviceBefore,
  );
  for (const t of f.targets)
    for (const role of ["anon", "authenticated"]) {
      const privileges = (
        await f.db.query<{ p: string }>(
          "select p from unnest(array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) p where has_table_privilege($1,$2,p) order by p",
          [role, t.key],
        )
      ).rows.map((r) => r.p);
      assert.deepEqual(privileges, role === "anon" ? [] : t.authenticated);
    }
  assert.equal(f.serviceFunctions.length, 70);
  for (const signature of f.serviceFunctions)
    assert.equal(
      (
        await f.db.query<{ access: boolean }>(
          "select has_function_privilege('service_role',$1,'EXECUTE') access",
          [signature],
        )
      ).rows[0].access,
      true,
    );
});

test("PRM-AC02: anonymous access/TRUNCATE denied; service usage retained", async () => {
  await f.admin();
  await f.db.exec("set role anon");
  await assert.rejects(
    f.db.query("select * from public.mail_drafts"),
    (e: any) => e.code === "42501",
  );
  await assert.rejects(
    f.db.exec("truncate public.mail_recipient_selections"),
    (e: any) => e.code === "42501",
  );
  await f.admin();
  await f.db.exec("set role service_role");
  await f.db.exec(
    "insert into public.gmail_sent_usage(account_id,gmail_message_id,sent_at,recipients) select id,'fixture-usage',now(),1 from public.mail_accounts on conflict do nothing",
  );
  await f.admin();
});
test("PRM-AC02: authenticated own CRUD works and foreign rows remain hidden", async () => {
  const selection = randomUUID(),
    draft = randomUUID();
  await f.asUser(f.users.seller);
  await f.db.query(
    "insert into public.mail_recipient_selections(id,user_id,name,targets) values($1,$2,'Fixture','[{\"email\":\"fixture@example.test\"}]')",
    [selection, f.users.seller],
  );
  await f.db.query(
    "insert into public.mail_drafts(id,user_id,opportunity_id,payload) values($1,$2,$3,'{}')",
    [draft, f.users.seller, f.opportunity],
  );
  for (const table of ["mail_drafts", "mail_recipient_selections"])
    assert.equal(
      (await f.db.query(`select * from public.${table}`)).rows.length,
      1,
    );
  await f.db.query(
    "update public.mail_recipient_selections set name='Updated' where id=$1",
    [selection],
  );
  await f.db.query(
    'update public.mail_drafts set payload=\'{"subject":"Updated"}\' where id=$1',
    [draft],
  );
  for (const view of [
    "opportunity_workspace",
    "opportunity_inbox",
    "opportunity_tasks",
  ])
    assert.equal(
      (await f.db.query(`select * from public.${view}`)).rows.length,
      1,
    );
  await f.asUser(f.users.outsider);
  for (const table of ["mail_drafts", "mail_recipient_selections"])
    assert.equal(
      (await f.db.query(`select * from public.${table}`)).rows.length,
      0,
    );
  await assert.rejects(
    f.db.query(
      "insert into public.mail_recipient_selections(user_id,name,targets) values($1,'Bad','[{}]')",
      [f.users.seller],
    ),
    (e: any) => e.code === "42501",
  );
  for (const view of [
    "opportunity_workspace",
    "opportunity_inbox",
    "opportunity_tasks",
  ])
    assert.equal(
      (await f.db.query(`select * from public.${view}`)).rows.length,
      0,
    );
  await f.asUser(f.users.admin);
  for (const view of [
    "opportunity_workspace",
    "opportunity_inbox",
    "opportunity_tasks",
  ])
    assert.equal(
      (await f.db.query(`select * from public.${view}`)).rows.length,
      1,
    );
  await f.asUser(f.users.seller);
  await f.db.query("delete from public.mail_drafts where id=$1", [draft]);
  await f.db.query("delete from public.mail_recipient_selections where id=$1", [
    selection,
  ]);
  await f.admin();
});

test("PRM-AC03: future object closes broad defaults before same-transaction COMMIT", async () => {
  await f.admin();
  const before = await f.protectedSnapshot();
  await f.db.exec(
    "begin;create table public.prm_future_fixture(id integer);revoke all on public.prm_future_fixture from public,anon,authenticated;grant select on public.prm_future_fixture to authenticated",
  );
  assert.deepEqual(
    (
      await f.db.query(
        "select has_table_privilege('anon','public.prm_future_fixture','SELECT') anon,has_table_privilege('authenticated','public.prm_future_fixture','INSERT') human_write,has_table_privilege('authenticated','public.prm_future_fixture','SELECT') human_read",
      )
    ).rows,
    [{ anon: false, human_write: false, human_read: true }],
  );
  await f.db.exec("rollback");
  assert.deepEqual(await f.protectedSnapshot(), before);
});
test("PRM-AC03: builtin PUBLIC function default requires per-function restriction inside transaction", async () => {
  await f.admin();
  const before = await f.protectedSnapshot();
  try {
    await f.db.exec(
      "begin;create function public.prm_future_function_fixture() returns integer language sql as 'select 1'",
    );
    assert.equal(
      (
        await f.db.query<{ access: boolean }>(
          "select has_function_privilege('anon','public.prm_future_function_fixture()','EXECUTE') access",
        )
      ).rows[0].access,
      true,
    );
    await f.db.exec(
      "revoke all on function public.prm_future_function_fixture() from public,anon,authenticated;grant execute on function public.prm_future_function_fixture() to service_role",
    );
    assert.deepEqual(
      (
        await f.db.query(
          "select has_function_privilege('anon','public.prm_future_function_fixture()','EXECUTE') anon,has_function_privilege('authenticated','public.prm_future_function_fixture()','EXECUTE') human,has_function_privilege('service_role','public.prm_future_function_fixture()','EXECUTE') service",
        )
      ).rows,
      [{ anon: false, human: false, service: true }],
    );
  } finally {
    await f.db.exec("rollback");
  }
  assert.deepEqual(await f.protectedSnapshot(), before);
});
for (const key of [
  "public.campaign_workspace",
  "public.opportunity_inbox",
  "public.opportunity_tasks",
])
  test(`PRM-AC04: changed ${key} stays unresolved and is never recreated`, async () => {
    const changed = clone();
    changed.views.find((v) => v.key === key)!.definition.lexical.hash =
      "0".repeat(32);
    changed.views.find((v) => v.key === key)!.definition.rawHash = "1".repeat(
      32,
    );
    assert.equal(
      comparison(changed).results.find((v) => v.key === key)!.status,
      "unresolved",
    );
  });
for (const key of [
  "public.campaign_workspace",
  "public.opportunity_inbox",
  "public.opportunity_tasks",
])
  test(`PRM-AC04: VR1 detects an actual predicate change in ${key}`, async () => {
    const original = (await f.definitions())
      .find((d) => d.key === key)!
      .definition.replace(/;\s*$/, "");
    await f.admin();
    try {
      await f.db.exec(
        `create or replace view ${key} with(security_invoker=true) as select * from (${original}) fixture where false`,
      );
      assert.equal(
        comparison(await f.snapshot()).results.find((v) => v.key === key)!
          .status,
        "unresolved",
      );
    } finally {
      await f.admin();
      await f.db.exec(
        `create or replace view ${key} with(security_invoker=true) as ${original}`,
      );
    }
  });
test("PRM-AC04: same raw hash cannot approve unsupported lexical/dependency/security/column context", () => {
  for (const mutate of [
    (v: ViewReview["views"][number]) => {
      v.definition.lexical = {
        status: "incomplete",
        hash: null,
        quotedHash: null,
        count: 0,
      };
    },
    (v: ViewReview["views"][number]) => {
      v.dependencies.unsupported = 1;
    },
    (v: ViewReview["views"][number]) => {
      v.security = ["security_invoker=false"];
    },
    (v: ViewReview["views"][number]) => {
      v.columns[0].type = "pg_catalog.text";
    },
    (v: ViewReview["views"][number]) => {
      v.definition.lexical.hash = "0".repeat(32);
    },
  ]) {
    const b = clone();
    mutate(b.views[0]);
    assert.equal(comparison(b).allViewsMatch, false);
  }
});
test("PRM-AC04/05: parser rejects duplicate/missing/extra/body/context or altered scope", () => {
  const cases: unknown[] = [];
  let b: any = clone();
  b.views[1] = b.views[0];
  cases.push(b);
  b = clone();
  b.views.pop();
  cases.push(b);
  b = clone();
  b.views[0].sql = "private SQL";
  cases.push(b);
  b = clone();
  b.context.readOnly = "off";
  cases.push(b);
  b = clone();
  b.scopeSha256 = "0".repeat(64);
  cases.push(b);
  cases.push([{ pipeline_os_abc_view_review: clone(), secret: "private" }]);
  for (const input of cases)
    assert.throws(() => parseViewReview(input, f.digest), {
      message: "PRM_INPUT_INVALID_OR_INCOMPLETE",
    });
});
test("PRM-AC05: CLI compares bounded local files, never executes or accepts credentials/network paths", async () => {
  for (const args of [
    ["--execute", "https://example.test"],
    ["--compare", ".env.local", "x.json"],
    ["--compare", "https://example.test/a.json", "x.json"],
    ["--compare", "\\\\server\\share\\a.json", "x.json"],
  ])
    await assert.rejects(remediationCli(args), RemediationInputError);
  const dir = await mkdtemp(join(tmpdir(), "prm-offline-")),
    file = join(dir, "snapshot.json");
  await writeFile(
    file,
    JSON.stringify([{ pipeline_os_abc_view_review: reference }]),
  );
  assert.deepEqual(await loadViewReview(file, f.digest), reference);
  const result = JSON.parse(await remediationCli(["--compare", file, file]));
  assert(result.allViewsMatch);
  assert.equal(result.publicationApproved, false);
  assert.equal(result.instantlyConsumed, 43);
  await writeFile(file, "private bad input");
  await assert.rejects(loadViewReview(file, f.digest), {
    message: "PRM_INPUT_INVALID_OR_INCOMPLETE",
  });
  await writeFile(file, " ".repeat(maxReviewBytes + 1));
  await assert.rejects(loadViewReview(file, f.digest), RemediationInputError);
});
