begin;
do $$begin
 if to_regnamespace('brand_b2') is null or to_regprocedure('public.campaign_create_from_import(jsonb,uuid)') is null then raise exception 'CC_BASE_UNAVAILABLE';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.claim_outbox()') and md5(replace(prosrc,E'\r\n',E'\n'))='3e2ec04ecdd70ef745a235483f2d6232') then raise exception 'CC_BASE_CHANGED';end if;
end $$;
create schema campaign_control_v1;
revoke all on schema campaign_control_v1 from public,anon,authenticated,service_role;
create table public.campaign_groups(
 id uuid primary key,name text not null,seller_id uuid not null references public.profiles,created_by uuid not null references public.profiles,
 batch_id uuid references public.import_batches,daily_limit int not null check(daily_limit between 1 and 2000),created_at timestamptz not null default now(),created_via_control boolean not null default false
);
create table public.campaign_group_members(
 group_id uuid not null references public.campaign_groups,campaign_id uuid primary key references public.campaigns,
 account_id uuid not null references public.mail_accounts,unique(group_id,account_id)
);
alter table public.campaign_groups enable row level security;
alter table public.campaign_group_members enable row level security;
revoke all on public.campaign_groups,public.campaign_group_members from public,anon,authenticated,service_role;
grant select on public.campaign_groups,public.campaign_group_members to authenticated;
create policy campaign_group_read on public.campaign_groups for select to authenticated using(public.current_app_role()='superadmin' or (brand_b2.can_campaign(id) and (public.current_app_role()='seller_admin' or (public.current_app_role()='seller' and seller_id=auth.uid()))));
create policy campaign_member_read on public.campaign_group_members for select to authenticated using(exists(select 1 from public.campaign_groups g where g.id=group_id));
-- Metadata only: existing intents, schedules and outbox rows remain untouched.
insert into public.campaign_groups(id,name,seller_id,created_by,batch_id,daily_limit,created_at) select id,name,seller_id,created_by,batch_id,daily_limit,created_at from public.campaigns;
insert into public.campaign_group_members select id,id,account_id from public.campaigns;

-- Keep campaigns created through the classic CRM visible after the initial backfill.
create function campaign_control_v1.track_classic() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and current_setting('pipeline_os.campaign_control_create',true) is distinct from '1' then
  insert into public.campaign_groups(id,name,seller_id,created_by,batch_id,daily_limit,created_at) values(new.id,new.name,new.seller_id,new.created_by,new.batch_id,new.daily_limit,new.created_at);
  insert into public.campaign_group_members values(new.id,new.id,new.account_id);
 elsif tg_op='UPDATE' then
  update public.campaign_groups set name=new.name,seller_id=new.seller_id,batch_id=new.batch_id,daily_limit=new.daily_limit where id=new.id and not created_via_control;
 end if;
 return new;
end $$;
create trigger campaign_control_classic_insert after insert on public.campaigns for each row execute function campaign_control_v1.track_classic();
create trigger campaign_control_classic_update after update of name,seller_id,batch_id,daily_limit on public.campaigns for each row execute function campaign_control_v1.track_classic();

