begin;
do $$begin
 if exists(select 1 from public.campaign_group_members group by group_id having count(*)>1) then raise exception 'CC_KEEP_GROUP_LIMIT';end if;
end $$;
drop trigger campaign_control_classic_insert on public.campaigns;
drop trigger campaign_control_classic_update on public.campaigns;
drop function campaign_control_v1.track_classic();
drop function public.campaign_control_command(text,jsonb,uuid);
drop function public.campaign_control_read(text,uuid,uuid,text,text,int);
drop function public.claim_outbox();
alter function campaign_control_v1.claim_outbox() set schema public;
grant execute on function public.claim_outbox() to service_role;
drop function campaign_control_v1.summary(uuid);
drop function campaign_control_v1.sender_current(uuid);
drop function campaign_control_v1.facts(uuid);
drop function campaign_control_v1.contacts(uuid);
drop function campaign_control_v1.access(uuid,boolean);
drop schema campaign_control_v1;
-- Keep metadata and all historical intents. No recipient or outbox deletion.
notify pgrst,'reload schema';
commit;
