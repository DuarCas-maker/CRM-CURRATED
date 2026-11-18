begin read only;
set local statement_timeout='8s';
set local lock_timeout='1s';
set local search_path=pg_catalog,public,pg_temp;
select jsonb_build_object('database',current_database(),'role',current_user,'read_only',current_setting('transaction_read_only'),
 'brands',(select jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'active',active,'revision',revision) order by code) from public.operating_brands),
 'roles',(select jsonb_agg(x) from(select role,active,count(*) count from public.profiles group by role,active order by role,active)x),
 'organizations',(select jsonb_agg(x) from(select organization,status,count(*) count from public.mail_accounts group by organization,status order by organization,status)x),
 'quota_head',(select jsonb_agg(jsonb_build_object('policy_id',h.policy_id,'generation',h.generation,'closed',h.closed,'policy_state',p.policy->>'state','mode',p.policy->>'mode','limits',p.policy->'limits','google_project',p.policy->'google_project')) from mail_quota.head h left join mail_quota.policies p on p.policy_id=h.policy_id and p.generation=h.generation),
 'connect_configuration',(select jsonb_agg(jsonb_build_object('generation',generation,'project_id',project_id,'auth_config_id',auth_config_id,'quota_project_id',quota_project_id,'policy_reviewed',policy_reviewed,'max_age_seconds',max_age_seconds,'inactivity_seconds',inactivity_seconds)) from composio_connect.configuration),
 'binding_contexts',(select jsonb_agg(jsonb_build_object('auth_config_id',auth_config_id,'generation',generation,'digest',digest,'project',context->>'composio_project_id','policy_id',context#>>'{policy,policy_id}','policy_generation',context#>>'{policy,generation}')) from mail_quota.binding_contexts),
 'binding_heads',(select jsonb_agg(x) from(select b.status,b.quota_contract_version,b.composio_project_id,b.auth_config_id,count(*) count from public.mail_provider_binding_heads h join public.mail_provider_bindings b on b.id=h.current_binding_id group by b.status,b.quota_contract_version,b.composio_project_id,b.auth_config_id order by b.status)x)
) as selected_metadata;
rollback;
