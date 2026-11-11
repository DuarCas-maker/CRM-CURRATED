begin isolation level serializable;
set local search_path=pg_catalog,pg_temp;set local lock_timeout='5s';set local statement_timeout='90s';
do $qgr$ begin if not(current_user='supabase_admin' and (select rolsuper from pg_roles where rolname=current_user)
 and current_setting('server_version_num')::int between 150000 and 159999
 and (select count(*)=2 and bool_and(rolinherit and not rolsuper and not rolbypassrls) from pg_roles where rolname in('anon','authenticated'))
 and exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls and not rolsuper)
 and not exists(select 1 from pg_roles r cross join (values('anon'),('authenticated'),('service_role')) h(name) where r.rolname<>h.name and pg_has_role(h.name,r.oid,'MEMBER'))
 and not exists(select 1 from (values('anon'),('authenticated'),('service_role')) h(name) where not has_schema_privilege(h.name,'public','USAGE') or has_schema_privilege(h.name,'public','CREATE'))
 and (select count(*)=5 from pg_attribute where attrelid=to_regclass('auth.sessions') and attnum>0 and not attisdropped and
 ((attname in('id','user_id') and atttypid='uuid'::regtype) or(attname in('created_at','not_after') and atttypid='timestamptz'::regtype) or(attname='refreshed_at' and atttypid in('timestamp'::regtype,'timestamptz'::regtype))))) then raise exception 'QGR_CONTEXT_MISMATCH';end if;
 lock table public.mail_accounts,public.mail_credentials,public.mail_permissions,public.mail_provider_bindings,public.mail_provider_binding_heads,public.mail_provider_binding_checks,public.mail_account_brand_reviews,public.operating_brands,public.profiles,public.outbox,public.jobs,public.campaigns,public.campaign_enrollments,public.mail_brand_dispatch_admissions,public.gmail_api_slots,public.gmail_api_usage,public.command_receipts,public.audit_log,mail_runtime.routes,mail_runtime.attempts,mail_runtime.sync_checkpoints,mail_runtime.sync_cycles,mail_quota.head in share row exclusive mode;
 if not(exists(select 1 from mail_quota.head where id=1 and policy_id is null and generation is null and not closed)
 and not exists(select 1 from mail_quota.policies) and not exists(select 1 from mail_quota.reservations)
 and not exists(select 1 from mail_quota.usage) and not exists(select 1 from mail_quota.binding_checks)
 and not exists(select 1 from mail_quota.binding_budgets) and not exists(select 1 from mail_quota.binding_contexts)
 and not exists(select 1 from public.mail_provider_bindings where quota_contract_version<>1)) then raise exception 'QGR_ROLLBACK_SCOPE_ALREADY_USED';end if;end $qgr$;
revoke all on function public.mail_quota_snapshot() from public,anon,authenticated,service_role;
revoke all on function public.mail_quota_admit(uuid) from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_authorize_v2(uuid) from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_page_v2(uuid, text, integer) from public,anon,authenticated,service_role;
revoke all on function public.mail_quota_publish(jsonb, bigint, boolean, uuid) from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_check_snapshot_v2(uuid, text, text) from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_command_v2(uuid, text, jsonb, uuid) from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_check_context_v2(uuid, text, text, text) from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_check_admit_v2(uuid, text, text, integer) from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_check_finish_v2(uuid, text, text, jsonb, jsonb) from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_check_begin_v2(uuid, uuid, jsonb, text, text, uuid) from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_budget_v2(uuid, text, integer, timestamp with time zone, uuid, boolean) from public,anon,authenticated,service_role;
revoke all on function public.mail_quota_reserve(uuid, text, integer, uuid, bigint, uuid, timestamp with time zone, text) from public,anon,authenticated,service_role;
select jsonb_build_object('protocol','QGR-FINAL-r1','ordinal','052','newRpcRevoked',true,'dataDeleted',false,'countersReset',false) pipeline_os_quota_rollback;
commit;
