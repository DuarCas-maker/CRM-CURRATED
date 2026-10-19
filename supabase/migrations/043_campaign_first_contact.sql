begin;

-- Existing campaigns retain their sequences and delivery history.
alter table public.campaigns add column first_contact boolean not null default false;
alter table public.campaigns add column selected_contact_ids uuid[] not null default '{}';
alter table public.campaigns add column scheduled_at timestamptz;
alter table public.campaigns add column activated_at timestamptz;
alter table public.campaigns add constraint first_contact_single_message check(not first_contact or steps='[]'::jsonb);

-- The same eligibility query powers the composer, review and activation.
create function public.first_contact_candidates(subject_text text,body_text text,account uuid,campaign uuid default null)
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
revoke all on function public.first_contact_candidates(text,text,uuid,uuid) from public,anon;
grant execute on function public.first_contact_candidates(text,text,uuid,uuid) to authenticated;

alter function public.campaign_audience(uuid) rename to campaign_audience_v42;
revoke all on function public.campaign_audience_v42(uuid) from public,anon,authenticated;
create function public.campaign_audience(campaign_id uuid)
returns table(contact_id uuid,opportunity_id uuid,name text,email text,company text,amount text,industry text,phone text,reason text,missing_fields text[])
language plpgsql stable security definer set search_path='' as $$
declare c public.campaigns;
begin
 select * into c from public.campaigns where id=campaign_id;
 if not coalesce(c.first_contact,false) then return query select * from public.campaign_audience_v42(campaign_id);return;end if;
 return query select a.contact_id,a.opportunity_id,a.name,a.email,a.company,a.amount,a.industry,a.phone,
 case when a.contact_id=any(c.excluded_contact_ids) then 'excluded' else a.reason end,a.missing_fields
 from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) a where a.contact_id=any(c.selected_contact_ids);
end $$;
revoke all on function public.campaign_audience(uuid) from public,anon;
grant execute on function public.campaign_audience(uuid) to authenticated;

