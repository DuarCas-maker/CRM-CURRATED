import { readFile } from "node:fs/promises";
import { remediationFixture } from "./pipeline-os-permission-remediation";

export const abcFinalRoot = "docs/specs/pipeline-os/s02/release/abc-final/";
export const abcCandidates = [
  "docs/specs/pipeline-os/s02/integration/migrations/a-brand-foundation.local.sql",
  "docs/specs/pipeline-os/s02/integration/migrations/a-mail-permissions.local.sql",
  "docs/specs/pipeline-os/s02/integration/block-b/migrations/b-brand-management.local.sql",
  "docs/specs/pipeline-os/s02/integration/block-b/migrations/b-brand-delivery.local.sql",
  "docs/specs/pipeline-os/s02/integration/block-c/migrations/c-composio-bindings.local.sql",
];

// A dedicated synthetic DB; no clients, environment, provider or process startup.
export async function abcFinalFixture(cleanDefaults = false) {
  const f = await remediationFixture();
  try {
    await f.db.exec("reset role");
    const objects = await f.db.query<{ sql: string }>(`
      select format('alter %s %I.%I owner to supabase_admin',case c.relkind when 'v' then 'view' when 'S' then 'sequence' else 'table' end,n.nspname,c.relname) sql
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','v','S')
      union all select 'alter function '||p.oid::regprocedure::text||' owner to supabase_admin' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
    `);
    for (const row of objects.rows) await f.db.exec(row.sql);
    await f.admin();
    for (const t of f.targets)
      await f.db.exec(
        `revoke maintain on table ${t.key} from anon,authenticated`,
      );
    await f.db.exec(
      await readFile(
        "docs/specs/pipeline-os/s02/release/permission-remediation/final/048_restore_scoped_public_permissions.sql",
        "utf8",
      ),
    );
    if (cleanDefaults)
      await f.db
        .exec(`alter default privileges for role supabase_admin in schema public revoke all on tables from anon,authenticated,service_role,postgres;
        alter default privileges for role supabase_admin in schema public revoke all on functions from anon,authenticated,service_role,postgres;
        alter default privileges for role supabase_admin in schema public revoke all on sequences from anon,authenticated,service_role,postgres`);
    return f;
  } catch (error) {
    await f.db.close();
    throw error;
  }
}

export async function installAbcReference(
  f: Awaited<ReturnType<typeof abcFinalFixture>>,
) {
  await f.admin();
  await f.db.exec("set search_path=pg_catalog,public,pg_temp");
  await f.db.exec(
    "set pipeline_os.block_a_local='in_memory_test';set pipeline_os.block_b1_local='in_memory_test';set pipeline_os.block_b2_local='in_memory_test';set pipeline_os.block_c_local='in_memory_test'",
  );
  for (const file of abcCandidates)
    await f.db.exec(await readFile(file, "utf8"));
}

// Logical metadata only, never OIDs, customer rows or source text in outputs.
// PG15's seven table operations are intentional; MAINTAIN did not exist there.
export const abcSnapshotQuery = `with roles(name) as(values('anon'),('authenticated'),('service_role')),
relations as(
 select n.nspname||'.'||c.relname key,jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'options',coalesce(to_jsonb(c.reloptions),'[]'),
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'defaultHash',md5(pg_get_expr(d.adbin,d.adrelid)),
 'acl',(select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantee),x.privilege_type,x.is_grantable) order by x.grantee::regrole::text,x.privilege_type),'[]') from aclexplode(a.attacl) x where x.grantee in(select oid from pg_roles where rolname in('anon','authenticated','service_role')))) order by a.attnum),'[]') from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'access',(select jsonb_object_agg(r.name,(select coalesce(jsonb_agg(priv order by priv),'[]') from unnest(array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) priv where has_table_privilege(r.name,c.oid,priv))) from roles r),
 'publicAccess',exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where x.grantee=0),
 'viewHash',case when c.relkind='v' then md5(pg_get_viewdef(c.oid,false)) end) value
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','storage') and c.relkind in('r','v','p')),
functions as(
 select format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)) key,jsonb_build_object('owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'language',l.lanname,'volatility',p.provolatile,'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel,'returnsSet',p.proretset,'result',pg_get_function_result(p.oid),'names',coalesce(to_jsonb(p.proargnames),'[]'),'config',coalesce(to_jsonb(p.proconfig),'[]'),'defaultsHash',md5(pg_get_expr(p.proargdefaults,0)),
 'sourceHash',md5(p.prosrc),'execute',(select jsonb_object_agg(r.name,has_function_privilege(r.name,p.oid,'execute')) from roles r),
 'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE')) value
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname in('public','s01_i02','brand_b1','brand_b2','composio_c1') and p.prokind='f'),
policies as(select n.nspname||'.'||c.relname||'.'||p.polname key,jsonb_build_object('relation',n.nspname||'.'||c.relname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles) r),'usingHash',md5(pg_get_expr(p.polqual,p.polrelid)),'checkHash',md5(pg_get_expr(p.polwithcheck,p.polrelid))) value from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','storage')),
triggers as(select n.nspname||'.'||c.relname||'.'||t.tgname key,jsonb_build_object('relation',n.nspname||'.'||c.relname,'enabled',t.tgenabled,'hash',md5(pg_get_triggerdef(t.oid))) value from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','storage') and not t.tgisinternal),
constraints as(select n.nspname||'.'||c.relname||'.'||x.conname key,jsonb_build_object('relation',n.nspname||'.'||c.relname,'kind',x.contype,'validated',x.convalidated,'hash',md5(pg_get_constraintdef(x.oid))) value from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and x.contype<>'n'),
indexes as(select schemaname||'.'||indexname key,jsonb_build_object('relation',schemaname||'.'||tablename,'hash',md5(indexdef)) value from pg_indexes where schemaname in('public','storage')),
schemas as(select nspname key,jsonb_build_object('owner',pg_get_userbyid(nspowner),'access',(select jsonb_object_agg(r.name,jsonb_build_array(has_schema_privilege(r.name,n.oid,'USAGE'),has_schema_privilege(r.name,n.oid,'CREATE'))) from roles r),'publicAccess',exists(select 1 from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x where x.grantee=0)) value from pg_namespace n where nspname in('s01_i02','brand_b1','brand_b2','composio_c1'))
select jsonb_build_object(${["relations", "functions", "policies", "triggers", "constraints", "indexes", "schemas"].map((g) => `'${g}',(select coalesce(jsonb_object_agg(key,value order by key),'{}') from ${g})`).join(",")}) snapshot`;

export async function abcSnapshot(
  f: Awaited<ReturnType<typeof abcFinalFixture>>,
) {
  await f.admin();
  await f.db.exec("set search_path=pg_catalog,pg_temp");
  return (
    await f.db.query<{ snapshot: Record<string, Record<string, any>> }>(
      abcSnapshotQuery,
    )
  ).rows[0].snapshot;
}
