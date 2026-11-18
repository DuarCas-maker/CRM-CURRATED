begin;
do $$declare pin record;actual text;begin
 if to_regnamespace('campaign_control_v1') is null or to_regprocedure('public.recheck_outbox_delivery_before_brand_b2(uuid)') is null then raise exception 'CF_BASE_UNAVAILABLE';end if;
 for pin in select * from (values
  ('public.crm_command(text,jsonb,uuid)','f519770bcd945aa7bc51c2a2bb722788'),
  ('public.recheck_outbox_delivery_before_brand_b2(uuid)','e81ecd5e083959302a607c8199c3798d'),
  ('public.start_scheduled_campaigns()','23e3b13617f20b97849f16de1b5ce283'),
  ('public.claim_outbox()','fdde695971cb3e0fbe7ae13e7f2b76dd')
 ) p(signature,hash) loop
  select md5(replace(prosrc,E'\r\n',E'\n')) into actual from pg_proc where oid=to_regprocedure(pin.signature);
  if actual is distinct from pin.hash then raise exception 'CF_BASE_CHANGED';end if;
 end loop;
end$$;
create schema campaign_flow_v1;
revoke all on schema campaign_flow_v1 from public,anon,authenticated,service_role;
create table public.campaign_flows(
 campaign_id uuid primary key references public.campaigns,
 version int not null default 1 check(version=1),created_at timestamptz not null default now()
);
alter table public.campaign_flows enable row level security;
revoke all on public.campaign_flows from public,anon,authenticated,service_role;
grant select on public.campaign_flows to authenticated,service_role;
create function public.campaign_flow_visible(campaign uuid) returns boolean language sql stable security definer set search_path='' as $$select campaign_control_v1.access(campaign)$$;
revoke all on function public.campaign_flow_visible(uuid) from public,anon,service_role;
grant execute on function public.campaign_flow_visible(uuid) to authenticated;
create policy flow_read on public.campaign_flows for select to authenticated using(public.campaign_flow_visible(campaign_id));
create table campaign_flow_v1.import_consents(
 batch_id uuid primary key references public.import_batches,actor_id uuid not null references public.profiles,
 max_count int not null check(max_count between 1 and 1000000),queued int not null default 0 check(queued>=0 and queued<=max_count),fingerprint text not null,created_at timestamptz not null default now()
);
create function campaign_flow_v1.next_date(anchor timestamptz,days int,zone text) returns timestamptz
language plpgsql immutable set search_path='' as $$
declare civil timestamp:=(anchor at time zone zone)+make_interval(days=>days);
begin
 if days<0 or days>90 then raise exception 'CF_INVALID_INPUT';end if;
 if extract(isodow from civil)=7 then civil:=civil+interval '1 day';end if;
 return civil at time zone zone;
