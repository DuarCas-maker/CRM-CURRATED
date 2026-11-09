-- Additive R06-I03 candidate. Local marker and external transaction; no production ordinal.
do $$begin
 if current_setting('pipeline_os.r06_i03_local',true) is distinct from 'in_memory_test' then raise exception 'R06_I03_LOCAL_MARKER_REQUIRED';end if;
 if to_regprocedure('public.mail_transport_snapshot(uuid)') is null then raise exception 'R06_I03_BASE_REQUIRED';end if;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.mail_transport_command(uuid,text,jsonb,uuid)'::regprocedure) is distinct from '32940e008338529b3afa77adda958267'
 or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.brand_oauth_begin(text,text,jsonb)'::regprocedure) is distinct from 'ece4c476197f146d0f4532d158de474e'
 or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.brand_oauth_finish(text,uuid,text,text,boolean)'::regprocedure) is distinct from '1c76951445b48565b562270ea3dd917c'
 then raise exception 'R06_I03_BASE_MISMATCH';end if;
end$$;
create table mail_runtime.sync_cycles(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references mail_runtime.routes,
 route_revision bigint not null,account_epoch bigint not null,cursor_revision bigint not null,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),deadline timestamptz not null,
 state text not null default 'active' check(state in('active','completed','aborted','uncertain')),
 check(deadline>created_at and deadline<=created_at+interval '15 minutes')
);
create unique index runtime_one_sync on mail_runtime.sync_cycles(account_id) where state in('active','uncertain');
create table mail_runtime.sync_requests(
 cycle_id uuid not null references mail_runtime.sync_cycles,attempt_id uuid primary key references mail_runtime.attempts
);
create index runtime_sync_request_cycle on mail_runtime.sync_requests(cycle_id);
alter table mail_runtime.sync_cycles enable row level security;
alter table mail_runtime.sync_requests enable row level security;
revoke all on mail_runtime.sync_cycles,mail_runtime.sync_requests from public,anon,authenticated,service_role;

-- All cycle paths lock context/account -> route -> cycle -> attempts -> cursor.
create function mail_runtime.lock_cycle(cycle uuid,capability text) returns mail_runtime.sync_cycles language plpgsql security definer set search_path='' as $$
declare c mail_runtime.sync_cycles;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'R06_FORBIDDEN';end if;
 select * into c from mail_runtime.sync_cycles where id=cycle;
 if c.id is null or capability is null or c.token_hash<>mail_runtime.digest(capability) then raise exception 'R06_DENIED';end if;
 perform mail_runtime.context(c.account_id);
 perform 1 from mail_runtime.routes where account_id=c.account_id for update;
 select * into c from mail_runtime.sync_cycles where id=cycle for update;
 return c;
