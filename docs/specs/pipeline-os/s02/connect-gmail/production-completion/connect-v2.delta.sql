-- Candidate only; no ordinal reserved and no remote execution by preparing this file.
-- Extend the existing 050/052 installation. Never install a laboratory schema here.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$ begin
 if to_regclass('composio_connect.configuration') is null
 or to_regclass('composio_connect_runtime.contexts') is null
 or to_regclass('mail_quota.head') is null
 or to_regprocedure('composio_connect_runtime.live_context(uuid,boolean)') is null
 or to_regprocedure('composio_connect_runtime.session_limit(uuid,text)') is null
 then raise exception 'CONNECT_V2_BASE_REQUIRED';end if;
 if (select md5(regexp_replace(prosrc,chr(13)||chr(10)||'?',chr(10),'g')) from pg_proc where oid='composio_connect.register_candidate(composio_connect.attempts,composio_connect.subjects)'::regprocedure) is distinct from '4e6f2fc6b54e364548436af5922b21ac'
 then raise exception 'CONNECT_V2_REGISTRATION_BASE_DRIFT';end if;
 if to_regclass('composio_connect.profile_reservations') is not null then raise exception 'CONNECT_V2_ALREADY_INSTALLED';end if;
end $guard$;

alter table composio_connect.configuration alter column quota_project_id drop not null;
alter table composio_connect.attempts alter column quota_project_id drop not null;
create table composio_connect.profile_reservations(
 phase_id uuid primary key references composio_connect_runtime.phases(id) on delete restrict,
 attempt_id uuid not null references composio_connect.attempts(id) on delete restrict,
 policy_id uuid not null,generation bigint not null,
 input jsonb not null,result jsonb not null,
 not_before timestamptz not null,deadline timestamptz not null,
 admitted_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 foreign key(policy_id,generation) references mail_quota.policies(policy_id,generation) on delete restrict,
 check(deadline>created_at and not_before<deadline)
);
alter table composio_connect.profile_reservations enable row level security;
revoke all on composio_connect.profile_reservations from public,anon,authenticated,service_role;

