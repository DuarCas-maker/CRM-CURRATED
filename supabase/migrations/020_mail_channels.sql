begin;

create table public.lender_contacts(email text primary key check(email=lower(btrim(email))),lender_id uuid not null references public.lenders,created_by uuid references public.profiles,created_at timestamptz not null default now());
insert into public.lender_contacts(email,lender_id) select lower(btrim(email)),min(id::text)::uuid from public.lenders where email<>'' group by lower(btrim(email)) having count(*)=1;
alter table public.lender_contacts enable row level security;
create policy lender_contacts_read on public.lender_contacts for select to authenticated using(public.current_app_role() is not null);
grant select on public.lender_contacts to authenticated;grant all on public.lender_contacts to service_role;
create function public.lender_primary_contact() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.lender_contacts where email=lower(btrim(new.email)) and lender_id<>new.id) then raise exception 'Lender email already belongs to another lender';end if;
 if exists(select 1 from public.gmail_team_members where email=lower(btrim(new.email))) or exists(select 1 from public.mail_accounts where email=lower(btrim(new.email))) then raise exception 'Team address cannot be a lender';end if;
 insert into public.lender_contacts(email,lender_id) values(lower(btrim(new.email)),new.id) on conflict do nothing;
 return new;
end $$;
create trigger lender_address_registry after insert or update of email on public.lenders for each row execute function public.lender_primary_contact();
revoke all on function public.lender_primary_contact() from public,anon,authenticated;

-- Multiple lender channels can reference one historical Gmail thread. Messages
-- remain stored once; inclusion in each channel is based on exact participants.
create table public.conversation_lenders(conversation_id uuid not null references public.conversations,lender_id uuid not null references public.lenders,primary key(conversation_id,lender_id));
alter table public.conversation_lenders enable row level security;
create policy conversation_lenders_read on public.conversation_lenders for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and public.can_area(c.opportunity_id,'closer') and public.can_area(c.opportunity_id,c.area)));
grant select on public.conversation_lenders to authenticated;grant all on public.conversation_lenders to service_role;
create function public.mail_index_lenders() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.conversation_lenders select new.conversation_id,s.lender_id from public.conversations c join public.submissions s on s.id=c.submission_id where c.id=new.conversation_id on conflict do nothing;
 insert into public.conversation_lenders select distinct new.conversation_id,l.lender_id from jsonb_array_elements(new.participants) p join public.lender_contacts l on l.email=lower(p->>'email') on conflict do nothing;
 return new;
end $$;
create trigger mail_channel_index after insert or update of participants on public.messages for each row execute function public.mail_index_lenders();
insert into public.conversation_lenders select c.id,s.lender_id from public.conversations c join public.submissions s on s.id=c.submission_id on conflict do nothing;
insert into public.conversation_lenders select distinct m.conversation_id,l.lender_id from public.messages m cross join lateral jsonb_array_elements(m.participants) p join public.lender_contacts l on l.email=lower(p->>'email') on conflict do nothing;
create function public.register_lender_contact(lender uuid,address text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.current_app_role() not in ('superadmin','closer_admin','closer') then raise exception 'Closer access required';end if;
 address:=lower(btrim(address));
 if address !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or not exists(select 1 from public.lenders where id=lender and archived_at is null) then raise exception 'Valid lender and email required';end if;
 if exists(select 1 from public.gmail_team_members where email=address) or exists(select 1 from public.mail_accounts where email=address) then raise exception 'Team address cannot be a lender';end if;
 if exists(select 1 from public.lender_contacts where email=address and lender_id<>lender) then raise exception 'This email already belongs to another lender; administrator review required';end if;
 insert into public.lender_contacts(email,lender_id,created_by) values(address,lender,auth.uid()) on conflict do nothing;
 insert into public.conversation_lenders select distinct m.conversation_id,lender from public.messages m cross join lateral jsonb_array_elements(m.participants) p where lower(p->>'email')=address on conflict do nothing;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'lender',lender,'contact_confirmed',jsonb_build_object('email',address));
end $$;

alter table public.outbox add column cc_emails text[] not null default '{}';
alter table public.outbox add column process_id uuid references public.financing_processes;
alter table public.outbox add column reply_message_id uuid references public.messages;

