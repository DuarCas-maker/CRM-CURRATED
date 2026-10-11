begin;
-- Exact email identities are commercial metadata, never login/send permissions.
create table public.gmail_team_members (
 email text primary key check(email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 name text not null default '',team_role text not null check(team_role in ('seller','closer')),
 affiliation text not null check(affiliation in ('internal','external')),
 profile_id uuid references public.profiles,updated_by uuid not null references public.profiles,updated_at timestamptz not null default now()
);
alter table public.gmail_team_members enable row level security;
revoke all on public.gmail_team_members from public,anon,authenticated;
grant select on public.gmail_team_members to authenticated;
grant all on public.gmail_team_members to service_role;
create policy gmail_team_admin_read on public.gmail_team_members for select to authenticated using(public.current_app_role()='superadmin');
alter table public.gmail_candidates drop constraint gmail_candidates_participant_kind_check;
alter table public.gmail_candidates add constraint gmail_candidates_participant_kind_check check(participant_kind in ('unknown','client','lender','broker','other','team'));
alter table public.mail_waits add column resolved_by uuid references public.profiles;
alter table public.mail_waits add column resolution_message_id uuid references public.gmail_archive_messages;

create function public.gmail_register_team(address text,name_text text,role_text text,affiliation_text text,profile uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=actor and role='superadmin' and active) then raise exception 'Superadmin required'; end if;
 if profile is not null and not exists(select 1 from public.profiles where id=profile and active and role::text in (role_text,role_text||'_admin','superadmin')) then raise exception 'Choose an active user with matching role'; end if;
 insert into public.gmail_team_members(email,name,team_role,affiliation,profile_id,updated_by)
 values(lower(btrim(address)),name_text,role_text,affiliation_text,profile,actor)
 on conflict(email) do update set name=excluded.name,team_role=excluded.team_role,affiliation=excluded.affiliation,profile_id=excluded.profile_id,updated_by=actor,updated_at=now();
 -- Preserve all prior work. Reclassification never removes contacts or cases.
 update public.gmail_candidates set participant_kind='team',selected=false where email=lower(btrim(address));
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata)
 values(actor,'gmail_team',coalesce(profile,actor),'classified',jsonb_build_object('email',lower(btrim(address)),'role',role_text,'affiliation',affiliation_text));
end $$;

create or replace function public.gmail_build_preview(run uuid,lease uuid) returns void language plpgsql security definer set search_path='' as $$
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
 update public.gmail_candidates c set participant_kind='team',selected=false from public.gmail_team_members t where c.run_id=r.id and c.email=t.email;
 update public.gmail_runs set status='review',
 phase='preview',finished_at=now(),lease_token=null,lease_until=null,last_error=null where id=r.id;
 if r.purpose='continuous' then
  update public.gmail_sync_state set history_id=case when history_id is null or history_id::numeric<r.baseline_history_id::numeric then r.baseline_history_id else history_id end,last_synced_at=now(),active_run_id=null,last_error=null where account_id=r.account_id;
 end if;
end $$;


create or replace function public.gmail_apply_candidate(candidate uuid,lease uuid) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare c public.gmail_candidates;r public.gmail_runs;a public.mail_accounts;ct public.contacts;
 company uuid;case_id uuid;process uuid;owner uuid;created boolean:=false;thread record;count_cases int;
begin
 select * into c from public.gmail_candidates where id=candidate for update;
 select * into r from public.gmail_runs where id=c.run_id and lease_token=lease and status='importing' for update;
 if r.id is null then raise exception 'Import lease lost or paused'; end if;
 if c.participant_kind='team' or exists(select 1 from public.gmail_team_members where email=c.email) then raise exception 'Team members require individual thread association, never client import'; end if;
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


