-- Withdraw unused additive candidate only. Registered evidence is never deleted.
begin;
set local lock_timeout='3s';
do $$begin
 if exists(select 1 from simple_mail.onboarding) or exists(select 1 from simple_mail.health)
 or exists(select 1 from simple_mail.usage) or exists(select 1 from simple_mail.included)
 or exists(select 1 from simple_mail.fallbacks) or exists(select 1 from simple_mail.sync_initial) then raise exception 'SIMPLE_RECEIPTS_MUST_BE_PRESERVED';end if;
end$$;
do $$declare source record;begin
 for source in select * from simple_mail.function_sources loop execute source.definition;end loop;
end$$;
do $$declare signature text;begin
 for signature in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'simple\_mail\_%' escape '\'
 loop execute 'drop function '||signature;end loop;
end$$;
drop schema simple_mail cascade;
alter table public.mail_accounts drop column simple_mail_sync_from;
commit;