create function public.queue_lender_emails(case_id uuid,account uuid,process uuid,targets jsonb,subject_text text,body_text text,files uuid[],gmail_files uuid[],request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare target jsonb; sub public.submissions; receipt public.command_receipts; send_id uuid; result jsonb:='[]';payload jsonb; lender uuid; closer uuid; matches int;
begin
 if not coalesce(public.can_area(case_id,'closer'),false) or not coalesce(public.can_edit_case(case_id),false) then raise exception 'Closer case editing required';end if;
 if request is null or jsonb_typeof(targets)<>'array' or jsonb_array_length(targets) not between 1 and 20 then raise exception 'Select 1 to 20 lenders';end if;
 if not exists(select 1 from public.financing_processes where id=process and opportunity_id=case_id) then raise exception 'Choose the case financing process';end if;
 if (select count(distinct value->>'lender_id') from jsonb_array_elements(targets))<>jsonb_array_length(targets) then raise exception 'Duplicate lender';end if;
 payload:=jsonb_build_object('case',case_id,'account',account,'process',process,'targets',targets,'subject',subject_text,'body',body_text,'files',files,'gmail_files',gmail_files);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request::text,0));
 select * into receipt from public.command_receipts where user_id=auth.uid() and request_key=request;
 if receipt.user_id is not null then
  if receipt.kind<>'compose_lenders' or receipt.fingerprint<>md5(payload::text) then raise exception 'Request key reused with different input';end if;return receipt.result;
 end if;
 for target in select value from jsonb_array_elements(targets) loop
  lender:=(target->>'lender_id')::uuid;
  if not exists(select 1 from public.lenders l where l.id=lender and l.archived_at is null) then raise exception 'Choose an active lender';end if;
  if target->>'submission_id' is not null then
   select * into sub from public.submissions where id=(target->>'submission_id')::uuid and lender_id=lender and opportunity_id=case_id and (process_id is null or process_id=process) for update;
  else
   select count(*) into matches from public.submissions where lender_id=lender and opportunity_id=case_id and process_id=process;
   if matches>1 then raise exception 'Several evaluations exist; select one explicitly';end if;
   select * into sub from public.submissions where lender_id=lender and opportunity_id=case_id and process_id=process for update;
   if sub.id is null then
    select closer_id into closer from public.opportunities where opportunities.id=case_id;
    if closer is null and public.current_app_role() in ('closer','closer_admin','superadmin') then closer:=auth.uid();end if;
    insert into public.submissions(opportunity_id,lender_id,closer_id,status,channel,next_action,next_action_at,process_id) values(case_id,lender,closer,'draft','email','Esperar respuesta del lender',now()+interval '5 days',process) returning * into sub;
   end if;
  end if;
  if sub.id is null or not exists(select 1 from public.lender_contacts where lender_id=sub.lender_id and email=lower(btrim(target->>'email'))) then raise exception 'Confirm lender recipient and evaluation';end if;
  send_id:=public.queue_manual_email(case_id,account,target->>'email',subject_text,body_text,files,gmail_files,md5(request::text||':'||sub.id)::uuid);
  update public.submissions set process_id=process where submissions.id=sub.id and process_id is null;
  update public.outbox set submission_id=sub.id,area='closer',process_id=process where outbox.id=send_id;
  result:=result||jsonb_build_array(jsonb_build_object('id',send_id,'lender_id',sub.lender_id,'recipient',target->>'email'));
 end loop;
 result:=jsonb_build_object('ok',true,'sends',result);
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request,'compose_lenders',result,md5(payload::text));
 return result;
end $$;

-- The old send acknowledgement keeps deduplication, campaign stopping and status
-- handling. Add process and actual recipients to the resulting conversation.
alter function public.mark_sent(uuid,text,text) rename to mark_sent_v19;
create function public.mark_sent(outbox_id uuid,gmail_id text,thread_id text) returns void language plpgsql security definer set search_path='' as $$
declare msg public.outbox; parts jsonb;
begin
 perform public.mark_sent_v19(outbox_id,gmail_id,thread_id);
 select * into msg from public.outbox where id=outbox_id;
 update public.conversations set process_id=coalesce(process_id,msg.process_id) where id=msg.conversation_id;
 parts:=jsonb_build_array(jsonb_build_object('role','from','email',(select email from public.mail_accounts where id=msg.account_id)),jsonb_build_object('role','to','email',msg.to_email))||coalesce((select jsonb_agg(jsonb_build_object('role','cc','email',email)) from unnest(msg.cc_emails) email),'[]'::jsonb);
 update public.messages set participants=parts where conversation_id=msg.conversation_id and gmail_message_id=gmail_id;
end $$;

