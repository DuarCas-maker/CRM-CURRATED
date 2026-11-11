-- LOCAL ONLY. Default closes and retains data. remove_empty is an explicit empty-only reversal.
begin;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout='5s';
do $$begin
 if current_setting('pipeline_os.qgr_local',true) is distinct from 'isolated_test'
 or current_setting('server_version_num')::integer not between 150000 and 159999
 or current_database() !~ '^qgr_i02_[a-z0-9_]+$'
 or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'QGR_LOCAL_ONLY';end if;
 perform pg_advisory_xact_lock(19681110,2);
 if coalesce(nullif(current_setting('pipeline_os.qgr_rollback_mode',true),''),'close')='close' then
  update mail_quota.head set closed=true where id=1;
 elsif current_setting('pipeline_os.qgr_rollback_mode',true)='remove_empty' then
  if exists(select 1 from mail_quota.policies) or exists(select 1 from mail_quota.publications)
   or exists(select 1 from mail_quota.reservations) or exists(select 1 from mail_quota.usage)
   or exists(select 1 from mail_quota.slot) or exists(select 1 from mail_quota.legacy_observed)
   or exists(select 1 from public.mail_provider_bindings where quota_contract_version<>1)
  then raise exception 'QGR_HISTORY_RETAINED';end if;
 else raise exception 'QGR_ROLLBACK_MODE_INVALID';end if;
end$$;
do $$begin
 if current_setting('pipeline_os.qgr_rollback_mode',true)='remove_empty' then
  drop function public.mail_quota_publish(jsonb,bigint,boolean,uuid);
  drop function public.mail_quota_reserve(uuid,text,integer,uuid,bigint,uuid,timestamptz,text);
  drop trigger quota_binding_immutable on public.mail_provider_bindings;
  alter table public.mail_provider_bindings drop constraint binding_quota_policy_fk,drop constraint binding_quota_contract_check;
  alter table public.mail_provider_bindings drop column quota_contract_version,drop column quota_policy_id,drop column quota_policy_generation;
  alter table public.mail_provider_bindings alter column google_quota_project_id set not null;
  drop function mail_quota.binding_guard();
  drop function mail_quota.human();
  drop function mail_quota.capture_legacy(timestamptz);
  drop table mail_quota.reservations,mail_quota.publications,mail_quota.legacy_observed,mail_quota.slot,mail_quota.usage,mail_quota.head,mail_quota.policies;
  drop function mail_quota.policy(jsonb);
  drop schema mail_quota;
 end if;
end$$;
commit;
