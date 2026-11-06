import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  abcPreflightRoot as root,
  acceptedViewSql,
  campaignWorkspaceHashes,
  correctedExactBranch,
  oldExactBranch,
  renderAbcPreflight,
  sha256,
} from "../scripts/pipeline-os/abc-preflight";
import { abcFinalFixture, abcSnapshot } from "./fixtures/pipeline-os-abc-final";

let f: Awaited<ReturnType<typeof abcFinalFixture>>;
let migration: string, preflight: string, contractText: string;
const observe = async (sql = preflight) => {
  await f.admin();
  try {
    const rows = (await f.db.exec(sql)).flatMap((r) => r.rows);
    return rows.find((r: any) => r.pipeline_os_abc_preflight)
      ?.pipeline_os_abc_preflight as any;
  } catch (error) {
    await f.db.exec("rollback");
    throw error;
  }
};
const has = (report: any, group: string, field?: string, object?: string) =>
  report.mismatches.some(
    (m: any) =>
      m.group === group &&
      (!field || m.field === field) &&
      (!object || m.object === object),
  );
const mutate = async (
  change: string,
  restore: string,
  check: (r: any) => void,
) => {
  await f.admin();
  await f.db.exec(change);
  try {
    check(await observe());
  } finally {
    await f.admin();
    await f.db.exec(restore);
  }
};
before(async () => {
  [migration, preflight, contractText] = await Promise.all([
    readFile(
      root + "049_integrate_mail_identity_brands_and_bindings.sql",
      "utf8",
    ),
    readFile(root + "preflight/preflight.sql", "utf8"),
    readFile(root + "contract.json", "utf8"),
  ]);
  f = await abcFinalFixture();
});
after(async () => {
  await f?.db.close();
});

test("PRE-AC01: exact migration admits only reviewed pre-view variants; all other fields and final mode remain strict", async () => {
  assert.equal(migration.split(correctedExactBranch).length - 1, 2);
  const afterPre = migration.slice(migration.indexOf("do $af_check$"));
  assert(!afterPre.includes(acceptedViewSql));
  assert(afterPre.includes(oldExactBranch));
  const expected = {
    kind: "v",
    rls: false,
    columns: ["id"],
    viewHash: campaignWorkspaceHashes[0],
  };
  const compare = async (
    actual: unknown,
    key = "public.campaign_workspace",
    mode = "pre",
    v = expected,
  ) => {
    await f.admin();
    const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
    await f.db
      .exec(`do $$declare a jsonb:=${quote(JSON.stringify(actual))}::jsonb;
      v jsonb:=${quote(JSON.stringify(v))}::jsonb;mode text:=${quote(mode)};
      g text:='relations';k text:=${quote(key)};ok boolean:=true;begin
      if false then null;${correctedExactBranch}
      perform set_config('pipeline_os.pre_comparator_test',ok::text,false);end$$;`);
    return (
      (
        await f.db.query<{ ok: string }>(
          "select current_setting('pipeline_os.pre_comparator_test') ok",
        )
      ).rows[0].ok === "true"
    );
  };
  for (const hash of campaignWorkspaceHashes)
    assert(await compare({ ...expected, viewHash: hash }));
  assert.equal(await compare({ ...expected, viewHash: "0".repeat(32) }), false);
  assert.equal(await compare({ ...expected, viewHash: null }), false);
  assert.equal(
    await compare({
      ...expected,
      viewHash: campaignWorkspaceHashes[1],
      rls: true,
    }),
    false,
  );
  assert.equal(
    await compare({
      ...expected,
      viewHash: campaignWorkspaceHashes[1],
      columns: [],
    }),
    false,
  );
  assert.equal(
    await compare(
      { ...expected, viewHash: campaignWorkspaceHashes[1] },
      "public.opportunity_inbox",
    ),
    false,
  );
  assert.equal(
    await compare(
      { ...expected, viewHash: campaignWorkspaceHashes[1] },
      undefined,
      "post",
    ),
    false,
  );
  assert.equal(
    await compare(
      { ...expected, viewHash: campaignWorkspaceHashes[1] },
      undefined,
      "pre",
      { ...expected, viewHash: "f".repeat(32) } as typeof expected,
    ),
    false,
  );
});

