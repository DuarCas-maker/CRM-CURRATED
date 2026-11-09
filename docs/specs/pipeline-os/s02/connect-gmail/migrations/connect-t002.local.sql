-- T-002 ONLY: additive fixture for an explicitly authorized, disposable local PG15 database.
-- Not a numbered migration; no transport, HTTP, OAuth, worker or production caller.
begin;
do $guard$ begin
 if current_setting('pipeline_os.connect_t002_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^f2_connect_[a-f0-9]{12}$'
 or session_user <> 'f2_connect_owner' or inet_server_addr() is distinct from '127.0.0.1'::inet
 then raise exception 'CONNECT_T002_LOCAL_ONLY'; end if;
 if to_regnamespace('composio_c1') is null or to_regclass('auth.sessions') is null
 then raise exception 'CONNECT_T002_BASE_REQUIRED'; end if;
end $guard$;

create schema composio_connect;
revoke all on schema composio_connect from public,anon,authenticated,service_role;
create table composio_connect.configuration(
 id integer primary key check(id=1),generation bigint not null check(generation between 1 and 9007199254740991),
 project_id text not null,auth_config_id text not null,quota_project_id text not null,
 policy_reviewed boolean not null check(policy_reviewed),max_age_seconds integer not null check(max_age_seconds>=0),
 inactivity_seconds integer not null check(inactivity_seconds>=0)
);
create table composio_connect.subjects(
 id uuid primary key default gen_random_uuid(),email text not null unique,
 organization text not null,reserved_account_id uuid not null unique,
 account_id uuid references public.mail_accounts on delete restrict,
 check(email=lower(btrim(email)) and length(email)<=254 and email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
 check(account_id is null or account_id=reserved_account_id)
);
create table composio_connect.attempts(
 id uuid primary key default gen_random_uuid(),subject_id uuid not null references composio_connect.subjects on delete restrict,
 actor_id uuid not null references public.profiles on delete restrict,session_hash text not null,actor_revision bigint not null,
 browser_hash text not null,state_hash text not null unique,capability_hash text not null,
 config_generation bigint not null,project_id text not null,auth_config_id text not null,quota_project_id text not null,owner_id text not null,
 brand_id uuid not null references public.operating_brands on delete restrict,brand_revision bigint not null,
 account_revision bigint not null,head_revision bigint not null,
 state text not null default 'prepared' check(state in('prepared','identity_ready','awaiting_brand','ready_to_register','completed','cancelled','expired','uncertain')),
 revision bigint not null default 0 check(revision between 0 and 9007199254740991),
 created_at timestamptz not null default clock_timestamp(),deadline timestamptz not null,
 connection_id text,observation_digest text,cleanup_required boolean not null default false,review_id uuid references public.mail_account_brand_reviews on delete restrict,
 registration_revision bigint,registration_review_revision bigint,result_binding_id uuid references public.mail_provider_bindings on delete restrict,
 check(deadline<=created_at+interval '10 minutes'),
 check(session_hash ~ '^[a-f0-9]{64}$' and browser_hash ~ '^[a-f0-9]{64}$' and state_hash ~ '^[a-f0-9]{64}$' and capability_hash ~ '^[a-f0-9]{64}$')
);
create unique index connect_one_open_subject on composio_connect.attempts(subject_id)
 where state in('prepared','identity_ready','awaiting_brand','ready_to_register','uncertain');
create index connect_actor_attempt on composio_connect.attempts(actor_id,id);
create index connect_deadline on composio_connect.attempts(deadline) where state not in('completed','cancelled','expired');
alter table composio_connect.configuration enable row level security;
alter table composio_connect.subjects enable row level security;
alter table composio_connect.attempts enable row level security;
revoke all on all tables in schema composio_connect from public,anon,authenticated,service_role;

create function composio_connect.digest(value text) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(value,'UTF8')),'hex')
$$;

