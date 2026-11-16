-- Destructive reversal: ephemeral QA only; remote execution requires backup/approval.
begin;
drop function public.user_management_list(text,integer);
drop function public.user_management_access(uuid,public.app_role,boolean,public.app_role,boolean);
drop function public.user_management_finish_create(uuid,uuid,text,text,public.app_role);
drop function public.user_management_private_read(uuid,uuid);
drop function public.user_management_private_write(uuid,uuid,text,integer);
drop function public.user_management_password_audit(uuid,uuid,text);
drop function public.user_management_assert_actor(uuid);
drop table public.user_private_fields;
commit;
