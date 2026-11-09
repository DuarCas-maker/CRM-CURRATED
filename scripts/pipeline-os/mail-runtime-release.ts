import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const runtimeReleaseRoot =
  "docs/specs/pipeline-os/s02/release/mail-runtime-final/";
export const runtimeMigration = "050_integrate_mail_runtime_and_connect.sql";
export const runtimeSources = [
  [
    "docs/specs/pipeline-os/s02/connect-gmail/migrations/connect-t002.local.sql",
    "create schema composio_connect;",
  ],
  [
    "docs/specs/pipeline-os/s02/worker-control/migrations/worker-control.local.sql",
    "pipeline_os.worker_control_local",
  ],
  [
    "docs/specs/pipeline-os/s02/transport-selection/migrations/r06.local.sql",
    "pipeline_os.r06_local",
  ],
  [
    "docs/specs/pipeline-os/s02/transport-selection/migrations/r06-i02.local.sql",
    "pipeline_os.r06_i02_local",
  ],
  [
    "docs/specs/pipeline-os/s02/transport-selection/migrations/r06-i03.local.sql",
    "pipeline_os.r06_i03_local",
  ],
  [
    "docs/specs/pipeline-os/s02/connect-gmail/migrations/connect-t009.local.sql",
    "create schema composio_connect_runtime;",
  ],
] as const;
export const runtimeSchemas = [
  "composio_connect",
  "worker_pilot",
  "mail_runtime",
  "composio_connect_runtime",
];
export const hash = (b: string | Buffer) =>
  createHash("sha256").update(b).digest("hex");
export const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export type Snapshot = Record<string, Record<string, unknown>>;
export type RuntimeContract = {
  protocol: "MR-FINAL-r1";
  ordinal: "050";
  sources: {
    path: string;
    sha256: string;
    bytes: number;
    transformation: string;
  }[];
  accepted049: string;
  authCompatibility: {
    revision: "MR-AUTH-r1";
    naiveRefreshedAtZone: "UTC";
    originalSourcesUnchanged: true;
    overlay: string[];
  };
  pre: Snapshot;
  post: Snapshot;
  dependencies: Snapshot;
};

// Preserve every functional/source guard. Replace the disposable-host wrapper
// with final guards, then apply only the declared MR-AUTH-r1 refresh-time overlay.
export function runtimeDdl(inputs: string[]) {
  assert.equal(inputs.length, runtimeSources.length);
  return inputs
    .map((original, i) => {
      let sql = original.replaceAll("\r\n", "\n");
      const [file, marker] = runtimeSources[i];
      if (marker.startsWith("create schema")) {
        assert.equal(sql.split(marker).length, 2);
        assert(
          sql
            .slice(0, sql.indexOf(marker))
            .includes(
              i === 0 ? "CONNECT_T002_LOCAL_ONLY" : "CONNECT_T009_LOCAL_ONLY",
            ),
        );
        sql = sql.slice(sql.indexOf(marker)).replace(/commit;\s*$/, "");
      } else {
        const lines = sql.split("\n"),
          matches = lines.filter((l) => l.includes(marker));
        assert.equal(matches.length, 1);
        assert(
          matches[0].trimStart().startsWith("if current_setting(") &&
            matches[0].trimEnd().endsWith("end if;"),
        );
        sql = lines.filter((l) => !l.includes(marker)).join("\n");
      }
      if (i === 0 || i === 5) {
        const anchor = "coalesce(s.refreshed_at,s.created_at)";
        assert.equal(
          sql.split(anchor).length,
          2,
          "Auth refresh anchor changed",
        );
        sql = sql.replace(
          anchor,
          "coalesce(composio_connect.refreshed_at_utc(s.refreshed_at),s.created_at)",
        );
      }
      if (i === 0) {
        const anchor = "create function composio_connect.digest(value text)";
        assert.equal(
          sql.split(anchor).length,
          2,
          "Auth helper insertion anchor changed",
        );
        sql = sql.replace(
          anchor,
          () => `-- MR-AUTH-r1: Supabase writes naive refreshed_at in UTC; do not use caller TimeZone.
create function composio_connect.refreshed_at_utc(value timestamp without time zone) returns timestamptz
language sql immutable strict set search_path='' as $$select value at time zone 'UTC'$$;
create function composio_connect.refreshed_at_utc(value timestamp with time zone) returns timestamptz
language sql immutable strict set search_path='' as $$select value$$;
${anchor}`,
        );
      }
      assert(!/\bbegin;|\bcommit;|\brollback;/i.test(sql));
      return `-- Reviewed component: ${file}\n${sql.trim()}\n`;
    })
    .join("\n");
}

