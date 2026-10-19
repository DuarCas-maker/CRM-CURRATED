begin;
create table public.mail_recipient_selections (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 100),
 targets jsonb not null check (jsonb_typeof(targets)='array' and jsonb_array_length(targets) between 1 and 20 and octet_length(targets::text)<=100000)
);
create index mail_recipient_selections_owner on public.mail_recipient_selections(user_id);
alter table public.mail_recipient_selections enable row level security;
grant select,insert,update,delete on public.mail_recipient_selections to authenticated;
grant all on public.mail_recipient_selections to service_role;
create policy mail_recipient_selections_own on public.mail_recipient_selections for all to authenticated
 using(user_id=auth.uid() and public.current_app_role() is not null)
 with check(user_id=auth.uid() and public.current_app_role() is not null);
notify pgrst,'reload schema';
commit;
