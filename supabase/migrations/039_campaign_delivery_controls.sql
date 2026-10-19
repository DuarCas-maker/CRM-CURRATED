begin;
alter table public.email_templates add column body_format text not null default 'plain' check(body_format in ('plain','markdown'));
alter table public.campaigns add column body_format text not null default 'plain' check(body_format in ('plain','markdown'));
alter table public.campaigns add column excluded_contact_ids uuid[] not null default '{}';
alter table public.outbox add column body_html text;
alter table public.outbox add column campaign_test boolean not null default false;
alter table public.mail_accounts add column campaign_daily_limit int not null default 100 check(campaign_daily_limit between 1 and 2000);
alter table public.mail_accounts add column operational_reserve int not null default 20 check(operational_reserve between 0 and 1999);
alter table public.mail_accounts add column external_usage_synced_at timestamptz;
drop view public.campaign_workspace;
create view public.campaign_workspace with(security_invoker=true) as select c.*,(select count(*)::int from public.campaign_enrollments e where e.campaign_id=c.id) audience_count,public.campaign_delivery_stats(c.id) delivery_stats from public.campaigns c;
grant select on public.campaign_workspace to authenticated,service_role;

create table public.email_template_versions (
 template_id uuid not null references public.email_templates, version int not null,
 snapshot jsonb not null, created_at timestamptz not null default now(), primary key(template_id,version)
);
insert into public.email_template_versions select id,version,to_jsonb(t),now() from public.email_templates t;
alter table public.email_template_versions enable row level security;
create policy template_versions_read on public.email_template_versions for select to authenticated using(public.current_app_role() is not null);
grant select on public.email_template_versions to authenticated;
grant all on public.email_template_versions to service_role;

alter function public.save_campaign_template(jsonb,uuid) rename to save_campaign_template_v37;
do $$ begin execute replace(pg_get_functiondef('public.save_campaign_template_v37(jsonb,uuid)'::regprocedure),'r.request_key=save_campaign_template.request_key','r.request_key=save_campaign_template_v37.request_key');end $$;
create function public.save_campaign_template(p jsonb,request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;receipt public.command_receipts;fmt text:=coalesce(p->>'body_format','plain');
begin
 if fmt not in ('plain','markdown') then raise exception 'Invalid content format';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts r where r.user_id=auth.uid() and r.request_key=save_campaign_template.request_key;
 target:=public.save_campaign_template_v37(p,request_key);
 if receipt.user_id is null then
  update public.email_templates set body_format=fmt where id=target;
  insert into public.email_template_versions select id,version,to_jsonb(t),now() from public.email_templates t where id=target;
 end if;
 return target;
end $$;
revoke all on function public.save_campaign_template_v37(jsonb,uuid) from public,anon,authenticated;
revoke all on function public.save_campaign_template(jsonb,uuid) from public,anon;
grant execute on function public.save_campaign_template(jsonb,uuid) to authenticated,service_role;

create function public.campaign_missing_fields(subject text,body text,steps jsonb,vals jsonb) returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct m[1]),'{}') from regexp_matches(subject||E'\n'||body||E'\n'||steps::text,'\{\{\s*([^{}]+?)\s*\}\}','g') m
 where coalesce(btrim(vals->>m[1]),'')=''
$$;

