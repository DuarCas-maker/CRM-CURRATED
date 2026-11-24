begin;
set local lock_timeout='2s';
do $guard$ begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='campaign_control_v1.summary(uuid)'::regprocedure) is distinct from '7a949cb46f8cc81c5966f7dcd7a1b495' then raise exception 'CAMPAIGN_READ_SOURCE_DRIFT';end if;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.campaign_control_read(text,uuid,uuid,text,text,integer)'::regprocedure) is distinct from 'a44a2e3471700029555244fdd71a528f' then raise exception 'CAMPAIGN_READ_SOURCE_DRIFT';end if;
 if not (to_regprocedure('campaign_control_v1.summary_with_context(uuid,jsonb,jsonb,jsonb)') is null) then raise exception 'CAMPAIGN_READ_HELPER_DRIFT';end if;
end $guard$;
create temporary table campaign_read_attributes on commit drop as select oid,(to_jsonb(p)-array['prosrc','proargdefaults'])||jsonb_build_object('canonical_arguments',pg_get_function_arguments(p.oid)) attributes from pg_proc p where oid in('campaign_control_v1.summary(uuid)'::regprocedure,'public.campaign_control_read(text,uuid,uuid,text,text,integer)'::regprocedure);
CREATE OR REPLACE FUNCTION campaign_control_v1.summary_with_context(group_id uuid, metrics jsonb, sender_pending jsonb, budgets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.campaign_groups;senders jsonb;state text;
begin
 if not campaign_control_v1.access(group_id) then raise exception 'CC_FORBIDDEN';end if;
 select * into g from public.campaign_groups where id=group_id;
 if not found then raise exception 'CC_NOT_FOUND';end if;
 with s as(select c.*,a.email,a.status account_status,campaign_control_v1.sender_current(c.id) sender_allowed,
  coalesce(budgets->a.id::text,'{}'::jsonb) budget,
  brand_b2.can_sender(a.id) can_view_account,
  (select count(*) from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id where e.campaign_id=c.id and not o.campaign_test and o.status in ('sent','sending','uncertain') and coalesce(o.sent_at,o.sending_at)>now()-interval '24 hours') used_24h,
  coalesce((sender_pending->>a.id::text)::bigint,0) pending
  from public.campaign_group_members m join public.campaigns c on c.id=m.campaign_id join public.mail_accounts a on a.id=m.account_id where m.group_id=summary_with_context.group_id)
 select jsonb_agg(jsonb_build_object('account_id',s.account_id,'campaign_id',s.id,'email',case when s.can_view_account then s.email else 'Cuenta de campaña' end,'can_view_account',s.can_view_account,'status',s.account_status,'campaign_status',s.status,
  'daily_limit',s.daily_limit,'pending',s.pending,'timezone',s.timezone,'start_hour',s.start_hour,'end_hour',s.end_hour,'scheduled_at',s.scheduled_at,
  'budget',case when s.can_view_account then s.budget-'account_id' else jsonb_build_object('synced_at',null) end,'remaining',case when s.can_view_account and s.account_status='connected' and s.sender_allowed and (s.budget->>'synced_at')::timestamptz>=now()-interval '15 minutes' then least((s.budget->>'campaign_remaining')::int,greatest(0,s.daily_limit-s.used_24h)) else null end,
  'blockers',to_jsonb(array_remove(array[
   case when s.account_status<>'connected' then 'account_disconnected' end,
   case when not s.sender_allowed then 'brand_review' end,
   case when s.brand_snapshot is null then 'brand_review' end,
   case when s.status='paused' then 'campaign_paused' end,
   case when s.status='draft' then 'campaign_draft' end,
   case when s.scheduled_at>now() then 'scheduled' end,
   case when extract(hour from now() at time zone s.timezone)<s.start_hour or extract(hour from now() at time zone s.timezone)>=s.end_hour then 'outside_window' end,
   case when s.can_view_account and ((s.budget->>'synced_at') is null or (s.budget->>'synced_at')::timestamptz<now()-interval '15 minutes') then 'usage_unknown' end,
   case when (s.budget->>'campaign_remaining')::int<=0 then 'account_limit' end,
   case when s.used_24h>=s.daily_limit then 'sender_limit' end,
   case when (s.budget->>'send_retry_at')::timestamptz>now() then 'provider_wait' end,
   case when exists(select 1 from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id where e.campaign_id=s.id and o.status='paused' and o.last_error like 'BRAND_%') then 'brand_review' end
  ],null))
 ) order by s.account_id) into senders from s;
 select case when bool_or(c.status='active' and c.scheduled_at>now()) and not bool_or(c.status='active' and (c.scheduled_at is null or c.scheduled_at<=now())) then 'scheduled'
 when bool_or(c.status='active') then 'active' when bool_or(c.status='paused') then 'paused' when bool_or(c.status='draft') then 'draft' else 'completed' end into state
 from public.campaign_group_members m join public.campaigns c on c.id=m.campaign_id where m.group_id=summary_with_context.group_id and (cardinality(c.selected_contact_ids)>0 or exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id));
 return to_jsonb(g)||jsonb_build_object('status',coalesce(state,'draft'),'metrics',metrics,'senders',coalesce(senders,'[]'),
  'used_24h',(select count(*) from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id join public.campaign_group_members m on m.campaign_id=e.campaign_id where m.group_id=summary_with_context.group_id and not o.campaign_test and o.status in ('sent','sending','uncertain') and coalesce(o.sent_at,o.sending_at)>now()-interval '24 hours'));
