-- ABC-R1: catalog and aggregate-only diagnostic. NOT A MIGRATION.
-- Proposed for a later authorized operator run; no app RPC or provider call.
-- No emails, identifiers of cases/accounts, messages, credentials or file paths returned.
begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
with wanted_roles(name) as (values ('anon'),('authenticated'),('service_role')),
roles as (select w.name,r.oid from wanted_roles w left join pg_roles r on r.rolname=w.name),
objects as (
 select c.*,n.nspname schema_name
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where (n.nspname='public' and c.relkind in ('r','p','v','m'))
    or (n.nspname='storage' and c.relname in ('buckets','objects'))
),
tables as (
 select schema_name||'.'||relname object_key,
 jsonb_build_object('kind',relkind,'owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'force_rls',relforcerowsecurity,
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default_md5',md5(pg_get_expr(d.adbin,d.adrelid))) order by a.attnum),'[]') from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=objects.oid and a.attnum>0 and not a.attisdropped),
 'access',(select jsonb_object_agg(r.name,case when r.oid is not null then jsonb_build_object('select',has_table_privilege(r.oid,objects.oid,'select'),'insert',has_table_privilege(r.oid,objects.oid,'insert'),'update',has_table_privilege(r.oid,objects.oid,'update'),'delete',has_table_privilege(r.oid,objects.oid,'delete'),'truncate',has_table_privilege(r.oid,objects.oid,'truncate'),'references',has_table_privilege(r.oid,objects.oid,'references'),'trigger',has_table_privilege(r.oid,objects.oid,'trigger')) end) from roles r),
 'column_access_md5',(select md5(coalesce(jsonb_agg(jsonb_build_array(a.attname,r.name,case when r.oid is not null then jsonb_build_array(has_column_privilege(r.oid,objects.oid,a.attname,'select'),has_column_privilege(r.oid,objects.oid,a.attname,'insert'),has_column_privilege(r.oid,objects.oid,a.attname,'update'),has_column_privilege(r.oid,objects.oid,a.attname,'references')) end) order by a.attnum,r.name),'[]')::text) from pg_attribute a cross join roles r where a.attrelid=objects.oid and a.attnum>0 and not a.attisdropped),
 'view_md5',case when relkind in ('v','m') then md5(pg_get_viewdef(objects.oid,true)) end,
 'view_security',(select coalesce(jsonb_agg(v order by v),'[]') from unnest(reloptions) v where v like 'security_invoker=%' or v like 'security_barrier=%')) value
 from objects
),
functions as (
 select format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)) object_key,
 jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
 'search_path',(select split_part(v,'=',2) from unnest(p.proconfig) v where v like 'search_path=%' limit 1),
 'definition_md5',md5(pg_get_functiondef(p.oid)),
 'public_execute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),
 'execute',(select jsonb_object_agg(r.name,case when r.oid is not null then has_function_privilege(r.oid,p.oid,'execute') end) from roles r)) value
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','s01_i02','brand_b1','brand_b2','composio_c1') and p.prokind in ('f','p')
),
constraints as (
 select o.schema_name||'.'||o.relname||'.'||x.conname object_key,
 jsonb_build_object('kind',x.contype,'validated',x.convalidated,'definition_md5',md5(pg_get_constraintdef(x.oid))) value
 from pg_constraint x join objects o on o.oid=x.conrelid
),
policies as (
 select o.schema_name||'.'||o.relname||'.'||p.polname object_key,
 jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
 'roles',(select jsonb_agg(case when id=0 then 'PUBLIC' else pg_get_userbyid(id) end order by case when id=0 then 'PUBLIC' else pg_get_userbyid(id) end) from unnest(p.polroles) id),
 'using_md5',md5(pg_get_expr(p.polqual,p.polrelid)),'check_md5',md5(pg_get_expr(p.polwithcheck,p.polrelid))) value
 from pg_policy p join objects o on o.oid=p.polrelid
),
triggers as (
 select o.schema_name||'.'||o.relname||'.'||t.tgname object_key,
 jsonb_build_object('enabled',t.tgenabled,'definition_md5',md5(pg_get_triggerdef(t.oid))) value
 from pg_trigger t join objects o on o.oid=t.tgrelid where not t.tgisinternal
),
indexes as (
 select i.schemaname||'.'||i.indexname object_key,jsonb_build_object('table',i.tablename,'definition_md5',md5(i.indexdef)) value
 from pg_indexes i join objects o on o.schema_name=i.schemaname and o.relname=i.tablename
),
schemas as (
 select w.name object_key,jsonb_build_object('present',n.oid is not null,'owner',pg_get_userbyid(n.nspowner),
 'usage',(select jsonb_object_agg(r.name,case when r.oid is not null and n.oid is not null then has_schema_privilege(r.oid,n.oid,'usage') end) from roles r)) value
 from (values ('public'),('storage'),('s01_i02'),('brand_b1'),('brand_b2'),('composio_c1')) w(name)
 left join pg_namespace n on n.nspname=w.name
)
select jsonb_build_object(
 'inventory_kind','abc_catalog_only_not_migration_history',
 'context',jsonb_build_object('sql_role',current_user,'read_only',current_setting('transaction_read_only'),'server_version',current_setting('server_version_num'),
 'profile_owner',pg_get_userbyid((select relowner from pg_class where oid=to_regclass('public.profiles'))),
 'sql_role_select_profiles',has_table_privilege(current_user,'public.profiles','select'),
 'sql_role_bypassrls',(select rolbypassrls from pg_roles where rolname=current_user),
 'sql_role_superuser',(select rolsuper from pg_roles where rolname=current_user),
 'migration_history_present',to_regclass('supabase_migrations.schema_migrations') is not null),
 'roles',(select jsonb_object_agg(name,oid is not null) from roles),
 'schemas',(select jsonb_object_agg(object_key,value order by object_key) from schemas),
 'tables',(select coalesce(jsonb_object_agg(object_key,value order by object_key),'{}') from tables),
 'functions',(select coalesce(jsonb_object_agg(object_key,value order by object_key),'{}') from functions),
 'constraints',(select coalesce(jsonb_object_agg(object_key,value order by object_key),'{}') from constraints),
 'policies',(select coalesce(jsonb_object_agg(object_key,value order by object_key),'{}') from policies),
 'triggers',(select coalesce(jsonb_object_agg(object_key,value order by object_key),'{}') from triggers),
 'indexes',(select coalesce(jsonb_object_agg(object_key,value order by object_key),'{}') from indexes),
 'legacy_aggregates',jsonb_build_object(
  'accounts',(select jsonb_build_object('total',count(*),'connected',count(*) filter(where status='connected'),'without_brand_assignment',count(*) filter(where to_jsonb(a)->>'operating_brand_id' is null)) from public.mail_accounts a),
  'outbox',(select coalesce(jsonb_object_agg(status,n),'{}') from(select status,count(*) n from public.outbox group by status)x),
  'queued_without_brand_snapshot',(select count(*) from public.outbox o where status='queued' and (to_jsonb(o)->'brand_snapshot' is null or to_jsonb(o)->'brand_snapshot'='null'::jsonb)),
  'messages_without_confirmed_brand_provenance',(select count(*) from public.messages m where coalesce(to_jsonb(m)->>'brand_provenance','unconfirmed')='unconfirmed')
 )) as pipeline_os_abc_catalog;
rollback;