-- One row per contact, including exclusions; no pagination-dependent selection.
create function public.campaign_audience(campaign_id uuid) returns table(contact_id uuid,opportunity_id uuid,name text,email text,company text,amount text,industry text,phone text,reason text,missing_fields text[]) language plpgsql stable security definer set search_path='' as $$
declare camp public.campaigns;
begin
 select * into camp from public.campaigns where id=campaign_id;
 if camp.id is null or public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') or not public.can_send(camp.account_id) then raise exception 'Campaign and sender access required';end if;
 return query
 select c.id,o.id,c.name,c.email,coalesce(o.company,''),o.amount::text,coalesce(o.industry,''),c.phone,
 case when c.id=any(camp.excluded_contact_ids) then 'excluded'
 when c.verification<>'valid' then 'unverified'
 when exists(select 1 from public.suppressions s where s.email=c.email) then 'suppressed'
 when exists(select 1 from public.campaign_enrollments e where e.contact_id=c.id and e.campaign_id<>camp.id and e.status in ('active','paused')) then 'other_campaign'
 when exists(select 1 from public.campaign_enrollments e where e.contact_id=c.id and e.campaign_id=camp.id and e.status not in ('active','paused')) then 'sequence_finished'
 when o.id is null then 'unavailable'
 when camp.requires_application and o.application_complete then 'goal_met'
 when cardinality(m.fields)>0 then 'missing_data'
 else 'eligible' end,m.fields
 from public.contacts c
 left join lateral (select op.* from public.opportunities op where op.contact_id=c.id and op.archived_at is null and op.handed_off_at is null and op.stage not in ('lost','paused','funded') and (op.campaign_id is null or op.campaign_id=camp.id) order by op.created_at desc,op.id limit 1) o on true
 cross join lateral (select public.campaign_missing_fields(camp.subject,camp.body,camp.steps,jsonb_build_object('name',c.name,'company',o.company,'amount',o.amount::text,'industry',o.industry,'phone',c.phone,'application_url','preview','unsubscribe_url','preview')) fields) m
 where camp.batch_id is null or exists(select 1 from public.import_rows r where r.contact_id=c.id and r.batch_id=camp.batch_id)
 order by c.email;
end $$;
revoke all on function public.campaign_audience(uuid) from public,anon;
grant execute on function public.campaign_audience(uuid) to authenticated;

