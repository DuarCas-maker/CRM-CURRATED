-- Additive candidate. Apply only to the authorized isolated local database.
begin;
set local lock_timeout='3s';
create schema simple_mail;
revoke all on schema simple_mail from public,anon,authenticated,service_role;
create table simple_mail.function_sources(signature text primary key,definition text not null);
alter table simple_mail.function_sources enable row level security;
revoke all on simple_mail.function_sources from public,anon,authenticated,service_role;
-- 052 clones this function under another name. Qualify its parameter with the
-- actual function name so request_key still resolves on native PostgreSQL.
do $$declare body text;definition text;begin
 select prosrc into body from pg_proc where oid='mail_runtime.command_v1(uuid,text,jsonb,uuid)'::regprocedure;
 if md5(replace(body,E'\r\n',E'\n')) is distinct from 'c2c3178219832b68d64bb85d22e39276' then raise exception 'SIMPLE_ROUTING_BASE_DRIFT';end if;
 definition:=pg_get_functiondef('mail_runtime.command_v1(uuid,text,jsonb,uuid)'::regprocedure);
 insert into simple_mail.function_sources values('mail_runtime.command_v1(uuid,text,jsonb,uuid)',definition);
 execute replace(definition,'mail_transport_command.request_key','command_v1.request_key');
end$$;
create table simple_mail.onboarding(
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.profiles,
 session_id uuid not null, request_key uuid not null, email text not null check(email=lower(btrim(email)) and email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
 provider text not null check(provider in('gmail_oauth','composio')), advisor_id uuid not null references public.profiles,
 organization text not null, domain text not null, brand_id uuid not null references public.operating_brands,
 state_hash text not null unique check(state_hash ~ '^[a-f0-9]{64}$'), encrypted_state text not null,
 account_id uuid references public.mail_accounts, provider_attempt_id uuid,
 state text not null default 'prepared' check(state in('prepared','authorizing','preparing','ready','attention','disconnected')),
 identity_saved boolean not null default false, exchange_started boolean not null default false, error text, created_at timestamptz not null default clock_timestamp(),
 deadline timestamptz not null default clock_timestamp()+interval '10 minutes', unique(actor_id,request_key)
);
create unique index simple_one_pending on simple_mail.onboarding(email,provider) where state in('prepared','authorizing','preparing');
create table simple_mail.health(
 account_id uuid not null references public.mail_accounts,provider text not null check(provider in('gmail_oauth','composio')),
 onboarding_id uuid not null references simple_mail.onboarding,advisor_id uuid not null references public.profiles,
 ready boolean not null default false, revision bigint not null default 1, updated_at timestamptz not null default clock_timestamp(),
 primary key(account_id,provider)
);
create table simple_mail.included(
 id boolean primary key default true check(id), project_id text not null,
 period_start timestamptz not null, period_end timestamptz not null, valid_until timestamptz not null,
 hard_cap_free boolean not null check(hard_cap_free), evidence text not null check(length(evidence) between 1 and 128),
 remaining_calls integer not null check(remaining_calls>=0),remaining_proxy integer not null check(remaining_proxy>=0),
 check(period_start<period_end and valid_until<=period_end)
);
create table simple_mail.usage(
 request_key uuid primary key,account_id uuid references public.mail_accounts, calls integer not null check(calls>0),
 proxy integer not null check(proxy>=0 and proxy<=calls),period_start timestamptz not null,created_at timestamptz not null default clock_timestamp()
);
alter table simple_mail.onboarding enable row level security;
alter table simple_mail.health enable row level security;
alter table simple_mail.included enable row level security;
alter table simple_mail.usage enable row level security;
revoke all on all tables in schema simple_mail from public,anon,authenticated,service_role;
alter table public.mail_accounts add column simple_mail_sync_from timestamptz;
create table simple_mail.sync_initial(account_id uuid primary key references public.mail_accounts,baseline text not null check(baseline ~ '^[0-9]{1,128}$'),page text,done boolean not null default false,updated_at timestamptz not null default clock_timestamp(),check(page is null or length(page) between 1 and 4096));
alter table simple_mail.sync_initial enable row level security;
revoke all on simple_mail.sync_initial from public,anon,authenticated,service_role;

create function simple_mail.human() returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=brand_b1.admin_actor();s uuid;
begin
 s:=(auth.jwt()->>'session_id')::uuid;
 if current_setting('role',true)<>'authenticated' or s is null or coalesce((auth.jwt()->>'exp')::numeric,0)<=extract(epoch from clock_timestamp()) or not exists(select 1 from auth.sessions where id=s and user_id=a and (not_after is null or not_after>clock_timestamp())) then raise exception 'SIMPLE_FORBIDDEN';end if;
 return a;
end$$;
-- Read-only counterpart of the existing context contract: never calls a provider or locks a write path.
create function simple_mail.provider_ready(r simple_mail.onboarding) returns boolean language sql stable set search_path='' as $$
 select case when r.provider='gmail_oauth' then exists(select 1 from public.mail_credentials where account_id=r.account_id)
 else exists(select 1 from public.mail_provider_bindings p join public.mail_provider_binding_heads h on h.current_binding_id=p.id
 join public.mail_accounts m on m.id=p.account_id join public.operating_brands b on b.id=m.operating_brand_id
 where p.account_id=r.account_id and p.status='verified' and composio_c1.approval_current(p,jsonb_build_object(
 'account_id',m.id,'email',lower(btrim(m.email)),'status',m.status,'brand_id',m.operating_brand_id,'brand_name',b.name,
 'brand_revision',b.revision,'account_revision',m.brand_revision,'review_id',(select id from public.mail_account_brand_reviews v where v.account_id=m.id and v.status='confirmed' and v.proposed_brand_id=b.id and v.expected_account_revision=m.brand_revision-1 order by v.created_at desc,v.id limit 1),
 'ready',coalesce(m.status='connected' and b.active and exists(select 1 from public.mail_account_brand_reviews v where v.account_id=m.id and v.status='confirmed' and v.proposed_brand_id=b.id and v.expected_account_revision=m.brand_revision-1),false)))) end
$$;
create function simple_mail.dto(r simple_mail.onboarding) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'email',r.email,'provider',r.provider,'state',case when not r.identity_saved and r.deadline<=clock_timestamp() and r.state not in('ready','disconnected') then 'attention' when r.state='ready' and
 (not exists(select 1 from simple_mail.health h where h.onboarding_id=r.id and h.ready) or not simple_mail.provider_ready(r) or exists(select 1 from public.mail_accounts m where m.id=r.account_id and m.status<>'connected') or not exists(select 1 from public.profiles p where p.id=r.advisor_id and p.active) or not exists(select 1 from public.mail_permissions p where p.account_id=r.account_id and p.user_id=r.advisor_id and p.can_send)) then 'attention' else r.state end,
 'account_id',r.account_id,'advisor_id',r.advisor_id,'error',r.error,
 'last_synced_at',(select last_synced_at from public.gmail_sync_state where account_id=r.account_id),
 'sync_status',case when exists(select 1 from public.gmail_sync_state where account_id=r.account_id and last_error is not null) or exists(select 1 from public.jobs j where j.kind='gmail_sync' and j.payload->>'account_id'=r.account_id::text and j.last_error is not null and j.status in('queued','failed') and j.created_at>coalesce((select last_synced_at from public.gmail_sync_state where account_id=r.account_id),'-infinity'::timestamptz)) then 'attention'
 when exists(select 1 from public.jobs j where j.kind='gmail_sync' and j.payload->>'account_id'=r.account_id::text and j.status='running') then 'syncing'
 when exists(select 1 from public.gmail_sync_state where account_id=r.account_id and last_synced_at is not null) then 'current' else 'pending' end)
