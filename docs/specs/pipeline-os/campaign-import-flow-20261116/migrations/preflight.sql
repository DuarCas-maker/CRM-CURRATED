-- Proposed, metadata only. Do not run against production without release approval.
begin transaction read only;
set local statement_timeout='15s';
set local lock_timeout='3s';
select current_setting('server_version') as postgres_version;

with required(signature) as (values
 ('public.current_app_role()'),('public.can_lead(uuid)'),
 ('public.crm_command(text,jsonb,uuid)'),
 ('public.first_contact_candidates(text,text,uuid,uuid)'),
 ('public.brand_prepare_context(uuid,jsonb,text,uuid)'))
select r.signature,p.oid is not null as present,
 pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer,
 p.proconfig,md5(pg_get_functiondef(p.oid)) as definition_hash
from required r left join pg_proc p on p.oid=to_regprocedure(r.signature)
order by r.signature;

-- These names must be absent before first application; do not overwrite a collision.
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 md5(pg_get_functiondef(p.oid)) as definition_hash
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('campaign_import_contact_rows','campaign_import_status','campaign_import_leads_page',
  'campaign_verify_import','campaign_create_from_import') order by p.proname;

select c.relname,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
 jsonb_agg(jsonb_build_object('column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) order by a.attnum) as columns
from pg_class c join pg_namespace n on n.oid=c.relnamespace
join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
where n.nspname='public' and c.relname in
 ('import_batches','import_rows','contacts','leads','verifications','suppressions',
  'command_receipts','email_templates','campaigns')
group by c.relname,c.relrowsecurity,c.relforcerowsecurity order by c.relname;

select t.tgname,t.tgenabled,md5(pg_get_triggerdef(t.oid)) as trigger_hash,
 p.oid::regprocedure::text as handler,md5(pg_get_functiondef(p.oid)) as handler_hash
from pg_trigger t join pg_proc p on p.oid=t.tgfoid
where t.tgrelid=to_regclass('public.campaigns') and not t.tgisinternal
order by t.tgname;
rollback;