create table public.gmail_pending_associations(id uuid primary key default gen_random_uuid(),team_candidate_id uuid not null references public.gmail_candidates,client_candidate_id uuid not null references public.gmail_candidates,evidence_id uuid not null references public.gmail_archive_messages,created_by uuid not null references public.profiles,created_at timestamptz not null default now(),applied_at timestamptz,last_error text,unique(team_candidate_id,evidence_id));
create index gmail_pending_client_links on public.gmail_pending_associations(client_candidate_id) where applied_at is null;
alter table public.gmail_pending_associations enable row level security;
create policy pending_associations_admin on public.gmail_pending_associations for select to authenticated using(public.current_app_role()='superadmin');
grant select on public.gmail_pending_associations to authenticated;grant all on public.gmail_pending_associations to service_role;
create function public.gmail_prepare_association(team_candidate uuid,client_candidate uuid,evidence uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.gmail_candidates;c public.gmail_candidates;
begin
 if not exists(select 1 from public.profiles where id=actor and active and role='superadmin') then raise exception 'Superadmin required';end if;
 select * into t from public.gmail_candidates where id=team_candidate and participant_kind='team';
 select * into c from public.gmail_candidates where id=client_candidate and participant_kind in ('client','unknown') and imported_at is null;
 if t.id is null or c.id is null or not evidence=any(t.evidence_ids) or not exists(select 1 from public.gmail_runs where id=c.run_id and status in ('review','completed','importing')) then raise exception 'Choose a pending customer and evidence';end if;
 insert into public.gmail_pending_associations(team_candidate_id,client_candidate_id,evidence_id,created_by) values(t.id,c.id,evidence,actor)
 on conflict(team_candidate_id,evidence_id) do update set client_candidate_id=excluded.client_candidate_id,created_by=actor,last_error=null where gmail_pending_associations.applied_at is null;
end $$;

create or replace function public.gmail_associate_team_thread(candidate uuid,evidence uuid,case_id uuid,process uuid,submission uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.gmail_candidates;m public.gmail_archive_messages;l public.gmail_thread_links;
begin
 if not exists(select 1 from public.profiles where id=actor and role='superadmin' and active) then raise exception 'Superadmin required'; end if;
 select * into c from public.gmail_candidates where id=candidate and participant_kind='team';
 if c.id is null or not evidence=any(c.evidence_ids) then raise exception 'Choose evidence of this team participant'; end if;
 if not exists(select 1 from public.gmail_runs where id=c.run_id and status in ('review','completed','failed','importing')) then raise exception 'Finish analysis before associating'; end if;
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


alter function public.gmail_apply_candidate(uuid,uuid) rename to gmail_apply_candidate_v19;
create function public.gmail_apply_candidate(candidate uuid,lease uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;p public.gmail_pending_associations;c public.gmail_candidates;
begin
 if exists(select 1 from public.gmail_candidates gc where gc.id=candidate and (gc.participant_kind='team' or exists(select 1 from public.gmail_team_members where email=gc.email))) then raise exception 'Team members require individual thread association, never client import';end if;
 if not exists(select 1 from public.gmail_candidates where id=candidate and import_requested_at is not null) then return null;end if;
 result:=public.gmail_apply_candidate_v19(candidate,lease);
 select * into c from public.gmail_candidates where id=candidate;
 for p in select * from public.gmail_pending_associations where client_candidate_id=candidate and applied_at is null loop
  begin
   perform public.gmail_associate_team_thread(p.team_candidate_id,p.evidence_id,result,c.selected_process_id,null,p.created_by);
   update public.gmail_pending_associations set applied_at=now(),last_error=null where id=p.id;
  exception when others then update public.gmail_pending_associations set last_error='Revisar: el hilo ya puede estar asociado a otro expediente, proceso o lender' where id=p.id;
  end;
 end loop;
 return result;
end $$;
revoke all on function public.mail_index_lenders(),public.register_lender_contact(uuid,text),public.queue_lender_emails(uuid,uuid,uuid,jsonb,text,text,uuid[],uuid[],uuid),public.gmail_prepare_association(uuid,uuid,uuid,uuid),public.gmail_apply_candidate_v19(uuid,uuid),public.gmail_apply_candidate(uuid,uuid),public.mark_sent_v19(uuid,text,text),public.mark_sent(uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_lender_contact(uuid,text),public.queue_lender_emails(uuid,uuid,uuid,jsonb,text,text,uuid[],uuid[],uuid) to authenticated;
grant execute on function public.gmail_prepare_association(uuid,uuid,uuid,uuid),public.gmail_apply_candidate(uuid,uuid),public.mark_sent(uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
