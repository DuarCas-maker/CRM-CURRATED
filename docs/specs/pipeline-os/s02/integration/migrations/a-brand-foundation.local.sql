-- BLOCK A LOCAL CANDIDATE ONLY. No final migration number or remote approval.
-- The test harness sets this marker on an in-memory PGlite connection.
begin;
do $$ begin
  if current_setting('pipeline_os.block_a_local', true) is distinct from 'in_memory_test' then
    raise exception 'I01 requires the explicit in-memory sandbox marker';
  end if;
end $$;

create table public.operating_brands (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check(code = upper(btrim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check(name = btrim(name) and char_length(name) between 1 and 120 and name !~ '^[[:space:]]*$'),
  active boolean not null default false,
  revision bigint not null default 1 check(revision between 1 and 9007199254740991),
  created_by uuid not null references public.profiles on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.operating_brand_memberships (
  brand_id uuid not null references public.operating_brands on delete restrict,
  user_id uuid not null references public.profiles on delete restrict,
  active boolean not null default true,
  revision bigint not null default 1 check(revision between 1 and 9007199254740991),
  assigned_by uuid not null references public.profiles on delete restrict,
  assigned_at timestamptz not null default now(),
  revoked_by uuid references public.profiles on delete restrict,
  revoked_at timestamptz,
  primary key(brand_id, user_id),
  check((active and revoked_by is null and revoked_at is null)
    or (not active and revoked_by is not null and revoked_at is not null))
);
create index s01_i01_membership_user on public.operating_brand_memberships(user_id, brand_id);

alter table public.mail_accounts
  add column operating_brand_id uuid references public.operating_brands on delete restrict,
  add column brand_revision bigint not null default 0,
  add constraint s01_i01_account_brand_revision check(
    brand_revision between 0 and 9007199254740991
    and (operating_brand_id is null or brand_revision > 0)
  );
create index s01_i01_mail_accounts_brand on public.mail_accounts(operating_brand_id)
  where operating_brand_id is not null;

create table public.mail_account_brand_reviews (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.mail_accounts on delete restrict,
  proposed_brand_id uuid references public.operating_brands on delete restrict,
  status text not null default 'pending' check(status in ('pending','confirmed','conflict','discarded')),
  revision bigint not null default 1 check(revision between 1 and 9007199254740991),
  expected_account_revision bigint not null check(expected_account_revision between 0 and 9007199254740991),
  evidence_reference text check(evidence_reference is null or (
    evidence_reference = btrim(evidence_reference)
    and char_length(evidence_reference) between 1 and 120
    and evidence_reference !~ '^[[:space:]]*$'
  )),
  history_approved boolean not null default false,
  history_from timestamptz,
  history_to timestamptz,
  request_key uuid not null,
  created_by uuid not null references public.profiles on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles on delete restrict,
  reviewed_at timestamptz,
  unique(created_by, request_key),
  check((reviewed_by is null) = (reviewed_at is null)),
  check(status <> 'confirmed' or (
    proposed_brand_id is not null and evidence_reference is not null
    and reviewed_by is not null and reviewed_at is not null
  )),
  check((history_from is null and history_to is null) or (
    history_from is not null and history_to is not null
    and isfinite(history_from) and isfinite(history_to) and history_from < history_to
  )),
  check(not history_approved or (
    history_from is not null and history_to is not null and evidence_reference is not null
  ))
);
create unique index s01_i01_review_open_account on public.mail_account_brand_reviews(account_id)
  where status in ('pending','conflict');
create index s01_i01_review_account_status on public.mail_account_brand_reviews(account_id,status);
create index s01_i01_review_brand on public.mail_account_brand_reviews(proposed_brand_id)
  where proposed_brand_id is not null;

create function public.s01_i01_guard_confirmed_review() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'confirmed' then
    raise exception 'Confirmed brand review is immutable' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger s01_i01_confirmed_review before update or delete on public.mail_account_brand_reviews
  for each row execute function public.s01_i01_guard_confirmed_review();
revoke all on function public.s01_i01_guard_confirmed_review() from public,anon,authenticated;
grant execute on function public.s01_i01_guard_confirmed_review() to service_role;

alter table public.operating_brands enable row level security;
alter table public.operating_brand_memberships enable row level security;
alter table public.mail_account_brand_reviews enable row level security;
revoke all on public.operating_brands,public.operating_brand_memberships,public.mail_account_brand_reviews
  from public,anon,authenticated;
grant select on public.operating_brands,public.operating_brand_memberships,public.mail_account_brand_reviews to authenticated;
grant all on public.operating_brands,public.operating_brand_memberships,public.mail_account_brand_reviews to service_role;

create policy s01_i01_brand_read on public.operating_brands for select to authenticated using(
  public.current_app_role() is not null and (
    public.current_app_role() = 'superadmin' or exists(
      select 1 from public.operating_brand_memberships m
      where m.brand_id = operating_brands.id and m.user_id = auth.uid() and m.active
    )
  )
);
create policy s01_i01_membership_read on public.operating_brand_memberships for select to authenticated using(
  public.current_app_role() is not null
  and (public.current_app_role() = 'superadmin' or user_id = auth.uid())
);
create policy s01_i01_review_read on public.mail_account_brand_reviews for select to authenticated using(
  public.current_app_role() = 'superadmin'
);
commit;