-- Preserve command receipts, permissions and authoritative template snapshots.
alter function public.crm_command(text,jsonb,uuid) rename to crm_command_v42_first_contact;
do $$begin execute replace(pg_get_functiondef('public.crm_command_v42_first_contact(text,jsonb,uuid)'::regprocedure),'crm_command.request_key','crm_command_v42_first_contact.request_key');end $$;
revoke all on function public.crm_command_v42_first_contact(text,jsonb,uuid) from public,anon,authenticated;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.campaigns;r jsonb;receipt public.command_receipts;ids uuid[];a record;original jsonb:=p;
begin
 if kind not in ('create_campaign','activate_campaign','schedule_campaign','pause_campaign') then return public.crm_command_v42_first_contact(kind,p,request_key);end if;
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') or request_key is null then raise exception 'Campaign administrator and MFA required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts cr where cr.user_id=auth.uid() and cr.request_key=crm_command.request_key;
 if receipt.user_id is not null then
  if receipt.kind<>kind or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused';end if;return receipt.result;
 end if;
 if kind='create_campaign' then
  if coalesce(btrim(p->>'name'),'')='' or length(p->>'name')>200 then raise exception 'Campaign name required';end if;
  r:=public.crm_command_v42_first_contact(kind,p,request_key);
  update public.campaigns set steps='[]',first_contact=true,batch_id=null,
   requires_application=(subject||body) ~ '\{\{\s*application_url\s*\}\}' where id=(r->>'id')::uuid returning * into c;
  if p ? 'selected_contact_ids' then
   if jsonb_typeof(p->'selected_contact_ids')<>'array' or jsonb_array_length(p->'selected_contact_ids')>5000 then raise exception 'Invalid lead selection';end if;
   ids:=array(select distinct value::uuid from jsonb_array_elements_text(p->'selected_contact_ids'));
   if exists(select 1 from unnest(ids) id where not exists(select 1 from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) x where x.contact_id=id and x.reason='eligible')) then raise exception 'Selecciona solo leads elegibles / Select eligible leads only';end if;
  else
   ids:=array(select x.contact_id from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) x where x.reason='eligible' limit 5000);
  end if;
  -- A draft may be saved before leads are ready; activation always needs recipients.
  update public.campaigns set selected_contact_ids=ids where id=c.id;
  return r;
 end if;
 select * into c from public.campaigns where id=(p->>'id')::uuid for update;
 if c.id is null or not coalesce(public.can_send(c.account_id),false) then raise exception 'Campaign and sender access required';end if;
 if kind='pause_campaign' or not c.first_contact then
  if kind='schedule_campaign' then raise exception 'Schedule first-contact campaigns only';end if;
  r:=public.crm_command_v42_first_contact(kind,p,request_key);
  if kind='activate_campaign' then update public.campaigns set activated_at=coalesce(activated_at,now()) where id=c.id;end if;
  return r;
 end if;
 if c.status not in ('draft','paused') then raise exception 'Campaign must be draft or paused';end if;
 if not exists(select 1 from public.mail_accounts where id=c.account_id and status='connected') then raise exception 'Gmail account disconnected';end if;
 if kind='schedule_campaign' and (nullif(p->>'scheduled_at','') is null or (p->>'scheduled_at')::timestamptz<=now()) then raise exception 'Choose a future date and time';end if;
 -- Lock the selected contacts, then repeat all eligibility checks transactionally.
 perform 1 from public.contacts where id=any(c.selected_contact_ids) order by id for update;
 if exists(select 1 from public.campaign_audience(c.id) x where x.reason='missing_data') then raise exception 'Hay leads con datos faltantes';end if;
 if not exists(select 1 from public.campaign_audience(c.id) x where x.reason='eligible' and not exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id and e.contact_id=x.contact_id and e.status not in ('active','paused'))) then raise exception 'No hay destinatarios elegibles';end if;
 for a in select * from public.campaign_audience(c.id) where reason='eligible' loop
  insert into public.campaign_enrollments(campaign_id,contact_id,opportunity_id,next_at)
  values(c.id,a.contact_id,a.opportunity_id,case when kind='schedule_campaign' then (p->>'scheduled_at')::timestamptz else now() end)
  on conflict(campaign_id,contact_id) do update set status='active' where campaign_enrollments.status='paused';
  update public.opportunities set seller_id=c.seller_id,campaign_id=c.id where id=a.opportunity_id;
 end loop;
 update public.campaigns set status='active',activated_at=case when kind='schedule_campaign' then null else coalesce(activated_at,now()) end,scheduled_at=case when kind='schedule_campaign' then (p->>'scheduled_at')::timestamptz else null end where id=c.id;
 r:=jsonb_build_object('id',c.id);
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request_key,kind,r,md5(original::text));
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'campaign',c.id,kind);
 return r;
end $$;
revoke all on function public.crm_command(text,jsonb,uuid) from public,anon;
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated,service_role;

