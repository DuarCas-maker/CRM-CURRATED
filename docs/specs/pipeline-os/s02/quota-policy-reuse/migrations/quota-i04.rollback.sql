-- Local fail-closed rollback, preserving evidence and all usage counters.
-- Requires prior explicit drained return to direct. Not a production migration.
begin;
set local search_path=pg_catalog,pg_temp;
do $$begin
 if current_setting('pipeline_os.qgr_i04_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^qgr_i02_i04_[a-z0-9_]+$' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'QGR_I04_LOCAL_ONLY';end if;
 if exists(select 1 from mail_runtime.routes where provider<>'gmail_oauth' or state='draining')
 or exists(select 1 from mail_runtime.attempts where state in('reserved','admitted','uncertain'))
 or exists(select 1 from mail_runtime.sync_cycles where state in('active','uncertain')) then raise exception 'QGR_I04_UNRESOLVED';end if;
end$$;
update mail_quota.head set closed=true where id=1;
revoke all on function public.composio_binding_authorize_v2(uuid),public.composio_binding_page_v2(uuid,text,integer),public.composio_binding_command_v2(uuid,text,jsonb,uuid),public.composio_binding_check_begin_v2(uuid,uuid,jsonb,text,text,uuid),public.composio_binding_budget_v2(uuid,text,integer,timestamptz,uuid,boolean) from authenticated;
revoke all on function public.composio_binding_check_context_v2(uuid,text,text,text),public.composio_binding_check_snapshot_v2(uuid,text,text),public.composio_binding_check_admit_v2(uuid,text,text,integer),public.composio_binding_check_finish_v2(uuid,text,text,jsonb,jsonb) from service_role;
commit;