// PG15 logical metadata, independent of OIDs and row contents. LF normalization
// applies to function source only; never to strings inside SQL or other fields.
export const runtimeCatalog = `with roles(name) as(values('anon'),('authenticated'),('service_role')),
ns as(select oid,nspname,nspowner,nspacl from pg_namespace where nspname in('public','storage','s01_i02','brand_b1','brand_b2','composio_c1','composio_connect','worker_pilot','mail_runtime','composio_connect_runtime')),
relations as(select n.nspname||'.'||c.relname key,jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'options',coalesce(to_jsonb(c.reloptions),'[]'),
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'defaultHash',md5(pg_get_expr(d.adbin,d.adrelid)),
 'acl',(select coalesce(jsonb_agg(jsonb_build_array(case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantee,x.privilege_type),'[]') from aclexplode(a.attacl) x)) order by a.attnum),'[]') from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'access',(select jsonb_object_agg(r.name,(select coalesce(jsonb_agg(priv order by priv),'[]') from unnest(array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) priv where has_table_privilege(r.name,c.oid,priv))) from roles r),
 'publicAccess',exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where x.grantee=0),'viewHash',case when c.relkind='v' then md5(pg_get_viewdef(c.oid,false)) end) value
 from pg_class c join ns n on n.oid=c.relnamespace where c.relkind in('r','v','p')),
functions as(select format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)) key,jsonb_build_object('owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'language',l.lanname,'volatility',p.provolatile,'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel,'returnsSet',p.proretset,'result',pg_get_function_result(p.oid),'names',coalesce(to_jsonb(p.proargnames),'[]'),'config',coalesce(to_jsonb(p.proconfig),'[]'),'defaultsHash',md5(pg_get_expr(p.proargdefaults,0)),
 'sourceHash',md5(replace(p.prosrc,E'\\r\\n',E'\\n')),'execute',(select jsonb_object_agg(r.name,has_function_privilege(r.name,p.oid,'execute')) from roles r),'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE')) value from pg_proc p join ns n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.prokind='f'),
policies as(select n.nspname||'.'||c.relname||'.'||p.polname key,jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by r) from unnest(p.polroles) r),'usingHash',md5(pg_get_expr(p.polqual,p.polrelid)),'checkHash',md5(pg_get_expr(p.polwithcheck,p.polrelid))) value from pg_policy p join pg_class c on c.oid=p.polrelid join ns n on n.oid=c.relnamespace),
triggers as(select n.nspname||'.'||c.relname||'.'||t.tgname key,jsonb_build_object('enabled',t.tgenabled,'hash',md5(pg_get_triggerdef(t.oid))) value from pg_trigger t join pg_class c on c.oid=t.tgrelid join ns n on n.oid=c.relnamespace where not t.tgisinternal),
constraints as(select n.nspname||'.'||c.relname||'.'||x.conname key,jsonb_build_object('kind',x.contype,'validated',x.convalidated,'hash',md5(pg_get_constraintdef(x.oid))) value from pg_constraint x join pg_class c on c.oid=x.conrelid join ns n on n.oid=c.relnamespace where x.contype<>'n'),
indexes as(select schemaname||'.'||indexname key,jsonb_build_object('relation',schemaname||'.'||tablename,'hash',md5(indexdef)) value from pg_indexes where schemaname in(select nspname from ns)),
schemas as(select n.nspname key,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'access',(select jsonb_object_agg(r.name,jsonb_build_array(has_schema_privilege(r.name,n.oid,'USAGE'),has_schema_privilege(r.name,n.oid,'CREATE'))) from roles r),'publicAccess',exists(select 1 from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x where x.grantee=0)) value from ns n)
select jsonb_build_object(${["relations", "functions", "policies", "triggers", "constraints", "indexes", "schemas"].map((g) => `'${g}',(select coalesce(jsonb_object_agg(key,value),'{}') from ${g})`).join(",")}) snapshot`;