-- Apply the first-contact gate again at the final delivery boundary. Historic
-- campaigns continue through the existing controls without altered sequences.
alter function public.recheck_outbox_delivery(uuid) rename to recheck_outbox_delivery_v42;
revoke all on function public.recheck_outbox_delivery_v42(uuid) from public,anon,authenticated;
create function public.recheck_outbox_delivery(message uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.campaigns;e public.campaign_enrollments;o public.opportunities;m public.outbox;
begin
 if not public.recheck_outbox_delivery_v42(message) then return false;end if;
 select * into m from public.outbox where id=message;
 select * into e from public.campaign_enrollments where id=m.enrollment_id;
 select * into c from public.campaigns where id=e.campaign_id;
 if c.first_contact then
  select * into o from public.opportunities where id=e.opportunity_id;
  if c.scheduled_at>now() then update public.outbox set status='queued',sending_at=null,available_at=c.scheduled_at where id=m.id;return false;end if;
  if e.step<>0 or not e.contact_id=any(c.selected_contact_ids) or o.stage not in ('new','contacting') or o.application_complete or o.last_contact is not null
   or not exists(select 1 from public.leads l where l.contact_id=e.contact_id and l.opportunity_id=o.id)
   or exists(select 1 from public.opportunities x where x.contact_id=e.contact_id and (x.handed_off_at is not null or x.stage not in ('new','contacting') or x.application_complete or x.archived_at is not null)) then
   update public.outbox set status='cancelled' where id=m.id;
   update public.campaign_enrollments set status='goal_met' where id=e.id;return false;
  end if;
 end if;
 return true;
end $$;
revoke all on function public.recheck_outbox_delivery(uuid) from public,anon,authenticated;
grant execute on function public.recheck_outbox_delivery(uuid) to service_role;
create or replace function public.due_campaign_enrollments(application_enabled boolean) returns setof public.campaign_enrollments language plpgsql security definer set search_path='' as $$
begin
 perform public.start_scheduled_campaigns();
 return query select e.* from public.campaign_enrollments e join public.campaigns c on c.id=e.campaign_id
 where e.status='active' and c.status='active' and e.next_at<=now() and (c.scheduled_at is null or c.scheduled_at<=now())
 and (application_enabled or not c.requires_application) and (not c.first_contact or e.step=0)
 and not exists(select 1 from public.outbox o where o.request_key='campaign:'||e.id::text||':'||e.step::text)
 order by e.next_at,e.id limit 100;
end $$;

-- Confirmed means Gmail accepted the initial send. Replies require the same
-- account, recipient, conversation, time window and RFC message relationship.
-- A missing References header can use an unambiguous physical Gmail thread.
create function public.campaign_reply_rows(campaign uuid)
returns table(contact_id uuid,message_id uuid,sent_at timestamptz,email text,opportunity_id uuid)
language plpgsql stable security definer set search_path='' as $$
declare c public.campaigns;
begin
 select * into c from public.campaigns where id=campaign;
 if public.current_app_role() is null or c.id is null or not(public.current_app_role() in ('superadmin','seller_admin') or (public.current_app_role()='seller' and c.seller_id=auth.uid())) then raise exception 'Campaign access required';end if;
 return query select distinct e.contact_id,m.id,m.sent_at,b.to_email,e.opportunity_id
 from public.campaign_enrollments e join lateral(
  select x.* from public.outbox x where x.enrollment_id=e.id and not x.campaign_test
   and (x.request_key='campaign:'||e.id::text||':0' or x.message_id_header='<'||e.id::text||'.0@crm.curated.local>') order by x.created_at,x.id limit 1
 ) b on true
 join public.conversations co on co.id=b.conversation_id and co.account_id=c.account_id
 join public.messages m on m.conversation_id=co.id
 where e.campaign_id=c.id and public.can_area(e.opportunity_id,'seller') and public.can_area(co.opportunity_id,co.area)
 and b.status='sent' and b.gmail_message_id is not null and b.sent_at is not null
 and m.status='received' and public.mail_human_reply(m.direction,m.nature,m.sender)
 and lower(btrim(m.sender))=lower(btrim(b.to_email)) and m.sent_at>=b.sent_at and m.reply_intent is distinct from 'ignored'
 and (regexp_split_to_array(btrim(coalesce(m.references_header,'')),E'\\s+') @> array[b.message_id_header]
  or (coalesce(btrim(m.references_header),'')='' and coalesce(co.gmail_delivery_thread_id,co.gmail_thread_id)=b.gmail_thread_id
   and not exists(select 1 from public.outbox other join public.campaign_enrollments oe on oe.id=other.enrollment_id
    where other.account_id=b.account_id and other.gmail_thread_id=b.gmail_thread_id and oe.campaign_id<>c.id and other.status='sent' and not other.campaign_test)));
end $$;
revoke all on function public.campaign_reply_rows(uuid) from public,anon;
grant execute on function public.campaign_reply_rows(uuid) to authenticated;

create function public.campaign_contact_facts(campaign uuid)
returns table(contact_id uuid,opportunity_id uuid,company text,name text,email text,send_status text,sent_at timestamptz,reply_at timestamptz,last_interaction timestamptz,needs_attention boolean,conversation_id uuid)
language plpgsql stable security definer set search_path='' as $$
declare c public.campaigns;
begin
 select * into c from public.campaigns where id=campaign;
 if public.current_app_role() is null or c.id is null or not(public.current_app_role() in ('superadmin','seller_admin') or (public.current_app_role()='seller' and c.seller_id=auth.uid())) then raise exception 'Campaign access required';end if;
 return query
 with recipients as (
  select e.contact_id,e.opportunity_id,e.id,e.status from public.campaign_enrollments e where e.campaign_id=c.id
  union all
  select l.contact_id,l.opportunity_id,null::uuid,'selected'::text from public.leads l where c.first_contact and l.contact_id=any(c.selected_contact_ids)
  and not exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id and e.contact_id=l.contact_id)
 ), replies as materialized(select rp.contact_id,max(rp.sent_at) at from public.campaign_reply_rows(c.id) rp group by rp.contact_id)
 select ct.id,r.opportunity_id,coalesce(op.company,l.company,''),ct.name,ct.email,
 case when b.status='sent' and b.gmail_message_id is not null and b.sent_at is not null then 'sent'
 when b.status='sent' then 'uncertain'
 when b.status is not null then b.status
 when ct.id=any(c.excluded_contact_ids) or exists(select 1 from public.suppressions s where s.email=ct.email) or ct.verification<>'valid' then 'blocked'
 when c.first_contact and (op.id is null or op.stage not in ('new','contacting') or op.application_complete or op.handed_off_at is not null or op.archived_at is not null) then 'blocked'
 when r.status in ('suppressed','bounced','goal_met') then r.status else 'pending' end,
 case when b.status='sent' and b.gmail_message_id is not null then b.sent_at end,reply.at,
 greatest(b.sent_at,reply.at,co.updated_at),coalesce(reply.at is not null and co.needs_attention
  and reply.at >= coalesce((select max(latest.sent_at) from public.messages latest where latest.conversation_id=co.id
   and public.mail_human_reply(latest.direction,latest.nature,latest.sender) and lower(btrim(latest.sender))=lower(btrim(b.to_email)) and latest.reply_intent is distinct from 'ignored'),reply.at)
  and reply.at >= coalesce((select max(latest.sent_at) from public.messages latest where latest.conversation_id=co.id and latest.direction='outbound' and latest.status='sent'),reply.at),false),co.id
 from recipients r join public.contacts ct on ct.id=r.contact_id
 left join public.opportunities op on op.id=r.opportunity_id left join public.leads l on l.contact_id=ct.id
 left join lateral(select x.* from public.outbox x where x.enrollment_id=r.id and not x.campaign_test
  and (x.request_key='campaign:'||r.id::text||':0' or x.message_id_header='<'||r.id::text||'.0@crm.curated.local>') order by x.created_at,x.id limit 1) b on true
 left join public.conversations co on co.id=b.conversation_id and co.account_id=c.account_id and public.can_area(co.opportunity_id,co.area)
 left join replies reply on reply.contact_id=ct.id
 where (r.opportunity_id is not null and public.can_area(r.opportunity_id,'seller'))
 or (r.opportunity_id is null and l.id is not null and public.can_lead(l.id));