end $function$;
revoke all on function campaign_control_v1.summary_with_context(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function campaign_control_v1.summary(group_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare metrics jsonb;sender_pending jsonb;budgets jsonb;
begin
 if not campaign_control_v1.access(group_id) then raise exception 'CC_FORBIDDEN';end if;
 with f as materialized(select * from campaign_control_v1.facts(group_id)),
 pending as(select account_id,count(*) n from f where send_status in ('pending','queued','sending','paused') group by account_id)
 select (select jsonb_build_object('enrolled',count(*),'sent',count(*) filter(where send_status='sent'),
 'replied',count(*) filter(where send_status='sent' and reply_at is not null),'unanswered',count(*) filter(where send_status='sent' and reply_at is null),
 'pending',count(*) filter(where send_status in ('pending','queued','sending','paused')),'failed',count(*) filter(where send_status='failed'),
 'uncertain',count(*) filter(where send_status='uncertain'),'blocked',count(*) filter(where send_status in ('blocked','suppressed','goal_met','bounced','cancelled')),
 'attention',count(*) filter(where needs_attention)) from f),(select coalesce(jsonb_object_agg(account_id,n),'{}'::jsonb) from pending),
  (select coalesce(jsonb_object_agg(a.account_id,case when brand_b2.can_sender(a.account_id) then public.account_delivery_usage(a.account_id) else '{}'::jsonb end),'{}'::jsonb) data from (select distinct m.account_id from public.campaign_group_members m where m.group_id=summary.group_id) a) into metrics,sender_pending,budgets;
 return campaign_control_v1.summary_with_context(group_id,metrics,sender_pending,budgets);
end $function$;
CREATE OR REPLACE FUNCTION public.campaign_control_read(mode text DEFAULT 'overview'::text, batch uuid DEFAULT NULL::uuid, campaign uuid DEFAULT NULL::uuid, filter text DEFAULT 'all'::text, search_text text DEFAULT ''::text, page_number integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin','seller') then raise exception 'CC_FORBIDDEN';end if;
 if page_number is null or page_number not between 0 and 1000000 or length(coalesce(search_text,''))>200 then raise exception 'CC_INVALID_INPUT';end if;
 if mode='overview' then
  with contacts as materialized(select * from campaign_control_v1.contacts(batch)),
  groups as materialized(select g.id from public.campaign_groups g where campaign_control_v1.access(g.id) and (batch is null or g.batch_id=batch)),
  facts as materialized(select g.id group_id,f.* from groups g cross join lateral campaign_control_v1.facts(g.id) f),
  metrics as materialized(select group_id,jsonb_build_object('enrolled',count(*),'sent',count(*) filter(where send_status='sent'),
 'replied',count(*) filter(where send_status='sent' and reply_at is not null),'unanswered',count(*) filter(where send_status='sent' and reply_at is null),
 'pending',count(*) filter(where send_status in ('pending','queued','sending','paused')),'failed',count(*) filter(where send_status='failed'),
 'uncertain',count(*) filter(where send_status='uncertain'),'blocked',count(*) filter(where send_status in ('blocked','suppressed','goal_met','bounced','cancelled')),
 'attention',count(*) filter(where needs_attention)) data from facts f group by group_id),
  pending as materialized(select group_id,account_id,count(*) n from facts where send_status in ('pending','queued','sending','paused') group by group_id,account_id),
  budgets as materialized(select coalesce(jsonb_object_agg(a.account_id,case when brand_b2.can_sender(a.account_id) then public.account_delivery_usage(a.account_id) else '{}'::jsonb end),'{}'::jsonb) data from (select distinct m.account_id from public.campaign_group_members m where m.group_id in(select id from groups)) a),
  summaries as materialized(select g.id,campaign_control_v1.summary_with_context(g.id,
   coalesce((select data from metrics where group_id=g.id),jsonb_build_object('enrolled',0,'sent',0,'replied',0,'unanswered',0,'pending',0,'failed',0,'uncertain',0,'blocked',0,'attention',0)),
   (select coalesce(jsonb_object_agg(account_id,n),'{}'::jsonb) from pending where group_id=g.id),budgets.data) data from groups g cross join budgets),
  filtered as(select * from summaries where data->>'name' ilike '%'||search_text||'%' and (filter='all' or data->>'status'=filter))
  select jsonb_build_object('funnel',(select jsonb_build_object('total',count(*),'valid',count(*) filter(where classification='valid'),'invalid',count(*) filter(where classification='invalid'),'uncertain',count(*) filter(where classification='uncertain'),'pending',count(*) filter(where classification='pending'),'review',count(*) filter(where classification='review'),'running',count(*) filter(where state in ('queued','submitted')),'suppressed',count(*) filter(where suppressed),
   'available',(select count(distinct p.contact_id) from public.campaign_prepared_leads('','',null) p join contacts x on x.contact_id=p.contact_id where p.reason='eligible'),
   'reserved',(select count(*) from contacts x where exists(select 1 from public.campaign_enrollments e where e.contact_id=x.contact_id and e.status in ('active','paused')))) from contacts),
   'summary',jsonb_build_object('campaigns',(select count(*) from groups),'active',(select count(*) from summaries where data->>'status'='active'),'scheduled',(select count(*) from summaries where data->>'status'='scheduled'),
    'sent',(select count(distinct contact_id) from facts where send_status='sent'),'pending',(select count(distinct contact_id) from facts where send_status in ('pending','queued','sending','paused')),'replied',(select count(distinct contact_id) from facts where send_status='sent' and reply_at is not null),
    'unanswered',(select count(distinct f.contact_id) from facts f where f.send_status='sent' and not exists(select 1 from facts r where r.contact_id=f.contact_id and r.reply_at is not null))),
   'total',(select count(*) from filtered),'campaigns',coalesce((select jsonb_agg(data) from(select data from filtered order by data->>'created_at' desc,id limit 25 offset page_number*25) x),'[]')) into result;
 elsif mode='leads' then
  if filter not in ('all','valid','invalid','uncertain','pending','review') then raise exception 'CC_INVALID_INPUT';end if;
  with filtered as materialized(select * from campaign_control_v1.contacts(batch) x where (filter='all' or x.classification=filter) and concat_ws(' ',x.name,x.email,x.company) ilike '%'||search_text||'%')
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from filtered order by email,contact_id limit 50 offset page_number*50) x),'[]')) into result;
 elsif mode='details' then
  if filter not in ('all','pending','sent','replied','unanswered','errors') then raise exception 'CC_INVALID_INPUT';end if;
  with filtered as materialized(select * from campaign_control_v1.facts(campaign) f where concat_ws(' ',f.company,f.name,f.email) ilike '%'||search_text||'%' and (filter='all' or filter='pending' and f.send_status in ('pending','queued','sending','paused') or filter='sent' and f.send_status='sent' or filter='replied' and f.reply_at is not null or filter='unanswered' and f.send_status='sent' and f.reply_at is null or filter='errors' and f.send_status in ('failed','uncertain','blocked','cancelled','suppressed','bounced','goal_met')))
  select jsonb_build_object('campaign',campaign_control_v1.summary(campaign),'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('manageable',x.send_status in ('pending','queued','paused') and not exists(select 1 from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id join public.campaign_group_members m on m.campaign_id=e.campaign_id where m.group_id=campaign and e.contact_id=x.contact_id and (o.status in ('sent','sending','uncertain') or o.brand_admission_id is not null)))) from(select * from filtered order by email,contact_id limit 50 offset page_number*50) x),'[]')) into result;
 else raise exception 'CC_INVALID_INPUT';end if;
 return result;
end $function$;
do $post$ begin
 if exists(select 1 from campaign_read_attributes a join pg_proc p on p.oid=a.oid where a.attributes is distinct from (to_jsonb(p)-array['prosrc','proargdefaults'])||jsonb_build_object('canonical_arguments',pg_get_function_arguments(p.oid))) then raise exception 'CAMPAIGN_READ_ATTRIBUTES_CHANGED';end if;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='campaign_control_v1.summary(uuid)'::regprocedure) is distinct from '6824d593d0aa604b669d36565aca0989' then raise exception 'CAMPAIGN_READ_RESULT_DRIFT';end if;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.campaign_control_read(text,uuid,uuid,text,text,integer)'::regprocedure) is distinct from '42d89f1a804cb2a8ea3dfcbc47d6f7fa' then raise exception 'CAMPAIGN_READ_RESULT_DRIFT';end if;
end $post$;
commit;
