-- Only after rolling back the application. Requires production approval.
-- Restores migration 043's eligibility function; no business records are deleted.
begin;
create or replace function public.first_contact_candidates(subject_text text,body_text text,account uuid,campaign uuid default null)
returns table(contact_id uuid,opportunity_id uuid,name text,email text,company text,amount text,industry text,phone text,reason text,missing_fields text[])
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') or not coalesce(public.can_send(account),false) then raise exception 'Campaign and sender access required';end if;
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
drop function public.campaign_readiness_page(text,text,int);
drop function public.campaign_prepared_leads(text,text,uuid);
drop index public.campaign_confirmed_initial;
notify pgrst,'reload schema';
commit;
