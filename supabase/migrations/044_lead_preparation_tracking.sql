begin;

-- Expose only two flags for an accessible lead; outbox rows remain private.
create function public.lead_campaign_tracking(contact uuid)
returns table(enrolled boolean,sent boolean) language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.campaign_enrollments e where e.contact_id=contact),
 exists(select 1 from public.outbox b join public.campaign_enrollments e on e.id=b.enrollment_id
   where e.contact_id=contact and b.status='sent' and not b.campaign_test)
 where exists(select 1 from public.leads l where l.contact_id=contact and public.can_lead(l.id))
$$;
revoke all on function public.lead_campaign_tracking(uuid) from public,anon;
grant execute on function public.lead_campaign_tracking(uuid) to authenticated,service_role;

-- Append derived fields without changing existing lead columns or write paths.
create or replace view public.lead_workspace with(security_invoker=true) as
 select l.*,c.name as contact,c.email,c.phone,c.verification,
 exists(select 1 from public.suppressions s where s.email=c.email) as suppressed,
 v.state as verification_state,
 v.created_at as analysis_started_at,v.verified_at as analysis_completed_at,
 coalesce(campaign.enrolled,false) as campaign_enrolled,coalesce(campaign.sent,false) as campaign_sent
 from public.leads l join public.contacts c on c.id=l.contact_id
 left join lateral(select state,created_at,verified_at from public.verifications
   where contact_id=c.id order by created_at desc,id desc limit 1) v on true
 left join lateral public.lead_campaign_tracking(c.id) campaign on true;

-- Invoker rights keep every count and verification batch inside the caller's RLS.
-- Group by the command receipt key, not the provider batch (which may span requests).
create function public.lead_preparation_overview(
 search_text text default '',owner_filter uuid default null,since_filter timestamptz default null,
 verification_filter text default null,cursor_offset int default 0
) returns jsonb language sql stable security invoker set search_path='' as $$
 with scoped as materialized (
  select l.id,l.contact_id,l.verification,l.opportunity_id from public.lead_workspace l
  where (coalesce(search_text,'')='' or l.company ilike '%'||search_text||'%'
    or l.contact ilike '%'||search_text||'%' or l.email ilike '%'||search_text||'%')
   and (owner_filter is null or l.seller_id=owner_filter)
   and (since_filter is null or l.created_at>=since_filter)
   and (verification_filter is null or l.verification=verification_filter)
 ), batches as materialized (
  select split_part(v.request_key,':',1) as id,min(v.created_at) as started_at,
   case when count(*) filter(where v.state<>'completed')=0 then max(v.verified_at) end as completed_at,
   count(*)::int as total,
   count(*) filter(where v.state='completed')::int as completed,
   count(*) filter(where v.state in ('queued','submitted'))::int as pending,
   count(*) filter(where v.state='technical_error')::int as errors,
   count(*) filter(where v.state='uncertain_request')::int as review,
   count(*) filter(where v.state='completed' and v.result='valid')::int as valid,
   count(*) filter(where v.state='completed' and v.result='invalid')::int as invalid,
   count(*) filter(where v.state='completed' and v.result='uncertain')::int as uncertain
  from public.verifications v join scoped l on l.contact_id=v.contact_id
  group by split_part(v.request_key,':',1)
 ) select jsonb_build_object(
  'counts',jsonb_build_object(
   'preparing',(select count(*) from scoped where verification in ('pending','valid') and opportunity_id is null),
   'converted',(select count(*) from scoped where verification in ('pending','valid') and opportunity_id is not null),
   'risk',(select count(*) from scoped where verification in ('invalid','uncertain'))),
  'verification_total',(select count(*) from batches),
  'imports_total',(select count(*) from public.import_batches),
  'verifications',coalesce((select jsonb_agg(to_jsonb(b) order by b.started_at desc,b.id desc)
   from (select * from batches order by started_at desc,id desc limit 50 offset greatest(cursor_offset,0)) b),'[]'::jsonb)
 )
$$;
revoke all on function public.lead_preparation_overview(text,uuid,timestamptz,text,int) from public,anon;
grant execute on function public.lead_preparation_overview(text,uuid,timestamptz,text,int) to authenticated,service_role;
create index if not exists verifications_contact_created on public.verifications(contact_id,created_at desc,id desc);
notify pgrst,'reload schema';
commit;
