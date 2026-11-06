import { createHash } from "node:crypto";
import { readFile, stat, lstat } from "node:fs/promises";
import { basename, extname, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  fingerprintCtes,
  maxViewBytes,
  maxViewTokens,
  viewTokenPattern,
} from "./view-fingerprint";

export const remediationRoot =
  "docs/specs/pipeline-os/s02/release/permission-remediation/";
export const reviewSearchPath = "pg_catalog, pg_temp";
export class RemediationInputError extends Error {
  constructor() {
    super("PRM_INPUT_INVALID_OR_INCOMPLETE");
  }
}
const targetKeys = [
  "campaign_assets",
  "campaign_events",
  "campaign_workspace",
  "company_contacts",
  "company_primary_cases",
  "conversation_lenders",
  "document_reviews",
  "email_templates",
  "email_template_versions",
  "gmail_api_slots",
  "gmail_api_usage",
  "gmail_candidate_directory",
  "gmail_pending_associations",
  "gmail_sent_usage",
  "lead_workspace",
  "lender_contacts",
  "lender_guideline_versions",
  "mail_drafts",
  "mail_recipient_selections",
  "mail_uploads",
  "operational_settings",
  "opportunity_inbox",
  "opportunity_tasks",
  "opportunity_workspace",
  "process_state_history",
  "underwriting_runs",
  "underwriting_settings",
  "underwriting_setting_versions",
];
const permissionViews = [
  "campaign_workspace",
  "gmail_candidate_directory",
  "lead_workspace",
  "opportunity_inbox",
  "opportunity_tasks",
  "opportunity_workspace",
];
// Identity is pinned to the reviewed preparation manifest; schema validation also
// rejects injected identifiers, duplicate objects or altered privilege targets.
const tablePrivileges = [
  "DELETE",
  "INSERT",
  "REFERENCES",
  "SELECT",
  "TRIGGER",
  "TRUNCATE",
  "UPDATE",
] as const;
const targetSchema = z.strictObject({
  key: z.string().regex(/^public\.[a-z_]+$/),
  kind: z.enum(["r", "v"]),
  authenticated: z.array(z.enum(tablePrivileges)),
});
export type PermissionTarget = z.infer<typeof targetSchema>;
const viewKeys = [
  "public.campaign_workspace",
  "public.opportunity_inbox",
  "public.opportunity_tasks",
] as const;
const sha256 = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export async function loadPermissionTargets(): Promise<PermissionTarget[]> {
  const bytes = await readFile(remediationRoot + "permissions-matrix.json");
  const manifest = JSON.parse(
    await readFile(remediationRoot + "preparation-manifest.json", "utf8"),
  );
  const entry = manifest.artifacts.find(
    (p: { path: string }) =>
      p.path === remediationRoot + "permissions-matrix.json",
  );
  if (!entry || sha256(bytes) !== entry.sha256)
    throw new RemediationInputError();
  const matrix = JSON.parse(bytes.toString());
  const targets = matrix.relations.map(
    (r: {
      key: string;
      kind: string;
      authenticatedTarget: string[];
      anonTarget: string[];
    }) => {
      if (r.anonTarget.length) throw new RemediationInputError();
      return { key: r.key, kind: r.kind, authenticated: r.authenticatedTarget };
    },
  );
  return parseTargets(targets);
}
export function parseTargets(value: unknown): PermissionTarget[] {
  const p = z.array(targetSchema).length(28).safeParse(value);
  if (!p.success) throw new RemediationInputError();
  const t = p.data.sort((a, b) => a.key.localeCompare(b.key, "en"));
  if (new Set(t.map((r) => r.key)).size !== 28)
    throw new RemediationInputError();
  for (const r of t) {
    const name = r.key.slice(7);
    if (
      !targetKeys.includes(name) ||
      r.kind !== (permissionViews.includes(name) ? "v" : "r")
    )
      throw new RemediationInputError();
    const expected = [
      "public.mail_drafts",
      "public.mail_recipient_selections",
    ].includes(r.key)
      ? ["DELETE", "INSERT", "SELECT", "UPDATE"]
      : [
            "public.gmail_api_slots",
            "public.gmail_api_usage",
            "public.gmail_sent_usage",
          ].includes(r.key)
        ? []
        : ["SELECT"];
    if (JSON.stringify(r.authenticated) !== JSON.stringify(expected))
      throw new RemediationInputError();
  }
  return t;
}
export async function reviewScopeDigest() {
  return sha256(
    JSON.stringify({
      protocol: "VR1",
      searchPath: reviewSearchPath,
      views: viewKeys,
      targets: await loadPermissionTargets(),
      lexer: "ascii-quoted-bytes-v1",
      grammar: viewTokenPattern,
      sqlLexer: fingerprintCtes(),
      maxViewBytes,
      maxViewTokens,
    }),
  );
}