test("PRE-AC02/05: deterministic script, correct bindings, base passes with unchanged metadata/rows and no sensitive output", async () => {
  assert.equal(renderAbcPreflight(migration, contractText), preflight);
  assert.throws(() =>
    renderAbcPreflight(
      migration.replaceAll(correctedExactBranch, oldExactBranch),
      contractText,
    ),
  );
  assert.throws(() =>
    renderAbcPreflight(
      migration.replaceAll(sha256(contractText), "0".repeat(64)),
      contractText,
    ),
  );
  const before = await f.protectedSnapshot();
  const report = await observe();
  assert.equal(report.complete, true);
  assert.equal(report.catalogOk, true, JSON.stringify(report.mismatches));
  assert.equal(report.preconditionsOk, true);
  assert.equal(report.publicationReady, false);
  assert.equal(report.contractSha256, sha256(contractText));
  assert.equal(report.migrationSha256, sha256(migration));
  assert.equal(report.context.readOnly, "on");
  assert.equal(report.context.isolation, "repeatable read");
  assert.equal(report.mismatchCount, 0);
  assert.equal(report.scope.functions.expectedPresent, 47);
  assert.equal(report.scope.policies.expectedPresent, 6);
  assert.equal(report.scope.relations.expectedPresent, 14);
  assert.deepEqual(await f.protectedSnapshot(), before);
  const output = JSON.stringify(report);
  assert(
    !/prm-client|prm-mail|@example|Fixture|select 1|CREATE FUNCTION/i.test(
      output,
    ),
  );
});

test("PRE-AC02: human table rights after048 and new role membership fail closed", async () => {
  await mutate(
    "grant update on public.campaign_assets to authenticated",
    "revoke update on public.campaign_assets from authenticated",
    (r) => {
      assert(
        !r.catalogOk && has(r, "accepted048", "authenticated.tablePrivileges"),
      );
    },
  );
  await mutate(
    "grant authenticated to anon",
    "revoke authenticated from anon",
    (r) => {
      assert.equal(r.checks.rolesMembershipsAndPublicSchema, false);
      assert.equal(r.preconditionsOk, false);
    },
  );
});

test("PRE-AC02: a missing required role stops before privilege probes", async () => {
  await mutate(
    "alter role anon rename to preflight_missing_anon",
    "alter role preflight_missing_anon rename to anon",
    (r) => {
      assert.equal(r.complete, false);
      assert.equal(r.preconditionsOk, false);
      assert.equal(r.stopReason, "CONTEXT_OR_REQUIRED_ROLES_MISSING");
    },
  );
});

test("PRE-AC03: function config, exact source and direct grant option are diagnosed", async () => {
  await mutate(
    "alter function public.account_delivery_usage(uuid) set search_path=public",
    "alter function public.account_delivery_usage(uuid) set search_path=''",
    (r) => {
      assert(
        !r.catalogOk &&
          has(r, "functions", "config", "public.account_delivery_usage(uuid)"),
      );
    },
  );
  await f.admin();
  const original = (
    await f.db.query<{ definition: string }>(
      "select pg_get_functiondef('public.account_delivery_usage(uuid)'::regprocedure) definition",
    )
  ).rows[0].definition;
  await mutate(
    "create or replace function public.account_delivery_usage(account uuid) returns jsonb language sql stable security definer set search_path='' as $$select '{}'::jsonb$$",
    original,
    (r) => {
      assert(!r.catalogOk && has(r, "functions", "sourceHash"));
    },
  );
  await mutate(
    "grant execute on function public.account_delivery_usage(uuid) to service_role with grant option",
    "revoke grant option for execute on function public.account_delivery_usage(uuid) from service_role",
    (r) => {
      assert(
        !r.catalogOk && has(r, "functionAcl", "directPrivilegesAndGrantOption"),
      );
    },
  );
});

test("PRE-AC03: column metadata and explicit human/PUBLIC grants cannot hide behind table ACL", async () => {
  await mutate(
    "alter table public.mail_accounts alter column email set default 'synthetic-default'",
    "alter table public.mail_accounts alter column email drop default",
    (r) => {
      assert(
        !r.catalogOk && has(r, "relations", "columns", "public.mail_accounts"),
      );
    },
  );
  for (const role of ["anon", "public"])
    await mutate(
      `grant select(email) on public.mail_accounts to ${role}`,
      `revoke select(email) on public.mail_accounts from ${role}`,
      (r) => {
        assert(
          !r.catalogOk &&
            has(
              r,
              "columnAcl",
              "directPrivilegesAndGrantOption",
              "public.mail_accounts",
            ),
        );
      },
    );
  await mutate(
    "grant update(kind) on public.campaign_events to authenticated",
    "revoke update(kind) on public.campaign_events from authenticated",
    (r) => {
      assert(
        !r.catalogOk &&
          has(r, "columnAcl", undefined, "public.campaign_events"),
      );
    },
  );
});

