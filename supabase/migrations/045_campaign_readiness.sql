begin;

-- Shared preparation rules for both the global funnel and actual enrollment.
-- No dependency on migration 044 and no changes to client records or quotas.
create function public.campaign_prepared_leads(subject_text text,body_text text,campaign uuid default null)
returns table(contact_id uuid,opportunity_id uuid,name text,email text,company text,amount text,industry text,phone text,reason text,missing_fields text[])
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin','seller') then raise exception 'Seller access and MFA required';end if;
 return query
 select ct.id,op.id,ct.name,ct.email,l.company,l.amount::text,l.industry,ct.phone,
 case when ct.verification<>'valid' or ct.email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then 'unverified'
 when exists(select 1 from public.suppressions s where s.email=ct.email) then 'suppressed'
 when exists(select 1 from public.campaign_enrollments e where e.contact_id=ct.id and e.campaign_id is distinct from campaign and e.status in ('active','paused')) then 'other_campaign'
 when op.campaign_id is not null and op.campaign_id is distinct from campaign then 'other_campaign'
 when op.id is null or exists(select 1 from public.opportunities x where x.contact_id=ct.id and (x.handed_off_at is not null or x.stage not in ('new','contacting') or x.application_complete or x.archived_at is not null)) then 'advanced_case'
 when not exists(select 1 from public.campaign_enrollments e where e.campaign_id=campaign and e.contact_id=ct.id) and
 (op.last_contact is not null or exists(select 1 from public.outbox b join public.campaign_enrollments e on e.id=b.enrollment_id where e.contact_id=ct.id and b.status='sent' and not b.campaign_test)) then 'already_contacted'
 when cardinality(m.fields)>0 then 'missing_data' else 'eligible' end,m.fields
 from public.leads l join public.contacts ct on ct.id=l.contact_id
 left join public.opportunities op on op.id=l.opportunity_id
 cross join lateral(select public.campaign_missing_fields(subject_text,body_text,'[]',jsonb_build_object('name',ct.name,'company',l.company,'amount',l.amount::text,'industry',l.industry,'phone',ct.phone,'application_url','preview','unsubscribe_url','preview')) fields) m
 where public.can_lead(l.id) and (op.id is null or public.can_area(op.id,'seller'))
 order by ct.email,ct.id;
end $$;
revoke all on function public.campaign_prepared_leads(text,text,uuid) from public,anon,authenticated;

create or replace function public.first_contact_candidates(subject_text text,body_text text,account uuid,campaign uuid default null)
returns table(contact_id uuid,opportunity_id uuid,name text,email text,company text,amount text,industry text,phone text,reason text,missing_fields text[])
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') or not coalesce(public.can_send(account),false) then raise exception 'Campaign and sender access required';end if;
 return query select * from public.campaign_prepared_leads(subject_text,body_text,campaign);
end $$;

create function public.campaign_readiness_page(search_text text default '',state_filter text default 'eligible',page_number int default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin','seller') then raise exception 'Seller access and MFA required';end if;
 if state_filter not in ('all','eligible','sent','reserved','excluded','preparing','converted') or page_number<0 or page_number>1000000 or length(search_text)>200 then raise exception 'Invalid readiness filters';end if;
 with initial_sends as materialized (
  select distinct e.contact_id from public.campaign_enrollments e join public.outbox b on b.enrollment_id=e.id
  where b.status='sent' and b.gmail_message_id is not null and b.sent_at is not null and not b.campaign_test
  and (b.request_key='campaign:'||e.id::text||':0' or b.message_id_header='<'||e.id::text||'.0@crm.curated.local>')
  and public.can_area(e.opportunity_id,'seller')
 ), active as materialized (
  select distinct e.contact_id from public.campaign_enrollments e where e.status in ('active','paused') and public.can_area(e.opportunity_id,'seller')
 ), source as materialized (
  select p.contact_id,p.opportunity_id,p.company,p.name,p.email,p.reason,
   s.contact_id is not null as sent,a.contact_id is not null and s.contact_id is null as reserved
  from public.campaign_prepared_leads('','',null) p
  left join initial_sends s on s.contact_id=p.contact_id left join active a on a.contact_id=p.contact_id
 ), filtered as materialized (
  select * from source s where concat_ws(' ',s.company,s.name,s.email) ilike '%'||search_text||'%'
   and (state_filter='all' or (state_filter='preparing' and s.opportunity_id is null) or (state_filter='converted' and s.opportunity_id is not null) or (state_filter='eligible' and s.reason='eligible') or (state_filter='sent' and s.sent)
    or (state_filter='reserved' and s.reserved) or (state_filter='excluded' and s.reason<>'eligible' and not s.sent and not s.reserved))
 ), reasons as (select reason,count(*) n from source where reason<>'eligible' and not sent and not reserved group by reason)
 select jsonb_build_object('summary',jsonb_build_object(
  'total',(select count(*) from source),'preparing',(select count(*) from source where opportunity_id is null),
  'converted',(select count(*) from source where opportunity_id is not null),'eligible',(select count(*) from source where reason='eligible'),
  'sent',(select count(*) from source where sent),'reserved',(select count(*) from source where reserved),
  'excluded',(select count(*) from source where reason<>'eligible' and not sent and not reserved),
  'reasons',coalesce((select jsonb_object_agg(reason,n) from reasons),'{}'),
  'authorized_senders',(select count(*) from public.mail_accounts a where a.status='connected' and public.can_send(a.id))),
  'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(p) from(select * from filtered order by email,contact_id limit 50 offset page_number*50) p),'[]')) into result;
 return result;
end $$;
revoke all on function public.campaign_readiness_page(text,text,int) from public,anon;
grant execute on function public.campaign_readiness_page(text,text,int) to authenticated;

create index if not exists campaign_confirmed_initial on public.outbox(enrollment_id,request_key) where status='sent' and not campaign_test;
notify pgrst,'reload schema';
commit;
