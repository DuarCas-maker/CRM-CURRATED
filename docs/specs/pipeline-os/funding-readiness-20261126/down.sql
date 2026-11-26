begin;
set local lock_timeout='5s';
drop function public.campaign_template_readiness(uuid,integer,uuid[],uuid,jsonb);
drop function public.campaign_income_pool(text,integer,integer,text);
drop function public.campaign_income_leads(text,text,integer,integer,text);
notify pgrst,'reload schema';
commit;