// Protected fingerprints contain catalog metadata only. In particular no business
// SELECT and no invocation of user-defined functions are used by PRM1 or VR1.
const protectedMetadata = `jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_object('key',s.key,'owner',c.relowner::text,'kind',c.relkind,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'options',c.reloptions,
 'acl',(select coalesce(jsonb_agg(x::text order by x::text),'[]'::jsonb) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where x.grantee not in(select oid from pg_roles where rolname in('anon','authenticated'))),
 'view',case when c.relkind='v' then md5(pg_get_viewdef(c.oid,false)) else null end,
 'columns',(select jsonb_agg(a::text order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) order by s.key)
 from jsonb_to_recordset(scope) s(key text,kind text,authenticated jsonb) join pg_class c on c.oid=to_regclass(s.key)),
 'policies',(select md5(string_agg(p::text,'|' order by p.oid)) from pg_policy p),
 'functions',(select md5(string_agg(p::text,'|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','storage')),
 'defaults',(select md5(string_agg(d::text,'|' order by d.oid)) from pg_default_acl d),
 'memberships',(select md5(string_agg(m::text,'|' order by m.member,m.roleid)) from pg_auth_members m),
 'storage',(select md5(string_agg(c::text,'|' order by c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage')
)`
  .replace(/\bc\b/g, "_catalog_relation")
  .replace(/\bs\b/g, "_scope_entry");

export async function renderPermissionCorrection(): Promise<string> {
  const targets = await loadPermissionTargets();
  return `-- PRM1 LOCAL CANDIDATE ONLY. NOT A NUMBERED MIGRATION OR AUTHORIZATION.
-- Requires an external offline fixture marker; no production execution command.
begin isolation level serializable;
set local statement_timeout='15s';
set local lock_timeout='2s';
set local search_path=${reviewSearchPath};
do $prm$
declare scope jsonb := ${literal(JSON.stringify(targets))}::jsonb;
 s record; c record; role_name text; privilege_name text; expected jsonb;
 protected_before jsonb; protected_after jsonb; role_oid oid; current_access text[];
begin
 if current_setting('pipeline_os.prm1_mode',true) is distinct from 'offline_fixture_only'
 or current_user<>'supabase_admin' or not exists(select 1 from pg_roles where rolname=current_user and rolsuper)
 then raise exception 'PRM_OFFLINE_GUARD'; end if;
 if (select count(*) from pg_roles where rolname in('anon','authenticated','service_role'))<>3
 or exists(select 1 from pg_roles where rolname in('anon','authenticated') and (rolsuper or rolbypassrls or not rolinherit))
 or exists(select 1 from pg_roles a join pg_roles b on b.oid<>a.oid where a.rolname in('anon','authenticated') and pg_has_role(a.oid,b.oid,'USAGE'))
 then raise exception 'PRM_ROLE_DRIFT'; end if;
 -- Locks are deterministic and held through COMMIT; real DDL/DCL concurrency QA remains a release gate.
 for s in select * from jsonb_to_recordset(scope) t(key text,kind text,authenticated jsonb) order by key loop
  if to_regclass(s.key) is null then raise exception 'PRM_OBJECT_DRIFT'; end if;
  execute format('lock table %s in access exclusive mode',s.key::regclass);
 end loop;
 for s in select * from jsonb_to_recordset(scope) t(key text,kind text,authenticated jsonb) order by key loop
  select r.*,o.rolname owner_name into c from pg_class r join pg_roles o on o.oid=r.relowner where r.oid=to_regclass(s.key);
  if c.relkind::text<>s.kind or c.owner_name<>'supabase_admin' or c.relforcerowsecurity
   or (s.kind='r' and not c.relrowsecurity) or (s.kind='v' and not coalesce(c.reloptions @> array['security_invoker=true'],false))
  then raise exception 'PRM_OBJECT_DRIFT'; end if;
  if exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attacl is not null)
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_roles r on r.oid=a.grantee
    where a.grantee=0 or r.rolname not in('supabase_admin','postgres','service_role','anon','authenticated')
      or (r.rolname in('anon','authenticated') and (a.grantor<>c.relowner or a.is_grantable)))
  then raise exception 'PRM_ACL_SOURCE_DRIFT'; end if;
  foreach role_name in array array['anon','authenticated'] loop
   select oid into role_oid from pg_roles where rolname=role_name;
   expected:=case when role_name='anon' then '[]'::jsonb else s.authenticated end;
   if exists(select 1 from jsonb_array_elements_text(expected) p where not has_table_privilege(role_oid,c.oid,p))
   then raise exception 'PRM_LEGITIMATE_ACCESS_MISSING'; end if;
  end loop;
 end loop;
 protected_before:=${protectedMetadata};
 for s in select * from jsonb_to_recordset(scope) t(key text,kind text,authenticated jsonb) order by key loop
  foreach role_name in array array['anon','authenticated'] loop
   expected:=case when role_name='anon' then '[]'::jsonb else s.authenticated end;
   for privilege_name in select a.privilege_type from pg_class acl_rel cross join lateral aclexplode(coalesce(acl_rel.relacl,acldefault('r',acl_rel.relowner))) a
    join pg_roles r on r.oid=a.grantee where acl_rel.oid=to_regclass(s.key) and r.rolname=role_name and not (expected ? a.privilege_type) order by a.privilege_type loop
    execute format('revoke %s on table %s from %I restrict',privilege_name,s.key::regclass,role_name);
   end loop;
  end loop;
 end loop;
 protected_after:=${protectedMetadata};
 if protected_before is distinct from protected_after then raise exception 'PRM_PRESERVATION_FAILED'; end if;
 for s in select * from jsonb_to_recordset(scope) t(key text,kind text,authenticated jsonb) order by key loop
  foreach role_name in array array['anon','authenticated'] loop
   expected:=case when role_name='anon' then '[]'::jsonb else s.authenticated end;
   select coalesce(array_agg(p order by p),array[]::text[]) into current_access
    from unnest(array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) p where has_table_privilege(role_name,s.key,p);
   if to_jsonb(current_access)<>expected then raise exception 'PRM_POSTFLIGHT_FAILED'; end if;
  end loop;
 end loop;
end $prm$;
commit;
`;
}

