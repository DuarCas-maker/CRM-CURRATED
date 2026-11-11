-- QGR-I03 local-only overlay. I02 remains sealed; no remote ordinal or activation.
begin;
set local search_path=pg_catalog,pg_temp;
do $$begin
 if current_setting('pipeline_os.qgr_local',true) is distinct from 'isolated_test'
 or current_setting('server_version_num')::int not between 150000 and 159999
 or current_database() !~ '^qgr_i02_[a-z0-9_]+$'
 or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'QGR_LOCAL_ONLY';end if;
 if to_regclass('mail_quota.reservations') is null
 or to_regprocedure('public.mail_quota_snapshot()') is not null then raise exception 'QGR_BASE_MISMATCH';end if;
end$$;
alter table mail_quota.reservations add column admitted_at timestamptz;
create function public.mail_quota_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare h mail_quota.head;p jsonb;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'QGR_FORBIDDEN';end if;
 select * into h from mail_quota.head where id=1;
 if not found then raise exception 'QGR_UNAVAILABLE';end if;
 select policy into p from mail_quota.policies where policy_id=h.policy_id and generation=h.generation;
 return jsonb_build_object('closed',h.closed,'policy',p);
end$$;
create function public.mail_quota_admit(request_key uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare h mail_quota.head;r mail_quota.reservations;p jsonb;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'QGR_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(19681110,2);
 select * into h from mail_quota.head where id=1 for share;
 select * into r from mail_quota.reservations x where x.request_key=mail_quota_admit.request_key for update;
 if h.closed or h.policy_id is null or r.request_key is null or r.admitted_at is not null
 or (r.result->>'reserved')::boolean is distinct from true
 or jsonb_typeof(r.input->'deadline_epoch') is distinct from 'number'
 or jsonb_typeof(r.result->'wait_ms') is distinct from 'number'
 or h.policy_id::text is distinct from r.input->>'policy_id'
 or h.generation is distinct from (r.input->>'generation')::bigint
 or clock_timestamp()<r.created_at+(r.result->>'wait_ms')::bigint*interval '1 millisecond'
 or extract(epoch from clock_timestamp())>=(r.input->>'deadline_epoch')::numeric then return false;end if;
 select policy into p from mail_quota.policies where policy_id=h.policy_id and generation=h.generation;
 if p->>'state' is distinct from 'enabled' then return false;end if;
 perform 1 from public.mail_accounts where id=r.account_id and status='connected' for share;
 if not found then return false;end if;
 update mail_quota.reservations x set admitted_at=clock_timestamp() where x.request_key=mail_quota_admit.request_key;
 return true;
end$$;
revoke all on function public.mail_quota_snapshot(),public.mail_quota_admit(uuid) from public,anon,authenticated,service_role;
grant execute on function public.mail_quota_snapshot(),public.mail_quota_admit(uuid) to service_role;
commit;