-- Test schema mirrors the minimal Auth fields only; real Auth compatibility remains a release gate.
create function composio_connect.live_actor(actor uuid,sid_hash text) returns bigint
language plpgsql security definer set search_path='' as $$
declare p public.profiles;c composio_connect.configuration;s auth.sessions;
begin
 select * into c from composio_connect.configuration where id=1 for share;
 if c.id is null or not c.policy_reviewed then raise exception 'CONNECT_UNAVAILABLE';end if;
 select * into s from auth.sessions where user_id=actor and composio_connect.digest(id::text)=sid_hash for share;
 if s.id is null or (s.not_after is not null and s.not_after<=clock_timestamp())
 or (c.max_age_seconds>0 and s.created_at+make_interval(secs=>c.max_age_seconds)<=clock_timestamp())
 or (c.inactivity_seconds>0 and coalesce(s.refreshed_at,s.created_at)+make_interval(secs=>c.inactivity_seconds)<=clock_timestamp())
 then raise exception 'CONNECT_FORBIDDEN';end if;
 select * into p from public.profiles where id=actor for share;
 if p.id is null or not p.active or p.role<>'superadmin' then raise exception 'CONNECT_FORBIDDEN';end if;
 return p.mail_authorization_revision;
end$$;

create function composio_connect.human() returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb:=auth.jwt();sid uuid;actor uuid:=auth.uid();rev bigint;h text;
begin
 if current_setting('role',true)<>'authenticated' or actor is null or j->>'aal' is distinct from 'aal2'
 then raise exception 'CONNECT_FORBIDDEN';end if;
 begin sid:=(j->>'session_id')::uuid;
 if sid is null or (j->>'exp')::numeric<=extract(epoch from clock_timestamp()) or j->>'exp' is null then raise exception 'CONNECT_FORBIDDEN';end if;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'CONNECT_FORBIDDEN';end;
 h:=composio_connect.digest(sid::text);rev:=composio_connect.live_actor(actor,h);
 return jsonb_build_object('actor',actor,'session_hash',h,'actor_revision',rev);
end$$;

create function composio_connect.dto(a composio_connect.attempts) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'revision',a.revision,'state',a.state,'deadline',a.deadline,
 'account_id',s.account_id,'reserved_account_id',s.reserved_account_id,'review_id',a.review_id,
 'account_revision',coalesce(a.registration_revision,a.account_revision),'binding_id',a.result_binding_id,
 'cleanup_required',a.cleanup_required,'composio_enabled',false) from composio_connect.subjects s where s.id=a.subject_id
$$;

