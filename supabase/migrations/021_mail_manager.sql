begin;

-- Live mail has its own cursor; historical import cannot hold it up.
alter table public.mail_accounts add column live_enabled boolean not null default true;
alter table public.mail_accounts add column live_started_at timestamptz not null default now();
alter table public.gmail_saved_attachments add column auto_saved boolean not null default false;
alter table public.gmail_archive_messages add column references_header text;
alter table public.gmail_archive_messages add column is_live boolean not null default false;
create index gmail_archive_participant_lookup on public.gmail_archive_messages using gin(participants jsonb_path_ops);
alter table public.outbox add column bcc_emails text[] not null default '{}';
alter table public.outbox add column upload_ids uuid[] not null default '{}';
alter table public.outbox add column signature_html text;
alter table public.outbox add column sender_name text;
alter table public.outbox add column forward_message_id uuid references public.messages;
alter table public.outbox add column forward_file_ids uuid[] not null default '{}';

create function public.can_mail_case(case_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_case(case_id)
$$;
revoke all on function public.can_mail_case(uuid) from public,anon;
grant execute on function public.can_mail_case(uuid) to authenticated,service_role;

-- Sharing mail does not grant permission to edit underwriting or commercial stages.
drop policy conversations_read on public.conversations;
create policy conversations_read on public.conversations for select to authenticated using(public.can_mail_case(opportunity_id));
drop policy messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and public.can_mail_case(c.opportunity_id)));
drop policy conversation_lenders_read on public.conversation_lenders;
create policy conversation_lenders_read on public.conversation_lenders for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and public.can_mail_case(c.opportunity_id)));
create policy shared_mail_files on public.gmail_saved_attachments for select to authenticated using(public.can_mail_case(opportunity_id));
create policy shared_mail_events on public.case_events for select to authenticated using(archive_message_id is not null and public.can_mail_case(opportunity_id));
create policy shared_mail_waits on public.mail_waits for select to authenticated using(public.can_mail_case(opportunity_id));
create policy shared_mail_tasks on public.tasks for select to authenticated using(automated and exists(select 1 from public.mail_waits w where w.task_id=tasks.id and public.can_mail_case(w.opportunity_id)));

create table public.mail_uploads (
 id uuid primary key default gen_random_uuid(),opportunity_id uuid not null references public.opportunities,
 uploaded_by uuid not null references public.profiles,name text not null,mime_type text not null,
 size integer not null check(size between 1 and 18874368),storage_path text not null,content_hash text not null,
 created_at timestamptz not null default now()
);
alter table public.mail_uploads enable row level security;
grant select on public.mail_uploads to authenticated;grant all on public.mail_uploads to service_role;
create policy mail_uploads_read on public.mail_uploads for select to authenticated using(public.can_mail_case(opportunity_id));
create table public.mail_drafts (
 id uuid primary key,opportunity_id uuid not null references public.opportunities,user_id uuid not null references public.profiles,
 payload jsonb not null,updated_at timestamptz not null default now()
);
alter table public.mail_drafts enable row level security;
grant select,insert,update,delete on public.mail_drafts to authenticated;grant all on public.mail_drafts to service_role;
create policy mail_drafts_own on public.mail_drafts for all to authenticated using(user_id=auth.uid() and public.can_mail_case(opportunity_id)) with check(user_id=auth.uid() and public.can_mail_case(opportunity_id) and octet_length(payload::text)<=200000);

create function public.mail_process(case_id uuid,chosen uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if chosen is not null then
  select id into result from public.financing_processes where id=chosen and opportunity_id=case_id;
  if result is null then raise exception 'Choose a process belonging to this case';end if;
  return result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(case_id::text,19));
 select id into result from public.financing_processes where opportunity_id=case_id and is_unclassified_archive limit 1;
 if result is null then
  insert into public.financing_processes(opportunity_id,sequence_number,started_at,classification,label,is_unclassified_archive)
  select case_id,coalesce(max(sequence_number),0)+1,now(),'unknown','Correo pendiente de asignar a proceso',true from public.financing_processes where opportunity_id=case_id returning id into result;
 end if;
 return result;
