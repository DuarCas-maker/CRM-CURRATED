-- Read-only gate. Re-capture and reconcile if any expected source differs.
begin isolation level repeatable read read only;
set local statement_timeout='8s';
select expected.signature,expected.source_md5,md5(p.prosrc) actual_source_md5,
 md5(p.prosrc)=expected.source_md5 source_matches
from (values
 ('public.campaign_import_contact_rows(uuid)','7536e85f57bb1ebd09dddead0974afaf'),
 ('public.campaign_import_status(uuid)','db488fdde79a5b7675ccb3ac177ee002'),
 ('public.can_lead(uuid)','2080ef29ec615060e4549bc73045b59b'),
 ('public.crm_command(text,jsonb,uuid)','019e048ca3c09c1aecee80ebe1ca1d23'),
 ('public.current_app_role()','f81c041915e2a0d97e6eaeb529c1d347')
) expected(signature,source_md5) left join pg_proc p on p.oid=to_regprocedure(expected.signature);
select to_regprocedure('public.campaign_import_review_page(uuid,text,text,int)') is null review_available,
 to_regprocedure('public.campaign_retry_import(uuid,uuid[],int,uuid)') is null retry_available;
rollback;
