-- Disposable fixture reversal only. Never run against an operational database.
begin;
do $guard$ begin
 if current_setting('pipeline_os.connect_t002_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^f2_connect_[a-f0-9]{12}$' or session_user<>'f2_connect_owner'
 or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'CONNECT_T002_LOCAL_ONLY';end if;
end $guard$;
drop function public.composio_connect_publish(jsonb);
drop function public.composio_connect_begin(jsonb,uuid);
drop function public.composio_connect_observe(uuid,bigint,text,jsonb);
drop function public.composio_connect_uncertain(uuid,bigint,text);
drop function public.composio_connect_command(uuid,text,bigint,text,uuid,uuid);
drop schema composio_connect cascade;
commit;
