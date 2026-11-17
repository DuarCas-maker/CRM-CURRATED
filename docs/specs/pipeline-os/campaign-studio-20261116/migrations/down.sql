begin;
drop function public.campaign_retry_import(uuid,uuid[],int,uuid);
drop function public.campaign_import_review_page(uuid,text,text,int);
notify pgrst,'reload schema';
commit;
