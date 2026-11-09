-- Additive R06-I02 isolated candidate. External transaction, no production ordinal.
do $$begin
 if current_setting('pipeline_os.r06_i02_local',true) is distinct from 'in_memory_test' then raise exception 'R06_I02_LOCAL_MARKER_REQUIRED';end if;
 if to_regnamespace('mail_runtime') is null then raise exception 'R06_I02_BASE_REQUIRED';end if;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.mail_transport_finish(uuid,text,text)'::regprocedure) is distinct from 'e8a89bcdfcd93659e91e3b35f69a053d' then raise exception 'R06_I02_BASE_MISMATCH';end if;
end$$;
alter table mail_runtime.attempts drop constraint attempts_state_check;
alter table mail_runtime.attempts add constraint attempts_state_check check(state in('reserved','admitted','finished','cancelled_before_wire','uncertain','known_rejection'));
drop index mail_runtime.runtime_one_send;
create unique index runtime_one_send on mail_runtime.attempts(resource) where operation='send' and state not in('cancelled_before_wire','known_rejection');

create function public.mail_transport_snapshot(account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r mail_runtime.routes;b public.mail_provider_bindings;h public.mail_provider_binding_heads;cfg composio_connect.configuration;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'R06_FORBIDDEN';end if;
 ctx:=mail_runtime.context(account);
 select * into r from mail_runtime.routes where account_id=account for update;
 if r.account_id is null or not mail_runtime.route_current(r,ctx) then raise exception 'R06_NOT_READY';end if;
 if r.provider='composio' then
  select * into b from public.mail_provider_bindings where id=r.binding_id;
  select * into h from public.mail_provider_binding_heads where account_id=account;
  select * into cfg from composio_connect.configuration where id=1;
 end if;
 return jsonb_build_object('account_id',account,'provider',r.provider,'revision',r.revision,
  'verification_context_hash',h.verification_context_hash,'config_generation',coalesce(cfg.generation,0),
  'project_id',b.composio_project_id,'auth_config_id',b.auth_config_id,'quota_project_id',b.google_quota_project_id);
end$$;
create function public.mail_transport_validate_context(attempt uuid,capability text,context_digest text,config_generation bigint,admit boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare t mail_runtime.attempts;h public.mail_provider_binding_heads;cfg composio_connect.configuration;
begin
 t:=mail_runtime.lock_attempt(attempt,capability);
 if t.provider='composio' then
  select * into h from public.mail_provider_binding_heads where account_id=t.account_id;
  select * into cfg from composio_connect.configuration where id=1;
  if context_digest is null or context_digest !~ '^[a-f0-9]{64}$' or h.verification_context_hash is distinct from context_digest
  or cfg.generation is distinct from config_generation then return false;end if;
 elsif context_digest is not null or config_generation is distinct from 0::bigint then return false;
 end if;
 return public.mail_transport_validate(attempt,capability,admit);
end$$;
create or replace function public.mail_transport_finish(attempt uuid,capability text,outcome text) returns void language plpgsql security definer set search_path='' as $$
declare t mail_runtime.attempts;known boolean;
begin
 t:=mail_runtime.lock_attempt(attempt,capability);
 if outcome is null or outcome not in('finished','cancelled_before_wire','uncertain','known_rejection') then raise exception 'R06_INVALID_INPUT';end if;
 if t.state=outcome then return;end if;
 if outcome='known_rejection' then
  if t.state not in('admitted','uncertain') then raise exception 'R06_UNRESOLVED';end if;
  -- Reads: a service attestation of a contractual HTTP rejection, never browser input.
  -- Sends require the independently persisted B2 known-quota outcome.
  if t.operation<>'send' then known:=true;
  else select exists(select 1 from public.outbox o join public.mail_brand_dispatch_admissions a on a.id=o.brand_admission_id
    where o.id=t.resource::uuid and o.account_id=t.account_id and o.status='queued' and a.outbox_id=o.id and a.outcome='known_quota') into known;
  end if;
  if not known then raise exception 'R06_UNRESOLVED';end if;
 elsif t.state not in('reserved','admitted','uncertain') or(t.state='uncertain' and(outcome<>'finished' or t.operation<>'send'))
  or(outcome='cancelled_before_wire' and t.state<>'reserved')
  or(outcome='finished' and(t.state not in('admitted','uncertain') or(t.operation='send' and not exists(
    select 1 from public.outbox o join public.mail_brand_dispatch_admissions a on a.id=o.brand_admission_id
    where o.id=t.resource::uuid and o.account_id=t.account_id and o.status='sent' and a.outbox_id=o.id and a.outcome='accepted')))) then raise exception 'R06_UNRESOLVED';
 end if;
 update mail_runtime.attempts set state=outcome where id=t.id;
end$$;
create function public.mail_transport_settle_dispatch(attempt uuid,capability text) returns text language plpgsql security definer set search_path='' as $$
declare t mail_runtime.attempts;result text;
begin
 t:=mail_runtime.lock_attempt(attempt,capability);
 if t.operation<>'send' then raise exception 'R06_INVALID_INPUT';end if;
 if t.state in('finished','known_rejection','cancelled_before_wire') then return t.state;end if;
 select case when o.status='sent' and a.outcome='accepted' then 'finished'
  when o.status='queued' and a.outcome='known_quota' then 'known_rejection' else 'uncertain' end into result
 from public.outbox o left join public.mail_brand_dispatch_admissions a on a.id=o.brand_admission_id and a.outbox_id=o.id
 where o.id=t.resource::uuid and o.account_id=t.account_id;
 result:=coalesce(result,'uncertain');
 perform public.mail_transport_finish(attempt,capability,result);
 return result;
end$$;
create function mail_runtime.hold_outbox() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='sending' and old.status is distinct from 'sending' and exists(select 1 from mail_runtime.attempts t
   where t.operation='send' and t.resource=new.id::text and t.state in('reserved','admitted','uncertain','finished')) then raise exception 'R06_MESSAGE_HELD';end if;
 return new;
end$$;
create trigger runtime_outbox_hold before update of status on public.outbox for each row execute function mail_runtime.hold_outbox();
revoke all on function mail_runtime.hold_outbox() from public,anon,authenticated,service_role;
revoke all on function public.mail_transport_snapshot(uuid),public.mail_transport_validate_context(uuid,text,text,bigint,boolean),public.mail_transport_settle_dispatch(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.mail_transport_snapshot(uuid),public.mail_transport_validate_context(uuid,text,text,bigint,boolean),public.mail_transport_settle_dispatch(uuid,text) to service_role;
