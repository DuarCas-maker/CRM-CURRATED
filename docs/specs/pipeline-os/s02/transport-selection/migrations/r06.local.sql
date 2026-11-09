-- R06-I01 local additive candidate. No production ordinal or caller.
-- External transaction required for the isolated DDL/rollback rehearsal.
do $$begin
 if current_setting('pipeline_os.r06_local',true) is distinct from 'in_memory_test' then raise exception 'R06_LOCAL_MARKER_REQUIRED';end if;
 if to_regnamespace('brand_b2') is null or to_regnamespace('composio_c1') is null or to_regnamespace('composio_connect') is null
 or to_regnamespace('worker_pilot') is null then raise exception 'R06_BASE_REQUIRED';end if;
end$$;
create schema mail_runtime;
revoke all on schema mail_runtime from public,anon,authenticated,service_role;
create table mail_runtime.routes(
 account_id uuid primary key references public.mail_accounts on delete restrict,
 provider text not null default 'gmail_oauth' check(provider in('gmail_oauth','composio')),
 state text not null default 'paused' check(state in('paused','draining','ready')),
 revision bigint not null default 0 check(revision between 0 and 9007199254740991),
 account_epoch bigint not null default 0 check(account_epoch between 0 and 9007199254740991),
 target_provider text check(target_provider in('gmail_oauth','composio')),
 pending_head bigint check(pending_head between 0 and 9007199254740991),pending_config bigint check(pending_config between 0 and 9007199254740991),
 binding_id uuid,approval jsonb,
 foreign key(account_id,binding_id) references public.mail_provider_bindings(account_id,id) on delete restrict,
 check(coalesce((provider='gmail_oauth' and binding_id is null and approval is null) or(provider='composio' and binding_id is not null and jsonb_typeof(approval)='object' and octet_length(approval::text)<=16384),false)),
 check((state='draining' and target_provider is not null and pending_head is not null and pending_config is not null)
   or(state<>'draining' and target_provider is null and pending_head is null and pending_config is null))
);
create table mail_runtime.attempts(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references mail_runtime.routes on delete restrict,
 route_revision bigint not null check(route_revision between 0 and 9007199254740991),provider text not null check(provider in('gmail_oauth','composio')),
 operation text not null check(operation in('profile','history','messages','message','thread','attachment','signature','send','watch','stop')),
 resource text not null check(length(resource) between 1 and 2300),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),deadline timestamptz not null,
 state text not null default 'reserved' check(state in('reserved','admitted','finished','cancelled_before_wire','uncertain')),
 checkpointed boolean not null default false,
 check(deadline>created_at and deadline<=created_at+interval '2 minutes')
);
create index runtime_pending on mail_runtime.attempts(account_id,state) where state in('reserved','admitted','uncertain');
create unique index runtime_one_send on mail_runtime.attempts(resource) where operation='send' and state<>'cancelled_before_wire';
create table mail_runtime.sync_checkpoints(
 account_id uuid primary key references public.mail_accounts on delete restrict,
 history_id text check(history_id ~ '^[0-9]{1,128}$'),last_reconciled_at timestamptz,
 revision bigint not null default 0 check(revision between 0 and 9007199254740991)
);
alter table mail_runtime.routes enable row level security;
alter table mail_runtime.attempts enable row level security;
alter table mail_runtime.sync_checkpoints enable row level security;
revoke all on all tables in schema mail_runtime from public,anon,authenticated,service_role;

create function mail_runtime.digest(value text) returns text language sql immutable set search_path='' as $$select encode(sha256(convert_to(value,'UTF8')),'hex')$$;
create function mail_runtime.account_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.email,old.organization,old.status,old.operating_brand_id,old.brand_revision) is distinct from (new.email,new.organization,new.status,new.operating_brand_id,new.brand_revision) then
  update mail_runtime.routes set account_epoch=account_epoch+1 where account_id=new.id;
 end if;return new;
