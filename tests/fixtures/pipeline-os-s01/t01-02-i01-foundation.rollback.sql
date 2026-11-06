-- I01 SANDBOX ONLY: discards fixture-only objects, never a remote rollback.
begin;
do $$ begin
  if current_setting('pipeline_os.i01_sandbox', true) is distinct from 'in_memory_test' then
    raise exception 'I01 rollback requires the explicit in-memory sandbox marker';
  end if;
end $$;
drop table public.mail_account_brand_reviews;
drop function public.s01_i01_guard_confirmed_review();
drop index public.s01_i01_mail_accounts_brand;
alter table public.mail_accounts
  drop constraint s01_i01_account_brand_revision,
  drop column operating_brand_id,
  drop column brand_revision;
drop policy s01_i01_brand_read on public.operating_brands;
drop table public.operating_brand_memberships;
drop table public.operating_brands;
commit;
