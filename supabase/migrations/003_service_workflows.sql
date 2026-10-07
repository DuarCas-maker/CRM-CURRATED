begin;
create table public.invitations(email text primary key,name text not null,role public.app_role not null,invited_by uuid references public.profiles,sent_at timestamptz,created_at timestamptz not null default now());
alter table public.invitations enable row level security;
revoke all on public.invitations from anon,authenticated;
create function public.accept_invitation() returns trigger language plpgsql security definer set search_path='' as $$
declare invite public.invitations;
begin
 select * into invite from public.invitations where email=lower(new.email);
 if invite.email is not null then insert into public.profiles(id,name,email,role) values(new.id,invite.name,lower(new.email),invite.role); end if;
 return new;
end $$;
create trigger on_invited_user_created after insert on auth.users for each row execute function public.accept_invitation();

create function public.register_import(batch_id uuid,file_name text,storage_path text,mapping jsonb,sheet text,total int,actor uuid,request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
 if not exists(select 1 from public.profiles where id=actor and active and role in ('superadmin','seller_admin')) then raise exception 'Administrator required'; end if;
 insert into public.import_batches(id,name,storage_path,mapping,sheet,total,created_by,request_key) values(batch_id,file_name,storage_path,mapping,sheet,total,actor,request_key) on conflict on constraint import_batches_request_key_key do nothing returning id into existing;
 if existing is null then select id into existing from public.import_batches b where b.request_key=register_import.request_key; end if;
 insert into public.jobs(kind,payload,dedupe_key) values('import',jsonb_build_object('batch_id',existing),'import:'||existing) on conflict do nothing;
 return existing;
end $$;
create function public.ingest_import_chunk(batch_id uuid,rows jsonb) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare b public.import_batches; row jsonb; contact_id uuid; company_id uuid; opportunity_id uuid; result text; email text;
begin
 select * into b from public.import_batches where id=batch_id for update;
 if b.id is null then raise exception 'Batch not found'; end if;
 for row in select value from jsonb_array_elements(rows) loop
  if exists(select 1 from public.import_rows r where r.batch_id=b.id and r.row_number=(row->>'row_number')::int) then continue; end if;
  contact_id:=null; result:='imported';
  if not coalesce((row->>'valid')::boolean,false) then result:='error';
  else
   email:=lower(btrim(row->>'email'));
   perform pg_advisory_xact_lock(hashtextextended(email,1));
   select id into contact_id from public.contacts c where c.email=email;
   if contact_id is not null then result:='duplicate';
   else
    insert into public.companies(name) values(coalesce(nullif(row->>'company',''),'Unspecified business')) returning id into company_id;
    insert into public.contacts(company_id,email,name,phone) values(company_id,email,coalesce(row->>'contact',''),coalesce(row->>'phone','')) returning id into contact_id;
    insert into public.opportunities(contact_id,company_id,company,industry,seller_id) values(contact_id,company_id,coalesce(nullif(row->>'company',''),'Unspecified business'),coalesce(row->>'industry',''),b.created_by) returning id into opportunity_id;
    perform public.initialize_checklist(opportunity_id,'Business loan');
   end if;
  end if;
  insert into public.import_rows(batch_id,row_number,contact_id,result,error) values(b.id,(row->>'row_number')::int,contact_id,result,row->>'error');
  update public.import_batches set processed=processed+1,imported=imported+case when result='imported' then 1 else 0 end,duplicates=duplicates+case when result='duplicate' then 1 else 0 end,errors=errors+case when result='error' then 1 else 0 end,status='running' where id=b.id;
 end loop;
 update public.import_batches set status='completed' where id=b.id and processed>=total;
end $$;

create function public.claim_job() returns setof public.jobs language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 -- A lease token fences a stale worker from acknowledging another worker's job.
 select id into target from public.jobs where (status='queued' and run_at<=now()) or (status='running' and locked_at<now()-interval '5 minutes') order by run_at for update skip locked limit 1;
 if target is null then return; end if;
 return query update public.jobs set status='running',locked_at=now(),attempts=attempts+1,lease_token=gen_random_uuid() where id=target returning *;
end $$;
create function public.finish_job(job_id uuid,lease uuid,success boolean,error_code text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.jobs set status=case when success then 'completed' when attempts>=5 then 'failed' else 'queued' end,run_at=now()+make_interval(secs=>least(3600,power(2,attempts)::int*30)),last_error=error_code,locked_at=null where id=job_id and lease_token=lease and status='running';
end $$;
create function public.extend_job(job_id uuid,lease uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin update public.jobs set locked_at=now() where id=job_id and lease_token=lease and status='running'; return found; end $$;

create function public.persist_application(link_hash text,payload_encrypted text,payload_hash text,declaration_version text,signature_name text,request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare link public.application_links; app public.applications; opportunity public.opportunities;
begin
 select * into link from public.application_links where token_hash=link_hash and revoked_at is null and expires_at>now() for update;
 if link.id is null then raise exception 'Invalid or expired application link'; end if;
 select * into opportunity from public.opportunities where id=link.opportunity_id for update;
 if opportunity.handed_off_at is not null or opportunity.archived_at is not null then raise exception 'Application is no longer open'; end if;
 select * into app from public.applications where opportunity_id=link.opportunity_id;
 if app.id is not null then
  if app.payload_hash<>persist_application.payload_hash then raise exception 'Application already submitted; contact your representative to correct it'; end if;
  return app.id;
 end if;
 insert into public.applications(opportunity_id,link_id,encrypted_payload,payload_hash,declaration_version,signature_name,request_key) values(link.opportunity_id,link.id,payload_encrypted,payload_hash,declaration_version,signature_name,request_key) returning * into app;
 update public.opportunities set application_signed=true,application_complete=true,stage='documents_pending',updated_at=now() where id=link.opportunity_id;
 update public.campaign_enrollments set status='goal_met' where opportunity_id=link.opportunity_id and status in ('active','paused');
 update public.outbox set status='cancelled' where opportunity_id=link.opportunity_id and enrollment_id is not null and status in ('queued','paused');
 insert into public.jobs(kind,payload,dedupe_key) values('pdf',jsonb_build_object('application_id',app.id),'pdf:'||app.id) on conflict do nothing;
 insert into public.activities(opportunity_id,actor_id,type,area,body) values(link.opportunity_id,null,'application','seller','Signed application received');
 perform public.notify_user(opportunity.seller_id,'application:'||app.id,'Application received');
 return app.id;
end $$;
create function public.register_document(document_id uuid,path text,content_hash text,source text,actor uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare doc public.documents; o public.opportunities;
begin
 select * into doc from public.documents where id=document_id for update;
 select * into o from public.opportunities where id=doc.opportunity_id;
 if doc.id is null then raise exception 'Document not found'; end if;
 if doc.content_hash=register_document.content_hash then return; end if;
 insert into public.document_versions(document_id,storage_path,content_hash,source,actor_id) values(doc.id,path,content_hash,source,actor) on conflict do nothing;
 update public.documents set storage_path=path,content_hash=register_document.content_hash,source=register_document.source,status='received',reviewed_by=null,reviewed_at=null where id=doc.id;
 insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,'document',case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end,'Document received; review required');
 perform public.notify_user(coalesce(o.closer_id,o.seller_id),'document:'||doc.id||':'||content_hash,'Document received');
end $$;
create function public.suppress_contact(contact uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare contact_email text;
begin
 select contacts.email into contact_email from public.contacts where id=contact for update;
 if contact_email is null then raise exception 'Contact not found'; end if;
 insert into public.suppressions(email,reason) values(contact_email,reason) on conflict(email) do nothing;
 update public.campaign_enrollments set status='suppressed' where contact_id=contact and status in ('active','paused');
 update public.outbox set status='cancelled' where lower(to_email)=contact_email and area='seller' and status in ('queued','paused');
end $$;
create function public.stop_contact_sequence(contact uuid,why text) returns void language plpgsql security definer set search_path='' as $$
begin
 if why not in ('replied','bounced','goal_met') then raise exception 'Invalid stop reason'; end if;
 perform 1 from public.contacts where id=contact for update;
 update public.campaign_enrollments set status=why where contact_id=contact and status in ('active','paused');
 update public.outbox set status='cancelled' where enrollment_id in (select id from public.campaign_enrollments where contact_id=contact) and status in ('queued','paused');
end $$;

create function public.claim_outbox() returns setof public.outbox language plpgsql security definer set search_path='' as $$
declare msg public.outbox; account public.mail_accounts; campaign public.campaigns; enrollment public.campaign_enrollments; contact public.contacts; actor public.profiles; o public.opportunities; sent_count int; local_start timestamptz;
begin
 select * into msg from public.outbox where status='queued' and opportunity_id is not null and available_at<=now() order by available_at for update skip locked limit 1;
 if msg.id is null then return; end if;
 select * into account from public.mail_accounts where id=msg.account_id for update;
 select * into o from public.opportunities where id=msg.opportunity_id;
 select * into contact from public.contacts where id=o.contact_id for update;
 if account.status<>'connected' then update public.outbox set status='paused' where id=msg.id; return; end if;
 if o.archived_at is not null or (msg.area='seller' and exists(select 1 from public.suppressions where email=lower(msg.to_email))) then update public.outbox set status='cancelled' where id=msg.id; return; end if;
 select * into actor from public.profiles where id=msg.requested_by and active;
 if actor.id is null or not (actor.role='superadmin' or exists(select 1 from public.mail_permissions where account_id=account.id and user_id=actor.id and can_send)) then update public.outbox set status='paused' where id=msg.id; return; end if;
 if msg.enrollment_id is not null then
  select * into enrollment from public.campaign_enrollments where id=msg.enrollment_id;
  select * into campaign from public.campaigns where id=enrollment.campaign_id;
  if enrollment.status<>'active' or contact.verification<>'valid' or o.handed_off_at is not null or o.application_complete then update public.outbox set status='cancelled' where id=msg.id; return; end if;
  if campaign.status<>'active' or extract(hour from now() at time zone campaign.timezone)<campaign.start_hour or extract(hour from now() at time zone campaign.timezone)>=campaign.end_hour then update public.outbox set available_at=now()+interval '10 minutes' where id=msg.id; return; end if;
  if actor.role not in ('superadmin','seller_admin') then update public.outbox set status='paused' where id=msg.id; return; end if;
  select count(*) into sent_count from public.outbox x join public.campaign_enrollments e on x.enrollment_id=e.id where e.campaign_id=campaign.id and x.status in ('sent','sending','uncertain') and coalesce(x.sent_at,x.sending_at)>=date_trunc('day',now() at time zone campaign.timezone) at time zone campaign.timezone;
  if sent_count>=campaign.daily_limit then update public.outbox set available_at=now()+interval '1 hour' where id=msg.id; return; end if;
 else
  if not (actor.role='superadmin' or (msg.area='seller' and o.handed_off_at is null and (actor.role='seller_admin' or o.seller_id=actor.id)) or (msg.area='closer' and o.handed_off_at is not null and (actor.role='closer_admin' or o.closer_id=actor.id))) then update public.outbox set status='cancelled' where id=msg.id; return; end if;
 end if;
 local_start:=date_trunc('day',now() at time zone account.timezone) at time zone account.timezone;
 select count(*) into sent_count from public.outbox where account_id=account.id and status in ('sent','sending','uncertain') and coalesce(sent_at,sending_at)>=local_start;
 if sent_count>=account.daily_limit or exists(select 1 from public.outbox where account_id=account.id and sending_at>now()-interval '30 seconds') then update public.outbox set available_at=now()+interval '1 minute' where id=msg.id; return; end if;
 return query update public.outbox set status='sending',sending_at=now() where id=msg.id returning *;
end $$;
create function public.mark_sent(outbox_id uuid,gmail_id text,thread_id text) returns void language plpgsql security definer set search_path='' as $$
declare msg public.outbox; conversation uuid; enrollment public.campaign_enrollments; campaign public.campaigns; next_step jsonb;
begin
 select * into msg from public.outbox where id=outbox_id for update;
 if msg.status='sent' then return; end if;
 update public.outbox set status='sent',gmail_message_id=gmail_id,gmail_thread_id=thread_id,sent_at=now() where id=outbox_id;
 if msg.opportunity_id is null then return; end if;
 insert into public.conversations(opportunity_id,submission_id,account_id,gmail_thread_id,subject,area) values(msg.opportunity_id,msg.submission_id,msg.account_id,thread_id,msg.subject,msg.area) on conflict(account_id,gmail_thread_id) do update set updated_at=now() returning id into conversation;
 insert into public.messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status,internet_message_id) values(conversation,gmail_id,'outbound',(select email from public.mail_accounts where id=msg.account_id),msg.body,now(),'sent',msg.message_id_header) on conflict do nothing;
 update public.conversations set needs_attention=exists(select 1 from public.messages where conversation_id=conversation and direction='inbound' and sent_at>msg.sending_at) where id=conversation;
 if msg.submission_id is not null then update public.submissions set status='submitted',submitted_at=now() where id=msg.submission_id and status='draft'; end if;
 if msg.area='seller' then update public.opportunities set last_contact=now(),stage=case when stage='new' then 'contacting'::public.case_stage else stage end where id=msg.opportunity_id; end if;
 if msg.enrollment_id is not null then
  select * into enrollment from public.campaign_enrollments where id=msg.enrollment_id for update;
  select * into campaign from public.campaigns where id=enrollment.campaign_id;
  next_step:=campaign.steps->enrollment.step;
  if next_step is null then update public.campaign_enrollments set status='completed' where id=enrollment.id and status='active';
  else update public.campaign_enrollments set step=step+1,next_at=now()+make_interval(days=>(next_step->>'wait_days')::int) where id=enrollment.id and status='active'; end if;
 end if;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(msg.requested_by,'outbox',msg.id,'gmail_accepted');
end $$;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.current_app_role(),public.can_case(uuid),public.can_area(uuid,public.case_area),public.can_edit_case(uuid),public.can_send(uuid),public.crm_command(text,jsonb,uuid) to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
commit;
