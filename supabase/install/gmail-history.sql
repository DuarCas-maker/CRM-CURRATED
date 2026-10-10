-- Gmail history update: existing Curated installation with migrations 001-008.
-- Run this complete file once as postgres in Supabase SQL Editor.
-- Do NOT also execute migrations 009-015. No data is dropped.
begin;
do $$ begin
 if to_regclass('public.lead_workspace') is null then raise exception 'Apply migrations 001-008 first'; end if;
 if to_regclass('public.gmail_runs') is not null then raise exception 'Gmail schema already exists; apply only missing individual migrations'; end if;
end $$;


-- SOURCE: 009_gmail_archive.sql
-- Controlled Gmail analysis. Does not create contacts, opportunities, sends or Bouncer jobs.

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


-- SOURCE: 010_gmail_history_cases.sql

alter table public.opportunities add column historical_import_id uuid references public.gmail_runs;
alter table public.opportunities add column historical_approved_at timestamptz;
alter table public.opportunities add column primary_account_id uuid references public.mail_accounts;
alter table public.opportunities add column owner_locked_at timestamptz;
alter table public.opportunities add column owner_interaction_at timestamptz;
alter table public.gmail_candidates add column selected_opportunity_id uuid references public.opportunities;
alter table public.gmail_candidates add column selected_process_id uuid;
alter table public.gmail_candidates add column selected_company_id uuid references public.companies;
alter table public.gmail_candidates add column submission_id uuid references public.submissions;

create table public.company_contacts (
 company_id uuid not null references public.companies,contact_id uuid not null references public.contacts,
 relationship text not null check(relationship in ('primary','contact','copy','mentioned','broker','lender','other')),
 source_candidate_id uuid references public.gmail_candidates,primary key(company_id,contact_id)
);
create table public.company_primary_cases (
 company_id uuid primary key references public.companies,opportunity_id uuid not null unique references public.opportunities
);
create table public.financing_processes (
 id uuid primary key default gen_random_uuid(),opportunity_id uuid not null references public.opportunities,
 sequence_number int not null,started_at timestamptz not null,ended_at timestamptz,
 classification text not null check(classification in ('active','inactive','unknown')),
 label text not null,state text not null default 'unclassified',is_unclassified_archive boolean not null default false,source_run_id uuid references public.gmail_runs,
 created_at timestamptz not null default now(),unique(opportunity_id,sequence_number)
);
alter table public.gmail_candidates add foreign key(selected_process_id) references public.financing_processes;
alter table public.conversations add column process_id uuid references public.financing_processes;
alter table public.submissions add column process_id uuid references public.financing_processes;
alter table public.submissions add column withdrawal_reason text;
create table public.gmail_thread_links (
 account_id uuid not null references public.mail_accounts,gmail_thread_id text not null,
 opportunity_id uuid not null references public.opportunities,process_id uuid not null references public.financing_processes,
 submission_id uuid references public.submissions,source_candidate_id uuid references public.gmail_candidates,
 primary key(account_id,gmail_thread_id)
);
create table public.case_events (
 id uuid primary key default gen_random_uuid(),opportunity_id uuid not null references public.opportunities,
 process_id uuid references public.financing_processes,submission_id uuid references public.submissions,
 archive_message_id uuid references public.gmail_archive_messages,document_id uuid references public.documents,
 area public.case_area not null default 'seller',kind text not null,body text not null,
 evidence_type text not null check(evidence_type in ('explicit','inference','manual')),
 occurred_at timestamptz not null,actor_id uuid references public.profiles,dedupe_key text unique,
 created_at timestamptz not null default now()
);
create table public.gmail_import_effects (
 run_id uuid not null references public.gmail_runs,opportunity_id uuid not null references public.opportunities,
 created_case boolean not null,imported_at timestamptz not null default now(),primary key(run_id,opportunity_id)
);
create table public.gmail_saved_attachments (
 id uuid primary key default gen_random_uuid(),archive_message_id uuid not null references public.gmail_archive_messages,
 opportunity_id uuid not null references public.opportunities,process_id uuid not null references public.financing_processes,
 submission_id uuid references public.submissions,part_id text not null,name text not null,mime_type text not null,size int not null,
 storage_path text,content_hash text,status text not null default 'reference' check(status in ('reference','received','incorporated','reviewed','approved')),
 area public.case_area not null default 'seller',last_error text,received_at timestamptz not null,created_at timestamptz not null default now(),
 unique(archive_message_id,part_id,opportunity_id,process_id)
);
create table public.mail_waits (
 id uuid primary key default gen_random_uuid(),opportunity_id uuid not null references public.opportunities,
 conversation_id uuid not null unique references public.conversations,process_id uuid references public.financing_processes,area public.case_area not null,
 waiting_for text not null check(waiting_for in ('team','client','lender')),since_at timestamptz not null,
 source_message_id uuid not null references public.gmail_archive_messages,task_id uuid references public.tasks,
 draft text not null,updated_at timestamptz not null default now()
);

