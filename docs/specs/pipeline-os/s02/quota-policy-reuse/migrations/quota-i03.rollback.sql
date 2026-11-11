-- Local rollback closes I02 admission and retains all receipt/history data, including admitted_at.
begin;
do $$begin
 if current_setting('pipeline_os.qgr_local',true) is distinct from 'isolated_test'
 or current_database() !~ '^qgr_i02_[a-z0-9_]+$'
 or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'QGR_LOCAL_ONLY';end if;
 perform pg_advisory_xact_lock(19681110,2);
 update mail_quota.head set closed=true where id=1;
end$$;
drop function public.mail_quota_admit(uuid);
drop function public.mail_quota_snapshot();
commit;