create function public.composio_connect_publish(p jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 if jsonb_typeof(p) is distinct from 'object' or
 exists(select 1 from jsonb_object_keys(p) k where k not in('generation','project_id','auth_config_id','quota_project_id','policy_reviewed','max_age_seconds','inactivity_seconds'))
 or coalesce(p->>'project_id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
 or coalesce(p->>'auth_config_id','') !~ '^ac_[A-Za-z0-9_-]{1,128}$'
 or coalesce(p->>'quota_project_id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
 or p->'policy_reviewed' is distinct from 'true'::jsonb or (p->>'generation')::bigint is null
 or (p->>'max_age_seconds')::integer is null or (p->>'inactivity_seconds')::integer is null
 then raise exception 'CONNECT_INVALID_INPUT';end if;
 if exists(select 1 from composio_connect.configuration where generation>=(p->>'generation')::bigint) then raise exception 'CONNECT_STALE';end if;
 insert into composio_connect.configuration values(1,(p->>'generation')::bigint,p->>'project_id',p->>'auth_config_id',p->>'quota_project_id',true,(p->>'max_age_seconds')::integer,(p->>'inactivity_seconds')::integer)
 on conflict(id) do update set generation=excluded.generation,project_id=excluded.project_id,auth_config_id=excluded.auth_config_id,
 quota_project_id=excluded.quota_project_id,policy_reviewed=true,max_age_seconds=excluded.max_age_seconds,inactivity_seconds=excluded.inactivity_seconds
 where composio_connect.configuration.generation < excluded.generation;
 if not found then raise exception 'CONNECT_STALE';end if;
end$$;

create function public.composio_connect_begin(p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare h jsonb:=composio_connect.human();actor uuid:=(h->>'actor')::uuid;c composio_connect.configuration;
 s composio_connect.subjects;a composio_connect.attempts;m public.mail_accounts;b public.operating_brands;
 r public.command_receipts;v_email text;org text;fp text;account uuid;owner_id text;head bigint;answer jsonb;
begin
 if request_key is null or jsonb_typeof(p) is distinct from 'object' or
 exists(select 1 from jsonb_object_keys(p) k where k not in('mode','email','organization','account_id','brand_id','expected_brand_revision','expected_account_revision','expected_head_revision','expected_config_generation','state_hash','browser_hash','capability_hash'))
 or coalesce(p->>'mode','') not in('new','existing','reconnect')
 or coalesce(p->>'state_hash','') !~ '^[a-f0-9]{64}$' or coalesce(p->>'browser_hash','') !~ '^[a-f0-9]{64}$'
 or coalesce(p->>'capability_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'CONNECT_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended('connect:'||actor::text||':'||request_key::text,71503));
 fp:=composio_connect.digest(p::text);
 select * into r from public.command_receipts where user_id=actor and command_receipts.request_key=composio_connect_begin.request_key;
 if found then
  if r.kind<>'composio_connect.begin' or r.fingerprint<>fp then raise exception 'CONNECT_IDEMPOTENCY_CONFLICT';end if;
  select * into a from composio_connect.attempts where id=(r.result->>'id')::uuid;
  if a.session_hash<>h->>'session_hash' then raise exception 'CONNECT_FORBIDDEN';end if;
  return composio_connect.dto(a);
 end if;
 select * into c from composio_connect.configuration where id=1;
 if (p->>'expected_config_generation')::bigint is distinct from c.generation then raise exception 'CONNECT_STALE';end if;
 if p->>'mode'='new' then
  v_email:=p->>'email';org:=p->>'organization';
  if v_email is null or v_email<>lower(btrim(v_email)) or v_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
  or length(v_email)>254 or coalesce(org,'')='' or length(org)>100 or p->>'account_id' is not null then raise exception 'CONNECT_INVALID_INPUT';end if;
  if exists(select 1 from public.mail_accounts where lower(btrim(mail_accounts.email))=v_email) then raise exception 'CONNECT_DUPLICATE';end if;
 else
  if p->>'email' is not null or p->>'organization' is not null then raise exception 'CONNECT_INVALID_INPUT';end if;
  select * into m from public.mail_accounts where id=(p->>'account_id')::uuid;
  if not found then raise exception 'CONNECT_NOT_FOUND';end if;
  if m.status not in('connected','disconnected') then raise exception 'CONNECT_NOT_READY';end if;
  v_email:=lower(btrim(m.email));org:=m.organization;account:=m.id;
  if (select count(*) from public.mail_accounts where lower(btrim(mail_accounts.email))=v_email)<>1 then raise exception 'CONNECT_DUPLICATE';end if;
 end if;
 insert into composio_connect.subjects(email,organization,reserved_account_id,account_id)
 values(v_email,org,coalesce(account,gen_random_uuid()),account) on conflict(email) do nothing;
 select * into s from composio_connect.subjects where subjects.email=v_email for update;
 if s.organization<>org or (account is not null and s.reserved_account_id<>account) or (account is null and s.account_id is not null) then raise exception 'CONNECT_DUPLICATE';end if;
 update composio_connect.attempts set state='expired',revision=revision+1 where subject_id=s.id and deadline<=clock_timestamp()
 and state in('prepared','identity_ready','awaiting_brand','ready_to_register');
 if exists(select 1 from composio_connect.attempts where subject_id=s.id and state in('prepared','identity_ready','awaiting_brand','ready_to_register','uncertain')) then raise exception 'CONNECT_CONFLICT';end if;
 select * into b from public.operating_brands where id=(p->>'brand_id')::uuid for share;
 if b.id is null or not b.active or (p->>'expected_brand_revision')::bigint is distinct from b.revision then raise exception 'CONNECT_STALE';end if;
 if account is not null then
  select * into m from public.mail_accounts where id=account for update;
  if lower(btrim(m.email))<>v_email or m.organization<>org or m.status not in('connected','disconnected') or (m.operating_brand_id is not null and m.operating_brand_id<>b.id)
  or (p->>'expected_account_revision')::bigint is distinct from m.brand_revision then raise exception 'CONNECT_STALE';end if;
 elsif (p->>'expected_account_revision')::bigint is distinct from 0::bigint then raise exception 'CONNECT_STALE';end if;
 select revision into head from public.mail_provider_binding_heads where account_id=account;
 if (p->>'expected_head_revision')::bigint is distinct from coalesce(head,0) then raise exception 'CONNECT_STALE';end if;
 select composio_user_id into owner_id from public.mail_provider_bindings where id=(select current_binding_id from public.mail_provider_binding_heads where account_id=account);
 owner_id:=coalesce(owner_id,'crm-mail:'||s.reserved_account_id::text);
 insert into composio_connect.attempts(subject_id,actor_id,session_hash,actor_revision,browser_hash,state_hash,capability_hash,
 config_generation,project_id,auth_config_id,quota_project_id,owner_id,brand_id,brand_revision,account_revision,head_revision,created_at,deadline)
 values(s.id,actor,h->>'session_hash',(h->>'actor_revision')::bigint,p->>'browser_hash',p->>'state_hash',p->>'capability_hash',
 c.generation,c.project_id,c.auth_config_id,c.quota_project_id,owner_id,b.id,b.revision,coalesce(m.brand_revision,0),coalesce(head,0),clock_timestamp(),clock_timestamp()+interval '599 seconds') returning * into a;
 answer:=composio_connect.dto(a);
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values(actor,request_key,'composio_connect.begin',fp,answer);
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(actor,'composio_connect_attempt',a.id,'composio_connect.begin');
 return answer;
exception when unique_violation then raise exception 'CONNECT_CONFLICT';
end$$;

create function public.composio_connect_observe(attempt uuid,expected_revision bigint,capability text,facts jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;s composio_connect.subjects;c composio_connect.configuration;fp text;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 select * into c from composio_connect.configuration where id=1 for share;
 select * into a from composio_connect.attempts where id=attempt;
 if a.id is null or composio_connect.digest(capability) is distinct from a.capability_hash then raise exception 'CONNECT_FORBIDDEN';end if;
 if composio_connect.live_actor(a.actor_id,a.session_hash)<>a.actor_revision then raise exception 'CONNECT_STALE';end if;
 select * into s from composio_connect.subjects where id=a.subject_id for update;
 select * into a from composio_connect.attempts where id=attempt for update;
 if jsonb_typeof(facts) is distinct from 'object' or exists(select 1 from jsonb_object_keys(facts) k where k not in('project_id','auth_config_id','owner_id','connection_id','primary_email','active','toolkit'))
 or facts->>'project_id' is distinct from a.project_id or facts->>'auth_config_id' is distinct from a.auth_config_id
 or facts->>'owner_id' is distinct from a.owner_id or facts->>'primary_email' is distinct from s.email
 or facts->'active' is distinct from 'true'::jsonb or facts->>'toolkit' is distinct from 'gmail'
 or coalesce(facts->>'connection_id','') !~ '^ca_[A-Za-z0-9_-]{1,128}$' then raise exception 'CONNECT_IDENTITY_MISMATCH';end if;
 if c.generation is distinct from a.config_generation then raise exception 'CONNECT_STALE';end if;
 fp:=composio_connect.digest(facts::text);
 if a.deadline<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
 if a.observation_digest=fp and a.state in('identity_ready','awaiting_brand','ready_to_register','completed') then return composio_connect.dto(a);end if;
 if a.deadline<=clock_timestamp() or a.state in('cancelled','expired','completed') then raise exception 'CONNECT_CLOSED';end if;
 if a.revision<>expected_revision or a.state<>'prepared' then raise exception 'CONNECT_STALE';end if;
 update composio_connect.attempts set observation_digest=fp,connection_id=facts->>'connection_id',state='identity_ready',revision=revision+1 where id=attempt returning * into a;
 return composio_connect.dto(a);
end$$;

-- An ambiguous external creation remains blocking even after its original deadline.
-- There is deliberately no blind automatic retry or administrative release in this slice.
create function public.composio_connect_uncertain(attempt uuid,expected_revision bigint,capability text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a composio_connect.attempts;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'CONNECT_FORBIDDEN';end if;
 select * into a from composio_connect.attempts where id=attempt;
 if a.id is null or composio_connect.digest(capability) is distinct from a.capability_hash then raise exception 'CONNECT_FORBIDDEN';end if;
 -- Recording uncertainty is a safety ledger, not completing an expired/revoked human intent.
 -- A request already in flight must remain accounted for even if its human session ended.
 perform 1 from composio_connect.subjects where id=a.subject_id for update;
 select * into a from composio_connect.attempts where id=attempt for update;
 if a.state='uncertain' then return composio_connect.dto(a);end if;
 if a.state in('cancelled','expired') then
  if not a.cleanup_required then
   update composio_connect.attempts set cleanup_required=true,revision=revision+1 where id=attempt returning * into a;
  end if;
  return composio_connect.dto(a);
 end if;
 if a.revision<>expected_revision or a.state<>'prepared' then raise exception 'CONNECT_STALE';end if;
 update composio_connect.attempts set state='uncertain',cleanup_required=true,revision=revision+1 where id=attempt returning * into a;
 return composio_connect.dto(a);
end$$;

-- Registration bridge writes only a new candidate; existing C/B definitions and ready predicates stay byte-identical.
create function composio_connect.register_candidate(a composio_connect.attempts,s composio_connect.subjects) returns uuid
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;h public.mail_provider_binding_heads;r public.mail_account_brand_reviews;next_revision bigint;new_id uuid;
begin
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
 insert into public.mail_provider_bindings(account_id,revision,composio_project_id,auth_config_id,connected_account_id,composio_user_id,google_quota_project_id,expected_mailbox_email,account_context,created_by)
 values(s.account_id,next_revision,a.project_id,a.auth_config_id,a.connection_id,a.owner_id,a.quota_project_id,s.email,ctx,a.actor_id) returning id into new_id;
 update public.mail_provider_binding_heads set revision=next_revision,current_binding_id=new_id,updated_by=a.actor_id,updated_at=clock_timestamp() where account_id=s.account_id;
 perform set_config('pipeline_os.c1_command','',true);
 return new_id;
exception when unique_violation then raise exception 'CONNECT_CONFLICT';
end$$;

create function public.composio_connect_command(attempt uuid,kind text,expected_revision bigint,browser_proof text,request_key uuid,review uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h jsonb:=composio_connect.human();actor uuid:=(h->>'actor')::uuid;a composio_connect.attempts;
 s composio_connect.subjects;b public.operating_brands;m public.mail_accounts;r public.mail_account_brand_reviews;
 receipt public.command_receipts;fp text;answer jsonb;effect jsonb;new_binding uuid;
begin
 if request_key is null or kind not in('materialize','adopt_brand','register','cancel') or kind is null then raise exception 'CONNECT_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended('connect:'||actor::text||':'||request_key::text,71503));
 select * into a from composio_connect.attempts where id=attempt;
 if a.id is null or a.actor_id<>actor or a.session_hash is distinct from h->>'session_hash'
 or a.browser_hash is distinct from composio_connect.digest(browser_proof) then raise exception 'CONNECT_FORBIDDEN';end if;
 select * into s from composio_connect.subjects where id=a.subject_id for update;
 select * into b from public.operating_brands where id=a.brand_id for share;
 if not b.active or b.revision<>a.brand_revision or a.actor_revision<>(h->>'actor_revision')::bigint
 or a.config_generation<>(select generation from composio_connect.configuration where id=1) then raise exception 'CONNECT_STALE';end if;
 if s.account_id is not null then select * into m from public.mail_accounts where id=s.account_id for update;end if;
 select * into a from composio_connect.attempts where id=attempt for update;
 fp:=composio_connect.digest(jsonb_build_object('attempt',attempt,'kind',kind,'revision',expected_revision,'review',review)::text);
 select * into receipt from public.command_receipts where user_id=actor and command_receipts.request_key=composio_connect_command.request_key;
 if found then
  if receipt.kind<>'composio_connect.'||kind or receipt.fingerprint<>fp then raise exception 'CONNECT_IDEMPOTENCY_CONFLICT';end if;
  if a.deadline<=clock_timestamp() then raise exception 'CONNECT_CLOSED';end if;
  return receipt.result;
 end if;
 if a.deadline<=clock_timestamp() or a.state in('completed','cancelled','expired') then raise exception 'CONNECT_CLOSED';end if;
 if a.revision<>expected_revision then raise exception 'CONNECT_STALE';end if;
 if kind='cancel' then
  update composio_connect.attempts set state='cancelled',revision=revision+1 where id=attempt returning * into a;
 elsif kind='materialize' then
  if a.state<>'identity_ready' or a.connection_id is null then raise exception 'CONNECT_NOT_READY';end if;
  if s.account_id is null then
   if exists(select 1 from public.mail_accounts where lower(btrim(email))=s.email) then raise exception 'CONNECT_DUPLICATE';end if;
   insert into public.mail_accounts(id,email,organization,status,live_enabled,sync_enabled)
   values(s.reserved_account_id,s.email,s.organization,'disconnected',false,false) returning * into m;
   update composio_connect.subjects set account_id=m.id where id=s.id returning * into s;
  end if;
  if m.email<>s.email or m.organization<>s.organization or m.brand_revision<>a.account_revision or m.status not in('connected','disconnected') then raise exception 'CONNECT_STALE';end if;
  select * into r from public.mail_account_brand_reviews where account_id=m.id and status='confirmed' and proposed_brand_id=b.id
  and expected_account_revision=m.brand_revision-1 order by created_at desc,id limit 1;
  if r.id is not null and m.operating_brand_id=b.id then
   update composio_connect.attempts set review_id=r.id,registration_revision=m.brand_revision,registration_review_revision=r.revision,
   state='ready_to_register',revision=revision+1 where id=attempt returning * into a;
  else
   if exists(select 1 from public.mail_account_brand_reviews where account_id=m.id and status in('pending','conflict')) then raise exception 'CONNECT_STALE';end if;
   effect:=brand_b1.impact(m.id);
   if coalesce((effect->>'queued')::bigint,0)+coalesce((effect->>'sending')::bigint,0)+coalesce((effect->>'uncertain')::bigint,0)+coalesce((effect->>'active_campaigns')::bigint,0)>0
   then raise exception 'CONNECT_NOT_READY';end if;
   insert into public.mail_account_brand_reviews(account_id,proposed_brand_id,status,expected_account_revision,evidence_reference,request_key,created_by,
    history_approved,history_from,history_to,proposed_brand_revision,impact_fingerprint)
   values(m.id,b.id,'pending',m.brand_revision,'connect:'||a.id::text,gen_random_uuid(),actor,false,null,null,b.revision,effect->>'fingerprint') returning * into r;
   update composio_connect.attempts set review_id=r.id,state='awaiting_brand',revision=revision+1 where id=attempt returning * into a;
  end if;
 elsif kind='adopt_brand' then
  if a.state<>'awaiting_brand' or a.review_id is distinct from review then raise exception 'CONNECT_NOT_READY';end if;
  select * into r from public.mail_account_brand_reviews where id=review for share;
  if r.status is distinct from 'confirmed' or r.account_id<>s.account_id or r.proposed_brand_id is distinct from a.brand_id
  or r.expected_account_revision<>a.account_revision or m.brand_revision<>a.account_revision+1 or m.operating_brand_id is distinct from a.brand_id
  or r.proposed_brand_revision<>b.revision then raise exception 'CONNECT_STALE';end if;
  update composio_connect.attempts set registration_revision=m.brand_revision,registration_review_revision=r.revision,state='ready_to_register',revision=revision+1 where id=attempt returning * into a;
 elsif kind='register' then
  if a.state<>'ready_to_register' or a.observation_digest is null then raise exception 'CONNECT_NOT_READY';end if;
  new_binding:=composio_connect.register_candidate(a,s);
  update composio_connect.attempts set result_binding_id=new_binding,state='completed',revision=revision+1 where id=attempt returning * into a;
 end if;
 answer:=composio_connect.dto(a);
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values(actor,request_key,'composio_connect.'||kind,fp,answer);
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(actor,'composio_connect_attempt',attempt,'composio_connect.'||kind);
 return answer;
exception when unique_violation then raise exception 'CONNECT_CONFLICT';
end$$;

revoke all on all functions in schema composio_connect from public,anon,authenticated,service_role;
revoke all on function public.composio_connect_publish(jsonb),public.composio_connect_begin(jsonb,uuid),
 public.composio_connect_observe(uuid,bigint,text,jsonb),public.composio_connect_uncertain(uuid,bigint,text),public.composio_connect_command(uuid,text,bigint,text,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.composio_connect_publish(jsonb),public.composio_connect_observe(uuid,bigint,text,jsonb),public.composio_connect_uncertain(uuid,bigint,text) to service_role;
grant execute on function public.composio_connect_begin(jsonb,uuid),public.composio_connect_command(uuid,text,bigint,text,uuid,uuid) to authenticated;
commit;
