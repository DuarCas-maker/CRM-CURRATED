import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const abcPreflightRoot = "docs/specs/pipeline-os/s02/release/abc-final/";
export const campaignWorkspaceHashes = [
  "f0ac44d1f4e3fb6738d3593c70279216",
  "321f987da7339d43e9de9d6b45cf5b63",
] as const;
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

// Only the pre-install representation of this already reviewed view varies.
// Every other attribute, object and final-state comparison remains exact.
export const acceptedViewSql = `mode='pre' and g='relations' and k='public.campaign_workspace'
 and (a-'viewHash') is not distinct from (v-'viewHash')
 and v->>'viewHash'=${quote(campaignWorkspaceHashes[0])}
 and coalesce(a->>'viewHash' in (${campaignWorkspaceHashes.map(quote).join(",")}),false)`;
export const oldExactBranch =
  "elsif a is distinct from v then ok:=false;end if;";
export const correctedExactBranch = `elsif (${acceptedViewSql}) then null;
 ${oldExactBranch}`;

/** Deterministic generation from reviewed public artifacts; no DB or network. */
export function renderAbcPreflight(migration: string, contractText: string) {
  const d = JSON.parse(contractText);
  assert.equal(d.ordinal, "049");
  assert.equal(d.protocol, "ABC-FINAL-r1");
  assert.equal(
    d.pre.relations["public.campaign_workspace"].viewHash,
    campaignWorkspaceHashes[0],
  );
  assert.equal(migration.split(correctedExactBranch).length - 1, 2);
  assert(migration.includes(sha256(contractText)));
  assert(migration.includes(quote(JSON.stringify(d)) + "::jsonb"));
  const start = migration.indexOf("select snapshot into observed from (");
  const end = migration.indexOf(") x;", start);
  assert(start > 0 && end > start);
  const capture = migration.slice(start, end + 4);
  // This SELECT is the very same logical metadata query used by 049.
  assert(capture.includes("pg_get_viewdef") && capture.includes("pg_policy"));
  assert(
    !/\b(insert|update|delete|create|alter|drop|lock)\s/i.test(
      capture.replaceAll("'UPDATE'", "''").replaceAll("'DELETE'", "''"),
    ),
  );
  const contractSha = sha256(contractText),
    migrationSha = sha256(migration);
  return `-- AF-PRE-r1: proposed single full preflight, NOT execution authorization.
-- Catalog metadata + fixed anonymous aggregates only. No business RPC or DDL/DML.
-- Contract SHA256 ${contractSha}
-- Migration049 SHA256 ${migrationSha}
begin isolation level repeatable read read only;
set local statement_timeout='15s';set local lock_timeout='2s';
set local search_path=pg_catalog,pg_temp;
do $af_preflight$
declare d jsonb:=${quote(JSON.stringify(d))}::jsonb;
 observed jsonb;g text;k text;field text;v jsonb;a jsonb;t jsonb;got jsonb;
 mode text:='pre';mismatches jsonb:='[]';checks jsonb:='{}';
 context_ok boolean;roles_ok boolean;counts jsonb;queue_state jsonb:=null;
 queue_ok boolean:=false;legacy_review boolean:=true;detail_limit integer:=200;
 column_record record;fn_record record;expected_acl jsonb;expected_column jsonb;
 report jsonb;contract_ok boolean;queue_shape_ok boolean;
begin
 context_ok:=current_user='supabase_admin'
  and coalesce((select rolsuper from pg_roles where rolname=current_user),false)
  and current_setting('server_version_num')::integer between 150000 and 189999
  and current_setting('transaction_read_only')='on'
  and current_setting('transaction_isolation')='repeatable read'
  and current_setting('search_path')='pg_catalog, pg_temp';
 checks:=checks||jsonb_build_object('context',context_ok);
 if (select count(*) from pg_roles where rolname in('anon','authenticated','service_role'))<>3
  or not context_ok then
  report:=jsonb_build_object('protocol','AF-PRE-r1','ordinal','049',
   'contractSha256',${quote(contractSha)},'migrationSha256',${quote(migrationSha)},
   'complete',false,'catalogOk',false,'preconditionsOk',false,'publicationReady',false,
   'context',jsonb_build_object('sqlRole',current_user,'version',current_setting('server_version_num'),
    'readOnly',current_setting('transaction_read_only'),'searchPath',current_setting('search_path')),
   'checks',checks,'stopReason','CONTEXT_OR_REQUIRED_ROLES_MISSING');
  perform set_config('pipeline_os.abc_preflight',report::text,true);return;
 end if;
 roles_ok:=(select count(*)=2 and bool_and(rolinherit and not rolsuper and not rolbypassrls)
  from pg_roles where rolname in('anon','authenticated'))
  and exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls and not rolsuper)
  and not exists(select 1 from pg_roles r cross join (values('anon'),('authenticated'),('service_role')) h(name)
   where r.rolname<>h.name and pg_has_role(h.name,r.oid,'MEMBER'))
  and not exists(select 1 from (values('anon'),('authenticated'),('service_role')) h(name)
   where not has_schema_privilege(h.name,'public','USAGE') or has_schema_privilege(h.name,'public','CREATE'));
 checks:=checks||jsonb_build_object('rolesMembershipsAndPublicSchema',roles_ok);
 ${capture}
 -- Exact inventory by set; does not repeat the dedicated AF-INV diagnostic.
 checks:=checks||jsonb_build_object('baseFunctionInventory',
  coalesce((select jsonb_object_agg(fn_name,true) from jsonb_object_keys(observed->'functions') fn_name where fn_name like 'public.%'),'{}'::jsonb)
   = (select coalesce(jsonb_object_agg(fn_name,true),'{}'::jsonb) from jsonb_array_elements_text(d->'basePublicFunctionNames') fn_name));
 -- Field names only in the report: never actual/expected source, names or ACL data.
 for g in select jsonb_object_keys(d->'pre') order by 1 loop
  for k,v in select * from jsonb_each(d->'pre'->g) order by key loop
   a:=coalesce(observed->g->k,'null'::jsonb);
   if v='null'::jsonb or a='null'::jsonb then
    if a is distinct from v then mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group',g,'object',k,'field','presence'));end if;
   else
    for field in select jsonb_object_keys(v) union select jsonb_object_keys(a) loop
     if g='functions' and field='sourceHash' and coalesce((d->'sourceVariants'->k)?(a->>'sourceHash'),false) then continue;end if;
     if field='viewHash' and (${acceptedViewSql}) then continue;end if;
     if a->field is distinct from v->field then
      mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group',g,'object',k,'field',field));
     end if;
    end loop;
   end if;
  end loop;
 end loop;
 -- Check accepted048 table rights even on relations outside the049 delta.
 for t in select * from jsonb_array_elements(d->'prmTargets') loop
  for k in select unnest(array['anon','authenticated']) loop
   got:=null;
   if to_regclass(t->>'key') is not null then
    select coalesce(jsonb_agg(p order by p),'[]') into got
     from unnest(array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) p
     where has_table_privilege(k,to_regclass(t->>'key'),p);
   end if;
   if got is distinct from (case when k='anon' then '[]'::jsonb else t->'authenticated' end) then
    mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group','accepted048','object',t->>'key','field',k||'.tablePrivileges'));
   end if;
  end loop;
 end loop;
 -- Explicit grants incl grant option: effective EXECUTE alone would miss it.
 for fn_record in select e.key,e.value,p.oid,p.proacl,p.proowner
  from jsonb_each(d->'pre'->'functions') e join pg_proc p on p.oid=to_regprocedure(e.key)
  where e.value<>'null'::jsonb loop
  select coalesce(jsonb_agg(jsonb_build_array(r.key,'EXECUTE',false) order by r.key),'[]') into expected_acl
   from jsonb_each(fn_record.value->'execute') r where r.value='true'::jsonb;
  select coalesce(jsonb_agg(jsonb_build_array(case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
   order by case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end),'[]') into got
   from aclexplode(coalesce(fn_record.proacl,acldefault('f',fn_record.proowner))) x
   where x.grantee=0 or x.grantee in(select oid from pg_roles where rolname in('anon','authenticated','service_role'));
  if got is distinct from expected_acl then mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group','functionAcl','object',fn_record.key,'field','directPrivilegesAndGrantOption'));end if;
 end loop;
 -- Delta columns: all three app roles + PUBLIC. Other048 columns: human roles
 -- + PUBLIC must be empty (048 revokes them); service grants there are unasserted.
 for column_record in select n.nspname||'.'||c.relname relation_key,a.attname,a.attacl
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where (d->'pre'->'relations'->(n.nspname||'.'||c.relname) is not null
   and d->'pre'->'relations'->(n.nspname||'.'||c.relname)<>'null'::jsonb)
   or exists(select 1 from jsonb_array_elements(d->'prmTargets') z where z->>'key'=n.nspname||'.'||c.relname) loop
  select z into expected_column from jsonb_array_elements(coalesce(d->'pre'->'relations'->column_record.relation_key->'columns','[]')) z where z->>'name'=column_record.attname;
  expected_acl:=coalesce(expected_column->'acl','[]');
  select coalesce(jsonb_agg(jsonb_build_array(case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
   order by case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type),'[]') into got
   from aclexplode(column_record.attacl) x where x.grantee=0
   or x.grantee in(select oid from pg_roles where rolname in('anon','authenticated') or (expected_column is not null and rolname='service_role'));
  if got is distinct from expected_acl then mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group','columnAcl','object',column_record.relation_key,'column',column_record.attname,'field','directPrivilegesAndGrantOption'));end if;
 end loop;
 -- Check input shapes before reading fixed anonymous operational aggregates.
 select count(*)=3 into queue_shape_ok from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in('outbox','campaigns','campaign_enrollments') and c.relkind='r'
  and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='status' and not a.attisdropped and a.atttypid='text'::regtype);
 if queue_shape_ok then
  select jsonb_build_object('sending',count(*) filter(where status='sending'),
   'queued',count(*) filter(where status='queued'),'uncertain',count(*) filter(where status='uncertain'),
   'paused',count(*) filter(where status='paused'),
   'activeCampaigns',(select count(*) from public.campaigns where status='active'),
   'activeEnrollments',(select count(*) from public.campaign_enrollments where status='active')) into queue_state from public.outbox;
  queue_ok:=(queue_state->>'sending')::bigint=0;
  legacy_review:=exists(select 1 from jsonb_each_text(queue_state) e where e.key<>'sending' and e.value::bigint>0);
 end if;
 checks:=checks||jsonb_build_object('queueShape',queue_shape_ok,'noSending',queue_ok);
 select jsonb_object_agg(e.key,(select jsonb_object_agg('expected'||s.kind,count_value) from
  (select 'Present' kind,count(*) filter(where x.value<>'null'::jsonb) count_value from jsonb_each(e.value) x
   union all select 'Absent',count(*) filter(where x.value='null'::jsonb) from jsonb_each(e.value) x) s))
  into counts from jsonb_each(d->'pre') e;
 contract_ok:=jsonb_array_length(mismatches)=0 and not exists(select 1 from jsonb_each(checks) e where e.value<>'true'::jsonb and e.key not in('queueShape','noSending'));
 report:=jsonb_build_object('protocol','AF-PRE-r1','ordinal','049',
  'contractSha256',${quote(contractSha)},'migrationSha256',${quote(migrationSha)},
  'context',jsonb_build_object('sqlRole',current_user,'version',current_setting('server_version_num'),
   'readOnly',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),
   'searchPath',current_setting('search_path')),
  'complete',true,'catalogOk',contract_ok,'preconditionsOk',contract_ok and queue_ok and queue_shape_ok,
  'publicationReady',false,'checks',checks,'scope',counts,
  'mismatchCount',jsonb_array_length(mismatches),
  'mismatches',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(mismatches) with ordinality where ordinality<=detail_limit),
  'detailsTruncated',jsonb_array_length(mismatches)>detail_limit,
  'queue',queue_state,'legacyReviewRequired',legacy_review,
  'limits',jsonb_build_array('snapshot_only_not_worker_pause','PG15_DDL_and_final_views_still_require_isolated_QA',
   'backup_build_visual_installer_cutover_and_authorization_not_checked','unrelated_objects_and_other_role_grants_outside_contract_not_certified'),
  'gmailProviderExpected','gmail_oauth','composioEnabledExpected',false);
 perform set_config('pipeline_os.abc_preflight',report::text,true);
end $af_preflight$;
select current_setting('pipeline_os.abc_preflight')::jsonb pipeline_os_abc_preflight;
rollback;
`;
}
