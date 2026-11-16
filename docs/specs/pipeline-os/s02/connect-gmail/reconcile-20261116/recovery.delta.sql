begin;
set local statement_timeout='15s';
set local lock_timeout='3s';
create schema composio_recovery;
revoke all on schema composio_recovery from public,anon,authenticated,service_role;
create table composio_recovery.runs(
 id uuid primary key,source_id uuid not null unique references composio_connect.attempts,
 request_key uuid not null,actor_id uuid not null references public.profiles,authority jsonb not null,
 source_revision bigint not null,source_snapshot jsonb not null,
 state text not null check(state in('verifying','failed','completed')),
 created_at timestamptz not null default clock_timestamp(),deadline timestamptz not null,
 reserved_at timestamptz,not_before timestamptz,admitted_at timestamptz,
 child_id uuid unique references composio_connect.attempts deferrable initially deferred,
 state_hash text not null,capability_hash text not null,
 check(deadline>created_at and deadline<=created_at+interval '10 minutes'),
 check(state_hash ~ '^[a-f0-9]{64}$' and capability_hash ~ '^[a-f0-9]{64}$'),
 unique(actor_id,request_key)
);
alter table composio_recovery.runs enable row level security;
revoke all on composio_recovery.runs from public,anon,authenticated,service_role;

