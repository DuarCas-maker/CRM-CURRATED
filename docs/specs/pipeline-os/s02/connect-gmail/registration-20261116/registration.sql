begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
alter table composio_recovery.runs add column registered_binding_id uuid unique references public.mail_provider_bindings,
 add column registration_key uuid,add column registration_snapshot jsonb,add column registered_at timestamptz;
create function public.composio_connect_recovery_candidate(source uuid,expected jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare human jsonb:=composio_connect.human();actor uuid:=(human->>'actor')::uuid;
 r composio_recovery.runs;a composio_connect.attempts;s composio_connect.subjects;m public.mail_accounts;
 v public.mail_account_brand_reviews;h public.mail_provider_binding_heads;ctx jsonb;snapshot jsonb;binding uuid;limit_at timestamptz;
begin
 if (expected is null)<>(request_key is null) or (expected is not null and (jsonb_typeof(expected)<>'object' or octet_length(expected::text)>2048)) then raise exception 'CONNECT_INVALID_INPUT';end if;
 limit_at:=least(to_timestamp((auth.jwt()->>'exp')::numeric),composio_connect_runtime.session_limit(actor,human->>'session_hash'));
 perform pg_advisory_xact_lock(19681110,2);
 select * into r from composio_recovery.runs where source_id=source for update;
 if r.id is null or r.actor_id<>actor or r.state<>'completed' or r.child_id is null then raise exception 'CONNECT_FORBIDDEN';end if;
 select * into a from composio_connect.attempts where id=r.child_id for update;
 if a.actor_id<>actor or a.actor_revision<>(human->>'actor_revision')::bigint or a.observation_digest is null or a.connection_id is null or a.result_binding_id is not null then raise exception 'CONNECT_STALE';end if;
 select * into s from composio_connect.subjects where id=a.subject_id for update;
 ctx:=composio_c1.context_locked(s.account_id,actor);
 select * into m from public.mail_accounts where id=s.account_id for update;
 select * into v from public.mail_account_brand_reviews where id=a.review_id for share;
 select * into h from public.mail_provider_binding_heads where account_id=s.account_id for update;
 if m.operating_brand_id is distinct from a.brand_id or v.status is distinct from 'confirmed' or v.account_id<>m.id or v.proposed_brand_id<>a.brand_id or m.brand_revision<>a.account_revision+1 then raise exception 'CONNECT_NOT_READY';end if;
 if r.registered_binding_id is not null then
  if h.current_binding_id is distinct from r.registered_binding_id or not exists(select 1 from public.mail_provider_bindings p where p.id=r.registered_binding_id and p.status='candidate' and p.connected_account_id=a.connection_id and p.expected_mailbox_email=s.email) then raise exception 'CONNECT_STALE';end if;
  if expected is not null and (r.registration_key<>request_key or r.registration_snapshot<>expected) then raise exception 'CONNECT_CONFLICT';end if;
  snapshot:=r.registration_snapshot;binding:=r.registered_binding_id;
 else
  perform composio_connect_runtime.live_context(a.id,true);
  if exists(select 1 from composio_connect.attempts p where p.subject_id=a.subject_id and p.created_at>a.created_at) then raise exception 'CONNECT_CONFLICT';end if;
  snapshot:=jsonb_build_object('context_hash',composio_connect.digest(ctx::text),'review_revision',v.revision,'config_generation',a.config_generation);
  if expected is not null then
   if snapshot<>expected then raise exception 'CONNECT_STALE';end if;
   -- A fresh human candidate approval; no changes to the expired OAuth capability or deadline.
   a.registration_revision:=m.brand_revision;a.registration_review_revision:=v.revision;
   binding:=composio_connect.register_candidate(a,s);
   update composio_recovery.runs set registered_binding_id=binding,registration_key=composio_connect_recovery_candidate.request_key,registration_snapshot=snapshot,registered_at=clock_timestamp() where id=r.id;
  end if;
 end if;
 if limit_at<=clock_timestamp() or composio_connect.live_actor(actor,human->>'session_hash')<>(human->>'actor_revision')::bigint then raise exception 'CONNECT_FORBIDDEN';end if;
 return jsonb_build_object('state',case when binding is null then 'ready' else 'candidate' end,'expected',snapshot,'brand',(select name from public.operating_brands where id=a.brand_id),'binding_id',binding,'transport_active',false);
end$$;
revoke all on function public.composio_connect_recovery_candidate(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.composio_connect_recovery_candidate(uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
