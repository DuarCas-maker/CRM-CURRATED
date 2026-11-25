-- Application rollback first. Keep recovered data and audit evidence.
-- A funding campaign needs an explicit queue/sequence review before rollback;
-- never reactivate, delete or resend it as part of a schema reversal.
begin;
set local lock_timeout='5s';
do $$declare r record;begin
 if exists(select 1 from public.campaigns where funding_model is not null) then raise exception 'Review funding campaigns before rollback';end if;
 if exists(select 1 from public.email_templates where funding_model is not null and archived_at is null) then raise exception 'Archive funding templates before rollback';end if;
 for r in select definition from funding_v1.function_backup loop execute r.definition;end loop;
end$$;
drop trigger funding_snapshot on public.campaigns;
drop trigger funding_snapshot on public.campaign_enrollments;
revoke execute on function public.recover_import_monthly_income(uuid,jsonb) from service_role;
-- Expanded columns, the private audit and version history intentionally stay.
notify pgrst,'reload schema';
commit;
