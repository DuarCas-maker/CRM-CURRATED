begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.campaign_income_leads(filter text default 'all',search_text text default '',page_number integer default 0,page_size integer default 50,income_filter text default 'all') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'CF_FORBIDDEN';end if;
 if filter is null or filter not in ('all','pending','running','available','campaign','contacted','review','excluded','restricted')
  or income_filter is null or income_filter not in ('all','with','without')
  or search_text is null or length(search_text)>200 or page_number is null or page_number not between 0 and 1000000 or page_size is null or page_size not in (20,50,100) then raise exception 'CF_INVALID_INPUT';end if;
 with states as materialized(select s.*,c.monthly_income from campaign_flow_v1.lead_states() s join public.contacts c on c.id=s.contact_id),
 scope as materialized(select * from states s where (filter='all' or s.funnel_state=filter) and strpos(lower(concat_ws(' ',s.company,s.name,s.email)),lower(search_text))>0),
 filtered as materialized(select * from scope where income_filter='all' or (income_filter='with' and monthly_income>0) or (income_filter='without' and monthly_income is null)),
 page as(select * from filtered order by email,contact_id limit page_size offset page_number*page_size)
 select jsonb_build_object('funnel',(select jsonb_build_object(
  'total',count(*),'pending',count(*)filter(where funnel_state='pending'),'running',count(*)filter(where funnel_state='running'),
  'available',count(*)filter(where funnel_state='available'),'campaign',count(*)filter(where funnel_state='campaign'),
  'contacted',count(*)filter(where funnel_state='contacted'),'review',count(*)filter(where funnel_state='review'),
  'excluded',count(*)filter(where funnel_state='excluded'),'restricted',count(*)filter(where funnel_state='restricted')) from states),
 'income_summary',jsonb_build_object(
  'all',(select jsonb_build_object('with_income',count(*)filter(where monthly_income>0),'without_income',count(*)filter(where monthly_income is null))from states),
  'available',(select jsonb_build_object('with_income',count(*)filter(where monthly_income>0),'without_income',count(*)filter(where monthly_income is null))from states where funnel_state='available')),
 'income_scope',(select jsonb_build_object('with_income',count(*)filter(where monthly_income>0),'without_income',count(*)filter(where monthly_income is null))from scope),
 'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by email,contact_id)from page),'[]')) into r;
 return r;
end$$;

create function public.campaign_income_pool(search_text text default '',page_number integer default 0,page_size integer default 20,income_filter text default 'all') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'CF_FORBIDDEN';end if;
 if income_filter is null or income_filter not in ('all','with','without') or search_text is null or length(search_text)>200 or page_size is null or page_size not in (20,50,100) or page_number is null or page_number not between 0 and 1000000 then raise exception 'CF_INVALID_INPUT';end if;
 with candidates as materialized(
  select distinct on(x.contact_id) x.contact_id,x.opportunity_id,x.name,x.email,x.company,c.monthly_income
  from public.campaign_prepared_leads('','',null) x join public.contacts c on c.id=x.contact_id
  where x.reason='eligible' and strpos(lower(concat_ws(' ',x.company,x.name,x.email)),lower(search_text))>0
  order by x.contact_id,x.opportunity_id),
 filtered as materialized(select * from candidates where income_filter='all' or (income_filter='with' and monthly_income>0) or (income_filter='without' and monthly_income is null)),
 page as(select * from filtered order by contact_id limit page_size offset page_number*page_size)
 select jsonb_build_object('total',(select count(*)from filtered),
 'income_scope',(select jsonb_build_object('with_income',count(*)filter(where monthly_income>0),'without_income',count(*)filter(where monthly_income is null))from candidates),
 'rows',coalesce((select jsonb_agg(to_jsonb(page) order by contact_id)from page),'[]')) into r;
 return r;
end$$;

create function public.campaign_template_readiness(template uuid,template_version integer,contact_ids uuid[],account uuid,reminders jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.email_templates;r jsonb;rows_json jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') or not coalesce(public.can_send(account),false) then raise exception 'CF_FORBIDDEN';end if;
 if not exists(select 1 from public.mail_accounts a where a.id=account and a.status='connected') then raise exception 'CF_FORBIDDEN';end if;
 if reminders is null or jsonb_typeof(reminders) is distinct from 'array' then raise exception 'CF_INVALID_INPUT';end if;
 if contact_ids is null or cardinality(contact_ids) not between 1 and 100 or array_position(contact_ids,null) is not null
  or cardinality(contact_ids)<>(select count(distinct id) from unnest(contact_ids) id)
  or jsonb_array_length(reminders)<>4 or octet_length(reminders::text)>90000 then raise exception 'CF_INVALID_INPUT';end if;
 select * into t from public.email_templates where id=template and archived_at is null;
 if t.id is null or t.version is distinct from template_version then raise exception 'CF_STALE';end if;
 with candidates as materialized(
  select distinct on(x.contact_id) x.*,c.monthly_income
  from public.first_contact_candidates(t.subject,t.body||reminders::text,account) x join public.contacts c on c.id=x.contact_id
  where x.contact_id=any(contact_ids) order by x.contact_id,(x.reason='eligible')desc,x.opportunity_id),
 normalized as(
  select contact_id,name,email,company,monthly_income,reason,
   array(select distinct case when field ~ '^funding_(amount|payment|weeks)_(6|9|12)$' then 'monthly_income' else field end
    from unnest(missing_fields||case when t.funding_model is not null and monthly_income is null then array['monthly_income'] else '{}'::text[] end) field order by 1) missing_fields
  from candidates)
 select coalesce(jsonb_agg(jsonb_build_object('contact_id',contact_id,'name',name,'email',email,'company',company,'monthly_income',monthly_income,
  'ready',reason='eligible' and cardinality(missing_fields)=0,
  'reason',case when reason='eligible' and cardinality(missing_fields)>0 then 'missing_data' else reason end,'missing_fields',to_jsonb(missing_fields)) order by email,contact_id),'[]') into rows_json from normalized;
 if jsonb_array_length(rows_json)<>cardinality(contact_ids) then raise exception 'CF_FORBIDDEN';end if;
 select jsonb_build_object('template_version',t.version,'checked_count',cardinality(contact_ids),
  'ready_count',count(*)filter(where (value->>'ready')::boolean),'attention_count',count(*)filter(where not(value->>'ready')::boolean),'rows',rows_json)
 into r from jsonb_array_elements(rows_json);
 return r;
end$$;
revoke all on function public.campaign_income_leads(text,text,integer,integer,text),public.campaign_income_pool(text,integer,integer,text),public.campaign_template_readiness(uuid,integer,uuid[],uuid,jsonb) from public,anon,service_role;
grant execute on function public.campaign_income_leads(text,text,integer,integer,text),public.campaign_income_pool(text,integer,integer,text),public.campaign_template_readiness(uuid,integer,uuid[],uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