alter function public.crm_command(text,jsonb,uuid) rename to crm_command_v37_campaign_delivery;
do $$ begin execute replace(pg_get_functiondef('public.crm_command_v37_campaign_delivery(text,jsonb,uuid)'::regprocedure),'r.request_key=crm_command.request_key','r.request_key=crm_command_v37_campaign_delivery.request_key');end $$;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.email_templates;c public.campaigns;r jsonb;receipt public.command_receipts;ids uuid[];original jsonb:=p;
begin
 if kind in ('archive_campaign_template','campaign_account_settings','campaign_audience_settings','activate_campaign','pause_campaign','create_campaign') then
  if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'Campaign administrator and MFA required';end if;
  if request_key is null then raise exception 'Idempotency key required';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
  select * into receipt from public.command_receipts cr where cr.user_id=auth.uid() and cr.request_key=crm_command.request_key;
  if receipt.user_id is not null then
   if receipt.kind<>kind or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused';end if;
   return receipt.result;
  end if;
 end if;
 if kind='create_campaign' then
  if nullif(p->>'template_id','') is not null then
   select * into t from public.email_templates where id=(p->>'template_id')::uuid and archived_at is null for share;
   if t.id is null or t.version is distinct from (p->>'template_version')::int then raise exception 'Template changed; reload';end if;
   -- The selected system template is authoritative, including attachments/format.
   p:=p||jsonb_build_object('subject',t.subject,'body',t.body,'steps',t.steps,'body_format',t.body_format);
  end if;
  if coalesce(p->>'body_format','plain') not in ('plain','markdown') then raise exception 'Invalid content format';end if;
  r:=public.crm_command_v37_campaign_delivery(kind,p,request_key);
  update public.campaigns set body_format=coalesce(p->>'body_format','plain') where id=(r->>'id')::uuid;
  update public.command_receipts set fingerprint=md5(original::text) where user_id=auth.uid() and command_receipts.request_key=crm_command.request_key;
  return r;
 elsif kind in ('activate_campaign','pause_campaign','campaign_audience_settings') then
  select * into c from public.campaigns where id=(p->>'id')::uuid for update;
  if c.id is null or not public.can_send(c.account_id) then raise exception 'Campaign and sender access required';end if;
  if kind='pause_campaign' then return public.crm_command_v37_campaign_delivery(kind,p,request_key);end if;
  if kind='campaign_audience_settings' then
   if c.status not in ('draft','paused') then raise exception 'Pause campaign before changing its audience';end if;
   if jsonb_typeof(p->'excluded_contact_ids')<>'array' or jsonb_array_length(p->'excluded_contact_ids')>5000 then raise exception 'Invalid exclusions';end if;
   ids:=array(select distinct value::uuid from jsonb_array_elements_text(p->'excluded_contact_ids'));
   update public.campaigns set excluded_contact_ids=ids where id=c.id;
   update public.outbox set status='cancelled' where enrollment_id in (select e.id from public.campaign_enrollments e where e.campaign_id=c.id and e.contact_id=any(ids)) and status in ('queued','paused');
   update public.campaign_enrollments set status='suppressed' where campaign_id=c.id and contact_id=any(ids) and status in ('active','paused');
  else
   if exists(select 1 from public.campaign_audience(c.id) where reason='missing_data') then raise exception 'Hay clientes con datos faltantes. Corrige o excluye esos contactos antes de activar.';end if;
   if not exists(select 1 from public.campaign_audience(c.id) where reason='eligible') then raise exception 'No hay destinatarios elegibles';end if;
   update public.campaign_enrollments e set status='active' where e.campaign_id=c.id and e.status='paused' and exists(select 1 from public.campaign_audience(c.id) a where a.contact_id=e.contact_id and a.reason='eligible');
   return public.crm_command_v37_campaign_delivery(kind,p,request_key);
  end if;
  r:=jsonb_build_object('id',c.id);
 elsif kind='archive_campaign_template' then
  select * into t from public.email_templates where id=(p->>'id')::uuid for update;
  if t.id is null or t.version is distinct from (p->>'expected_version')::int then raise exception 'Template changed; reload';end if;
  update public.email_templates set archived_at=case when coalesce((p->>'archived')::boolean,true) then now() else null end,version=version+1,updated_at=now(),updated_by=auth.uid() where id=t.id;
  insert into public.email_template_versions select id,version,to_jsonb(et),now() from public.email_templates et where id=t.id;
  r:=jsonb_build_object('id',t.id);
 elsif kind='campaign_account_settings' then
  if public.current_app_role()<>'superadmin' then raise exception 'Superadmin required';end if;
  if (p->>'daily_limit')::int not between 1 and 2000 or (p->>'campaign_daily_limit')::int not between 1 and 2000 or (p->>'operational_reserve')::int not between 0 and 1999 or (p->>'campaign_daily_limit')::int+(p->>'operational_reserve')::int>(p->>'daily_limit')::int then raise exception 'El cupo de campañas más la reserva no puede superar el límite total';end if;
  if not (p ?& array['daily_limit','campaign_daily_limit','operational_reserve']) then raise exception 'Complete limits required';end if;
  update public.mail_accounts set daily_limit=(p->>'daily_limit')::int,campaign_daily_limit=(p->>'campaign_daily_limit')::int,operational_reserve=(p->>'operational_reserve')::int where id=(p->>'id')::uuid;
  if not found then raise exception 'Account not found';end if;
  r:=jsonb_build_object('id',p->>'id');
 else
  return public.crm_command_v37_campaign_delivery(kind,p,request_key);
 end if;
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request_key,kind,r,md5(p::text));
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'campaign',(r->>'id')::uuid,kind);
 return r;