end$$;
create function public.mail_sync_begin(account uuid,expected_revision bigint,capability_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r mail_runtime.routes;c mail_runtime.sync_cycles;k mail_runtime.sync_checkpoints;a public.mail_accounts;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'R06_FORBIDDEN';end if;
 if capability_hash is null or capability_hash !~ '^[a-f0-9]{64}$' or expected_revision is null then raise exception 'R06_INVALID_INPUT';end if;
 ctx:=mail_runtime.context(account);
 select * into r from mail_runtime.routes where account_id=account for update;
 select * into a from public.mail_accounts where id=account;
 if r.account_id is null or r.revision<>expected_revision or not mail_runtime.route_current(r,ctx) or not a.live_enabled or not a.sync_enabled then raise exception 'R06_NOT_READY';end if;
 if exists(select 1 from mail_runtime.sync_cycles where account_id=account and state in('active','uncertain')) then raise exception 'R06_BUSY';end if;
 insert into mail_runtime.sync_checkpoints(account_id) values(account) on conflict do nothing;
 select * into k from mail_runtime.sync_checkpoints where account_id=account for update;
 insert into mail_runtime.sync_cycles(account_id,route_revision,account_epoch,cursor_revision,token_hash,deadline)
 values(account,r.revision,r.account_epoch,k.revision,capability_hash,clock_timestamp()+interval '15 minutes') returning * into c;
 return jsonb_build_object('id',c.id,'account_id',account,'provider',r.provider,'revision',r.revision,'email',a.email,
 'history_id',k.history_id,'since',coalesce(k.last_reconciled_at,a.live_started_at,a.created_at),'deadline',c.deadline);
end$$;
create function public.mail_sync_validate(cycle uuid,capability text) returns boolean language plpgsql security definer set search_path='' as $$
declare c mail_runtime.sync_cycles;r mail_runtime.routes;a public.mail_accounts;
begin
 c:=mail_runtime.lock_cycle(cycle,capability);
 select * into r from mail_runtime.routes where account_id=c.account_id;
 select * into a from public.mail_accounts where id=c.account_id;
 return c.state='active' and c.deadline>clock_timestamp() and c.route_revision=r.revision and c.account_epoch=r.account_epoch
 and a.live_enabled and a.sync_enabled and mail_runtime.route_current(r,mail_runtime.context(c.account_id));
end$$;
create function public.mail_sync_acquire(cycle uuid,capability text,operation text,resource text,capability_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c mail_runtime.sync_cycles;t jsonb;
begin
 c:=mail_runtime.lock_cycle(cycle,capability);
 if operation is null or operation not in('profile','history','messages','message') or not public.mail_sync_validate(cycle,capability) then raise exception 'R06_NOT_READY';end if;
 if (select count(*) from mail_runtime.sync_requests where cycle_id=cycle)>=10201 then raise exception 'R06_BUSY';end if;
 t:=public.mail_transport_acquire(c.account_id,c.route_revision,operation,resource,capability_hash);
 insert into mail_runtime.sync_requests(cycle_id,attempt_id) values(cycle,(t->>'id')::uuid);
 return t;
end$$;
create function public.mail_sync_complete(cycle uuid,capability text,checkpoint text) returns void language plpgsql security definer set search_path='' as $$
declare c mail_runtime.sync_cycles;k mail_runtime.sync_checkpoints;
begin
 c:=mail_runtime.lock_cycle(cycle,capability);
 if checkpoint is null or checkpoint !~ '^[0-9]{1,128}$' then raise exception 'R06_INVALID_INPUT';end if;
 if not public.mail_sync_validate(cycle,capability) then raise exception 'R06_STALE';end if;
 if not exists(select 1 from mail_runtime.sync_requests s join mail_runtime.attempts a on a.id=s.attempt_id where s.cycle_id=cycle and a.operation='profile' and a.state='finished')
 or exists(select 1 from mail_runtime.sync_requests s join mail_runtime.attempts a on a.id=s.attempt_id where s.cycle_id=cycle and a.state not in('finished','known_rejection')) then raise exception 'R06_UNRESOLVED';end if;
 select * into k from mail_runtime.sync_checkpoints where account_id=c.account_id for update;
 if k.revision<>c.cursor_revision or (k.history_id is not null and checkpoint::numeric<k.history_id::numeric) then raise exception 'R06_STALE';end if;
 update mail_runtime.sync_checkpoints set history_id=checkpoint,last_reconciled_at=clock_timestamp(),revision=revision+1 where account_id=c.account_id;
 update mail_runtime.sync_cycles set state='completed' where id=cycle;
end$$;
create function public.mail_sync_abort(cycle uuid,capability text) returns text language plpgsql security definer set search_path='' as $$
declare c mail_runtime.sync_cycles;next_state text;
begin
 c:=mail_runtime.lock_cycle(cycle,capability);
 if c.state<>'active' then return c.state;end if;
 next_state:=case when exists(select 1 from mail_runtime.sync_requests s join mail_runtime.attempts a on a.id=s.attempt_id
 where s.cycle_id=cycle and a.state in('reserved','admitted','uncertain')) then 'uncertain' else 'aborted' end;
 update mail_runtime.sync_cycles set state=next_state where id=cycle;
 return next_state;
end$$;
create function public.mail_transport_schedule() returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.mail_accounts;r mail_runtime.routes;items jsonb:='[]';ctx jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'R06_FORBIDDEN';end if;
 -- Stable account order. No credential inner join: new Composio accounts have none.
 for a in select * from public.mail_accounts where status='connected' order by id loop
  ctx:=mail_runtime.context(a.id);select * into r from mail_runtime.routes where account_id=a.id;
  if r.account_id is not null and mail_runtime.route_current(r,ctx) then
   items:=items||jsonb_build_array(jsonb_build_object('account_id',a.id,'provider',r.provider,'route_revision',r.revision,
   'receive_enabled',a.live_enabled and a.sync_enabled,'watch_expires_at',case when r.provider='gmail_oauth' then (select watch_expires_at from public.mail_credentials where account_id=a.id) end));
  end if;
 end loop;
 return items;
end$$;
create function public.mail_direct_job(account uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r mail_runtime.routes;a public.mail_accounts;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'R06_FORBIDDEN';end if;
 ctx:=mail_runtime.context(account);select * into r from mail_runtime.routes where account_id=account;
 select * into a from public.mail_accounts where id=account;
 if r.provider='gmail_oauth' and a.live_enabled and a.sync_enabled and mail_runtime.route_current(r,ctx) then return r.revision;end if;
 return null;
end$$;
create function mail_runtime.assert_direct_oauth(account uuid) returns void language plpgsql security definer set search_path='' as $$
declare r mail_runtime.routes;
begin
 perform mail_runtime.context(account);select * into r from mail_runtime.routes where account_id=account for update;
 if r.account_id is not null and (r.provider<>'gmail_oauth' or r.state<>'ready'
 or exists(select 1 from mail_runtime.sync_cycles where account_id=account and state in('active','uncertain'))
 or exists(select 1 from mail_runtime.attempts where account_id=account and state in('reserved','admitted','uncertain')))
 then raise exception 'R06_NOT_READY';end if;
end$$;
create function public.mail_transport_review(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r mail_runtime.routes;h public.mail_provider_binding_heads;cfg composio_connect.configuration;a public.mail_accounts;
begin
 perform composio_connect.human();ctx:=mail_runtime.context(account);
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
-- Surgical changes with fixed source hashes above and exact anchors below.
do $$declare d text;old text;new text;begin
 select pg_get_functiondef('public.mail_transport_command(uuid,text,jsonb,uuid)'::regprocedure) into d;
 old:='  if exists(select 1 from mail_runtime.attempts where account_id=account and state in(''reserved'',''admitted'',''uncertain''))';
 new:='  if exists(select 1 from mail_runtime.sync_cycles where account_id=account and state in(''active'',''uncertain'')) or exists(select 1 from mail_runtime.attempts where account_id=account and state in(''reserved'',''admitted'',''uncertain''))';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'R06_I03_ANCHOR_MISMATCH';end if;execute replace(d,old,new);
 select pg_get_functiondef('public.brand_oauth_begin(text,text,jsonb)'::regprocedure) into d;
 old:='  if a.id is null then raise exception ''BRAND_NOT_FOUND'';end if;';
 new:=old||E'\n  perform mail_runtime.assert_direct_oauth(a.id);';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'R06_I03_ANCHOR_MISMATCH';end if;execute replace(d,old,new);
 select pg_get_functiondef('public.brand_oauth_finish(text,uuid,text,text,boolean)'::regprocedure) into d;
 old:=' update public.mail_accounts set status=''connected'',live_enabled=true where id=a.id;';
 new:=' perform mail_runtime.assert_direct_oauth(a.id);'||E'\n'||old;
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'R06_I03_ANCHOR_MISMATCH';end if;execute replace(d,old,new);
end$$;
revoke all on function mail_runtime.lock_cycle(uuid,text),mail_runtime.assert_direct_oauth(uuid) from public,anon,authenticated,service_role;
revoke all on function public.mail_sync_begin(uuid,bigint,text),public.mail_sync_validate(uuid,text),public.mail_sync_acquire(uuid,text,text,text,text),public.mail_sync_complete(uuid,text,text),public.mail_sync_abort(uuid,text),public.mail_transport_schedule(),public.mail_direct_job(uuid) from public,anon,authenticated,service_role;
grant execute on function public.mail_sync_begin(uuid,bigint,text),public.mail_sync_validate(uuid,text),public.mail_sync_acquire(uuid,text,text,text,text),public.mail_sync_complete(uuid,text,text),public.mail_sync_abort(uuid,text),public.mail_transport_schedule(),public.mail_direct_job(uuid) to service_role;
revoke all on function public.mail_transport_review(uuid) from public,anon,authenticated,service_role;
grant execute on function public.mail_transport_review(uuid) to authenticated;
