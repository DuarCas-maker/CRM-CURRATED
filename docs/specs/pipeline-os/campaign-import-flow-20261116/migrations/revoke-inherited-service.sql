-- Completes this package's ACL contract on installations with inherited service grants.
-- The initial application was confirmed before this correction; no function body changes.
begin;
do $$
begin
 if (select count(*) from (values
  ('public.campaign_import_contact_rows(uuid)','7536e85f57bb1ebd09dddead0974afaf'),
  ('public.campaign_import_status(uuid)','db488fdde79a5b7675ccb3ac177ee002'),
  ('public.campaign_import_leads_page(uuid,uuid,uuid,text,integer)','f139068b066ec8208550176a7958313c'),
  ('public.campaign_verify_import(uuid,integer,uuid)','77d06f18f0c6aec886c020fbb82402c1'),
  ('public.campaign_create_from_import(jsonb,uuid)','710550a0cd856c99eb7694083a5a6afe')
 ) expected(signature,source_hash) join pg_proc p on p.oid=to_regprocedure(expected.signature)
 where md5(replace(p.prosrc,chr(13),''))=expected.source_hash
 and pg_get_userbyid(p.proowner)='supabase_admin')<>5 then
  raise exception 'CI_PRIVILEGE_SOURCE_DRIFT';
 end if;
end $$;
revoke all on function public.campaign_import_contact_rows(uuid) from service_role;
revoke all on function public.campaign_import_status(uuid) from service_role;
revoke all on function public.campaign_import_leads_page(uuid,uuid,uuid,text,int) from service_role;
revoke all on function public.campaign_verify_import(uuid,int,uuid) from service_role;
revoke all on function public.campaign_create_from_import(jsonb,uuid) from service_role;
notify pgrst,'reload schema';
commit;