end$$;
create function public.campaign_flow_register_import(p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare batch uuid;r campaign_flow_v1.import_consents;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'CF_FORBIDDEN';end if;
 if (p->>'max_count')::int is distinct from (p->>'total')::int or (p->>'max_count')::int not between 1 and 1000000 then raise exception 'CF_INVALID_INPUT';end if;
 if p->>'storage_path' not in (auth.uid()::text||'/'||((p->>'request_key')::uuid)::text||'.xlsx',auth.uid()::text||'/'||((p->>'request_key')::uuid)::text||'.csv') or jsonb_typeof(p->'mapping') is distinct from 'object' or coalesce(length(p->>'file_name'),0) not between 1 and 255 then raise exception 'CF_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(p->>'request_key',17));
 select id into batch from public.import_batches where request_key=(p->>'request_key')::uuid;
 if batch is not null then
  select * into r from campaign_flow_v1.import_consents where batch_id=batch;
  if r.actor_id is distinct from auth.uid() or r.fingerprint is distinct from md5((p-'batch_id')::text) then raise exception 'CF_STALE';end if;
  return batch;
 end if;
 batch:=public.register_import((p->>'batch_id')::uuid,p->>'file_name',p->>'storage_path',p->'mapping',p->>'sheet',(p->>'total')::int,auth.uid(),(p->>'request_key')::uuid);
 insert into campaign_flow_v1.import_consents(batch_id,actor_id,max_count,fingerprint) values(batch,auth.uid(),(p->>'max_count')::int,md5((p-'batch_id')::text));
 return batch;
end$$;
create function campaign_flow_v1.auto_verify() returns trigger
language plpgsql security definer set search_path='' as $$
declare consent campaign_flow_v1.import_consents;
begin
 if new.result<>'imported' or new.contact_id is null then return new;end if;
 select * into consent from campaign_flow_v1.import_consents where batch_id=new.batch_id for update;
 if not found or consent.queued>=consent.max_count or not exists(select 1 from public.profiles p where p.id=consent.actor_id and p.active and p.role in ('superadmin','seller_admin')) then return new;end if;
 perform 1 from public.contacts c where c.id=new.contact_id and c.verification='pending' and not exists(select 1 from public.suppressions s where s.email=c.email) for update;
 if not found or exists(select 1 from public.verifications v where v.contact_id=new.contact_id) then return new;end if;
 insert into public.verifications(contact_id,request_key,result) values(new.contact_id,'flow-import:'||new.batch_id||':'||new.contact_id,'pending') on conflict do nothing;
 if found then
  update campaign_flow_v1.import_consents set queued=queued+1 where batch_id=new.batch_id;
  insert into public.jobs(kind,payload,dedupe_key) values('scrub','{}','flow-import:'||new.batch_id||':'||(new.row_number/250)) on conflict do nothing;
 end if;
 return new;
end$$;
create trigger flow_import_verify after insert on public.import_rows for each row execute function campaign_flow_v1.auto_verify();

create function public.campaign_flow_pool(search_text text default '',page_number int default 0,page_size int default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'CF_FORBIDDEN';end if;
 if page_size not in (20,50,100) or page_number<0 or page_number>1000000 or length(search_text)>200 then raise exception 'CF_INVALID_INPUT';end if;
 with candidates as materialized(select * from public.campaign_prepared_leads('','',null) x where x.reason='eligible' and (search_text='' or strpos(lower(x.company||' '||x.name||' '||x.email),lower(search_text))>0)),
 page as(select contact_id,opportunity_id,name,email,company from candidates order by contact_id limit page_size offset page_number*page_size)
 select jsonb_build_object('total',(select count(*) from candidates),'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]')) into r;
 return r;
end$$;

create function public.campaign_flow_launch(p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.campaigns;t public.email_templates;receipt public.command_receipts;ids uuid[];r jsonb;cfg jsonb;ctx jsonb;v_steps jsonb;advisors jsonb;owner_locks jsonb;start_at timestamptz;zone text:=p->>'timezone';n int;step jsonb;
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
 select jsonb_object_agg(l.opportunity_id::text,l.seller_id) into advisors from public.leads l where l.contact_id=any(ids) and public.can_lead(l.id);
 perform 1 from public.opportunities o where advisors ? o.id::text order by o.id for update;
 select jsonb_object_agg(o.id::text,o.owner_locked_at) into owner_locks from public.opportunities o where advisors ? o.id::text;
 cfg:=jsonb_build_object('name',left(t.name,180)||' · '||to_char(start_at at time zone zone,'DD/MM HH24:MI'),'account_id',p->>'account_id','seller_id',auth.uid(),'template_id',t.id,'template_version',t.version,'subject',t.subject,'body',t.body,'body_format',t.body_format,'asset_ids',t.asset_ids,'steps','[]'::jsonb,'selected_contact_ids',to_jsonb(ids),'daily_limit',(select campaign_daily_limit from public.mail_accounts where id=(p->>'account_id')::uuid),'timezone',zone,'start_hour',0,'end_hour',24,'brand_preparation',p->'brand_preparation');
 r:=public.crm_command('create_campaign',cfg,md5(request_key::text||':create')::uuid);
 select * into c from public.campaigns where id=(r->>'id')::uuid for update;
 if cardinality(c.selected_contact_ids)<>cardinality(ids) then raise exception 'CF_STALE';end if;
 perform public.crm_command(case when start_at>now() then 'schedule_campaign' else 'activate_campaign' end,jsonb_build_object('id',c.id,'scheduled_at',start_at,'brand_preparation',p->'brand_preparation'),md5(request_key::text||':activate')::uuid);
 if (select count(*) from public.campaign_enrollments where campaign_id=c.id)<>cardinality(ids) then raise exception 'CF_STALE';end if;
 update public.opportunities o set seller_id=(advisors->>o.id::text)::uuid where advisors ? o.id::text;
 update public.opportunities o set owner_locked_at=nullif(owner_locks->>o.id::text,'')::timestamptz where owner_locks ? o.id::text;
 ctx:=c.brand_snapshot;
 perform set_config('pipeline_os.brand_context',ctx::text,true);
 update public.campaigns set first_contact=false,steps=v_steps,requires_application=((t.subject||t.body||v_steps::text) ~ '\{\{\s*application_url\s*\}\}') where id=c.id;
 perform set_config('pipeline_os.brand_context','',true);
 insert into public.campaign_flows(campaign_id) values(c.id);
 r:=jsonb_build_object('id',c.id,'selected',cardinality(ids),'scheduled_at',start_at);
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values(auth.uid(),request_key,'campaign_flow_launch',md5(p::text),r);
 return r;
end$$;

create function campaign_flow_v1.advance() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.campaigns;anchor timestamptz;
begin
 if new.step=old.step+1 and exists(select 1 from public.campaign_flows where campaign_id=new.campaign_id) then
  select * into c from public.campaigns where id=new.campaign_id;
  select sent_at into anchor from public.outbox where enrollment_id=new.id and request_key='campaign:'||new.id||':'||old.step and status='sent';
  if anchor is null then raise exception 'CF_CONFIRMATION_REQUIRED';end if;
  new.next_at:=campaign_flow_v1.next_date(anchor,(c.steps->old.step->>'wait_days')::int,c.timezone);
 end if;
 return new;
end$$;
create trigger flow_enrollment_advance before update of step on public.campaign_enrollments for each row execute function campaign_flow_v1.advance();

alter function public.start_scheduled_campaigns() set schema campaign_flow_v1;
create function public.start_scheduled_campaigns() returns void language plpgsql security definer set search_path='' as $$
begin
 perform campaign_flow_v1.start_scheduled_campaigns();
 update public.campaigns c set activated_at=now() where exists(select 1 from public.campaign_flows f where f.campaign_id=c.id) and c.status='active' and c.scheduled_at<=now() and c.activated_at is null;
end$$;
revoke all on function public.start_scheduled_campaigns() from public,anon,authenticated;
grant execute on function public.start_scheduled_campaigns() to service_role;

-- Resuming a typed flow only resumes its frozen audience; the legacy generic
-- activation must never discover new contacts after the initial transaction.
alter function public.crm_command(text,jsonb,uuid) set schema campaign_flow_v1;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.campaigns;ctx jsonb;receipt public.command_receipts;r jsonb;start_at timestamptz;
begin
 if kind not in ('activate_campaign','schedule_campaign') or not exists(select 1 from public.campaign_flows where campaign_id=nullif(p->>'id','')::uuid) then return campaign_flow_v1.crm_command(kind,p,request_key);end if;
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') or request_key is null then raise exception 'CF_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts x where x.user_id=auth.uid() and x.request_key=crm_command.request_key;
 if found then if receipt.kind<>kind or receipt.fingerprint<>md5(p::text) then raise exception 'CF_STALE';end if;return receipt.result;end if;
 select * into c from public.campaigns where id=(p->>'id')::uuid;
 ctx:=public.brand_prepare_context(c.account_id,p->'brand_preparation','campaign');
 if not brand_b2.validate_snapshot(c.brand_snapshot,c.account_id,c.created_by,'campaign') or ctx->>'brand_id' is distinct from c.brand_snapshot->>'brand_id' then raise exception 'CF_STALE';end if;
 perform 1 from public.mail_accounts where id=c.account_id for update;
 select * into c from public.campaigns where id=c.id for update;
 if c.status not in ('draft','paused') or not exists(select 1 from public.campaign_enrollments where campaign_id=c.id and status in ('active','paused')) then raise exception 'CF_STALE';end if;
 start_at:=case when kind='schedule_campaign' then (p->>'scheduled_at')::timestamptz else now() end;
 if start_at is null or (kind='schedule_campaign' and start_at<=now()) then raise exception 'CF_INVALID_INPUT';end if;
 start_at:=campaign_flow_v1.next_date(start_at,0,c.timezone);
 perform set_config('pipeline_os.brand_context',c.brand_snapshot::text,true);
 update public.campaigns set status='active',scheduled_at=case when start_at>now() then start_at end,activated_at=coalesce(activated_at,now()) where id=c.id;
 update public.campaign_enrollments set status='active' where campaign_id=c.id and status='paused';
 perform set_config('pipeline_os.brand_context','',true);
 r:=jsonb_build_object('id',c.id);
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values(auth.uid(),request_key,kind,md5(p::text),r);
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'campaign',c.id,kind);
 return r;
end$$;
revoke all on function public.crm_command(text,jsonb,uuid) from public,anon;
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated,service_role;

-- Extend the existing boundary used by brand claims AND final wire admission.
-- The public recheck entrypoint remains closed as required by brand_b2.
alter function public.recheck_outbox_delivery_before_brand_b2(uuid) set schema campaign_flow_v1;
create function public.recheck_outbox_delivery_before_brand_b2(message uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare m public.outbox;e public.campaign_enrollments;c public.campaigns;op public.opportunities;
begin
 select * into m from public.outbox where id=message;
 select * into e from public.campaign_enrollments where id=m.enrollment_id;
 if exists(select 1 from public.campaign_flows where campaign_id=e.campaign_id) then
  select * into c from public.campaigns where id=e.campaign_id;
  select * into op from public.opportunities where id=e.opportunity_id;
  if e.status<>'active' or op.handed_off_at is not null or op.archived_at is not null or op.application_complete or op.stage not in ('new','contacting') or not e.contact_id=any(c.selected_contact_ids)
   or m.request_key is distinct from ('campaign:'||e.id||':'||e.step)
   or (e.step=0 and (op.last_contact is not null or exists(select 1 from public.outbox x where x.opportunity_id=op.id and x.status='sent' and not x.campaign_test))) then
   update public.outbox set status='cancelled',last_error='CF_SEQUENCE_STOPPED' where id=m.id and status in ('sending','queued');
   update public.campaign_enrollments set status='goal_met' where id=e.id and status='active';return false;
  end if;
  if greatest(c.scheduled_at,e.next_at)>now() then
   update public.outbox set status='queued',sending_at=null,brand_claim_token=null,send_attempts=greatest(0,send_attempts-1),available_at=greatest(c.scheduled_at,e.next_at),last_error='CF_SCHEDULED' where id=m.id and status='sending' and brand_admission_id is null;return false;
  end if;
  if extract(isodow from now() at time zone c.timezone)=7 then
   update public.outbox set status='queued',sending_at=null,brand_claim_token=null,send_attempts=greatest(0,send_attempts-1),available_at=campaign_flow_v1.next_date(now(),0,c.timezone),last_error='CF_SUNDAY' where id=m.id and status='sending' and brand_admission_id is null;return false;
  end if;
 end if;
 return campaign_flow_v1.recheck_outbox_delivery_before_brand_b2(message);
end$$;
revoke all on function public.recheck_outbox_delivery_before_brand_b2(uuid) from public,anon,authenticated,service_role;

-- Gmail may place a follow-up with a different subject in another physical
-- thread. Attribute replies against every accepted step, preserving the exact
-- sender/recipient, RFC relationship, time and brand checks of the first email.
alter function public.campaign_reply_rows(uuid) set schema campaign_flow_v1;
create function public.campaign_reply_rows(campaign uuid)
returns table(contact_id uuid,message_id uuid,sent_at timestamptz,email text,opportunity_id uuid)
language plpgsql stable security definer set search_path='' as $$
declare c public.campaigns;
begin
 if not exists(select 1 from public.campaign_flows where campaign_id=campaign) then return query select * from campaign_flow_v1.campaign_reply_rows(campaign);return;end if;
 select * into c from brand_b2.visible_campaigns() where id=campaign;
 if public.current_app_role() is null or c.id is null or not(public.current_app_role() in ('superadmin','seller_admin') or (public.current_app_role()='seller' and c.seller_id=auth.uid())) then raise exception 'Campaign access required';end if;
 return query select distinct e.contact_id,m.id,m.sent_at,b.to_email,e.opportunity_id
 from public.campaign_enrollments e join public.outbox b on b.enrollment_id=e.id and not b.campaign_test
 join public.conversations co on co.id=b.conversation_id and co.account_id=c.account_id
 join public.messages m on m.conversation_id=co.id
 where e.campaign_id=c.id and public.can_area(e.opportunity_id,'seller') and public.can_area(co.opportunity_id,co.area)
 and b.request_key in(select 'campaign:'||e.id||':'||s from generate_series(0,4) s)
 and b.status='sent' and b.gmail_message_id is not null and b.sent_at is not null
 and m.status='received' and public.mail_human_reply(m.direction,m.nature,m.sender)
 and lower(btrim(m.sender))=lower(btrim(b.to_email)) and m.sent_at>=b.sent_at and m.reply_intent is distinct from 'ignored'
 and (regexp_split_to_array(btrim(coalesce(m.references_header,'')),'[[:space:]]+') @> array[b.message_id_header]
  or (coalesce(btrim(m.references_header),'')='' and coalesce(co.gmail_delivery_thread_id,co.gmail_thread_id)=b.gmail_thread_id
   and not exists(select 1 from public.outbox other join public.campaign_enrollments oe on oe.id=other.enrollment_id
    where other.account_id=b.account_id and other.gmail_thread_id=b.gmail_thread_id and oe.campaign_id<>c.id and other.status='sent' and not other.campaign_test)));
end$$;
revoke all on function public.campaign_reply_rows(uuid) from public,anon,service_role;
grant execute on function public.campaign_reply_rows(uuid) to authenticated;
alter function public.campaign_contact_facts(uuid) set schema campaign_flow_v1;
create function public.campaign_contact_facts(campaign uuid)
returns table(contact_id uuid,opportunity_id uuid,company text,name text,email text,send_status text,sent_at timestamptz,reply_at timestamptz,last_interaction timestamptz,needs_attention boolean,conversation_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.campaign_flows where campaign_id=campaign) then return query select * from campaign_flow_v1.campaign_contact_facts(campaign);return;end if;
 return query with replies as materialized(
  select distinct on(r.contact_id) r.contact_id,r.sent_at,co.id,co.updated_at,co.needs_attention and r.sent_at>=coalesce((select max(x.sent_at) from public.messages x where x.conversation_id=co.id and x.direction='outbound' and x.status='sent'),r.sent_at) attention
  from public.campaign_reply_rows(campaign) r join public.messages m on m.id=r.message_id join public.conversations co on co.id=m.conversation_id
  where public.can_area(co.opportunity_id,co.area) order by r.contact_id,r.sent_at desc,r.message_id
 ) select f.contact_id,f.opportunity_id,f.company,f.name,f.email,f.send_status,f.sent_at,f.reply_at,greatest(f.last_interaction,r.updated_at),coalesce(r.attention,f.needs_attention),coalesce(r.id,f.conversation_id)
 from campaign_flow_v1.campaign_contact_facts(campaign) f left join replies r on r.contact_id=f.contact_id;
end$$;
revoke all on function public.campaign_contact_facts(uuid) from public,anon,service_role;
grant execute on function public.campaign_contact_facts(uuid) to authenticated;

create function public.campaign_flow_progress(campaign uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if not campaign_control_v1.access(campaign) then raise exception 'CF_FORBIDDEN';end if;
 if not exists(select 1 from public.campaign_flows where campaign_id=campaign) then return null;end if;
 select jsonb_build_object('campaign_id',campaign,'steps',(select jsonb_agg(jsonb_build_object('step',s,'sent',(select count(*) from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id where e.campaign_id=campaign and o.request_key='campaign:'||e.id||':'||s and o.status='sent' and o.gmail_message_id is not null),'waiting',(select count(*) from public.campaign_enrollments e where e.campaign_id=campaign and e.step=s and e.status in ('active','paused')),'next_at',(select min(e.next_at) from public.campaign_enrollments e where e.campaign_id=campaign and e.step=s and e.status='active'))) from generate_series(0,4) s),'bounced',(select count(*) from public.campaign_enrollments e where e.campaign_id=campaign and e.status='bounced'),'stopped',(select count(*) from public.campaign_enrollments e where e.campaign_id=campaign and e.status in ('replied','suppressed','goal_met'))) into r;
 return r;
end$$;
create function public.campaign_flow_cases(case_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() is null then raise exception 'CF_FORBIDDEN';end if;
 if cardinality(case_ids)>500 then raise exception 'CF_INVALID_INPUT';end if;
 return coalesce((select jsonb_agg(state) from (
 select jsonb_build_object('id',e.opportunity_id,'initial_sent',exists(select 1 from public.outbox o where o.enrollment_id=e.id and o.request_key='campaign:'||e.id||':0' and o.status='sent' and o.gmail_message_id is not null),'engagement',case when e.status='bounced' then 'bounced' when e.status='replied' then 'in_progress' else 'unanswered' end) state
 from public.campaign_enrollments e join public.campaign_flows f on f.campaign_id=e.campaign_id where e.opportunity_id=any(case_ids) and public.can_case(e.opportunity_id)
 union all
 -- Validating a prepared lead creates its authorized case record internally.
 -- Untouched preparation records remain in the pool, outside Documentos.
 select jsonb_build_object('id',o.id,'initial_sent',false,'engagement','unanswered')
 from public.opportunities o where o.id=any(case_ids) and public.can_case(o.id) and o.stage='new' and o.last_contact is null and not o.application_complete and o.handed_off_at is null
 and exists(select 1 from public.leads l where l.opportunity_id=o.id)
 and not exists(select 1 from public.campaign_enrollments e join public.campaign_flows f on f.campaign_id=e.campaign_id where e.opportunity_id=o.id)
 and not exists(select 1 from public.outbox x where x.opportunity_id=o.id and x.status='sent' and not x.campaign_test)
 and not exists(select 1 from public.documents d where d.opportunity_id=o.id and d.storage_path is not null)
 and not exists(select 1 from public.conversations co join public.messages m on m.conversation_id=co.id where co.opportunity_id=o.id and m.direction='inbound' and m.nature='personal')
 ) source),'[]'::jsonb);
end$$;
revoke all on all functions in schema campaign_flow_v1 from public,anon,authenticated,service_role;
revoke all on function public.campaign_flow_pool(text,int,int),public.campaign_flow_launch(jsonb,uuid),public.campaign_flow_register_import(jsonb),public.campaign_flow_progress(uuid),public.campaign_flow_cases(uuid[]) from public,anon,service_role;
grant execute on function public.campaign_flow_pool(text,int,int),public.campaign_flow_launch(jsonb,uuid),public.campaign_flow_register_import(jsonb),public.campaign_flow_progress(uuid),public.campaign_flow_cases(uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
