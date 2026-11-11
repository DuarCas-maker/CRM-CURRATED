-- QGR-I02: LOCAL CANDIDATE ONLY. No ordinal, provider activation or remote permission.
begin;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout='5s';
do $guard$
begin
 if current_setting('pipeline_os.qgr_local',true) is distinct from 'isolated_test'
 or current_setting('server_version_num')::integer not between 150000 and 159999
 or current_database() !~ '^qgr_i02_[a-z0-9_]+$'
 or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'QGR_LOCAL_ONLY';end if;
 if to_regnamespace('mail_quota') is not null
 or to_regnamespace('mail_runtime') is null
 or to_regclass('public.mail_provider_bindings') is null
 or not exists(select 1 from pg_proc where oid=to_regprocedure('public.reserve_gmail_api(uuid,text,integer)')
 and md5(regexp_replace(prosrc,E'\r\n?',E'\n','g'))='23763ced084ba3d239c07ac62b7a2357')
 then raise exception 'QGR_BASE_MISMATCH';end if;
end $guard$;

create schema mail_quota;
revoke all on schema mail_quota from public,anon,authenticated,service_role;

-- SQL counterpart of I01; returns canonical integers/UUID, never implicit enabled.
create function mail_quota.policy(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text;l jsonb;g jsonb;id uuid;gen numeric;n numeric;out_limits jsonb:='{}';cap bigint;
begin
 if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>8192
 or not value ?& array['contract_version','policy_id','generation','mode','state','limits']
 or value->'contract_version' is distinct from '2'::jsonb
 or value->>'mode' is distinct from 'crm_shared_conservative'
 or value->>'state' is null or value->>'state' not in('disabled','enabled')
 then raise exception 'QGR_POLICY_INVALID';end if;
 for k in select jsonb_object_keys(value) loop
  if k not in('contract_version','policy_id','generation','mode','state','limits','google_project') then raise exception 'QGR_POLICY_INVALID';end if;
 end loop;
 if jsonb_typeof(value->'policy_id') is distinct from 'string'
 or ((value->>'policy_id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 and value->>'policy_id' not in('00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff'))
 or jsonb_typeof(value->'generation') is distinct from 'number' then raise exception 'QGR_POLICY_INVALID';end if;
 id:=(value->>'policy_id')::uuid;gen:=(value->>'generation')::numeric;
 if gen<1 or gen>9007199254740991 or gen<>trunc(gen) then raise exception 'QGR_POLICY_INVALID';end if;
 l:=value->'limits';
 if jsonb_typeof(l) is distinct from 'object' or not l ?& array['group_units_per_minute','account_units_per_minute','group_units_per_window','window_seconds']
 then raise exception 'QGR_POLICY_INVALID';end if;
 for k in select jsonb_object_keys(l) loop
  cap:=case k when 'group_units_per_minute' then 900000 when 'account_units_per_minute' then 4500
   when 'group_units_per_window' then 75000000 when 'window_seconds' then 86460 else null end;
  if cap is null or jsonb_typeof(l->k) is distinct from 'number' then raise exception 'QGR_POLICY_INVALID';end if;
  n:=(l->>k)::numeric;
  if n<>trunc(n) or n<1 or n>cap or (k='window_seconds' and n<>86460) then raise exception 'QGR_POLICY_INVALID';end if;
  out_limits:=out_limits||jsonb_build_object(k,n::bigint);
 end loop;
 if (l->>'account_units_per_minute')::numeric>(l->>'group_units_per_minute')::numeric then raise exception 'QGR_POLICY_INVALID';end if;
 g:=value->'google_project';
 if g is not null and g<>'null'::jsonb then
  if jsonb_typeof(g) is distinct from 'object' or not g ?& array['provenance','project_id']
   or (select count(*) from jsonb_object_keys(g))<>2 then raise exception 'QGR_POLICY_INVALID';end if;
  if g->>'provenance'='unknown' and g->'project_id'='null'::jsonb then null;
  elsif g->>'provenance'='oauth_client_reviewed' and jsonb_typeof(g->'project_id')='string'
   and g->>'project_id' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then null;
  else raise exception 'QGR_POLICY_INVALID';end if;
 end if;
 return (value-'policy_id'-'generation'-'limits')||jsonb_build_object('policy_id',id,'generation',gen::bigint,'limits',out_limits);
end$$;

create table mail_quota.policies(
 policy_id uuid not null,generation bigint not null check(generation between 1 and 9007199254740991),
 policy jsonb not null check(policy=mail_quota.policy(policy)),actor_id uuid not null references public.profiles on delete restrict,
 session_id uuid not null,created_at timestamptz not null default clock_timestamp(),primary key(policy_id,generation),
 check(policy->>'policy_id'=policy_id::text and (policy->>'generation')::bigint=generation)
);
create table mail_quota.head(
 id integer primary key check(id=1),policy_id uuid,generation bigint,closed boolean not null default false,
 foreign key(policy_id,generation) references mail_quota.policies on delete restrict,
 check((policy_id is null)=(generation is null))
);
insert into mail_quota.head(id) values(1);
create table mail_quota.publications(
 actor_id uuid not null references public.profiles on delete restrict,request_key uuid not null,
 input jsonb not null,result jsonb not null,primary key(actor_id,request_key)
);
create table mail_quota.usage(minute timestamptz primary key,units bigint not null check(units>=0));
create table mail_quota.slot(scope text primary key check(scope='gmail:crm:shared'),next_at timestamptz not null);
create table mail_quota.legacy_observed(
 project text not null,minute timestamptz not null,units bigint not null check(units>=0),primary key(project,minute)
);
create table mail_quota.reservations(
 request_key uuid primary key,account_id uuid not null references public.mail_accounts on delete restrict,
 input jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
do $$declare n text;begin
 foreach n in array array['policies','head','publications','usage','slot','legacy_observed','reservations'] loop
  execute format('alter table mail_quota.%I enable row level security',n);
 end loop;
end$$;
revoke all on all tables in schema mail_quota from public,anon,authenticated,service_role;

create function mail_quota.human() returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb:=auth.jwt();actor uuid:=auth.uid();sid uuid;s auth.sessions;p public.profiles;
begin
 if current_setting('role',true)<>'authenticated' or actor is null or j->>'aal' is distinct from 'aal2'
 or jsonb_typeof(j->'exp') is distinct from 'number'
 then raise exception 'QGR_FORBIDDEN';end if;
 begin
  sid:=(j->>'session_id')::uuid;
  if sid is null or j->>'exp' is null or (j->>'exp')::numeric<=extract(epoch from clock_timestamp()) then raise exception 'QGR_FORBIDDEN';end if;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'QGR_FORBIDDEN';end;
 select * into p from public.profiles where id=actor for share;
 select * into s from auth.sessions where id=sid and user_id=actor for share;
 if p.id is null or not p.active or p.role<>'superadmin' or s.id is null
 or (s.not_after is not null and s.not_after<=clock_timestamp()) then raise exception 'QGR_FORBIDDEN';end if;
 return jsonb_build_object('actor',actor,'session',sid);
end$$;

-- Caller already holds common lock then legacy slots/usage table locks.
create function mail_quota.capture_legacy(at_time timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from mail_quota.legacy_observed o left join public.gmail_api_usage u using(project,minute)
  where o.minute>=at_time-interval '24 hours 1 minute' and (u.units is null or u.units<o.units))
 or exists(select 1 from public.gmail_api_usage where minute>=at_time-interval '24 hours 1 minute' and (units<0 or minute>at_time))
 then raise exception 'QGR_LEGACY_REGRESSION';end if;
 insert into mail_quota.usage as q
 select u.minute,sum(u.units-coalesce(o.units,0))::bigint from public.gmail_api_usage u
 left join mail_quota.legacy_observed o using(project,minute)
 where u.minute>=at_time-interval '24 hours 1 minute' group by u.minute
 on conflict(minute) do update set units=q.units+excluded.units;
 insert into mail_quota.legacy_observed as o
 select project,minute,units from public.gmail_api_usage where minute>=at_time-interval '24 hours 1 minute'
 on conflict(project,minute) do update set units=excluded.units;
 insert into mail_quota.slot as s values('gmail:crm:shared',
  greatest(at_time,(select max(next_at) from public.gmail_api_slots where scope like 'project:%')))
 on conflict(scope) do update set next_at=greatest(s.next_at,excluded.next_at);
end$$;

create function public.mail_quota_publish(value jsonb,expected_generation bigint,quiescent boolean,request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jsonb;p jsonb;h mail_quota.head;r mail_quota.publications;v_input jsonb;result jsonb;
begin
 actor:=mail_quota.human();p:=mail_quota.policy(value);
 if request_key is null or expected_generation is null or expected_generation<0 or quiescent is null then raise exception 'QGR_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(19681110,2);
 lock table public.gmail_api_slots in share row exclusive mode;
 lock table public.gmail_api_usage in share row exclusive mode;
 actor:=mail_quota.human();
 select * into h from mail_quota.head where id=1 for update;
 if h.closed then raise exception 'QGR_CLOSED';end if;
 v_input:=jsonb_build_object('policy',p,'expected',expected_generation,'quiescent',quiescent);
 select * into r from mail_quota.publications where actor_id=(actor->>'actor')::uuid and publications.request_key=mail_quota_publish.request_key;
 if r.request_key is not null then
  if r.input<>v_input then raise exception 'QGR_CONFLICT';end if;
  if h.policy_id is distinct from (p->>'policy_id')::uuid or h.generation is distinct from (p->>'generation')::bigint then raise exception 'QGR_STALE';end if;
  return r.result;
 end if;
 if coalesce(h.generation,0)<>expected_generation or (p->>'generation')::bigint<>expected_generation+1
 or (h.policy_id is not null and h.policy_id<>(p->>'policy_id')::uuid) then raise exception 'QGR_STALE';end if;
 if p->>'state'='enabled' then
  if not quiescent or exists(select 1 from public.outbox where status in('sending','uncertain'))
   or exists(select 1 from mail_runtime.attempts where state in('reserved','admitted','uncertain'))
   or exists(select 1 from mail_runtime.sync_cycles where state in('active','uncertain'))
   or exists(select 1 from public.mail_provider_binding_checks where status='prepared')
   or exists(select 1 from public.jobs where status='running')
  then raise exception 'QGR_QUIESCENCE_REQUIRED';end if;
  perform mail_quota.capture_legacy(clock_timestamp());
 end if;
 insert into mail_quota.policies(policy_id,generation,policy,actor_id,session_id)
 values((p->>'policy_id')::uuid,(p->>'generation')::bigint,p,(actor->>'actor')::uuid,(actor->>'session')::uuid);
 update mail_quota.head set policy_id=(p->>'policy_id')::uuid,generation=(p->>'generation')::bigint where id=1;
 result:=jsonb_build_object('policy_id',p->'policy_id','generation',p->'generation','state',p->>'state','group_scope','gmail:crm:shared');
 insert into mail_quota.publications values((actor->>'actor')::uuid,request_key,v_input,result);
 return result;
end$$;

create function public.mail_quota_reserve(account uuid,provider text,units integer,policy_id uuid,generation bigint,
 request_key uuid,deadline timestamptz,direct_project text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h mail_quota.head;p jsonb;l jsonb;r mail_quota.reservations;v_input jsonb;result jsonb;
 at_time timestamptz;start_at timestamptz;group_at timestamptz;account_at timestamptz;project_at timestamptz;
 window_used numeric;wait_ms bigint;minute_at timestamptz;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'QGR_FORBIDDEN';end if;
 if account is null or provider is null or provider not in('gmail_oauth','composio') or units is null or units not between 1 and 1000
 or policy_id is null or generation is null or generation<1 or request_key is null or deadline is null or not isfinite(deadline)
 or deadline<=clock_timestamp() or deadline>clock_timestamp()+interval '10 minutes'
 or (provider='gmail_oauth' and (direct_project is null or direct_project !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'))
 or (provider='composio' and direct_project is not null) then raise exception 'QGR_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(19681110,2);
 lock table public.gmail_api_slots in share row exclusive mode;
 lock table public.gmail_api_usage in share row exclusive mode;
 at_time:=clock_timestamp();
 select * into h from mail_quota.head where id=1 for share;
 if h.closed then raise exception 'QGR_CLOSED';end if;
 if h.policy_id is distinct from policy_id or h.generation is distinct from generation then raise exception 'QGR_STALE';end if;
 select policy into p from mail_quota.policies q where q.policy_id=h.policy_id and q.generation=h.generation;
 if p->>'state' is distinct from 'enabled' then raise exception 'QGR_DISABLED';end if;
 perform 1 from public.mail_accounts a where a.id=account and a.status='connected' for share;
 if not found then raise exception 'QGR_ACCOUNT_UNAVAILABLE';end if;
 if deadline<=clock_timestamp() then raise exception 'QGR_EXPIRED';end if;
 v_input:=jsonb_build_object('account',account,'provider',provider,'units',units,'policy_id',policy_id,'generation',generation,'deadline_epoch',extract(epoch from deadline),'project',direct_project);
 select * into r from mail_quota.reservations where reservations.request_key=mail_quota_reserve.request_key;
 if r.request_key is not null then
  if r.input<>v_input then raise exception 'QGR_CONFLICT';end if;
  return r.result;
 end if;
 perform mail_quota.capture_legacy(at_time);
 l:=p->'limits';
 select coalesce(sum(q.units),0) into window_used from mail_quota.usage q where q.minute>=at_time-interval '24 hours 1 minute';
 if window_used+units>(l->>'group_units_per_window')::bigint
 or (provider='gmail_oauth' and (select coalesce(sum(u.units),0) from public.gmail_api_usage u
  where u.project=direct_project and u.minute>=at_time-interval '24 hours 1 minute')+units>75000000)
 then result:=jsonb_build_object('reserved',false,'reason','window_exhausted','group_scope','gmail:crm:shared');
 else
  select next_at into group_at from mail_quota.slot where scope='gmail:crm:shared';
  select next_at into account_at from public.gmail_api_slots where scope='account:'||account::text;
  if provider='gmail_oauth' then select next_at into project_at from public.gmail_api_slots where scope='project:'||direct_project;end if;
  start_at:=greatest(clock_timestamp(),group_at,account_at,project_at);
  wait_ms:=greatest(0,ceil(extract(epoch from(start_at-clock_timestamp()))*1000)::bigint);
  if start_at>=deadline or wait_ms>600000 then raise exception 'QGR_EXPIRED';end if;
  minute_at:=date_trunc('minute',at_time);
  insert into mail_quota.usage as q values(minute_at,units) on conflict(minute) do update set units=q.units+excluded.units;
  update mail_quota.slot set next_at=start_at+units*interval '1 minute'/(l->>'group_units_per_minute')::bigint where scope='gmail:crm:shared';
  insert into public.gmail_api_slots as s values('account:'||account::text,start_at+units*interval '1 minute'/(l->>'account_units_per_minute')::bigint)
   on conflict(scope) do update set next_at=excluded.next_at;
  if provider='gmail_oauth' then
   insert into public.gmail_api_slots as s values('project:'||direct_project,start_at+units*interval '1 minute'/900000)
    on conflict(scope) do update set next_at=excluded.next_at;
   insert into public.gmail_api_usage as u values(direct_project,minute_at,units)
    on conflict on constraint gmail_api_usage_pkey do update set units=u.units+excluded.units;
   insert into mail_quota.legacy_observed as o values(direct_project,minute_at,units)
    on conflict(project,minute) do update set units=o.units+excluded.units;
  end if;
  result:=jsonb_build_object('reserved',true,'wait_ms',wait_ms,'group_scope','gmail:crm:shared',
   'account_scope','gmail:account:'||account::text,'policy_id',policy_id,'generation',generation);
 end if;
 insert into mail_quota.reservations values(request_key,account,v_input,result,clock_timestamp());
 return result;
end$$;

-- Expand only. Existing callers produce v1; no v2 check/confirmation/runtime is enabled by I02.
alter table public.mail_provider_bindings alter column google_quota_project_id drop not null;
alter table public.mail_provider_bindings
 add column quota_contract_version smallint not null default 1,
 add column quota_policy_id uuid,
 add column quota_policy_generation bigint,
 add constraint binding_quota_policy_fk foreign key(quota_policy_id,quota_policy_generation) references mail_quota.policies on delete restrict,
 add constraint binding_quota_contract_check check(
  (quota_contract_version=1 and google_quota_project_id is not null and quota_policy_id is null and quota_policy_generation is null)
  or (quota_contract_version=2 and google_quota_project_id is null and quota_policy_id is not null and quota_policy_generation is not null and status<>'verified'));
create function mail_quota.binding_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.quota_contract_version,new.quota_policy_id,new.quota_policy_generation)
  is distinct from (old.quota_contract_version,old.quota_policy_id,old.quota_policy_generation) then raise exception 'QGR_BINDING_IMMUTABLE';end if;
 return new;
end$$;
create trigger quota_binding_immutable before update on public.mail_provider_bindings for each row execute function mail_quota.binding_guard();

revoke all on all functions in schema mail_quota from public,anon,authenticated,service_role;
revoke all on function public.mail_quota_publish(jsonb,bigint,boolean,uuid),public.mail_quota_reserve(uuid,text,integer,uuid,bigint,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.mail_quota_publish(jsonb,bigint,boolean,uuid) to authenticated;
grant execute on function public.mail_quota_reserve(uuid,text,integer,uuid,bigint,uuid,timestamptz,text) to service_role;
commit;
