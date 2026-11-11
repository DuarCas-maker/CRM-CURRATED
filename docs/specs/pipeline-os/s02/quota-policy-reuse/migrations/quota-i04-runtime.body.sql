-- Included by add-i04-runtime.mjs inside the local-only transaction.
do $$begin
 if current_setting('pipeline_os.qgr_i04_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^qgr_i02_i04_[a-z0-9_]+$' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'QGR_I04_LOCAL_ONLY';end if;
end$$;
create function mail_quota.binding_confirmed(b public.mail_provider_bindings,ctx jsonb) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from mail_quota.binding_checks c join mail_quota.binding_contexts cfg on cfg.account_id=c.account_id
 join public.mail_provider_binding_heads h on h.account_id=c.account_id
 join public.profiles p on p.id=c.actor_id
 join mail_quota.head q on q.id=1 join mail_quota.policies policy on policy.policy_id=q.policy_id and policy.generation=q.generation
 where b.quota_contract_version=2 and b.status='verified' and h.current_binding_id=b.id and h.revision=b.revision
 and c.binding_id=b.id and c.status='completed' and c.confirmed_at is not null and c.binding_revision+1=b.revision
 and c.actor_revision=p.mail_authorization_revision and p.active and p.role='superadmin'
 and c.account_context=ctx and b.account_context=ctx and (ctx->>'ready')::boolean and b.expected_mailbox_email=ctx->>'email'
 and c.context_digest=cfg.digest and c.config_generation=cfg.generation and cfg.auth_config_id=b.auth_config_id
 and cfg.context->>'composio_project_id'=b.composio_project_id
 and b.quota_policy_id=q.policy_id and b.quota_policy_generation=q.generation and not q.closed and policy.policy->>'state'='enabled'
 and cfg.context->'policy'=policy.policy)
$$;
