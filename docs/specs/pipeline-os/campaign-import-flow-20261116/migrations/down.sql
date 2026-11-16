begin;
drop function if exists public.campaign_create_from_import(jsonb,uuid);
drop function if exists public.campaign_verify_import(uuid,int,uuid);
drop function if exists public.campaign_import_leads_page(uuid,uuid,uuid,text,int);
drop function if exists public.campaign_import_status(uuid);
drop function if exists public.campaign_import_contact_rows(uuid);
notify pgrst,'reload schema';
commit;