-- Historical approval is a separate eligibility path; it does not pretend Bouncer validated the address.
create or replace function public.require_verified_opportunity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.historical_import_id is not null and new.historical_approved_at is not null and exists(
  select 1 from public.gmail_runs r join public.gmail_candidates gc on gc.run_id=r.id join public.contacts c on c.email=gc.email
  where r.id=new.historical_import_id and r.status='importing' and r.approved_by is not null
  and gc.selected and gc.participant_kind='client' and gc.classification<>'unknown' and c.id=new.contact_id
 ) then return new; end if;
 perform 1 from public.contacts c where c.id=new.contact_id and c.verification='valid' for update;
 if not found or exists(select 1 from public.suppressions s join public.contacts c on c.email=s.email where c.id=new.contact_id) then raise exception 'Verify the lead email before creating an opportunity'; end if;
 new.email_qualified_at:=now(); return new;
end $$;
create or replace function public.can_case(case_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.opportunities o where o.id=case_id and
 (o.email_qualified_at is not null or o.historical_approved_at is not null) and (
 public.current_app_role() in ('superadmin','seller_admin') or
 (public.current_app_role()='seller' and o.seller_id=auth.uid()) or
 (public.current_app_role()='closer_admin' and o.handed_off_at is not null) or
 (public.current_app_role()='closer' and o.closer_id=auth.uid())))
$$;

create function public.gmail_apply_candidate(candidate uuid,lease uuid) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare c public.gmail_candidates;r public.gmail_runs;a public.mail_accounts;ct public.contacts;
 company uuid;case_id uuid;process uuid;owner uuid;created boolean:=false;thread record;count_cases int;
begin
 select * into c from public.gmail_candidates where id=candidate for update;
 select * into r from public.gmail_runs where id=c.run_id and lease_token=lease and status='importing' for update;
 if r.id is null then raise exception 'Import lease lost or paused'; end if;
 if c.imported_at is not null then return c.result_opportunity_id; end if;
 if not c.selected then return null; end if;
 if c.classification='unknown' or c.participant_kind='unknown' then raise exception 'Classification required'; end if;
 select * into a from public.mail_accounts where id=r.account_id;
 owner:=a.owner_id;
 if owner is null or not exists(select 1 from public.profiles where id=owner and active and role in ('seller','seller_admin','superadmin')) then raise exception 'Assign an active seller to this mailbox'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c.email,1));
 select * into ct from public.contacts where email=c.email for update;
 company:=coalesce(c.selected_company_id,c.existing_company_id,ct.company_id);
 if c.selected_opportunity_id is not null then
  select id,company_id into case_id,company from public.opportunities where id=c.selected_opportunity_id;
  if case_id is null or company is null then raise exception 'Choose a case with a company'; end if;
 elsif c.participant_kind<>'client' or c.copied_only then
  raise exception 'Copied, lender and intermediary participants require an explicit case association';
 end if;
 if company is null then
  if btrim(c.company_name)='' then raise exception 'Confirm the company name'; end if;
  -- Similar/equal names are never an implicit merge.
  insert into public.companies(name) values(c.company_name) returning id into company;
 end if;
 if ct.id is null then
  insert into public.contacts(company_id,email,name,phone) values(company,c.email,c.name,c.phone) returning * into ct;
 end if;
 insert into public.company_contacts(company_id,contact_id,relationship,source_candidate_id)
 values(company,ct.id,case when c.copied_only then 'copy' when c.participant_kind='client' then 'contact' else c.participant_kind end,c.id) on conflict do nothing;
 if case_id is null then
  perform pg_advisory_xact_lock(hashtextextended(company::text,19));
  select opportunity_id into case_id from public.company_primary_cases where company_id=company;
  if case_id is null then
   select count(*),min(id::text)::uuid into count_cases,case_id from public.opportunities where company_id=company and archived_at is null;
   if count_cases>1 then raise exception 'Several existing cases; select the principal case'; end if;
  end if;
  if case_id is null then
   insert into public.opportunities(contact_id,company_id,company,seller_id,stage,historical_import_id,historical_approved_at,primary_account_id,owner_interaction_at)
   values(ct.id,company,c.company_name,owner,case when c.classification='inactive' then 'paused'::public.case_stage else 'new'::public.case_stage end,r.id,r.approved_at,a.id,c.last_personal_at) returning id into case_id;
   created:=true;
  end if;
  insert into public.company_primary_cases values(company,case_id) on conflict do nothing;
 end if;
 if exists(select 1 from public.opportunities where id=case_id and email_qualified_at is null and historical_approved_at is null) then
  update public.opportunities set historical_import_id=r.id,historical_approved_at=r.approved_at where id=case_id;
 end if;
 -- Existing commercial fields and manually assigned owners are not overwritten by import.
 if not created and c.last_personal_at is not null then
  update public.opportunities set seller_id=owner,primary_account_id=a.id,owner_interaction_at=c.last_personal_at
  where id=case_id and historical_import_id is not null and owner_locked_at is null and handed_off_at is null
  and (owner_interaction_at is null or owner_interaction_at<c.last_personal_at);
 end if;
 process:=c.selected_process_id;
 if process is not null and not exists(select 1 from public.financing_processes where id=process and opportunity_id=case_id) then raise exception 'Process belongs to another case'; end if;
 if process is null then
  select id into process from public.financing_processes where opportunity_id=case_id and is_unclassified_archive order by sequence_number limit 1;
  if process is null then
   insert into public.financing_processes(opportunity_id,sequence_number,started_at,classification,label,is_unclassified_archive,source_run_id)
   select case_id,coalesce(max(sequence_number),0)+1,c.first_at,'unknown','Historial pendiente de separar en procesos',true,r.id
   from public.financing_processes where opportunity_id=case_id returning id into process;
  end if;
 end if;
 if c.submission_id is not null and not exists(select 1 from public.submissions where id=c.submission_id and opportunity_id=case_id and (process_id is null or process_id=process)) then raise exception 'Lender submission belongs to another process'; end if;
 if c.participant_kind='lender' and c.submission_id is null then raise exception 'Select the lender submission'; end if;
 if c.submission_id is not null then update public.submissions set process_id=process where id=c.submission_id and process_id is null; end if;
 for thread in select distinct m.gmail_thread_id from public.gmail_archive_messages m where m.id=any(c.evidence_ids) loop
  if exists(select 1 from public.gmail_thread_links where account_id=a.id and gmail_thread_id=thread.gmail_thread_id and (opportunity_id<>case_id or process_id<>process or submission_id is distinct from c.submission_id)) then raise exception 'Thread association is ambiguous'; end if;
  if exists(select 1 from public.conversations where account_id=a.id and gmail_thread_id=thread.gmail_thread_id and opportunity_id<>case_id) then raise exception 'Thread already belongs to another case'; end if;
  insert into public.gmail_thread_links values(a.id,thread.gmail_thread_id,case_id,process,c.submission_id,c.id) on conflict do nothing;
 end loop;
 insert into public.gmail_import_effects(run_id,opportunity_id,created_case) values(r.id,case_id,created) on conflict do nothing;
 update public.gmail_candidates set imported_at=now(),result_opportunity_id=case_id,selected_process_id=process where id=c.id;
 update public.gmail_runs set imported=imported+1,lease_until=now()+interval '2 minutes' where id=r.id;
 insert into public.case_events(opportunity_id,process_id,area,kind,body,evidence_type,occurred_at,actor_id,dedupe_key)
 values(case_id,process,'seller','historical_import','Historical Gmail participant confirmed: '||c.email,'manual',r.approved_at,r.approved_by,'candidate:'||c.id) on conflict do nothing;
 return case_id;
