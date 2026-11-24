-- Safety rollback: retain evidence, blocks, suppressions and SQL guards. Roll
-- the application/worker back to the last tested image if necessary. Disabling
-- these guards or requeueing cancelled mail is never an automatic rollback.
begin;
do $$ begin
 if to_regclass('public.mail_bounce_blocks') is null or to_regprocedure('public.recheck_outbox_delivery_before_brand_b2(uuid)') is null then raise exception 'BOUNCE_PROTECTION_MISSING';end if;
end $$;
commit;
