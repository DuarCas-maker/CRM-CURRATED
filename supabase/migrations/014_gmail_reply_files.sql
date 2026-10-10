begin;
alter table public.outbox add column gmail_file_ids uuid[] not null default '{}';
commit;
