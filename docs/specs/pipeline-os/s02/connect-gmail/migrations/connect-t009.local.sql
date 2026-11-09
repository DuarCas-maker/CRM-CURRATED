-- T-009 disposable local fixture only. No numbered migration, environment or provider caller.
begin;
do $guard$ begin
 if current_setting('pipeline_os.connect_t009_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^f2_connect_[a-f0-9]{12}$' or session_user<>'f2_connect_owner'
 or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'CONNECT_T009_LOCAL_ONLY';end if;
 if to_regclass('composio_connect.attempts') is null then raise exception 'CONNECT_T009_BASE_REQUIRED';end if;
 if exists(select 1 from composio_connect.attempts) then raise exception 'CONNECT_T009_EMPTY_BASE_REQUIRED';end if;
end $guard$;
create schema composio_connect_runtime;
revoke all on schema composio_connect_runtime from public,anon,authenticated,service_role;
create table composio_connect_runtime.contexts(
 generation bigint primary key check(generation between 1 and 9007199254740991),descriptor jsonb not null,
 check(jsonb_typeof(descriptor)='object' and octet_length(descriptor::text)<16384)
);
create table composio_connect_runtime.runtime(
 attempt_id uuid primary key references composio_connect.attempts on delete restrict,
 state text not null check(state in('prepared','link_pending','awaiting_consent','identity_checking','awaiting_brand','ready_to_register','completed','cancelled','expired','rejected','uncertain')),
 context_hash text not null check(context_hash ~ '^[a-f0-9]{64}$'),descriptor jsonb not null,
 phase_id uuid,state_ciphertext text,navigation_ciphertext text,navigation_expires_ms bigint,
 check(state_ciphertext is null or (length(state_ciphertext) between 40 and 12000 and state_ciphertext ~ '^1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')),
 check(navigation_ciphertext is null or (length(navigation_ciphertext) between 40 and 12000 and navigation_ciphertext ~ '^1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')),
 check((navigation_ciphertext is null)=(navigation_expires_ms is null)),
 check(state not in('completed','cancelled','expired','rejected','uncertain') or (phase_id is null and navigation_ciphertext is null and state_ciphertext is null))
);
create table composio_connect_runtime.phases(
 id uuid primary key,attempt_id uuid not null references composio_connect.attempts on delete restrict,
 kind text not null check(kind in('link','identity','registration')),fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 revision bigint not null check(revision between 1 and 9007199254740991),capability_hash text not null check(capability_hash ~ '^[a-f0-9]{64}$'),
 residual boolean not null default false,uncertain boolean not null default false,observed_connection_id text,
 check(observed_connection_id is null or observed_connection_id ~ '^ca_[A-Za-z0-9_-]{1,128}$')
);
alter table composio_connect_runtime.runtime add constraint runtime_phase_fk foreign key(phase_id) references composio_connect_runtime.phases on delete restrict deferrable initially deferred;
create table composio_connect_runtime.receipts(
 actor_id uuid not null references public.profiles,request_key uuid not null,attempt_id uuid not null references composio_connect.attempts,
 command text not null check(command in('begin','start','callback','cancel','register','adopt')),fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 primary key(actor_id,request_key)
);
create table composio_connect_runtime.tickets(
 id uuid primary key,proof_hash text not null check(proof_hash ~ '^[a-f0-9]{64}$'),actor_id uuid not null references public.profiles,
 session_hash text not null,actor_revision bigint not null,operation text not null,payload_hash text not null,
 expires_at timestamptz not null,used boolean not null default false
);
alter table composio_connect_runtime.contexts enable row level security;
alter table composio_connect_runtime.runtime enable row level security;
alter table composio_connect_runtime.phases enable row level security;
alter table composio_connect_runtime.receipts enable row level security;
alter table composio_connect_runtime.tickets enable row level security;
revoke all on all tables in schema composio_connect_runtime from public,anon,authenticated,service_role;

create function public.composio_connect_runtime_publish(p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare g bigint;d jsonb;policy composio_connect.configuration;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 g:=(p#>>'{config,generation}')::bigint;d:=p;
 if g is null or p->'enabled' is distinct from 'true'::jsonb or p#>>'{config,callback_mode}' is distinct from 'standard'
 or p#>>'{context,project_provenance}' is distinct from 'server_reviewed' or p#>>'{context,quota_provenance}' is distinct from 'oauth_client_reviewed'
 or p#>>'{config,project_id}' is distinct from p#>>'{context,composio_project_id}'
 or p#>>'{config,quota_project_id}' is distinct from p#>>'{context,google_quota_project_id}'
 or coalesce(p#>>'{context,credential_version}','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
 or coalesce(p#>>'{context,auth_config_revision}','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
 or coalesce(p#>>'{context,provenance_reference}','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
 or coalesce(p->>'callback_origin','') !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'
 then raise exception 'CONNECT_INVALID_INPUT';end if;
 -- Reuse only the pre-existing configuration validation, before any business locks.
 select * into policy from composio_connect.configuration where id=1;
 if policy.id is null or not policy.policy_reviewed then raise exception 'CONNECT_UNAVAILABLE';end if;
 perform public.composio_connect_publish(jsonb_build_object('generation',g,'project_id',p#>>'{config,project_id}',
 'auth_config_id',p#>>'{config,auth_config_id}','quota_project_id',p#>>'{config,quota_project_id}',
 'policy_reviewed',true,'max_age_seconds',policy.max_age_seconds,'inactivity_seconds',policy.inactivity_seconds));
 insert into composio_connect_runtime.contexts values(g,d);
end$$;

-- Shared permission rows first; capture effective expiry and test it again after business-lock waits.
create function composio_connect_runtime.session_limit(actor uuid,sid_hash text) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare c composio_connect.configuration;s auth.sessions;v timestamptz:='infinity';
begin
 perform composio_connect.live_actor(actor,sid_hash);
 select * into c from composio_connect.configuration where id=1;
 select * into s from auth.sessions where user_id=actor and composio_connect.digest(id::text)=sid_hash;
 if s.id is null then raise exception 'CONNECT_FORBIDDEN';end if;
 v:=least(v,coalesce(s.not_after,'infinity'));
 if c.max_age_seconds>0 then v:=least(v,s.created_at+make_interval(secs=>c.max_age_seconds));end if;
 if c.inactivity_seconds>0 then v:=least(v,coalesce(s.refreshed_at,s.created_at)+make_interval(secs=>c.inactivity_seconds));end if;
 return v;
end$$;

create function composio_connect_runtime.live_context(attempt uuid,adopting boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;s composio_connect.subjects;r composio_connect_runtime.runtime;
 c composio_connect.configuration;b public.operating_brands;m public.mail_accounts;v public.mail_account_brand_reviews;h public.mail_provider_binding_heads;d jsonb;
begin
 select * into a from composio_connect.attempts where id=attempt;
 select * into s from composio_connect.subjects where id=a.subject_id;
 select * into r from composio_connect_runtime.runtime where attempt_id=a.id;
 select * into c from composio_connect.configuration where id=1;
 select descriptor into d from composio_connect_runtime.contexts where generation=c.generation;
 if r.attempt_id is null or c.generation<>a.config_generation or
 jsonb_set(d,'{config,owner_id}',to_jsonb(a.owner_id),true) is distinct from r.descriptor then raise exception 'CONNECT_STALE';end if;
 select * into b from public.operating_brands where id=a.brand_id;
 if b.id is null or not b.active or b.revision<>a.brand_revision then raise exception 'CONNECT_STALE';end if;
 if s.account_id is not null then
  select * into m from public.mail_accounts where id=s.account_id;
  if lower(btrim(m.email))<>s.email or m.organization<>s.organization or m.status not in('connected','disconnected') then raise exception 'CONNECT_STALE';end if;
  if adopting and r.state='awaiting_brand' then
   select * into v from public.mail_account_brand_reviews where id=a.review_id;
   if r.state<>'awaiting_brand' or v.status is distinct from 'confirmed' or v.account_id<>s.account_id or v.proposed_brand_id<>a.brand_id
   or v.expected_account_revision<>a.account_revision or m.brand_revision<>a.account_revision+1 or m.operating_brand_id<>a.brand_id or v.proposed_brand_revision<>b.revision
   then raise exception 'CONNECT_STALE';end if;
  elsif m.brand_revision<>coalesce(a.registration_revision,a.account_revision) then raise exception 'CONNECT_STALE';end if;
  if a.registration_revision is not null then
   select * into v from public.mail_account_brand_reviews where id=a.review_id;
   if v.status is distinct from 'confirmed' or v.revision is distinct from a.registration_review_revision or m.operating_brand_id is distinct from a.brand_id then raise exception 'CONNECT_STALE';end if;
  end if;
 end if;
 select * into h from public.mail_provider_binding_heads where account_id=s.reserved_account_id;
 if r.state='completed' then
  if h.revision is distinct from a.head_revision+1 or h.current_binding_id is distinct from a.result_binding_id then raise exception 'CONNECT_STALE';end if;
 elsif coalesce(h.revision,0)<>a.head_revision then raise exception 'CONNECT_STALE';end if;
end$$;

create function composio_connect_runtime.view(attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;s composio_connect.subjects;r composio_connect_runtime.runtime;f composio_connect_runtime.phases;
begin
 select * into a from composio_connect.attempts where id=attempt;
 select * into s from composio_connect.subjects where id=a.subject_id;
 select * into r from composio_connect_runtime.runtime where attempt_id=a.id;
 select * into f from composio_connect_runtime.phases where id=r.phase_id;
 return jsonb_build_object('snapshot',jsonb_build_object('attempt',jsonb_build_object(
 'id',a.id,'revision',a.revision,'state',r.state,'created_at_ms',floor(extract(epoch from a.created_at)*1000)::bigint,
 'deadline_ms',floor(extract(epoch from a.deadline)*1000)::bigint,'account_id',s.reserved_account_id,'brand_id',a.brand_id,'expected_mailbox_email',s.email,
 'binding',jsonb_build_object('actor_id',a.actor_id,'session_hash',a.session_hash,'authorization_revision',a.actor_revision,'browser_hash',a.browser_hash,'state_hash',a.state_hash),
 'config',r.descriptor->'config','context_hash',r.context_hash,
 'phase',case when f.id is null then null else jsonb_build_object('id',f.id,'kind',f.kind,'fingerprint',f.fingerprint) end,
 'connection_id',a.connection_id,'navigation',null,'binding_id',a.result_binding_id,'cleanup_required',a.cleanup_required),
 'current_context_hash',r.context_hash),
 'descriptor',r.descriptor,'state_ciphertext',r.state_ciphertext,'navigation_ciphertext',r.navigation_ciphertext,
 'navigation_expires_ms',r.navigation_expires_ms,'review_id',a.review_id);
end$$;

create function public.composio_connect_runtime_authorize(operation text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare human jsonb:=composio_connect.human();actor uuid:=(human->>'actor')::uuid;
 a composio_connect.attempts;authority jsonb:=coalesce(p->'authority',p#>'{command,authority}');identity uuid;
 proof text:=gen_random_uuid()::text||gen_random_uuid()::text;deadline timestamptz;
begin
 if operation not in('begin','load','receipt','claim','save','identity','reject','cancel','register','adopt') or operation is null
 or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>65536 then raise exception 'CONNECT_INVALID_INPUT';end if;
 if authority->>'actor_id' is distinct from actor::text or authority->>'session_hash' is distinct from human->>'session_hash'
 or authority->>'authorization_revision' is distinct from human->>'actor_revision' or coalesce(authority->>'browser_hash','') !~ '^[a-f0-9]{64}$'
 then raise exception 'CONNECT_FORBIDDEN';end if;
 deadline:=least(clock_timestamp()+interval '10 seconds',to_timestamp((auth.jwt()->>'exp')::numeric),
 composio_connect_runtime.session_limit(actor,human->>'session_hash'));
 if operation<>'begin' then
  identity:=coalesce(p->>'attempt_id',p#>>'{command,attempt_id}')::uuid;
  select * into a from composio_connect.attempts where id=identity;
  if a.id is null or a.actor_id<>actor or a.session_hash<>human->>'session_hash' or a.browser_hash<>authority->>'browser_hash'
  or a.actor_revision<>(human->>'actor_revision')::bigint then raise exception 'CONNECT_FORBIDDEN';end if;
  perform composio_connect_runtime.live_context(identity,operation='adopt');
  if operation<>'load' then deadline:=least(deadline,a.deadline);end if;
 end if;
 if deadline<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
 identity:=gen_random_uuid();
 insert into composio_connect_runtime.tickets values(identity,composio_connect.digest(proof),actor,human->>'session_hash',(human->>'actor_revision')::bigint,
 operation,composio_connect.digest(p::text),deadline,false);
 return jsonb_build_object('id',identity,'proof',proof);
end$$;

create function composio_connect_runtime.remember(a composio_connect.attempts,c jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into composio_connect_runtime.receipts values(a.actor_id,(c->>'idempotency_key')::uuid,a.id,c->>'command',c->>'fingerprint');
end$$;

create function composio_connect_runtime.materialize(attempt uuid) returns void language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;s composio_connect.subjects;m public.mail_accounts;r public.mail_account_brand_reviews;effect jsonb;
begin
 select * into a from composio_connect.attempts where id=attempt;
 select * into s from composio_connect.subjects where id=a.subject_id;
 if s.account_id is null then
  if exists(select 1 from public.mail_accounts where lower(btrim(email))=s.email) then raise exception 'CONNECT_CONFLICT';end if;
  insert into public.mail_accounts(id,email,organization,status,live_enabled,sync_enabled) values(s.reserved_account_id,s.email,s.organization,'disconnected',false,false) returning * into m;
  update composio_connect.subjects set account_id=m.id where id=s.id;
 else select * into m from public.mail_accounts where id=s.account_id;end if;
 if lower(btrim(m.email))<>s.email or m.organization<>s.organization or m.brand_revision<>a.account_revision
 or m.status not in('connected','disconnected') then raise exception 'CONNECT_STALE';end if;
 select * into r from public.mail_account_brand_reviews where account_id=m.id and status='confirmed' and proposed_brand_id=a.brand_id
 and expected_account_revision=m.brand_revision-1 order by created_at desc,id limit 1;
 if r.id is not null and m.operating_brand_id=a.brand_id then
  update composio_connect.attempts set review_id=r.id,registration_revision=m.brand_revision,registration_review_revision=r.revision,state='ready_to_register' where id=a.id;
  update composio_connect_runtime.runtime set state='ready_to_register' where attempt_id=a.id;
 else
  if exists(select 1 from public.mail_account_brand_reviews where account_id=m.id and status in('pending','conflict')) then raise exception 'CONNECT_STALE';end if;
  effect:=brand_b1.impact(m.id);
  if coalesce((effect->>'queued')::bigint,0)+coalesce((effect->>'sending')::bigint,0)+coalesce((effect->>'uncertain')::bigint,0)+coalesce((effect->>'active_campaigns')::bigint,0)>0 then raise exception 'CONNECT_NOT_READY';end if;
  insert into public.mail_account_brand_reviews(account_id,proposed_brand_id,status,expected_account_revision,evidence_reference,request_key,created_by,
   history_approved,history_from,history_to,proposed_brand_revision,impact_fingerprint)
  values(m.id,a.brand_id,'pending',m.brand_revision,'connect:'||a.id::text,gen_random_uuid(),a.actor_id,false,null,null,a.brand_revision,effect->>'fingerprint') returning * into r;
  update composio_connect.attempts set review_id=r.id,state='awaiting_brand' where id=a.id;
  update composio_connect_runtime.runtime set state='awaiting_brand' where attempt_id=a.id;
 end if;
end$$;

create function composio_connect_runtime.begin_intent(p jsonb,t composio_connect_runtime.tickets) returns jsonb language plpgsql security definer set search_path='' as $$
declare q jsonb:=p->'intent';a composio_connect.attempts;s composio_connect.subjects;m public.mail_accounts;b public.operating_brands;c composio_connect.configuration;
 rec composio_connect_runtime.receipts;v_email text;org text;account uuid;owner_id text;head bigint;d jsonb;fp text;ctx text;started timestamptz:=clock_timestamp();old_attempt composio_connect.attempts;old_runtime composio_connect_runtime.runtime;expired_state text;
begin
 if q->>'mode' not in('new','existing','reconnect') or q->>'mode' is null or p->>'state_hash' !~ '^[a-f0-9]{64}$' or p->>'capability_hash' !~ '^[a-f0-9]{64}$'
 or p->>'state_ciphertext' is null or q->>'attempt_id' is distinct from p->>'attempt_id' then raise exception 'CONNECT_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||t.actor_id::text||':'||(q->>'idempotency_key'),71509));
 fp:=composio_connect.digest(jsonb_build_object('intent',q,'authority',p->'authority','state_hash',p->>'state_hash')::text);
 select * into rec from composio_connect_runtime.receipts where actor_id=t.actor_id and request_key=(q->>'idempotency_key')::uuid;
 if found then
  if rec.fingerprint<>fp or rec.command<>'begin' then raise exception 'CONNECT_CONFLICT';end if;
  select * into a from composio_connect.attempts where id=rec.attempt_id;
  if a.session_hash<>t.session_hash or a.deadline<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
  perform composio_connect_runtime.live_context(a.id);return composio_connect_runtime.view(a.id);
 end if;
 select * into c from composio_connect.configuration where id=1;
 select descriptor into d from composio_connect_runtime.contexts where generation=c.generation;
 if d is null or (q->>'expected_config_generation')::bigint is distinct from c.generation then raise exception 'CONNECT_STALE';end if;
 if q->>'mode'='new' then
  v_email:=q->>'email';org:=q->>'organization';
  if coalesce(v_email,'') !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or v_email<>lower(btrim(v_email)) or length(v_email)>254 or coalesce(org,'')='' or length(org)>100 or q->>'account_id' is not null then raise exception 'CONNECT_INVALID_INPUT';end if;
  if exists(select 1 from public.mail_accounts where lower(btrim(mail_accounts.email))=v_email) then raise exception 'CONNECT_CONFLICT';end if;
 else
  select * into m from public.mail_accounts where id=(q->>'account_id')::uuid;
  if m.id is null or m.status not in('connected','disconnected') or q->>'email' is not null or q->>'organization' is not null then raise exception 'CONNECT_NOT_READY';end if;
  v_email:=lower(btrim(m.email));org:=m.organization;account:=m.id;
  if (select count(*) from public.mail_accounts where lower(btrim(mail_accounts.email))=v_email)<>1 then raise exception 'CONNECT_CONFLICT';end if;
 end if;
 insert into composio_connect.subjects(email,organization,reserved_account_id,account_id) values(v_email,org,coalesce(account,gen_random_uuid()),account) on conflict on constraint subjects_email_key do nothing;
 select * into s from composio_connect.subjects where subjects.email=v_email for update;
 if s.organization<>org or (account is not null and s.reserved_account_id<>account) or (account is null and s.account_id is not null) then raise exception 'CONNECT_CONFLICT';end if;
 for old_attempt in select * from composio_connect.attempts where subject_id=s.id and deadline<=clock_timestamp() and state in('prepared','identity_ready','awaiting_brand','ready_to_register') order by id for update loop
  select * into old_runtime from composio_connect_runtime.runtime where attempt_id=old_attempt.id for update;
  if old_runtime.attempt_id is null then raise exception 'CONNECT_UNAVAILABLE';end if;
  expired_state:=case when old_runtime.state='link_pending' then 'uncertain' else 'expired' end;
  update composio_connect.attempts set state=expired_state,revision=revision+1,cleanup_required=cleanup_required or connection_id is not null or old_runtime.phase_id is not null where id=old_attempt.id;
  update composio_connect_runtime.runtime set state=expired_state,phase_id=null,state_ciphertext=null,navigation_ciphertext=null,navigation_expires_ms=null where attempt_id=old_attempt.id;
 end loop;
 -- Expired pending network phases are never silently reclaimed: a crash is not proof of non-emission.
 if exists(select 1 from composio_connect.attempts where subject_id=s.id and state in('prepared','identity_ready','awaiting_brand','ready_to_register','uncertain')) then raise exception 'CONNECT_CONFLICT';end if;
 select * into b from public.operating_brands where id=(q->>'brand_id')::uuid for share;
 if b.id is null or not b.active or (q->>'expected_brand_revision')::bigint is distinct from b.revision then raise exception 'CONNECT_STALE';end if;
 if account is not null then
  select * into m from public.mail_accounts where id=account for update;
  if lower(btrim(m.email))<>v_email or m.organization<>org or m.status not in('connected','disconnected') or (m.operating_brand_id is not null and m.operating_brand_id<>b.id)
   or (q->>'expected_account_revision')::bigint is distinct from m.brand_revision then raise exception 'CONNECT_STALE';end if;
 elsif (q->>'expected_account_revision')::bigint is distinct from 0::bigint then raise exception 'CONNECT_STALE';end if;
 select revision into head from public.mail_provider_binding_heads where account_id=account;
 if (q->>'expected_head_revision')::bigint is distinct from coalesce(head,0) then raise exception 'CONNECT_STALE';end if;
 select composio_user_id into owner_id from public.mail_provider_bindings where id=(select current_binding_id from public.mail_provider_binding_heads where account_id=account);
 owner_id:=coalesce(owner_id,'crm-mail:'||s.reserved_account_id::text);d:=jsonb_set(d,'{config,owner_id}',to_jsonb(owner_id),true);
 ctx:=composio_connect.digest(jsonb_build_array(d,s.id,t.actor_id,t.session_hash,t.actor_revision,b.id,b.revision,coalesce(m.brand_revision,0),coalesce(head,0))::text);
 if t.expires_at<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
 insert into composio_connect.attempts(id,subject_id,actor_id,session_hash,actor_revision,browser_hash,state_hash,capability_hash,config_generation,project_id,auth_config_id,quota_project_id,owner_id,brand_id,brand_revision,account_revision,head_revision,created_at,deadline)
 values((p->>'attempt_id')::uuid,s.id,t.actor_id,t.session_hash,t.actor_revision,p#>>'{authority,browser_hash}',p->>'state_hash',p->>'capability_hash',c.generation,c.project_id,c.auth_config_id,c.quota_project_id,owner_id,b.id,b.revision,coalesce(m.brand_revision,0),coalesce(head,0),started,started+interval '10 minutes') returning * into a;
 insert into composio_connect_runtime.runtime(attempt_id,state,context_hash,descriptor,state_ciphertext) values(a.id,'prepared',ctx,d,p->>'state_ciphertext');
 insert into composio_connect_runtime.receipts values(t.actor_id,(q->>'idempotency_key')::uuid,a.id,'begin',fp);
 return composio_connect_runtime.view(a.id);
end$$;

create function public.composio_connect_runtime_execute(operation text,p jsonb,ticket jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t composio_connect_runtime.tickets;a composio_connect.attempts;s composio_connect.subjects;r composio_connect_runtime.runtime;
 c jsonb:=p->'command';authority jsonb:=coalesce(p->'authority',p#>'{command,authority}');identity uuid;
 f composio_connect_runtime.phases;receipt composio_connect_runtime.receipts;v public.mail_account_brand_reviews;limit_at timestamptz;
 phase text;new_state text;new_binding uuid;answer jsonb;expected_command text;grant_id uuid;grant_proof text;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 select * into t from composio_connect_runtime.tickets where id=(ticket->>'id')::uuid;
 if t.id is null or t.used or composio_connect.digest(ticket->>'proof') is distinct from t.proof_hash or t.operation is distinct from operation
 or t.payload_hash is distinct from composio_connect.digest(p::text) or t.expires_at<=clock_timestamp() then raise exception 'CONNECT_FORBIDDEN';end if;
 limit_at:=least(t.expires_at,composio_connect_runtime.session_limit(t.actor_id,t.session_hash));
 if composio_connect.live_actor(t.actor_id,t.session_hash)<>t.actor_revision then raise exception 'CONNECT_STALE';end if;
 if operation='begin' then
  answer:=composio_connect_runtime.begin_intent(p,t);
  select * into t from composio_connect_runtime.tickets where id=t.id for update;
  if t.used or limit_at<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
  update composio_connect_runtime.tickets set used=true where id=t.id;return answer;
 end if;
 identity:=coalesce(p->>'attempt_id',p#>>'{command,attempt_id}')::uuid;
 select * into a from composio_connect.attempts where id=identity;
 if a.id is null or a.actor_id<>t.actor_id or a.session_hash<>t.session_hash or a.actor_revision<>t.actor_revision
 or authority->>'browser_hash' is distinct from a.browser_hash then raise exception 'CONNECT_FORBIDDEN';end if;
 if c is not null then perform pg_advisory_xact_lock(hashtextextended('runtime:'||t.actor_id::text||':'||(c->>'idempotency_key'),71509));end if;
 select * into s from composio_connect.subjects where id=a.subject_id for update;
 perform 1 from public.operating_brands where id=a.brand_id for share;
 if s.account_id is not null then
  perform 1 from public.mail_accounts where id=s.account_id for update;
  if a.review_id is not null then perform 1 from public.mail_account_brand_reviews where id=a.review_id for share;end if;
 end if;
 select * into a from composio_connect.attempts where id=identity for update;
 select * into r from composio_connect_runtime.runtime where attempt_id=identity for update;
 perform composio_connect_runtime.live_context(identity,operation='adopt');
 select * into t from composio_connect_runtime.tickets where id=t.id for update;
 if t.used or limit_at<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
 if operation<>'load' and a.deadline<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
 update composio_connect_runtime.tickets set used=true where id=t.id;
 if operation='load' then
  if a.deadline<=clock_timestamp() and r.state not in('completed','cancelled','expired','rejected','uncertain') then
   new_state:=case when r.state='link_pending' then 'uncertain' else 'expired' end;
   update composio_connect.attempts set state=new_state,revision=revision+1,cleanup_required=cleanup_required or connection_id is not null or r.phase_id is not null where id=a.id;
   update composio_connect_runtime.runtime set state=new_state,phase_id=null,state_ciphertext=null,navigation_ciphertext=null,navigation_expires_ms=null where attempt_id=a.id;
  end if;
  return composio_connect_runtime.view(identity);
 end if;
 if c->>'expected_context_hash' is distinct from r.context_hash or coalesce(c->>'fingerprint','') !~ '^[a-f0-9]{64}$'
 or c->>'idempotency_key' is null then raise exception 'CONNECT_STALE';end if;
 select * into receipt from composio_connect_runtime.receipts where actor_id=a.actor_id and request_key=(c->>'idempotency_key')::uuid;
 if operation='receipt' then
  return jsonb_build_object('kind',case when receipt.actor_id is null then 'absent' when receipt.attempt_id=a.id and receipt.command=c->>'command' and receipt.fingerprint=c->>'fingerprint' then 'replay' else 'conflict' end);
 end if;
 if receipt.actor_id is not null then
  if receipt.attempt_id<>a.id or receipt.command<>c->>'command' or receipt.fingerprint<>c->>'fingerprint' then raise exception 'CONNECT_CONFLICT';end if;
  if operation='claim' then return jsonb_build_object('kind','replay');end if;
  if (operation='cancel' and r.state='cancelled') or (operation='reject' and r.state='rejected') or (operation='adopt' and r.state='ready_to_register') then return composio_connect_runtime.view(identity);end if;
 end if;
 if r.state in('completed','cancelled','expired','rejected','uncertain') then raise exception 'CONNECT_CLOSED';end if;
 if operation='claim' then
  phase:=p->>'phase';expected_command:=case phase when 'link' then 'start' when 'identity' then 'callback' when 'registration' then 'register' end;
  if expected_command is null or c->>'command' is distinct from expected_command or r.phase_id is not null or a.revision is distinct from (c->>'expected_revision')::bigint then raise exception 'CONNECT_CONFLICT';end if;
  new_state:=case phase when 'link' then 'link_pending' when 'identity' then 'identity_checking' else 'ready_to_register' end;
  if (phase='link' and r.state<>'prepared') or (phase='identity' and r.state<>'awaiting_consent') or (phase='registration' and r.state<>'ready_to_register') then raise exception 'CONNECT_NOT_READY';end if;
  insert into composio_connect_runtime.phases(id,attempt_id,kind,fingerprint,revision,capability_hash)
  values((p->>'phase_id')::uuid,a.id,phase,c->>'fingerprint',a.revision+1,p->>'capability_hash') returning * into f;
  update composio_connect.attempts set revision=revision+1 where id=a.id returning * into a;
  update composio_connect_runtime.runtime set phase_id=f.id,state=new_state where attempt_id=a.id;
  perform composio_connect_runtime.remember(a,c);
  return jsonb_build_object('kind','claimed','view',composio_connect_runtime.view(a.id),'lease',jsonb_build_object('id',f.id,'kind',f.kind,'fingerprint',f.fingerprint,'revision',f.revision));
 end if;
 if operation in('save','identity','register') or p->'lease' is not null then
  select * into f from composio_connect_runtime.phases where id=r.phase_id for update;
  if f.id is null or f.id is distinct from (p#>>'{lease,id}')::uuid or f.attempt_id<>a.id or f.revision<>a.revision
  or f.revision is distinct from (p#>>'{lease,revision}')::bigint or f.kind is distinct from p#>>'{lease,kind}'
  or f.fingerprint is distinct from c->>'fingerprint' or f.fingerprint is distinct from p#>>'{lease,fingerprint}'
  or f.capability_hash is distinct from composio_connect.digest(p#>>'{lease,capability}') then raise exception 'CONNECT_STALE';end if;
 elsif a.revision is distinct from (c->>'expected_revision')::bigint then raise exception 'CONNECT_CONFLICT';end if;
 if operation='save' then
  if f.kind<>'link' or r.state<>'link_pending' or coalesce(p#>>'{link,connected_account_id}','') !~ '^ca_[A-Za-z0-9_-]{1,128}$'
  or (p->>'deadline_ms')::bigint is distinct from least(floor(extract(epoch from a.deadline)*1000)::bigint,(p#>>'{link,expires_at_ms}')::bigint)
  or (p->>'deadline_ms')::bigint<=floor(extract(epoch from clock_timestamp())*1000)::bigint then raise exception 'CONNECT_STALE';end if;
  update composio_connect.attempts set connection_id=p#>>'{link,connected_account_id}',deadline=to_timestamp((p->>'deadline_ms')::numeric/1000),revision=revision+1 where id=a.id;
  update composio_connect_runtime.runtime set state='awaiting_consent',phase_id=null,navigation_ciphertext=p->>'navigation_ciphertext',navigation_expires_ms=(p#>>'{link,expires_at_ms}')::bigint where attempt_id=a.id;
 elsif operation='identity' then
  if f.kind<>'identity' or r.state<>'identity_checking' or p#>>'{identity,connected_account_id}' is distinct from a.connection_id
  or p#>>'{identity,project_id}' is distinct from a.project_id or p#>>'{identity,auth_config_id}' is distinct from a.auth_config_id
  or p#>>'{identity,owner_id}' is distinct from a.owner_id or lower(p#>>'{identity,primary_email}') is distinct from s.email
  or p#>>'{identity,toolkit}' is distinct from 'gmail' or p#>'{identity,active}' is distinct from 'true'::jsonb then raise exception 'CONNECT_IDENTITY_MISMATCH';end if;
  update composio_connect.attempts set observation_digest=composio_connect.digest((p->'identity')::text),revision=revision+1 where id=a.id;
  perform composio_connect_runtime.materialize(a.id);
  update composio_connect_runtime.runtime set phase_id=null,navigation_ciphertext=null,navigation_expires_ms=null where attempt_id=a.id;
 elsif operation='register' then
  if f.kind<>'registration' or r.state<>'ready_to_register' or a.observation_digest is null then raise exception 'CONNECT_NOT_READY';end if;
  grant_id:=gen_random_uuid();grant_proof:=gen_random_uuid()::text||gen_random_uuid()::text;
  insert into composio_connect_runtime.tickets values(grant_id,composio_connect.digest(grant_proof),t.actor_id,t.session_hash,t.actor_revision,'finalize_register',composio_connect.digest(p::text),least(limit_at,a.deadline),false);
  return jsonb_build_object('id',grant_id,'proof',grant_proof);
 elsif operation='adopt' then
  if c->>'command' is distinct from 'register' or r.state<>'awaiting_brand' or a.review_id is distinct from (p->>'review_id')::uuid then raise exception 'CONNECT_NOT_READY';end if;
  select * into v from public.mail_account_brand_reviews where id=a.review_id;
  update composio_connect.attempts set registration_revision=account_revision+1,registration_review_revision=v.revision,state='ready_to_register',revision=revision+1 where id=a.id;
  update composio_connect_runtime.runtime set state='ready_to_register' where attempt_id=a.id;
  perform composio_connect_runtime.remember(a,c);
 elsif operation in('cancel','reject') then
  if operation='cancel' and c->>'command'<>'cancel' then raise exception 'CONNECT_INVALID_INPUT';end if;
  if operation='reject' and (c->>'command'<>'callback' or (p->>'reason' not in('provider_cancelled','identity_mismatch'))) then raise exception 'CONNECT_INVALID_INPUT';end if;
  if operation='reject' and r.state not in('awaiting_consent','identity_checking') then raise exception 'CONNECT_NOT_READY';end if;
  new_state:=case when operation='cancel' then 'cancelled' else 'rejected' end;
  update composio_connect.attempts set state='cancelled',revision=revision+1,cleanup_required=cleanup_required or connection_id is not null or r.phase_id is not null where id=a.id;
  update composio_connect_runtime.runtime set state=new_state,phase_id=null,state_ciphertext=null,navigation_ciphertext=null,navigation_expires_ms=null where attempt_id=a.id;
  if receipt.actor_id is null then perform composio_connect_runtime.remember(a,c);end if;
 else raise exception 'CONNECT_INVALID_INPUT';end if;
 return composio_connect_runtime.view(identity);
exception when unique_violation then raise exception 'CONNECT_CONFLICT';
end$$;

-- C1 requires the actual human identity. A service-issued single-use grant is mandatory;
-- never synthesize JWT claims or relax the pre-existing C1 triggers.
create function public.composio_connect_runtime_register(operation text,p jsonb,ticket jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h jsonb:=composio_connect.human();t composio_connect_runtime.tickets;a composio_connect.attempts;
 s composio_connect.subjects;r composio_connect_runtime.runtime;f composio_connect_runtime.phases;identity uuid:=(p#>>'{command,attempt_id}')::uuid;
 limit_at timestamptz;binding uuid;
begin
 if operation is distinct from 'register' then raise exception 'CONNECT_INVALID_INPUT';end if;
 select * into t from composio_connect_runtime.tickets where id=(ticket->>'id')::uuid;
 if t.id is null or t.used or t.operation<>'finalize_register' or t.actor_id::text is distinct from h->>'actor'
 or t.session_hash is distinct from h->>'session_hash' or t.actor_revision::text is distinct from h->>'actor_revision'
 or t.proof_hash is distinct from composio_connect.digest(ticket->>'proof') or t.payload_hash is distinct from composio_connect.digest(p::text)
 then raise exception 'CONNECT_FORBIDDEN';end if;
 limit_at:=least(t.expires_at,to_timestamp((auth.jwt()->>'exp')::numeric),composio_connect_runtime.session_limit(t.actor_id,t.session_hash));
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||t.actor_id::text||':'||(p#>>'{command,idempotency_key}'),71509));
 select * into a from composio_connect.attempts where id=identity;
 if a.actor_id is distinct from t.actor_id or a.session_hash is distinct from t.session_hash
 or a.browser_hash is distinct from p#>>'{command,authority,browser_hash}' then raise exception 'CONNECT_FORBIDDEN';end if;
 select * into s from composio_connect.subjects where id=a.subject_id for update;
 perform 1 from public.operating_brands where id=a.brand_id for share;
 perform 1 from public.mail_accounts where id=s.account_id for update;
 perform 1 from public.mail_account_brand_reviews where id=a.review_id for share;
 select * into a from composio_connect.attempts where id=identity for update;
 select * into r from composio_connect_runtime.runtime where attempt_id=identity for update;
 perform composio_connect_runtime.live_context(identity);
 select * into t from composio_connect_runtime.tickets where id=t.id for update;
 select * into f from composio_connect_runtime.phases where id=r.phase_id for update;
 if t.used or least(limit_at,a.deadline)<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
 if r.state<>'ready_to_register' or a.observation_digest is null or f.kind is distinct from 'registration'
 or f.id is distinct from (p#>>'{lease,id}')::uuid or f.revision is distinct from a.revision
 or f.capability_hash is distinct from composio_connect.digest(p#>>'{lease,capability}')
 or f.fingerprint is distinct from p#>>'{command,fingerprint}' or r.context_hash is distinct from p#>>'{command,expected_context_hash}'
 then raise exception 'CONNECT_STALE';end if;
 binding:=composio_connect.register_candidate(a,s);
 update composio_connect.attempts set result_binding_id=binding,state='completed',revision=revision+1 where id=a.id;
 update composio_connect_runtime.runtime set state='completed',phase_id=null,state_ciphertext=null,navigation_ciphertext=null,navigation_expires_ms=null where attempt_id=a.id;
 update composio_connect_runtime.tickets set used=true where id=t.id;
 return composio_connect_runtime.view(a.id);
exception when unique_violation then raise exception 'CONNECT_CONFLICT';
end$$;

create function public.composio_connect_runtime_ledger(operation text,p jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;r composio_connect_runtime.runtime;f composio_connect_runtime.phases;identity uuid;next_state text;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 identity:=coalesce(p->>'attempt_id',p#>>'{command,attempt_id}')::uuid;
 select * into a from composio_connect.attempts where id=identity;
 if a.id is null then raise exception 'CONNECT_FORBIDDEN';end if;
 perform 1 from composio_connect.subjects where id=a.subject_id for update;
 select * into a from composio_connect.attempts where id=identity for update;
 select * into r from composio_connect_runtime.runtime where attempt_id=a.id for update;
 select * into f from composio_connect_runtime.phases where id=(p#>>'{lease,id}')::uuid for update;
 if f.id is null or f.attempt_id<>a.id or f.capability_hash is distinct from composio_connect.digest(p#>>'{lease,capability}')
 or f.revision is distinct from (p#>>'{lease,revision}')::bigint or f.kind is distinct from p#>>'{lease,kind}' or f.fingerprint is distinct from p#>>'{lease,fingerprint}' then raise exception 'CONNECT_FORBIDDEN';end if;
 if operation='release' then
  if r.phase_id is distinct from f.id or a.revision<>f.revision or r.state not in('link_pending','identity_checking','ready_to_register') then return;end if;
  if a.deadline<=clock_timestamp() then next_state:='expired';else next_state:=case f.kind when 'link' then 'prepared' when 'identity' then 'awaiting_consent' else 'ready_to_register' end;end if;
  update composio_connect.attempts set revision=revision+1,state=case when next_state in('expired','ready_to_register') then next_state else 'prepared' end where id=a.id;
  update composio_connect_runtime.runtime set state=next_state,phase_id=null,
  state_ciphertext=case when next_state='expired' then null else state_ciphertext end,
  navigation_ciphertext=case when next_state='expired' then null else navigation_ciphertext end,
  navigation_expires_ms=case when next_state='expired' then null else navigation_expires_ms end where attempt_id=a.id;
  delete from composio_connect_runtime.receipts where actor_id=a.actor_id and request_key=(p#>>'{command,idempotency_key}')::uuid
  and attempt_id=a.id and fingerprint=f.fingerprint;
 elsif operation in('uncertain','residual') then
  if operation='uncertain' and f.kind<>'link' then raise exception 'CONNECT_FORBIDDEN';end if;
  if coalesce(p->>'observed_connection_id',p->>'connection_id') is not null and coalesce(p->>'observed_connection_id',p->>'connection_id') !~ '^ca_[A-Za-z0-9_-]{1,128}$' then raise exception 'CONNECT_INVALID_INPUT';end if;
  update composio_connect_runtime.phases set residual=true,uncertain=uncertain or operation='uncertain',
   observed_connection_id=coalesce(observed_connection_id,p->>'observed_connection_id',p->>'connection_id') where id=f.id;
  if operation='uncertain' and r.phase_id=f.id and r.state='link_pending' then
   update composio_connect.attempts set state='uncertain',cleanup_required=true,revision=revision+1 where id=a.id;
   update composio_connect_runtime.runtime set state='uncertain',phase_id=null,state_ciphertext=null,navigation_ciphertext=null,navigation_expires_ms=null where attempt_id=a.id;
  else update composio_connect.attempts set cleanup_required=true where id=a.id;end if;
 else raise exception 'CONNECT_INVALID_INPUT';end if;
end$$;

create function composio_connect_runtime.consistent() returns trigger language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;r composio_connect_runtime.runtime;f composio_connect_runtime.phases;identity uuid;
begin
 if tg_table_schema='composio_connect' then identity:=new.id;else identity:=new.attempt_id;end if;
 select * into a from composio_connect.attempts where id=identity;
 select * into r from composio_connect_runtime.runtime where attempt_id=identity;
 if r.attempt_id is null then raise exception 'CONNECT_RUNTIME_REQUIRED';end if;
 select * into f from composio_connect_runtime.phases where id=r.phase_id;
 if (r.state in('prepared','link_pending','awaiting_consent','identity_checking') and a.state<>'prepared')
 or (r.state='rejected' and a.state<>'cancelled')
 or (r.state not in('prepared','link_pending','awaiting_consent','identity_checking','rejected') and r.state<>a.state)
 or (r.phase_id is not null and (f.attempt_id is distinct from a.id or f.revision is distinct from a.revision))
 or (r.state='link_pending' and (f.kind is distinct from 'link' or a.connection_id is not null))
 or (r.state='identity_checking' and (f.kind is distinct from 'identity' or a.connection_id is null))
 or (r.state='awaiting_consent' and (a.connection_id is null or r.navigation_ciphertext is null or r.phase_id is not null))
 or (r.phase_id is not null and r.state not in('link_pending','identity_checking','ready_to_register'))
 or (r.state='ready_to_register' and r.phase_id is not null and f.kind<>'registration')
 or (r.state='completed' and (a.result_binding_id is null or a.connection_id is null))
 or (r.state='uncertain' and not a.cleanup_required)
 then raise exception 'CONNECT_RUNTIME_INCONSISTENT';end if;
 return null;
end$$;
create constraint trigger connect_runtime_base_check after insert or update on composio_connect.attempts deferrable initially deferred for each row execute function composio_connect_runtime.consistent();
create constraint trigger connect_runtime_phase_check after insert or update on composio_connect_runtime.runtime deferrable initially deferred for each row execute function composio_connect_runtime.consistent();

revoke all on all functions in schema composio_connect_runtime from public,anon,authenticated,service_role;
revoke all on function public.composio_connect_runtime_publish(jsonb),public.composio_connect_runtime_authorize(text,jsonb),public.composio_connect_runtime_execute(text,jsonb,jsonb),public.composio_connect_runtime_ledger(text,jsonb),public.composio_connect_runtime_register(text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.composio_connect_runtime_authorize(text,jsonb),public.composio_connect_runtime_register(text,jsonb,jsonb) to authenticated;
grant execute on function public.composio_connect_runtime_publish(jsonb),public.composio_connect_runtime_execute(text,jsonb,jsonb),public.composio_connect_runtime_ledger(text,jsonb) to service_role;
-- Fence every old entry point; retain definitions and restore their precise grants in rollback.
revoke all on function public.composio_connect_publish(jsonb),public.composio_connect_begin(jsonb,uuid),public.composio_connect_observe(uuid,bigint,text,jsonb),public.composio_connect_uncertain(uuid,bigint,text),public.composio_connect_command(uuid,text,bigint,text,uuid,uuid) from public,anon,authenticated,service_role;
commit;
