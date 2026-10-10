begin;
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
commit;
