begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $undo$
declare r record;
begin
 for r in select * from campaign_launch_v1.function_backup order by signature loop
  if md5(replace((select prosrc from pg_proc where oid=r.signature::regprocedure),E'\r\n',E'\n')) is distinct from r.after_hash then raise exception 'LAUNCH_ROLLBACK_DRIFT';end if;
  execute r.definition;
  if md5(replace((select prosrc from pg_proc where oid=r.signature::regprocedure),E'\r\n',E'\n')) is distinct from r.before_hash then raise exception 'LAUNCH_ROLLBACK_MISMATCH';end if;
 end loop;
end$undo$;
drop schema campaign_launch_v1 cascade;
notify pgrst,'reload schema';
commit;