end $$;
revoke all on function public.campaign_contact_facts(uuid) from public,anon;
grant execute on function public.campaign_contact_facts(uuid) to authenticated;
create index campaign_initial_sends on public.outbox(enrollment_id,created_at) where not campaign_test;
create index campaign_reply_lookup on public.messages(conversation_id,sent_at) where direction='inbound';

create function public.campaign_contact_summary(campaign uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enrolled',count(*),'sent',count(*) filter(where send_status='sent'),
 'replied',count(*) filter(where send_status='sent' and reply_at is not null),'unanswered',count(*) filter(where send_status='sent' and reply_at is null),
 'pending',count(*) filter(where send_status in ('pending','queued','sending','paused')),'attention',count(*) filter(where needs_attention),
 'failed',count(*) filter(where send_status='failed'),'uncertain',count(*) filter(where send_status='uncertain'),
 'cancelled',count(*) filter(where send_status='cancelled'),'blocked',count(*) filter(where send_status in ('blocked','suppressed','bounced','goal_met')))
 from public.campaign_contact_facts(campaign)
$$;
revoke all on function public.campaign_contact_summary(uuid) from public,anon;
grant execute on function public.campaign_contact_summary(uuid) to authenticated;

-- Aggregate across ALL authorized campaigns, independently of list pagination.
create function public.campaign_center(search_text text default '',page_number int default 0,status_filter text default 'all') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin','seller') then raise exception 'Seller access required';end if;
 with visible as(select c.* from public.campaigns c where public.current_app_role() in ('superadmin','seller_admin') or c.seller_id=auth.uid()),
 facts as(select f.* from visible c cross join lateral public.campaign_contact_facts(c.id) f)
 select jsonb_build_object('summary',jsonb_build_object('active',(select count(*) from visible where status='active' and (scheduled_at is null or scheduled_at<=now())),
 'sent',(select count(*) from facts where send_status='sent'),'replied',(select count(distinct contact_id) from facts where send_status='sent' and reply_at is not null),
 'unanswered',(select count(distinct contact_id) from facts f where send_status='sent' and reply_at is null and not exists(select 1 from facts r where r.contact_id=f.contact_id and r.reply_at is not null))),
 'total',(select count(*) from visible where name ilike '%'||search_text||'%' and (status_filter='all' or (status_filter='scheduled' and status='active' and scheduled_at>now()) or (status_filter='active' and status='active' and (scheduled_at is null or scheduled_at<=now())) or (status_filter not in ('active','scheduled') and status=status_filter))),
 'campaigns',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('metrics',public.campaign_contact_summary(p.id))) from
 (select * from visible where name ilike '%'||search_text||'%' and (status_filter='all' or (status_filter='scheduled' and status='active' and scheduled_at>now()) or (status_filter='active' and status='active' and (scheduled_at is null or scheduled_at<=now())) or (status_filter not in ('active','scheduled') and status=status_filter)) order by created_at desc,id limit 25 offset greatest(0,page_number)*25) p),'[]')) into result;
 return result;
