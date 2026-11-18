begin;

create function campaign_flow_v1.lead_states()
returns table(contact_id uuid,name text,email text,company text,classification text,verification text,state text,reason_code text,retryable boolean,suppressed boolean,funnel_state text,funnel_reason text)
language sql stable security definer set search_path='' as $$
 with visible as materialized(select * from campaign_control_v1.contacts(null)),
 prepared as materialized(
  select distinct on(p.contact_id) p.contact_id,p.reason
  from public.campaign_prepared_leads('','',null) p join visible v on v.contact_id=p.contact_id
  order by p.contact_id,(p.reason='eligible') desc,p.opportunity_id
 ),
 contacted as materialized(
  select distinct o.contact_id from visible v join public.opportunities o on o.contact_id=v.contact_id
  join public.outbox b on b.opportunity_id=o.id
  where public.can_area(o.id,'seller') and b.area='seller' and b.status='sent'
   and b.gmail_message_id is not null and b.sent_at is not null and not b.campaign_test
 ),
 reserved as materialized(
  select distinct e.contact_id from visible v join public.campaign_enrollments e on e.contact_id=v.contact_id
  where e.status in ('active','paused') and public.can_area(e.opportunity_id,'seller')
 ),
 classified as(
  select v.*,p.reason,
   case when c.contact_id is not null then 'contacted'
    when r.contact_id is not null or p.reason='other_campaign' then 'campaign'
    when v.suppressed or v.classification='invalid' then 'excluded'
    when v.classification in ('review','uncertain') then 'review'
    when v.classification='pending' and v.state in ('queued','submitted') then 'running'
    when v.classification='pending' then 'pending'
    when p.reason='eligible' then 'available' else 'restricted' end stage
  from visible v left join prepared p on p.contact_id=v.contact_id
  left join contacted c on c.contact_id=v.contact_id left join reserved r on r.contact_id=v.contact_id
 )
 select x.contact_id,x.name,x.email,x.company,x.classification,x.verification,x.state,x.reason_code,
  x.retryable and x.stage in ('pending','review'),x.suppressed,x.stage,
  case when x.stage='contacted' then 'confirmed_send'
   when x.stage='campaign' then 'campaign_reserved'
   when x.suppressed then 'suppressed'
   when x.classification='invalid' then 'invalid_email'
   when x.classification='uncertain' then 'uncertain_email'
   when x.stage='review' then coalesce(x.state,'review')
   when x.stage='running' then x.state
   when x.stage='pending' then 'pending_verification'
   when x.stage='available' then 'eligible'
   else coalesce(x.reason,'not_prepared') end
 from classified x
$$;
revoke all on function campaign_flow_v1.lead_states() from public,anon,authenticated,service_role;

create function public.campaign_flow_leads(filter text default 'all',search_text text default '',page_number integer default 0,page_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'CF_FORBIDDEN';end if;
 if filter is null or filter not in ('all','pending','running','available','campaign','contacted','review','excluded','restricted')
  or search_text is null or length(search_text)>200 or page_number is null or page_number not between 0 and 1000000 or page_size is null or page_size not in (20,50,100) then raise exception 'CF_INVALID_INPUT';end if;
 with states as materialized(select * from campaign_flow_v1.lead_states()),
 filtered as materialized(select * from states s where (filter='all' or s.funnel_state=filter)
  and strpos(lower(concat_ws(' ',s.company,s.name,s.email)),lower(search_text))>0),
 page as(select * from filtered order by email,contact_id limit page_size offset page_number*page_size)
 select jsonb_build_object('funnel',(select jsonb_build_object(
  'total',count(*),'pending',count(*) filter(where funnel_state='pending'),'running',count(*) filter(where funnel_state='running'),
  'available',count(*) filter(where funnel_state='available'),'campaign',count(*) filter(where funnel_state='campaign'),
  'contacted',count(*) filter(where funnel_state='contacted'),'review',count(*) filter(where funnel_state='review'),
  'excluded',count(*) filter(where funnel_state='excluded'),'restricted',count(*) filter(where funnel_state='restricted')) from states),
  'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by email,contact_id) from page),'[]'::jsonb)) into result;
 return result;
end$$;
revoke all on function public.campaign_flow_leads(text,text,integer,integer) from public,anon,service_role;
grant execute on function public.campaign_flow_leads(text,text,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