create or replace function public.gmail_link_message(archive_id uuid,snapshot jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
 update public.conversations set updated_at=greatest(updated_at,m.sent_at),needs_attention=case when not exists(select 1 from public.gmail_team_members t join jsonb_array_elements(m.participants) p on t.email=p->>'email' where p->>'role'='from') and m.nature='personal' and m.sent_at>=updated_at then m.direction='inbound' else needs_attention end where id=co;
 -- Automatic mail and delivery reports never count as a personal reply.
 if m.nature='personal' and not exists(select 1 from public.gmail_team_members t join jsonb_array_elements(m.participants) p on t.email=p->>'email' where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end) and exists(
  select 1 from jsonb_array_elements(m.participants) p where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end
  and (case when link.submission_id is not null then exists(select 1 from public.submissions s join public.lenders l on l.id=s.lender_id where s.id=link.submission_id and lower(l.email)=p->>'email')
  else exists(select 1 from public.contacts c where c.email=p->>'email' and (c.id=o.contact_id or exists(select 1 from public.company_contacts cc where cc.contact_id=c.id and cc.company_id=o.company_id and cc.relationship in ('primary','contact')))) end)
 ) then
  if not exists(select 1 from public.mail_waits w where w.conversation_id=co and greatest(w.since_at,(select sent_at from public.gmail_archive_messages where id=w.resolution_message_id))>=m.sent_at) then
   if exists(select 1 from public.mail_waits w join public.tasks t on t.id=w.task_id where w.conversation_id=co and t.status='open') then
    update public.tasks set status='done' where id=(select task_id from public.mail_waits where conversation_id=co);
   end if;
   insert into public.mail_waits(opportunity_id,conversation_id,process_id,area,waiting_for,since_at,source_message_id,draft)
   values(o.id,co,link.process_id,area,case when m.direction='inbound' then 'team' when link.submission_id is not null then 'lender' else 'client' end,m.sent_at,m.id,
   case when m.direction='inbound' then 'Thank you for your message. We are reviewing your request and will follow up with the next steps.' else 'Hello, I am following up on our previous message. Could you please share an update?' end)
   on conflict(conversation_id) do update set resolved_by=null,resolution_message_id=null,waiting_for=excluded.waiting_for,since_at=excluded.since_at,source_message_id=excluded.source_message_id,task_id=null,draft=excluded.draft,updated_at=now();
  end if;
 end if;
 return stored;
end $$;


create or replace function public.gmail_followups() returns void language plpgsql security definer set search_path='' as $$
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


create or replace function public.gmail_associate_continuous(archive uuid) returns void language plpgsql security definer set search_path='' as $$
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
  if exists(select 1 from public.gmail_team_members t join jsonb_array_elements(m.participants) p on t.email=p->>'email' where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end) then return; end if;
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


create or replace function public.gmail_process_live_reply(archive uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;link public.gmail_thread_links;enrollment uuid;
begin
 select * into m from public.gmail_archive_messages where id=archive;
 if m.direction is distinct from 'inbound' or m.nature is distinct from 'personal' then return; end if;
 if exists(select 1 from public.gmail_team_members t join jsonb_array_elements(m.participants) p on t.email=p->>'email' where p->>'role'='from') then return; end if;
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


create or replace function public.track_message_contact() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.gmail_team_members where email=lower(new.sender)) then return new; end if;
 if new.nature not in ('personal','campaign') then return new; end if;
 update public.opportunities o set last_contact=greatest(o.last_contact,new.sent_at),
 stage=case when new.archive_message_id is null and new.nature='personal' and new.direction='inbound' and o.handed_off_at is null and o.stage in ('new','contacting')
 and exists(select 1 from public.contacts ct where ct.id=o.contact_id and ct.email=new.sender) then 'replied'::public.case_stage else o.stage end
 where o.id=(select c.opportunity_id from public.conversations c where c.id=new.conversation_id);
 return new;
end $$;

-- A team identity can occur in many unrelated threads; never bulk-link by address.
create function public.gmail_associate_team_thread(candidate uuid,evidence uuid,case_id uuid,process uuid,submission uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.gmail_candidates;m public.gmail_archive_messages;l public.gmail_thread_links;
begin
 if not exists(select 1 from public.profiles where id=actor and role='superadmin' and active) then raise exception 'Superadmin required'; end if;
 select * into c from public.gmail_candidates where id=candidate and participant_kind='team';
 if c.id is null or not evidence=any(c.evidence_ids) then raise exception 'Choose evidence of this team participant'; end if;
 if not exists(select 1 from public.gmail_runs where id=c.run_id and status in ('review','completed','failed')) then raise exception 'Finish analysis before associating'; end if;
 select * into m from public.gmail_archive_messages where id=evidence;
 if not exists(select 1 from public.opportunities where id=case_id and archived_at is null and (historical_approved_at is not null or email_qualified_at is not null)) then raise exception 'Choose an approved existing case'; end if;
 if not exists(select 1 from public.financing_processes where id=process and opportunity_id=case_id) then raise exception 'Process belongs to another case'; end if;
 if submission is not null and not exists(select 1 from public.submissions where id=submission and opportunity_id=case_id and process_id=process) then raise exception 'Lender evaluation belongs to another process'; end if;
 perform pg_advisory_xact_lock(hashtextextended(m.account_id::text||m.gmail_thread_id,61));
 select * into l from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if l.opportunity_id is not null and (l.opportunity_id<>case_id or l.process_id<>process or l.submission_id is distinct from submission) then raise exception 'Thread already associated; review its existing case'; end if;
 if exists(select 1 from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id and (opportunity_id<>case_id or process_id is not null and process_id<>process or submission_id is distinct from submission)) then raise exception 'Conversation association conflict'; end if;
 insert into public.gmail_thread_links(account_id,gmail_thread_id,opportunity_id,process_id,submission_id,source_candidate_id)
 values(m.account_id,m.gmail_thread_id,case_id,process,submission,c.id) on conflict do nothing;
 insert into public.case_events(opportunity_id,process_id,submission_id,archive_message_id,area,kind,body,evidence_type,occurred_at,actor_id,dedupe_key)
 values(case_id,process,submission,m.id,case when submission is null then 'seller'::public.case_area else 'closer'::public.case_area end,'team_thread_association','Team conversation associated individually','manual',now(),actor,'team-thread:'||m.account_id||':'||m.gmail_thread_id) on conflict do nothing;
 insert into public.jobs(kind,payload,dedupe_key) values('gmail_team_thread',jsonb_build_object('evidence_id',m.id,'offset',0,'copy_since',(select copy_since from public.gmail_runs where id=c.run_id)), 'gmail-team-thread:'||m.id||':0') on conflict(dedupe_key) do nothing;
 -- No contact/case is created and no owner, primary account or commercial stage changes.
end $$;

create function public.gmail_team_threads(candidate uuid,cursor_offset int) returns table(evidence_id uuid,subject text,sent_at timestamptz,opportunity_id uuid,process_id uuid,submission_id uuid) language sql stable security definer set search_path='' as $$
 select x.id,x.subject,x.sent_at,l.opportunity_id,l.process_id,l.submission_id from (
 select distinct on(m.account_id,m.gmail_thread_id) m.* from public.gmail_candidates c join public.gmail_archive_messages m on m.id=any(c.evidence_ids)
 where c.id=candidate and c.participant_kind='team' order by m.account_id,m.gmail_thread_id,m.sent_at desc,m.id
 ) x left join public.gmail_thread_links l on l.account_id=x.account_id and l.gmail_thread_id=x.gmail_thread_id
 where public.current_app_role()='superadmin' order by x.sent_at desc,x.id offset greatest(cursor_offset,0) limit 51
$$;
create function public.gmail_team_thread_page(evidence uuid,cursor_offset int) returns setof public.gmail_archive_messages language sql stable security definer set search_path='' as $$
 select m.* from public.gmail_archive_messages m join public.gmail_archive_messages e on e.account_id=m.account_id and e.gmail_thread_id=m.gmail_thread_id
 join public.gmail_thread_links l on l.account_id=m.account_id and l.gmail_thread_id=m.gmail_thread_id where e.id=evidence order by m.id offset greatest(cursor_offset,0) limit 10
$$;

create function public.gmail_confirm_team_response(wait uuid,evidence uuid,actor uuid,note text) returns void language plpgsql security definer set search_path='' as $$
declare w public.mail_waits;m public.gmail_archive_messages;co public.conversations;
begin
 select * into w from public.mail_waits where id=wait for update;
 if w.waiting_for='team' and w.resolution_message_id=evidence then return; end if;
 if w.id is null or w.waiting_for<>'lender' then raise exception 'Choose a lender wait'; end if;
 select * into co from public.conversations where id=w.conversation_id;
 select * into m from public.gmail_archive_messages where id=evidence;
 if m.account_id is distinct from co.account_id or m.gmail_thread_id is distinct from co.gmail_thread_id or m.sent_at<=w.since_at or m.nature is distinct from 'personal'
 or not exists(select 1 from public.gmail_team_members t join jsonb_array_elements(m.participants) p on p->>'email'=t.email where p->>'role'='from') then raise exception 'Choose a newer personal team response in this lender conversation'; end if;
 if btrim(note)='' then raise exception 'Explain the lender response transmitted by the team'; end if;
 if not exists(select 1 from public.profiles where id=actor and active) then raise exception 'Active user required'; end if;
 -- API verifies case editing, area access and RLS evidence before service execution.
 update public.mail_waits set resolved_by=actor,resolution_message_id=evidence,waiting_for='team',since_at=m.sent_at,source_message_id=m.id,task_id=null,
 draft='Thank you for the update. We are reviewing the lender response and will follow up with the next steps.',updated_at=now() where id=w.id;
 update public.tasks set status='done' where id=w.task_id and status='open';
 insert into public.case_events(opportunity_id,process_id,submission_id,archive_message_id,area,kind,body,evidence_type,occurred_at,actor_id,dedupe_key)
 values(w.opportunity_id,w.process_id,co.submission_id,m.id,w.area,'team_lender_response_confirmed',note,'manual',now(),actor,'team-response:'||w.id||':'||w.source_message_id) on conflict do nothing;
 -- Does not imply an offer, financing approval, signature or disbursement.
end $$;

revoke all on function public.gmail_register_team(text,text,text,text,uuid,uuid),public.gmail_associate_team_thread(uuid,uuid,uuid,uuid,uuid,uuid),public.gmail_team_thread_page(uuid,int),public.gmail_confirm_team_response(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gmail_register_team(text,text,text,text,uuid,uuid),public.gmail_associate_team_thread(uuid,uuid,uuid,uuid,uuid,uuid),public.gmail_team_thread_page(uuid,int),public.gmail_confirm_team_response(uuid,uuid,uuid,text) to service_role;
revoke all on function public.gmail_team_threads(uuid,int) from public,anon;
grant execute on function public.gmail_team_threads(uuid,int) to authenticated,service_role;
commit;