export async function renderViewReview(): Promise<string> {
  const digest = await reviewScopeDigest();
  return `-- VR1 METADATA ONLY. Separate authorization required for any real execution.
begin read only;
set local statement_timeout='15s';
set local lock_timeout='2s';
set local search_path=${reviewSearchPath};
set local standard_conforming_strings=on;
with recursive
expected(key) as (values ${viewKeys.map((k) => `(${literal(k)})`).join(",")}),
rels as (select e.key,c.*,r.rolname owner_name from expected e join pg_class c on c.oid=to_regclass(e.key) and c.relkind='v' join pg_roles r on r.oid=c.relowner),
definitions as (select key,pg_get_viewdef(oid,false) definition from rels),
${fingerprintCtes()},
deps as (
 select distinct r.key,d.deptype::text deptype,
 case when d.refclassid='pg_catalog.pg_class'::regclass then 'relation:'||n.nspname||'.'||c.relname||':'||d.refobjsubid::text
 when d.refclassid='pg_catalog.pg_proc'::regclass then 'function:'||pn.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'
 when d.refclassid='pg_catalog.pg_type'::regclass then 'type:'||tn.nspname||'.'||t.typname
 when d.refclassid='pg_catalog.pg_namespace'::regclass then 'schema:'||ns.nspname else null end descriptor
 from rels r join pg_rewrite rw on rw.ev_class=r.oid join pg_depend d on d.classid='pg_catalog.pg_rewrite'::regclass and d.objid=rw.oid
 left join pg_class c on d.refclassid='pg_catalog.pg_class'::regclass and c.oid=d.refobjid left join pg_namespace n on n.oid=c.relnamespace
 left join pg_proc p on d.refclassid='pg_catalog.pg_proc'::regclass and p.oid=d.refobjid left join pg_namespace pn on pn.oid=p.pronamespace
 left join pg_type t on d.refclassid='pg_catalog.pg_type'::regclass and t.oid=d.refobjid left join pg_namespace tn on tn.oid=t.typnamespace
 left join pg_namespace ns on d.refclassid='pg_catalog.pg_namespace'::regclass and ns.oid=d.refobjid
 where not(d.refclassid='pg_catalog.pg_class'::regclass and d.refobjid=r.oid and d.refobjsubid=0)
)
select jsonb_build_object('protocol','VR1','scopeSha256',${literal(digest)},
 'context',jsonb_build_object('version',current_setting('server_version_num'),'sqlRole',case when current_user in('supabase_admin','postgres') then current_user else 'role_'||md5(current_user) end,'readOnly',current_setting('transaction_read_only'),'searchPath',current_setting('search_path'),'standardStrings',current_setting('standard_conforming_strings')),
 'objectsOk',(select count(*)=3 from rels),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('key',r.key,'kind',r.relkind,'owner',case when r.owner_name in('supabase_admin','postgres') then r.owner_name else 'role_'||md5(r.owner_name) end,
 'security',coalesce(to_jsonb(r.reloptions),'[]'::jsonb),
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',n.nspname||'.'||t.typname,'typmod',a.atttypmod,'notNull',a.attnotnull) order by a.attnum) from pg_attribute a join pg_type t on t.oid=a.atttypid join pg_namespace n on n.oid=t.typnamespace where a.attrelid=r.oid and a.attnum>0 and not a.attisdropped),
 'definition',jsonb_build_object('rawHash',md5(d.definition),'lfHash',md5(replace(d.definition,E'\\r\\n',E'\\n')),'lexical',f.fingerprint),
 'dependencies',jsonb_build_object('count',(select count(*) from deps where key=r.key),'unsupported',(select count(*) from deps where key=r.key and descriptor is null),'hash',(select md5(coalesce(string_agg(deptype||':'||descriptor,'|' order by deptype,descriptor),'')) from deps where key=r.key))) order by r.key),'[]'::jsonb)
 from rels r join definitions d on d.key=r.key join fingerprints f on f.key=r.key)) pipeline_os_abc_view_review;
rollback;
`;
}

