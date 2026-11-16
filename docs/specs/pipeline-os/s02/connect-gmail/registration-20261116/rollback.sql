begin;
set local lock_timeout='3s';
do $$begin if exists(select 1 from composio_recovery.runs where registered_binding_id is not null) then raise exception 'CANDIDATE_RECEIPTS_MUST_BE_PRESERVED';end if;end$$;
drop function public.composio_connect_recovery_candidate(uuid,jsonb,uuid);
alter table composio_recovery.runs drop column registered_binding_id,drop column registration_key,drop column registration_snapshot,drop column registered_at;
notify pgrst,'reload schema';
commit;