$$;
create function simple_mail.owned(id uuid) returns simple_mail.onboarding language plpgsql security definer set search_path='' as $$
declare r simple_mail.onboarding;a uuid:=simple_mail.human();
begin
 select * into r from simple_mail.onboarding x where x.id=owned.id for update;
 if r.id is null or r.actor_id<>a or r.session_id<>(auth.jwt()->>'session_id')::uuid then raise exception 'SIMPLE_FORBIDDEN';end if;
 if not exists(select 1 from public.profiles p where p.id=r.advisor_id and p.active) then raise exception 'SIMPLE_ADVISOR_REQUIRED';end if;
 return r;
end$$;
create function public.simple_mail_options() returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=simple_mail.human();
begin
 return jsonb_build_object('enabled',true,'included_available',exists(select 1 from simple_mail.included where id and hard_cap_free and remaining_calls>0 and remaining_proxy>0 and period_start<=clock_timestamp() and valid_until>clock_timestamp()),'advisors',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email) order by name,id),'[]') from public.profiles where active and role in('seller','seller_admin','closer','closer_admin','superadmin')),
 'direct_account_ids',(select coalesce(jsonb_agg(m.id),'[]') from public.mail_accounts m join public.mail_credentials c on c.account_id=m.id where m.status='connected'),
 'connections',(select coalesce(jsonb_agg(simple_mail.dto(r) order by created_at desc),'[]') from simple_mail.onboarding r where (actor_id=a and session_id=(auth.jwt()->>'session_id')::uuid) or exists(select 1 from simple_mail.health h where h.onboarding_id=r.id)));
