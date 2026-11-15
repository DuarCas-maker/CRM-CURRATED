-- Candidate recovery, only before any v2 publication/attempt/reservation exists.
-- Once used, close the onboarding flag and preserve records instead of dropping data.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table composio_connect.configuration in access exclusive mode;
lock table composio_connect_runtime.contexts in access exclusive mode;
lock table composio_connect.profile_reservations in access exclusive mode;
do $guard$ begin
 if exists(select 1 from composio_connect.profile_reservations)
 or exists(select 1 from composio_connect_runtime.contexts where descriptor#>'{context,contract_version}'='2'::jsonb)
 or exists(select 1 from composio_connect.configuration where quota_project_id is null)
 or exists(select 1 from composio_connect.attempts where quota_project_id is null)
 then raise exception 'CONNECT_V2_IN_USE_CLOSE_FLAG_AND_PRESERVE';end if;
end $guard$;
drop function public.composio_connect_profile_admit(uuid,uuid,jsonb);
drop function public.composio_connect_profile_reserve(uuid,uuid,jsonb);
drop function public.composio_connect_policy_current(uuid,jsonb);
drop function public.composio_connect_v2_publish(jsonb,integer,integer,bigint);
drop function composio_connect.profile_guard(uuid,jsonb);
drop table composio_connect.profile_reservations;
alter table composio_connect.configuration alter column quota_project_id set not null;
alter table composio_connect.attempts alter column quota_project_id set not null;
-- Original reviewed registration function is appended by the local packager.

-- ORIGINAL BRIDGE
create or replace function composio_connect.register_candidate(a composio_connect.attempts,s composio_connect.subjects) returns uuid
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
notify pgrst, 'reload schema';
commit;
