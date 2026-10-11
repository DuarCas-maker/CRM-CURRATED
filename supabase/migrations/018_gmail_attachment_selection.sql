begin;
alter table public.gmail_runs add column attachments_reviewed_at timestamptz;
create table public.gmail_attachment_choices (
 archive_message_id uuid not null references public.gmail_archive_messages, part_id text not null,
 decision text not null check(decision in ('included','excluded')), actor_id uuid not null references public.profiles,
 updated_at timestamptz not null default now(), revision uuid not null default gen_random_uuid(), primary key(archive_message_id,part_id)
);
alter table public.gmail_attachment_choices enable row level security;
revoke all on public.gmail_attachment_choices from public,anon,authenticated;
grant select on public.gmail_attachment_choices to authenticated;
grant all on public.gmail_attachment_choices to service_role;
create policy attachment_choices_read on public.gmail_attachment_choices for select to authenticated using(
 public.current_app_role()='superadmin' or exists(select 1 from public.gmail_saved_attachments f
 where f.archive_message_id=gmail_attachment_choices.archive_message_id and f.part_id=gmail_attachment_choices.part_id
 and public.can_case(f.opportunity_id) and public.can_area(f.opportunity_id,f.area))
);

create function public.gmail_attachment_format(name text,mime text) returns text language sql immutable set search_path='' as $$
 select case when name ~ '\.[a-zA-Z0-9]{1,10}$' then upper(substring(name from '\.([a-zA-Z0-9]{1,10})$'))
 when mime='application/pdf' then 'PDF' when mime='image/jpeg' then 'JPG' when mime='image/png' then 'PNG'
 when mime='image/gif' then 'GIF' when mime='image/webp' then 'WEBP' else 'OTRO' end
$$;
create function public.gmail_attachment_inline(file jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce((file->>'inline')::boolean,false) or
 (coalesce(file->>'mime_type','') like 'image/%' and coalesce(file->>'name','') ~* '^(image[0-9]+|logo|signature|firma|spacer|pixel|icon)[^/]*\.')
$$;

-- Return only permitted metadata. An unassociated historical mailbox remains admin-only.
create function public.gmail_attachment_list(run uuid,candidate uuid,case_id uuid,formats text[],show_inline boolean,cursor_offset int)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if (run is null)=(case_id is null) then raise exception 'Choose an import or a case'; end if;
 if run is not null and (public.current_app_role() is distinct from 'superadmin' or not exists(select 1 from public.gmail_runs where id=run)) then raise exception 'Import access required'; end if;
 if candidate is not null and not exists(select 1 from public.gmail_candidates where id=candidate and run_id=run) then raise exception 'Participant belongs to another import'; end if;
 if case_id is not null and not coalesce(public.can_case(case_id),false) then raise exception 'Case access required'; end if;
 with eligible as (
 select m.id as archive_message_id,a->>'part_id' as part_id,a->>'name' as name,a->>'mime_type' as mime_type,
 (a->>'size')::int as size,m.sent_at,m.subject,m.participants,
 public.gmail_attachment_format(a->>'name',a->>'mime_type') as format,public.gmail_attachment_inline(a) as suspected_inline,
 coalesce(d.decision,'pending') as decision,
 exists(select 1 from public.gmail_saved_attachments f where f.archive_message_id=m.id and f.part_id=a->>'part_id' and f.storage_path is not null
 and (case_id is null or f.opportunity_id=case_id and public.can_area(f.opportunity_id,f.area))) as copied,
 (select f.last_error from public.gmail_saved_attachments f where f.archive_message_id=m.id and f.part_id=a->>'part_id'
 and (case_id is null or f.opportunity_id=case_id and public.can_area(f.opportunity_id,f.area)) limit 1) as last_error
 from public.gmail_archive_messages m cross join lateral jsonb_array_elements(m.attachment_index) a
 left join public.gmail_attachment_choices d on d.archive_message_id=m.id and d.part_id=a->>'part_id'
 where (run is not null and exists(select 1 from public.gmail_run_messages rm where rm.run_id=run and rm.message_id=m.id)
 and (candidate is null or exists(select 1 from public.gmail_candidates c where c.id=candidate and m.id=any(c.evidence_ids))))
 or (case_id is not null and exists(select 1 from public.gmail_saved_attachments f where f.opportunity_id=case_id and f.archive_message_id=m.id
 and f.part_id=a->>'part_id' and public.can_area(f.opportunity_id,f.area)))
 ), filtered as (select * from eligible where (show_inline or not suspected_inline) and (cardinality(formats)=0 or format=any(formats))),
 page as (select * from filtered order by sent_at desc,archive_message_id,part_id offset greatest(cursor_offset,0) limit 50)
 select jsonb_build_object('files',coalesce((select jsonb_agg(p) from page p),'[]'),
 'formats',coalesce((select jsonb_agg(f) from (select format,count(*) as count from eligible group by format order by format) f),'[]'),
 'total',(select count(*) from filtered),'all_count',(select count(*) from eligible),
 'selected_count',(select count(*) from eligible where decision='included' and not copied),
 'copied_count',(select count(*) from eligible where copied),'hidden_count',(select count(*) from eligible where suspected_inline),
 'reviewed',coalesce((select attachments_reviewed_at is not null from public.gmail_runs where id=run),false)) into result;
 return result;
end $$;

create function public.gmail_select_attachments(run uuid,case_id uuid,choices jsonb,mark_reviewed boolean)
 returns void language plpgsql security definer set search_path='' as $$
declare entry jsonb; f public.gmail_saved_attachments; actor uuid:=auth.uid(); r public.gmail_runs;
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and active) then raise exception 'Active user required'; end if;
 if (run is null)=(case_id is null) then raise exception 'Choose an import or a case'; end if;
 if run is not null then
  select * into r from public.gmail_runs where id=run for update;
  if public.current_app_role() is distinct from 'superadmin' or r.id is null or r.status<>'review' then raise exception 'Finish analysis before reviewing attachments'; end if;
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
  if case_id is not null and (entry->>'included')::boolean then
   for f in select * from public.gmail_saved_attachments s where s.opportunity_id=case_id and s.archive_message_id=(entry->>'archive_message_id')::uuid
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

