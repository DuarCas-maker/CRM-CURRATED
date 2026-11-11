-- Read-only, isolated PG15 fixture catalog. Not an authorization for remote SQL.
begin transaction isolation level repeatable read read only;
set local search_path=pg_catalog,pg_temp;
do $$begin
 if current_setting('pipeline_os.qgr_i04_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^qgr_i02_i04_[a-z0-9_]+$' or inet_server_addr() is distinct from '127.0.0.1'::inet
 or current_setting('server_version_num')::int not between 150000 and 159999 then raise exception 'QGR_I04_LOCAL_ONLY';end if;
end$$;
with funcs(signature,allowed) as (values
 ('public.composio_binding_authorize_v2(uuid)','authenticated'),
 ('public.composio_binding_page_v2(uuid,text,integer)','authenticated'),
 ('public.composio_binding_command_v2(uuid,text,jsonb,uuid)','authenticated'),
 ('public.composio_binding_check_begin_v2(uuid,uuid,jsonb,text,text,uuid)','authenticated'),
 ('public.composio_binding_budget_v2(uuid,text,integer,timestamp with time zone,uuid,boolean)','authenticated'),
 ('public.composio_binding_check_context_v2(uuid,text,text,text)','service_role'),
 ('public.composio_binding_check_snapshot_v2(uuid,text,text)','service_role'),
 ('public.composio_binding_check_admit_v2(uuid,text,text,integer)','service_role'),
 ('public.composio_binding_check_finish_v2(uuid,text,text,jsonb,jsonb)','service_role')),
 f as (select signature,p.oid is not null and p.prosecdef and p.proconfig=array['search_path=""']::text[]
 and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
 and not has_function_privilege('anon',p.oid,'EXECUTE')
 and has_function_privilege(allowed,p.oid,'EXECUTE')
 and not has_function_privilege(case allowed when 'authenticated' then 'service_role' else 'authenticated' end,p.oid,'EXECUTE') ok
 from funcs left join pg_proc p on p.oid=to_regprocedure(signature)),
 tables(name) as(values('binding_contexts'),('binding_checks'),('binding_budgets')),
 r as(select name,c.oid is not null and c.relrowsecurity and not exists(
 select 1 from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) priv
 where has_table_privilege(role,c.oid,priv)) ok from tables left join pg_class c on c.oid=to_regclass('mail_quota.'||name))
select jsonb_build_object('pipeline_os_quota_i04_postflight',jsonb_build_object('protocol','QGR-I04-LOCAL-r1','readOnly',current_setting('transaction_read_only'),
 'targetsOk',(select bool_and(coalesce(ok,false)) from f) and (select bool_and(coalesce(ok,false)) from r),
 'functions',(select jsonb_agg(jsonb_build_object('signature',signature,'ok',ok) order by signature) from f),
 'tables',(select jsonb_agg(jsonb_build_object('name',name,'ok',ok) order by name) from r)));
commit;