create function public.composio_connect_v2_publish(descriptor jsonb,max_age_seconds integer,inactivity_seconds integer,expected_generation bigint)
returns void language plpgsql security definer set search_path='' as $$
declare g bigint;c composio_connect.configuration;h mail_quota.head;p jsonb;v_key text;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 if jsonb_typeof(descriptor) is distinct from 'object'
 or jsonb_typeof(descriptor->'config') is distinct from 'object'
 or jsonb_typeof(descriptor->'context') is distinct from 'object'
 or exists(select 1 from jsonb_object_keys(descriptor) k where k not in('enabled','config','context','callback_origin'))
 or exists(select 1 from jsonb_object_keys(descriptor->'config') k where k not in('generation','project_id','auth_config_id','quota_project_id','owner_id','callback_mode'))
 or exists(select 1 from jsonb_object_keys(descriptor->'context') k where k not in('contract_version','composio_project_id','credential_version','auth_config_revision','provenance_reference','project_provenance','policy'))
 or descriptor->'enabled' is distinct from 'true'::jsonb
 or descriptor#>'{context,contract_version}' is distinct from '2'::jsonb
 or descriptor#>'{config,quota_project_id}' is distinct from 'null'::jsonb
 or descriptor#>>'{config,callback_mode}' is distinct from 'standard'
 or descriptor#>>'{context,project_provenance}' is distinct from 'server_reviewed'
 or descriptor#>>'{config,project_id}' is distinct from descriptor#>>'{context,composio_project_id}'
 or coalesce(descriptor#>>'{config,project_id}','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
 or coalesce(descriptor#>>'{config,auth_config_id}','') !~ '^ac_[A-Za-z0-9_-]{1,128}$'
 or length(coalesce(descriptor#>>'{config,owner_id}','')) not between 1 and 1024
 or coalesce(descriptor#>>'{config,owner_id}','') ~ '[[:space:]]'
 or coalesce(descriptor->>'callback_origin','') !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'
 or max_age_seconds is null or max_age_seconds<0 or inactivity_seconds is null or inactivity_seconds<0
 then raise exception 'CONNECT_INVALID_INPUT';end if;
 g:=(descriptor#>>'{config,generation}')::bigint;
 if g is null or g not between 1 and 9007199254740991 or expected_generation is null or expected_generation<0 or g<>expected_generation+1
 then raise exception 'CONNECT_INVALID_INPUT';end if;
 foreach v_key in array array['credential_version','auth_config_revision','provenance_reference'] loop
  if jsonb_typeof(descriptor#>array['context',v_key]) is distinct from 'string'
  or length(descriptor#>>array['context',v_key]) not between 1 and 128
  or (descriptor#>>array['context',v_key]) ~ '[[:cntrl:]]' then raise exception 'CONNECT_INVALID_INPUT';end if;
 end loop;
 p:=mail_quota.policy(descriptor#>'{context,policy}');
 if p is distinct from descriptor#>'{context,policy}' or p->>'state' is distinct from 'enabled' then raise exception 'CONNECT_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(19681110,2);
 select * into h from mail_quota.head where id=1 for share;
 if h.closed or h.policy_id is distinct from (p->>'policy_id')::uuid or h.generation is distinct from (p->>'generation')::bigint
 or not exists(select 1 from mail_quota.policies q where q.policy_id=h.policy_id and q.generation=h.generation and q.policy=p)
 then raise exception 'CONNECT_UNAVAILABLE';end if;
 select * into c from composio_connect.configuration where id=1 for update;
 if coalesce(c.generation,0)<>expected_generation then raise exception 'CONNECT_STALE';end if;
 insert into composio_connect.configuration(id,generation,project_id,auth_config_id,quota_project_id,policy_reviewed,max_age_seconds,inactivity_seconds)
 values(1,g,descriptor#>>'{config,project_id}',descriptor#>>'{config,auth_config_id}',null,true,max_age_seconds,inactivity_seconds)
 on conflict(id) do update set generation=excluded.generation,project_id=excluded.project_id,auth_config_id=excluded.auth_config_id,
 quota_project_id=null,policy_reviewed=true,max_age_seconds=excluded.max_age_seconds,inactivity_seconds=excluded.inactivity_seconds;
 insert into composio_connect_runtime.contexts(generation,descriptor) values(g,descriptor);
end$$;

create function composio_connect.profile_guard(attempt uuid,authority jsonb) returns composio_connect.attempts
language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;c composio_connect.configuration;h mail_quota.head;d jsonb;v_policy jsonb;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 select * into a from composio_connect.attempts where id=attempt;
 if a.id is null or authority->>'actor_id' is distinct from a.actor_id::text
 or authority->>'session_hash' is distinct from a.session_hash
 or authority->>'authorization_revision' is distinct from a.actor_revision::text
 or authority->>'browser_hash' is distinct from a.browser_hash then raise exception 'CONNECT_FORBIDDEN';end if;
 if composio_connect.live_actor(a.actor_id,a.session_hash)<>a.actor_revision then raise exception 'CONNECT_STALE';end if;
 if a.deadline<=clock_timestamp() or composio_connect_runtime.session_limit(a.actor_id,a.session_hash)<=clock_timestamp()
 then raise exception 'CONNECT_CLOSED';end if;
 select * into c from composio_connect.configuration where id=1 for share;
 if c.generation is distinct from a.config_generation or c.quota_project_id is not null then raise exception 'CONNECT_STALE';end if;
 select descriptor into d from composio_connect_runtime.contexts where generation=a.config_generation;
 if d#>'{context,contract_version}' is distinct from '2'::jsonb then raise exception 'CONNECT_UNAVAILABLE';end if;
 v_policy:=d#>'{context,policy}';
 select * into h from mail_quota.head where id=1 for share;
 if h.closed or h.policy_id is distinct from (v_policy->>'policy_id')::uuid
 or h.generation is distinct from (v_policy->>'generation')::bigint
 or not exists(select 1 from mail_quota.policies p where p.policy_id=h.policy_id and p.generation=h.generation and p.policy=v_policy and p.policy->>'state'='enabled')
 then raise exception 'CONNECT_STALE';end if;
 perform composio_connect_runtime.live_context(attempt,false);
 return a;
end$$;

create function public.composio_connect_policy_current(attempt uuid,authority jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;
begin
 a:=composio_connect.profile_guard(attempt,authority);
 return a.state in('prepared','link_pending','awaiting_consent','identity_checking');
end$$;

create function public.composio_connect_profile_reserve(attempt uuid,phase uuid,authority jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;s composio_connect.subjects;r composio_connect_runtime.runtime;f composio_connect_runtime.phases;
 previous composio_connect.profile_reservations;d jsonb;v_policy jsonb;l jsonb;v_input jsonb;result jsonb;
 at_time timestamptz;start_at timestamptz;group_at timestamptz;account_at timestamptz;minute_at timestamptz;used numeric;wait_ms bigint;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(19681110,2);
 lock table public.gmail_api_slots in share row exclusive mode;
 lock table public.gmail_api_usage in share row exclusive mode;
 a:=composio_connect.profile_guard(attempt,authority);
 select * into a from composio_connect.attempts where id=attempt for update;
 select * into s from composio_connect.subjects where id=a.subject_id;
 select * into r from composio_connect_runtime.runtime where attempt_id=a.id;
 select * into f from composio_connect_runtime.phases where id=phase;
 if r.state is distinct from 'identity_checking' or r.phase_id is distinct from phase or f.attempt_id is distinct from attempt
 or f.kind is distinct from 'identity' or f.residual or f.uncertain or a.connection_id is null
 then raise exception 'CONNECT_NOT_READY';end if;
 select descriptor into d from composio_connect_runtime.contexts where generation=a.config_generation;
 v_policy:=d#>'{context,policy}';l:=v_policy->'limits';
 v_input:=jsonb_build_object('attempt',attempt,'phase',phase,'authority',authority,'policy',v_policy,'deadline',a.deadline);
 select * into previous from composio_connect.profile_reservations where phase_id=phase for update;
 if found then
  if previous.input<>v_input or previous.admitted_at is not null then raise exception 'CONNECT_CONFLICT';end if;
  return previous.result;
 end if;
 at_time:=clock_timestamp();perform mail_quota.capture_legacy(at_time);
 select coalesce(sum(q.units),0) into used from mail_quota.usage q where q.minute>=at_time-interval '24 hours 1 minute';
 if used+1>(l->>'group_units_per_window')::bigint then raise exception 'CONNECT_UNAVAILABLE';end if;
 select next_at into group_at from mail_quota.slot where scope='gmail:crm:shared';
 select next_at into account_at from public.gmail_api_slots where scope='account:'||s.reserved_account_id::text;
 start_at:=greatest(clock_timestamp(),group_at,account_at);
 wait_ms:=greatest(0,ceil(extract(epoch from(start_at-clock_timestamp()))*1000)::bigint);
 if start_at>=a.deadline or wait_ms>600000 then raise exception 'CONNECT_CLOSED';end if;
 minute_at:=date_trunc('minute',at_time);
 insert into mail_quota.usage as q values(minute_at,1) on conflict(minute) do update set units=q.units+1;
 insert into mail_quota.slot as q values('gmail:crm:shared',start_at+interval '1 minute'/(l->>'group_units_per_minute')::bigint)
 on conflict(scope) do update set next_at=excluded.next_at;
 insert into public.gmail_api_slots as q values('account:'||s.reserved_account_id::text,start_at+interval '1 minute'/(l->>'account_units_per_minute')::bigint)
 on conflict(scope) do update set next_at=excluded.next_at;
 result:=jsonb_build_object('reserved',true,'phase_id',phase,'policy_id',v_policy->'policy_id','generation',v_policy->'generation',
 'wait_ms',wait_ms,'deadline_ms',floor(extract(epoch from a.deadline)*1000)::bigint);
 insert into composio_connect.profile_reservations(phase_id,attempt_id,policy_id,generation,input,result,not_before,deadline)
 values(phase,attempt,(v_policy->>'policy_id')::uuid,(v_policy->>'generation')::bigint,v_input,result,start_at,a.deadline);
 return result;
end$$;

create function public.composio_connect_profile_admit(attempt uuid,phase uuid,authority jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;q composio_connect.profile_reservations;r composio_connect_runtime.runtime;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(19681110,2);
 a:=composio_connect.profile_guard(attempt,authority);
 select * into a from composio_connect.attempts where id=attempt for update;
 select * into r from composio_connect_runtime.runtime where attempt_id=attempt;
 select * into q from composio_connect.profile_reservations where phase_id=phase for update;
 if q.phase_id is null or q.attempt_id<>attempt or q.input->'authority' is distinct from authority
 or q.admitted_at is not null or r.state is distinct from 'identity_checking' or r.phase_id is distinct from phase
 or clock_timestamp()<q.not_before or clock_timestamp()>=q.deadline then return false;end if;
 update composio_connect.profile_reservations set admitted_at=clock_timestamp() where phase_id=phase;
 return true;
end$$;

revoke all on function composio_connect.profile_guard(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.composio_connect_v2_publish(jsonb,integer,integer,bigint),public.composio_connect_policy_current(uuid,jsonb),
public.composio_connect_profile_reserve(uuid,uuid,jsonb),public.composio_connect_profile_admit(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.composio_connect_v2_publish(jsonb,integer,integer,bigint),public.composio_connect_policy_current(uuid,jsonb),
public.composio_connect_profile_reserve(uuid,uuid,jsonb),public.composio_connect_profile_admit(uuid,uuid,jsonb) to service_role;
-- The reviewed registration bridge is appended by the deterministic local packager before COMMIT.

-- PACKAGED BRIDGE: preserve v1 and add candidate-only v2 registration.
create or replace function composio_connect.register_candidate(a composio_connect.attempts,s composio_connect.subjects) returns uuid
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;h public.mail_provider_binding_heads;r public.mail_account_brand_reviews;next_revision bigint;new_id uuid;d jsonb;v_policy jsonb;qh mail_quota.head;version integer:=1;
begin
 select descriptor into d from composio_connect_runtime.contexts where generation=a.config_generation;
 if d#>'{context,contract_version}'='2'::jsonb then
  version:=2;v_policy:=d#>'{context,policy}';
  select * into qh from mail_quota.head where id=1 for share;
  if a.quota_project_id is not null or qh.closed or qh.policy_id is distinct from (v_policy->>'policy_id')::uuid
  or qh.generation is distinct from (v_policy->>'generation')::bigint
  or not exists(select 1 from mail_quota.policies p where p.policy_id=qh.policy_id and p.generation=qh.generation and p.policy=v_policy and p.policy->>'state'='enabled')
  then raise exception 'CONNECT_STALE';end if;
 elsif a.quota_project_id is null then raise exception 'CONNECT_UNAVAILABLE';end if;
 ctx:=composio_c1.context_locked(s.account_id,a.actor_id);
 select * into r from public.mail_account_brand_reviews where id=a.review_id;
 if s.account_id is null or ctx->>'status' not in('connected','disconnected') or (ctx->>'brand_id')::uuid is distinct from a.brand_id
 or (ctx->>'account_revision')::bigint is distinct from a.registration_revision or (ctx->>'brand_revision')::bigint is distinct from a.brand_revision
 or (ctx->>'review_id')::uuid is distinct from a.review_id or r.status is distinct from 'confirmed'
 or r.revision is distinct from a.registration_review_revision or ctx->>'email' is distinct from s.email
 then raise exception 'CONNECT_STALE';end if;
 select * into h from public.mail_provider_binding_heads where account_id=s.account_id for update;
 if coalesce(h.revision,0)<>a.head_revision or coalesce(h.revision,0)>=9007199254740991 then raise exception 'CONNECT_STALE';end if;
 next_revision:=coalesce(h.revision,0)+1;
 perform set_config('pipeline_os.c1_command',a.actor_id::text,true);
 if h.account_id is null then insert into public.mail_provider_binding_heads(account_id,updated_by) values(s.account_id,a.actor_id);end if;
 update public.mail_provider_bindings set status='superseded',reason='replaced' where id=h.current_binding_id and status in('candidate','blocked','verified');
 insert into public.mail_provider_bindings(account_id,revision,composio_project_id,auth_config_id,connected_account_id,composio_user_id,google_quota_project_id,expected_mailbox_email,account_context,created_by,quota_contract_version,quota_policy_id,quota_policy_generation)
 values(s.account_id,next_revision,a.project_id,a.auth_config_id,a.connection_id,a.owner_id,a.quota_project_id,s.email,ctx,a.actor_id,version,case when version=2 then (v_policy->>'policy_id')::uuid end,case when version=2 then (v_policy->>'generation')::bigint end) returning id into new_id;
 update public.mail_provider_binding_heads set revision=next_revision,current_binding_id=new_id,updated_by=a.actor_id,updated_at=clock_timestamp() where account_id=s.account_id;
 perform set_config('pipeline_os.c1_command','',true);
 return new_id;
exception when unique_violation then raise exception 'CONNECT_CONFLICT';
end$$;
notify pgrst, 'reload schema';
commit;