-- DB gate also protects against old workers copying implicitly during a rolling update.
create function public.gmail_require_attachment_choice() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.storage_path is not null and (tg_op='INSERT' or old.storage_path is null) then
  perform pg_advisory_xact_lock(hashtextextended(new.archive_message_id::text||':'||new.part_id,78));
  if not exists(select 1 from public.gmail_attachment_choices where archive_message_id=new.archive_message_id and part_id=new.part_id and decision='included') then
   raise exception 'Attachment selection required';
  end if;
 end if;
 return new;
end $$;
create trigger require_attachment_choice before insert or update of storage_path on public.gmail_saved_attachments for each row execute function public.gmail_require_attachment_choice();

create function public.gmail_confirm_import(run uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.gmail_runs;
begin
 if not exists(select 1 from public.profiles where id=actor and role='superadmin' and active) then raise exception 'Superadmin required'; end if;
 select * into r from public.gmail_runs where id=run for update;
 if r.status='importing' then return; end if;
 if r.id is null or r.status<>'review' then raise exception 'Finish analysis before confirming'; end if;
 if r.attachments_reviewed_at is null and exists(select 1 from public.gmail_run_messages rm join public.gmail_archive_messages m on m.id=rm.message_id where rm.run_id=run and jsonb_array_length(m.attachment_index)>0) then raise exception 'Review attachment selection before confirming import'; end if;
 if not exists(select 1 from public.mail_accounts where id=r.account_id and status='connected' and owner_id is not null) then raise exception 'Assign the connected mailbox owner'; end if;
 if not exists(select 1 from public.gmail_candidates where run_id=run and selected) then raise exception 'Select a reviewed participant'; end if;
 update public.gmail_runs set status='importing',phase='import',offset_index=0,approved_at=now(),approved_by=actor,lease_token=null,lease_until=null where id=run;
 insert into public.jobs(kind,payload,dedupe_key) values('gmail_archive',jsonb_build_object('run_id',run),'gmail-archive:'||run||':confirm') on conflict do nothing;
end $$;
revoke all on function public.gmail_attachment_list(uuid,uuid,uuid,text[],boolean,int),public.gmail_select_attachments(uuid,uuid,jsonb,boolean) from public,anon;
grant execute on function public.gmail_attachment_list(uuid,uuid,uuid,text[],boolean,int),public.gmail_select_attachments(uuid,uuid,jsonb,boolean) to authenticated;
revoke all on function public.gmail_confirm_import(uuid,uuid),public.gmail_require_attachment_choice() from public,anon,authenticated;
grant execute on function public.gmail_confirm_import(uuid,uuid),public.gmail_require_attachment_choice() to service_role;
commit;
