-- Generator fragment; the fixture marker is required even when run separately.
do $$begin
 if current_setting('pipeline_os.qgr_i04_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^qgr_i02_i04_[a-z0-9_]+$' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'QGR_I04_LOCAL_ONLY';end if;
end$$;
create or replace function composio_c1.approval_current(b public.mail_provider_bindings,ctx jsonb) returns boolean language sql stable set search_path='' as $$
 select case when b.quota_contract_version=2 then mail_quota.binding_confirmed(b,ctx) else mail_runtime.approval_current_v1(b,ctx) end
$$;
create or replace function mail_runtime.binding_approved(b public.mail_provider_bindings,ctx jsonb) returns boolean language sql stable set search_path='' as $$
 select case when b.quota_contract_version=2 then mail_quota.binding_confirmed(b,ctx) and exists(
 select 1 from mail_runtime.routes r join mail_quota.binding_checks c on c.id=(r.approval->>'check_id')::uuid
 join mail_quota.binding_contexts cfg on cfg.account_id=r.account_id
 where r.account_id=b.account_id and r.provider='composio' and r.binding_id=b.id and r.approval->'contract_version'='2'::jsonb
 and (r.approval->>'head_revision')::bigint=b.revision and (r.approval->>'binding_revision')::bigint=b.revision
 and (r.approval->>'post_epoch')::bigint=r.account_epoch and r.approval->'post_context'=ctx
 and r.approval->>'verification_context_hash'=cfg.digest and (r.approval->>'config_generation')::bigint=cfg.generation
 and c.binding_id=b.id and c.actor_id=(r.approval->>'actor_id')::uuid and c.actor_revision=(r.approval->>'actor_revision')::bigint
 and c.confirmed_at is not null and c.status='completed') else mail_runtime.binding_approved_v1(b,ctx) end
$$;
create or replace function mail_runtime.ticket(t mail_runtime.attempts) returns jsonb language sql stable set search_path='' as $$
 select case when b.quota_contract_version=2 then jsonb_set(mail_runtime.ticket_v1(t),'{binding}',
 (mail_runtime.ticket_v1(t)->'binding')||jsonb_build_object('quotaContractVersion',2,'quotaProjectId',null,'quotaPolicyId',b.quota_policy_id,'quotaPolicyGeneration',b.quota_policy_generation))
 else mail_runtime.ticket_v1(t) end from (select 1) dummy left join mail_runtime.routes r on r.account_id=t.account_id left join public.mail_provider_bindings b on b.id=r.binding_id
$$;
create or replace function public.mail_transport_snapshot(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r mail_runtime.routes;b public.mail_provider_bindings;cfg mail_quota.binding_contexts;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'R06_FORBIDDEN';end if;
 ctx:=mail_runtime.context(account);select * into r from mail_runtime.routes where account_id=account for update;
 select * into b from public.mail_provider_bindings where id=r.binding_id;
 if b.quota_contract_version is distinct from 2 then return mail_runtime.snapshot_v1(account);end if;
 if not mail_runtime.route_current(r,ctx) then raise exception 'R06_NOT_READY';end if;
 cfg:=mail_quota.binding_config(account);
 return jsonb_build_object('account_id',account,'provider',r.provider,'revision',r.revision,'verification_context_hash',cfg.digest,'config_generation',cfg.generation,
 'project_id',b.composio_project_id,'auth_config_id',b.auth_config_id,'quota_project_id',null,'quota_contract_version',2,'quota_policy_id',b.quota_policy_id,'quota_policy_generation',b.quota_policy_generation);
end$$;
create or replace function public.mail_transport_validate_context(attempt uuid,capability text,context_digest text,config_generation bigint,admit boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare t mail_runtime.attempts;b public.mail_provider_bindings;cfg mail_quota.binding_contexts;
begin
 t:=mail_runtime.lock_attempt(attempt,capability);
 select x.* into b from public.mail_provider_bindings x join mail_runtime.routes r on r.binding_id=x.id where r.account_id=t.account_id;
 if t.provider<>'composio' or b.quota_contract_version is distinct from 2 then return mail_runtime.validate_context_v1(attempt,capability,context_digest,config_generation,admit);end if;
 cfg:=mail_quota.binding_config(t.account_id);
 if cfg.digest is distinct from context_digest or cfg.generation is distinct from config_generation then return false;end if;
 return public.mail_transport_validate(attempt,capability,admit);
end$$;
create or replace function public.mail_transport_review(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;g bigint;
begin
 if exists(select 1 from public.mail_provider_binding_heads h join public.mail_provider_bindings b on b.id=h.current_binding_id where h.account_id=account and b.quota_contract_version=2) then
  v:=mail_runtime.review_v2(account);
  select generation into g from mail_quota.binding_contexts where account_id=account;
  v:=jsonb_set(v,'{expected,expected_config_generation}',to_jsonb(coalesce(g,0)));
 else v:=mail_runtime.review_v1(account);end if;return v;
end$$;
create or replace function public.mail_transport_page(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r mail_runtime.routes;
begin
 if exists(select 1 from public.mail_provider_binding_heads h join public.mail_provider_bindings b on b.id=h.current_binding_id where h.account_id=account and b.quota_contract_version=2) then perform mail_quota.human();else perform composio_connect.human();end if;
 perform mail_runtime.context(account);select * into r from mail_runtime.routes where account_id=account;
 if r.account_id is null then return null;end if;return mail_runtime.page(r);
end$$;