end$$;
create trigger runtime_account_epoch after update of email,organization,status,operating_brand_id,brand_revision on public.mail_accounts for each row execute function mail_runtime.account_changed();
create function mail_runtime.context(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.mail_accounts;b public.operating_brands;observed uuid;review uuid;
begin
 select operating_brand_id into observed from public.mail_accounts where id=account;
 if not found then raise exception 'R06_NOT_FOUND';end if;
 select * into b from public.operating_brands where id=observed for share;
 select * into a from public.mail_accounts where id=account for update;
 if a.operating_brand_id is distinct from observed then raise exception 'R06_STALE';end if;
 select id into review from public.mail_account_brand_reviews r where r.account_id=a.id and r.status='confirmed' and r.proposed_brand_id=b.id
 and r.expected_account_revision=a.brand_revision-1 order by r.created_at desc,r.id limit 1;
 return jsonb_build_object('account_id',a.id,'email',lower(btrim(a.email)),'status',a.status,'brand_id',a.operating_brand_id,'brand_name',b.name,
  'brand_revision',coalesce(b.revision,0),'account_revision',a.brand_revision,'review_id',review,'ready',coalesce(a.status='connected' and b.active and review is not null,false));
end$$;

create function mail_runtime.verification_ready(ctx jsonb,actor uuid) returns boolean language sql stable set search_path='' as $$
 select coalesce((ctx->>'ready')::boolean,false) or exists(
  select 1 from composio_connect.attempts x join composio_connect.subjects s on s.id=x.subject_id
  join public.mail_provider_binding_heads h on h.account_id=s.account_id
  join public.operating_brands b on b.id=x.brand_id
  join composio_connect.configuration c on c.id=1
  where ctx->>'status'='disconnected' and s.account_id=(ctx->>'account_id')::uuid
  and x.state='completed' and x.actor_id=actor and x.result_binding_id=h.current_binding_id
  and s.email=ctx->>'email' and x.brand_id=(ctx->>'brand_id')::uuid and b.active
  and x.brand_revision=(ctx->>'brand_revision')::bigint and x.registration_revision=(ctx->>'account_revision')::bigint
  and x.review_id=(ctx->>'review_id')::uuid and x.config_generation=c.generation
  and x.project_id=c.project_id and x.auth_config_id=c.auth_config_id and x.quota_project_id=c.quota_project_id)
$$;

-- Persisted operational approval is consumed within the original C2 TTL at commit.
-- This validates the exact post-commit context; it does not extend pending checks.
create function mail_runtime.binding_approved(b public.mail_provider_bindings,ctx jsonb) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from mail_runtime.routes r join public.mail_provider_binding_heads h on h.account_id=r.account_id
 join public.mail_provider_binding_checks c on c.id=(r.approval->>'check_id')::uuid
 join public.profiles p on p.id=(r.approval->>'actor_id')::uuid
 join composio_connect.configuration cfg on cfg.id=1 join public.mail_accounts a on a.id=r.account_id
 where r.account_id=b.account_id and r.provider='composio' and r.binding_id=b.id and b.status='verified'
 and h.current_binding_id=b.id and h.revision=(r.approval->>'head_revision')::bigint and b.revision=(r.approval->>'binding_revision')::bigint
 and r.approval->'post_context'=ctx and r.approval->'pre_context'=b.account_context
 and (r.approval->>'post_epoch')::bigint=r.account_epoch and (ctx->>'ready')::boolean and b.expected_mailbox_email=ctx->>'email'
 and p.active and p.role='superadmin' and p.mail_authorization_revision=(r.approval->>'actor_revision')::bigint
 and cfg.generation=(r.approval->>'config_generation')::bigint and cfg.project_id=b.composio_project_id
 and cfg.auth_config_id=b.auth_config_id and cfg.quota_project_id=b.google_quota_project_id
 and c.binding_id=b.id and c.status='completed' and c.confirmed_at is not null and c.actor_id=p.id
 and c.evidence_digest=r.approval->>'evidence_digest' and composio_c1.facts_pass(c.facts)
 and h.verification_context_hash=r.approval->>'verification_context_hash'
 and h.verification_generation=(r.approval->>'verification_generation')::bigint)
$$;