end$$;
create function public.simple_mail_begin(p jsonb,state_hash text,encrypted_state text,organization text,domain text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=simple_mail.human();r simple_mail.onboarding;b public.operating_brands;m public.mail_accounts;advisor uuid;cnt integer;recovered uuid;
begin
 if jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) k where k not in('email','provider','advisor_id','idempotency_key'))
 or p->>'provider' not in('gmail_oauth','composio') or p->>'email' is null or p->>'email'<>lower(btrim(p->>'email'))
 or split_part(p->>'email','@',2)<>domain or length(organization) not between 1 and 100 or length(encrypted_state) not between 1 and 8192 then raise exception 'SIMPLE_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended('simple:'||(p->>'email'),0));
 select * into r from simple_mail.onboarding where actor_id=a and request_key=(p->>'idempotency_key')::uuid;
 if r.id is not null then
  if r.email<>p->>'email' or r.provider<>p->>'provider' or (p->>'advisor_id' is not null and r.advisor_id<>(p->>'advisor_id')::uuid) then raise exception 'SIMPLE_CONFLICT';end if;
  r:=simple_mail.owned(r.id);return simple_mail.dto(r);
 end if;
 update simple_mail.onboarding x set state='attention',error='AUTHORIZATION_REQUIRED' where x.actor_id=a and x.email=p->>'email' and x.provider=p->>'provider' and x.state in('prepared','authorizing','preparing') and not x.identity_saved and x.deadline<=clock_timestamp();
 select * into r from simple_mail.onboarding x where x.actor_id=a and x.email=p->>'email' and x.provider=p->>'provider' and x.state in('prepared','authorizing','preparing') for update;
 if r.id is not null then
  if p->>'advisor_id' is not null and r.advisor_id<>(p->>'advisor_id')::uuid then raise exception 'SIMPLE_CONFLICT';end if;
  if r.identity_saved then
   update simple_mail.onboarding set session_id=(auth.jwt()->>'session_id')::uuid,deadline=clock_timestamp()+interval '10 minutes' where id=r.id returning * into r;
   return simple_mail.dto(simple_mail.owned(r.id));
  elsif r.session_id=(auth.jwt()->>'session_id')::uuid then return simple_mail.dto(simple_mail.owned(r.id));
  else update simple_mail.onboarding set state='attention',error='AUTHORIZATION_REQUIRED' where id=r.id;end if;
 end if;
 select count(*),min(id::text)::uuid into cnt,advisor from public.profiles where active and lower(email)=p->>'email' and role in('seller','seller_admin','closer','closer_admin','superadmin');
 if cnt<>1 then advisor:=(p->>'advisor_id')::uuid;end if;
 if advisor is null or not exists(select 1 from public.profiles where id=advisor and active and role in('seller','seller_admin','closer','closer_admin','superadmin')) then raise exception 'SIMPLE_ADVISOR_REQUIRED';end if;
 select * into b from public.operating_brands where code='CURATED_FINANCIAL' and active for share;
 if b.id is null then raise exception 'SIMPLE_NOT_CONFIGURED';end if;
 select * into m from public.mail_accounts where email=p->>'email' for update;
 if m.id is not null and (m.organization<>organization or (m.operating_brand_id is not null and m.operating_brand_id<>b.id)) then raise exception 'SIMPLE_CONFLICT';end if;
 insert into simple_mail.onboarding(actor_id,session_id,request_key,email,provider,advisor_id,organization,domain,brand_id,state_hash,encrypted_state,account_id)
 values(a,(auth.jwt()->>'session_id')::uuid,(p->>'idempotency_key')::uuid,p->>'email',p->>'provider',advisor,organization,domain,b.id,simple_mail_begin.state_hash,simple_mail_begin.encrypted_state,m.id) returning * into r;
 if r.provider='gmail_oauth' then
  perform public.brand_oauth_begin(r.state_hash,r.organization,jsonb_build_object('mode',case when m.id is null then 'new' else 'reconnect' end,'brand_id',b.id,'expected_brand_revision',b.revision,'account_id',m.id,'expected_account_revision',m.brand_revision));
  update public.oauth_states set expected_mailbox_email=r.email where oauth_states.state_hash=r.state_hash;
 elsif m.id is not null then
  select x.id into recovered from composio_connect.attempts x join composio_connect.subjects s on s.id=x.subject_id
  join public.mail_provider_binding_heads h on h.account_id=s.account_id join public.mail_provider_bindings p on p.id=h.current_binding_id
  where s.account_id=m.id and x.actor_id=a and s.email=r.email and x.observation_digest is not null and x.connection_id=p.connected_account_id
  and p.expected_mailbox_email=r.email and p.status in('candidate','verified') and x.brand_id=r.brand_id
  order by x.created_at desc limit 1;
  if recovered is not null then
   update simple_mail.onboarding set provider_attempt_id=recovered,identity_saved=true,state='preparing' where id=r.id returning * into r;
  end if;
 end if;
 return simple_mail.dto(r);
