begin;
do $$begin if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.campaign_flow_launch(jsonb,uuid)')) is distinct from 'ecc6a0b713a89e438506288c523a7ac9' then raise exception 'CF_OWNER_BASE_CHANGED';end if;end$$;
create or replace function public.campaign_flow_launch(p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.campaigns;t public.email_templates;receipt public.command_receipts;ids uuid[];r jsonb;cfg jsonb;ctx jsonb;v_steps jsonb;start_at timestamptz;zone text:=p->>'timezone';n int;step jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'CF_FORBIDDEN';end if;
 if request_key is null then raise exception 'CF_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,18));
 select * into receipt from public.command_receipts x where x.user_id=auth.uid() and x.request_key=campaign_flow_launch.request_key;
 if found then
  if receipt.kind<>'campaign_flow_launch' or receipt.fingerprint<>md5(p::text) then raise exception 'CF_STALE';end if;
  return receipt.result;
 end if;
 if jsonb_typeof(p->'contact_ids') is distinct from 'array' or jsonb_array_length(p->'contact_ids') not between 1 and 100 or jsonb_typeof(p->'reminders') is distinct from 'array' or jsonb_array_length(p->'reminders')<>4 or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'CF_INVALID_INPUT';end if;
 ids:=array(select distinct value::uuid from jsonb_array_elements_text(p->'contact_ids') order by value::uuid);
 if cardinality(ids)<>jsonb_array_length(p->'contact_ids') then raise exception 'CF_STALE';end if;
 v_steps:=p->'reminders';n:=0;
 for step in select value from jsonb_array_elements(v_steps) loop
  n:=n+1;
  if jsonb_typeof(step->'subject') is distinct from 'string' or jsonb_typeof(step->'body') is distinct from 'string' or (step->>'wait_days')::int is distinct from (array[2,3,3,5])[n] or length(btrim(step->>'subject')) not between 1 and 200 or step->>'subject' ~ E'[\r\n]' or length(btrim(step->>'body')) not between 1 and 20000 or strpos(step->>'body','{{unsubscribe_url}}')=0
   or exists(select 1 from regexp_matches((step->>'subject')||(step->>'body'),'\{\{\s*([^{}]+?)\s*\}\}','g') m where btrim(m[1]) not in ('name','company','amount','industry','phone','application_url','unsubscribe_url')) then raise exception 'CF_INVALID_INPUT';end if;
 end loop;
 select jsonb_agg(value||jsonb_build_object('flow_version',1)) into v_steps from jsonb_array_elements(v_steps);
 select * into t from public.email_templates where id=(p->>'template_id')::uuid and archived_at is null for share;
 if t.id is null or t.version is distinct from (p->>'template_version')::int then raise exception 'CF_STALE';end if;
 if octet_length(v_steps::text||t.body)>90000 then raise exception 'CF_INVALID_INPUT';end if;
 start_at:=(p->>'scheduled_at')::timestamptz;
 if start_at is null or start_at<now()-interval '5 minutes' then raise exception 'CF_INVALID_INPUT';end if;
 start_at:=campaign_flow_v1.next_date(greatest(start_at,now()),0,zone);
 perform 1 from public.mail_accounts where id=(p->>'account_id')::uuid for update;
 perform 1 from public.contacts where id=any(ids) order by id for update;
 if exists(select 1 from public.first_contact_candidates(t.subject,(t.body||v_steps::text),(p->>'account_id')::uuid) a where a.contact_id=any(ids) and a.reason='missing_data') then raise exception 'CF_TEMPLATE_DATA';end if;
 if exists(select 1 from unnest(ids) id where not exists(select 1 from public.first_contact_candidates(t.subject,(t.body||v_steps::text),(p->>'account_id')::uuid) a where a.contact_id=id and a.reason='eligible')) then raise exception 'CF_STALE';end if;
 perform 1 from public.opportunities o join public.leads l on l.opportunity_id=o.id where l.contact_id=any(ids) order by o.id for update of o;
 cfg:=jsonb_build_object('name',left(t.name,180)||' · '||to_char(start_at at time zone zone,'DD/MM HH24:MI'),'account_id',p->>'account_id','seller_id',auth.uid(),'template_id',t.id,'template_version',t.version,'subject',t.subject,'body',t.body,'body_format',t.body_format,'asset_ids',t.asset_ids,'steps','[]'::jsonb,'selected_contact_ids',to_jsonb(ids),'daily_limit',(select campaign_daily_limit from public.mail_accounts where id=(p->>'account_id')::uuid),'timezone',zone,'start_hour',0,'end_hour',24,'brand_preparation',p->'brand_preparation');
 r:=public.crm_command('create_campaign',cfg,md5(request_key::text||':create')::uuid);
 select * into c from public.campaigns where id=(r->>'id')::uuid for update;
 if cardinality(c.selected_contact_ids)<>cardinality(ids) then raise exception 'CF_STALE';end if;
 perform public.crm_command(case when start_at>now() then 'schedule_campaign' else 'activate_campaign' end,jsonb_build_object('id',c.id,'scheduled_at',start_at,'brand_preparation',p->'brand_preparation'),md5(request_key::text||':activate')::uuid);
 if (select count(*) from public.campaign_enrollments where campaign_id=c.id)<>cardinality(ids) then raise exception 'CF_STALE';end if;
 ctx:=c.brand_snapshot;
 perform set_config('pipeline_os.brand_context',ctx::text,true);
 update public.campaigns set first_contact=false,steps=v_steps,requires_application=((t.subject||t.body||v_steps::text) ~ '\{\{\s*application_url\s*\}\}') where id=c.id;
 perform set_config('pipeline_os.brand_context','',true);
 insert into public.campaign_flows(campaign_id) values(c.id);
 r:=jsonb_build_object('id',c.id,'selected',cardinality(ids),'scheduled_at',start_at,'assigned_to',auth.uid());
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values(auth.uid(),request_key,'campaign_flow_launch',md5(p::text),r);
 return r;
end$$;
revoke all on function public.campaign_flow_launch(jsonb,uuid) from public,anon,service_role;grant execute on function public.campaign_flow_launch(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
