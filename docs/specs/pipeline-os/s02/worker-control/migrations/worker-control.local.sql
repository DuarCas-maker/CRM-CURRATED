-- WC-I01 candidate for isolated tests, NOT a numbered production migration.
do $$begin
 if current_setting('pipeline_os.worker_control_local',true) is distinct from 'in_memory_test' then raise exception 'WORKER_PILOT_TEST_MARKER_REQUIRED';end if;
 if to_regprocedure('brand_b2.claim(boolean)') is null then raise exception 'WORKER_PILOT_BRAND_BASE_REQUIRED';end if;
end$$;
create schema worker_pilot;
revoke all on schema worker_pilot from public,anon,authenticated,service_role;
create table worker_pilot.trials(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.mail_accounts(id) on delete restrict,
 outbox_id uuid not null unique references public.outbox(id) on delete restrict,
 recipient text not null check(length(recipient) between 3 and 254),
 provider text not null check(provider in ('gmail_oauth','composio')),
 created_at timestamptz not null default clock_timestamp(),deadline timestamptz not null,
 closed boolean not null default false,claimed boolean not null default false,
 lease_hash text check(lease_hash ~ '^[a-f0-9]{64}$'),
 gmail_limit integer not null check(gmail_limit between 0 and 100),
 oauth_limit integer not null check(oauth_limit between 0 and 5),
 composio_limit integer not null check(composio_limit between 0 and 100),
 gmail_used integer not null default 0,oauth_used integer not null default 0,composio_used integer not null default 0,
 sends integer not null default 0 check(sends between 0 and 1),
 attempts jsonb not null default '[]'::jsonb check(jsonb_typeof(attempts)='array' and jsonb_array_length(attempts)<=205),
 check(deadline>created_at and deadline<=created_at+interval '15 minutes'),
 check(gmail_used between 0 and gmail_limit and oauth_used between 0 and oauth_limit and composio_used between 0 and composio_limit),
 check((provider='gmail_oauth' and gmail_limit>0 and composio_limit=0) or (provider='composio' and composio_limit>0 and gmail_limit=0 and oauth_limit=0))
);
create unique index worker_pilot_one_open_account on worker_pilot.trials(account_id) where not closed;
alter table worker_pilot.trials enable row level security;
revoke all on worker_pilot.trials from public,anon,authenticated,service_role;