export function runtimeDiff(before: Snapshot, after: Snapshot) {
  const pre: Snapshot = {},
    post: Snapshot = {};
  for (const g of Object.keys(after)) {
    pre[g] = {};
    post[g] = {};
    for (const k of new Set([
      ...Object.keys(before[g]),
      ...Object.keys(after[g]),
    ]))
      if (JSON.stringify(before[g][k]) !== JSON.stringify(after[g][k])) {
        pre[g][k] = before[g][k] ?? null;
        post[g][k] = after[g][k] ?? null;
      }
  }
  return { pre, post };
}
const capture = `select snapshot into observed from (${runtimeCatalog}) x;`;
const compare = `mismatches:='[]'::jsonb;
for g in select jsonb_object_keys(expected) loop
 for k,v in select * from jsonb_each(expected->g) loop
  a:=coalesce(observed->g->k,'null'::jsonb);
  if a is distinct from v then mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group',g,'object',k));end if;
 end loop;
end loop;`;
const context = `current_user='supabase_admin' and coalesce((select rolsuper from pg_roles where rolname=current_user),false)
 and current_setting('server_version_num')::integer between 150000 and 189999
 and (select count(*)=3 from pg_roles where rolname in('anon','authenticated','service_role'))
 and (select count(*)=2 and bool_and(rolinherit and not rolsuper and not rolbypassrls) from pg_roles where rolname in('anon','authenticated'))
 and exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls and not rolsuper)
 and not exists(select 1 from pg_roles r cross join (values('anon'),('authenticated'),('service_role')) h(name) where r.rolname<>h.name and pg_has_role(h.name,r.oid,'MEMBER'))
 and not exists(select 1 from (values('anon'),('authenticated'),('service_role')) h(name) where not has_schema_privilege(h.name,'public','USAGE') or has_schema_privilege(h.name,'public','CREATE'))
 and to_regclass('auth.sessions') is not null
 and (select count(*)=5 from pg_attribute a where a.attrelid=to_regclass('auth.sessions') and not a.attisdropped and a.attnum>0
 and ((a.attname in('id','user_id') and a.atttypid='uuid'::regtype)
 or(a.attname in('created_at','not_after') and a.atttypid='timestamptz'::regtype)
 or(a.attname='refreshed_at' and a.atttypid in('timestamp'::regtype,'timestamptz'::regtype))))`;
const queue = `select jsonb_build_object('sending',count(*) filter(where status='sending'),'uncertain',count(*) filter(where status='uncertain'),'queued',count(*) filter(where status='queued'),
 'activeCampaigns',(select count(*) from public.campaigns where status='active'),
 'activeEnrollments',(select count(*) from public.campaign_enrollments where status='active'),
 'runningJobs',(select count(*) from public.jobs where status='running')) into queue_state from public.outbox;
queue_ok:=not exists(select 1 from jsonb_each_text(queue_state) e where e.key<>'queued' and e.value::bigint<>0);`;
const declarations = `observed jsonb;expected jsonb;g text;k text;v jsonb;a jsonb;mismatches jsonb;queue_state jsonb;queue_ok boolean;context_ok boolean;before_catalog jsonb;protected_before jsonb;protected_after jsonb;`;
const protect = (target: string) =>
  `select jsonb_object_agg(e.key,(select coalesce(jsonb_object_agg(x.key,x.value),'{}') from jsonb_each(e.value) x where not (d->'post'->e.key ? x.key))) into ${target} from jsonb_each(observed) e;`;
