-- C1+C2 LOCAL CANDIDATE ONLY. No migration ordinal, provider or remote authorization.
begin;
do $$begin
 if current_setting('pipeline_os.block_c_local',true) is distinct from 'in_memory_test' then raise exception 'C1 explicit in-memory marker required';end if;
 if to_regnamespace('brand_b2') is null or to_regnamespace('composio_c1') is not null then raise exception 'C1 requires B2 and a fresh candidate';end if;
end$$;
create schema composio_c1;
revoke all on schema composio_c1 from public,anon,authenticated,service_role;

create table public.mail_provider_bindings(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.mail_accounts on delete restrict,
 provider text not null default 'composio' check(provider='composio'),
 revision bigint not null check(revision between 1 and 9007199254740991),
 composio_project_id text not null check(composio_project_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' and composio_project_id !~ '^(ac_|ca_)'),
 auth_config_id text not null check(auth_config_id ~ '^ac_[A-Za-z0-9_-]{1,128}$'),
 connected_account_id text not null check(connected_account_id ~ '^ca_[A-Za-z0-9_-]{1,128}$'),
 composio_user_id text not null check(char_length(composio_user_id) between 1 and 1024 and composio_user_id !~ '[[:space:][:cntrl:]]'),
 google_quota_project_id text not null check(google_quota_project_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
 expected_mailbox_email text not null check(length(expected_mailbox_email)<=254 and expected_mailbox_email=lower(btrim(expected_mailbox_email)) and expected_mailbox_email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
 account_context jsonb not null check(jsonb_typeof(account_context)='object' and octet_length(account_context::text)<=8192),
 status text not null default 'candidate' check(status in ('candidate','verified','blocked','revoked','superseded')),
 reason text check(reason in ('replaced','operator_revoked','connection_changed','incorrect_setup','stale_context','identity_mismatch','verification_incomplete','provider_unavailable','permission_unproven')),
 created_by uuid not null references public.profiles on delete restrict,created_at timestamptz not null default now(),
 reviewed_by uuid references public.profiles on delete restrict,reviewed_at timestamptz,
 unique(account_id,id),unique(account_id,revision),check((reviewed_by is null)=(reviewed_at is null)),
 check(status<>'verified' or reviewed_by is not null)
);
create unique index composio_one_current_account on public.mail_provider_bindings(account_id) where status in ('candidate','verified','blocked');
create unique index composio_one_current_connection on public.mail_provider_bindings(composio_project_id,connected_account_id) where status in ('candidate','verified','blocked');
create index composio_binding_history on public.mail_provider_bindings(account_id,revision desc,id desc);
create table public.mail_provider_binding_heads(
 account_id uuid primary key references public.mail_accounts on delete restrict,
 revision bigint not null default 0 check(revision between 0 and 9007199254740991),current_binding_id uuid,
 verification_context_hash text check(verification_context_hash ~ '^[a-f0-9]{64}$'),
 verification_generation bigint not null default 0 check(verification_generation between 0 and 9007199254740991),
 updated_by uuid not null references public.profiles on delete restrict,updated_at timestamptz not null default now(),
 foreign key(account_id,current_binding_id) references public.mail_provider_bindings(account_id,id) on delete restrict,
 check((revision=0 and current_binding_id is null) or (revision>0 and current_binding_id is not null))
);
create table public.mail_provider_binding_checks(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,binding_id uuid not null,
 binding_revision bigint not null check(binding_revision between 1 and 9007199254740991),head_revision bigint not null check(head_revision between 1 and 9007199254740991),
 actor_id uuid not null references public.profiles on delete restrict,actor_revision bigint not null check(actor_revision between 1 and 9007199254740991),
 context_hash text not null check(context_hash ~ '^[a-f0-9]{64}$'),token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 verification_context_hash text not null check(verification_context_hash ~ '^[a-f0-9]{64}$'),
 verification_generation bigint not null check(verification_generation between 1 and 9007199254740991),
 account_row_version text not null check(account_row_version ~ '^[0-9]+$'),
 started_at timestamptz not null default now(),deadline timestamptz not null,
 status text not null default 'prepared' check(status in ('prepared','completed','failed','expired')),
 facts jsonb check(facts is null or (jsonb_typeof(facts)='object' and octet_length(facts::text)<=8192)),
 evidence_digest text check(evidence_digest is null or evidence_digest ~ '^[a-f0-9]{64}$'),finished_at timestamptz,confirmed_at timestamptz,
 foreign key(account_id,binding_id) references public.mail_provider_bindings(account_id,id) on delete restrict,
 check(deadline>started_at and deadline-started_at<=interval '10 minutes'),
 check((status='prepared' and finished_at is null and evidence_digest is null and facts is null) or (status<>'prepared' and finished_at is not null)),
 check(confirmed_at is null or (status='completed' and confirmed_at>=finished_at and confirmed_at<deadline))
);
create unique index composio_one_open_check on public.mail_provider_binding_checks(binding_id) where status='prepared';
create index composio_check_binding on public.mail_provider_binding_checks(binding_id,started_at desc);
alter table public.mail_provider_bindings enable row level security;
alter table public.mail_provider_binding_heads enable row level security;
alter table public.mail_provider_binding_checks enable row level security;
revoke all on public.mail_provider_bindings,public.mail_provider_binding_heads,public.mail_provider_binding_checks from public,anon,authenticated,service_role;

create function composio_c1.guard() returns trigger language plpgsql security definer set search_path='' as $$
declare mode text:=current_setting('pipeline_os.c2_write',true);
begin
 if tg_op='DELETE' then raise exception 'C_BINDING_IMMUTABLE';end if;
 if tg_table_name='mail_provider_binding_checks' then
  if mode not in ('begin','finish','confirm') or mode is null then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
  if mode='finish' and current_setting('role',true)<>'service_role' then raise exception 'C_BINDING_FORBIDDEN';end if;
  if mode in ('begin','confirm') and (current_setting('role',true)<>'authenticated' or auth.uid() is null or public.current_app_role() is distinct from 'superadmin') then raise exception 'C_BINDING_FORBIDDEN';end if;
  if tg_op='INSERT' then
   if mode<>'begin' or new.status<>'prepared' or new.actor_id is distinct from auth.uid() then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
  else
   if (to_jsonb(new)-array['status','facts','evidence_digest','finished_at','confirmed_at']) is distinct from (to_jsonb(old)-array['status','facts','evidence_digest','finished_at','confirmed_at']) then raise exception 'C_BINDING_IMMUTABLE';end if;
   if mode='confirm' then
    if old.status<>'completed' or old.confirmed_at is not null or new.confirmed_at is null or (to_jsonb(new)-'confirmed_at') is distinct from (to_jsonb(old)-'confirmed_at') then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
   elsif old.status<>'prepared' or new.status not in ('completed','failed','expired') or new.confirmed_at is not null then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
  end if;
  return new;
 end if;
 if tg_table_name='mail_provider_binding_heads' and mode='context' then
  if current_setting('role',true)<>'service_role' or tg_op<>'UPDATE' or new.verification_generation<>old.verification_generation+1
   or (to_jsonb(new)-array['verification_context_hash','verification_generation']) is distinct from (to_jsonb(old)-array['verification_context_hash','verification_generation']) then raise exception 'C_BINDING_FORBIDDEN';end if;
  return new;
 end if;
 if mode='finish' and current_setting('role',true)='service_role' then
  if tg_op<>'UPDATE' then raise exception 'C_BINDING_FORBIDDEN';end if;
  if tg_table_name='mail_provider_binding_heads' then
   if new.revision<>old.revision+1 or (to_jsonb(new)-array['revision','updated_at']) is distinct from (to_jsonb(old)-array['revision','updated_at']) then raise exception 'C_BINDING_IMMUTABLE';end if;
  elsif old.status not in ('candidate','blocked') or new.status<>'blocked' or new.revision<>old.revision+1 or (to_jsonb(new)-array['status','reason','revision']) is distinct from (to_jsonb(old)-array['status','reason','revision']) then raise exception 'C_BINDING_IMMUTABLE';end if;
  return new;
 end if;
 if auth.uid() is null or nullif(current_setting('pipeline_os.c1_command',true),'') is distinct from auth.uid()::text then raise exception 'C_BINDING_FORBIDDEN';end if;
 if tg_table_name='mail_provider_binding_heads' then
  if tg_op='UPDATE' and (new.account_id is distinct from old.account_id or new.revision<>old.revision+1) then raise exception 'C_BINDING_IMMUTABLE';end if;
 else
  if tg_op='INSERT' and (new.status<>'candidate' or new.reviewed_at is not null or new.created_by is distinct from auth.uid()) then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
  if tg_op='UPDATE' then
   if (new.id,new.account_id,new.provider,new.composio_project_id,new.auth_config_id,new.connected_account_id,new.composio_user_id,new.google_quota_project_id,new.expected_mailbox_email,new.account_context,new.created_by,new.created_at)
    is distinct from (old.id,old.account_id,old.provider,old.composio_project_id,old.auth_config_id,old.connected_account_id,old.composio_user_id,old.google_quota_project_id,old.expected_mailbox_email,old.account_context,old.created_by,old.created_at)
    or new.revision<old.revision then raise exception 'C_BINDING_IMMUTABLE';end if;
   if mode='confirm' then
    if old.status not in ('candidate','blocked') or new.status<>'verified' or new.reviewed_by is distinct from auth.uid() or new.reviewed_at is null then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
   elsif old.status not in ('candidate','blocked','verified') or new.status not in ('revoked','superseded') or (new.reviewed_by,new.reviewed_at) is distinct from (old.reviewed_by,old.reviewed_at) then raise exception 'C_BINDING_IMMUTABLE';end if;
  end if;
 end if;
 return new;
end$$;
create trigger composio_binding_guard before insert or update or delete on public.mail_provider_bindings for each row execute function composio_c1.guard();
create trigger composio_head_guard before insert or update or delete on public.mail_provider_binding_heads for each row execute function composio_c1.guard();
create trigger composio_check_guard before insert or update or delete on public.mail_provider_binding_checks for each row execute function composio_c1.guard();

create function composio_c1.context_locked(account uuid,actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.mail_accounts;b public.operating_brands;p public.profiles;review_id uuid;observed_brand uuid;
begin
 select operating_brand_id into observed_brand from public.mail_accounts where id=account;
 if not found then raise exception 'C_BINDING_NOT_FOUND';end if;
 select * into b from public.operating_brands where id=observed_brand for share;
 select * into a from public.mail_accounts where id=account for update;
 if not found then raise exception 'C_BINDING_NOT_FOUND';end if;
 if a.operating_brand_id is distinct from observed_brand then raise exception 'C_BINDING_STALE';end if;
 select * into p from public.profiles where id=actor for share;
 if p.id is null or not p.active or p.role<>'superadmin' then raise exception 'C_BINDING_FORBIDDEN';end if;
 select id into review_id from public.mail_account_brand_reviews r where r.account_id=a.id and r.status='confirmed' and r.proposed_brand_id=b.id and r.expected_account_revision=a.brand_revision-1 order by r.created_at desc,r.id limit 1;
 return jsonb_build_object('account_id',a.id,'email',lower(btrim(a.email)),'status',a.status,'brand_id',a.operating_brand_id,'brand_name',b.name,
  'brand_revision',coalesce(b.revision,0),'account_revision',a.brand_revision,'review_id',review_id,'ready',coalesce(a.status='connected' and b.active and review_id is not null,false));
end$$;
create function composio_c1.context(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'authenticated' or public.current_app_role() is distinct from 'superadmin' or auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'C_BINDING_FORBIDDEN';end if;
 return composio_c1.context_locked(account,auth.uid());
end$$;
create function composio_c1.check_current(c public.mail_provider_binding_checks,ctx jsonb,h public.mail_provider_binding_heads,b public.mail_provider_bindings) returns boolean language sql stable set search_path='' as $$
 select coalesce(c.binding_id=b.id and c.account_id=h.account_id and h.current_binding_id=b.id
  and b.status in ('candidate','blocked') and c.binding_revision=b.revision and c.head_revision=h.revision
  and c.verification_context_hash=h.verification_context_hash and c.verification_generation=h.verification_generation
  and c.context_hash=encode(sha256(convert_to(ctx::text,'UTF8')),'hex') and b.account_context=ctx and (ctx->>'ready')::boolean
  and c.actor_revision=(select p.mail_authorization_revision from public.profiles p where p.id=c.actor_id and p.active and p.role='superadmin')
  and c.account_row_version=(select a.xmin::text from public.mail_accounts a where a.id=c.account_id),false)
$$;
create function composio_c1.mask(value text) returns text language sql immutable set search_path='' as $$
 select case when length(value)>8 and right(value,4) ~ '^[A-Za-z0-9_-]{4}$' then '…'||right(value,4) else '…' end
$$;
create function composio_c1.approval_current(b public.mail_provider_bindings,ctx jsonb) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.mail_provider_binding_checks c join public.mail_provider_binding_heads h on h.account_id=c.account_id join public.profiles p on p.id=c.actor_id
  where c.binding_id=b.id and h.current_binding_id=b.id and c.status='completed' and c.confirmed_at is not null and c.deadline>clock_timestamp()
  and c.binding_revision+1=b.revision and c.head_revision+1=h.revision and c.verification_context_hash=h.verification_context_hash and c.verification_generation=h.verification_generation
  and c.context_hash=encode(sha256(convert_to(ctx::text,'UTF8')),'hex') and b.account_context=ctx and (ctx->>'ready')::boolean
  and p.active and p.role='superadmin' and p.mail_authorization_revision=c.actor_revision
  and c.account_row_version=(select a.xmin::text from public.mail_accounts a where a.id=c.account_id))
$$;
create function composio_c1.row_dto(b public.mail_provider_bindings,ctx jsonb) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',b.id,'revision',b.revision,'status',b.status,'reason',b.reason,'stale',b.account_context is distinct from ctx or (b.status='verified' and not composio_c1.approval_current(b,ctx)),
 'created_at',b.created_at,'reviewed_at',b.reviewed_at,'external_refs',jsonb_build_object('project',composio_c1.mask(b.composio_project_id),'auth_config',composio_c1.mask(b.auth_config_id),'connection',composio_c1.mask(b.connected_account_id),'user',composio_c1.mask(b.composio_user_id),'quota',composio_c1.mask(b.google_quota_project_id)))
$$;
create function composio_c1.payload(kind text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare allowed_keys text[];k text;q jsonb:=p;
begin
 allowed_keys:=array['expected_head_revision','expected_account_revision','expected_brand_revision','expected_context_hash'];
 case kind
 when 'register_candidate' then allowed_keys:=allowed_keys||array['composio_project_id','auth_config_id','connected_account_id','composio_user_id','google_quota_project_id'];
 when 'confirm_binding' then allowed_keys:=allowed_keys||array['binding_id','check_id'];
 when 'revoke_binding' then allowed_keys:=allowed_keys||array['binding_id','reason'];
 else raise exception 'C_BINDING_INVALID_INPUT';end case;
 if p is null or jsonb_typeof(p) is distinct from 'object' then raise exception 'C_BINDING_INVALID_INPUT';end if;
 if not(p ?& allowed_keys) or exists(select 1 from jsonb_object_keys(p) x where not(x=any(allowed_keys))) or octet_length(p::text)>16384 then raise exception 'C_BINDING_INVALID_INPUT';end if;
 foreach k in array allowed_keys loop
  if k=any(array['expected_head_revision','expected_account_revision','expected_brand_revision']) then
   if jsonb_typeof(p->k)<>'number' or p->>k !~ '^(0|[1-9][0-9]{0,15})$' or (p->>k)::numeric>9007199254740991 then raise exception 'C_BINDING_INVALID_INPUT';end if;
  elsif jsonb_typeof(p->k)<>'string' then raise exception 'C_BINDING_INVALID_INPUT';end if;
 end loop;
 if p->>'expected_context_hash' !~ '^[a-f0-9]{64}$' then raise exception 'C_BINDING_INVALID_INPUT';end if;
 if kind='register_candidate' then
  foreach k in array array['composio_project_id','auth_config_id','connected_account_id','composio_user_id','google_quota_project_id'] loop q:=jsonb_set(q,array[k],to_jsonb(btrim(p->>k)));end loop;
  if q->>'composio_project_id' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or q->>'composio_project_id' ~ '^(ac_|ca_)'
   or q->>'auth_config_id' !~ '^ac_[A-Za-z0-9_-]{1,128}$' or q->>'connected_account_id' !~ '^ca_[A-Za-z0-9_-]{1,128}$'
   or char_length(q->>'composio_user_id') not between 1 and 1024 or q->>'composio_user_id' ~ '[[:space:][:cntrl:]]'
   or q->>'google_quota_project_id' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then raise exception 'C_BINDING_INVALID_INPUT';end if;
 else
  if p->>'binding_id' !~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$' then raise exception 'C_BINDING_INVALID_INPUT';end if;
  if kind='confirm_binding' and p->>'check_id' !~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$' then raise exception 'C_BINDING_INVALID_INPUT';end if;
  if kind='revoke_binding' and p->>'reason' not in ('operator_revoked','connection_changed','incorrect_setup') then raise exception 'C_BINDING_INVALID_INPUT';end if;
 end if;
 return q;
end$$;

create function public.composio_binding_page(account uuid,cursor text default null,page_size integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;h public.mail_provider_binding_heads;current_row public.mail_provider_bindings;ids uuid[];history jsonb;next_cursor text;cursor_revision bigint;cursor_id uuid;
begin
 ctx:=composio_c1.context(account);
 if page_size is null or page_size not between 1 and 100 then raise exception 'C_BINDING_INVALID_INPUT';end if;
 if cursor is not null then
  if cursor !~ '^[1-9][0-9]{0,15}:[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$' then raise exception 'C_BINDING_INVALID_INPUT';end if;
  cursor_revision:=split_part(cursor,':',1)::bigint;cursor_id:=split_part(cursor,':',2)::uuid;
  if cursor_revision>9007199254740991 or not exists(select 1 from public.mail_provider_bindings b where b.account_id=account and b.id=cursor_id and b.revision=cursor_revision) then raise exception 'C_BINDING_STALE';end if;
 end if;
 select * into h from public.mail_provider_binding_heads x where x.account_id=account;
 select * into current_row from public.mail_provider_bindings where id=h.current_binding_id;
 select array_agg(x.id order by x.revision desc,x.id desc) into ids from(select b.id,b.revision from public.mail_provider_bindings b where b.account_id=account and (cursor is null or (b.revision,b.id)<(cursor_revision,cursor_id)) order by b.revision desc,b.id desc limit page_size+1)x;
 if coalesce(cardinality(ids),0)>page_size then select b.revision::text||':'||b.id::text into next_cursor from public.mail_provider_bindings b where b.id=ids[page_size];end if;
 select coalesce(jsonb_agg(composio_c1.row_dto(b,ctx) order by b.revision desc,b.id desc),'[]') into history from public.mail_provider_bindings b where b.id=any(ids[1:page_size]);
 return jsonb_build_object('account',jsonb_build_object('id',account,'email',ctx->'email','brand_id',ctx->'brand_id','brand_name',ctx->'brand_name','brand_revision',ctx->'brand_revision','account_revision',ctx->'account_revision','ready',ctx->'ready','context_hash',encode(sha256(convert_to(ctx::text,'UTF8')),'hex')),
  'head_revision',coalesce(h.revision,0),'transport','gmail_oauth','composio_enabled',false,'verification_available',false,'can_confirm',false,
  'current',case when current_row.id is not null then composio_c1.row_dto(current_row,ctx) end,'history',history,'cursor',next_cursor);
end$$;

create function public.composio_binding_command(account uuid,kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;q jsonb;h public.mail_provider_binding_heads;b public.mail_provider_bindings;c public.mail_provider_binding_checks;receipt public.command_receipts;fingerprint text;answer jsonb;next_revision bigint;new_id uuid;
begin
 if current_setting('role',true)<>'authenticated' or public.current_app_role() is distinct from 'superadmin' then raise exception 'C_BINDING_FORBIDDEN';end if;
 if request_key is null then raise exception 'C_BINDING_INVALID_INPUT';end if;
 q:=composio_c1.payload(kind,p);
 -- Private C advisory namespace, not the business-lock ordering of B receipts.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||request_key::text,211));
 ctx:=composio_c1.context(account);
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('account',account,'kind',kind,'payload',q)::text,'UTF8')),'hex');
 select * into receipt from public.command_receipts r where r.user_id=auth.uid() and r.request_key=composio_binding_command.request_key;
 if receipt.user_id is not null then
  if receipt.kind is distinct from 'composio_binding.'||kind or receipt.fingerprint is distinct from fingerprint then raise exception 'C_BINDING_IDEMPOTENCY_CONFLICT';end if;
  return receipt.result;
 end if;
 select * into h from public.mail_provider_binding_heads x where x.account_id=account for update;
 if (q->>'expected_head_revision')::bigint<>coalesce(h.revision,0)
  or (q->>'expected_account_revision')::bigint<>(ctx->>'account_revision')::bigint or (q->>'expected_brand_revision')::bigint<>(ctx->>'brand_revision')::bigint
  or q->>'expected_context_hash' is distinct from encode(sha256(convert_to(ctx::text,'UTF8')),'hex') then raise exception 'C_BINDING_STALE';end if;
 if h.revision=9007199254740991 then raise exception 'C_BINDING_STALE';end if;
 next_revision:=coalesce(h.revision,0)+1;
 if kind='confirm_binding' then
  if h.current_binding_id is distinct from (q->>'binding_id')::uuid then raise exception 'C_BINDING_STALE';end if;
  select * into b from public.mail_provider_bindings where id=h.current_binding_id for update;
  select * into c from public.mail_provider_binding_checks where id=(q->>'check_id')::uuid for update;
  if c.id is null or c.actor_id is distinct from auth.uid() or c.status<>'completed' or c.confirmed_at is not null or c.deadline<=clock_timestamp()
   or not composio_c1.check_current(c,ctx,h,b) or not composio_c1.facts_pass(c.facts) then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
  perform set_config('pipeline_os.c1_command',auth.uid()::text,true);perform set_config('pipeline_os.c2_write','confirm',true);
  update public.mail_provider_binding_checks set confirmed_at=clock_timestamp() where id=c.id;
  update public.mail_provider_bindings set status='verified',reason=null,revision=next_revision,reviewed_by=auth.uid(),reviewed_at=clock_timestamp() where id=b.id;
  new_id:=b.id;answer:=jsonb_build_object('id',new_id,'head_revision',next_revision,'status','verified','transport','gmail_oauth','composio_enabled',false);
 end if;
 perform set_config('pipeline_os.c1_command',auth.uid()::text,true);
 if kind='register_candidate' then
  if not(ctx->>'ready')::boolean then raise exception 'C_BINDING_ACCOUNT_NOT_READY';end if;
  if h.account_id is null then insert into public.mail_provider_binding_heads(account_id,updated_by) values(account,auth.uid());end if;
  update public.mail_provider_bindings set status='superseded',reason='replaced' where id=h.current_binding_id and status in ('candidate','blocked','verified');
  insert into public.mail_provider_bindings(account_id,revision,composio_project_id,auth_config_id,connected_account_id,composio_user_id,google_quota_project_id,expected_mailbox_email,account_context,created_by)
  values(account,next_revision,q->>'composio_project_id',q->>'auth_config_id',q->>'connected_account_id',q->>'composio_user_id',q->>'google_quota_project_id',ctx->>'email',ctx,auth.uid()) returning id into new_id;
  answer:=jsonb_build_object('id',new_id,'head_revision',next_revision,'status','candidate','transport','gmail_oauth','composio_enabled',false);
 elsif kind='revoke_binding' then
  if h.current_binding_id is distinct from (q->>'binding_id')::uuid then raise exception 'C_BINDING_STALE';end if;
  select * into b from public.mail_provider_bindings where id=h.current_binding_id for update;
  if b.id is null or b.status not in ('candidate','blocked','verified') then raise exception 'C_BINDING_STALE';end if;
  update public.mail_provider_bindings set status='revoked',reason=q->>'reason',revision=next_revision where id=b.id;
  new_id:=b.id;answer:=jsonb_build_object('id',new_id,'head_revision',next_revision,'status','revoked','transport','gmail_oauth','composio_enabled',false);
 end if;
 update public.mail_provider_binding_heads set revision=next_revision,current_binding_id=new_id,updated_by=auth.uid(),updated_at=now() where account_id=account;
 begin
  insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request_key,'composio_binding.'||kind,answer,fingerprint);
 exception when unique_violation then raise exception 'C_BINDING_IDEMPOTENCY_CONFLICT';end;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'mail_provider_binding',new_id,'composio_binding.'||kind);
 perform set_config('pipeline_os.c1_command','',true);perform set_config('pipeline_os.c2_write','',true);return answer;
