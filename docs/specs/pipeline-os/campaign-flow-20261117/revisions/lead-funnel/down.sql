begin;
drop function public.campaign_flow_leads(text,text,integer,integer);
drop function campaign_flow_v1.lead_states();
notify pgrst,'reload schema';
commit;