test("PRE-AC03: all six existing policies are evaluated in049 search_path", async () => {
  const d = JSON.parse(contractText);
  for (const [key, value] of Object.entries(d.pre.policies) as [
    string,
    any,
  ][]) {
    if (!value) continue;
    await f.admin();
    await f.db.exec("set search_path=pg_catalog,pg_temp");
    const name = key.slice(value.relation.length + 1);
    const row = (
      await f.db.query<{ expr: string }>(
        `select pg_get_expr(p.polqual,p.polrelid) expr from pg_policy p where p.polrelid=$1::regclass and p.polname=$2`,
        [value.relation, name],
      )
    ).rows[0];
    assert(row.expr);
    await mutate(
      `alter policy ${name} on ${value.relation} using(true)`,
      `alter policy ${name} on ${value.relation} using(${row.expr})`,
      (r) => {
        assert(!r.catalogOk && has(r, "policies", "usingHash", key));
      },
    );
  }
});

test("PRE-AC02: partial installation and changed public function inventory are rejected", async () => {
  await mutate("create schema brand_b1", "drop schema brand_b1", (r) => {
    assert(!r.catalogOk && has(r, "schemas", "presence", "brand_b1"));
  });
  await mutate(
    "create function public.preflight_extra() returns integer language sql as $$select 1$$",
    "drop function public.preflight_extra()",
    (r) => {
      assert.equal(r.checks.baseFunctionInventory, false);
      assert.equal(r.preconditionsOk, false);
    },
  );
});

test("PRE-AC04: sending blocks; queued/uncertain remain unchanged and require operational review", async () => {
  for (const status of ["sending", "queued", "uncertain"]) {
    await f.admin();
    const id = randomUUID();
    const account = (
      await f.db.query<{ id: string }>(
        "select id from public.mail_accounts order by id limit 1",
      )
    ).rows[0].id;
    await f.db.query(
      "insert into public.outbox(id,account_id,opportunity_id,to_email,subject,body,area,status,message_id_header,request_key) values($1,$2,$3,'preflight-only@example.test','Synthetic','Synthetic','seller',$4,$5,$6)",
      [id, account, f.opportunity, status, `<${id}@example.test>`, id],
    );
    const before = await f.protectedSnapshot();
    try {
      const report = await observe();
      assert.equal(report.queue[status], 1);
      assert.equal(report.preconditionsOk, status !== "sending");
      assert.equal(report.legacyReviewRequired, status !== "sending");
      assert.deepEqual(await f.protectedSnapshot(), before);
    } finally {
      await f.admin();
      await f.db.query("delete from public.outbox where id=$1", [id]);
    }
  }
});

test("PRE-AC04/05: an incompatible queue shape cannot be mistaken for zero sending", async () => {
  await mutate(
    "alter table public.outbox rename column status to synthetic_hidden_status",
    "alter table public.outbox rename column synthetic_hidden_status to status",
    (r) => {
      assert.equal(r.checks.queueShape, false);
      assert.equal(r.checks.noSending, false);
      assert.equal(r.queue, null);
      assert.equal(r.preconditionsOk, false);
    },
  );
});

test("PRE-AC02/05: wrong actor cannot yield approval; READ ONLY rejects an attempted mutation", async () => {
  await f.db.exec("reset role");
  const report = (await f.db.exec(preflight))
    .flatMap((r) => r.rows)
    .find((r: any) => r.pipeline_os_abc_preflight)
    ?.pipeline_os_abc_preflight as any;
  assert.equal(report.complete, false);
  assert.equal(report.preconditionsOk, false);
  assert.equal(report.stopReason, "CONTEXT_OR_REQUIRED_ROLES_MISSING");
  const before = await abcSnapshot(f);
  const bad = preflight.replace(
    "end $af_preflight$;",
    "insert into public.jobs(kind,dedupe_key) values('never','never');end $af_preflight$;",
  );
  await assert.rejects(observe(bad), /read.only transaction/i);
  assert.deepEqual(await abcSnapshot(f), before);
});

test("PRE-AC05: bounded details retain total count and never turn a partial report into success", async () => {
  const d = JSON.parse(contractText);
  // Synthetic expected-field drift, not a new artifact or remote metadata.
  for (const v of Object.values(d.pre.functions) as any[]) {
    if (!v) continue;
    for (let i = 0; i < 6; i++) v[`syntheticMissing${i}`] = true;
  }
  const alteredContract = JSON.stringify(d);
  const script = renderAbcPreflight(
    migration
      .replace(sha256(contractText), sha256(alteredContract))
      .replaceAll(
        JSON.stringify(JSON.parse(contractText)).replaceAll("'", "''"),
        alteredContract.replaceAll("'", "''"),
      ),
    alteredContract,
  );
  const report = await observe(script);
  assert(report.mismatchCount > 200);
  assert.equal(report.mismatches.length, 200);
  assert.equal(report.detailsTruncated, true);
  assert.equal(report.catalogOk, false);
});