exception when unique_violation then raise exception 'C_BINDING_CONFLICT';
end$$;

-- C2: configuration publication is server-only, never an administrative or transport grant.
create function public.composio_binding_check_context(account uuid,context_digest text) returns void language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception 'C_BINDING_FORBIDDEN';end if;
 if context_digest is null or context_digest !~ '^[a-f0-9]{64}$' then raise exception 'C_BINDING_INVALID_INPUT';end if;
 perform 1 from public.mail_accounts where id=account for update;
 if not found then raise exception 'C_BINDING_NOT_FOUND';end if;
 perform set_config('pipeline_os.c2_write','context',true);
 update public.mail_provider_binding_heads h set verification_context_hash=context_digest,verification_generation=verification_generation+1
 where h.account_id=account and h.verification_context_hash is distinct from context_digest;
 if not exists(select 1 from public.mail_provider_binding_heads h where h.account_id=account) then raise exception 'C_BINDING_STALE';end if;
 perform set_config('pipeline_os.c2_write','',true);
end$$;
create function composio_c1.facts_valid(f jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;keys text[]:=array['project','config','connection','owner','toolkit','active','mailbox','permissions','quota','configuration','reason'];
begin
 if f is null or jsonb_typeof(f) is distinct from 'object' then return false;end if;
 if not(f ?& keys) or exists(select 1 from jsonb_object_keys(f) x where not(x=any(keys))) or octet_length(f::text)>2048 then return false;end if;
 foreach k in array keys loop
  if k<>'reason' and jsonb_typeof(f->k) is distinct from 'boolean' then return false;end if;
 end loop;
 if f->'reason'='null'::jsonb then return not exists(select 1 from unnest(keys) x where x<>'reason' and f->x<>'true'::jsonb);end if;
 return jsonb_typeof(f->'reason')='string' and f->>'reason' in ('identity_mismatch','verification_incomplete','provider_unavailable','permission_unproven','stale_context')
  and exists(select 1 from unnest(keys) x where x<>'reason' and f->x='false'::jsonb);
end$$;
create function composio_c1.facts_pass(f jsonb) returns boolean language sql immutable set search_path='' as $$
 select composio_c1.facts_valid(f) and f->'reason'='null'::jsonb
$$;
create function public.composio_binding_check_begin(account uuid,binding uuid,expected jsonb,context_digest text,nonce_hash text,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;q jsonb;h public.mail_provider_binding_heads;b public.mail_provider_bindings;r public.command_receipts;fp text;answer jsonb;new_id uuid:=gen_random_uuid();at_time timestamptz:=clock_timestamp();
begin
 if current_setting('role',true)<>'authenticated' or public.current_app_role() is distinct from 'superadmin' then raise exception 'C_BINDING_FORBIDDEN';end if;
 if request_key is null or binding is null or jsonb_typeof(expected) is distinct from 'object' or expected ?| array['binding_id','check_id'] or context_digest is null or context_digest !~ '^[a-f0-9]{64}$' or nonce_hash is null or nonce_hash !~ '^[a-f0-9]{64}$' then raise exception 'C_BINDING_INVALID_INPUT';end if;
 q:=composio_c1.payload('confirm_binding',expected||jsonb_build_object('binding_id',binding,'check_id',request_key));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||request_key::text,211));
 ctx:=composio_c1.context(account);
 fp:=encode(sha256(convert_to(jsonb_build_object('account',account,'binding',binding,'expected',q,'context',context_digest,'nonce_hash',nonce_hash)::text,'UTF8')),'hex');
 select * into r from public.command_receipts x where x.user_id=auth.uid() and x.request_key=composio_binding_check_begin.request_key;
 if r.user_id is not null then
  if r.kind is distinct from 'composio_binding.check_begin' or r.fingerprint is distinct from fp then raise exception 'C_BINDING_IDEMPOTENCY_CONFLICT';end if;
  return r.result;
 end if;
 select * into h from public.mail_provider_binding_heads x where x.account_id=account for update;
 select * into b from public.mail_provider_bindings where id=h.current_binding_id for update;
 if h.current_binding_id is distinct from binding or b.status not in ('candidate','blocked') or b.account_context is distinct from ctx or not(ctx->>'ready')::boolean
  or h.verification_context_hash is distinct from context_digest or h.revision is distinct from (q->>'expected_head_revision')::bigint
  or (ctx->>'account_revision')::bigint<>(q->>'expected_account_revision')::bigint or (ctx->>'brand_revision')::bigint<>(q->>'expected_brand_revision')::bigint
  or q->>'expected_context_hash' is distinct from encode(sha256(convert_to(ctx::text,'UTF8')),'hex') then raise exception 'C_BINDING_STALE';end if;
 perform set_config('pipeline_os.c2_write','begin',true);
 update public.mail_provider_binding_checks set status='expired',finished_at=at_time where binding_id=binding and status='prepared' and deadline<=at_time;
 insert into public.mail_provider_binding_checks(id,account_id,binding_id,binding_revision,head_revision,actor_id,actor_revision,context_hash,token_hash,verification_context_hash,verification_generation,account_row_version,started_at,deadline)
 values(new_id,account,binding,b.revision,h.revision,auth.uid(),(select mail_authorization_revision from public.profiles where id=auth.uid()),q->>'expected_context_hash',nonce_hash,context_digest,h.verification_generation,(select a.xmin::text from public.mail_accounts a where a.id=account),at_time,at_time+interval '10 minutes');
 answer:=jsonb_build_object('id',new_id,'status','prepared');
 insert into public.command_receipts(user_id,request_key,kind,fingerprint,result) values(auth.uid(),request_key,'composio_binding.check_begin',fp,answer);
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'mail_provider_binding',binding,'composio_binding.check_begin');
 perform set_config('pipeline_os.c2_write','',true);return answer;