create function composio_recovery.guard(r composio_recovery.runs) returns void
language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;d jsonb;h mail_quota.head;
begin
 if composio_connect.live_actor(r.actor_id,r.authority->>'session_hash') is distinct from (r.authority->>'authorization_revision')::bigint
 then raise exception 'CONNECT_STALE';end if;
 if r.deadline<=clock_timestamp() or composio_connect_runtime.session_limit(r.actor_id,r.authority->>'session_hash')<=clock_timestamp()
 then raise exception 'CONNECT_CLOSED';end if;
 select * into a from composio_connect.attempts where id=r.source_id;
 if a.revision<>r.source_revision or a.actor_id<>r.actor_id or a.actor_revision<>(r.authority->>'authorization_revision')::bigint
 or a.state<>'expired' or a.connection_id is null or a.observation_digest is not null or a.result_binding_id is not null
 then raise exception 'CONNECT_STALE';end if;
 if exists(select 1 from composio_connect.attempts x where x.subject_id=a.subject_id and x.id<>a.id and
 (x.created_at>=a.created_at or x.state in('prepared','identity_ready','awaiting_brand','ready_to_register','uncertain')))
 then raise exception 'CONNECT_CONFLICT';end if;
 perform 1 from composio_connect.configuration where id=1 for share;
 perform 1 from public.operating_brands where id=a.brand_id for share;
 perform 1 from public.mail_accounts m join composio_connect.subjects s on s.account_id=m.id where s.id=a.subject_id for share of m;
 perform 1 from public.mail_provider_binding_heads bh join composio_connect.subjects s on s.reserved_account_id=bh.account_id where s.id=a.subject_id for share of bh;
 perform composio_connect_runtime.live_context(a.id,false);
 select descriptor into d from composio_connect_runtime.runtime where attempt_id=a.id;
 if d#>'{context,contract_version}' is distinct from '2'::jsonb then raise exception 'CONNECT_UNAVAILABLE';end if;
 select * into h from mail_quota.head where id=1 for share;
 if h.closed or h.policy_id is distinct from (d#>>'{context,policy,policy_id}')::uuid
 or h.generation is distinct from (d#>>'{context,policy,generation}')::bigint
 or not exists(select 1 from mail_quota.policies p where p.policy_id=h.policy_id and p.generation=h.generation and p.policy=d#>'{context,policy}' and p.policy->>'state'='enabled')
 then raise exception 'CONNECT_STALE';end if;
end$$;

create function public.composio_connect_recovery_list() returns jsonb
language plpgsql security definer set search_path='' as $$
declare human jsonb:=composio_connect.human();result jsonb;
begin
 select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb) into result from (
 select a.created_at,jsonb_build_object('source_id',a.id,'source_revision',a.revision,'email',s.email,
 'created_at',a.created_at,'state',coalesce(r.state,'available'),
 'child_id',case when r.authority->>'session_hash'=human->>'session_hash' and r.deadline>clock_timestamp() then r.child_id else null end,
 'request_key',case when r.authority->>'session_hash'=human->>'session_hash' then r.request_key else null end,
 'deadline_ms',case when r.authority->>'session_hash'=human->>'session_hash' then floor(extract(epoch from r.deadline)*1000)::bigint else null end) row_data
 from composio_connect.attempts a join composio_connect.subjects s on s.id=a.subject_id
 left join composio_recovery.runs r on r.source_id=a.id
 where a.actor_id=(human->>'actor')::uuid and a.deadline<=clock_timestamp() and a.connection_id is not null
 and a.observation_digest is null and a.result_binding_id is null and a.state in('prepared','expired')
 and not exists(select 1 from composio_connect.attempts x where x.subject_id=a.subject_id and x.id<>a.id and x.created_at>=a.created_at and x.id is distinct from r.child_id)
 order by a.created_at desc limit 20) q;
 return result;
end$$;

create function public.composio_connect_recovery_authorize(operation text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h jsonb:=composio_connect.human();a composio_connect.attempts;t_id uuid:=gen_random_uuid();proof text:=gen_random_uuid()::text||gen_random_uuid()::text;
 authority jsonb:=p->'authority';limit_at timestamptz;
begin
 if operation not in('begin','check','reserve','admit','finish','fail') or operation is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>32768
 then raise exception 'CONNECT_INVALID_INPUT';end if;
 if authority->>'actor_id' is distinct from h->>'actor' or authority->>'session_hash' is distinct from h->>'session_hash'
 or authority->>'authorization_revision' is distinct from h->>'actor_revision' or coalesce(authority->>'browser_hash','') !~ '^[a-f0-9]{64}$'
 then raise exception 'CONNECT_FORBIDDEN';end if;
 select * into a from composio_connect.attempts where id=(p->>'source_id')::uuid;
 if a.id is null or a.actor_id::text is distinct from h->>'actor' then raise exception 'CONNECT_FORBIDDEN';end if;
 limit_at:=least(clock_timestamp()+interval '10 seconds',to_timestamp((auth.jwt()->>'exp')::numeric),composio_connect_runtime.session_limit(a.actor_id,h->>'session_hash'));
 if limit_at<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
 insert into composio_connect_runtime.tickets values(t_id,composio_connect.digest(proof),a.actor_id,h->>'session_hash',(h->>'actor_revision')::bigint,
 'recovery:'||operation,composio_connect.digest(p::text),limit_at,false);
 return jsonb_build_object('id',t_id,'proof',proof);
end$$;

create function public.composio_connect_recovery_execute(operation text,p jsonb,ticket jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t composio_connect_runtime.tickets;r composio_recovery.runs;a composio_connect.attempts;s composio_connect.subjects;
 source_runtime composio_connect_runtime.runtime;child composio_connect.attempts;d jsonb;ctx text;started timestamptz;
 l jsonb;used bigint;group_at timestamptz;account_at timestamptz;start_at timestamptz;identity jsonb:=p->'identity';
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 if operation not in('begin','check','reserve','admit','finish','fail') or operation is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>32768
 then raise exception 'CONNECT_INVALID_INPUT';end if;
 select * into t from composio_connect_runtime.tickets where id=(ticket->>'id')::uuid for update;
 if t.id is null or t.used or t.expires_at<=clock_timestamp() or t.operation is distinct from 'recovery:'||operation
 or t.proof_hash is distinct from composio_connect.digest(ticket->>'proof') or t.payload_hash is distinct from composio_connect.digest(p::text)
 or t.actor_id::text is distinct from p#>>'{authority,actor_id}' or t.session_hash is distinct from p#>>'{authority,session_hash}'
 or t.actor_revision::text is distinct from p#>>'{authority,authorization_revision}'
 then raise exception 'CONNECT_FORBIDDEN';end if;
 if composio_connect.live_actor(t.actor_id,t.session_hash)<>t.actor_revision then raise exception 'CONNECT_STALE';end if;
 update composio_connect_runtime.tickets set used=true where id=t.id;
 select * into a from composio_connect.attempts where id=(p->>'source_id')::uuid;
 if a.id is null or a.actor_id<>t.actor_id then raise exception 'CONNECT_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(19681110,2);
 perform 1 from composio_connect.subjects where id=a.subject_id for update;
 select * into a from composio_connect.attempts where id=a.id for update;
 select * into r from composio_recovery.runs where source_id=a.id for update;
 if t.expires_at<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
 if operation='begin' then
  if r.id is not null then
   if r.request_key is distinct from (p->>'request_key')::uuid or r.id is distinct from (p->>'id')::uuid or r.authority is distinct from p->'authority'
   or (p->>'expected_revision')::bigint is distinct from (r.source_snapshot->>'revision')::bigint
   or r.state_hash is distinct from p->>'state_hash' or r.capability_hash is distinct from p->>'capability_hash'
   then raise exception 'CONNECT_CONFLICT';end if;
   if r.state<>'completed' then raise exception 'CONNECT_NEEDS_RECONCILIATION';end if;
  else
   if a.revision is distinct from (p->>'expected_revision')::bigint then raise exception 'CONNECT_STALE';end if;
   select * into source_runtime from composio_connect_runtime.runtime where attempt_id=a.id for update;
   if a.deadline>clock_timestamp() or a.state not in('prepared','expired') or source_runtime.state not in('awaiting_consent','expired')
   or source_runtime.phase_id is not null or a.connection_id is null or a.observation_digest is not null or a.result_binding_id is not null
   then raise exception 'CONNECT_NOT_READY';end if;
   if coalesce(p->>'state_hash','') !~ '^[a-f0-9]{64}$' or coalesce(p->>'capability_hash','') !~ '^[a-f0-9]{64}$'
   then raise exception 'CONNECT_INVALID_INPUT';end if;
   started:=clock_timestamp();
   insert into composio_recovery.runs(id,source_id,request_key,actor_id,authority,source_revision,source_snapshot,state,created_at,deadline,state_hash,capability_hash)
   values((p->>'id')::uuid,a.id,(p->>'request_key')::uuid,t.actor_id,p->'authority',a.revision,
   jsonb_build_object('state',a.state,'revision',a.revision,'deadline',a.deadline,'created_at',a.created_at,'runtime_state',source_runtime.state),
   'verifying',started,least(started+interval '10 minutes',composio_connect_runtime.session_limit(t.actor_id,t.session_hash)),p->>'state_hash',p->>'capability_hash') returning * into r;
   if a.state<>'expired' then
    update composio_connect.attempts set state='expired',revision=revision+1,cleanup_required=true where id=a.id returning * into a;
    update composio_connect_runtime.runtime set state='expired',phase_id=null,state_ciphertext=null,navigation_ciphertext=null,navigation_expires_ms=null where attempt_id=a.id;
    update composio_recovery.runs set source_revision=a.revision where id=r.id returning * into r;
   end if;
   perform composio_recovery.guard(r);
  end if;
 else
  if r.id is null or r.id is distinct from (p->>'id')::uuid or r.request_key is distinct from (p->>'request_key')::uuid
  or r.authority is distinct from p->'authority' then raise exception 'CONNECT_FORBIDDEN';end if;
  if r.state<>'verifying' then raise exception 'CONNECT_NEEDS_RECONCILIATION';end if;
  perform composio_recovery.guard(r);
  if operation='reserve' then
   if r.reserved_at is not null then raise exception 'CONNECT_CONFLICT';end if;
   select * into s from composio_connect.subjects where id=a.subject_id;
   select descriptor into d from composio_connect_runtime.runtime where attempt_id=a.id;l:=d#>'{context,policy,limits}';
   started:=clock_timestamp();perform mail_quota.capture_legacy(started);
   select coalesce(sum(q.units),0) into used from mail_quota.usage q where q.minute>=started-interval '24 hours 1 minute';
   if used+1>(l->>'group_units_per_window')::bigint then raise exception 'CONNECT_UNAVAILABLE';end if;
   select next_at into group_at from mail_quota.slot where scope='gmail:crm:shared';
   select next_at into account_at from public.gmail_api_slots where scope='account:'||s.reserved_account_id::text;
   start_at:=greatest(clock_timestamp(),group_at,account_at);
   if start_at>=r.deadline or start_at>=clock_timestamp()+interval '10 seconds' then raise exception 'CONNECT_NOT_READY';end if;
   insert into mail_quota.usage as q values(date_trunc('minute',started),1) on conflict(minute) do update set units=q.units+1;
   insert into mail_quota.slot as q values('gmail:crm:shared',start_at+interval '1 minute'/(l->>'group_units_per_minute')::bigint) on conflict(scope) do update set next_at=excluded.next_at;
   insert into public.gmail_api_slots as q values('account:'||s.reserved_account_id::text,start_at+interval '1 minute'/(l->>'account_units_per_minute')::bigint) on conflict(scope) do update set next_at=excluded.next_at;
   update composio_recovery.runs set reserved_at=started,not_before=start_at where id=r.id returning * into r;
  elsif operation='admit' then
   if r.reserved_at is null or r.admitted_at is not null or clock_timestamp()<r.not_before then raise exception 'CONNECT_NOT_READY';end if;
   update composio_recovery.runs set admitted_at=clock_timestamp() where id=r.id returning * into r;
  elsif operation='fail' then
   update composio_recovery.runs set state='failed' where id=r.id returning * into r;
  elsif operation='finish' then
   select * into s from composio_connect.subjects where id=a.subject_id;
   if r.admitted_at is null or identity->>'connected_account_id' is distinct from a.connection_id
   or identity->>'project_id' is distinct from a.project_id or identity->>'auth_config_id' is distinct from a.auth_config_id
   or identity->>'owner_id' is distinct from a.owner_id or lower(identity->>'primary_email') is distinct from s.email
   or identity->>'toolkit' is distinct from 'gmail' or identity->'active' is distinct from 'true'::jsonb
   then raise exception 'CONNECT_IDENTITY_MISMATCH';end if;
   select descriptor into d from composio_connect_runtime.runtime where attempt_id=a.id;
   ctx:=composio_connect.digest(jsonb_build_array(d,s.id,t.actor_id,t.session_hash,t.actor_revision,a.brand_id,a.brand_revision,a.account_revision,a.head_revision)::text);
   insert into composio_connect.attempts(id,subject_id,actor_id,session_hash,actor_revision,browser_hash,state_hash,capability_hash,config_generation,
   project_id,auth_config_id,quota_project_id,owner_id,brand_id,brand_revision,account_revision,head_revision,created_at,deadline,connection_id,observation_digest)
   values(r.id,s.id,t.actor_id,t.session_hash,t.actor_revision,r.authority->>'browser_hash',r.state_hash,r.capability_hash,a.config_generation,
   a.project_id,a.auth_config_id,a.quota_project_id,a.owner_id,a.brand_id,a.brand_revision,a.account_revision,a.head_revision,r.created_at,r.deadline,a.connection_id,composio_connect.digest(identity::text)) returning * into child;
   insert into composio_connect_runtime.runtime(attempt_id,state,context_hash,descriptor) values(child.id,'prepared',ctx,d);
   perform composio_connect_runtime.materialize(child.id);
   perform composio_connect_runtime.live_context(child.id,false);
   update composio_recovery.runs set state='completed',child_id=child.id where id=r.id returning * into r;
  end if;
 end if;
 if t.expires_at<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
 select * into s from composio_connect.subjects where id=a.subject_id;
 select descriptor into d from composio_connect_runtime.runtime where attempt_id=a.id;
 return jsonb_build_object('id',r.id,'state',r.state,'child_id',r.child_id,'deadline_ms',floor(extract(epoch from r.deadline)*1000)::bigint,
 'wait_ms',case when r.not_before is null then 0 else greatest(0,ceil(extract(epoch from(r.not_before-clock_timestamp()))*1000)::bigint) end,
 'descriptor',d,'connection_id',a.connection_id,'expected_email',s.email);
end$$;

revoke all on function composio_recovery.guard(composio_recovery.runs) from public,anon,authenticated,service_role;
revoke all on function public.composio_connect_recovery_list(),public.composio_connect_recovery_authorize(text,jsonb),public.composio_connect_recovery_execute(text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.composio_connect_recovery_list(),public.composio_connect_recovery_authorize(text,jsonb) to authenticated;
grant execute on function public.composio_connect_recovery_execute(text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