const dependency = `expected:=d->'dependencies';${compare} if jsonb_array_length(mismatches)>0 then raise exception 'MR_DEPENDENCIES_MISMATCH' using detail=(select jsonb_agg(value)::text from(select value from jsonb_array_elements(mismatches) limit 30) x);end if;`;
const inventory = `for g in select jsonb_object_keys(observed) loop
 for k in select jsonb_object_keys(observed->g) loop
  if (split_part(k,'.',1)=any(array[${runtimeSchemas.map(quote).join(",")}]) or (g='schemas' and k=any(array[${runtimeSchemas.map(quote).join(",")}]))) and not (d->'post'->g ? k)
  then mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group',g,'object',k,'field','unexpected_private_object'));end if;
 end loop;
end loop;`;
export function renderRuntimeRelease(contract: RuntimeContract, ddl: string) {
  const text = JSON.stringify(contract, null, 2) + "\n",
    digest = hash(text),
    binding = `d jsonb:=${quote(JSON.stringify(contract))}::jsonb;`;
  const pre = `-- MR-FINAL-r1 preflight; READ ONLY. Not execution authorization. Contract ${digest}
begin isolation level repeatable read read only;
set local statement_timeout='20s';set local lock_timeout='2s';set local search_path=pg_catalog,pg_temp;
do $mr_pre$ declare ${binding}${declarations} begin
 context_ok:=(${context}); if not context_ok then raise exception 'MR_CONTEXT_MISMATCH';end if;
 ${capture} ${dependency} expected:=d->'pre';${compare}
 for k in select unnest(array[${runtimeSchemas.map(quote).join(",")}]) loop if to_regnamespace(k) is not null then mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group','schemas','object',k));end if;end loop;
 ${queue}
 perform set_config('pipeline_os.mr_report',jsonb_build_object('protocol','MR-FINAL-r1','ordinal','050','contractSha256',${quote(digest)},'catalogOk',jsonb_array_length(mismatches)=0,'queueOk',queue_ok,'queue',queue_state,'mismatchCount',jsonb_array_length(mismatches),'mismatches',mismatches,'readyToApply',false,'limits',jsonb_build_array('snapshot_is_not_worker_pause','requires_PG15_rehearsal_and_cutover_review','unrelated_base_objects_not_certified'))::text,true);
end $mr_pre$;
select current_setting('pipeline_os.mr_report')::jsonb pipeline_os_mail_runtime_preflight;
commit;\n`;
  const migration = `-- MR-FINAL-r1 candidate050. Apply only after reviewed preflight, pause and PG15 rehearsal.
-- Contract SHA256 ${digest}; no configuration, routes or permissions are activated.
begin isolation level serializable;
set local statement_timeout='60s';set local lock_timeout='5s';set local search_path=pg_catalog,pg_temp;
do $mr_guard$ declare ${binding}${declarations} begin
 if not (${context}) then raise exception 'MR_CONTEXT_MISMATCH';end if;
 perform pg_advisory_xact_lock(5082026,50);
 -- Locks protect existing rows/catalog from concurrent application writers; they do not pause processes.
 lock table public.mail_accounts,public.mail_credentials,public.profiles,public.operating_brands,public.outbox,public.jobs,public.campaigns,public.campaign_enrollments,public.mail_provider_bindings,public.mail_provider_binding_heads,public.mail_account_brand_reviews in share row exclusive mode;
 if to_regclass('auth.sessions') is null then raise exception 'MR_AUTH_SESSIONS_REQUIRED';end if;
 ${capture} ${dependency} expected:=d->'pre';${compare}
 if jsonb_array_length(mismatches)>0 then raise exception 'MR_BASE_MISMATCH' using detail=(select jsonb_agg(value)::text from(select value from jsonb_array_elements(mismatches) limit 30) x);end if;
 for k in select unnest(array[${runtimeSchemas.map(quote).join(",")}]) loop if to_regnamespace(k) is not null then raise exception 'MR_ALREADY_OR_PARTIALLY_APPLIED';end if;end loop;
 ${queue} if not queue_ok then raise exception 'MR_QUEUE_NOT_QUIESCENT';end if;
 ${protect("protected_before")}
 perform set_config('pipeline_os.mr_protected_before',protected_before::text,true);
end $mr_guard$;
${ddl}
do $mr_final$ declare ${binding}${declarations} begin
 ${capture} expected:=d->'post';${compare}${inventory}
 if jsonb_array_length(mismatches)>0 then raise exception 'MR_FINAL_CONTRACT_MISMATCH' using detail=(select jsonb_agg(value)::text from(select value from jsonb_array_elements(mismatches) limit 30) x);end if;
 ${protect("protected_after")}
 if protected_after is distinct from current_setting('pipeline_os.mr_protected_before')::jsonb then raise exception 'MR_PRESERVATION_MISMATCH';end if;
 perform set_config('pipeline_os.mr_report',jsonb_build_object('protocol','MR-FINAL-r1','ordinal','050','stage','checked_before_commit','contractSha256',${quote(digest)},'targetsOk',true,'preservationMatches',true,'protectedFingerprint',md5(protected_after::text),'gmailProviderExpected','gmail_oauth','composioEnabledExpected',false)::text,true);
end $mr_final$;
select current_setting('pipeline_os.mr_report')::jsonb pipeline_os_mail_runtime_application;
commit;\n`;
  const post = `-- MR-FINAL-r1 postflight; independent READ ONLY transaction. Contract ${digest}
begin isolation level repeatable read read only;
set local statement_timeout='20s';set local lock_timeout='2s';set local search_path=pg_catalog,pg_temp;
do $mr_post$ declare ${binding}${declarations} begin
 if not (${context}) then raise exception 'MR_CONTEXT_MISMATCH';end if;
 ${capture} expected:=d->'post';${compare}${inventory}
 -- Existing objects outside the declared delta are not falsely certified by a new session.
 perform set_config('pipeline_os.mr_report',jsonb_build_object('protocol','MR-FINAL-r1','ordinal','050','contractSha256',${quote(digest)},'targetsOk',jsonb_array_length(mismatches)=0,'mismatchCount',jsonb_array_length(mismatches),'mismatches',mismatches,'gmailProviderExpected','gmail_oauth','composioEnabledExpected',false,'publicationReady',false)::text,true);
end $mr_post$;
select current_setting('pipeline_os.mr_report')::jsonb pipeline_os_mail_runtime_postflight;
commit;\n`;
  return { contract: text, preflight: pre, migration, postflight: post };
}