create function public.worker_pilot_prepare(account uuid,message uuid,recipient text,provider text,deadline timestamptz,gmail_limit integer,oauth_limit integer,composio_limit integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare m public.outbox;result uuid;
begin
 select * into m from public.outbox where id=message for update;
 if m.id is null or m.account_id is distinct from account or m.status<>'queued' or m.to_email is distinct from recipient
  or coalesce(cardinality(m.cc_emails),0)>0 or coalesce(cardinality(m.bcc_emails),0)>0
  or m.notification_id is not null or m.enrollment_id is not null or m.campaign_test or m.brand_snapshot is null
 then raise exception 'WORKER_PILOT_MESSAGE_INVALID';end if;
 insert into worker_pilot.trials(account_id,outbox_id,recipient,provider,deadline,gmail_limit,oauth_limit,composio_limit)
 values(account,message,recipient,provider,deadline,gmail_limit,oauth_limit,composio_limit) returning id into result;
 return result;
end$$;

create function worker_pilot.locked(pilot uuid,lease text) returns worker_pilot.trials language plpgsql security definer set search_path='' as $$
declare t worker_pilot.trials;
begin
 select * into t from worker_pilot.trials where id=pilot for update;
 if t.id is null or t.lease_hash is null or lease is null or lease !~ '^[a-f0-9]{64}$'
 or t.lease_hash<>encode(sha256(convert_to(lease,'UTF8')),'hex') then return null;end if;
 if t.closed or t.deadline<=clock_timestamp() then
  update worker_pilot.trials set closed=true where id=t.id;
  update public.outbox set status='paused',last_error='WORKER_PILOT_HELD' where id=t.outbox_id and status='queued';
  return null;
 end if;
 return t;
end$$;
create function public.worker_pilot_acquire(pilot uuid,lease text) returns boolean language plpgsql security definer set search_path='' as $$
declare t worker_pilot.trials;
begin
 if lease is null or lease !~ '^[a-f0-9]{64}$' then return false;end if;
 select * into t from worker_pilot.trials where id=pilot for update;
 if t.id is null or t.closed or t.deadline<=clock_timestamp() or t.lease_hash is not null then return false;end if;
 update worker_pilot.trials set lease_hash=encode(sha256(convert_to(lease,'UTF8')),'hex') where id=pilot;
 return true;
end$$;
create function public.worker_pilot_snapshot(pilot uuid,lease text) returns jsonb language plpgsql security definer set search_path='' as $$
declare t worker_pilot.trials;m public.outbox;
begin
 t:=worker_pilot.locked(pilot,lease);if t.id is null then return null;end if;
 select * into m from public.outbox where id=t.outbox_id;
 return jsonb_build_object('accountId',t.account_id,'outboxId',t.outbox_id,'provider',t.provider,'claimed',t.claimed,'status',m.status,'threadId',m.gmail_thread_id);
end$$;
create function public.worker_pilot_close(pilot uuid,lease text) returns void language plpgsql security definer set search_path='' as $$
declare t worker_pilot.trials;
begin
 select * into t from worker_pilot.trials where id=pilot for update;
 if t.id is null or t.lease_hash is null or t.lease_hash is distinct from encode(sha256(convert_to(coalesce(lease,''),'UTF8')),'hex') then return;end if;
 update worker_pilot.trials set closed=true where id=pilot;
 update public.outbox set status='paused',last_error='WORKER_PILOT_HELD' where id=t.outbox_id and status='queued';
end$$;
-- Operator stop is distinct from possessing the worker's secret lease.
create function public.worker_pilot_revoke(pilot uuid) returns void language plpgsql security definer set search_path='' as $$
declare t worker_pilot.trials;
begin
 select * into t from worker_pilot.trials where id=pilot for update;
 if t.id is null then return;end if;
 update worker_pilot.trials set closed=true where id=pilot;
 update public.outbox set status='paused',last_error='WORKER_PILOT_HELD' where id=t.outbox_id and status='queued';
end$$;

create function public.worker_pilot_request(pilot uuid,lease text,request jsonb,reserve boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare t worker_pilot.trials;m public.outbox;mailbox text;p text;k text;target text;used integer;lim integer;
begin
 t:=worker_pilot.locked(pilot,lease);if t.id is null or reserve is null then return false;end if;
 if jsonb_typeof(request)<>'object' or (select count(*) from jsonb_object_keys(request))<>4
  or exists(select 1 from jsonb_object_keys(request) as x(k) where x.k not in ('account','provider','kind','target'))
  or request->>'account' is distinct from t.account_id::text then return false;end if;
 p:=request->>'provider';k:=request->>'kind';target:=request->>'target';
 select * into m from public.outbox where id=t.outbox_id;
 select email into mailbox from public.mail_accounts where id=t.account_id;
 if m.account_id is distinct from t.account_id or m.to_email is distinct from t.recipient or coalesce(cardinality(m.cc_emails),0)>0 or coalesce(cardinality(m.bcc_emails),0)>0
 or m.enrollment_id is not null or m.notification_id is not null or m.campaign_test then return false;end if;
 if k='oauth' then
  if p<>'oauth' or t.provider<>'gmail_oauth' or target is distinct from t.account_id::text or m.status not in ('sending','sent') then return false;end if;
  if not reserve then return true;end if;
 elsif p is distinct from t.provider then return false;
 elsif k='send' then
  if not t.claimed or m.status<>'sending' or target is distinct from t.outbox_id::text or t.sends>=1 then return false;end if;
 elsif k='signature' then
  if not t.claimed or m.status<>'sending' or target is distinct from mailbox then return false;end if;
 elsif k='thread' then
  if m.status<>'sent' or m.gmail_thread_id is null or target is distinct from m.gmail_thread_id then return false;end if;
 else return false;end if;
 if reserve and k in ('send','signature') and not brand_b2.delivery_allowed(m) then return false;end if;
 if reserve and k='send' and not exists(select 1 from public.mail_brand_dispatch_admissions a where a.id=m.brand_admission_id and a.outbox_id=m.id and a.outcome='admitted') then return false;end if;
 if p='gmail_oauth' then used:=t.gmail_used;lim:=t.gmail_limit;
 elsif p='composio' then used:=t.composio_used;lim:=t.composio_limit;
 elsif p='oauth' then used:=t.oauth_used;lim:=t.oauth_limit;
 else return false;end if;
 if used>=lim then
  update worker_pilot.trials set closed=true where id=pilot;return false;
 end if;
 if reserve then
  update worker_pilot.trials set gmail_used=gmail_used+case when p='gmail_oauth' then 1 else 0 end,
   oauth_used=oauth_used+case when p='oauth' then 1 else 0 end,
   composio_used=composio_used+case when p='composio' then 1 else 0 end,
   sends=sends+case when k='send' then 1 else 0 end,
   attempts=attempts||jsonb_build_array(jsonb_build_object('provider',p,'kind',k,'at',clock_timestamp())) where id=pilot;
 end if;
 return true;
end$$;

create function worker_pilot.hold_message() returns trigger language plpgsql security definer set search_path='' as $$
declare t worker_pilot.trials;lease text;
begin
 if new.status='sending' and old.status is distinct from 'sending' then
  select * into t from worker_pilot.trials where outbox_id=new.id;
  if t.id is not null then
   lease:=current_setting('pipeline_os.worker_pilot_lease',true);
   if t.closed or t.claimed or t.deadline<=clock_timestamp() or t.lease_hash is null or lease is null
     or t.lease_hash is distinct from encode(sha256(convert_to(lease,'UTF8')),'hex') then raise exception 'WORKER_PILOT_MESSAGE_HELD';end if;
  end if;
 end if;
 return new;
end$$;
create trigger worker_pilot_hold before update of status on public.outbox for each row execute function worker_pilot.hold_message();
revoke all on all functions in schema worker_pilot from public,anon,authenticated,service_role;

-- Refuse a different B2 claim contract; reconcile instead of silently forking guards.
do $$begin if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure) is distinct from '0aec6d3a26c490d986324f2f1fc7d50f' then raise exception 'WORKER_PILOT_CLAIM_BASE_MISMATCH';end if;end$$;
create function public.worker_pilot_claim(pilot uuid,lease text) returns setof public.outbox language plpgsql security definer set search_path='' as $$
declare t worker_pilot.trials;notification_only boolean:=false;candidate public.outbox;msg public.outbox;a public.mail_accounts;usage jsonb;c public.campaigns;sent_count integer;
begin
 t:=worker_pilot.locked(pilot,lease);if t.id is null or t.claimed then return;end if;
 perform set_config('pipeline_os.worker_pilot_lease',lease,true);
 for candidate in select selected.* from (select * from public.outbox where id=t.outbox_id and account_id=t.account_id and notification_id is null and enrollment_id is null and not campaign_test and status='queued' and available_at<=now() and (notification_id is not null)=notification_only order by available_at,id limit 30) selected order by selected.brand_snapshot->>'brand_id',selected.account_id,selected.available_at,selected.id loop
  -- context locks brand -> account -> membership/permission/profile/case; no outbox lock yet.
  if not brand_b2.delivery_allowed(candidate) then
   update public.outbox set status='paused',last_error='BRAND_PREPARATION_STALE' where id=candidate.id and status='queued';continue;
  end if;
  select * into msg from public.outbox where id=candidate.id and status='queued' and available_at<=now() for update skip locked;
  if msg.id is null or msg.brand_snapshot is distinct from candidate.brand_snapshot then continue;end if;
  if exists(select 1 from public.mail_brand_dispatch_admissions where outbox_id=msg.id and outcome in ('admitted','uncertain','accepted')) then
   update public.outbox set status='uncertain',last_error='BRAND_RECONCILIATION_REQUIRED' where id=msg.id;continue;
  end if;
  select * into a from public.mail_accounts where id=msg.account_id;
  usage:=public.account_delivery_usage(a.id);
  if a.send_retry_at>now() or (usage->>'total_messages')::int>=a.daily_limit or (usage->>'recipient_count')::int+1+coalesce(cardinality(msg.cc_emails),0)+coalesce(cardinality(msg.bcc_emails),0)>2000
   or exists(select 1 from public.outbox x where x.account_id=a.id and x.sending_at>now()-interval '30 seconds') then
   update public.outbox set available_at=greatest(now()+interval '1 minute',coalesce(a.send_retry_at,now())) where id=msg.id;continue;
  end if;
  if msg.enrollment_id is not null then
   select c0.* into c from public.campaigns c0 join public.campaign_enrollments e on e.campaign_id=c0.id where e.id=msg.enrollment_id;
   select count(*) into sent_count from public.outbox x join public.campaign_enrollments e on e.id=x.enrollment_id where e.campaign_id=c.id and x.status in ('sent','sending','uncertain') and coalesce(x.sent_at,x.sending_at)>now()-interval '24 hours';
   if sent_count>=c.daily_limit or (usage->>'campaign_remaining')::int<=0 then update public.outbox set available_at=now()+interval '1 hour' where id=msg.id;continue;end if;
  end if;
  if msg.opportunity_id is not null and not exists(select 1 from public.opportunities o where o.id=msg.opportunity_id and (o.email_qualified_at is not null or o.historical_approved_at is not null)) then
   update public.outbox set status='paused',last_error='BRAND_PREPARATION_STALE' where id=msg.id;continue;
  end if;
  update public.outbox set status='sending',sending_at=now(),send_attempts=send_attempts+1,brand_claim_token=gen_random_uuid(),brand_admission_id=null where id=msg.id returning * into msg;
  if not public.recheck_outbox_delivery_before_brand_b2(msg.id) then continue;end if;
  update worker_pilot.trials set claimed=true where id=pilot;
  return next msg;return;
 end loop;
end$$;
revoke all on function public.worker_pilot_prepare(uuid,uuid,text,text,timestamptz,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.worker_pilot_prepare(uuid,uuid,text,text,timestamptz,integer,integer,integer) to service_role;
revoke all on function public.worker_pilot_acquire(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.worker_pilot_acquire(uuid,text) to service_role;
revoke all on function public.worker_pilot_snapshot(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.worker_pilot_snapshot(uuid,text) to service_role;
revoke all on function public.worker_pilot_close(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.worker_pilot_close(uuid,text) to service_role;
revoke all on function public.worker_pilot_revoke(uuid) from public,anon,authenticated,service_role;
grant execute on function public.worker_pilot_revoke(uuid) to service_role;
revoke all on function public.worker_pilot_request(uuid,text,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.worker_pilot_request(uuid,text,jsonb,boolean) to service_role;
revoke all on function public.worker_pilot_claim(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.worker_pilot_claim(uuid,text) to service_role;