create function campaign_control_v1.access(group_id uuid,manage boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(public.current_app_role()='superadmin' or (brand_b2.can_campaign(group_id) and (public.current_app_role()='seller_admin' or (not manage and public.current_app_role()='seller' and exists(select 1 from public.campaign_groups g where g.id=group_id and g.seller_id=auth.uid())))),false)
$$;
create function campaign_control_v1.contacts(batch uuid default null)
returns table(contact_id uuid,name text,email text,company text,classification text,verification text,state text,reason_code text,retryable boolean,suppressed boolean)
language sql stable security definer set search_path='' as $$
 select c.id,c.name,c.email,coalesce(l.company,''),
 case when c.verification in ('valid','invalid','uncertain') then c.verification when v.state in ('technical_error','uncertain_request','review') then 'review' else 'pending' end,
 c.verification::text,v.state,case when v.reason ~ '^provider_http_[0-9]{3}$' then v.reason end,
 c.verification='pending' and (v.state is null or v.state in ('completed','technical_error')) and not exists(select 1 from public.suppressions s where s.email=c.email),
 exists(select 1 from public.suppressions s where s.email=c.email)
 from public.contacts c join lateral(select ld.company from public.leads ld where ld.contact_id=c.id and public.can_lead(ld.id) order by ld.id limit 1) l on true
 left join lateral(select x.state,x.reason from public.verifications x where x.contact_id=c.id order by x.created_at desc,x.id desc limit 1) v on true
 where public.current_app_role() in ('superadmin','seller_admin','seller') and (batch is null or exists(select 1 from public.import_rows r where r.batch_id=batch and r.contact_id=c.id))
$$;
create function campaign_control_v1.facts(group_id uuid)
returns table(contact_id uuid,opportunity_id uuid,company text,name text,email text,send_status text,sent_at timestamptz,reply_at timestamptz,last_interaction timestamptz,needs_attention boolean,conversation_id uuid,account_id uuid,campaign_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 if not campaign_control_v1.access(group_id) then raise exception 'CC_FORBIDDEN';end if;
 return query select distinct on(f.contact_id) f.*,m.account_id,m.campaign_id
 from public.campaign_group_members m cross join lateral public.campaign_contact_facts(m.campaign_id) f
 where m.group_id=facts.group_id
 order by f.contact_id,(f.send_status='sent') desc,
 exists(select 1 from public.campaign_enrollments e where e.campaign_id=m.campaign_id and e.contact_id=f.contact_id and e.status in ('active','paused')) desc,
 case f.send_status when 'uncertain' then 0 when 'sending' then 1 when 'queued' then 2 when 'pending' then 3 else 4 end,m.campaign_id;
end $$;
create function campaign_control_v1.sender_current(campaign uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(s->>'version'='1' and s->>'purpose'='campaign' and s->>'account_id'=c.account_id::text and s->>'actor_id'=c.created_by::text
 and a.operating_brand_id::text=s->>'brand_id' and a.brand_revision=(s->>'account_revision')::int and b.active and b.revision=(s->>'brand_revision')::int
 and p.active and p.role in ('superadmin','seller_admin') and p.role::text=s->>'actor_role' and p.mail_authorization_revision=(s->>'actor_revision')::int
 and exists(select 1 from public.mail_account_brand_reviews r where r.account_id=a.id and r.proposed_brand_id=b.id and r.status='confirmed' and r.expected_account_revision=a.brand_revision-1)
 and (p.role='superadmin' or (m.active and m.revision=(s->>'membership_revision')::int and perm.can_send and perm.authorization_revision=(s->>'permission_revision')::int)),false)
 from public.campaigns c join public.mail_accounts a on a.id=c.account_id join public.profiles p on p.id=c.created_by
 left join public.operating_brands b on b.id=a.operating_brand_id
 left join public.operating_brand_memberships m on m.brand_id=b.id and m.user_id=p.id
 left join public.mail_permissions perm on perm.account_id=a.id and perm.user_id=p.id
 cross join lateral(select c.brand_snapshot s) snapshot where c.id=campaign
$$;
create function campaign_control_v1.summary(group_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g public.campaign_groups;metrics jsonb;senders jsonb;state text;
begin
 if not campaign_control_v1.access(group_id) then raise exception 'CC_FORBIDDEN';end if;
 select * into g from public.campaign_groups where id=group_id;
 if not found then raise exception 'CC_NOT_FOUND';end if;
 with f as materialized(select * from campaign_control_v1.facts(summary.group_id))
 select jsonb_build_object('enrolled',count(*),'sent',count(*) filter(where send_status='sent'),
 'replied',count(*) filter(where send_status='sent' and reply_at is not null),'unanswered',count(*) filter(where send_status='sent' and reply_at is null),
 'pending',count(*) filter(where send_status in ('pending','queued','sending','paused')),'failed',count(*) filter(where send_status='failed'),
 'uncertain',count(*) filter(where send_status='uncertain'),'blocked',count(*) filter(where send_status in ('blocked','suppressed','goal_met','bounced','cancelled')),
 'attention',count(*) filter(where needs_attention)) into metrics from f;
 with s as(select c.*,a.email,a.status account_status,campaign_control_v1.sender_current(c.id) sender_allowed,
  case when brand_b2.can_sender(a.id) then public.account_delivery_usage(a.id) else '{}'::jsonb end budget,
  brand_b2.can_sender(a.id) can_view_account,
  (select count(*) from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id where e.campaign_id=c.id and not o.campaign_test and o.status in ('sent','sending','uncertain') and coalesce(o.sent_at,o.sending_at)>now()-interval '24 hours') used_24h,
  (select count(*) from campaign_control_v1.facts(summary.group_id) f where f.account_id=a.id and f.send_status in ('pending','queued','sending','paused')) pending
  from public.campaign_group_members m join public.campaigns c on c.id=m.campaign_id join public.mail_accounts a on a.id=m.account_id where m.group_id=summary.group_id)
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
 from public.campaign_group_members m join public.campaigns c on c.id=m.campaign_id where m.group_id=summary.group_id and (cardinality(c.selected_contact_ids)>0 or exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id));
 return to_jsonb(g)||jsonb_build_object('status',coalesce(state,'draft'),'metrics',metrics,'senders',coalesce(senders,'[]'),
  'used_24h',(select count(*) from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id join public.campaign_group_members m on m.campaign_id=e.campaign_id where m.group_id=summary.group_id and not o.campaign_test and o.status in ('sent','sending','uncertain') and coalesce(o.sent_at,o.sending_at)>now()-interval '24 hours'));
end $$;

create function public.campaign_control_read(mode text default 'overview',batch uuid default null,campaign uuid default null,filter text default 'all',search_text text default '',page_number int default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin','seller') then raise exception 'CC_FORBIDDEN';end if;
 if page_number is null or page_number not between 0 and 1000000 or length(coalesce(search_text,''))>200 then raise exception 'CC_INVALID_INPUT';end if;
 if mode='overview' then
  with contacts as materialized(select * from campaign_control_v1.contacts(batch)),
  groups as materialized(select g.id,campaign_control_v1.summary(g.id) data from public.campaign_groups g where campaign_control_v1.access(g.id) and (batch is null or g.batch_id=batch)),
  facts as materialized(select f.* from groups g cross join lateral campaign_control_v1.facts(g.id) f),
  filtered as(select * from groups where data->>'name' ilike '%'||search_text||'%' and (filter='all' or data->>'status'=filter))
  select jsonb_build_object('funnel',(select jsonb_build_object('total',count(*),'valid',count(*) filter(where classification='valid'),'invalid',count(*) filter(where classification='invalid'),'uncertain',count(*) filter(where classification='uncertain'),'pending',count(*) filter(where classification='pending'),'review',count(*) filter(where classification='review'),'running',count(*) filter(where state in ('queued','submitted')),'suppressed',count(*) filter(where suppressed),
   'available',(select count(distinct p.contact_id) from public.campaign_prepared_leads('','',null) p join contacts x on x.contact_id=p.contact_id where p.reason='eligible'),
   'reserved',(select count(*) from contacts x where exists(select 1 from public.campaign_enrollments e where e.contact_id=x.contact_id and e.status in ('active','paused')))) from contacts),
   'summary',jsonb_build_object('campaigns',(select count(*) from groups),'active',(select count(*) from groups where data->>'status'='active'),'scheduled',(select count(*) from groups where data->>'status'='scheduled'),
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
end $$;
revoke all on function public.campaign_control_read(text,uuid,uuid,text,text,int) from public,anon,service_role;
grant execute on function public.campaign_control_read(text,uuid,uuid,text,text,int) to authenticated;

create function public.campaign_control_command(kind text,p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt public.command_receipts;fingerprint text:=md5(kind||p::text);result jsonb;g public.campaign_groups;child public.campaigns;target public.campaigns;
 s jsonb;ctx jsonb;brand uuid;ids uuid[];part uuid[];v_group_id uuid;child_id uuid;sender_count int;ordinal int;n int;e public.campaign_enrollments;source public.campaigns;contact uuid;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'CC_FORBIDDEN';end if;
 if kind not in ('create','activate','schedule','pause','reassign','exclude','verify') or request_key is null or jsonb_typeof(p)<>'object' then raise exception 'CC_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts r where r.user_id=auth.uid() and r.request_key=campaign_control_command.request_key;
 if found then
  if receipt.kind<>'campaign_control_'||kind or receipt.fingerprint<>fingerprint then raise exception 'CC_KEY_REUSED';end if;
  return receipt.result;
 end if;
 if kind in ('verify','reassign','exclude') then
  if jsonb_typeof(p->'contact_ids')<>'array' or jsonb_array_length(p->'contact_ids') not between 1 and 5000 then raise exception 'CC_INVALID_INPUT';end if;
  ids:=array(select distinct value::uuid from jsonb_array_elements_text(p->'contact_ids') order by value::uuid);
  if cardinality(ids)<>jsonb_array_length(p->'contact_ids') or cardinality(ids) is distinct from (p->>'expected_count')::int then raise exception 'CC_STALE';end if;
 end if;
 if kind='verify' then
  perform 1 from public.contacts c where c.id=any(ids) order by c.id for update;
  if (select count(*) from campaign_control_v1.contacts((p->>'batch')::uuid) x where x.contact_id=any(ids) and x.retryable)<>cardinality(ids)
   or (exists(select 1 from campaign_control_v1.contacts((p->>'batch')::uuid) x where x.contact_id=any(ids) and x.state='technical_error') and not coalesce((p->>'cause_resolved')::boolean,false)) then raise exception 'CC_STALE';end if;
  result:=public.crm_command('verify_contacts',jsonb_build_object('contact_ids',to_jsonb(ids)),request_key);
  if (result->>'queued')::int is distinct from cardinality(ids) then raise exception 'CC_STALE';end if;
 elsif kind='create' then
  if jsonb_typeof(p->'senders')<>'array' or jsonb_array_length(p->'senders') not between 1 and 20 or (p->>'daily_limit')::int not between 1 and 2000 then raise exception 'CC_INVALID_INPUT';end if;
  sender_count:=jsonb_array_length(p->'senders');
  if (select count(distinct value->>'account_id') from jsonb_array_elements(p->'senders'))<>sender_count then raise exception 'CC_INVALID_INPUT';end if;
  for s in select value from jsonb_array_elements(p->'senders') order by value->>'account_id' loop
   if (s->>'daily_limit')::int not between 1 and 2000 then raise exception 'CC_INVALID_INPUT';end if;
   ctx:=public.brand_prepare_context((s->>'account_id')::uuid,s->'brand_preparation','campaign');
   if brand is null then brand:=(ctx->>'brand_id')::uuid;elsif brand is distinct from (ctx->>'brand_id')::uuid then raise exception 'CC_MIXED_BRAND';end if;
  end loop;
  if p ? 'selected_contact_ids' then
   if jsonb_typeof(p->'selected_contact_ids')<>'array' then raise exception 'CC_INVALID_INPUT';end if;
   ids:=array(select distinct value::uuid from jsonb_array_elements_text(p->'selected_contact_ids') order by value::uuid);
   if cardinality(ids)<>jsonb_array_length(p->'selected_contact_ids') then raise exception 'CC_STALE';end if;
  else
   ids:=array(select a.contact_id from public.first_contact_candidates(p->>'subject',p->>'body',(p->'senders'->0->>'account_id')::uuid) a
    join public.campaign_import_contact_rows((p->>'import_batch_id')::uuid) b on b.contact_id=a.contact_id where a.reason='eligible' order by a.contact_id limit 5001);
  end if;
  if cardinality(ids)>5000 then raise exception 'CC_SELECTION_LIMIT';end if;
  ordinal:=0;
  perform set_config('pipeline_os.campaign_control_create','1',true);
  for s in select value from jsonb_array_elements(p->'senders') loop
   part:=array(select id from unnest(ids) with ordinality x(id,i) where (i-1)%sender_count=ordinal order by id);
   result:=public.campaign_create_from_import((p-'senders')||jsonb_build_object('account_id',s->>'account_id','daily_limit',(s->>'daily_limit')::int,'brand_preparation',s->'brand_preparation','selected_contact_ids',to_jsonb(part)),md5(request_key::text||(s->>'account_id'))::uuid);
   child_id:=(result->>'id')::uuid;
   if v_group_id is null then
    v_group_id:=child_id;
    insert into public.campaign_groups(id,name,seller_id,created_by,batch_id,daily_limit,created_via_control) values(v_group_id,p->>'name',(p->>'seller_id')::uuid,auth.uid(),(p->>'import_batch_id')::uuid,(p->>'daily_limit')::int,true);
   end if;
   insert into public.campaign_group_members values(v_group_id,child_id,(s->>'account_id')::uuid);
   ordinal:=ordinal+1;
  end loop;
  perform set_config('pipeline_os.campaign_control_create','',true);
  result:=jsonb_build_object('id',v_group_id,'selected',cardinality(ids),'senders',sender_count);
 else
  v_group_id:=(p->>'id')::uuid;
  if not campaign_control_v1.access(v_group_id,true) then raise exception 'CC_FORBIDDEN';end if;
  if kind in ('activate','schedule') then
   if jsonb_typeof(p->'senders')<>'array' or (select count(*) from public.campaign_group_members m where m.group_id=v_group_id)<>jsonb_array_length(p->'senders') then raise exception 'CC_STALE';end if;
   for s in select value from jsonb_array_elements(p->'senders') order by value->>'account_id' loop
    if not exists(select 1 from public.campaign_group_members m where m.group_id=v_group_id and m.account_id=(s->>'account_id')::uuid) then raise exception 'CC_STALE';end if;
    perform public.brand_prepare_context((s->>'account_id')::uuid,s->'brand_preparation','campaign');
   end loop;
  elsif kind='reassign' then
   select c.* into target from public.campaign_group_members m join public.campaigns c on c.id=m.campaign_id where m.group_id=v_group_id and m.account_id=(p->>'target_account_id')::uuid;
   if target.id is null then raise exception 'CC_STALE';end if;
   perform public.brand_prepare_context(target.account_id,p->'target_preparation','campaign');
   if not brand_b2.validate_snapshot(target.brand_snapshot,target.account_id,target.created_by,'campaign') then raise exception 'CC_STALE';end if;
  end if;
  -- Lock sender accounts before the group so concurrent claims cannot cross a reassignment.
  perform 1 from public.mail_accounts a where a.id in(select m.account_id from public.campaign_group_members m where m.group_id=v_group_id) order by a.id for update;
  select * into g from public.campaign_groups where id=v_group_id for update;
  if not found then raise exception 'CC_NOT_FOUND';end if;
  if kind in ('activate','schedule','pause') then
   if kind='schedule' and ((p->>'scheduled_at')::timestamptz is null or (p->>'scheduled_at')::timestamptz<=now()) then raise exception 'CC_INVALID_INPUT';end if;
   for child in select c.* from public.campaign_group_members m join public.campaigns c on c.id=m.campaign_id where m.group_id=v_group_id order by c.account_id loop
    if kind<>'pause' and cardinality(child.selected_contact_ids)=0 and not exists(select 1 from public.campaign_enrollments en where en.campaign_id=child.id) then continue;end if;
    select value into s from jsonb_array_elements(coalesce(p->'senders','[]')) where value->>'account_id'=child.account_id::text;
    perform public.crm_command(case kind when 'activate' then 'activate_campaign' when 'schedule' then 'schedule_campaign' else 'pause_campaign' end,
     jsonb_build_object('id',child.id,'brand_preparation',s->'brand_preparation','scheduled_at',p->>'scheduled_at'),md5(request_key::text||child.id::text||kind)::uuid);
   end loop;
  else
   perform 1 from public.contacts c where c.id=any(ids) order by c.id for update;
   perform 1 from public.campaign_enrollments en join public.campaign_group_members m on m.campaign_id=en.campaign_id where m.group_id=v_group_id and en.contact_id=any(ids) order by en.id for update of en;
   perform 1 from public.outbox o join public.campaign_enrollments en on en.id=o.enrollment_id join public.campaign_group_members m on m.campaign_id=en.campaign_id where m.group_id=v_group_id and en.contact_id=any(ids) order by o.id for update of o;
   if (select count(*) from campaign_control_v1.facts(v_group_id) f where f.contact_id=any(ids) and f.send_status in ('pending','queued','paused'))<>cardinality(ids)
    or exists(select 1 from public.outbox o join public.campaign_enrollments en on en.id=o.enrollment_id join public.campaign_group_members m on m.campaign_id=en.campaign_id where m.group_id=v_group_id and en.contact_id=any(ids) and (o.status in ('sent','sending','uncertain') or o.brand_admission_id is not null)) then raise exception 'CC_STALE';end if;
   for contact in select unnest(ids) loop
    select en.* into e from public.campaign_enrollments en join public.campaign_group_members m on m.campaign_id=en.campaign_id where m.group_id=v_group_id and en.contact_id=contact and en.status in ('active','paused') order by en.id limit 1;
    if kind='reassign' and e.id is not null and e.campaign_id=target.id then raise exception 'CC_STALE';end if;
    if kind='reassign' and e.id is not null and exists(select 1 from public.campaign_enrollments en where en.campaign_id=target.id and en.contact_id=contact) then raise exception 'CC_TARGET_HISTORY';end if;
    update public.outbox o set status='cancelled',last_error=case kind when 'reassign' then 'CC_REASSIGNED' else 'CC_EXCLUDED' end where o.enrollment_id=e.id and o.status in ('queued','paused');
    update public.campaign_enrollments set status=case kind when 'reassign' then 'completed' else 'suppressed' end where id=e.id;
    for source in select c.* from public.campaign_group_members m join public.campaigns c on c.id=m.campaign_id where m.group_id=v_group_id and (contact=any(c.selected_contact_ids) or c.id=target.id) loop
     perform set_config('pipeline_os.brand_context',source.brand_snapshot::text,true);
     if kind='reassign' and source.id=target.id then
      update public.campaigns set selected_contact_ids=array(select distinct x from unnest(selected_contact_ids||array[contact]) x order by x),excluded_contact_ids=array_remove(excluded_contact_ids,contact) where id=source.id;
     else
      update public.campaigns set selected_contact_ids=array_remove(selected_contact_ids,contact),excluded_contact_ids=array(select distinct x from unnest(excluded_contact_ids||array[contact]) x order by x) where id=source.id;
     end if;
    end loop;
    perform set_config('pipeline_os.brand_context','',true);
    if kind='reassign' and e.id is not null then
     insert into public.campaign_enrollments(campaign_id,contact_id,opportunity_id,status,next_at) values(target.id,contact,e.opportunity_id,'active',greatest(now(),coalesce(target.scheduled_at,now())));
     update public.opportunities set campaign_id=target.id where id=e.opportunity_id;
    end if;
   end loop;
  end if;
  result:=jsonb_build_object('id',v_group_id,'ok',true,'changed',coalesce(cardinality(ids),0));
 end if;
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values(auth.uid(),request_key,'campaign_control_'||kind,fingerprint,result)
 on conflict on constraint command_receipts_pkey do update set kind=excluded.kind,fingerprint=excluded.fingerprint,result=excluded.result;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'campaign',v_group_id,'campaign_control_'||kind,jsonb_build_object('count',coalesce(cardinality(ids),0)));
 return result;
end $$;
revoke all on function public.campaign_control_command(text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.campaign_control_command(text,jsonb,uuid) to authenticated;

-- Preserve the installed implementation and every brand/provider admission gate.
alter function public.claim_outbox() set schema campaign_control_v1;
revoke all on function campaign_control_v1.claim_outbox() from public,anon,authenticated,service_role;
create function public.claim_outbox() returns setof public.outbox
language plpgsql security definer set search_path='' as $$
declare msg public.outbox;g public.campaign_groups;used int;release_at timestamptz;
begin
 select * into msg from campaign_control_v1.claim_outbox();
 if msg.id is null then return;end if;
 select x.* into g from public.campaign_groups x join public.campaign_group_members m on m.group_id=x.id join public.campaign_enrollments e on e.campaign_id=m.campaign_id where e.id=msg.enrollment_id for update of x;
 if g.id is null then return next msg;return;end if;
 select count(*),min(coalesce(o.sent_at,o.sending_at)+interval '24 hours 1 second') filter(where o.id<>msg.id) into used,release_at
 from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id join public.campaign_group_members m on m.campaign_id=e.campaign_id
 where m.group_id=g.id and not o.campaign_test and o.status in ('sent','sending','uncertain') and coalesce(o.sent_at,o.sending_at)>now()-interval '24 hours';
 if used<=g.daily_limit then return next msg;return;end if;
 if msg.brand_admission_id is not null then raise exception 'CC_ADMISSION_CONFLICT';end if;
 release_at:=greatest(now()+interval '1 minute',coalesce(release_at,now()+interval '1 hour'));
 update public.outbox set status='queued',sending_at=null,brand_claim_token=null,send_attempts=greatest(0,send_attempts-1),available_at=greatest(available_at,release_at),last_error='CC_GROUP_LIMIT' where id=msg.id;
 -- Do not wait for another claimant's row while holding the group lock.
 with locked as(select o.id from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id join public.campaign_group_members m on m.campaign_id=e.campaign_id where m.group_id=g.id and o.status='queued' for update of o skip locked)
 update public.outbox o set available_at=greatest(o.available_at,release_at),last_error='CC_GROUP_LIMIT' from locked x where x.id=o.id;
 return;
end $$;
revoke all on function public.claim_outbox() from public,anon,authenticated;
grant execute on function public.claim_outbox() to service_role;
revoke all on all functions in schema campaign_control_v1 from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