end $$;
revoke all on function public.mail_process(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mail_process(uuid,uuid) to service_role;
create or replace function public.advance_gmail_history(account uuid,checkpoint text) returns void language plpgsql security definer set search_path='' as $$
begin update public.mail_credentials set history_id=checkpoint,last_reconciled_at=now() where account_id=account and (history_id is null or history_id::numeric<=checkpoint::numeric);end $$;

create function public.gmail_track_live_wait(archive uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;c public.conversations;w public.mail_waits;phase public.case_area;
begin
 select * into m from public.gmail_archive_messages where id=archive;
 if m.nature<>'personal' or exists(select 1 from jsonb_array_elements(m.participants) p join public.gmail_team_members t on t.email=p->>'email' where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end) then return;end if;
 select * into c from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if c.id is null then return;end if;
 select case when c.submission_id is not null or (o.handed_off_at is not null and m.sent_at>=o.handed_off_at) then 'closer'::public.case_area else 'seller'::public.case_area end into phase from public.opportunities o where o.id=c.opportunity_id;
 select * into w from public.mail_waits where conversation_id=c.id for update;
 if greatest(w.since_at,(select sent_at from public.gmail_archive_messages where id=w.resolution_message_id))>=m.sent_at then return;end if;
 update public.tasks set status='done' where id=w.task_id and status='open';
 insert into public.mail_waits(opportunity_id,conversation_id,process_id,area,waiting_for,since_at,source_message_id,draft)
 values(c.opportunity_id,c.id,c.process_id,phase,case when m.direction='inbound' then 'team' when c.submission_id is null then 'client' else 'lender' end,m.sent_at,m.id,
 case when m.direction='inbound' then 'Thank you for your message. We will follow up with the next steps.' else 'Hello, could you please share an update on our previous message?' end)
 on conflict(conversation_id) do update set area=excluded.area,resolved_by=null,resolution_message_id=null,waiting_for=excluded.waiting_for,since_at=excluded.since_at,source_message_id=excluded.source_message_id,task_id=null,draft=excluded.draft,updated_at=now();
end $$;
revoke all on function public.gmail_track_live_wait(uuid) from public,anon,authenticated;
grant execute on function public.gmail_track_live_wait(uuid) to service_role;
create or replace function public.gmail_followups() returns void language plpgsql security definer set search_path='' as $$
declare w public.mail_waits;o public.opportunities;p public.financing_processes;task uuid;recipient uuid;
begin
 for w in select * from public.mail_waits where waiting_for in ('client','lender') and task_id is null and since_at<=now()-interval '5 days' order by since_at for update skip locked limit 200 loop
  select * into o from public.opportunities where id=w.opportunity_id and archived_at is null;
  if o.id is null or o.stage='paused' then continue;end if;
  select * into p from public.financing_processes where id=w.process_id;
  if p.classification='inactive' or p.state in ('disbursed','client_withdrew','funding_declined') then continue;end if;
  if o.stage in ('funded','lost') and (p.classification is distinct from 'active' or p.is_unclassified_archive) then continue;end if;
  recipient:=case when w.area='closer' then coalesce(o.closer_id,o.seller_id) else o.seller_id end;
  insert into public.tasks(opportunity_id,owner_id,title,due_at,area,automated) values(o.id,recipient,'Five calendar days: waiting for '||w.waiting_for,w.since_at+interval '5 days',w.area,true) returning id into task;
  update public.mail_waits set task_id=task where id=w.id;
 end loop;
end $$;

-- Unlinked new threads always require a human decision, even with a known sender.
create or replace function public.gmail_associate_continuous(archive uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;c public.conversations;
begin
 select * into m from public.gmail_archive_messages where id=archive;
 if exists(select 1 from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id) then return;end if;
 select * into c from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if c.id is null then
  if m.nature='personal' then
   insert into public.mail_review(account_id,gmail_message_id,reason) values(m.account_id,m.gmail_message_id,'Nuevo hilo: selecciona expediente y proceso') on conflict do nothing;
  end if;
  return;
 end if;
 insert into public.gmail_thread_links(account_id,gmail_thread_id,opportunity_id,process_id,submission_id)
 values(m.account_id,m.gmail_thread_id,c.opportunity_id,public.mail_process(c.opportunity_id,c.process_id),c.submission_id) on conflict do nothing;
 update public.conversations set process_id=(select process_id from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id) where id=c.id and process_id is null;
end $$;

create function public.queue_mail_email(case_id uuid,account uuid,recipient text,subject_text text,body_text text,files uuid[],gmail_files uuid[],uploads uuid[],copies text[],hidden_copies text[],process uuid,conversation uuid,reply_message uuid,submission uuid,signature text,display_name text,request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.opportunities;a public.mail_accounts;c public.conversations;previous public.outbox;result uuid;phase public.case_area;
begin
 if not coalesce(public.can_mail_case(case_id),false) or not coalesce(public.can_send(account),false) then raise exception 'Case and sender access required';end if;
 select * into o from public.opportunities where id=case_id for update;
 if o.archived_at is not null or (o.email_qualified_at is null and o.historical_approved_at is null) then raise exception 'Eligible opportunity required';end if;
 select * into a from public.mail_accounts where id=account;
 if a.status<>'connected' then raise exception 'Connect the sender account';end if;
 recipient:=lower(btrim(recipient));
 if recipient is null or subject_text is null or body_text is null then raise exception 'Mail fields required';end if;
 if recipient !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(recipient)>254 or length(btrim(subject_text)) not between 1 and (case when conversation is null then 200 else 2000 end) or subject_text ~ '[\r\n]' or length(btrim(body_text)) not between 1 and 10000 or request is null or length(coalesce(signature,''))>100000 or coalesce(display_name,'') ~ '[\r\n]' then raise exception 'Invalid mail fields';end if;
 if files is null or gmail_files is null or uploads is null or copies is null or hidden_copies is null or cardinality(files)+cardinality(gmail_files)+cardinality(uploads)>20 or cardinality(copies)+cardinality(hidden_copies)>40 then raise exception 'Invalid attachments or recipients';end if;
 if exists(select 1 from unnest(copies||hidden_copies) e where e !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(e)>254) then raise exception 'Invalid copy recipient';end if;
 if o.handed_off_at is null and exists(select 1 from public.suppressions where email=any(array[recipient]||copies||hidden_copies)) then raise exception 'Recipient is suppressed';end if;
 if exists(select 1 from unnest(files) f where not exists(select 1 from public.documents d where d.id=f and d.opportunity_id=case_id and d.status='approved' and d.storage_path is not null)) or
 exists(select 1 from unnest(gmail_files) f where not exists(select 1 from public.gmail_saved_attachments d where d.id=f and d.opportunity_id=case_id and d.status in ('received','approved','reviewed','incorporated') and d.storage_path is not null)) or
 exists(select 1 from unnest(uploads) f where not exists(select 1 from public.mail_uploads d where d.id=f and d.opportunity_id=case_id)) then raise exception 'Case attachments required';end if;
 if conversation is not null then
  select * into c from public.conversations where id=conversation and opportunity_id=case_id;
  if c.id is null then raise exception 'Choose a case conversation';end if;
  if reply_message is null or (process is not null and c.process_id is not null and process<>c.process_id) then raise exception 'Keep the reply in its original thread and process';end if;
  process:=coalesce(process,c.process_id);submission:=coalesce(submission,c.submission_id);
  if subject_text<>c.subject then raise exception 'Reply subject must match';end if;
 end if;
 if reply_message is not null and not exists(select 1 from public.messages where id=reply_message and conversation_id=conversation) then raise exception 'Choose a message in this thread';end if;
 if submission is not null and not exists(select 1 from public.submissions s where s.id=submission and s.opportunity_id=case_id and (s.process_id is null or s.process_id=process)) then raise exception 'Choose a case lender evaluation';end if;
 perform pg_advisory_xact_lock(hashtextextended(request::text,27));
 select * into previous from public.outbox where request_key=request::text;
 if previous.id is not null then
  if process is not null and previous.process_id is distinct from process then raise exception 'Request key reused with different process';end if;
  if (previous.requested_by,previous.opportunity_id,previous.account_id,previous.to_email,previous.subject,previous.body,previous.attachment_ids,previous.gmail_file_ids,previous.upload_ids,previous.cc_emails,previous.bcc_emails,previous.reply_message_id,previous.submission_id) is distinct from
  (auth.uid(),case_id,account,recipient,subject_text,body_text,files,gmail_files,uploads,copies,hidden_copies,reply_message,submission) then raise exception 'Request key reused with different input';end if;
  return previous.id;
 end if;
 process:=public.mail_process(case_id,process);
 if submission is not null then update public.submissions set process_id=process where id=submission and process_id is null;end if;
 phase:=case when o.handed_off_at is not null or submission is not null then 'closer'::public.case_area else 'seller'::public.case_area end;
 insert into public.outbox(account_id,opportunity_id,submission_id,conversation_id,to_email,cc_emails,bcc_emails,subject,body,area,attachment_ids,gmail_file_ids,upload_ids,process_id,reply_message_id,signature_html,sender_name,message_id_header,requested_by,request_key,gmail_thread_id,available_at)
 values(account,case_id,submission,conversation,recipient,copies,hidden_copies,subject_text,body_text,phase,files,gmail_files,uploads,process,reply_message,coalesce(signature,''),display_name,'<'||request::text||'@crm.curated.local>',auth.uid(),request::text,case when c.account_id=account then c.gmail_thread_id else null end,greatest(now(),a.send_retry_at)) returning id into result;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'outbox',result,'mail_queued');
 return result;
end $$;
revoke all on function public.queue_mail_email(uuid,uuid,text,text,text,uuid[],uuid[],uuid[],text[],text[],uuid,uuid,uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.queue_mail_email(uuid,uuid,text,text,text,uuid[],uuid[],uuid[],text[],text[],uuid,uuid,uuid,uuid,text,text,uuid) to authenticated;

-- Preserve delivery limits and campaign checks, expanding only manual mail access.
do $$ declare definition text;begin
 select pg_get_functiondef('public.claim_outbox_v7()'::regprocedure) into definition;
 definition:=replace(definition,'(msg.area=''seller'' and o.handed_off_at is null and (actor.role=''seller_admin'' or o.seller_id=actor.id)) or (msg.area=''closer'' and o.handed_off_at is not null and (actor.role=''closer_admin'' or o.closer_id=actor.id))','actor.role=''seller_admin'' or (actor.role=''closer_admin'' and o.handed_off_at is not null) or (actor.role=''seller'' and o.seller_id=actor.id) or (actor.role=''closer'' and o.closer_id=actor.id)');
 execute definition;
end $$;

create function public.associate_live_mail(review uuid,case_id uuid,process uuid,submission uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.mail_review;m public.gmail_archive_messages;
begin
 if not coalesce(public.can_mail_case(case_id),false) then raise exception 'Case access required';end if;
 select * into r from public.mail_review where id=review for update;
 if r.id is null or not (public.current_app_role()='superadmin' or exists(select 1 from public.mail_accounts a where a.id=r.account_id and a.owner_id=auth.uid())) then raise exception 'Mailbox access required';end if;
 select * into m from public.gmail_archive_messages where account_id=r.account_id and gmail_message_id=r.gmail_message_id;
 if m.id is null then raise exception 'Wait for message synchronization';end if;
 if submission is null and exists(select 1 from jsonb_array_elements(m.participants) p join public.lender_contacts l on l.email=p->>'email' where p->>'role'='from') then raise exception 'Choose the lender evaluation and process';end if;
 process:=public.mail_process(case_id,process);
 if submission is not null and not exists(select 1 from public.submissions where id=submission and opportunity_id=case_id and process_id=process) then raise exception 'Choose a case lender evaluation';end if;
 if exists(select 1 from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id and (opportunity_id<>case_id or process_id<>process or submission_id is distinct from submission)) then raise exception 'Thread already belongs to another case or process';end if;
 if exists(select 1 from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id and (opportunity_id<>case_id or process_id is not null and process_id<>process or submission_id is distinct from submission)) then raise exception 'Thread already belongs to another case or process';end if;
 insert into public.gmail_thread_links(account_id,gmail_thread_id,opportunity_id,process_id,submission_id) values(m.account_id,m.gmail_thread_id,case_id,process,submission) on conflict do nothing;
 insert into public.conversations(account_id,gmail_thread_id,opportunity_id,process_id,submission_id,subject,area,updated_at)
 select m.account_id,m.gmail_thread_id,case_id,process,submission,m.subject,case when submission is not null or o.handed_off_at is not null and m.sent_at>=o.handed_off_at then 'closer'::public.case_area else 'seller'::public.case_area end,m.sent_at from public.opportunities o where o.id=case_id on conflict do nothing;
 insert into public.jobs(kind,payload,dedupe_key) values('gmail_live_thread',jsonb_build_object('account_id',m.account_id,'thread_id',m.gmail_thread_id),'live-thread:'||m.account_id||':'||m.gmail_thread_id) on conflict do nothing;
 update public.mail_review set status='resolved' where account_id=m.account_id and gmail_message_id in(select gmail_message_id from public.gmail_archive_messages where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id);
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'mail_review',review,'thread_associated');
end $$;
revoke all on function public.associate_live_mail(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.associate_live_mail(uuid,uuid,uuid,uuid) to authenticated;
create policy live_review_mailbox on public.mail_review for select to authenticated using(public.current_app_role() is not null and exists(select 1 from public.mail_accounts a where a.id=account_id and a.owner_id=auth.uid()));

create function public.queue_mail_lenders(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target jsonb;s public.submissions;case_id uuid:=(input->>'case_id')::uuid;process uuid:=(input->>'process')::uuid;request uuid:=(input->>'request')::uuid;result jsonb:='[]';send_id uuid;matches int;receipt public.command_receipts;fingerprint text;
begin
 if not coalesce(public.can_mail_case(case_id),false) or jsonb_typeof(input->'targets')<>'array' or jsonb_array_length(input->'targets') not between 1 and 20 or process is null then raise exception 'Choose a process and lenders';end if;
 if jsonb_array_length(input->'copies')>0 or jsonb_array_length(input->'hidden_copies')>0 then raise exception 'Lender messages must have independent recipients';end if;
 if (select count(distinct (t->>'lender_id')::uuid) from jsonb_array_elements(input->'targets') t)<>jsonb_array_length(input->'targets') then raise exception 'Duplicate lender';end if;
 perform pg_advisory_xact_lock(hashtextextended(request::text,29));
 fingerprint:=md5((input-'signature'-'display_name')::text);
 select * into receipt from public.command_receipts where user_id=auth.uid() and request_key=request;
 if receipt.user_id is not null then
  if receipt.kind<>'mail_lenders' or receipt.fingerprint<>fingerprint then raise exception 'Request key reused with different input';end if;
  return receipt.result;
 end if;
 for target in select value from jsonb_array_elements(input->'targets') loop
  if not exists(select 1 from public.lender_contacts c join public.lenders l on l.id=c.lender_id where c.lender_id=(target->>'lender_id')::uuid and c.email=lower(target->>'email') and l.archived_at is null) then raise exception 'Confirm the lender contact';end if;
  if target->>'submission_id' is not null then
   select * into s from public.submissions where id=(target->>'submission_id')::uuid and lender_id=(target->>'lender_id')::uuid and opportunity_id=case_id and process_id=process;
   if s.id is null then raise exception 'Choose the lender evaluation for this process';end if;
  else
   select count(*) into matches from public.submissions where lender_id=(target->>'lender_id')::uuid and opportunity_id=case_id and process_id=process;
   if matches>1 then raise exception 'Select a lender evaluation explicitly';end if;
   select * into s from public.submissions where lender_id=(target->>'lender_id')::uuid and opportunity_id=case_id and process_id=process;
   if s.id is null then
    insert into public.submissions(opportunity_id,lender_id,closer_id,status,channel,next_action,next_action_at,process_id)
    select case_id,(target->>'lender_id')::uuid,coalesce(o.closer_id,auth.uid()),'draft','email','Esperar respuesta del lender',now()+interval '5 days',process from public.opportunities o where id=case_id returning * into s;
   end if;
  end if;
  send_id:=public.queue_mail_email(case_id,(input->>'account')::uuid,target->>'email',input->>'subject_text',input->>'body_text',
   array(select jsonb_array_elements_text(input->'files')::uuid),array(select jsonb_array_elements_text(input->'gmail_files')::uuid),array(select jsonb_array_elements_text(input->'uploads')::uuid),'{}','{}',process,null,null,s.id,input->>'signature',input->>'display_name',md5(request::text||':'||s.id)::uuid);
  result:=result||jsonb_build_array(jsonb_build_object('id',send_id,'lender_id',s.lender_id));
 end loop;
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request,'mail_lenders',result,fingerprint);
 return result;
end $$;
revoke all on function public.queue_mail_lenders(jsonb) from public,anon;
grant execute on function public.queue_mail_lenders(jsonb) to authenticated;

create function public.queue_mail_forward(input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.messages;source public.outbox;previous public.outbox;result uuid;case_id uuid:=(input->>'case_id')::uuid;request uuid:=(input->>'request')::uuid;files uuid[]:=array(select jsonb_array_elements_text(input->'forward_file_ids')::uuid);
begin
 if not coalesce(public.can_mail_case(case_id),false) then raise exception 'Case access required';end if;
 select msg.* into m from public.messages msg join public.conversations c on c.id=msg.conversation_id where msg.id=(input->>'forward_message_id')::uuid and c.opportunity_id=case_id;
 if m.id is null or cardinality(files)+jsonb_array_length(input->'files')+jsonb_array_length(input->'gmail_files')+jsonb_array_length(input->'uploads')>20 then raise exception 'Choose the source message and its case attachments';end if;
 select * into source from public.outbox where message_id_header=m.internet_message_id and opportunity_id=case_id and status='sent';
 if exists(select 1 from unnest(files) f where not (
  exists(select 1 from jsonb_array_elements(coalesce(source.attachment_snapshot,'[]')) s where s->>'id'=f::text) or
  exists(select 1 from public.gmail_saved_attachments g where g.id=f and g.archive_message_id=m.archive_message_id and g.opportunity_id=case_id and g.storage_path is not null)
 )) then raise exception 'Wait for the original attachments to be saved';end if;
 perform pg_advisory_xact_lock(hashtextextended(request::text,27));
 select * into previous from public.outbox where request_key=request::text;
 if previous.id is not null and (previous.forward_message_id,previous.forward_file_ids) is distinct from (m.id,files) then raise exception 'Request key reused with another forwarded message';end if;
 result:=public.queue_mail_email(case_id,(input->>'account')::uuid,input->>'recipient',input->>'subject_text',input->>'body_text',
  array(select jsonb_array_elements_text(input->'files')::uuid),array(select jsonb_array_elements_text(input->'gmail_files')::uuid),array(select jsonb_array_elements_text(input->'uploads')::uuid),
  array(select jsonb_array_elements_text(input->'copies')),array(select jsonb_array_elements_text(input->'hidden_copies')),(input->>'process')::uuid,null,null,(input->>'submission')::uuid,input->>'signature',input->>'display_name',request);
 update public.outbox set forward_message_id=m.id,forward_file_ids=files where id=result;
 return result;
end $$;
revoke all on function public.queue_mail_forward(jsonb) from public,anon;
grant execute on function public.queue_mail_forward(jsonb) to authenticated;

create function public.register_mail_contact(case_id uuid,address text,display_name text,lender uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare chosen_company uuid;chosen_contact uuid;
begin
 if not coalesce(public.can_mail_case(case_id),false) then raise exception 'Case access required';end if;
 address:=lower(btrim(address));
 if address !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(address)>254 or length(display_name)>150 then raise exception 'Invalid contact';end if;
 if exists(select 1 from public.gmail_team_members where email=address) or exists(select 1 from public.mail_accounts where email=address) then raise exception 'Internal addresses are managed in team settings';end if;
 if lender is not null then
  if exists(select 1 from public.contacts c join public.company_contacts cc on cc.contact_id=c.id where c.email=address and cc.relationship in ('primary','contact')) then raise exception 'Address already registered as a client';end if;
  if not exists(select 1 from public.lenders where id=lender and archived_at is null) or exists(select 1 from public.lender_contacts where email=address and lender_id<>lender) then raise exception 'Confirm the lender and address';end if;
  insert into public.lender_contacts(email,lender_id,created_by) values(address,lender,auth.uid()) on conflict do nothing;
  insert into public.conversation_lenders select distinct m.conversation_id,lender from public.messages m cross join lateral jsonb_array_elements(m.participants) p join public.conversations c on c.id=m.conversation_id where c.opportunity_id=case_id and lower(p->>'email')=address on conflict do nothing;
 else
  if exists(select 1 from public.lender_contacts where email=address) then raise exception 'Address already belongs to a lender';end if;
  select o.company_id into chosen_company from public.opportunities o where o.id=case_id for update;
  if chosen_company is null then
   insert into public.companies(name) select o.company from public.opportunities o where o.id=case_id returning id into chosen_company;
   update public.opportunities set company_id=chosen_company where id=case_id;
  end if;
  select id into chosen_contact from public.contacts where email=address;
  if chosen_contact is null then insert into public.contacts(email,name,company_id) values(address,display_name,chosen_company) returning id into chosen_contact;end if;
  if exists(select 1 from public.company_contacts where contact_id=chosen_contact and company_id<>chosen_company and relationship in ('primary','contact')) then raise exception 'Contact belongs to another company; review first';end if;
  if exists(select 1 from public.contacts where id=chosen_contact and company_id is not null and company_id<>chosen_company) then raise exception 'Contact belongs to another company; review first';end if;
  insert into public.company_contacts(company_id,contact_id,relationship) values(chosen_company,chosen_contact,'contact') on conflict(company_id,contact_id) do update set relationship=case when public.company_contacts.relationship='primary' then 'primary' else 'contact' end;
 end if;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'opportunity',case_id,'mail_contact_registered',jsonb_build_object('email',address,'lender_id',lender));
end $$;
revoke all on function public.register_mail_contact(uuid,text,text,uuid) from public,anon;
grant execute on function public.register_mail_contact(uuid,text,text,uuid) to authenticated;

create function public.mail_case_stats(case_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('sent',count(*) filter(where m.direction='outbound'),'received',count(*) filter(where m.direction='inbound'),
 'threads',count(distinct c.id),'lenders_contacted',(select count(distinct l.lender_id) from public.messages x join public.conversations cv on cv.id=x.conversation_id cross join lateral jsonb_array_elements(x.participants) p join public.lender_contacts l on l.email=p->>'email' where cv.opportunity_id=case_id and x.direction='outbound' and p->>'role' in ('to','cc')))
 from public.messages m join public.conversations c on c.id=m.conversation_id where c.opportunity_id=case_id and public.can_mail_case(case_id)
$$;
revoke all on function public.mail_case_stats(uuid) from public,anon;
grant execute on function public.mail_case_stats(uuid) to authenticated;

-- A repeat financing request belongs to the customer's existing case.
-- Existing duplicate cases are retained for a separate, explicit reconciliation.
create function public.gmail_live_only_address(address text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.gmail_archive_messages m where m.is_live and m.participants @> jsonb_build_array(jsonb_build_object('email',address))
  and exists(select 1 from jsonb_array_elements(m.participants) p where p->>'email'=address and p->>'role'=case when m.direction='inbound' then 'from' else 'to' end))
 and not exists(select 1 from public.gmail_archive_messages m where m.participants @> jsonb_build_array(jsonb_build_object('email',address)) and (not m.is_live or exists(select 1 from public.gmail_run_messages r where r.message_id=m.id)))
 and not exists(select 1 from public.gmail_team_members where email=address)
 and not exists(select 1 from public.mail_accounts where email=address)
 and not exists(select 1 from public.lender_contacts where email=address)
$$;
revoke all on function public.gmail_live_only_address(text) from public,anon,authenticated;
grant execute on function public.gmail_live_only_address(text) to service_role;
do $$ declare definition text;begin
 select pg_get_functiondef('public.ingest_import_chunk(uuid,jsonb)'::regprocedure) into definition;
 execute replace(definition,'elsif exists(select 1 from public.gmail_known_emails k where k.email=email) then','elsif exists(select 1 from public.gmail_known_emails k where k.email=email) and not public.gmail_live_only_address(email) then');
end $$;
alter function public.crm_command(text,jsonb,uuid) rename to crm_command_v20;
do $$ declare definition text;begin
 select pg_get_functiondef('public.crm_command_v20(text,jsonb,uuid)'::regprocedure) into definition;
 execute replace(definition,'crm_command.request_key','crm_command_v20.request_key');
end $$;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.current_app_role() is null then raise exception 'Invitation and MFA required';end if;
 if kind='create_lead' then
  perform pg_advisory_xact_lock(hashtextextended(lower(btrim(p->>'email')),1));
  if public.gmail_live_only_address(lower(btrim(p->>'email'))) then return public.crm_command_v18(kind,p,request_key);end if;
 end if;
 if kind='create_opportunity' and not exists(select 1 from public.command_receipts r where r.user_id=auth.uid() and r.request_key=crm_command.request_key) then
  perform 1 from public.contacts where email=lower(btrim(p->>'email')) for update;
  if exists(select 1 from public.opportunities o join public.contacts c on (c.id=o.contact_id or c.company_id is not null and c.company_id=o.company_id or exists(select 1 from public.company_contacts cc where cc.contact_id=c.id and cc.company_id=o.company_id and cc.relationship in ('primary','contact'))) where c.email=lower(btrim(p->>'email'))) then
   raise exception 'Este cliente ya tiene un expediente. Abre su oportunidad y usa Añadir proceso para una nueva solicitud.';
  end if;
 end if;
 return public.crm_command_v20(kind,p,request_key);
end $$;
revoke all on function public.crm_command_v20(text,jsonb,uuid),public.crm_command(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated;

create function public.mail_pending_threads(page_number integer) returns jsonb language sql stable security definer set search_path='' as $$
 with visible as (
 select distinct on (m.account_id,m.gmail_thread_id) m.id,m.account_id,m.gmail_thread_id,m.subject,m.sent_at,m.participants,r.id as review_id
 from public.mail_review r join public.gmail_archive_messages m on m.account_id=r.account_id and m.gmail_message_id=r.gmail_message_id
 join public.mail_accounts a on a.id=r.account_id
 where r.status='pending' and public.current_app_role() is not null and (a.owner_id=auth.uid() or public.current_app_role()='superadmin')
 order by m.account_id,m.gmail_thread_id,m.sent_at desc,r.id
 ),page as (select * from visible order by sent_at desc,id limit 50 offset greatest(0,least(coalesce(page_number,0),100000))*50)
 select jsonb_build_object('total',(select count(*) from visible),'threads',coalesce((select jsonb_agg(page) from page),'[]'::jsonb))
$$;
revoke all on function public.mail_pending_threads(integer) from public,anon;
grant execute on function public.mail_pending_threads(integer) to authenticated;

notify pgrst,'reload schema';
commit;