end $$;
revoke all on function public.campaign_center(text,int,text) from public,anon;
grant execute on function public.campaign_center(text,int,text) to authenticated;

create function public.campaign_contacts_page(campaign uuid,search_text text default '',state_filter text default 'all',page_number int default 0) returns jsonb language sql stable security definer set search_path='' as $$
 with filtered as(select * from public.campaign_contact_facts(campaign) f where
 (f.company||' '||f.name||' '||f.email) ilike '%'||search_text||'%' and
 (state_filter='all' or (state_filter='replied' and reply_at is not null) or (state_filter='unanswered' and send_status='sent' and reply_at is null)
 or (state_filter='pending' and send_status in ('pending','queued','sending','paused')) or (state_filter='attention' and needs_attention)
 or (state_filter='errors' and send_status in ('failed','uncertain','cancelled','blocked','suppressed','bounced','goal_met'))))
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(p) from(select * from filtered order by email,contact_id limit 50 offset greatest(0,page_number)*50) p),'[]'))
$$;
revoke all on function public.campaign_contacts_page(uuid,text,text,int) from public,anon;
grant execute on function public.campaign_contacts_page(uuid,text,text,int) to authenticated;

create function public.campaign_leads_page(template uuid,account uuid,search_text text default '',page_number int default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.email_templates;result jsonb;
begin
 select * into t from public.email_templates where id=template and archived_at is null;
 if t.id is null then raise exception 'Template changed; reload';end if;
 with candidates as(select * from public.first_contact_candidates(t.subject,t.body,account)),
 reasons as(select reason,count(*) total from candidates group by reason)
 select jsonb_build_object('eligible',(select count(*) from candidates where reason='eligible'),
 'excluded',(select count(*) from candidates where reason<>'eligible'),
 'reasons',coalesce((select jsonb_object_agg(reason,total) from reasons),'{}'),
 'total',(select count(*) from candidates where (company||' '||name||' '||email) ilike '%'||search_text||'%'),
 'rows',coalesce((select jsonb_agg(p) from(select * from candidates where (company||' '||name||' '||email) ilike '%'||search_text||'%' order by email,contact_id limit 50 offset greatest(0,page_number)*50) p),'[]')) into result;
 return result;
end $$;
revoke all on function public.campaign_leads_page(uuid,uuid,text,int) from public,anon;
grant execute on function public.campaign_leads_page(uuid,uuid,text,int) to authenticated;

-- Durable lifecycle events; sending and reply evidence stay in existing tables.
create table public.campaign_events(id uuid primary key default gen_random_uuid(),campaign_id uuid not null references public.campaigns,kind text not null,occurred_at timestamptz not null default now(),opportunity_id uuid references public.opportunities,email text not null default '',source_id uuid);
alter table public.campaign_events enable row level security;
create policy campaign_events_read on public.campaign_events for select to authenticated using(exists(select 1 from public.campaigns c where c.id=campaign_id) and (opportunity_id is null or public.can_area(opportunity_id,'seller')));
grant select on public.campaign_events to authenticated;grant all on public.campaign_events to service_role;
insert into public.campaign_events(campaign_id,kind,occurred_at) select id,'created',created_at from public.campaigns;
create function public.record_campaign_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then insert into public.campaign_events(campaign_id,kind) values(new.id,'created');
 elsif old.status is distinct from new.status or (new.status='active' and old.activated_at is null and new.activated_at is not null) then
  insert into public.campaign_events(campaign_id,kind) values(new.id,case when new.status='active' and new.scheduled_at>now() then 'scheduled' else new.status end);
 end if;return new;
end $$;
create trigger campaign_lifecycle after insert or update of status,activated_at on public.campaigns for each row execute function public.record_campaign_lifecycle();
revoke all on function public.record_campaign_lifecycle() from public,anon,authenticated;
create function public.record_campaign_delivery() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.campaign_enrollments;
begin
 if new.campaign_test or new.enrollment_id is null then return new;end if;
 if tg_op='UPDATE' and new.status is not distinct from old.status then return new;end if;
 if new.status in ('sent','failed','uncertain','cancelled') and (new.status<>'sent' or new.gmail_message_id is not null) then
  select * into e from public.campaign_enrollments where id=new.enrollment_id;
  insert into public.campaign_events(campaign_id,kind,opportunity_id,email,source_id,occurred_at)
  values(e.campaign_id,new.status,e.opportunity_id,new.to_email,new.id,case when new.status='sent' then coalesce(new.sent_at,now()) else now() end);
 end if;return new;
end $$;
create trigger campaign_delivery_event after insert or update of status on public.outbox for each row execute function public.record_campaign_delivery();
revoke all on function public.record_campaign_delivery() from public,anon,authenticated;
-- Backfill only dated evidence. Old failures have no trustworthy failure date.
insert into public.campaign_events(campaign_id,kind,opportunity_id,email,source_id,occurred_at)
select e.campaign_id,'sent',e.opportunity_id,b.to_email,b.id,b.sent_at from public.outbox b join public.campaign_enrollments e on e.id=b.enrollment_id
where b.status='sent' and b.gmail_message_id is not null and b.sent_at is not null and not b.campaign_test;
create function public.campaign_activity_page(page_number int default 0) returns jsonb language sql stable security definer set search_path='' as $$
 with visible as(select c.* from public.campaigns c where public.current_app_role() in ('superadmin','seller_admin') or (public.current_app_role()='seller' and c.seller_id=auth.uid())),
 events as(
 select c.id campaign_id,c.name,e.id::text id,e.kind,e.occurred_at,e.email from visible c join public.campaign_events e on e.campaign_id=c.id
 where e.opportunity_id is null or public.can_area(e.opportunity_id,'seller')
 union all
 select c.id,c.name,'reply:'||f.message_id::text,'replied',f.sent_at,f.email from visible c cross join lateral public.campaign_reply_rows(c.id) f)
 select jsonb_build_object('total',(select count(*) from events),'rows',coalesce((select jsonb_agg(p) from(select * from events order by occurred_at desc,id limit 50 offset greatest(0,page_number)*50) p),'[]'))
$$;
revoke all on function public.campaign_activity_page(int) from public,anon;
grant execute on function public.campaign_activity_page(int) to authenticated;

create function public.start_scheduled_campaigns() returns void language sql security definer set search_path='' as $$
 update public.campaigns set activated_at=now() where first_contact and status='active' and scheduled_at<=now() and activated_at is null
$$;
revoke all on function public.start_scheduled_campaigns() from public,anon,authenticated;
grant execute on function public.start_scheduled_campaigns() to service_role;

-- SELECT * in an existing view does not automatically include added columns.
create or replace view public.campaign_workspace with(security_invoker=true) as
select c.id,c.name,c.account_id,c.seller_id,c.created_by,c.status,c.daily_limit,c.timezone,c.start_hour,c.end_hour,c.subject,c.body,c.steps,c.batch_id,c.created_at,
c.template_id,c.template_version,c.requires_application,c.asset_snapshot,c.body_format,c.excluded_contact_ids,
(select count(*)::int from public.campaign_enrollments e where e.campaign_id=c.id) audience_count,public.campaign_delivery_stats(c.id) delivery_stats,
c.first_contact,c.selected_contact_ids,c.scheduled_at,c.activated_at from public.campaigns c;
notify pgrst,'reload schema';
commit;