exception when unique_violation then raise exception 'C_BINDING_CONFLICT';
end$$;
create function composio_c1.ticket(check_id uuid,nonce text,context_digest text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.mail_provider_binding_checks;b public.mail_provider_bindings;h public.mail_provider_binding_heads;ctx jsonb;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'C_BINDING_FORBIDDEN';end if;
 if nonce is null or nonce !~ '^[a-f0-9]{64}$' or context_digest is null or context_digest !~ '^[a-f0-9]{64}$' then raise exception 'C_BINDING_INVALID_INPUT';end if;
 select * into c from public.mail_provider_binding_checks where id=check_id;
 if c.id is null or c.token_hash is distinct from encode(sha256(convert_to(nonce,'UTF8')),'hex') then raise exception 'C_BINDING_EVIDENCE_REQUIRED';end if;
 ctx:=composio_c1.context_locked(c.account_id,c.actor_id);
 select * into h from public.mail_provider_binding_heads where account_id=c.account_id for update;
 select * into b from public.mail_provider_bindings where id=h.current_binding_id for update;
 select * into c from public.mail_provider_binding_checks where id=check_id for update;
 if c.status<>'prepared' or c.deadline<=clock_timestamp() or c.verification_context_hash is distinct from context_digest or not composio_c1.check_current(c,ctx,h,b) then raise exception 'C_BINDING_STALE';end if;
 return jsonb_build_object('account_id',c.account_id,'binding_id',b.id,'composio_project_id',b.composio_project_id,'auth_config_id',b.auth_config_id,'connected_account_id',b.connected_account_id,'composio_user_id',b.composio_user_id,'google_quota_project_id',b.google_quota_project_id,'expected_mailbox_email',b.expected_mailbox_email);
end$$;
create function public.composio_binding_check_snapshot(check_id uuid,nonce text,context_digest text) returns jsonb language sql security definer set search_path='' as $$
 select composio_c1.ticket(check_id,nonce,context_digest)
$$;
create function public.composio_binding_check_finish(check_id uuid,nonce text,context_digest text,facts jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target jsonb;c public.mail_provider_binding_checks;passed boolean;at_time timestamptz:=clock_timestamp();evidence text;
begin
 target:=composio_c1.ticket(check_id,nonce,context_digest);
 if not composio_c1.facts_valid(facts) then raise exception 'C_BINDING_INVALID_INPUT';end if;
 select * into c from public.mail_provider_binding_checks where id=check_id;
 passed:=composio_c1.facts_pass(facts);
 evidence:=encode(sha256(convert_to(jsonb_build_object('check_id',c.id,'binding',target,'head',c.head_revision,'actor',c.actor_id,'actor_revision',c.actor_revision,'context',c.context_hash,'configuration',c.verification_context_hash,'generation',c.verification_generation,'deadline',c.deadline,'facts',facts)::text,'UTF8')),'hex');
 perform set_config('pipeline_os.c2_write','finish',true);
 update public.mail_provider_binding_checks set status=case when passed then 'completed' else 'failed' end,facts=composio_binding_check_finish.facts,evidence_digest=evidence,finished_at=at_time where id=c.id;
 if not passed then
  update public.mail_provider_bindings set status='blocked',reason=facts->>'reason',revision=revision+1 where id=c.binding_id;
  update public.mail_provider_binding_heads set revision=revision+1,updated_at=at_time where account_id=c.account_id;
 end if;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(c.actor_id,'mail_provider_binding',c.binding_id,'composio_binding.check_finish');
 perform set_config('pipeline_os.c2_write','',true);
 return jsonb_build_object('id',c.id,'status',case when passed then 'completed' else 'failed' end);
end$$;

revoke all on all functions in schema composio_c1 from public,anon,authenticated,service_role;
revoke all on function public.composio_binding_page(uuid,text,integer),public.composio_binding_command(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.composio_binding_page(uuid,text,integer),public.composio_binding_command(uuid,text,jsonb,uuid) to authenticated;
revoke all on function public.composio_binding_check_context(uuid,text),public.composio_binding_check_begin(uuid,uuid,jsonb,text,text,uuid),public.composio_binding_check_snapshot(uuid,text,text),public.composio_binding_check_finish(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.composio_binding_check_begin(uuid,uuid,jsonb,text,text,uuid) to authenticated;
grant execute on function public.composio_binding_check_context(uuid,text),public.composio_binding_check_snapshot(uuid,text,text),public.composio_binding_check_finish(uuid,text,text,jsonb) to service_role;
commit;