end $$;

create function public.gmail_undo_import(run uuid,actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.gmail_import_effects;archived int:=0;retained int:=0;
begin
 if not exists(select 1 from public.profiles where id=actor and active and role='superadmin') then raise exception 'Superadmin required'; end if;
 perform 1 from public.gmail_runs where id=run and status in ('completed','paused','failed') for update;
 if not found then raise exception 'Finish or pause the import before undo'; end if;
 for e in select * from public.gmail_import_effects where run_id=run loop
  if not e.created_case or exists(select 1 from public.activities where opportunity_id=e.opportunity_id and actor_id is not null)
   or exists(select 1 from public.case_events where opportunity_id=e.opportunity_id and actor_id is not null and kind<>'historical_import')
   or exists(select 1 from public.tasks where opportunity_id=e.opportunity_id and not automated)
   or exists(select 1 from public.outbox where opportunity_id=e.opportunity_id)
   or exists(select 1 from public.analyses where opportunity_id=e.opportunity_id)
   or exists(select 1 from public.submissions where opportunity_id=e.opportunity_id)
   or exists(select 1 from public.documents where opportunity_id=e.opportunity_id and (reviewed_at is not null or source<>'checklist'))
   or exists(select 1 from public.opportunities where id=e.opportunity_id and (owner_locked_at is not null or updated_at>e.imported_at)) then retained:=retained+1;
  else
   update public.opportunities set archived_at=now() where id=e.opportunity_id;
   delete from public.company_primary_cases where opportunity_id=e.opportunity_id;
   archived:=archived+1;
  end if;
 end loop;
 -- All evidence, copied documents, contacts and subsequent user work are retained.
 update public.gmail_runs set status='undone',lease_token=null,lease_until=null where id=run;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(actor,'gmail_import',run,'undone',jsonb_build_object('archived',archived,'retained',retained));
 return jsonb_build_object('archived',archived,'retained',retained);
end $$;

create function public.gmail_transfer_case(case_id uuid,owner uuid,account uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.opportunities;
begin
 select * into o from public.opportunities where id=case_id for update;
 if not exists(select 1 from public.profiles where id=owner and active and (role='superadmin' or (o.handed_off_at is null and role in ('seller_admin','seller')) or (o.handed_off_at is not null and role in ('closer_admin','closer')))) then raise exception 'Invalid owner for this phase'; end if;
 if not exists(select 1 from public.mail_accounts where id=account and status='connected') or not exists(select 1 from public.mail_permissions where account_id=account and user_id=owner and can_send) then raise exception 'New owner needs sender permission'; end if;
 update public.opportunities set seller_id=case when handed_off_at is null then owner else seller_id end,
 closer_id=case when handed_off_at is not null then owner else closer_id end,primary_account_id=account,owner_locked_at=now(),updated_at=now() where id=case_id;
 insert into public.case_events(opportunity_id,area,kind,body,evidence_type,occurred_at,actor_id)
 values(case_id,case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end,'owner_transfer','Owner: '||coalesce(o.closer_id,o.seller_id)||' → '||owner||'; account: '||coalesce(o.primary_account_id::text,'')||' → '||account,'manual',now(),actor);
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(actor,'opportunity',case_id,'owner_transfer',jsonb_build_object('previous_owner',coalesce(o.closer_id,o.seller_id),'owner',owner,'previous_account',o.primary_account_id,'account',account));
end $$;

-- Existing case visibility remains the source of truth for company dossiers and process evidence.
do $$ declare t text; begin
 foreach t in array array['financing_processes','case_events','gmail_saved_attachments','mail_waits','gmail_import_effects','gmail_thread_links'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  if t in ('case_events','gmail_saved_attachments','mail_waits') then
   execute format('create policy case_history_read on public.%I for select to authenticated using(public.can_area(opportunity_id,area))',t);
  elsif t in ('gmail_import_effects') then
   execute format('create policy case_history_read on public.%I for select to authenticated using(public.current_app_role()=''superadmin'')',t);
  elsif t in ('gmail_thread_links') then
   execute format('create policy case_history_read on public.%I for select to authenticated using(public.can_case(opportunity_id) and (submission_id is null or public.can_area(opportunity_id,''closer'')))',t) ;
  else
   execute format('create policy case_history_read on public.%I for select to authenticated using(public.can_case(opportunity_id))',t);
  end if;
 end loop;
end $$;
alter table public.company_contacts enable row level security;
alter table public.company_primary_cases enable row level security;
grant select on public.company_contacts,public.company_primary_cases to authenticated;
grant all on public.company_contacts,public.company_primary_cases to service_role;
create policy company_contacts_read on public.company_contacts for select to authenticated using(exists(select 1 from public.opportunities o where o.company_id=company_contacts.company_id and public.can_case(o.id)));
create policy company_primary_read on public.company_primary_cases for select to authenticated using(public.can_case(opportunity_id));
create policy company_shared_contacts on public.contacts for select to authenticated using(exists(select 1 from public.company_contacts cc join public.opportunities o on o.company_id=cc.company_id where cc.contact_id=contacts.id and public.can_case(o.id)));
-- Encryption/base64 overhead: 40 MiB stored, while the decoded file limit is 20 MiB.
insert into storage.buckets(id,name,public,file_size_limit) values('gmail-documents','gmail-documents',false,41943040);
revoke all on function public.gmail_apply_candidate(uuid,uuid),public.gmail_undo_import(uuid,uuid),public.gmail_transfer_case(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_apply_candidate(uuid,uuid),public.gmail_undo_import(uuid,uuid),public.gmail_transfer_case(uuid,uuid,uuid,uuid) to service_role;


-- SOURCE: 011_gmail_evidence.sql

alter table public.messages add column archive_message_id uuid references public.gmail_archive_messages;
alter table public.messages add column nature text not null default 'personal';
alter table public.messages add column participants jsonb not null default '[]';
create unique index message_archive_once on public.messages(archive_message_id) where archive_message_id is not null;

create function public.gmail_link_message(archive_id uuid,snapshot jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;link public.gmail_thread_links;o public.opportunities;co uuid;stored uuid;area public.case_area;event_key text;
begin
 select * into m from public.gmail_archive_messages where id=archive_id;
 select * into link from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if link.opportunity_id is null then return null; end if;
 select * into o from public.opportunities where id=link.opportunity_id;
 area:=case when link.submission_id is not null or (o.handed_off_at is not null and m.sent_at>=o.handed_off_at) then 'closer'::public.case_area else 'seller'::public.case_area end;
 insert into public.conversations(opportunity_id,submission_id,account_id,gmail_thread_id,subject,area,process_id,updated_at)
 values(o.id,link.submission_id,m.account_id,m.gmail_thread_id,m.subject,area,link.process_id,m.sent_at)
 on conflict(account_id,gmail_thread_id) do nothing;
 select id into co from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if not exists(select 1 from public.conversations where id=co and opportunity_id=o.id) then raise exception 'Thread conflict'; end if;
 event_key:='message:'||o.id||':'||case when m.internet_message_id<>'' then md5(m.internet_message_id) else m.id::text end;
 perform pg_advisory_xact_lock(hashtextextended(event_key,41));
 if m.internet_message_id<>'' then
  select msg.id into stored from public.messages msg join public.conversations cv on cv.id=msg.conversation_id where cv.opportunity_id=o.id and msg.internet_message_id=m.internet_message_id limit 1;
 end if;
 if stored is null then
 insert into public.messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status,internet_message_id,archive_message_id,nature,participants)
 values(co,m.gmail_message_id,m.direction,coalesce((select p->>'email' from jsonb_array_elements(m.participants) p where p->>'role'='from' limit 1),''),snapshot->>'body',m.sent_at,case when m.direction='outbound' then 'sent' else 'received' end,m.internet_message_id,m.id,m.nature,m.participants)
 on conflict(conversation_id,gmail_message_id) do update set archive_message_id=excluded.archive_message_id,nature=excluded.nature,participants=excluded.participants returning id into stored;
 else
  update public.messages set archive_message_id=coalesce(archive_message_id,m.id),nature=m.nature,participants=m.participants where id=stored;
 end if;
 insert into public.case_events(opportunity_id,process_id,submission_id,archive_message_id,area,kind,body,evidence_type,occurred_at,dedupe_key)
 values(o.id,link.process_id,link.submission_id,m.id,area,m.nature,case when m.direction='inbound' then 'Received: ' else 'Sent: ' end||m.subject,'explicit',m.sent_at,event_key) on conflict do nothing;
 insert into public.gmail_saved_attachments(archive_message_id,opportunity_id,process_id,submission_id,part_id,name,mime_type,size,received_at,area)
 select m.id,o.id,link.process_id,link.submission_id,a->>'part_id',a->>'name',a->>'mime_type',(a->>'size')::int,m.sent_at,area
 from jsonb_array_elements(m.attachment_index) a on conflict do nothing;
 update public.conversations set updated_at=greatest(updated_at,m.sent_at),needs_attention=case when m.nature='personal' and m.sent_at>=updated_at then m.direction='inbound' else needs_attention end where id=co;
 -- Automatic mail and delivery reports never count as a personal reply.
 if m.nature='personal' and exists(
  select 1 from jsonb_array_elements(m.participants) p where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end
  and (case when link.submission_id is not null then exists(select 1 from public.submissions s join public.lenders l on l.id=s.lender_id where s.id=link.submission_id and lower(l.email)=p->>'email')
  else exists(select 1 from public.contacts c where c.email=p->>'email' and (c.id=o.contact_id or exists(select 1 from public.company_contacts cc where cc.contact_id=c.id and cc.company_id=o.company_id and cc.relationship in ('primary','contact')))) end)
 ) then
  if not exists(select 1 from public.mail_waits where conversation_id=co and since_at>=m.sent_at) then
   if exists(select 1 from public.mail_waits w join public.tasks t on t.id=w.task_id where w.conversation_id=co and t.status='open') then
    update public.tasks set status='done' where id=(select task_id from public.mail_waits where conversation_id=co);
   end if;
   insert into public.mail_waits(opportunity_id,conversation_id,process_id,area,waiting_for,since_at,source_message_id,draft)
   values(o.id,co,link.process_id,area,case when m.direction='inbound' then 'team' when link.submission_id is not null then 'lender' else 'client' end,m.sent_at,m.id,
   case when m.direction='inbound' then 'Thank you for your message. We are reviewing your request and will follow up with the next steps.' else 'Hello, I am following up on our previous message. Could you please share an update?' end)
   on conflict(conversation_id) do update set waiting_for=excluded.waiting_for,since_at=excluded.since_at,source_message_id=excluded.source_message_id,task_id=null,draft=excluded.draft,updated_at=now();
  end if;
 end if;
 return stored;
end $$;

create function public.gmail_followups() returns void language plpgsql security definer set search_path='' as $$
declare w public.mail_waits;o public.opportunities;task uuid;recipient uuid;
begin
 for w in select * from public.mail_waits where task_id is null and since_at<=now()-interval '5 days' order by since_at for update skip locked limit 200 loop
  select * into o from public.opportunities where id=w.opportunity_id and archived_at is null and stage not in ('funded','lost','paused');
  if o.id is null then continue; end if;
  recipient:=case when w.area='closer' then coalesce(o.closer_id,o.seller_id) else o.seller_id end;
  insert into public.tasks(opportunity_id,owner_id,title,due_at,area,automated)
  values(o.id,recipient,'Five calendar days: waiting for '||w.waiting_for,w.since_at+interval '5 days',w.area,true) returning id into task;
  update public.mail_waits set task_id=task where id=w.id;
 end loop;
end $$;

revoke all on function public.gmail_link_message(uuid,jsonb),public.gmail_followups() from public,anon,authenticated;
grant execute on function public.gmail_link_message(uuid,jsonb),public.gmail_followups() to service_role;


-- SOURCE: 012_gmail_preview.sql

create function public.gmail_preview_stats(run uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if public.current_app_role() is distinct from 'superadmin'::public.app_role then raise exception 'Superadmin required'; end if;
 select jsonb_build_object('messages',count(*),'first_at',min(m.sent_at),'last_at',max(m.sent_at),
 'documents',coalesce(sum(jsonb_array_length(m.attachment_index)),0),
 'documents_to_copy',coalesce(sum(case when m.sent_at>=r.copy_since then jsonb_array_length(m.attachment_index) else 0 end),0)) into result
 from public.gmail_run_messages rm join public.gmail_archive_messages m on m.id=rm.message_id join public.gmail_runs r on r.id=rm.run_id where rm.run_id=run;
 return result||jsonb_build_object('candidates',(select count(*) from public.gmail_candidates where run_id=run),
 'selected',(select count(*) from public.gmail_candidates where run_id=run and selected),
 'matches',(select count(*) from public.gmail_candidates where run_id=run and existing_contact_id is not null),
 'ambiguous',(select count(*) from public.gmail_candidates where run_id=run and (copied_only or cardinality(candidate_opportunity_ids)>1)),
 'months',coalesce((select jsonb_agg(x order by x.month_label) from (
 select to_char(m.sent_at,'YYYY-MM') month_label,count(distinct m.id) messages,count(distinct p->>'email') direct_participants
 from public.gmail_run_messages rm join public.gmail_archive_messages m on m.id=rm.message_id cross join lateral jsonb_array_elements(m.participants) p
 where rm.run_id=run and ((m.direction='inbound' and p->>'role'='from') or (m.direction='outbound' and p->>'role'='to'))
 and not exists(select 1 from public.mail_accounts a where a.email=p->>'email') group by 1) x),'[]'::jsonb));
end $$;
revoke all on function public.gmail_preview_stats(uuid) from public,anon;
grant execute on function public.gmail_preview_stats(uuid) to authenticated,service_role;
create function public.gmail_import_message_page(run uuid,cursor_offset int) returns setof public.gmail_archive_messages language sql security definer set search_path='' as $$
 select m.* from public.gmail_archive_messages m join public.gmail_run_messages rm on rm.message_id=m.id
 where rm.run_id=run and exists(select 1 from public.gmail_thread_links l
 where l.account_id=m.account_id and l.gmail_thread_id=m.gmail_thread_id and exists(
  select 1 from public.gmail_candidates c join public.gmail_archive_messages evidence on evidence.id=any(c.evidence_ids)
  where c.run_id=run and c.selected and c.imported_at is not null and c.result_opportunity_id=l.opportunity_id
  and evidence.account_id=m.account_id and evidence.gmail_thread_id=m.gmail_thread_id))
 order by m.id offset greatest(cursor_offset,0) limit 10
$$;
revoke all on function public.gmail_import_message_page(uuid,int) from public,anon,authenticated;
grant execute on function public.gmail_import_message_page(uuid,int) to service_role;
create function public.gmail_unlinked_message_count(run uuid) returns int language sql security definer set search_path='' as $$
 select count(*)::int from public.gmail_run_messages rm join public.gmail_archive_messages m on m.id=rm.message_id
 where rm.run_id=run and not exists(select 1 from public.gmail_thread_links l where l.account_id=m.account_id and l.gmail_thread_id=m.gmail_thread_id)
$$;
create function public.gmail_archive_checkpoint(account uuid,checkpoint text) returns void language sql security definer set search_path='' as $$
 insert into public.gmail_sync_state(account_id,history_id) values(account,checkpoint)
 on conflict(account_id) do update set history_id=case when public.gmail_sync_state.history_id is null or public.gmail_sync_state.history_id::numeric<excluded.history_id::numeric then excluded.history_id else public.gmail_sync_state.history_id end
$$;
revoke all on function public.gmail_unlinked_message_count(uuid),public.gmail_archive_checkpoint(uuid,text) from public,anon,authenticated;
grant execute on function public.gmail_unlinked_message_count(uuid),public.gmail_archive_checkpoint(uuid,text) to service_role;


-- SOURCE: 013_financing_history.sql

alter table public.gmail_saved_attachments add column reviewed_by uuid references public.profiles;
alter table public.gmail_saved_attachments add column reviewed_at timestamptz;
alter table public.financing_processes add column actual_funded_amount numeric(16,2);
alter table public.financing_processes add column funded_lender_id uuid references public.lenders;
alter table public.financing_processes add column request_key uuid unique;
alter table public.financing_processes add constraint historical_funding_evidence check(state<>'disbursed' or (actual_funded_amount is not null and actual_funded_amount>0 and funded_lender_id is not null));

create function public.gmail_record_process(process uuid,state_value text,evidence uuid,document uuid,body_text text,occurred timestamptz,actor uuid,funded_amount numeric,lender uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.financing_processes;area public.case_area;
begin
 select * into p from public.financing_processes where id=process for update;
 if p.id is null then raise exception 'Process not found'; end if;
 if evidence is null and document is null then raise exception 'Email or document evidence required'; end if;
 if evidence is not null and not exists(select 1 from public.case_events where opportunity_id=p.opportunity_id and archive_message_id=evidence) then raise exception 'Email belongs to another case'; end if;
 if document is not null and not exists(select 1 from public.documents where id=document and opportunity_id=p.opportunity_id) then raise exception 'Document belongs to another case'; end if;
 if state_value not in ('unclassified','new','contacted','waiting_customer','application_received','documents_received','prepared','submitted','lender_evaluation','offers','lender_selected','requirements','contract_sent','contract_signed','final_approval','disbursed','client_withdrew','funding_declined') then raise exception 'Unknown process state'; end if;
 area:=case when state_value in ('submitted','lender_evaluation','offers','lender_selected','requirements','contract_sent','contract_signed','final_approval','disbursed','funding_declined') or exists(select 1 from public.opportunities where id=p.opportunity_id and handed_off_at is not null) then 'closer'::public.case_area else 'seller'::public.case_area end;
 update public.financing_processes set state=state_value,actual_funded_amount=case when state_value='disbursed' then funded_amount else actual_funded_amount end,
 funded_lender_id=case when state_value='disbursed' then lender else funded_lender_id end where id=p.id;
 insert into public.case_events(opportunity_id,process_id,archive_message_id,document_id,area,kind,body,evidence_type,occurred_at,actor_id)
 values(p.opportunity_id,p.id,evidence,document,area,state_value,body_text,'manual',occurred,actor);
 update public.opportunities set updated_at=now() where id=p.opportunity_id;
end $$;

create function public.gmail_select_lender(process uuid,submission uuid,evidence uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.financing_processes;
begin
 select * into p from public.financing_processes where id=process for update;
 if not exists(select 1 from public.submissions where id=submission and opportunity_id=p.opportunity_id and process_id=p.id and status='offer') then raise exception 'Select an offer in this process'; end if;
 if not exists(select 1 from public.case_events where opportunity_id=p.opportunity_id and archive_message_id=evidence) then raise exception 'Selection evidence required'; end if;
 update public.submissions set status='withdrawn',withdrawal_reason='selected_other_offer' where process_id=p.id and id<>submission and status in ('draft','submitted','reviewing','requirements','offer');
 update public.offers set status=case when submission_id=submission then 'selected' else 'discarded_other_offer' end where submission_id in (select id from public.submissions where process_id=p.id) and status in ('received','selected');
 update public.financing_processes set state='lender_selected' where id=p.id;
 insert into public.case_events(opportunity_id,process_id,submission_id,archive_message_id,area,kind,body,evidence_type,occurred_at,actor_id)
 values(p.opportunity_id,p.id,submission,evidence,'closer','lender_selected','Lender selected; other alternatives withdrawn by selection, not lender rejection.','manual',now(),actor);
 update public.opportunities set updated_at=now() where id=p.opportunity_id;
end $$;
revoke all on function public.gmail_record_process(uuid,text,uuid,uuid,text,timestamptz,uuid,numeric,uuid),public.gmail_select_lender(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_record_process(uuid,text,uuid,uuid,text,timestamptz,uuid,numeric,uuid),public.gmail_select_lender(uuid,uuid,uuid,uuid) to service_role;
create function public.gmail_new_process(case_id uuid,label_text text,classification_value text,started timestamptz,request uuid,actor uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(case_id::text,19));
 select id into target from public.financing_processes where request_key=request and opportunity_id=case_id;
 if target is not null then return target; end if;
 insert into public.financing_processes(opportunity_id,sequence_number,started_at,classification,label,request_key)
 select case_id,coalesce(max(sequence_number),0)+1,started,classification_value,label_text,request from public.financing_processes where opportunity_id=case_id returning id into target;
 insert into public.case_events(opportunity_id,process_id,area,kind,body,evidence_type,occurred_at,actor_id)
 values(case_id,target,case when exists(select 1 from public.opportunities where id=case_id and handed_off_at is not null) then 'closer'::public.case_area else 'seller'::public.case_area end,'process_created',label_text,'manual',started,actor);
 return target;
end $$;
revoke all on function public.gmail_new_process(uuid,text,text,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_new_process(uuid,text,text,timestamptz,uuid,uuid) to service_role;
create function public.gmail_move_thread(case_id uuid,evidence uuid,process uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;old_process uuid;sub uuid;
begin
 if not exists(select 1 from public.financing_processes where id=process and opportunity_id=case_id and not is_unclassified_archive) then raise exception 'Choose a classified process in this case'; end if;
 select * into m from public.gmail_archive_messages where id=evidence;
 select process_id,submission_id into old_process,sub from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id and opportunity_id=case_id for update;
 if old_process is null then raise exception 'Thread belongs to another case'; end if;
 if sub is not null and not exists(select 1 from public.submissions where id=sub and process_id=process) then raise exception 'Lender evaluation belongs to another process'; end if;
 update public.gmail_thread_links set process_id=process where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 update public.conversations set process_id=process where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 update public.case_events set process_id=process where opportunity_id=case_id and archive_message_id in (select id from public.gmail_archive_messages where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id);
 update public.gmail_saved_attachments set process_id=process where opportunity_id=case_id and archive_message_id in (select id from public.gmail_archive_messages where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id);
 update public.mail_waits set process_id=process where conversation_id in(select id from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id);
 insert into public.case_events(opportunity_id,process_id,archive_message_id,area,kind,body,evidence_type,occurred_at,actor_id)
 values(case_id,process,evidence,case when sub is null then 'seller'::public.case_area else 'closer'::public.case_area end,'process_association','Thread reassigned from process '||old_process||' to '||process,'manual',now(),actor);
end $$;
revoke all on function public.gmail_move_thread(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_move_thread(uuid,uuid,uuid,uuid) to service_role;


-- SOURCE: 014_gmail_reply_files.sql

alter table public.outbox add column gmail_file_ids uuid[] not null default '{}';


-- SOURCE: 015_gmail_continuous.sql

-- Imported evidence updates the contact date, never overwrites a reviewed case stage.
create or replace function public.track_message_contact() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.nature not in ('personal','campaign') then return new; end if;
 update public.opportunities o set last_contact=greatest(o.last_contact,new.sent_at),
 stage=case when new.archive_message_id is null and new.nature='personal' and new.direction='inbound' and o.handed_off_at is null and o.stage in ('new','contacting')
 and exists(select 1 from public.contacts ct where ct.id=o.contact_id and ct.email=new.sender) then 'replied'::public.case_stage else o.stage end
 where o.id=(select c.opportunity_id from public.conversations c where c.id=new.conversation_id);
 return new;
end $$;
create function public.gmail_lock_manual_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and (old.seller_id is distinct from new.seller_id or old.closer_id is distinct from new.closer_id) then new.owner_locked_at:=now(); end if;
 return new;
end $$;
create trigger gmail_manual_owner before update of seller_id,closer_id on public.opportunities for each row execute function public.gmail_lock_manual_owner();
revoke all on function public.gmail_lock_manual_owner() from public,anon,authenticated;
grant execute on function public.gmail_lock_manual_owner() to service_role;
-- Continuous sync may reuse an existing confirmed thread or an unambiguous exact
-- customer address. Names, domains, copied participants and lender guesses never join cases.
create function public.gmail_associate_continuous(archive uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;co public.conversations;target uuid;process uuid;matches uuid[];active_processes uuid[];
begin
 select * into m from public.gmail_archive_messages where id=archive;
 if not exists(select 1 from public.mail_accounts where id=m.account_id and sync_enabled and status='connected') then return; end if;
 if exists(select 1 from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id) then return; end if;
 select * into co from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if co.id is not null then target:=co.opportunity_id;process:=co.process_id;
 else
  if m.nature not in ('personal','campaign') then return; end if;
  if exists(select 1 from jsonb_array_elements(m.participants) p join public.lenders l on lower(l.email)=p->>'email'
   where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end) then return; end if;
  select array_agg(distinct o.id) into matches from public.opportunities o join public.contacts c on
   (c.id=o.contact_id or exists(select 1 from public.company_contacts cc where cc.company_id=o.company_id and cc.contact_id=c.id and cc.relationship in ('primary','contact')))
  join jsonb_array_elements(m.participants) p on p->>'email'=c.email
  where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end and o.archived_at is null
  and (o.email_qualified_at is not null or o.historical_approved_at is not null);
  if cardinality(matches) is distinct from 1 then return; end if;
  target:=matches[1];
  select array_agg(id) into active_processes from public.financing_processes where opportunity_id=target and classification='active' and not is_unclassified_archive;
  if cardinality(active_processes)=1 then process:=active_processes[1];
  elsif cardinality(active_processes)>1 then return; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,19));
 if process is null then
  select id into process from public.financing_processes where opportunity_id=target and is_unclassified_archive limit 1;
  if process is null then
   insert into public.financing_processes(opportunity_id,sequence_number,started_at,classification,label,is_unclassified_archive)
   select target,coalesce(max(sequence_number),0)+1,m.sent_at,'unknown','Historial pendiente de separar en procesos',true
   from public.financing_processes where opportunity_id=target returning id into process;
  end if;
 end if;
 insert into public.gmail_thread_links(account_id,gmail_thread_id,opportunity_id,process_id,submission_id)
 values(m.account_id,m.gmail_thread_id,target,process,co.submission_id) on conflict do nothing;
 -- A transfer is authoritative: syncing an old mailbox never assigns ownership.
end $$;
revoke all on function public.gmail_associate_continuous(uuid) from public,anon,authenticated;
grant execute on function public.gmail_associate_continuous(uuid) to service_role;

-- A new personal reply stops only a campaign that actually sent to that exact
-- address before the reply. Recovered old mail cannot cancel a newer campaign.
create function public.gmail_process_live_reply(archive uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;link public.gmail_thread_links;enrollment uuid;
begin
 select * into m from public.gmail_archive_messages where id=archive;
 if m.direction is distinct from 'inbound' or m.nature is distinct from 'personal' then return; end if;
 select * into link from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if link.opportunity_id is null or link.submission_id is not null then return; end if;
 for enrollment in
  update public.campaign_enrollments e set status='replied'
  from public.contacts c where e.contact_id=c.id and e.opportunity_id=link.opportunity_id
  and e.status in ('active','paused') and e.created_at<=m.sent_at
  and exists(select 1 from jsonb_array_elements(m.participants) p where p->>'role'='from' and p->>'email'=c.email)
  and exists(select 1 from public.outbox x where x.enrollment_id=e.id and x.account_id=m.account_id
   and lower(x.to_email)=c.email and x.status='sent' and x.sent_at<=m.sent_at)
  returning e.id
 loop
  update public.outbox set status='cancelled' where enrollment_id=enrollment and status in ('queued','paused');
 end loop;
end $$;
revoke all on function public.gmail_process_live_reply(uuid) from public,anon,authenticated;
grant execute on function public.gmail_process_live_reply(uuid) to service_role;

create function public.gmail_case_mail_stats(case_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('sent',count(*) filter(where m.direction='outbound'),
 'personal',count(*) filter(where m.direction='outbound' and m.nature='personal'),
 'campaign',count(*) filter(where m.direction='outbound' and m.nature='campaign'),
 'automatic',count(*) filter(where m.direction='outbound' and m.nature='automatic'),
 'first_at',min(m.sent_at),'last_at',max(m.sent_at))
 from public.messages m join public.conversations c on c.id=m.conversation_id where c.opportunity_id=case_id
$$;
revoke all on function public.gmail_case_mail_stats(uuid) from public,anon;
grant execute on function public.gmail_case_mail_stats(uuid) to authenticated,service_role;

commit;
