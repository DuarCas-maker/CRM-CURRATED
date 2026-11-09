begin;
do $guard$ begin
 if current_setting('pipeline_os.connect_t009_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^f2_connect_[a-f0-9]{12}$' or session_user<>'f2_connect_owner' or inet_server_addr() is distinct from '127.0.0.1'::inet
 then raise exception 'CONNECT_T009_LOCAL_ONLY';end if;
 if exists(select 1 from composio_connect_runtime.runtime where state not in('completed','cancelled','expired','rejected')) then raise exception 'CONNECT_T009_OPEN_ATTEMPTS';end if;
 if exists(select 1 from pg_proc f join pg_namespace n on n.oid=f.pronamespace where n.nspname='public' and f.proname in('composio_connect_publish','composio_connect_begin','composio_connect_observe','composio_connect_uncertain','composio_connect_command')
 and (f.proowner<>(select oid from pg_roles where rolname=current_user) or has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE')))
 then raise exception 'CONNECT_T009_CATALOG_DRIFT';end if;
end $guard$;
drop trigger connect_runtime_base_check on composio_connect.attempts;
drop trigger connect_runtime_phase_check on composio_connect_runtime.runtime;
drop function public.composio_connect_runtime_publish(jsonb);
drop function public.composio_connect_runtime_authorize(text,jsonb);
drop function public.composio_connect_runtime_execute(text,jsonb,jsonb);
drop function public.composio_connect_runtime_ledger(text,jsonb);
drop function public.composio_connect_runtime_register(text,jsonb,jsonb);
drop function composio_connect_runtime.consistent();
drop function composio_connect_runtime.begin_intent(jsonb,composio_connect_runtime.tickets);
drop function composio_connect_runtime.remember(composio_connect.attempts,jsonb);
drop function composio_connect_runtime.materialize(uuid);
drop function composio_connect_runtime.view(uuid);
drop function composio_connect_runtime.live_context(uuid,boolean);
drop function composio_connect_runtime.session_limit(uuid,text);
alter table composio_connect_runtime.runtime drop constraint runtime_phase_fk;
drop table composio_connect_runtime.receipts,composio_connect_runtime.tickets,composio_connect_runtime.phases,composio_connect_runtime.runtime,composio_connect_runtime.contexts;
drop schema composio_connect_runtime;
grant execute on function public.composio_connect_publish(jsonb),public.composio_connect_observe(uuid,bigint,text,jsonb),public.composio_connect_uncertain(uuid,bigint,text) to service_role;
grant execute on function public.composio_connect_begin(jsonb,uuid),public.composio_connect_command(uuid,text,bigint,text,uuid,uuid) to authenticated;
commit;
