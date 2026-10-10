-- Controlled Gmail analysis. Does not create contacts, opportunities, sends or Bouncer jobs.
begin;
alter table public.mail_accounts add column owner_id uuid references public.profiles;
alter table public.mail_accounts add column sync_enabled boolean not null default false;

create table public.gmail_runs (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.mail_accounts,
 purpose text not null check(purpose in ('historical','continuous')),
 status text not null default 'analyzing' check(status in ('analyzing','review','importing','completed','paused','failed','undone')),
 resume_status text, phase text not null default 'list' check(phase in ('list','read','preview','import')),
 from_at timestamptz not null, until_at timestamptz not null, copy_since timestamptz not null,
 baseline_history_id text, start_history_id text, page_token text, pending_ids text[] not null default '{}',
 offset_index int not null default 0, exhausted boolean not null default false,
 estimated_messages int not null default 0, scanned int not null default 0, skipped int not null default 0,
 imported int not null default 0, errors int not null default 0, last_error text, retry_at timestamptz,
 created_by uuid not null references public.profiles, request_key uuid not null unique default gen_random_uuid(), created_at timestamptz not null default now(), finished_at timestamptz,
 lease_token uuid, lease_until timestamptz, approved_at timestamptz, approved_by uuid references public.profiles
);
create unique index gmail_one_running_scan on public.gmail_runs(account_id) where status in ('analyzing','importing');
create table public.gmail_archive_messages (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.mail_accounts,
 gmail_message_id text not null, gmail_thread_id text not null, internet_message_id text not null default '',
 subject text not null, sent_at timestamptz not null, direction text not null check(direction in ('inbound','outbound')),
 nature text not null check(nature in ('personal','campaign','automatic','permanent_bounce','temporary_bounce','delivery_report')),
 participants jsonb not null, attachment_index jsonb not null default '[]', encrypted_payload text not null,
 created_at timestamptz not null default now(), unique(account_id,gmail_message_id)
);
create index gmail_archive_thread on public.gmail_archive_messages(account_id,gmail_thread_id);
create index gmail_archive_dates on public.gmail_archive_messages(account_id,sent_at);
create table public.gmail_run_messages (
 run_id uuid not null references public.gmail_runs, message_id uuid not null references public.gmail_archive_messages,
 primary key(run_id,message_id)
);
create table public.gmail_candidates (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.gmail_runs,
 email text not null, name text not null default '', company_name text not null default '', phone text not null default '',
 participant_kind text not null default 'unknown' check(participant_kind in ('unknown','client','lender','broker','other')),
 classification text not null default 'unknown' check(classification in ('unknown','active','inactive')),
 copied_only boolean not null default false, message_count int not null, inbound_count int not null, outbound_count int not null,
 campaign_count int not null, attachment_count int not null, copy_count int not null,
 first_at timestamptz not null, last_at timestamptz not null, last_personal_at timestamptz,
 existing_contact_id uuid references public.contacts, existing_company_id uuid references public.companies,
 candidate_opportunity_ids uuid[] not null default '{}', evidence_ids uuid[] not null,
 selected boolean not null default false, imported_at timestamptz, last_error text, result_opportunity_id uuid references public.opportunities,
 unique(run_id,email)
);
create table public.gmail_sync_state (
 account_id uuid primary key references public.mail_accounts, history_id text, active_run_id uuid references public.gmail_runs,
 last_synced_at timestamptz, last_error text
);
create function public.gmail_claim_run(run uuid) returns setof public.gmail_runs language plpgsql security definer set search_path='' as $$
begin
 return query update public.gmail_runs set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
 where id=run and status in ('analyzing','importing') and (retry_at is null or retry_at<now()) and (lease_until is null or lease_until<now()) returning *;
