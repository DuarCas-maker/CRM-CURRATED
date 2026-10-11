begin;

alter table public.gmail_candidates add column import_requested_at timestamptz;
alter table public.gmail_candidates add column attachments_reviewed_at timestamptz;
create index gmail_pending_candidate_imports on public.gmail_candidates(run_id) where import_requested_at is not null and imported_at is null;
update public.gmail_candidates c set import_requested_at=coalesce(r.approved_at,now()) from public.gmail_runs r where c.run_id=r.id and c.selected and c.imported_at is null and r.phase='import' and r.status in ('importing','paused','failed');

-- An address index is evidence of prior mail, not a contact or a qualified lead.
create table public.gmail_known_emails(email text primary key,first_seen_at timestamptz not null,last_seen_at timestamptz not null);
alter table public.gmail_known_emails enable row level security;
revoke all on public.gmail_known_emails from anon,authenticated;
grant all on public.gmail_known_emails to service_role;
insert into public.gmail_known_emails
select lower(btrim(p->>'email')),min(m.sent_at),max(m.sent_at)
from public.gmail_archive_messages m cross join lateral jsonb_array_elements(m.participants) p
where lower(btrim(p->>'email')) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
group by lower(btrim(p->>'email'));
create function public.gmail_index_addresses() returns trigger language plpgsql security definer set search_path='' as $$
declare address text;
begin
 for address in select distinct lower(btrim(value->>'email')) from jsonb_array_elements(new.participants) order by 1 loop
  if address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   perform pg_advisory_xact_lock(hashtextextended(address,1));
   insert into public.gmail_known_emails values(address,new.sent_at,new.sent_at)
   on conflict(email) do update set first_seen_at=least(gmail_known_emails.first_seen_at,excluded.first_seen_at),last_seen_at=greatest(gmail_known_emails.last_seen_at,excluded.last_seen_at);
  end if;
 end loop;
 return new;
end $$;
create trigger gmail_address_index after insert or update of participants on public.gmail_archive_messages for each row execute function public.gmail_index_addresses();