const hash = z.string().regex(/^[a-f0-9]{32}$/);
const identifier = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z_0-9]*$/)
  .max(128);
const lexical = z
  .strictObject({
    status: z.enum(["complete", "incomplete"]),
    count: z
      .number()
      .int()
      .min(0)
      .max(maxViewTokens + 1),
    hash: hash.nullable(),
    quotedHash: hash.nullable(),
  })
  .refine((v) =>
    v.status === "complete"
      ? v.hash !== null && v.quotedHash !== null
      : v.hash === null && v.quotedHash === null,
  );
const reviewSchema = z.strictObject({
  protocol: z.literal("VR1"),
  scopeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  context: z.strictObject({
    version: z.string().regex(/^1[5-8][0-9]{4}$/),
    sqlRole: z.string().regex(/^(supabase_admin|postgres|role_[a-f0-9]{32})$/),
    readOnly: z.literal("on"),
    searchPath: z.literal(reviewSearchPath),
    standardStrings: z.literal("on"),
  }),
  objectsOk: z.literal(true),
  views: z
    .array(
      z.strictObject({
        key: z.enum(viewKeys),
        kind: z.literal("v"),
        owner: z
          .string()
          .regex(/^(supabase_admin|postgres|role_[a-f0-9]{32})$/),
        security: z
          .array(
            z.enum([
              "security_invoker=true",
              "security_invoker=false",
              "security_barrier=true",
              "security_barrier=false",
            ]),
          )
          .max(4),
        columns: z
          .array(
            z.strictObject({
              name: identifier,
              type: z
                .string()
                .regex(/^[A-Za-z_][A-Za-z_0-9]*\.[A-Za-z_][A-Za-z_0-9]*$/),
              typmod: z.number().int(),
              notNull: z.boolean(),
            }),
          )
          .min(1)
          .max(256),
        definition: z.strictObject({ rawHash: hash, lfHash: hash, lexical }),
        dependencies: z.strictObject({
          count: z.number().int().min(0).max(1024),
          unsupported: z.number().int().min(0).max(1024),
          hash,
        }),
      }),
    )
    .length(3),
});
export type ViewReview = z.infer<typeof reviewSchema>;
export function parseViewReview(input: unknown, digest: string): ViewReview {
  if (Array.isArray(input) && input.length === 1) {
    const row = z
      .strictObject({ pipeline_os_abc_view_review: z.unknown() })
      .safeParse(input[0]);
    if (!row.success) throw new RemediationInputError();
    input = row.data.pipeline_os_abc_view_review;
  }
  const p = reviewSchema.safeParse(input);
  if (
    !p.success ||
    p.data.scopeSha256 !== digest ||
    new Set(p.data.views.map((v) => v.key)).size !== 3
  )
    throw new RemediationInputError();
  for (const v of p.data.views) {
    if (
      new Set(v.columns.map((c) => c.name)).size !== v.columns.length ||
      new Set(v.security).size !== v.security.length
    )
      throw new RemediationInputError();
  }
  return p.data;
}
export function compareViewReviews(
  reference: ViewReview,
  observed: ViewReview,
  digest: string,
) {
  const a = parseViewReview(reference, digest),
    b = parseViewReview(observed, digest);
  const results = a.views.map((expected) => {
    const actual = b.views.find((v) => v.key === expected.key)!;
    const definitionsComparable =
      expected.definition.lexical.status === "complete" &&
      actual.definition.lexical.status === "complete";
    const exact = expected.definition.rawHash === actual.definition.rawHash;
    const sameTokens =
      definitionsComparable &&
      JSON.stringify(expected.definition.lexical) ===
        JSON.stringify(actual.definition.lexical);
    const metadataMatches =
      actual.owner === expected.owner &&
      actual.security.includes("security_invoker=true") &&
      JSON.stringify(actual.security.toSorted()) ===
        JSON.stringify(expected.security.toSorted()) &&
      JSON.stringify(actual.columns) === JSON.stringify(expected.columns) &&
      actual.dependencies.unsupported === 0 &&
      expected.dependencies.unsupported === 0 &&
      JSON.stringify(actual.dependencies) ===
        JSON.stringify(expected.dependencies);
    return {
      key: expected.key,
      status:
        definitionsComparable && metadataMatches && sameTokens
          ? "definition_matches_in_scope"
          : "unresolved",
      rawHashMatches: exact,
      lexicalMatches: sameTokens,
      metadataMatches,
    };
  });
  return {
    protocol: "VR1",
    results,
    allViewsMatch: results.every(
      (v) => v.status === "definition_matches_in_scope",
    ),
    publicationApproved: false,
    targetIdentityAttested: false,
    permissionCorrectionApproved: false,
    instantlyConsumed: 43,
    externalCalls: 0,
  };
}
export const maxReviewBytes = 262_144;
export async function loadViewReview(file: string, digest: string) {
  if (
    extname(file).toLowerCase() !== ".json" ||
    basename(file).startsWith(".env") ||
    /^(?:[\\/]{2}|[a-z]+:\/\/)/i.test(file)
  )
    throw new RemediationInputError();
  try {
    for (let p = resolve(file); ; p = dirname(p)) {
      if ((await lstat(p)).isSymbolicLink()) throw new RemediationInputError();
      if (dirname(p) === p) break;
    }
    const s = await stat(file);
    if (!s.isFile() || s.size > maxReviewBytes)
      throw new RemediationInputError();
    const bytes = await readFile(file);
    if (bytes.length > maxReviewBytes) throw new RemediationInputError();
    return parseViewReview(JSON.parse(bytes.toString("utf8")), digest);
  } catch {
    throw new RemediationInputError();
  }
}
export async function remediationCli(args: string[]): Promise<string> {
  if (args.length === 1 && args[0] === "--render-correction")
    return renderPermissionCorrection();
  if (args.length === 1 && args[0] === "--render-review")
    return renderViewReview();
  if (args.length === 3 && args[0] === "--compare") {
    const digest = await reviewScopeDigest();
    return JSON.stringify(
      compareViewReviews(
        await loadViewReview(args[1], digest),
        await loadViewReview(args[2], digest),
        digest,
      ),
      null,
      2,
    );
  }
  throw new RemediationInputError();
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  remediationCli(process.argv.slice(2))
    .then((text) =>
      process.stdout.write(text + (text.endsWith("\n") ? "" : "\n")),
    )
    .catch(() => {
      process.stderr.write("PRM_INPUT_INVALID_OR_INCOMPLETE\n");
      process.exitCode = 1;
    });
}