end $$;
create function public.gmail_store_message(run uuid,lease uuid,entry jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.gmail_runs; target uuid;
begin
 select * into r from public.gmail_runs where id=run and lease_token=lease and status='analyzing' for update;
 if r.id is null then raise exception 'Scan lease lost or paused'; end if;
 insert into public.gmail_archive_messages(account_id,gmail_message_id,gmail_thread_id,internet_message_id,subject,sent_at,direction,nature,participants,attachment_index,encrypted_payload)
 values(r.account_id,entry->>'gmail_message_id',entry->>'gmail_thread_id',coalesce(entry->>'internet_message_id',''),entry->>'subject',(entry->>'sent_at')::timestamptz,entry->>'direction',entry->>'nature',entry->'participants',entry->'attachment_index',entry->>'encrypted_payload')
 on conflict(account_id,gmail_message_id) do nothing returning id into target;
 if target is null then select id into target from public.gmail_archive_messages where account_id=r.account_id and gmail_message_id=entry->>'gmail_message_id'; end if;
 insert into public.gmail_run_messages values(r.id,target) on conflict do nothing;
 if found then update public.gmail_runs set scanned=scanned+1,lease_until=now()+interval '2 minutes' where id=r.id; end if;
 return target;
end $$;
create function public.gmail_build_preview(run uuid,lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.gmail_runs;
begin
 select * into r from public.gmail_runs where id=run and lease_token=lease and status='analyzing' for update;
 if r.id is null then raise exception 'Scan lease lost or paused'; end if;
 insert into public.gmail_candidates(run_id,email,name,copied_only,message_count,inbound_count,outbound_count,campaign_count,attachment_count,copy_count,first_at,last_at,last_personal_at,evidence_ids)
 select r.id,p->>'email',max(p->>'name'),
 bool_and(not ((m.direction='inbound' and p->>'role'='from') or (m.direction='outbound' and p->>'role'='to'))),
 count(distinct m.id),count(distinct m.id) filter(where m.direction='inbound' and p->>'role'='from'),
 count(distinct m.id) filter(where m.direction='outbound' and p->>'role'='to'),
 count(distinct m.id) filter(where m.nature='campaign'),
 sum(jsonb_array_length(m.attachment_index)),
 sum((select count(*) from jsonb_array_elements(m.attachment_index) a where m.sent_at>=r.copy_since)),
 min(m.sent_at),max(m.sent_at),max(m.sent_at) filter(where m.nature='personal' and ((m.direction='inbound' and p->>'role'='from') or (m.direction='outbound' and p->>'role'='to'))),
 array_agg(distinct m.id)
 from public.gmail_run_messages rm join public.gmail_archive_messages m on m.id=rm.message_id
 cross join lateral (select distinct on (x->>'email') x as p from jsonb_array_elements(m.participants) x
 order by x->>'email',case when (m.direction='inbound' and x->>'role'='from') or (m.direction='outbound' and x->>'role'='to') then 0 else 1 end) participant
 where rm.run_id=r.id and not exists(select 1 from public.mail_accounts a where a.email=p->>'email')
 and p->>'email' !~ '^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@'
 group by p->>'email' on conflict(run_id,email) do nothing;
 update public.gmail_candidates c set existing_contact_id=ct.id,existing_company_id=ct.company_id,
 company_name=coalesce(co.name,''),candidate_opportunity_ids=coalesce((select array_agg(o.id) from public.opportunities o where o.contact_id=ct.id or (ct.company_id is not null and o.company_id=ct.company_id)),'{}')
 from public.contacts ct left join public.companies co on co.id=ct.company_id where c.run_id=r.id and ct.email=c.email;
 update public.gmail_candidates c set participant_kind='lender' where c.run_id=r.id and exists(select 1 from public.lenders l where lower(l.email)=c.email);
 update public.gmail_runs set status='review',
 phase='preview',finished_at=now(),lease_token=null,lease_until=null,last_error=null where id=r.id;
 if r.purpose='continuous' then
  update public.gmail_sync_state set history_id=case when history_id is null or history_id::numeric<r.baseline_history_id::numeric then r.baseline_history_id else history_id end,last_synced_at=now(),active_run_id=null,last_error=null where account_id=r.account_id;
 end if;
end $$;

-- Unassociated mailbox data belongs to the administrator, not every user with sender access.
do $$ declare t text; begin
 foreach t in array array['gmail_runs','gmail_archive_messages','gmail_run_messages','gmail_candidates','gmail_sync_state'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy gmail_admin_read on public.%I for select to authenticated using(public.current_app_role()=''superadmin'')',t);
 end loop;
end $$;
revoke all on function public.gmail_claim_run(uuid),public.gmail_store_message(uuid,uuid,jsonb),public.gmail_build_preview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_claim_run(uuid),public.gmail_store_message(uuid,uuid,jsonb),public.gmail_build_preview(uuid,uuid) to service_role;
commit;