create function public.gmail_confirm_candidates(run uuid,actor uuid,only_candidate uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare r public.gmail_runs; count_selected int;
begin
 if not exists(select 1 from public.profiles where id=actor and active and role='superadmin') then raise exception 'Superadmin required';end if;
 select * into r from public.gmail_runs where id=run for update;
 if r.id is null or r.status not in ('review','completed','importing') then raise exception 'Finish analysis before confirming';end if;
 if not exists(select 1 from public.mail_accounts where id=r.account_id and owner_id is not null and status='connected') then raise exception 'Assign mailbox owner and connect account';end if;
 if r.attachments_reviewed_at is null and exists(select 1 from public.gmail_candidates c where c.run_id=run and c.selected and c.imported_at is null and c.import_requested_at is null and (only_candidate is null or c.id=only_candidate) and c.attachment_count>0 and c.attachments_reviewed_at is null) then raise exception 'Review attachment selection before confirming import';end if;
 update public.gmail_candidates set import_requested_at=now(),last_error=null where run_id=run and selected and imported_at is null and import_requested_at is null and (only_candidate is null or id=only_candidate);
 get diagnostics count_selected=row_count;
 if count_selected=0 then
  if only_candidate is null and exists(select 1 from public.gmail_candidates where run_id=run and import_requested_at is not null and imported_at is null) then return;end if;
  if only_candidate is not null and exists(select 1 from public.gmail_candidates where id=only_candidate and run_id=run and (imported_at is not null or import_requested_at is not null)) then return;end if;
  raise exception 'Select a reviewed participant';
 end if;
 update public.gmail_runs set phase='import',approved_by=actor,approved_at=coalesce(approved_at,now()),last_error=null where id=run;
 begin
  if not exists(select 1 from public.gmail_runs other where other.account_id=r.account_id and other.id<>r.id and other.status in ('analyzing','importing')) then
   update public.gmail_runs set status='importing',offset_index=case when r.status='importing' then offset_index else 0 end,lease_token=case when r.status='importing' then lease_token else null end,lease_until=case when r.status='importing' then lease_until else null end,finished_at=null where id=run;
  end if;
 exception when unique_violation then null; -- A concurrent sync owns the mailbox; activate after its checkpoint.
 end;
 insert into public.jobs(kind,payload,dedupe_key) values('gmail_archive',jsonb_build_object('run_id',run),'gmail-incremental:'||run||':'||gen_random_uuid()) on conflict do nothing;
end $$;
create function public.gmail_activate_pending_imports() returns void language plpgsql security definer set search_path='' as $$
declare r public.gmail_runs;
begin
 for r in select * from public.gmail_runs x where x.status in ('review','completed') and x.phase='import' and exists(select 1 from public.gmail_candidates c where c.run_id=x.id and c.import_requested_at is not null and c.imported_at is null) for update skip locked loop
  begin
   if not exists(select 1 from public.gmail_runs other where other.account_id=r.account_id and other.id<>r.id and other.status in ('analyzing','importing')) then
    update public.gmail_runs set status='importing',offset_index=0,lease_token=null,lease_until=null,finished_at=null where id=r.id;
   end if;
  exception when unique_violation then null;
  end;
 end loop;
end $$;
revoke all on function public.gmail_activate_pending_imports() from public,anon,authenticated;
grant execute on function public.gmail_activate_pending_imports() to service_role;
create function public.gmail_protect_requested_candidate() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.import_requested_at is not null and old.imported_at is null and (new.selected,new.name,new.company_name,new.phone,new.classification,new.participant_kind,new.selected_opportunity_id,new.selected_process_id,new.selected_company_id,new.submission_id) is distinct from (old.selected,old.name,old.company_name,old.phone,old.classification,old.participant_kind,old.selected_opportunity_id,old.selected_process_id,old.selected_company_id,old.submission_id) and new.imported_at is not distinct from old.imported_at then
  raise exception 'This record is already queued; review the imported case instead';
 end if;
 return new;
end $$;
create trigger gmail_requested_candidate_guard before update on public.gmail_candidates for each row execute function public.gmail_protect_requested_candidate();
revoke all on function public.gmail_protect_requested_candidate() from public,anon,authenticated;
create or replace function public.gmail_confirm_import(run uuid,actor uuid) returns void language sql security definer set search_path='' as $$select public.gmail_confirm_candidates(run,actor,null)$$;
create function public.gmail_review_candidate_attachments(candidate uuid,run uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.current_app_role() is distinct from 'superadmin' or not exists(select 1 from public.gmail_runs where id=run and status in ('review','completed','importing')) then raise exception 'Finish analysis before reviewing attachments';end if;
 update public.gmail_candidates set attachments_reviewed_at=now() where id=candidate and run_id=run;
 if not found then raise exception 'Choose a candidate from this import';end if;
end $$;
revoke all on function public.gmail_review_candidate_attachments(uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_review_candidate_attachments(uuid,uuid) to authenticated;

-- Finish under the same lock as confirmation: a newly approved record cannot be lost.
create function public.gmail_finish_incremental_import(run uuid,lease uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.gmail_runs;
begin
 select * into r from public.gmail_runs where id=run and lease_token=lease and status='importing' for update;
 if r.id is null then return false;end if;
 if exists(select 1 from public.gmail_candidates where run_id=run and import_requested_at is not null and imported_at is null) then
  update public.gmail_runs set offset_index=0 where id=run;return false;
 end if;
 update public.gmail_runs set status='completed',finished_at=now(),last_error=null where id=run;
 return true;
end $$;

-- All pending historical addresses participate in duplicate checks, without exposing
-- their message contents or granting access to somebody else's customer.
alter function public.crm_command(text,jsonb,uuid) rename to crm_command_v18;
-- Preserve the original function's qualified idempotency parameter after rename.
do $$ declare definition text; begin
 select pg_get_functiondef('public.crm_command_v18(text,jsonb,uuid)'::regprocedure) into definition;
 execute replace(definition,'crm_command.request_key','crm_command_v18.request_key');
end $$;
revoke all on function public.crm_command_v18(text,jsonb,uuid) from public,anon,authenticated;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare address text;
begin
 if auth.uid() is null or public.current_app_role() is null then raise exception 'Invitation and MFA required';end if;
 if kind='create_lead' then
  address:=lower(btrim(p->>'email'));
  perform pg_advisory_xact_lock(hashtextextended(address,1));
  if not exists(select 1 from public.command_receipts r where r.user_id=auth.uid() and r.request_key=crm_command.request_key)
     and not exists(select 1 from public.contacts where email=address)
     and exists(select 1 from public.gmail_known_emails where email=address) then
   raise exception 'Este correo ya aparece en el historial de Gmail. Revisa su importación pendiente con el administrador antes de crear otro lead.';
  end if;
 end if;
 return public.crm_command_v18(kind,p,request_key);
end $$;
revoke all on function public.gmail_index_addresses(),public.gmail_confirm_candidates(uuid,uuid,uuid),public.gmail_finish_incremental_import(uuid,uuid),public.crm_command(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gmail_confirm_candidates(uuid,uuid,uuid),public.gmail_finish_incremental_import(uuid,uuid) to service_role;
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated,service_role;

create or replace function public.ingest_import_chunk(batch_id uuid,rows jsonb) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare b public.import_batches; row jsonb; contact_id uuid; company_id uuid; result text; email text;
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
   elsif exists(select 1 from public.gmail_known_emails k where k.email=email) then result:='duplicate';row:=row||jsonb_build_object('error','Correo detectado en Gmail: pendiente de incorporación o ya conocido');
   else
    insert into public.companies(name) values(coalesce(nullif(row->>'company',''),'Unspecified business')) returning id into company_id;
    insert into public.contacts(company_id,email,name,phone) values(company_id,email,coalesce(row->>'contact',''),coalesce(row->>'phone','')) returning id into contact_id;
    insert into public.leads(contact_id,company_id,company,industry,seller_id,batch_id)
    values(contact_id,company_id,coalesce(nullif(row->>'company',''),'Unspecified business'),coalesce(row->>'industry',''),b.created_by,b.id);
   end if;
  end if;
  insert into public.import_rows(batch_id,row_number,contact_id,result,error) values(b.id,(row->>'row_number')::int,contact_id,result,row->>'error');
  update public.import_batches set processed=processed+1,imported=imported+case when result='imported' then 1 else 0 end,duplicates=duplicates+case when result='duplicate' then 1 else 0 end,errors=errors+case when result='error' then 1 else 0 end,status='running' where id=b.id;
 end loop;
 update public.import_batches set status='completed' where id=b.id and processed>=total;
end $$;


create or replace function public.gmail_select_attachments(run uuid,case_id uuid,choices jsonb,mark_reviewed boolean)
 returns void language plpgsql security definer set search_path='' as $$
declare entry jsonb; f public.gmail_saved_attachments; actor uuid:=auth.uid(); r public.gmail_runs;
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and active) then raise exception 'Active user required'; end if;
 if (run is null)=(case_id is null) then raise exception 'Choose an import or a case'; end if;
 if run is not null then
  select * into r from public.gmail_runs where id=run for update;
  if public.current_app_role() is distinct from 'superadmin' or r.id is null or r.status not in ('review','completed','importing') then raise exception 'Finish analysis before reviewing attachments'; end if;
 else
  if not coalesce(public.can_edit_case(case_id),false) then raise exception 'Case editing required'; end if;
 end if;
 if jsonb_typeof(choices)<>'array' or jsonb_array_length(choices)>500 then raise exception 'Select at most 500 changes per save'; end if;
 for entry in select value from jsonb_array_elements(choices) loop
  if not exists(select 1 from public.gmail_archive_messages m cross join lateral jsonb_array_elements(m.attachment_index) a
   where m.id=(entry->>'archive_message_id')::uuid and a->>'part_id'=entry->>'part_id'
   and (run is not null and exists(select 1 from public.gmail_run_messages rm where rm.run_id=run and rm.message_id=m.id)
    or case_id is not null and exists(select 1 from public.gmail_saved_attachments s where s.opportunity_id=case_id and s.archive_message_id=m.id
    and s.part_id=a->>'part_id' and public.can_area(s.opportunity_id,s.area)))) then raise exception 'Attachment access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(entry->>'archive_message_id'||':'||(entry->>'part_id'),78));
  if (entry->>'included')::boolean and exists(select 1 from public.gmail_archive_messages m cross join lateral jsonb_array_elements(m.attachment_index) a
   where m.id=(entry->>'archive_message_id')::uuid and a->>'part_id'=entry->>'part_id' and (a->>'size')::int>20971520) then raise exception 'Attachment exceeds the 20 MB copy limit'; end if;
  if exists(select 1 from public.gmail_saved_attachments s where s.archive_message_id=(entry->>'archive_message_id')::uuid
   and s.part_id=entry->>'part_id' and s.storage_path is not null) then continue; end if;
  insert into public.gmail_attachment_choices(archive_message_id,part_id,decision,actor_id)
  values((entry->>'archive_message_id')::uuid,entry->>'part_id',case when (entry->>'included')::boolean then 'included' else 'excluded' end,actor)
  on conflict(archive_message_id,part_id) do update set decision=excluded.decision,actor_id=actor,updated_at=now(),revision=gen_random_uuid()
  where gmail_attachment_choices.decision is distinct from excluded.decision;
  if (entry->>'included')::boolean then
   for f in select * from public.gmail_saved_attachments s where (s.opportunity_id=case_id or run is not null and exists(select 1 from public.gmail_run_messages rm where rm.run_id=run and rm.message_id=s.archive_message_id)) and s.archive_message_id=(entry->>'archive_message_id')::uuid
    and s.part_id=entry->>'part_id' and public.can_area(s.opportunity_id,s.area) loop
    insert into public.jobs(kind,payload,dedupe_key) values('gmail_copy_attachment',jsonb_build_object('file_id',f.id),
     'gmail-selected-file:'||f.id||':'||(select revision from public.gmail_attachment_choices where archive_message_id=f.archive_message_id and part_id=f.part_id))
     on conflict(dedupe_key) do update set status='queued',attempts=0,run_at=now(),last_error=null where jobs.status='failed';
   end loop;
  end if;
 end loop;
 if run is not null and mark_reviewed then update public.gmail_runs set attachments_reviewed_at=now() where id=run; end if;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata)
 values(actor,'gmail_attachment_selection',coalesce(run,case_id),'reviewed',jsonb_build_object('changes',jsonb_array_length(choices),'import_reviewed',mark_reviewed));
end $$;


create or replace function public.gmail_preview_stats(run uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if public.current_app_role() is distinct from 'superadmin'::public.app_role then raise exception 'Superadmin required'; end if;
 select jsonb_build_object('messages',count(*),'first_at',min(m.sent_at),'last_at',max(m.sent_at),
 'documents',coalesce(sum(jsonb_array_length(m.attachment_index)),0),
 'documents_to_copy',coalesce(sum(case when m.sent_at>=r.copy_since then jsonb_array_length(m.attachment_index) else 0 end),0)) into result
 from public.gmail_run_messages rm join public.gmail_archive_messages m on m.id=rm.message_id join public.gmail_runs r on r.id=rm.run_id where rm.run_id=run;
 return result||jsonb_build_object('candidates',(select count(*) from public.gmail_candidates where run_id=run),
 'selected',(select count(*) from public.gmail_candidates where run_id=run and selected and imported_at is null and import_requested_at is null),
 'matches',(select count(*) from public.gmail_candidates where run_id=run and existing_contact_id is not null),
 'ambiguous',(select count(*) from public.gmail_candidates where run_id=run and (copied_only or cardinality(candidate_opportunity_ids)>1)),
 'months',coalesce((select jsonb_agg(x order by x.month_label) from (
 select to_char(m.sent_at,'YYYY-MM') month_label,count(distinct m.id) messages,count(distinct p->>'email') direct_participants
 from public.gmail_run_messages rm join public.gmail_archive_messages m on m.id=rm.message_id cross join lateral jsonb_array_elements(m.participants) p
 where rm.run_id=run and ((m.direction='inbound' and p->>'role'='from') or (m.direction='outbound' and p->>'role'='to'))
 and not exists(select 1 from public.mail_accounts a where a.email=p->>'email') group by 1) x),'[]'::jsonb));
end $$;

notify pgrst,'reload schema';
commit;
