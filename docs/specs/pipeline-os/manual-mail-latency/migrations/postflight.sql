-- READ ONLY: inspect objects and grants; never claims or sends a message.
begin read only;
select jsonb_build_object(
 'protocol','MANUAL_MAIL_POSTFLIGHT_V1',
 'exact_claim_installed',to_regprocedure('public.claim_manual_outbox(uuid)') is not null,
 'ready_accounts_installed',to_regprocedure('public.manual_mail_ready_accounts()') is not null,
 'service_can_claim',has_function_privilege('service_role','public.claim_manual_outbox(uuid)','EXECUTE'),
 'anon_can_claim',has_function_privilege('anon','public.claim_manual_outbox(uuid)','EXECUTE'),
 'authenticated_can_claim',has_function_privilege('authenticated','public.claim_manual_outbox(uuid)','EXECUTE'),
 'service_can_discover',has_function_privilege('service_role','public.manual_mail_ready_accounts()','EXECUTE'),
 'anon_can_discover',has_function_privilege('anon','public.manual_mail_ready_accounts()','EXECUTE'),
 'authenticated_can_discover',has_function_privilege('authenticated','public.manual_mail_ready_accounts()','EXECUTE'),
 'owners_match',(select bool_and(p.proowner=(select proowner from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure)) from pg_proc p where p.oid in ('public.claim_manual_outbox(uuid)'::regprocedure,'public.manual_mail_ready_accounts()'::regprocedure,'brand_b2.claim_scoped(boolean,uuid)'::regprocedure)),
 'definers_have_empty_path',(select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.oid in ('public.claim_manual_outbox(uuid)'::regprocedure,'public.manual_mail_ready_accounts()'::regprocedure,'brand_b2.claim_scoped(boolean,uuid)'::regprocedure))
);
rollback;