end $$;
revoke all on function public.crm_command_v37_campaign_delivery(text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.crm_command(text,jsonb,uuid) from public,anon;
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated,service_role;

-- Evidence observed in Gmail, including email sent outside the CRM. No bodies.
create table public.gmail_sent_usage(account_id uuid not null references public.mail_accounts,gmail_message_id text not null,internet_message_id text,sent_at timestamptz not null,recipients int not null default 1 check(recipients>0),primary key(account_id,gmail_message_id));
create index gmail_sent_usage_recent on public.gmail_sent_usage(account_id,sent_at);
alter table public.gmail_sent_usage enable row level security;
grant all on public.gmail_sent_usage to service_role;
create index outbox_rolling_usage on public.outbox(account_id,(coalesce(sent_at,sending_at))) where status in ('sent','sending','uncertain');

create function public.account_delivery_usage(account uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.mail_accounts;total int;campaign_total int;external_total int;recipient_total int;
begin
 select * into a from public.mail_accounts where id=account;
 select count(*)::int,count(*) filter(where enrollment_id is not null)::int into total,campaign_total from public.outbox where account_id=account and status in ('sent','sending','uncertain') and coalesce(sent_at,sending_at)>now()-interval '24 hours';
 select count(*)::int into external_total from public.gmail_sent_usage u where u.account_id=account and u.sent_at>now()-interval '24 hours' and not exists(select 1 from public.outbox o where o.account_id=account and (o.gmail_message_id=u.gmail_message_id or (u.internet_message_id is not null and o.message_id_header=u.internet_message_id)) and o.status in ('sent','sending','uncertain'));
 -- Conservative recipient ceiling: all To/Cc/Bcc occurrences count, even repeats
 -- and internal recipients, staying below Workspace's external unique ceiling.
 select coalesce(sum(n),0)::int into recipient_total from (
  select 1+coalesce(cardinality(o.cc_emails),0)+coalesce(cardinality(o.bcc_emails),0) n from public.outbox o where o.account_id=account and o.status in ('sent','sending','uncertain') and coalesce(o.sent_at,o.sending_at)>now()-interval '24 hours'
  union all select u.recipients from public.gmail_sent_usage u where u.account_id=account and u.sent_at>now()-interval '24 hours' and not exists(select 1 from public.outbox o where o.account_id=account and (o.gmail_message_id=u.gmail_message_id or (u.internet_message_id is not null and o.message_id_header=u.internet_message_id)) and o.status in ('sent','sending','uncertain'))
 ) counts;
 return jsonb_build_object('account_id',account,'crm_messages',total,'external_messages',external_total,'campaign_messages',campaign_total,'total_messages',total+external_total,'recipient_count',recipient_total,'recipient_limit',2000,'daily_limit',a.daily_limit,'campaign_limit',least(a.campaign_daily_limit,greatest(0,a.daily_limit-a.operational_reserve)),'reserve',a.operational_reserve,'remaining',greatest(0,a.daily_limit-total-external_total),'campaign_remaining',greatest(0,least(a.campaign_daily_limit-campaign_total,a.daily_limit-a.operational_reserve-total-external_total,2000-recipient_total)),'synced_at',a.external_usage_synced_at,'send_retry_at',a.send_retry_at);
end $$;
revoke all on function public.account_delivery_usage(uuid) from public,anon,authenticated;
grant execute on function public.account_delivery_usage(uuid) to service_role;
create function public.campaign_sending_budgets() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(public.account_delivery_usage(a.id)),'[]') from public.mail_accounts a where public.current_app_role() in ('superadmin','seller_admin') and public.can_send(a.id)
$$;
revoke all on function public.campaign_sending_budgets() from public,anon;
grant execute on function public.campaign_sending_budgets() to authenticated;

create function public.queue_campaign_test(campaign uuid,contact uuid,subject_text text,body_text text,html text,request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;sample public.opportunities;recipient public.profiles;previous public.outbox;target uuid:=gen_random_uuid();
begin
 select * into c from public.campaigns where id=campaign;
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') or not coalesce(public.can_send(c.account_id),false) then raise exception 'Campaign and sender access required';end if;
 if request is null or coalesce(btrim(subject_text),'')='' or length(subject_text)>220 or subject_text ~ E'[\r\n]' or coalesce(btrim(body_text),'')='' or length(body_text)>30000 or length(html)>200000 then raise exception 'Invalid test content';end if;
 select * into recipient from public.profiles where id=auth.uid() and active;
 select op.* into sample from public.opportunities op join public.campaign_audience(c.id) a on a.opportunity_id=op.id where a.contact_id=contact and a.reason='eligible';
 if sample.id is null then raise exception 'Eligible sample required';end if;
 perform pg_advisory_xact_lock(hashtextextended(request::text,38));
 select * into previous from public.outbox where request_key='campaign-test:'||request::text;
 if previous.id is not null then
  if previous.requested_by is distinct from auth.uid() or previous.account_id is distinct from c.account_id or previous.subject is distinct from subject_text or previous.body is distinct from body_text or previous.body_html is distinct from html then raise exception 'Idempotency key reused';end if;
  return previous.id;
 end if;
 insert into public.outbox(id,account_id,opportunity_id,to_email,subject,body,body_html,area,message_id_header,requested_by,request_key,campaign_asset_snapshot,campaign_test)
 values(target,c.account_id,sample.id,recipient.email,subject_text,body_text,html,'seller','<'||target::text||'@crm.curated.local>',auth.uid(),'campaign-test:'||request::text,c.asset_snapshot,true);
 return target;
end $$;
revoke all on function public.queue_campaign_test(uuid,uuid,text,text,text,uuid) from public,anon;
grant execute on function public.queue_campaign_test(uuid,uuid,text,text,text,uuid) to authenticated;

-- A test must not create client conversations, advance a sequence or change stage.
alter function public.mark_sent(uuid,text,text) rename to mark_sent_v37_campaign_delivery;
create function public.mark_sent(outbox_id uuid,gmail_id text,thread_id text) returns void language plpgsql security definer set search_path='' as $$
declare msg public.outbox;
begin
 select * into msg from public.outbox where id=outbox_id for update;
 if not coalesce(msg.campaign_test,false) then perform public.mark_sent_v37_campaign_delivery(outbox_id,gmail_id,thread_id);return;end if;
 if msg.status='sent' then return;end if;
 update public.outbox set status='sent',gmail_message_id=gmail_id,gmail_thread_id=thread_id,sent_at=now() where id=msg.id;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(msg.requested_by,'outbox',msg.id,'campaign_test_accepted');
end $$;
revoke all on function public.mark_sent_v37_campaign_delivery(uuid,text,text),public.mark_sent(uuid,text,text) from public,anon,authenticated;
grant execute on function public.mark_sent(uuid,text,text) to service_role;

-- Preserve existing access/lease/spacing checks, replace calendar-day accounting.
do $$ declare definition text;begin
 select pg_get_functiondef('public.claim_outbox_v7()'::regprocedure) into definition;
 definition:=replace(definition,'local_start:=date_trunc(''day'',now() at time zone account.timezone) at time zone account.timezone;','local_start:=now()-interval ''24 hours'';');
 definition:=replace(definition,'if sent_count>=account.daily_limit or exists','if (public.account_delivery_usage(account.id)->>''total_messages'')::int>=account.daily_limit or (public.account_delivery_usage(account.id)->>''recipient_count'')::int+1+coalesce(cardinality(msg.cc_emails),0)+coalesce(cardinality(msg.bcc_emails),0)>2000 or exists');
 definition:=replace(definition,'coalesce(x.sent_at,x.sending_at)>=date_trunc(''day'',now() at time zone campaign.timezone) at time zone campaign.timezone','coalesce(x.sent_at,x.sending_at)>now()-interval ''24 hours''');
 definition:=replace(definition,'if sent_count>=campaign.daily_limit then','if sent_count>=campaign.daily_limit or (public.account_delivery_usage(account.id)->>''campaign_remaining'')::int<=0 then');
 definition:=replace(definition,'if sent_count>=campaign.daily_limit or','if account.external_usage_synced_at is null or account.external_usage_synced_at<now()-interval ''15 minutes'' then update public.outbox set available_at=now()+interval ''1 minute'',last_error=''GMAIL_USAGE_STALE'' where id=msg.id;return;end if; if sent_count>=campaign.daily_limit or');
 definition:=replace(definition,'if enrollment.status<>''active'' or contact.verification<>''valid''','if contact.id=any(campaign.excluded_contact_ids) or o.stage in (''lost'',''paused'',''funded'') or enrollment.status<>''active'' or contact.verification<>''valid''');
 execute definition;
 select pg_get_functiondef('public.claim_notification_outbox_v15()'::regprocedure) into definition;
 definition:=replace(definition,'if sent_count>=account.daily_limit or exists','if (public.account_delivery_usage(account.id)->>''total_messages'')::int>=account.daily_limit or (public.account_delivery_usage(account.id)->>''recipient_count'')::int>=2000 or exists');
 execute definition;
end $$;

-- Don't enroll goals or explicit exclusions, even for older application clients.
do $$ declare definition text;begin
 -- The command chain may delegate activation to its original implementation.
 select pg_get_functiondef('public.crm_command_v7(text,jsonb,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'where ct.verification=''valid'' and not exists','where ct.verification=''valid'' and not (ct.id=any(camp.excluded_contact_ids)) and not exists');
 definition:=replace(definition,'op.contact_id=ct.id and op.handed_off_at is null','op.contact_id=ct.id and op.archived_at is null and (not camp.requires_application or not op.application_complete) and op.handed_off_at is null');
 definition:=replace(definition,'where contact_id=c.id and handed_off_at is null','where contact_id=c.id and archived_at is null and (not camp.requires_application or not application_complete) and handed_off_at is null');
 execute definition;
end $$;

-- Shared rate budget across web processes, workers and all mailbox operations.
create table public.gmail_api_slots(scope text primary key,next_at timestamptz not null);
create table public.gmail_api_usage(project text not null,minute timestamptz not null,units bigint not null,primary key(project,minute));
alter table public.gmail_api_usage enable row level security;
grant all on public.gmail_api_usage to service_role;
alter table public.gmail_api_slots enable row level security;
grant all on public.gmail_api_slots to service_role;
create function public.reserve_gmail_api(account uuid,project text,units int) returns int language plpgsql security definer set search_path='' as $$
declare start_at timestamptz;user_at timestamptz;project_at timestamptz;
begin
 if units not between 1 and 1000 or length(project) not between 1 and 200 then raise exception 'Invalid quota reservation';end if;
 -- Always take the project lock first to avoid cross-account deadlocks.
 insert into public.gmail_api_slots values('project:'||project,now()) on conflict do nothing;
 select next_at into project_at from public.gmail_api_slots where scope='project:'||project for update;
 if (select coalesce(sum(u.units),0) from public.gmail_api_usage u where u.project=reserve_gmail_api.project and u.minute>=now()-interval '24 hours 1 minute')+units>75000000 then return -1;end if;
 insert into public.gmail_api_usage as u values(project,date_trunc('minute',now()),units) on conflict on constraint gmail_api_usage_pkey do update set units=u.units+excluded.units;
 delete from public.gmail_api_usage u where u.project=reserve_gmail_api.project and u.minute<now()-interval '25 hours';
 insert into public.gmail_api_slots values('account:'||account::text,now()) on conflict do nothing;
 select next_at into user_at from public.gmail_api_slots where scope='account:'||account::text for update;
 start_at:=greatest(clock_timestamp(),project_at,user_at);
 update public.gmail_api_slots set next_at=start_at+units*interval '1 minute'/900000 where scope='project:'||project;
 update public.gmail_api_slots set next_at=start_at+units*interval '1 minute'/4500 where scope='account:'||account::text;
 return greatest(0,ceil(extract(epoch from(start_at-clock_timestamp()))*1000)::int);
end $$;
revoke all on function public.reserve_gmail_api(uuid,text,int) from public,anon,authenticated;
grant execute on function public.reserve_gmail_api(uuid,text,int) to service_role;

create function public.recheck_outbox_delivery(message uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare m public.outbox;a public.mail_accounts;c public.campaigns;e public.campaign_enrollments;o public.opportunities;ct public.contacts;actor public.profiles;usage jsonb;
begin
 select * into m from public.outbox where id=message for update;
 if m.id is null or m.status<>'sending' then return false;end if;
 select * into a from public.mail_accounts where id=m.account_id for update;
 select * into actor from public.profiles where id=m.requested_by and active;
 if a.status<>'connected' or (m.opportunity_id is not null and (actor.id is null or not (actor.role='superadmin' or exists(select 1 from public.mail_permissions p where p.account_id=a.id and p.user_id=actor.id and p.can_send)))) then update public.outbox set status='paused' where id=m.id;return false;end if;
 usage:=public.account_delivery_usage(a.id);
 if a.send_retry_at>now() or (usage->>'total_messages')::int>a.daily_limit or (usage->>'recipient_count')::int>2000 then update public.outbox set status='queued',sending_at=null,available_at=greatest(now()+interval '1 minute',coalesce(a.send_retry_at,now())) where id=m.id;return false;end if;
 if m.enrollment_id is not null then
  select * into e from public.campaign_enrollments where id=m.enrollment_id;
  select * into c from public.campaigns where id=e.campaign_id;
  select * into o from public.opportunities where id=m.opportunity_id;
  select * into ct from public.contacts where id=e.contact_id;
  if e.status<>'active' or ct.verification<>'valid' or ct.id=any(c.excluded_contact_ids) or exists(select 1 from public.suppressions s where s.email=m.to_email) or o.archived_at is not null or o.handed_off_at is not null or o.stage in ('lost','paused','funded') or (c.requires_application and o.application_complete) then update public.outbox set status='cancelled' where id=m.id;return false;end if;
  if c.status<>'active' or extract(hour from now() at time zone c.timezone)<c.start_hour or extract(hour from now() at time zone c.timezone)>=c.end_hour or a.external_usage_synced_at is null or a.external_usage_synced_at<now()-interval '15 minutes' or (usage->>'campaign_messages')::int>a.campaign_daily_limit or (usage->>'total_messages')::int>a.daily_limit-a.operational_reserve then update public.outbox set status='queued',sending_at=null,available_at=now()+interval '1 minute' where id=m.id;return false;end if;
 elsif m.area='seller' and not m.campaign_test and exists(select 1 from public.suppressions s where s.email=m.to_email) then
  update public.outbox set status='cancelled' where id=m.id;return false;
 end if;
 return true;
end $$;
revoke all on function public.recheck_outbox_delivery(uuid) from public,anon,authenticated;
grant execute on function public.recheck_outbox_delivery(uuid) to service_role;

create function public.due_campaign_enrollments(application_enabled boolean) returns setof public.campaign_enrollments language sql security definer set search_path='' as $$
 select e.* from public.campaign_enrollments e join public.campaigns c on c.id=e.campaign_id
 where e.status='active' and c.status='active' and e.next_at<=now() and (application_enabled or not c.requires_application)
 and not exists(select 1 from public.outbox o where o.request_key='campaign:'||e.id::text||':'||e.step::text)
 order by e.next_at,e.id limit 100
$$;
revoke all on function public.due_campaign_enrollments(boolean) from public,anon,authenticated;
grant execute on function public.due_campaign_enrollments(boolean) to service_role;

create function public.complete_finished_campaigns() returns void language sql security definer set search_path='' as $$
 update public.campaigns c set status='completed' where c.status='active' and exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id) and not exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id and e.status in ('active','paused'))
$$;
revoke all on function public.complete_finished_campaigns() from public,anon,authenticated;
grant execute on function public.complete_finished_campaigns() to service_role;

create or replace function public.campaign_delivery_stats(campaign_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.campaigns;result jsonb;
begin
 select * into c from public.campaigns where id=campaign_id;
 if public.current_app_role() is null or c.id is null or not (public.current_app_role() in ('superadmin','seller_admin') or c.seller_id=auth.uid()) then raise exception 'Campaign access required';end if;
 select jsonb_build_object('sent',count(*) filter(where o.status='sent'),'pending',count(*) filter(where o.status in ('queued','sending','paused')),'failed',count(*) filter(where o.status='failed'),'uncertain',count(*) filter(where o.status='uncertain'),
 'replied',(select count(*) from public.campaign_enrollments e where e.campaign_id=c.id and e.status='replied' and public.can_case(e.opportunity_id)),
 'suppressed',(select count(*) from public.campaign_enrollments e where e.campaign_id=c.id and e.status='suppressed' and public.can_case(e.opportunity_id)),
 'bounced',(select count(*) from public.campaign_enrollments e where e.campaign_id=c.id and e.status='bounced' and public.can_case(e.opportunity_id))) into result
 from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id where e.campaign_id=c.id and public.can_case(e.opportunity_id);
 return result;
end $$;
notify pgrst,'reload schema';
commit;