end$$;
create function public.simple_mail_private(id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SIMPLE_FORBIDDEN';end if;
 return (select to_jsonb(r) from simple_mail.onboarding r where r.id=simple_mail_private.id);
end$$;
create function public.simple_mail_get(id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin return simple_mail.dto(simple_mail.owned(id));end$$;
create function public.simple_mail_update(id uuid,provider_attempt uuid default null,error_code text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r simple_mail.onboarding:=simple_mail.owned(id);
begin
 if provider_attempt is not null and r.provider_attempt_id is not null and r.provider_attempt_id<>provider_attempt then raise exception 'SIMPLE_CONFLICT';end if;
 if r.state='ready' then return simple_mail.dto(r);end if;
 if r.deadline<=clock_timestamp() then raise exception 'SIMPLE_EXPIRED';end if;
 if error_code is not null and error_code not in('PROVIDER_UNAVAILABLE','INCLUDED_UNAVAILABLE','AUTHORIZATION_REQUIRED') then raise exception 'SIMPLE_INVALID_INPUT';end if;
 update simple_mail.onboarding set provider_attempt_id=coalesce(r.provider_attempt_id,provider_attempt),state=case when error_code is not null then 'attention' else 'authorizing' end,error=error_code where onboarding.id=r.id returning * into r;
 return simple_mail.dto(r);
end$$;
create function public.simple_mail_direct_saved(id uuid,actor uuid,mailbox text,encrypted_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r simple_mail.onboarding;result jsonb;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SIMPLE_FORBIDDEN';end if;
 select * into r from simple_mail.onboarding where onboarding.id=simple_mail_direct_saved.id for update;
 if r.id is null or r.actor_id<>actor or r.provider<>'gmail_oauth' or r.email is distinct from mailbox then raise exception 'SIMPLE_FORBIDDEN';end if;
 if r.identity_saved then return simple_mail.dto(r);end if;
 if not r.exchange_started then raise exception 'SIMPLE_NOT_READY';end if;
 if r.deadline<=clock_timestamp() or not exists(select 1 from auth.sessions where sessions.id=r.session_id and user_id=r.actor_id and (not_after is null or not_after>clock_timestamp())) then raise exception 'SIMPLE_EXPIRED';end if;
 perform public.brand_oauth_claim(r.state_hash,r.actor_id);
 result:=public.brand_oauth_finish(r.state_hash,r.actor_id,mailbox,encrypted_token,false);
 update simple_mail.onboarding set account_id=(result->>'id')::uuid,identity_saved=true,state='preparing' where onboarding.id=r.id returning * into r;
 return simple_mail.dto(r);
end$$;
create function public.simple_mail_confirm(id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r simple_mail.onboarding:=simple_mail.owned(id);m public.mail_accounts;v public.mail_account_brand_reviews;a composio_connect.attempts;s composio_connect.subjects;
begin
 if r.deadline<=clock_timestamp() and not r.identity_saved then raise exception 'SIMPLE_EXPIRED';end if;
 if r.provider='composio' and not r.identity_saved then
  select * into a from composio_connect.attempts where attempts.id=r.provider_attempt_id;
  select * into s from composio_connect.subjects where subjects.id=a.subject_id;
  if a.id is null or a.actor_id<>r.actor_id or a.observation_digest is null or a.connection_id is null or s.email<>r.email or a.brand_id<>r.brand_id or s.account_id is null then raise exception 'SIMPLE_NOT_READY';end if;
  update simple_mail.onboarding set account_id=s.account_id,identity_saved=true,state='preparing' where onboarding.id=r.id returning * into r;
 end if;
 if not r.identity_saved then raise exception 'SIMPLE_NOT_READY';end if;
 select * into m from public.mail_accounts where mail_accounts.id=r.account_id for update;
 if m.email<>r.email or m.organization<>r.organization or (m.operating_brand_id is not null and m.operating_brand_id<>r.brand_id) then raise exception 'SIMPLE_CONFLICT';end if;
 if m.operating_brand_id is null then
  select * into v from public.mail_account_brand_reviews where account_id=m.id and proposed_brand_id=r.brand_id and status='pending' order by created_at desc limit 1;
  if v.id is null then raise exception 'SIMPLE_NOT_READY';end if;
  perform brand_b1.command('brand_mapping_propose',jsonb_build_object('account_id',m.id,'proposed_brand_id',r.brand_id,'expected_account_revision',m.brand_revision,
   'review_id',v.id,'expected_review_revision',v.revision,'evidence_reference','simple-mail:'||r.id::text,'history_approved',true,'history_from',r.created_at-interval '30 days','history_to',r.created_at),gen_random_uuid());
  select * into v from public.mail_account_brand_reviews where mail_account_brand_reviews.id=v.id;
  perform brand_b1.command('brand_mapping_confirm',jsonb_build_object('review_id',v.id,'expected_review_revision',v.revision,'expected_account_revision',m.brand_revision,'acknowledge_conflict',false),gen_random_uuid());
 end if;
 -- Connected here means identity recorded; live/sync and advisor access remain closed until finalize.
 if r.provider='composio' then update public.mail_accounts set status='connected' where mail_accounts.id=m.id and status='disconnected';end if;
 return simple_mail.dto(r);
end$$;
create function public.simple_mail_finalize(id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r simple_mail.onboarding:=simple_mail.owned(id);m public.mail_accounts;membership public.operating_brand_memberships;h public.mail_provider_binding_heads;b public.mail_provider_bindings;
begin
 if r.state='ready' then return simple_mail.dto(r);end if;
 if not r.identity_saved then raise exception 'SIMPLE_NOT_READY';end if;
 select * into m from public.mail_accounts where mail_accounts.id=r.account_id for update;
 if m.email<>r.email or m.operating_brand_id is distinct from r.brand_id or m.status<>'connected' then raise exception 'SIMPLE_CONFLICT';end if;
 if r.provider='gmail_oauth' and not exists(select 1 from public.mail_credentials where account_id=m.id) then raise exception 'SIMPLE_NOT_READY';end if;
 if r.provider='composio' then
  select * into h from public.mail_provider_binding_heads where account_id=m.id;
  select * into b from public.mail_provider_bindings where mail_provider_bindings.id=h.current_binding_id;
  if b.id is null or b.status<>'verified' or b.expected_mailbox_email<>r.email or not composio_c1.approval_current(b,composio_c1.context_locked(m.id,r.actor_id)) then raise exception 'SIMPLE_NOT_READY';end if;
 end if;
 select * into membership from public.operating_brand_memberships where brand_id=r.brand_id and user_id=r.advisor_id;
 if membership.user_id is null or not membership.active then
  perform brand_b1.command('brand_membership_set',jsonb_build_object('brand_id',r.brand_id,'user_id',r.advisor_id,'active',true,'expected_revision',coalesce(membership.revision,0)),gen_random_uuid());
 end if;
 if exists(select 1 from public.mail_permissions p join public.profiles u on u.id=p.user_id where p.account_id=m.id and u.role<>'superadmin' and p.user_id<>r.advisor_id) then raise exception 'SIMPLE_ACCESS_CONFLICT';end if;
 insert into public.mail_permissions(account_id,user_id,can_send) values(m.id,r.advisor_id,true) on conflict(account_id,user_id) do update set can_send=true;
 update public.mail_accounts set live_enabled=true,sync_enabled=true,simple_mail_sync_from=case when not exists(select 1 from public.gmail_archive_messages where account_id=m.id) then coalesce(simple_mail_sync_from,r.created_at-interval '30 days') else simple_mail_sync_from end where mail_accounts.id=m.id;
 insert into mail_runtime.sync_checkpoints(account_id,history_id,last_reconciled_at) select m.id,s.history_id,s.last_synced_at from public.gmail_sync_state s where s.account_id=m.id and s.history_id ~ '^[0-9]{1,128}$' and s.last_synced_at is not null on conflict(account_id) do nothing;
 insert into simple_mail.health(account_id,provider,onboarding_id,advisor_id,ready) values(m.id,r.provider,r.id,r.advisor_id,true)
 on conflict(account_id,provider) do update set onboarding_id=excluded.onboarding_id,advisor_id=excluded.advisor_id,ready=true,revision=health.revision+1,updated_at=clock_timestamp();
 update simple_mail.onboarding set state='ready',error=null where onboarding.id=r.id returning * into r;
 insert into public.jobs(kind,payload,dedupe_key) values('gmail_sync',jsonb_build_object('account_id',m.id),'simple-sync:'||r.id::text) on conflict do nothing;
 return simple_mail.dto(r);
end$$;
create function public.simple_mail_included_reserve(request_key uuid,account uuid,calls integer,proxy integer,project text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare p simple_mail.included;u simple_mail.usage;expected_project text;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SIMPLE_FORBIDDEN';end if;
 if calls is null or calls<=0 or proxy is null or proxy<0 or proxy>calls then raise exception 'SIMPLE_INVALID_INPUT';end if;
 select * into p from simple_mail.included where id for update;
 if p.id is null or p.valid_until<=clock_timestamp() or p.period_start>clock_timestamp() or p.period_end<=clock_timestamp() or not p.hard_cap_free then return false;end if;
 expected_project:=project;
 if expected_project is null and account is not null then
  select b.composio_project_id into expected_project from public.mail_provider_bindings b join public.mail_provider_binding_heads h on h.current_binding_id=b.id where h.account_id=account;
 end if;
 if expected_project is distinct from p.project_id then return false;end if;
 select * into u from simple_mail.usage where usage.request_key=simple_mail_included_reserve.request_key;
 if u.request_key is not null then
  if (u.account_id,u.calls,u.proxy,u.period_start) is distinct from (account,calls,proxy,p.period_start) then raise exception 'SIMPLE_CONFLICT';end if;
  return true;
 end if;
 if p.remaining_calls<calls or p.remaining_proxy<proxy then return false;end if;
 update simple_mail.included set remaining_calls=remaining_calls-calls,remaining_proxy=remaining_proxy-proxy where id;
 insert into simple_mail.usage(request_key,account_id,calls,proxy,period_start) values(request_key,account,calls,proxy,p.period_start);
 return true;
end$$;
revoke all on all functions in schema simple_mail from public,anon,authenticated,service_role;
revoke all on function public.simple_mail_options(),public.simple_mail_begin(jsonb,text,text,text,text),public.simple_mail_get(uuid),public.simple_mail_update(uuid,uuid,text),public.simple_mail_confirm(uuid),public.simple_mail_finalize(uuid),public.simple_mail_private(uuid),public.simple_mail_direct_saved(uuid,uuid,text,text),public.simple_mail_included_reserve(uuid,uuid,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.simple_mail_options(),public.simple_mail_begin(jsonb,text,text,text,text),public.simple_mail_get(uuid),public.simple_mail_update(uuid,uuid,text),public.simple_mail_confirm(uuid),public.simple_mail_finalize(uuid) to authenticated;
grant execute on function public.simple_mail_private(uuid),public.simple_mail_direct_saved(uuid,uuid,text,text),public.simple_mail_included_reserve(uuid,uuid,integer,integer,text) to service_role;
create function public.simple_mail_callback_lookup(digest text) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=simple_mail.human();id uuid;
begin
 select r.id into id from simple_mail.onboarding r where state_hash=digest and actor_id=a and session_id=(auth.jwt()->>'session_id')::uuid and provider='gmail_oauth';
 return id;
end$$;
create function public.simple_mail_candidate(id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r simple_mail.onboarding;b public.mail_provider_bindings;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SIMPLE_FORBIDDEN';end if;
 select * into r from simple_mail.onboarding where onboarding.id=simple_mail_candidate.id;
 select p.* into b from public.mail_provider_bindings p join public.mail_provider_binding_heads h on h.current_binding_id=p.id where h.account_id=r.account_id;
 if not r.identity_saved or b.id is null or b.expected_mailbox_email<>r.email then raise exception 'SIMPLE_NOT_READY';end if;
 return jsonb_build_object('composio_project_id',b.composio_project_id,'auth_config_id',b.auth_config_id,'connected_account_id',b.connected_account_id,'composio_user_id',b.composio_user_id);
end$$;
create function public.simple_mail_included_available() returns boolean language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SIMPLE_FORBIDDEN';end if;
 return exists(select 1 from simple_mail.included where id and hard_cap_free and period_start<=clock_timestamp() and period_end>clock_timestamp() and valid_until>clock_timestamp() and remaining_calls>0 and remaining_proxy>0);
end$$;
create function public.simple_mail_disconnect(id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r simple_mail.onboarding;a uuid:=simple_mail.human();
begin
 select * into r from simple_mail.onboarding x where x.id=simple_mail_disconnect.id for update;
 if r.id is null then raise exception 'SIMPLE_FORBIDDEN';end if;
 if r.state='disconnected' then return simple_mail.dto(r);end if;
 if not exists(select 1 from simple_mail.health h where h.account_id=r.account_id and h.provider=r.provider and h.onboarding_id=r.id for update) then raise exception 'SIMPLE_CONFLICT';end if;
 update simple_mail.health set ready=false,revision=revision+1,updated_at=clock_timestamp() where account_id=r.account_id and provider=r.provider;
 if exists(select 1 from mail_runtime.routes where account_id=r.account_id and provider=r.provider) then
  update mail_runtime.routes set state='paused',revision=revision+1,target_provider=null,pending_head=null,pending_config=null where account_id=r.account_id;
  update public.mail_accounts set live_enabled=false,sync_enabled=false where mail_accounts.id=r.account_id;
 end if;
 update simple_mail.onboarding set state='disconnected' where onboarding.id=r.id returning * into r;
 return simple_mail.dto(r);
end$$;
revoke all on function public.simple_mail_callback_lookup(text),public.simple_mail_candidate(uuid),public.simple_mail_included_available(),public.simple_mail_disconnect(uuid) from public,anon,authenticated,service_role;
grant execute on function public.simple_mail_callback_lookup(text),public.simple_mail_disconnect(uuid) to authenticated;
grant execute on function public.simple_mail_candidate(uuid),public.simple_mail_included_available() to service_role;
create table simple_mail.fallbacks(
 parent_id uuid primary key references mail_runtime.attempts, child_id uuid not null unique references mail_runtime.attempts,
 binding_id uuid not null references public.mail_provider_bindings,binding_revision bigint not null,
 context_hash text not null,config_generation bigint not null,created_at timestamptz not null default clock_timestamp()
);
alter table simple_mail.fallbacks enable row level security;
revoke all on simple_mail.fallbacks from public,anon,authenticated,service_role;
create function simple_mail.backup(account uuid) returns public.mail_provider_bindings language plpgsql security definer set search_path='' as $$
declare b public.mail_provider_bindings;ctx jsonb;
begin
 select p.* into b from public.mail_provider_bindings p join public.mail_provider_binding_heads h on h.current_binding_id=p.id
 join simple_mail.health health on health.account_id=p.account_id and health.provider='composio' and health.ready
 join simple_mail.onboarding r on r.id=health.onboarding_id
 join public.profiles u on u.id=health.advisor_id and u.active
 where p.account_id=account and r.state='ready' and p.status='verified';
 if b.id is null then raise exception 'SIMPLE_NOT_READY';end if;
 ctx:=composio_c1.context_locked(account,b.reviewed_by);
 if not composio_c1.approval_current(b,ctx) then raise exception 'SIMPLE_NOT_READY';end if;
 return b;
end$$;
create function public.simple_mail_backup_ready(account uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SIMPLE_FORBIDDEN';end if;
 perform simple_mail.backup(account);return public.simple_mail_included_available();
exception when sqlstate 'P0001' then return false;
end$$;
create function public.simple_mail_direct_unavailable(account uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SIMPLE_FORBIDDEN';end if;
 update simple_mail.health set ready=false,revision=revision+1,updated_at=clock_timestamp() where account_id=account and provider='gmail_oauth';
end$$;
create function public.simple_mail_fallback_begin(parent uuid,capability text,capability_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p mail_runtime.attempts;t mail_runtime.attempts;b public.mail_provider_bindings;r mail_runtime.routes;cfg mail_quota.binding_contexts;m public.outbox;ctx jsonb;result jsonb;
begin
 p:=mail_runtime.lock_attempt(parent,capability);
 if p.provider<>'gmail_oauth' or p.operation<>'send' or p.state<>'cancelled_before_wire' or p.deadline<=clock_timestamp()
 or capability_hash is null or capability_hash !~ '^[a-f0-9]{64}$' then raise exception 'SIMPLE_NOT_READY';end if;
 ctx:=mail_runtime.context(p.account_id);
 select * into r from mail_runtime.routes where account_id=p.account_id for update;
 select * into m from public.outbox where id=p.resource::uuid for update;
 if r.provider<>'gmail_oauth' or r.revision<>p.route_revision or not mail_runtime.route_current(r,ctx) or m.status<>'sending' or not brand_b2.delivery_allowed(m) or m.brand_admission_id is not null then raise exception 'SIMPLE_NOT_READY';end if;
 b:=simple_mail.backup(p.account_id);
 if not public.simple_mail_included_available() then raise exception 'SIMPLE_INCLUDED_UNAVAILABLE';end if;
 cfg:=mail_quota.binding_config(p.account_id);
 if b.quota_contract_version<>2 then raise exception 'SIMPLE_NOT_READY';end if;
 insert into mail_runtime.attempts(account_id,route_revision,provider,operation,resource,token_hash,deadline)
 values(p.account_id,p.route_revision,'composio','send',p.resource,capability_hash,least(p.deadline,clock_timestamp()+interval '119 seconds')) returning * into t;
 insert into simple_mail.fallbacks(parent_id,child_id,binding_id,binding_revision,context_hash,config_generation) values(p.id,t.id,b.id,b.revision,cfg.digest,cfg.generation);
 result:=jsonb_build_object('ticket',jsonb_build_object('id',t.id,'account_id',t.account_id,'provider','composio','revision',t.route_revision,'operation','send','resource',t.resource,'deadline',t.deadline,
 'binding',jsonb_build_object('accountId',b.account_id,'connectedAccountId',b.connected_account_id,'authConfigId',b.auth_config_id,'userId',b.composio_user_id,'mailboxEmail',b.expected_mailbox_email,'verifiedMailboxEmail',b.expected_mailbox_email,'identityVerified',true,'status','active','revision',b.revision,'quotaContractVersion',2,'quotaProjectId',null,'quotaPolicyId',b.quota_policy_id,'quotaPolicyGeneration',b.quota_policy_generation)),
 'context_hash',cfg.digest,'config_generation',cfg.generation,'project_id',b.composio_project_id);
 return result;
exception when unique_violation then raise exception 'SIMPLE_CONFLICT';
end$$;
create function public.simple_mail_fallback_validate(attempt uuid,capability text,admit boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare t mail_runtime.attempts;f simple_mail.fallbacks;p mail_runtime.attempts;b public.mail_provider_bindings;r mail_runtime.routes;ctx jsonb;cfg mail_quota.binding_contexts;m public.outbox;
begin
 t:=mail_runtime.lock_attempt(attempt,capability);
 select * into f from simple_mail.fallbacks where child_id=t.id;
 select * into p from mail_runtime.attempts where id=f.parent_id for update;
 if f.parent_id is null or p.state<>'cancelled_before_wire' or t.state not in('reserved','admitted') or t.deadline<=clock_timestamp() or t.provider<>'composio' or (admit and t.state<>'reserved') then return false;end if;
 ctx:=mail_runtime.context(t.account_id);select * into r from mail_runtime.routes where account_id=t.account_id;
 b:=simple_mail.backup(t.account_id);cfg:=mail_quota.binding_config(t.account_id);
 select * into m from public.outbox where id=t.resource::uuid for update;
 if r.provider<>'gmail_oauth' or r.revision<>t.route_revision or not mail_runtime.route_current(r,ctx) or b.id<>f.binding_id or b.revision<>f.binding_revision or cfg.digest<>f.context_hash or cfg.generation<>f.config_generation
 or m.status<>'sending' or not brand_b2.delivery_allowed(m) then return false;end if;
 if admit then
  if not exists(select 1 from public.mail_brand_dispatch_admissions ad where ad.id=m.brand_admission_id and ad.outbox_id=m.id and ad.claim_token=m.brand_claim_token and ad.outcome='admitted') then return false;end if;
  update mail_runtime.attempts set state='admitted' where id=t.id;
 end if;
 return true;
end$$;
revoke all on function simple_mail.backup(uuid) from public,anon,authenticated,service_role;
revoke all on function public.simple_mail_backup_ready(uuid),public.simple_mail_direct_unavailable(uuid),public.simple_mail_fallback_begin(uuid,text,text),public.simple_mail_fallback_validate(uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.simple_mail_backup_ready(uuid),public.simple_mail_direct_unavailable(uuid),public.simple_mail_fallback_begin(uuid,text,text),public.simple_mail_fallback_validate(uuid,text,boolean) to service_role;
create function public.simple_mail_find_attempt(attempt uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=simple_mail.human();
begin return (select id from simple_mail.onboarding where provider_attempt_id=attempt and actor_id=a and session_id=(auth.jwt()->>'session_id')::uuid);end$$;
revoke all on function public.simple_mail_find_attempt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.simple_mail_find_attempt(uuid) to authenticated;
create function public.simple_mail_managed(account uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SIMPLE_FORBIDDEN';end if;
 return exists(select 1 from simple_mail.health where account_id=account);
end$$;
revoke all on function public.simple_mail_managed(uuid) from public,anon,authenticated,service_role;
grant execute on function public.simple_mail_managed(uuid) to service_role;
create function public.simple_mail_managed_accounts() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SIMPLE_FORBIDDEN';end if;
 return (select coalesce(jsonb_agg(account_id),'[]') from (select distinct account_id from simple_mail.health) a);
end$$;
revoke all on function public.simple_mail_managed_accounts() from public,anon,authenticated,service_role;
grant execute on function public.simple_mail_managed_accounts() to service_role;
-- Only expired read cycles are abandoned; uncertain receipts remain intact.
-- No outgoing message or transport transition is settled by this function.
create function public.simple_mail_recover_sync(account uuid) returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if not public.simple_mail_managed(account) then raise exception 'SIMPLE_FORBIDDEN';end if;
 perform mail_runtime.context(account);
 perform 1 from mail_runtime.routes where account_id=account for update;
 update mail_runtime.sync_cycles c set state='aborted' where c.account_id=account and c.deadline<=clock_timestamp() and c.state in('active','uncertain')
 and not exists(select 1 from mail_runtime.sync_requests q join mail_runtime.attempts a on a.id=q.attempt_id where q.cycle_id=c.id and a.operation='send');
 get diagnostics affected=row_count;return affected;
end$$;
revoke all on function public.simple_mail_recover_sync(uuid) from public,anon,authenticated,service_role;
grant execute on function public.simple_mail_recover_sync(uuid) to service_role;
create function public.simple_mail_sync_floor(account uuid) returns timestamptz language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SIMPLE_FORBIDDEN';end if;
 return (select simple_mail_sync_from from public.mail_accounts where id=account);
end$$;
revoke all on function public.simple_mail_sync_floor(uuid) from public,anon,authenticated,service_role;
grant execute on function public.simple_mail_sync_floor(uuid) to service_role;
create function public.simple_mail_exchange_begin(id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare r simple_mail.onboarding:=simple_mail.owned(id);
begin
 if r.provider<>'gmail_oauth' or r.deadline<=clock_timestamp() then raise exception 'SIMPLE_EXPIRED';end if;
 if r.identity_saved or r.exchange_started then return false;end if;
 update simple_mail.onboarding set exchange_started=true,state='preparing' where onboarding.id=r.id;
 return true;
end$$;
revoke all on function public.simple_mail_exchange_begin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.simple_mail_exchange_begin(uuid) to authenticated;
create function public.simple_mail_sync_complete(cycle uuid,capability text,checkpoint text) returns void language plpgsql security definer set search_path='' as $$
declare c mail_runtime.sync_cycles;
begin
 c:=mail_runtime.lock_cycle(cycle,capability);
 if not public.simple_mail_managed(c.account_id) then raise exception 'SIMPLE_FORBIDDEN';end if;
 perform public.mail_sync_complete(cycle,capability,checkpoint);
 insert into public.gmail_sync_state(account_id,history_id,last_synced_at,last_error) values(c.account_id,checkpoint,clock_timestamp(),null)
 on conflict(account_id) do update set history_id=excluded.history_id,last_synced_at=excluded.last_synced_at,last_error=null;
end$$;
create function public.simple_mail_initial_begin(cycle uuid,capability text,baseline text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c mail_runtime.sync_cycles;p simple_mail.sync_initial;
begin
 c:=mail_runtime.lock_cycle(cycle,capability);
 if not public.simple_mail_managed(c.account_id) or not public.mail_sync_validate(cycle,capability) or baseline is null or baseline !~ '^[0-9]{1,128}$'
 or not exists(select 1 from public.mail_accounts where id=c.account_id and simple_mail_sync_from is not null)
 or exists(select 1 from mail_runtime.sync_checkpoints where account_id=c.account_id and history_id is not null) then raise exception 'SIMPLE_NOT_READY';end if;
 insert into simple_mail.sync_initial(account_id,baseline) values(c.account_id,baseline) on conflict(account_id) do nothing;
 select * into p from simple_mail.sync_initial where account_id=c.account_id;
 return jsonb_build_object('baseline',p.baseline,'page',p.page,'done',p.done);
end$$;
create function public.simple_mail_initial_advance(cycle uuid,capability text,expected_page text,next_page text) returns void language plpgsql security definer set search_path='' as $$
declare c mail_runtime.sync_cycles;p simple_mail.sync_initial;
begin
 c:=mail_runtime.lock_cycle(cycle,capability);
 if not public.simple_mail_managed(c.account_id) or not public.mail_sync_validate(cycle,capability) then raise exception 'SIMPLE_NOT_READY';end if;
 select * into p from simple_mail.sync_initial where account_id=c.account_id for update;
 if p.account_id is null or p.done or p.page is distinct from expected_page or (next_page is not null and (next_page=expected_page or length(next_page) not between 1 and 4096)) then raise exception 'SIMPLE_CONFLICT';end if;
 update simple_mail.sync_initial set page=next_page,done=next_page is null,updated_at=clock_timestamp() where account_id=c.account_id;
 if next_page is null then perform public.simple_mail_sync_complete(cycle,capability,p.baseline);end if;
end$$;
revoke all on function public.simple_mail_sync_complete(uuid,text,text),public.simple_mail_initial_begin(uuid,text,text),public.simple_mail_initial_advance(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.simple_mail_sync_complete(uuid,text,text),public.simple_mail_initial_begin(uuid,text,text),public.simple_mail_initial_advance(uuid,text,text,text) to service_role;
commit;
