-- QGR-I04 LOCAL ONLY. No ordinal or authorization to apply on the CRM.
begin;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout='5s';
do $$begin
 if current_setting('pipeline_os.qgr_i04_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^qgr_i02_i04_[a-z0-9_]+$' or inet_server_addr() is distinct from '127.0.0.1'::inet
 or current_setting('server_version_num')::integer not between 150000 and 159999 then raise exception 'QGR_I04_LOCAL_ONLY';end if;
 if to_regclass('mail_quota.reservations') is null or to_regnamespace('mail_runtime') is null
 or to_regclass('mail_quota.binding_contexts') is not null then raise exception 'QGR_I04_BASE_MISMATCH';end if;
end$$;

create table mail_quota.binding_contexts(
 account_id uuid primary key references public.mail_accounts on delete restrict,
 auth_config_id text not null check(auth_config_id ~ '^ac_[A-Za-z0-9_-]{1,128}$'),
 document text not null check(octet_length(document)<=8192),context jsonb not null,
 digest text not null check(digest ~ '^[a-f0-9]{64}$'),generation bigint not null check(generation between 1 and 9007199254740991)
);
create table mail_quota.binding_budgets(
 account_id uuid primary key references public.mail_accounts on delete restrict,context_digest text not null,
 maximum integer not null check(maximum between 1 and 4),used integer not null default 0 check(used between 0 and maximum),
 expires_at timestamptz not null,actor_id uuid not null references public.profiles on delete restrict,session_id uuid not null,
 issued_at timestamptz not null default clock_timestamp(),check(expires_at>issued_at and expires_at-issued_at<=interval '30 minutes')
);
create table mail_quota.binding_checks(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,binding_id uuid not null,
 binding_revision bigint not null,head_revision bigint not null,actor_id uuid not null references public.profiles on delete restrict,
 actor_revision bigint not null,session_id uuid not null,account_context jsonb not null,account_xmin text not null,
 context_digest text not null,config_generation bigint not null,nonce_hash text not null unique check(nonce_hash ~ '^[a-f0-9]{64}$'),
 started_at timestamptz not null default clock_timestamp(),deadline timestamptz not null,
 status text not null default 'prepared' check(status in('prepared','completed','failed','expired')),
 requests integer not null default 0 check(requests between 0 and 4),facts jsonb,evidence jsonb,valid_until timestamptz,confirmed_at timestamptz,
 foreign key(account_id,binding_id) references public.mail_provider_bindings(account_id,id) on delete restrict,
 check(deadline>started_at and deadline-started_at<=interval '30 seconds'),
 check(status<>'completed' or (requests=4 and facts is not null and evidence is not null and valid_until is not null)),
 check(confirmed_at is null or (status='completed' and confirmed_at<=valid_until))
);
create unique index qgr_one_prepared_check on mail_quota.binding_checks(binding_id) where status='prepared';
create index qgr_check_history on mail_quota.binding_checks(account_id,started_at desc,id desc);
alter table mail_quota.binding_contexts enable row level security;
alter table mail_quota.binding_budgets enable row level security;
alter table mail_quota.binding_checks enable row level security;
revoke all on mail_quota.binding_contexts,mail_quota.binding_budgets,mail_quota.binding_checks from public,anon,authenticated,service_role;

create function mail_quota.binding_config(account uuid) returns mail_quota.binding_contexts
language plpgsql security definer set search_path='' as $$
declare c mail_quota.binding_contexts;h mail_quota.head;
begin
 select * into c from mail_quota.binding_contexts where account_id=account for share;
 select * into h from mail_quota.head where id=1 for share;
 if c.account_id is null or h.closed or h.policy_id is distinct from (c.context#>>'{policy,policy_id}')::uuid
 or h.generation is distinct from (c.context#>>'{policy,generation}')::bigint
 or not exists(select 1 from mail_quota.policies p where p.policy_id=h.policy_id and p.generation=h.generation and p.policy=c.context->'policy' and p.policy->>'state'='enabled')
 then raise exception 'C_BINDING_UNAVAILABLE';end if;
 return c;
end$$;
create function public.composio_binding_check_context_v2(account uuid,auth_config text,context_document text,context_digest text)
returns void language plpgsql security definer set search_path='' as $$
declare v jsonb;c mail_quota.binding_contexts;h mail_quota.head;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'C_BINDING_FORBIDDEN';end if;
 if context_document is null or octet_length(context_document)>8192 then raise exception 'C_BINDING_INVALID_INPUT';end if;
 v:=context_document::jsonb;
 if v->'contract_version' is distinct from '2'::jsonb or v->>'project_provenance' is distinct from 'server_reviewed'
 or (select count(*) from jsonb_object_keys(v))<>7
 or not(v ?& array['contract_version','composio_project_id','credential_version','auth_config_revision','provenance_reference','project_provenance','policy'])
 or coalesce(v->>'composio_project_id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
 or coalesce(auth_config,'') !~ '^ac_[A-Za-z0-9_-]{1,128}$'
 or exists(select 1 from unnest(array['credential_version','auth_config_revision','provenance_reference']) k where jsonb_typeof(v->k)<>'string' or length(v->>k) not between 1 and 128 or v->>k ~ '[[:cntrl:]]')
 or v->'policy' is distinct from mail_quota.policy(v->'policy')
 or context_digest is distinct from encode(sha256(convert_to('QGR-C2-v2','UTF8')||decode('00','hex')||convert_to(context_document,'UTF8')),'hex')
 then raise exception 'C_BINDING_INVALID_INPUT';end if;
 perform 1 from public.mail_accounts where id=account for share;
 if not found then raise exception 'C_BINDING_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('qgr-v2:'||account::text,71504));
 select * into c from mail_quota.binding_contexts where account_id=account for update;
 if c.account_id is null then
  insert into mail_quota.binding_contexts values(account,auth_config,context_document,v,context_digest,1);
 elsif (c.document,c.auth_config_id) is distinct from (context_document,auth_config) then
  update mail_quota.binding_contexts set auth_config_id=auth_config,document=context_document,context=v,digest=context_digest,generation=generation+1 where account_id=account;
 end if;
 perform mail_quota.binding_config(account);
end$$;

create function mail_quota.binding_human(account uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u jsonb:=mail_quota.human();ctx jsonb;
begin ctx:=composio_c1.context_locked(account,(u->>'actor')::uuid);return u||jsonb_build_object('context',ctx);end$$;
create function public.composio_binding_authorize_v2(account uuid) returns void language plpgsql security definer set search_path='' as $$begin perform mail_quota.binding_human(account);end$$;
create function mail_quota.binding_expected(p jsonb,ctx jsonb,h public.mail_provider_binding_heads) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(p->'expected_head_revision'=to_jsonb(coalesce(h.revision,0))
 and p->'expected_account_revision'=ctx->'account_revision' and p->'expected_brand_revision'=ctx->'brand_revision'
 and p->>'expected_context_hash'=encode(sha256(convert_to(ctx::text,'UTF8')),'hex'),false)
$$;
create function mail_quota.binding_check_current(c mail_quota.binding_checks) returns boolean
language plpgsql security definer set search_path='' as $$
declare cfg mail_quota.binding_contexts;ctx jsonb;h public.mail_provider_binding_heads;b public.mail_provider_bindings;p public.profiles;s auth.sessions;
begin
 cfg:=mail_quota.binding_config(c.account_id);
 ctx:=composio_c1.context_locked(c.account_id,c.actor_id);
 select * into h from public.mail_provider_binding_heads where account_id=c.account_id for update;
 select * into b from public.mail_provider_bindings where id=h.current_binding_id for update;
 select * into p from public.profiles where id=c.actor_id for share;
 select * into s from auth.sessions where id=c.session_id and user_id=c.actor_id for share;
 return coalesce(b.id=c.binding_id and b.quota_contract_version=2 and b.status in('candidate','blocked')
 and b.revision=c.binding_revision and h.revision=c.head_revision and b.account_context=ctx and ctx=c.account_context
 and (ctx->>'ready')::boolean and cfg.digest=c.context_digest and cfg.generation=c.config_generation
 and b.quota_policy_id=(cfg.context#>>'{policy,policy_id}')::uuid and b.quota_policy_generation=(cfg.context#>>'{policy,generation}')::bigint
 and p.active and p.role='superadmin' and p.mail_authorization_revision=c.actor_revision and s.id is not null
 and (s.not_after is null or s.not_after>clock_timestamp())
 and c.account_xmin=(select xmin::text from public.mail_accounts where id=c.account_id),false);
exception when raise_exception then return false;
end$$;
create function mail_quota.binding_ticket(check_id uuid,nonce text,context_digest text) returns mail_quota.binding_checks
language plpgsql security definer set search_path='' as $$
declare c mail_quota.binding_checks;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'C_BINDING_FORBIDDEN';end if;
 select * into c from mail_quota.binding_checks where id=check_id;
 if c.id is null or nonce is null or nonce !~ '^[a-f0-9]{64}$' or c.nonce_hash<>encode(sha256(convert_to(nonce,'UTF8')),'hex') then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
 -- Account/context locks precede check/budget rows across the whole protocol.
 if not mail_quota.binding_check_current(c) then raise exception 'C_BINDING_STALE';end if;
 select * into c from mail_quota.binding_checks where id=check_id for update;
 if c.status<>'prepared' or c.deadline<=clock_timestamp() or c.context_digest is distinct from context_digest then raise exception 'C_BINDING_STALE';end if;
 return c;
end$$;
create function public.composio_binding_budget_v2(account uuid,context_digest text,maximum integer,expires_at timestamptz,request_key uuid,included_confirmed boolean)
returns void language plpgsql security definer set search_path='' as $$
declare u jsonb:=mail_quota.binding_human(account);cfg mail_quota.binding_contexts;fp text;r public.command_receipts;
begin
 cfg:=mail_quota.binding_config(account);
 if request_key is null or included_confirmed is distinct from true or maximum is null or maximum not between 1 and 4
 or expires_at is null or expires_at<=clock_timestamp() or expires_at>clock_timestamp()+interval '30 minutes' or cfg.digest is distinct from context_digest then raise exception 'C_BINDING_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended((u->>'actor')||request_key::text,71504));
 fp:=encode(sha256(convert_to(jsonb_build_array(account,context_digest,maximum,expires_at,included_confirmed)::text,'UTF8')),'hex');
 select * into r from public.command_receipts where user_id=(u->>'actor')::uuid and command_receipts.request_key=composio_binding_budget_v2.request_key;
 if found then if r.kind<>'qgr.v2.budget' or r.fingerprint<>fp then raise exception 'C_BINDING_IDEMPOTENCY_CONFLICT';end if;return;end if;
 if exists(select 1 from mail_quota.binding_checks where account_id=account and status='prepared' and deadline>clock_timestamp()) then raise exception 'C_BINDING_CONFLICT';end if;
 insert into mail_quota.binding_budgets(account_id,context_digest,maximum,expires_at,actor_id,session_id)
 values(account,context_digest,maximum,expires_at,(u->>'actor')::uuid,(u->>'session')::uuid)
 on conflict(account_id) do update set context_digest=excluded.context_digest,maximum=excluded.maximum,used=0,expires_at=excluded.expires_at,actor_id=excluded.actor_id,session_id=excluded.session_id,issued_at=clock_timestamp();
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values((u->>'actor')::uuid,request_key,'qgr.v2.budget',fp,'{}');
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values((u->>'actor')::uuid,'mail_account',account,'qgr.v2.budget');
end$$;

create function public.composio_binding_page_v2(account uuid,cursor text default null,page_size integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u jsonb:=mail_quota.binding_human(account);v jsonb;c mail_quota.binding_checks;cfg mail_quota.binding_contexts;budget mail_quota.binding_budgets;b public.mail_provider_bindings;h public.mail_provider_binding_heads;fresh boolean:=false;cancheck boolean:=false;policy_enabled boolean:=false;
begin
 v:=public.composio_binding_page(account,cursor,page_size);
 select * into cfg from mail_quota.binding_contexts where account_id=account;
 policy_enabled:=exists(select 1 from mail_quota.head q join mail_quota.policies p on p.policy_id=q.policy_id and p.generation=q.generation where q.id=1 and not q.closed and p.policy=cfg.context->'policy' and p.policy->>'state'='enabled');
 select * into h from public.mail_provider_binding_heads where account_id=account;
 select * into b from public.mail_provider_bindings where id=h.current_binding_id;
 select * into c from mail_quota.binding_checks where account_id=account and binding_id=b.id order by started_at desc,id desc limit 1;
 if c.id is not null then fresh:=mail_quota.binding_check_current(c);end if;
 select * into budget from mail_quota.binding_budgets where account_id=account;
 cancheck:=coalesce(policy_enabled and b.quota_contract_version=2 and b.status in('candidate','blocked') and (u#>>'{context,ready}')::boolean
 and budget.actor_id=(u->>'actor')::uuid and budget.session_id=(u->>'session')::uuid and budget.context_digest=cfg.digest
 and budget.expires_at>clock_timestamp() and budget.maximum-budget.used>=4
 and not exists(select 1 from mail_quota.binding_checks where binding_id=b.id and status='prepared' and deadline>clock_timestamp()),false);
 return v||jsonb_build_object('contract_version',2,
 'policy',case when cfg.account_id is not null then jsonb_build_object('id',cfg.context#>'{policy,policy_id}','generation',cfg.context#>'{policy,generation}','enabled',policy_enabled) end,
 'verification_available',cancheck,'can_confirm',coalesce(fresh and c.status='completed' and c.confirmed_at is null and c.valid_until>clock_timestamp() and c.deadline>clock_timestamp() and c.actor_id=(u->>'actor')::uuid and c.session_id=(u->>'session')::uuid,false),
 'latest_check',case when c.id is not null then jsonb_build_object('id',c.id,'status',case when c.confirmed_at is null and least(c.deadline,coalesce(c.valid_until,c.deadline))<=clock_timestamp() then 'expired' else c.status end,'valid_until',c.valid_until) end);
end$$;

create function public.composio_binding_command_v2(account uuid,kind text,p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u jsonb:=mail_quota.binding_human(account);ctx jsonb:=u->'context';cfg mail_quota.binding_contexts;h public.mail_provider_binding_heads;b public.mail_provider_bindings;c mail_quota.binding_checks;r public.command_receipts;fp text;answer jsonb;new_id uuid;rev bigint;keys text[];k text;
begin
 if kind='revoke_binding' then select * into cfg from mail_quota.binding_contexts where account_id=account;else cfg:=mail_quota.binding_config(account);end if;
 keys:=array['expected_head_revision','expected_account_revision','expected_brand_revision','expected_context_hash'];
 if kind='register_candidate' then keys:=keys||array['composio_project_id','auth_config_id','connected_account_id','composio_user_id'];
 elsif kind='confirm_binding' then keys:=keys||array['binding_id','check_id'];
 elsif kind='revoke_binding' then keys:=keys||array['binding_id','reason'];else raise exception 'C_BINDING_INVALID_INPUT';end if;
 if request_key is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16384 or not(p ?& keys) or (select count(*) from jsonb_object_keys(p))<>cardinality(keys) then raise exception 'C_BINDING_INVALID_INPUT';end if;
 foreach k in array keys loop
  if k=any(array['expected_head_revision','expected_account_revision','expected_brand_revision']) then
   if jsonb_typeof(p->k)<>'number' or p->>k !~ '^(0|[1-9][0-9]{0,15})$' or (p->>k)::numeric>9007199254740991 then raise exception 'C_BINDING_INVALID_INPUT';end if;
  elsif jsonb_typeof(p->k)<>'string' then raise exception 'C_BINDING_INVALID_INPUT';end if;
 end loop;
 if p->>'expected_context_hash' !~ '^[a-f0-9]{64}$' then raise exception 'C_BINDING_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended((u->>'actor')||request_key::text,71504));
 fp:=encode(sha256(convert_to(jsonb_build_array(account,kind,p)::text,'UTF8')),'hex');
 select * into r from public.command_receipts where user_id=(u->>'actor')::uuid and command_receipts.request_key=composio_binding_command_v2.request_key;
 if found then if r.kind<>'qgr.v2.'||kind or r.fingerprint<>fp then raise exception 'C_BINDING_IDEMPOTENCY_CONFLICT';end if;return r.result;end if;
 select * into h from public.mail_provider_binding_heads where account_id=account for update;
 if not mail_quota.binding_expected(p,ctx,h) then raise exception 'C_BINDING_STALE';end if;
 select * into b from public.mail_provider_bindings where id=h.current_binding_id for update;
 rev:=coalesce(h.revision,0)+1;
 perform set_config('pipeline_os.c1_command',u->>'actor',true);
 if kind='register_candidate' then
  if not(ctx->>'ready')::boolean then raise exception 'C_BINDING_ACCOUNT_NOT_READY';end if;
  if p->>'composio_project_id' is distinct from cfg.context->>'composio_project_id' or p->>'auth_config_id' is distinct from cfg.auth_config_id then raise exception 'C_BINDING_STALE';end if;
  if h.account_id is null then insert into public.mail_provider_binding_heads(account_id,updated_by) values(account,(u->>'actor')::uuid);end if;
  update public.mail_provider_bindings set status='superseded',reason='replaced' where id=h.current_binding_id and status in('candidate','blocked','verified');
  insert into public.mail_provider_bindings(account_id,revision,composio_project_id,auth_config_id,connected_account_id,composio_user_id,google_quota_project_id,expected_mailbox_email,account_context,created_by,quota_contract_version,quota_policy_id,quota_policy_generation)
  values(account,rev,p->>'composio_project_id',p->>'auth_config_id',p->>'connected_account_id',p->>'composio_user_id',null,ctx->>'email',ctx,(u->>'actor')::uuid,2,(cfg.context#>>'{policy,policy_id}')::uuid,(cfg.context#>>'{policy,generation}')::bigint) returning id into new_id;
 elsif kind='confirm_binding' then
  select * into c from mail_quota.binding_checks where id=(p->>'check_id')::uuid for update;
  if c.id is null or c.binding_id is distinct from (p->>'binding_id')::uuid or c.actor_id is distinct from (u->>'actor')::uuid or c.session_id is distinct from (u->>'session')::uuid
  or c.status<>'completed' or c.confirmed_at is not null or c.valid_until<=clock_timestamp() or c.deadline<=clock_timestamp() or not mail_quota.binding_check_current(c) then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
  update mail_quota.binding_checks set confirmed_at=clock_timestamp() where id=c.id;
  perform set_config('pipeline_os.c2_write','confirm',true);
  update public.mail_provider_bindings set status='verified',reason=null,revision=rev,reviewed_by=(u->>'actor')::uuid,reviewed_at=clock_timestamp() where id=c.binding_id returning id into new_id;
 elsif kind='revoke_binding' then
  if b.id is null or b.id is distinct from (p->>'binding_id')::uuid or b.quota_contract_version<>2 or b.status not in('candidate','verified','blocked') or p->>'reason' not in('operator_revoked','connection_changed','incorrect_setup') then raise exception 'C_BINDING_STALE';end if;
  update public.mail_provider_bindings set status='revoked',reason=p->>'reason',revision=rev where id=b.id returning id into new_id;
 end if;
 update public.mail_provider_binding_heads set revision=rev,current_binding_id=new_id,updated_by=(u->>'actor')::uuid,updated_at=clock_timestamp() where account_id=account;
 answer:=jsonb_build_object('contract_version',2,'id',new_id,'head_revision',rev,'status',case kind when 'register_candidate' then 'candidate' when 'confirm_binding' then 'verified' else 'revoked' end,'transport','gmail_oauth','composio_enabled',false);
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values((u->>'actor')::uuid,request_key,'qgr.v2.'||kind,fp,answer);
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values((u->>'actor')::uuid,'mail_provider_binding',new_id,'qgr.v2.'||kind);
 perform set_config('pipeline_os.c1_command','',true);perform set_config('pipeline_os.c2_write','',true);return answer;
exception when unique_violation then raise exception 'C_BINDING_CONFLICT';end$$;

create function public.composio_binding_check_begin_v2(account uuid,binding uuid,expected jsonb,context_digest text,nonce_hash text,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u jsonb:=mail_quota.binding_human(account);cfg mail_quota.binding_contexts;h public.mail_provider_binding_heads;b public.mail_provider_bindings;budget mail_quota.binding_budgets;c mail_quota.binding_checks;r public.command_receipts;fp text;answer jsonb;new_id uuid:=gen_random_uuid();v_started timestamptz;
begin
 cfg:=mail_quota.binding_config(account);
 if request_key is null or binding is null or nonce_hash is null or nonce_hash !~ '^[a-f0-9]{64}$' or cfg.digest is distinct from context_digest
 or jsonb_typeof(expected) is distinct from 'object' or (select count(*) from jsonb_object_keys(expected))<>4
 or not(expected ?& array['expected_head_revision','expected_account_revision','expected_brand_revision','expected_context_hash']) then raise exception 'C_BINDING_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended((u->>'actor')||request_key::text,71504));
 fp:=encode(sha256(convert_to(jsonb_build_array(account,binding,expected,context_digest)::text,'UTF8')),'hex');
 select * into r from public.command_receipts where user_id=(u->>'actor')::uuid and command_receipts.request_key=composio_binding_check_begin_v2.request_key;
 if found then
  if r.kind<>'qgr.v2.check' or r.fingerprint<>fp then raise exception 'C_BINDING_IDEMPOTENCY_CONFLICT';end if;
  select * into c from mail_quota.binding_checks where id=(r.result->>'id')::uuid;
  return jsonb_build_object('contract_version',2,'id',c.id,'status',case when c.confirmed_at is null and least(c.deadline,coalesce(c.valid_until,c.deadline))<=clock_timestamp() then 'expired' else c.status end,'replay',true,'valid_until',c.valid_until);
 end if;
 select * into h from public.mail_provider_binding_heads where account_id=account for update;
 select * into b from public.mail_provider_bindings where id=h.current_binding_id for update;
 if b.id is distinct from binding or b.quota_contract_version<>2 or b.status not in('candidate','blocked') or b.account_context is distinct from u->'context' or not mail_quota.binding_expected(expected,u->'context',h) then raise exception 'C_BINDING_STALE';end if;
 select * into budget from mail_quota.binding_budgets where account_id=account for update;
 if budget.account_id is null or budget.context_digest<>cfg.digest or budget.actor_id<>(u->>'actor')::uuid or budget.session_id<>(u->>'session')::uuid or budget.expires_at<=clock_timestamp() or budget.maximum-budget.used<4 then raise exception 'C_BINDING_UNAVAILABLE';end if;
 update mail_quota.binding_checks set status='expired' where binding_id=binding and status='prepared' and deadline<=clock_timestamp();
 v_started:=clock_timestamp();
 insert into mail_quota.binding_checks(id,account_id,binding_id,binding_revision,head_revision,actor_id,actor_revision,session_id,account_context,account_xmin,context_digest,config_generation,nonce_hash,started_at,deadline)
 values(new_id,account,binding,b.revision,h.revision,(u->>'actor')::uuid,(select mail_authorization_revision from public.profiles where id=(u->>'actor')::uuid),(u->>'session')::uuid,u->'context',(select xmin::text from public.mail_accounts where id=account),cfg.digest,cfg.generation,nonce_hash,v_started,v_started+interval '30 seconds');
 answer:=jsonb_build_object('contract_version',2,'id',new_id,'status','prepared','replay',false,'valid_until',null);
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values((u->>'actor')::uuid,request_key,'qgr.v2.check',fp,answer);
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values((u->>'actor')::uuid,'mail_provider_binding',binding,'qgr.v2.check_begin');return answer;
exception when unique_violation then raise exception 'C_BINDING_CONFLICT';end$$;
create function public.composio_binding_check_snapshot_v2(check_id uuid,nonce text,context_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c mail_quota.binding_checks:=mail_quota.binding_ticket(check_id,nonce,context_digest);b public.mail_provider_bindings;
begin select * into b from public.mail_provider_bindings where id=c.binding_id;
 return jsonb_build_object('contract_version',2,'account_id',b.account_id,'binding_id',b.id,'binding_revision',b.revision,'composio_project_id',b.composio_project_id,'auth_config_id',b.auth_config_id,'connected_account_id',b.connected_account_id,'composio_user_id',b.composio_user_id,'quota_policy_id',b.quota_policy_id,'quota_policy_generation',b.quota_policy_generation,'expected_mailbox_email',b.expected_mailbox_email);end$$;
create function public.composio_binding_check_admit_v2(check_id uuid,nonce text,context_digest text,step integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare c mail_quota.binding_checks:=mail_quota.binding_ticket(check_id,nonce,context_digest);b mail_quota.binding_budgets;
begin
 select * into b from mail_quota.binding_budgets where account_id=c.account_id for update;
 if step is null or step not between 1 and 4 or c.requests<>step-1 or b.context_digest<>c.context_digest or b.actor_id<>c.actor_id or b.session_id<>c.session_id or b.used>=b.maximum or b.expires_at<=clock_timestamp() then raise exception 'C_BINDING_UNAVAILABLE';end if;
 update mail_quota.binding_budgets set used=used+1 where account_id=c.account_id;
 update mail_quota.binding_checks set requests=step where id=c.id;return true;
end$$;
create function public.composio_binding_check_finish_v2(check_id uuid,nonce text,context_digest text,facts jsonb,evidence jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c mail_quota.binding_checks:=mail_quota.binding_ticket(check_id,nonce,context_digest);pass boolean;k text;v_until timestamptz;
begin
 if jsonb_typeof(facts) is distinct from 'object' or (select count(*) from jsonb_object_keys(facts))<>12 or facts->'contract_version' is distinct from '2'::jsonb
 or not(facts ?& array['project','config','connection','owner','toolkit','active','mailbox','permissions','quota_policy','configuration','reason']) then raise exception 'C_BINDING_INVALID_INPUT';end if;
 foreach k in array array['project','config','connection','owner','toolkit','active','mailbox','permissions','quota_policy','configuration'] loop
  if jsonb_typeof(facts->k) is distinct from 'boolean' then raise exception 'C_BINDING_INVALID_INPUT';end if;
 end loop;
 pass:=facts->'reason'='null'::jsonb and not exists(select 1 from unnest(array['project','config','connection','owner','toolkit','active','mailbox','permissions','quota_policy','configuration']) x where facts->x is distinct from 'true'::jsonb);
 if pass then
  if c.requests<>4 or jsonb_typeof(evidence) is distinct from 'object' or (select count(*) from jsonb_object_keys(evidence))<>3
  or evidence->>'source' is distinct from 'google-tokeninfo-proxy-v1'
  or jsonb_typeof(evidence->'observed_at_ms') is distinct from 'number' or jsonb_typeof(evidence->'valid_until_ms') is distinct from 'number' then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
  v_until:=least(c.deadline,to_timestamp((evidence->>'valid_until_ms')::numeric/1000));
  if v_until<=clock_timestamp() or to_timestamp((evidence->>'observed_at_ms')::numeric/1000)<c.started_at-interval '1 second'
  or to_timestamp((evidence->>'observed_at_ms')::numeric/1000)>clock_timestamp()
  or (evidence->>'valid_until_ms')::numeric-(evidence->>'observed_at_ms')::numeric not between 1 and 60000 then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
 elsif facts->>'reason' is null or facts->>'reason' not in('identity_mismatch','verification_incomplete','permission_unproven','stale_context','provider_unavailable') then raise exception 'C_BINDING_INVALID_INPUT';end if;
 update mail_quota.binding_checks set status=case when pass then 'completed' else 'failed' end,facts=composio_binding_check_finish_v2.facts,evidence=case when pass then composio_binding_check_finish_v2.evidence end,valid_until=v_until where id=c.id;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(c.actor_id,'mail_provider_binding',c.binding_id,'qgr.v2.check_finish');
 return jsonb_build_object('contract_version',2,'id',c.id,'status',case when pass then 'completed' else 'failed' end,'replay',false,'valid_until',v_until);
end$$;

-- Enable verified v2 only in the same transaction as sealed checks and a restrictive trigger.
alter table public.mail_provider_bindings drop constraint binding_quota_contract_check;
alter table public.mail_provider_bindings add constraint binding_quota_contract_check check(
 (quota_contract_version=1 and google_quota_project_id is not null and quota_policy_id is null and quota_policy_generation is null)
 or (quota_contract_version=2 and google_quota_project_id is null and quota_policy_id is not null and quota_policy_generation is not null));
create function mail_quota.binding_verified_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.quota_contract_version=2 and new.status='verified' and (tg_op='INSERT' or old.status is distinct from 'verified') then
  if current_setting('role',true)<>'authenticated' or current_setting('pipeline_os.c2_write',true) is distinct from 'confirm'
  or not exists(select 1 from mail_quota.binding_checks c where c.binding_id=new.id and c.status='completed' and c.confirmed_at is not null and c.actor_id=auth.uid()
   and c.binding_revision+1=new.revision and c.valid_until>=clock_timestamp() and c.deadline>clock_timestamp() and mail_quota.binding_check_current(c)) then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
 end if;return new;
end$$;
create trigger qgr_v2_verified_guard before insert or update on public.mail_provider_bindings for each row execute function mail_quota.binding_verified_guard();

revoke all on all functions in schema mail_quota from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_authorize_v2(uuid),public.composio_binding_page_v2(uuid,text,integer),public.composio_binding_command_v2(uuid,text,jsonb,uuid),public.composio_binding_check_begin_v2(uuid,uuid,jsonb,text,text,uuid),public.composio_binding_budget_v2(uuid,text,integer,timestamptz,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.composio_binding_authorize_v2(uuid),public.composio_binding_page_v2(uuid,text,integer),public.composio_binding_command_v2(uuid,text,jsonb,uuid),public.composio_binding_check_begin_v2(uuid,uuid,jsonb,text,text,uuid),public.composio_binding_budget_v2(uuid,text,integer,timestamptz,uuid,boolean) to authenticated;
revoke all on function public.composio_binding_check_context_v2(uuid,text,text,text),public.composio_binding_check_snapshot_v2(uuid,text,text),public.composio_binding_check_admit_v2(uuid,text,text,integer),public.composio_binding_check_finish_v2(uuid,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.composio_binding_check_context_v2(uuid,text,text,text),public.composio_binding_check_snapshot_v2(uuid,text,text),public.composio_binding_check_admit_v2(uuid,text,text,integer),public.composio_binding_check_finish_v2(uuid,text,text,jsonb,jsonb) to service_role;
-- I04-R generated offline from sealed v1 declarations.
-- Included by add-i04-runtime.mjs inside the local-only transaction.
do $$begin
 if current_setting('pipeline_os.qgr_i04_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^qgr_i02_i04_[a-z0-9_]+$' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'QGR_I04_LOCAL_ONLY';end if;
end$$;
create function mail_quota.binding_confirmed(b public.mail_provider_bindings,ctx jsonb) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from mail_quota.binding_checks c join mail_quota.binding_contexts cfg on cfg.account_id=c.account_id
 join public.mail_provider_binding_heads h on h.account_id=c.account_id
 join public.profiles p on p.id=c.actor_id
 join mail_quota.head q on q.id=1 join mail_quota.policies policy on policy.policy_id=q.policy_id and policy.generation=q.generation
 where b.quota_contract_version=2 and b.status='verified' and h.current_binding_id=b.id and h.revision=b.revision
 and c.binding_id=b.id and c.status='completed' and c.confirmed_at is not null and c.binding_revision+1=b.revision
 and c.actor_revision=p.mail_authorization_revision and p.active and p.role='superadmin'
 and c.account_context=ctx and b.account_context=ctx and (ctx->>'ready')::boolean and b.expected_mailbox_email=ctx->>'email'
 and c.context_digest=cfg.digest and c.config_generation=cfg.generation and cfg.auth_config_id=b.auth_config_id
 and cfg.context->>'composio_project_id'=b.composio_project_id
 and b.quota_policy_id=q.policy_id and b.quota_policy_generation=q.generation and not q.closed and policy.policy->>'state'='enabled'
 and cfg.context->'policy'=policy.policy)
$$;
do $copy$ declare d text;begin
 select pg_get_functiondef('public.mail_transport_command(uuid,text,jsonb,uuid)'::regprocedure) into d;
 d:=replace(d,'CREATE OR REPLACE FUNCTION '||split_part('public.mail_transport_command(uuid,text,jsonb,uuid)','(',1)||'(', 'CREATE OR REPLACE FUNCTION mail_runtime.command_v1(');
 execute d;end $copy$;
do $copy$ declare d text;begin
 select pg_get_functiondef('mail_runtime.binding_approved(public.mail_provider_bindings,jsonb)'::regprocedure) into d;
 d:=replace(d,'CREATE OR REPLACE FUNCTION '||split_part('mail_runtime.binding_approved(public.mail_provider_bindings,jsonb)','(',1)||'(', 'CREATE OR REPLACE FUNCTION mail_runtime.binding_approved_v1(');
 execute d;end $copy$;
do $copy$ declare d text;begin
 select pg_get_functiondef('composio_c1.approval_current(public.mail_provider_bindings,jsonb)'::regprocedure) into d;
 d:=replace(d,'CREATE OR REPLACE FUNCTION '||split_part('composio_c1.approval_current(public.mail_provider_bindings,jsonb)','(',1)||'(', 'CREATE OR REPLACE FUNCTION mail_runtime.approval_current_v1(');
 execute d;end $copy$;
do $copy$ declare d text;begin
 select pg_get_functiondef('mail_runtime.ticket(mail_runtime.attempts)'::regprocedure) into d;
 d:=replace(d,'CREATE OR REPLACE FUNCTION '||split_part('mail_runtime.ticket(mail_runtime.attempts)','(',1)||'(', 'CREATE OR REPLACE FUNCTION mail_runtime.ticket_v1(');
 execute d;end $copy$;
do $copy$ declare d text;begin
 select pg_get_functiondef('public.mail_transport_snapshot(uuid)'::regprocedure) into d;
 d:=replace(d,'CREATE OR REPLACE FUNCTION '||split_part('public.mail_transport_snapshot(uuid)','(',1)||'(', 'CREATE OR REPLACE FUNCTION mail_runtime.snapshot_v1(');
 execute d;end $copy$;
do $copy$ declare d text;begin
 select pg_get_functiondef('public.mail_transport_validate_context(uuid,text,text,bigint,boolean)'::regprocedure) into d;
 d:=replace(d,'CREATE OR REPLACE FUNCTION '||split_part('public.mail_transport_validate_context(uuid,text,text,bigint,boolean)','(',1)||'(', 'CREATE OR REPLACE FUNCTION mail_runtime.validate_context_v1(');
 execute d;end $copy$;
do $copy$ declare d text;begin
 select pg_get_functiondef('public.mail_transport_review(uuid)'::regprocedure) into d;
 d:=replace(d,'CREATE OR REPLACE FUNCTION '||split_part('public.mail_transport_review(uuid)','(',1)||'(', 'CREATE OR REPLACE FUNCTION mail_runtime.review_v1(');
 execute d;end $copy$;
create function mail_runtime.review_v2(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r mail_runtime.routes;h public.mail_provider_binding_heads;cfg composio_connect.configuration;a public.mail_accounts;
begin
 perform mail_quota.human();ctx:=mail_runtime.context(account);
 select * into r from mail_runtime.routes where account_id=account;
 select * into h from public.mail_provider_binding_heads where account_id=account;
 select * into cfg from composio_connect.configuration where id=1;
 select * into a from public.mail_accounts where id=account;
 return jsonb_build_object('selection',case when r.account_id is not null then mail_runtime.page(r) end,
 'expected',jsonb_build_object('expected_revision',coalesce(r.revision,0),'expected_head_revision',coalesce(h.revision,0),
 'expected_account_revision',(ctx->>'account_revision')::bigint,'expected_brand_revision',(ctx->>'brand_revision')::bigint,
 'expected_config_generation',coalesce(cfg.generation,0),'expected_context_hash',mail_runtime.digest(ctx::text)),
 'receive_enabled',a.live_enabled and a.sync_enabled,'current',case when r.account_id is not null then mail_runtime.route_current(r,ctx) else false end,
 'unresolved',exists(select 1 from mail_runtime.sync_cycles where account_id=account and state in('active','uncertain'))
 or exists(select 1 from mail_runtime.attempts where account_id=account and state in('reserved','admitted','uncertain'))
 or exists(select 1 from public.outbox where account_id=account and status in('queued','sending','uncertain'))
 or exists(select 1 from public.campaigns where account_id=account and status='active')
 or exists(select 1 from public.campaign_enrollments e join public.campaigns camp on camp.id=e.campaign_id where camp.account_id=account and e.status='active')
 or exists(select 1 from public.mail_brand_dispatch_admissions ad join public.outbox o on o.id=ad.outbox_id where o.account_id=account and ad.outcome in('admitted','uncertain'))
 or exists(select 1 from public.jobs j where j.status='running' and ((j.payload->>'account_id')=account::text or exists(select 1 from public.gmail_runs g where g.account_id=account and g.id::text=j.payload->>'run_id'))),
 'eligible_direct',(ctx->>'ready')::boolean and exists(select 1 from public.mail_credentials where account_id=account),
 'binding_verified',exists(select 1 from public.mail_provider_bindings b where id=h.current_binding_id and b.status='verified' and composio_c1.approval_current(b,ctx)));
end$$;

create or replace function public.mail_transport_command(account uuid,kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare human jsonb:=mail_quota.human();actor uuid:=(human->>'actor')::uuid;ctx jsonb;post_ctx jsonb;
 r mail_runtime.routes;h public.mail_provider_binding_heads;b public.mail_provider_bindings;c public.mail_provider_binding_checks;cfg composio_connect.configuration;
 receipt public.command_receipts;fp text;answer jsonb;allowed text[]:=array['expected_revision','target_provider','expected_head_revision','expected_account_revision','expected_brand_revision','expected_config_generation','expected_context_hash'];k text;v_approval jsonb;cfg2 mail_quota.binding_contexts;c2 mail_quota.binding_checks;
begin
 if request_key is null or kind is null or kind not in('bootstrap_direct','prepare_transition','pause','commit_transition','cancel_transition')
 or jsonb_typeof(p) is distinct from 'object' or not(p ?& allowed) or exists(select 1 from jsonb_object_keys(p) x where not(x=any(allowed))) then raise exception 'R06_INVALID_INPUT';end if;
 foreach k in array array['expected_revision','expected_head_revision','expected_account_revision','expected_brand_revision','expected_config_generation'] loop
  if jsonb_typeof(p->k) is distinct from 'number' or p->>k !~ '^(0|[1-9][0-9]{0,15})$' or (p->>k)::numeric>9007199254740991 then raise exception 'R06_INVALID_INPUT';end if;
 end loop;
 if coalesce(p->>'target_provider','') not in('gmail_oauth','composio') or coalesce(p->>'expected_context_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'R06_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended('r06:'||actor::text||':'||request_key::text,71506));
 ctx:=mail_runtime.context(account);
 if not exists(select 1 from public.mail_provider_binding_heads bh join public.mail_provider_bindings bb on bb.id=bh.current_binding_id where bh.account_id=account and bb.quota_contract_version=2) then
  return mail_runtime.command_v1(account,kind,p,request_key);end if;
 fp:=mail_runtime.digest(jsonb_build_object('account',account,'kind',kind,'p',p)::text);
 select * into receipt from public.command_receipts where user_id=actor and command_receipts.request_key=mail_transport_command.request_key;
 if found then
  if receipt.kind<>'mail_transport.'||kind or receipt.fingerprint<>fp then raise exception 'R06_IDEMPOTENCY_CONFLICT';end if;
  return receipt.result;
 end if;
 select * into h from public.mail_provider_binding_heads where account_id=account for update;
 select * into b from public.mail_provider_bindings where id=h.current_binding_id for update;
 if b.quota_contract_version=2 then
  if p->>'target_provider'='composio' and kind in('prepare_transition','commit_transition') then cfg2:=mail_quota.binding_config(account);
  else select * into cfg2 from mail_quota.binding_contexts where account_id=account;end if;
  cfg.generation:=cfg2.generation;cfg.project_id:=cfg2.context->>'composio_project_id';cfg.auth_config_id:=cfg2.auth_config_id;
 else select * into cfg from composio_connect.configuration where id=1;end if;
 insert into mail_runtime.routes(account_id) values(account) on conflict do nothing;
 select * into r from mail_runtime.routes where account_id=account for update;
 if r.revision<>(p->>'expected_revision')::bigint or (ctx->>'account_revision')::bigint<>(p->>'expected_account_revision')::bigint
 or (ctx->>'brand_revision')::bigint<>(p->>'expected_brand_revision')::bigint or mail_runtime.digest(ctx::text)<>p->>'expected_context_hash'
 or coalesce(h.revision,0)<>(p->>'expected_head_revision')::bigint
 or (p->>'target_provider'='composio' and cfg.generation is distinct from (p->>'expected_config_generation')::bigint)
 or r.revision=9007199254740991 then raise exception 'R06_STALE';end if;
 if kind='bootstrap_direct' then
  if r.revision<>0 or r.state<>'paused' or r.provider<>'gmail_oauth' or p->>'target_provider'<>'gmail_oauth'
  or not(ctx->>'ready')::boolean or not exists(select 1 from public.mail_credentials where account_id=account) then raise exception 'R06_NOT_READY';end if;
  update mail_runtime.routes set state='ready',revision=revision+1 where account_id=account returning * into r;
  insert into mail_runtime.sync_checkpoints(account_id,history_id,last_reconciled_at)
    select account_id,history_id,last_reconciled_at from public.mail_credentials where account_id=account on conflict do nothing;
 elsif kind='prepare_transition' then
  if r.state='draining' then raise exception 'R06_BUSY';end if;
  update mail_runtime.routes set state='draining',revision=revision+1,target_provider=p->>'target_provider',pending_head=coalesce(h.revision,0),pending_config=(p->>'expected_config_generation')::bigint where account_id=account returning * into r;
 elsif kind in('pause','cancel_transition') then
  if kind='cancel_transition' and r.state<>'draining' then raise exception 'R06_NOT_READY';end if;
  update mail_runtime.routes set state='paused',revision=revision+1,target_provider=null,pending_head=null,pending_config=null where account_id=account returning * into r;
 elsif kind='commit_transition' then
  if r.state<>'draining' or r.target_provider<>p->>'target_provider' or r.pending_head<>coalesce(h.revision,0)
    or r.pending_config<>(p->>'expected_config_generation')::bigint then raise exception 'R06_STALE';end if;
  if exists(select 1 from mail_runtime.sync_cycles where account_id=account and state in('active','uncertain')) or exists(select 1 from mail_runtime.attempts where account_id=account and state in('reserved','admitted','uncertain'))
   or exists(select 1 from public.outbox where account_id=account and status in('queued','sending','uncertain'))
   or exists(select 1 from public.campaigns where account_id=account and status='active')
   or exists(select 1 from public.campaign_enrollments e join public.campaigns camp on camp.id=e.campaign_id where camp.account_id=account and e.status='active')
   or exists(select 1 from public.mail_brand_dispatch_admissions ad join public.outbox o on o.id=ad.outbox_id where o.account_id=account and ad.outcome in('admitted','uncertain'))
   or exists(select 1 from public.jobs j where j.status='running' and ((j.payload->>'account_id')=account::text
     or exists(select 1 from public.gmail_runs g where g.account_id=account and g.id::text=j.payload->>'run_id')))
   then raise exception 'R06_UNRESOLVED';end if;
  if r.target_provider='gmail_oauth' then
   if not(ctx->>'ready')::boolean or not exists(select 1 from public.mail_credentials where account_id=account) then raise exception 'R06_NOT_READY';end if;
   update mail_runtime.routes set provider='gmail_oauth',state='ready',revision=revision+1,binding_id=null,approval=null,target_provider=null,pending_head=null,pending_config=null where account_id=account returning * into r;
  else
   if b.quota_contract_version<>2 then raise exception 'R06_EVIDENCE_REQUIRED';end if;
   select * into c2 from mail_quota.binding_checks x where x.binding_id=b.id and x.status='completed' and x.confirmed_at is not null order by x.started_at desc,x.id limit 1 for update;
   if c2.id is null or c2.actor_id<>actor or c2.session_id<>(human->>'session')::uuid or c2.valid_until<=clock_timestamp() or c2.deadline<=clock_timestamp()
    or not mail_quota.binding_confirmed(b,ctx) then raise exception 'R06_EVIDENCE_REQUIRED';end if;
   post_ctx:=ctx;
   v_approval:=jsonb_build_object('contract_version',2,'pre_context',b.account_context,'post_context',ctx,'post_epoch',r.account_epoch,
    'head_revision',h.revision,'binding_revision',b.revision,'check_id',c2.id,'actor_id',actor,'actor_revision',c2.actor_revision,
    'verification_context_hash',cfg2.digest,'config_generation',cfg2.generation);
   update mail_runtime.routes set provider='composio',state='ready',revision=revision+1,binding_id=b.id,approval=v_approval,target_provider=null,pending_head=null,pending_config=null where account_id=account returning * into r;
   insert into mail_runtime.sync_checkpoints(account_id,history_id,last_reconciled_at)
    values(account,(select history_id from public.mail_credentials where account_id=account),(select last_reconciled_at from public.mail_credentials where account_id=account)) on conflict do nothing;
  end if;
 end if;
 answer:=mail_runtime.page(r);
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values(actor,request_key,'mail_transport.'||kind,fp,answer);
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(actor,'mail_account',account,'mail_transport.'||kind);
 return answer;
end$$;

-- Generator fragment; the fixture marker is required even when run separately.
do $$begin
 if current_setting('pipeline_os.qgr_i04_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^qgr_i02_i04_[a-z0-9_]+$' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'QGR_I04_LOCAL_ONLY';end if;
end$$;
create or replace function composio_c1.approval_current(b public.mail_provider_bindings,ctx jsonb) returns boolean language sql stable set search_path='' as $$
 select case when b.quota_contract_version=2 then mail_quota.binding_confirmed(b,ctx) else mail_runtime.approval_current_v1(b,ctx) end
$$;
create or replace function mail_runtime.binding_approved(b public.mail_provider_bindings,ctx jsonb) returns boolean language sql stable set search_path='' as $$
 select case when b.quota_contract_version=2 then mail_quota.binding_confirmed(b,ctx) and exists(
 select 1 from mail_runtime.routes r join mail_quota.binding_checks c on c.id=(r.approval->>'check_id')::uuid
 join mail_quota.binding_contexts cfg on cfg.account_id=r.account_id
 where r.account_id=b.account_id and r.provider='composio' and r.binding_id=b.id and r.approval->'contract_version'='2'::jsonb
 and (r.approval->>'head_revision')::bigint=b.revision and (r.approval->>'binding_revision')::bigint=b.revision
 and (r.approval->>'post_epoch')::bigint=r.account_epoch and r.approval->'post_context'=ctx
 and r.approval->>'verification_context_hash'=cfg.digest and (r.approval->>'config_generation')::bigint=cfg.generation
 and c.binding_id=b.id and c.actor_id=(r.approval->>'actor_id')::uuid and c.actor_revision=(r.approval->>'actor_revision')::bigint
 and c.confirmed_at is not null and c.status='completed') else mail_runtime.binding_approved_v1(b,ctx) end
$$;
create or replace function mail_runtime.ticket(t mail_runtime.attempts) returns jsonb language sql stable set search_path='' as $$
 select case when b.quota_contract_version=2 then jsonb_set(mail_runtime.ticket_v1(t),'{binding}',
 (mail_runtime.ticket_v1(t)->'binding')||jsonb_build_object('quotaContractVersion',2,'quotaProjectId',null,'quotaPolicyId',b.quota_policy_id,'quotaPolicyGeneration',b.quota_policy_generation))
 else mail_runtime.ticket_v1(t) end from (select 1) dummy left join mail_runtime.routes r on r.account_id=t.account_id left join public.mail_provider_bindings b on b.id=r.binding_id
$$;
create or replace function public.mail_transport_snapshot(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r mail_runtime.routes;b public.mail_provider_bindings;cfg mail_quota.binding_contexts;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'R06_FORBIDDEN';end if;
 ctx:=mail_runtime.context(account);select * into r from mail_runtime.routes where account_id=account for update;
 select * into b from public.mail_provider_bindings where id=r.binding_id;
 if b.quota_contract_version is distinct from 2 then return mail_runtime.snapshot_v1(account);end if;
 if not mail_runtime.route_current(r,ctx) then raise exception 'R06_NOT_READY';end if;
 cfg:=mail_quota.binding_config(account);
 return jsonb_build_object('account_id',account,'provider',r.provider,'revision',r.revision,'verification_context_hash',cfg.digest,'config_generation',cfg.generation,
 'project_id',b.composio_project_id,'auth_config_id',b.auth_config_id,'quota_project_id',null,'quota_contract_version',2,'quota_policy_id',b.quota_policy_id,'quota_policy_generation',b.quota_policy_generation);
end$$;
create or replace function public.mail_transport_validate_context(attempt uuid,capability text,context_digest text,config_generation bigint,admit boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare t mail_runtime.attempts;b public.mail_provider_bindings;cfg mail_quota.binding_contexts;
begin
 t:=mail_runtime.lock_attempt(attempt,capability);
 select x.* into b from public.mail_provider_bindings x join mail_runtime.routes r on r.binding_id=x.id where r.account_id=t.account_id;
 if t.provider<>'composio' or b.quota_contract_version is distinct from 2 then return mail_runtime.validate_context_v1(attempt,capability,context_digest,config_generation,admit);end if;
 cfg:=mail_quota.binding_config(t.account_id);
 if cfg.digest is distinct from context_digest or cfg.generation is distinct from config_generation then return false;end if;
 return public.mail_transport_validate(attempt,capability,admit);
end$$;
create or replace function public.mail_transport_review(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;g bigint;
begin
 if exists(select 1 from public.mail_provider_binding_heads h join public.mail_provider_bindings b on b.id=h.current_binding_id where h.account_id=account and b.quota_contract_version=2) then
  v:=mail_runtime.review_v2(account);
  select generation into g from mail_quota.binding_contexts where account_id=account;
  v:=jsonb_set(v,'{expected,expected_config_generation}',to_jsonb(coalesce(g,0)));
 else v:=mail_runtime.review_v1(account);end if;return v;
end$$;
create or replace function public.mail_transport_page(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r mail_runtime.routes;
begin
 if exists(select 1 from public.mail_provider_binding_heads h join public.mail_provider_bindings b on b.id=h.current_binding_id where h.account_id=account and b.quota_contract_version=2) then perform mail_quota.human();else perform composio_connect.human();end if;
 perform mail_runtime.context(account);select * into r from mail_runtime.routes where account_id=account;
 if r.account_id is null then return null;end if;return mail_runtime.page(r);
end$$;

revoke all on all functions in schema mail_runtime from public,anon,authenticated,service_role;
commit;