-- Four C2 functions changed only in this additive candidate; guards and ACL retained.
do $patch$ declare definition text;begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='composio_c1.check_current(public.mail_provider_binding_checks,jsonb,public.mail_provider_binding_heads,public.mail_provider_bindings)'::regprocedure) is distinct from '54338942249348eaa2b80da60036e319' then raise exception 'R06_C2_BASE_MISMATCH';end if;
 select pg_get_functiondef('composio_c1.check_current(public.mail_provider_binding_checks,jsonb,public.mail_provider_binding_heads,public.mail_provider_bindings)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,'(ctx->>''ready'')::boolean','')))/length('(ctx->>''ready'')::boolean')<>1 then raise exception 'R06_C2_PATCH_MISMATCH';end if;
 definition:=replace(definition,'(ctx->>''ready'')::boolean','mail_runtime.verification_ready(ctx,c.actor_id)');
 execute definition;
end $patch$;
do $patch$ declare definition text;begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='composio_c1.approval_current(public.mail_provider_bindings,jsonb)'::regprocedure) is distinct from '9843065f0b47b2ce4c8a4984b3e90946' then raise exception 'R06_C2_BASE_MISMATCH';end if;
 select pg_get_functiondef('composio_c1.approval_current(public.mail_provider_bindings,jsonb)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,' select exists(','')))/length(' select exists(')<>1 then raise exception 'R06_C2_PATCH_MISMATCH';end if;
 definition:=replace(definition,' select exists(',' select mail_runtime.binding_approved(b,ctx) or exists(');
 if (length(definition)-length(replace(definition,'(ctx->>''ready'')::boolean','')))/length('(ctx->>''ready'')::boolean')<>1 then raise exception 'R06_C2_PATCH_MISMATCH';end if;
 definition:=replace(definition,'(ctx->>''ready'')::boolean','mail_runtime.verification_ready(ctx,c.actor_id)');
 execute definition;
end $patch$;
do $patch$ declare definition text;begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='composio_c1.row_dto(public.mail_provider_bindings,jsonb)'::regprocedure) is distinct from '181449deee9fdcaa480a71d4de344c74' then raise exception 'R06_C2_BASE_MISMATCH';end if;
 select pg_get_functiondef('composio_c1.row_dto(public.mail_provider_bindings,jsonb)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,'b.account_context is distinct from ctx or (','')))/length('b.account_context is distinct from ctx or (')<>1 then raise exception 'R06_C2_PATCH_MISMATCH';end if;
 definition:=replace(definition,'b.account_context is distinct from ctx or (','(b.account_context is distinct from ctx and not mail_runtime.binding_approved(b,ctx)) or (');
 execute definition;
end $patch$;
do $patch$ declare definition text;begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.composio_binding_check_begin(uuid,uuid,jsonb,text,text,uuid)'::regprocedure) is distinct from '8dd7c83b1214af1f6da6763549214f56' then raise exception 'R06_C2_BASE_MISMATCH';end if;
 select pg_get_functiondef('public.composio_binding_check_begin(uuid,uuid,jsonb,text,text,uuid)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,'not(ctx->>''ready'')::boolean','')))/length('not(ctx->>''ready'')::boolean')<>1 then raise exception 'R06_C2_PATCH_MISMATCH';end if;
 definition:=replace(definition,'not(ctx->>''ready'')::boolean','not mail_runtime.verification_ready(ctx,auth.uid())');
 execute definition;
end $patch$;


create function mail_runtime.page(r mail_runtime.routes) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('account_id',r.account_id,'provider',r.provider,'state',r.state,'revision',r.revision,'target_provider',r.target_provider,'binding_id',r.binding_id)
$$;
create function mail_runtime.route_current(r mail_runtime.routes,ctx jsonb) returns boolean language sql stable set search_path='' as $$
 select coalesce(r.state='ready' and (ctx->>'ready')::boolean and
 case when r.provider='gmail_oauth' then exists(select 1 from public.mail_credentials c where c.account_id=r.account_id)
 else exists(select 1 from public.mail_provider_bindings b where b.id=r.binding_id and mail_runtime.binding_approved(b,ctx)) end,false)
$$;

create function public.mail_transport_page(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare h jsonb;r mail_runtime.routes;ctx jsonb;
begin
 h:=composio_connect.human();ctx:=mail_runtime.context(account);
 select * into r from mail_runtime.routes where account_id=account;
 if r.account_id is null then return null;end if;
 return mail_runtime.page(r);
end$$;

create function public.mail_transport_command(account uuid,kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare human jsonb:=composio_connect.human();actor uuid:=(human->>'actor')::uuid;ctx jsonb;post_ctx jsonb;
 r mail_runtime.routes;h public.mail_provider_binding_heads;b public.mail_provider_bindings;c public.mail_provider_binding_checks;cfg composio_connect.configuration;
 receipt public.command_receipts;fp text;answer jsonb;allowed text[]:=array['expected_revision','target_provider','expected_head_revision','expected_account_revision','expected_brand_revision','expected_config_generation','expected_context_hash'];k text;v_approval jsonb;
begin
 if request_key is null or kind is null or kind not in('bootstrap_direct','prepare_transition','pause','commit_transition','cancel_transition')
 or jsonb_typeof(p) is distinct from 'object' or not(p ?& allowed) or exists(select 1 from jsonb_object_keys(p) x where not(x=any(allowed))) then raise exception 'R06_INVALID_INPUT';end if;
 foreach k in array array['expected_revision','expected_head_revision','expected_account_revision','expected_brand_revision','expected_config_generation'] loop
  if jsonb_typeof(p->k) is distinct from 'number' or p->>k !~ '^(0|[1-9][0-9]{0,15})$' or (p->>k)::numeric>9007199254740991 then raise exception 'R06_INVALID_INPUT';end if;
 end loop;
 if coalesce(p->>'target_provider','') not in('gmail_oauth','composio') or coalesce(p->>'expected_context_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'R06_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended('r06:'||actor::text||':'||request_key::text,71506));
 ctx:=mail_runtime.context(account);
 fp:=mail_runtime.digest(jsonb_build_object('account',account,'kind',kind,'p',p)::text);
 select * into receipt from public.command_receipts where user_id=actor and command_receipts.request_key=mail_transport_command.request_key;
 if found then
  if receipt.kind<>'mail_transport.'||kind or receipt.fingerprint<>fp then raise exception 'R06_IDEMPOTENCY_CONFLICT';end if;
  return receipt.result;
 end if;
 select * into h from public.mail_provider_binding_heads where account_id=account for update;
 select * into b from public.mail_provider_bindings where id=h.current_binding_id for update;
 select * into cfg from composio_connect.configuration where id=1;
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
  if exists(select 1 from mail_runtime.attempts where account_id=account and state in('reserved','admitted','uncertain'))
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
   select * into c from public.mail_provider_binding_checks x where x.binding_id=b.id and x.status='completed' and x.confirmed_at is not null order by x.started_at desc,x.id limit 1 for update;
   if b.id is null or b.status<>'verified' or c.id is null or c.deadline<=clock_timestamp() or c.actor_id<>actor
     or not composio_c1.approval_current(b,ctx) or cfg.project_id<>b.composio_project_id or cfg.auth_config_id<>b.auth_config_id
     or cfg.quota_project_id<>b.google_quota_project_id then raise exception 'R06_EVIDENCE_REQUIRED';end if;
   if ctx->>'status'='disconnected' then update public.mail_accounts set status='connected' where id=account;end if;
   post_ctx:=mail_runtime.context(account);
   if not(post_ctx->>'ready')::boolean then raise exception 'R06_NOT_READY';end if;
   v_approval:=jsonb_build_object('pre_context',b.account_context,'post_context',post_ctx,'post_xmin',(select xmin::text from public.mail_accounts where id=account),'post_epoch',(select account_epoch from mail_runtime.routes where account_id=account),
    'head_revision',h.revision,'binding_revision',b.revision,'check_id',c.id,'actor_id',actor,'actor_revision',c.actor_revision,
    'evidence_digest',c.evidence_digest,'verification_context_hash',h.verification_context_hash,'verification_generation',h.verification_generation,'config_generation',cfg.generation);
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

create function mail_runtime.resource_valid(op text,resource text,provider text,email text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(case when op='send' then resource ~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
 when op in('message','thread') then resource ~ '^[a-fA-F0-9]{1,128}$'
 when op='attachment' then resource ~ '^[a-fA-F0-9]{1,128}:[A-Za-z0-9_-]{1,2048}$'
 when op='signature' then lower(resource)=email
 when op in('watch','stop') then provider='gmail_oauth' and resource=op
 when op in('profile','history','messages') then resource=op else false end,false)
$$;
create function mail_runtime.ticket(t mail_runtime.attempts) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',t.id,'account_id',t.account_id,'provider',t.provider,'revision',t.route_revision,'operation',t.operation,'resource',t.resource,'deadline',to_char(t.deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'binding',case when t.provider='composio' then (select jsonb_build_object('accountId',b.account_id,'connectedAccountId',b.connected_account_id,'authConfigId',b.auth_config_id,'userId',b.composio_user_id,
 'mailboxEmail',b.expected_mailbox_email,'verifiedMailboxEmail',b.expected_mailbox_email,'identityVerified',true,'status','active','revision',b.revision,'quotaProjectId',b.google_quota_project_id)
 from mail_runtime.routes r join public.mail_provider_bindings b on b.id=r.binding_id where r.account_id=t.account_id) else null end)
$$;

create function public.mail_transport_acquire(account uuid,expected_revision bigint,operation text,resource text,capability_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r mail_runtime.routes;t mail_runtime.attempts;m public.outbox;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'R06_FORBIDDEN';end if;
 if capability_hash is null or capability_hash !~ '^[a-f0-9]{64}$' or expected_revision is null or operation is null or resource is null or length(resource)>2300 then raise exception 'R06_INVALID_INPUT';end if;
 ctx:=mail_runtime.context(account);
 select * into r from mail_runtime.routes where account_id=account for update;
 if r.account_id is null or r.revision<>expected_revision or not mail_runtime.route_current(r,ctx) then raise exception 'R06_NOT_READY';end if;
 if not mail_runtime.resource_valid(operation,resource,r.provider,ctx->>'email') then raise exception 'R06_INVALID_INPUT';end if;
 if operation='send' then
  select * into m from public.outbox where id=resource::uuid and account_id=account for update;
  if m.id is null or m.status<>'sending' or not brand_b2.delivery_allowed(m) then raise exception 'R06_NOT_READY';end if;
 end if;
 insert into mail_runtime.attempts(account_id,route_revision,provider,operation,resource,token_hash,deadline)
 values(account,r.revision,r.provider,operation,resource,capability_hash,clock_timestamp()+interval '119 seconds') returning * into t;
 return mail_runtime.ticket(t);
exception when unique_violation then raise exception 'R06_CONFLICT';
end$$;

create function mail_runtime.lock_attempt(attempt uuid,capability text) returns mail_runtime.attempts language plpgsql security definer set search_path='' as $$
declare t mail_runtime.attempts;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'R06_FORBIDDEN';end if;
 select * into t from mail_runtime.attempts where id=attempt;
 if t.id is null or capability is null or capability !~ '^[a-f0-9]{64}$' or t.token_hash is distinct from mail_runtime.digest(capability) then raise exception 'R06_FORBIDDEN';end if;
 perform mail_runtime.context(t.account_id);
 perform 1 from mail_runtime.routes where account_id=t.account_id for update;
 select * into t from mail_runtime.attempts where id=attempt for update;
 return t;
end$$;
create function public.mail_transport_validate(attempt uuid,capability text,admit boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare t mail_runtime.attempts;r mail_runtime.routes;ctx jsonb;m public.outbox;
begin
 t:=mail_runtime.lock_attempt(attempt,capability);
 if admit is null then raise exception 'R06_INVALID_INPUT';end if;
 ctx:=mail_runtime.context(t.account_id);
 select * into r from mail_runtime.routes where account_id=t.account_id;
 if t.state<>'reserved' or t.deadline<=clock_timestamp() or t.route_revision<>r.revision or not mail_runtime.route_current(r,ctx) then return false;end if;
 if admit then
  if t.operation='send' then
   select * into m from public.outbox where id=t.resource::uuid and account_id=t.account_id for update;
   if m.id is null or m.status<>'sending' or not brand_b2.delivery_allowed(m) or not exists(select 1 from public.mail_brand_dispatch_admissions ad where ad.id=m.brand_admission_id and ad.outbox_id=m.id and ad.claim_token=m.brand_claim_token and ad.outcome='admitted') then return false;end if;
  end if;
  update mail_runtime.attempts set state='admitted' where id=t.id;
 end if;
 return true;
end$$;
create function public.mail_transport_finish(attempt uuid,capability text,outcome text) returns void language plpgsql security definer set search_path='' as $$
declare t mail_runtime.attempts;
begin
 t:=mail_runtime.lock_attempt(attempt,capability);
 if outcome is null or outcome not in('finished','cancelled_before_wire','uncertain') then raise exception 'R06_INVALID_INPUT';end if;
 if t.state=outcome then return;end if;
 if t.state not in('reserved','admitted','uncertain') or (t.state='uncertain' and (outcome<>'finished' or t.operation<>'send')) or (outcome='cancelled_before_wire' and t.state<>'reserved')
 or (outcome='finished' and (t.state not in('admitted','uncertain') or(t.operation='send' and not exists(select 1 from public.outbox o join public.mail_brand_dispatch_admissions a on a.id=o.brand_admission_id where o.id=t.resource::uuid and o.account_id=t.account_id and o.status='sent' and a.outbox_id=o.id and a.outcome='accepted')))) then raise exception 'R06_UNRESOLVED';end if;
 update mail_runtime.attempts set state=outcome where id=t.id;
end$$;
create function public.mail_sync_checkpoint(attempt uuid,capability text,expected_revision bigint,checkpoint text) returns bigint language plpgsql security definer set search_path='' as $$
declare t mail_runtime.attempts;r mail_runtime.routes;c mail_runtime.sync_checkpoints;
begin
 t:=mail_runtime.lock_attempt(attempt,capability);
 select * into r from mail_runtime.routes where account_id=t.account_id;
 select * into c from mail_runtime.sync_checkpoints where account_id=t.account_id for update;
 if checkpoint is null or checkpoint !~ '^[0-9]{1,128}$' or expected_revision is null then raise exception 'R06_INVALID_INPUT';end if;
 if t.state<>'finished' or t.operation not in('history','profile') or t.checkpointed or t.deadline<=clock_timestamp()
 or r.state<>'ready' or r.revision<>t.route_revision or c.account_id is null or c.revision is distinct from expected_revision or c.revision=9007199254740991
 or (c.history_id is not null and checkpoint::numeric<c.history_id::numeric) or not mail_runtime.route_current(r,mail_runtime.context(t.account_id)) then raise exception 'R06_STALE';end if;
 update mail_runtime.sync_checkpoints set history_id=checkpoint,last_reconciled_at=clock_timestamp(),revision=revision+1 where account_id=t.account_id returning * into c;
 update mail_runtime.attempts set checkpointed=true where id=t.id;
 return c.revision;
end$$;
revoke all on all functions in schema mail_runtime from public,anon,authenticated,service_role;
revoke all on function public.mail_transport_page(uuid),public.mail_transport_command(uuid,text,jsonb,uuid),public.mail_transport_acquire(uuid,bigint,text,text,text),public.mail_transport_validate(uuid,text,boolean),public.mail_transport_finish(uuid,text,text),public.mail_sync_checkpoint(uuid,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.mail_transport_page(uuid),public.mail_transport_command(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.mail_transport_acquire(uuid,bigint,text,text,text),public.mail_transport_validate(uuid,text,boolean),public.mail_transport_finish(uuid,text,text),public.mail_sync_checkpoint(uuid,text,bigint,text) to service_role;
