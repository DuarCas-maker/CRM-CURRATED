begin;
drop function public.legacy_worker_mail_context(uuid,uuid,uuid,uuid,uuid);
notify pgrst,'reload schema';
commit;
