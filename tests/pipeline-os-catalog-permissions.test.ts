import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  permissionsFixture,
  fixedDiagnosticSql,
} from "./fixtures/pipeline-os-catalog-permissions";
import {
  compareDiagnostics,
  diagnosticCli,
  diagnosticRoot,
  DiagnosticInputError,
  loadDiagnosticFile,
  maxDiagnosticBytes,
  parseDiagnostic,
  parseDiagnosticText,
  parseScope,
  renderDiagnosticSql,
} from "../scripts/pipeline-os/catalog-permissions";

let f: Awaited<ReturnType<typeof permissionsFixture>>;
before(async () => {
  f = await permissionsFixture();
});
after(async () => {
  await f?.db.close();
});
const clone = () => structuredClone(f.reference);
const bad = (mutate: (d: ReturnType<typeof clone>) => void) => {
  const d = clone();
  mutate(d);
  assert.throws(() => parseDiagnostic(d, f.scope), DiagnosticInputError);
};
const compare = (d: ReturnType<typeof clone>) =>
  compareDiagnostics(f.reference, d, f.scope);
const digest = (s: string) => createHash("md5").update(s).digest("hex");

test("PD-AC04: static SQL is reproducible, bounded and reads catalog only", async () => {
  assert.equal(await fixedDiagnosticSql(), await renderDiagnosticSql(f.scope));
  const code = f.sql.replace(/--[^\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");
  assert.match(code, /begin read only;/);
  assert.match(code, /set local search_path = pg_catalog;/);
  assert.match(code, /rollback;\s*$/);
  assert(
    !/\b(insert|update|delete|truncate|grant|revoke|alter|create|drop|copy|call|do)\b/i.test(
      code,
    ),
  );
  assert(!/\b(from|join)\s+(public|auth|storage)\./i.test(code));
  assert(!/\b(pg_authid|inherit_option|set_option|probin)\b/i.test(code));
});
test("PD-AC01/05: base47 produces a complete read-only inventory", () => {
  const d = parseDiagnostic(f.reference, f.scope);
  assert.equal(d.context.read_only, "on");
  assert.equal(d.sections.functions.length, 206);
  assert.equal(d.sections.relations.length, 30);
  assert.equal(d.sections.policies.length, 8);
  assert.equal(d.sections.views.length, 3);
  assert.equal(
    d.sections.constraints.some((c) => (c.kind as string) === "n"),
    false,
  );
  assert(
    d.sections.columns.some(
      (c) => c.key === "public.profiles.id" && c.not_null,
    ),
  );
});
test("PD-AC05: repeated inventory leaves catalog and business counters unchanged", async () => {
  const before = await f.db.query(
    "select (select count(*) from public.audit_log) a,(select count(*) from public.jobs) j,(select count(*) from public.outbox) o",
  );
  assert.deepEqual(await f.snapshot(), f.reference);
  assert.deepEqual(
    await f.db.query(
      "select (select count(*) from public.audit_log) a,(select count(*) from public.jobs) j,(select count(*) from public.outbox) o",
    ),
    before,
  );
});
test("PD-AC05: the SQL transaction actually rejects an injected write in the disposable fixture", async () => {
  const altered = f.sql.replace(
    /rollback;\s*$/,
    "insert into public.profiles(id,name,email) values(gen_random_uuid(),'Fixture','private@example.test');rollback;",
  );
  try {
    await assert.rejects(
      f.db.exec(altered),
      (e: unknown) =>
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        e.code === "25006",
    );
  } finally {
    await f.db.exec("rollback");
  }
  assert.deepEqual(compare(await f.snapshot()).findings, []);
});
test("PD-AC02: schema privilege source and effective app permissions are both observed", async () => {
  await f.db.exec("grant create on schema storage to anon");
  try {
    const d = await f.snapshot(),
      s = d.sections.schemas.find((x) => x.key === "storage")!;
    assert(s.access.anon.create);
    assert(s.acl.some((x) => x.grantee === "anon" && x.privilege === "CREATE"));
    assert(
      compare(d).findings.some(
        (x) =>
          x.section === "schemas" &&
          x.classification === "confirmed_permission_drift",
      ),
    );
  } finally {
    await f.db.exec("revoke create on schema storage from anon");
  }
});
test("PD-AC02: direct grant is observed even with RLS enabled", async () => {
  await f.db.exec("grant select on public.mail_drafts to anon");
  try {
    const d = await f.snapshot(),
      r = d.sections.relations.find((x) => x.key === "public.mail_drafts")!;
    assert(r.rls);
    assert(r.access.anon.includes("SELECT"));
    assert(r.acl.some((x) => x.grantee === "anon" && x.privilege === "SELECT"));
    assert(
      compare(d).findings.some(
        (x) =>
          x.key === r.key && x.classification === "confirmed_permission_drift",
      ),
    );
  } finally {
    await f.db.exec("revoke select on public.mail_drafts from anon");
  }
});
test("PD-AC02: PUBLIC source differs from an explicit app-role grant", async () => {
  await f.db.exec("grant select on public.mail_uploads to public");
  try {
    const r = (await f.snapshot()).sections.relations.find(
      (x) => x.key === "public.mail_uploads",
    )!;
    assert(r.access.anon.includes("SELECT"));
    assert(
      r.acl.some((x) => x.grantee === "PUBLIC" && x.privilege === "SELECT"),
    );
  } finally {
    await f.db.exec("revoke select on public.mail_uploads from public");
  }
});
test("PD-AC02/04: inherited privileges expose an anonymous role label, not a private role name", async () => {
  await f.db.exec(
    'create role "private.person@example.test";grant select on public.mail_uploads to "private.person@example.test";grant "private.person@example.test" to authenticated',
  );
  try {
    const d = await f.snapshot(),
      label = "role_" + digest("private.person@example.test");
    assert(
      d.sections.memberships.some(
        (x) =>
          x.member === "authenticated" && x.role === label && x.usage_effective,
      ),
    );
    assert(
      d.sections.relations
        .find((x) => x.key === "public.mail_uploads")!
        .acl.some((x) => x.grantee === label),
    );
    assert(!JSON.stringify(d).includes("private.person@example.test"));
  } finally {
    await f.db.exec(
      'revoke "private.person@example.test" from authenticated;revoke select on public.mail_uploads from "private.person@example.test";drop role "private.person@example.test"',
    );
  }
});
test("PD-AC02: NOINHERIT membership is recorded without inventing effective access", async () => {
  await f.db.exec(
    "create role pd_noinherit noinherit;create role pd_group;grant pd_group to pd_noinherit;grant select on public.mail_uploads to pd_noinherit",
  );
  try {
    const d = await f.snapshot();
    assert(
      d.sections.memberships.some(
        (x) =>
          x.member === "role_" + digest("pd_noinherit") &&
          x.role === "role_" + digest("pd_group") &&
          x.member_effective &&
          !x.usage_effective,
      ),
    );
  } finally {
    await f.db.exec(
      "revoke select on public.mail_uploads from pd_noinherit;revoke pd_group from pd_noinherit;drop role pd_noinherit;drop role pd_group",
    );
  }
});
test("PD-AC02: owner privileges and a null ACL remain distinguishable", () => {
  assert(f.reference.sections.relations.some((x) => x.owner === "postgres"));
  assert(f.reference.sections.functions.some((x) => x.owner === "postgres"));
  const d = clone();
  d.sections.relations[0].acl_is_null = !d.sections.relations[0].acl_is_null;
  assert(
    compare(d).findings.some(
      (x) =>
        x.fields.includes("acl_is_null") &&
        x.classification === "explained_metadata",
    ),
  );
});
test("PD-AC02: creator defaults are evidence about future grants, not inferred object history", async () => {
  await f.db.exec(
    "alter default privileges in schema public grant select on tables to anon",
  );
  try {
    const d = await f.snapshot();
    assert(
      d.sections.defaults.some(
        (x) =>
          x.owner === "postgres" &&
          x.schema === "public" &&
          x.kind === "r" &&
          x.acl.some((a) => a.grantee === "anon" && a.privilege === "SELECT"),
      ),
    );
    assert.deepEqual(d.sections.relations, f.reference.sections.relations);
    assert.equal(compare(d).status, "findings_open");
  } finally {
    await f.db.exec(
      "alter default privileges in schema public revoke select on tables from anon",
    );
  }
});
test("PD-AC02: internal function EXECUTE for service_role stays a permission finding", async () => {
  await f.db.exec(
    "grant execute on function public.instantly_webhook_control_snapshot(text) to service_role",
  );
  try {
    const d = await f.snapshot();
    assert(
      d.sections.functions.find(
        (x) => x.key === "public.instantly_webhook_control_snapshot(text)",
      )!.access.service_role,
    );
    assert(
      compare(d).findings.some(
        (x) =>
          x.key.includes("control_snapshot") &&
          x.classification === "confirmed_permission_drift",
      ),
    );
  } finally {
    await f.db.exec(
      "revoke execute on function public.instantly_webhook_control_snapshot(text) from service_role",
    );
  }
});
test("PD-AC04: source and configuration literals never appear in output", async () => {
  const { rows } = await f.db.query<{ definition: string }>(
    "select pg_get_functiondef('public.mail_is_team(text)'::regprocedure) definition",
  );
  await f.db.exec(
    "create or replace function public.mail_is_team(address text) returns boolean language sql stable security definer set search_path='' as $$select 'SENTINEL secret 123'='SENTINEL secret 123'$$",
  );
  await f.db.exec(
    "alter function public.mail_is_team(text) set application_name='SENTINEL configuration'",
  );
  try {
    const d = await f.snapshot();
    assert(!JSON.stringify(d).includes("SENTINEL"));
    assert(
      compare(d).findings.some(
        (x) =>
          x.key === "public.mail_is_team(text)" &&
          x.fields.includes("source_hash"),
      ),
    );
  } finally {
    await f.db.exec(rows[0].definition);
  }
});
test("PD-AC04: policy and view literals are hashed without exporting expressions", async () => {
  const policy = (
    await f.db.query<{ v: string }>(
      "select pg_get_expr(polqual,polrelid) v from pg_policy where polrelid='public.campaigns'::regclass and polname='campaigns_read'",
    )
  ).rows[0].v;
  const view = (
    await f.db.query<{ v: string }>(
      "select pg_get_viewdef('public.campaign_workspace'::regclass,true) v",
    )
  ).rows[0].v.replace(/;\s*$/, "");
  const options = f.reference.sections.relations.find(
    (r) => r.key === "public.campaign_workspace",
  )!.security;
  const clause = options.length ? " with (" + options.join(",") + ")" : "";
  try {
    await f.db.exec(
      "alter policy campaigns_read on public.campaigns using ('SENTINEL policy'='SENTINEL policy' and (" +
        policy +
        "))",
    );
    await f.db.exec(
      "create or replace view public.campaign_workspace" +
        clause +
        " as select * from (" +
        view +
        ") q where 'SENTINEL view'='SENTINEL view'",
    );
    const d = await f.snapshot();
    assert(!JSON.stringify(d).includes("SENTINEL"));
    assert(compare(d).findings.some((x) => x.section === "policies"));
    assert(compare(d).findings.some((x) => x.section === "views"));
  } finally {
    await f.db.exec(
      "alter policy campaigns_read on public.campaigns using (" +
        policy +
        ");create or replace view public.campaign_workspace" +
        clause +
        " as " +
        view,
    );
  }
});
test("PD-AC03: definition formatting requires an identical raw body; normalized body alone is insufficient", () => {
  const d = clone(),
    r = d.sections.functions[0];
  r.definition_hash = digest("other\r\n");
  assert(
    compare(d).findings.some(
      (x) => x.key === r.key && x.classification === "explained_metadata",
    ),
  );
  r.source_hash = digest("changed CRLF literal");
  assert(
    compare(d).findings.some(
      (x) => x.key === r.key && x.classification === "unresolved_definition",
    ),
  );
});
test("PD-AC03: whitespace inside a body literal is not normalized away", async () => {
  const { rows } = await f.db.query<{ definition: string }>(
    "select pg_get_functiondef('public.mail_is_team(text)'::regprocedure) definition",
  );
  try {
    await f.db.exec(
      "create or replace function public.mail_is_team(address text) returns boolean language sql stable security definer set search_path='' as $$select length('a b')=3$$",
    );
    const a = await f.snapshot();
    await f.db.exec(
      "create or replace function public.mail_is_team(address text) returns boolean language sql stable security definer set search_path='' as $$select length('ab')=3$$",
    );
    const b = await f.snapshot();
    assert.notEqual(
      a.sections.functions.find((x) => x.key === "public.mail_is_team(text)")!
        .source_lf_hash,
      b.sections.functions.find((x) => x.key === "public.mail_is_team(text)")!
        .source_lf_hash,
    );
    assert.equal(compareDiagnostics(a, b, f.scope).status, "findings_open");
  } finally {
    await f.db.exec(rows[0].definition);
  }
});
test("PD-AC03: a public function security setting is not treated as formatting", () => {
  const d = clone();
  d.sections.functions[0].search_path_kind = "other";
  assert(
    compare(d).findings.some(
      (x) => x.classification === "confirmed_permission_drift",
    ),
  );
});
test("PD-AC03: FK actions and ordered columns are compared structurally", () => {
  const d = clone(),
    fk = d.sections.constraints.find(
      (x) => x.key === "public.profiles.profiles_id_fkey",
    )!;
  assert.equal(fk.target, "auth.users");
  assert.deepEqual(fk.columns, ["id"]);
  fk.delete_action = "c";
  assert(
    compare(d).findings.some(
      (x) => x.key === fk.key && x.fields.includes("delete_action"),
    ),
  );
  const compound = d.sections.constraints.find((x) => x.columns.length > 1)!;
  compound.columns.reverse();
  assert(
    compare(d).findings.some(
      (x) => x.key === compound.key && x.fields.includes("columns"),
    ),
  );
});
test("PD-AC03: policy and view hashes remain unresolved, not silently accepted", () => {
  const d = clone();
  d.sections.policies[0].using_hash = digest("different");
  d.sections.views[0].definition_lf_hash = digest("changed");
  assert.equal(
    compare(d).findings.filter(
      (x) => x.classification === "unresolved_definition",
    ).length,
    2,
  );
});
test("PD-AC03: Storage additions remain a platform review, with no bucket rows", async () => {
  await f.db.exec("create index pd_fake_storage on storage.objects(name)");
  try {
    const d = await f.snapshot();
    assert(
      d.sections.storage_indexes.some(
        (x) => x.key === "storage.objects.pd_fake_storage",
      ),
    );
    assert(
      compare(d).findings.some((x) => x.classification === "platform_pending"),
    );
  } finally {
    await f.db.exec("drop index storage.pd_fake_storage");
  }
});
test("PD-AC05: missing and duplicate scoped objects are rejected", () => {
  bad((d) => {
    d.sections.functions.pop();
  });
  bad((d) => {
    d.sections.relations.push(d.sections.relations[0]);
  });
  bad((d) => {
    d.sections.policies.pop();
  });
});
test("PD-AC05: an unexpected public overload closes completeness", async () => {
  await f.db.exec(
    "create function public.pd_unexpected() returns void language sql as $$select$$",
  );
  try {
    await assert.rejects(f.snapshot(), DiagnosticInputError);
  } finally {
    await f.db.exec("drop function public.pd_unexpected()");
  }
});
test("PD-AC05: recursion depth is enforced by SQL before a partial graph can be accepted", async () => {
  for (let i = 0; i < 10; i++) await f.db.exec("create role pd_depth_" + i);
  for (let i = 0; i < 9; i++)
    await f.db.exec("grant pd_depth_" + (i + 1) + " to pd_depth_" + i);
  await f.db.exec("grant select on public.mail_uploads to pd_depth_0");
  try {
    await assert.rejects(f.snapshot(), DiagnosticInputError);
  } finally {
    await f.db.exec("revoke select on public.mail_uploads from pd_depth_0");
    for (let i = 0; i < 9; i++)
      await f.db.exec("revoke pd_depth_" + (i + 1) + " from pd_depth_" + i);
    for (let i = 0; i < 10; i++) await f.db.exec("drop role pd_depth_" + i);
  }
});
test("PD-AC05: altered scope, counts, recursion and limit flags are rejected", () => {
  bad((d) => {
    d.scope_sha256 = "0".repeat(64);
  });
  bad((d) => {
    d.completeness.counts.columns++;
  });
  bad((d) => {
    d.completeness.depth_exceeded = true;
  });
  bad((d) => {
    d.completeness.limits_ok = false;
  });
});
test("PD-AC05: wrong context and incomplete privilege visibility fail closed", () => {
  bad((d) => {
    d.context.read_only = "off" as "on";
  });
  bad((d) => {
    d.context.search_path = "public" as "pg_catalog";
  });
  bad((d) => {
    d.context.superuser = false;
  });
});
test("PD-AC04: unknown fields, opaque bodies and malformed wrappers do not enter the contract", () => {
  const d = clone();
  Object.assign(d.sections.functions[0], { prosrc: "DO NOT PRINT" });
  assert.throws(() => parseDiagnostic(d, f.scope), DiagnosticInputError);
  assert.throws(
    () =>
      parseDiagnostic(
        [
          {
            pipeline_os_abc_permissions_diagnostic: f.reference,
            secret: "private",
          },
        ],
        f.scope,
      ),
    DiagnosticInputError,
  );
  assert.throws(
    () => parseDiagnostic({ ...f.reference, credentials: "private" }, f.scope),
    DiagnosticInputError,
  );
});
test("PD-AC04/05: input size and JSON errors produce a fixed non-sensitive error", () => {
  for (const text of [
    "private invalid JSON",
    " ".repeat(maxDiagnosticBytes + 1),
  ])
    assert.throws(() => parseDiagnosticText(text, f.scope), {
      message: "PD_INPUT_INVALID_OR_INCOMPLETE",
    });
});
test("PD-AC01: root object order is irrelevant; accepted input includes the Studio wrapper", () => {
  const reversed = Object.fromEntries(Object.entries(f.reference).reverse());
  assert.deepEqual(
    parseDiagnostic(
      [{ pipeline_os_abc_permissions_diagnostic: reversed }],
      f.scope,
    ),
    f.reference,
  );
  assert.equal(compare(clone()).publicationApproved, false);
  assert.equal(compare(clone()).targetIdentityAttested, false);
});
test("PD-AC05: no execute or network command is exposed by the CLI", async () => {
  await assert.rejects(
    diagnosticCli(["--execute", "https://not-a-target.test"]),
    DiagnosticInputError,
  );
  await assert.rejects(
    diagnosticCli(["--compare", ".env.local", "x.json"]),
    DiagnosticInputError,
  );
  assert.equal(await diagnosticCli(["--render"]), f.sql);
});
test("PD-AC04: local file comparison works without any credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pd-offline-")),
    file = join(dir, "snapshot.json");
  await writeFile(file, JSON.stringify(f.reference));
  assert.deepEqual(await loadDiagnosticFile(file, f.scope), f.reference);
  const result = JSON.parse(await diagnosticCli(["--compare", file, file]));
  assert.equal(result.status, "no_unexplained_difference_in_scope");
  assert.equal(result.instantlyConsumed, 43);
});
test("PD-AC04/05: invalid scope identities cannot inject SQL", () => {
  const scope = structuredClone(f.scope);
  scope.functions[0].name = "x';select 1;--";
  assert.throws(() => parseScope(scope), DiagnosticInputError);
});
test("PD-AC06: final inventory is identical after all reversible fake changes", async () => {
  const final = await f.snapshot();
  assert.deepEqual(compare(final).findings, []);
  assert.equal(
    createHash("sha256").update(JSON.stringify(final)).digest("hex"),
    createHash("sha256").update(JSON.stringify(f.reference)).digest("hex"),
  );
  const files = await readFile(diagnosticRoot + "scope.json", "utf8");
  assert(!files.includes("private.person"));
});
