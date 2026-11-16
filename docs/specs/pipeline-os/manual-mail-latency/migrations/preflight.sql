-- Proposed READ ONLY preflight. Run as the existing owner in the verified CRM database.
begin read only;
select jsonb_build_object(
 'protocol','MANUAL_MAIL_PREFLIGHT_V1',
 'version',current_setting('server_version_num'),
 'operator',current_user,
 'claim_owner',(select pg_get_userbyid(proowner) from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure),
 'claim_source_hash',(select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure),
 'fast_already_installed',to_regprocedure('public.claim_manual_outbox(uuid)') is not null,
 'sending',(select count(*) from public.outbox where status='sending'),
 'uncertain',(select count(*) from public.outbox where status='uncertain'),
 'manual_queued',(select count(*) from public.outbox where status='queued' and notification_id is null and enrollment_id is null and not campaign_test and requested_by is not null)
);
rollback;
