-- BLOCK A LOCAL CANDIDATE ONLY. No final migration number or remote approval.
-- Effective definitions materialized from reviewed S01 fixtures over 001-047.
begin;
do $$ begin
 if current_setting('pipeline_os.block_a_local',true) is distinct from 'in_memory_test' then
  raise exception 'I02 sandbox marker required';
 end if;
 if to_regnamespace('s01_i02') is not null then raise exception 'I02 already installed';end if;
end $$;

-- No session catalog capture: all altered baseline functions are explicit below.
create schema s01_i02;
revoke all on schema s01_i02 from public,anon;
grant usage on schema s01_i02 to authenticated,service_role;

alter table public.documents add column access_area public.case_area;
alter table public.document_versions add column access_area public.case_area;
alter table public.mail_uploads add column access_area public.case_area;

create function s01_i02.phase(case_id uuid) returns public.case_area
language sql stable security definer set search_path='' as $$
 select case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end
 from public.opportunities o where o.id=case_id
$$;
create function s01_i02.visible_phase(case_id uuid) returns public.case_area
language sql stable security definer set search_path='' as $$
 select s01_i02.phase(case_id) where public.can_case(case_id)
$$;
create function s01_i02.can_message(message uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id
 where m.id=message and public.can_area(c.opportunity_id,m.area))
$$;
create function s01_i02.can_conversation(conversation uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversations c where c.id=conversation and public.can_case(c.opportunity_id)
 and (exists(select 1 from public.messages m where m.conversation_id=c.id and public.can_area(c.opportunity_id,m.area))
 or (not exists(select 1 from public.messages m where m.conversation_id=c.id) and public.can_area(c.opportunity_id,c.area))))
$$;
create function s01_i02.can_archive(message uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(public.current_app_role()='superadmin',false) or exists(
 select 1 from public.case_events e where e.archive_message_id=message and public.can_area(e.opportunity_id,e.area))
 or exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id where m.archive_message_id=message and public.can_area(c.opportunity_id,m.area))
 or exists(select 1 from public.gmail_archive_messages m join public.mail_accounts a on a.id=m.account_id
 where m.id=message and a.owner_id=auth.uid() and public.current_app_role() is not null
 and exists(select 1 from public.mail_review r where r.account_id=m.account_id and r.gmail_message_id=m.gmail_message_id and r.status='pending')
 and not exists(select 1 from public.case_events e where e.archive_message_id=m.id)
 and not exists(select 1 from public.messages x where x.archive_message_id=m.id)
 and not exists(select 1 from public.conversations c where c.account_id=m.account_id and c.gmail_thread_id=m.gmail_thread_id)
 and not exists(select 1 from public.gmail_thread_links l where l.account_id=m.account_id and l.gmail_thread_id=m.gmail_thread_id))
$$;
create function s01_i02.can_content(case_id uuid,area public.case_area) returns boolean
language sql stable security definer set search_path='' as $$
 select public.can_case(case_id) and (public.current_app_role()='superadmin' or
 (area is not null and public.can_area(case_id,area)))
$$;
create function s01_i02.can_source(source text,resource uuid,hash text default null) returns boolean
language sql stable security definer set search_path='' as $$
 select case source
 when 'document' then exists(select 1 from public.documents d where d.id=resource and
  case when hash is null or hash=d.content_hash then s01_i02.can_content(d.opportunity_id,d.access_area)
  else exists(select 1 from public.document_versions v where v.document_id=d.id and v.content_hash=hash and s01_i02.can_content(d.opportunity_id,v.access_area)) end)
 when 'version' then exists(select 1 from public.document_versions v join public.documents d on d.id=v.document_id
  where v.id=resource and (hash is null or v.content_hash=hash) and s01_i02.can_content(d.opportunity_id,v.access_area))
 when 'saved' then exists(select 1 from public.gmail_saved_attachments f where f.id=resource
  and (hash is null or f.content_hash=hash) and public.can_area(f.opportunity_id,f.area))
 when 'upload' then exists(select 1 from public.mail_uploads u where u.id=resource
  and (hash is null or u.content_hash=hash) and s01_i02.can_content(u.opportunity_id,u.access_area))
 when 'legacy' then exists(select 1 from public.message_attachments a where a.id=resource and s01_i02.can_message(a.message_id))
 else false end
$$;

-- New writes derive scope from verified source or current phase, never payload.
-- Legacy rows remain NULL unless an immutable source proves the exact hash.
update public.document_versions v set access_area=f.area from public.gmail_saved_attachments f
 where v.source_gmail_file_id=f.id and v.content_hash=f.content_hash
 and exists(select 1 from public.documents d where d.id=v.document_id and d.opportunity_id=f.opportunity_id);
update public.documents d set access_area=v.access_area from public.document_versions v
 where v.document_id=d.id and v.content_hash=d.content_hash and v.access_area is not null;

create function s01_i02.scope_content() returns trigger language plpgsql security definer set search_path='' as $$
declare case_id uuid;derived public.case_area;source_case uuid;
begin
 if tg_table_name='document_versions' then
  if tg_op='UPDATE' then
   if (new.document_id,new.content_hash,new.storage_path,new.access_area) is distinct from
      (old.document_id,old.content_hash,old.storage_path,old.access_area) then raise exception 'Immutable content version';end if;
   if new.source_gmail_file_id is distinct from old.source_gmail_file_id and old.source_gmail_file_id is not null
    or new.source_attachment_id is distinct from old.source_attachment_id and old.source_attachment_id is not null then raise exception 'Immutable content source';end if;
   select opportunity_id into case_id from public.documents where id=new.document_id;
   if new.source_gmail_file_id is not null then
    select opportunity_id,area into source_case,derived from public.gmail_saved_attachments where id=new.source_gmail_file_id and content_hash=new.content_hash;
    if source_case is distinct from case_id or (derived='closer' and new.access_area is distinct from 'closer') then raise exception 'Content source mismatch';end if;
   end if;
   if new.source_attachment_id is not null then
    select c.opportunity_id,m.area into source_case,derived from public.message_attachments a join public.messages m on m.id=a.message_id join public.conversations c on c.id=m.conversation_id where a.id=new.source_attachment_id;
    if source_case is distinct from case_id or (derived='closer' and new.access_area is distinct from 'closer') then raise exception 'Content source mismatch';end if;
   end if;
   return new;
  end if;
  select opportunity_id into case_id from public.documents where id=new.document_id;
  if new.source_gmail_file_id is not null then
   select opportunity_id,area into source_case,derived from public.gmail_saved_attachments
    where id=new.source_gmail_file_id and content_hash=new.content_hash;
   if source_case is distinct from case_id then raise exception 'Content source mismatch';end if;
  elsif new.source_attachment_id is not null then
   select c.opportunity_id,m.area into source_case,derived from public.message_attachments a join public.messages m on m.id=a.message_id join public.conversations c on c.id=m.conversation_id where a.id=new.source_attachment_id;
   if source_case is distinct from case_id then raise exception 'Content source mismatch';end if;
  else derived:=s01_i02.phase(case_id);end if;
  new.access_area:=derived;
 elsif tg_table_name='documents' then
  if tg_op='UPDATE' and new.opportunity_id is distinct from old.opportunity_id then raise exception 'Immutable document case';end if;
  if tg_op='UPDATE' and (new.storage_path,new.content_hash) is not distinct from (old.storage_path,old.content_hash) then
   new.access_area:=old.access_area;return new;
  end if;
  select access_area into derived from public.document_versions where document_id=new.id and content_hash=new.content_hash;
  new.access_area:=coalesce(derived,s01_i02.phase(new.opportunity_id));
 else
  if tg_op='UPDATE' then
   if (new.opportunity_id,new.uploaded_by,new.storage_path,new.content_hash,new.access_area) is distinct from
      (old.opportunity_id,old.uploaded_by,old.storage_path,old.content_hash,old.access_area) then raise exception 'Immutable mail upload';end if;
   return new;
  end if;
  new.access_area:=s01_i02.phase(new.opportunity_id);
  if not s01_i02.actor_can_write(new.uploaded_by,new.opportunity_id,new.access_area) then raise exception 'Case and area access required';end if;
 end if;
 return new;
end $$;
create trigger s01_i02_scope before insert or update on public.documents for each row execute function s01_i02.scope_content();
create trigger s01_i02_scope before insert or update on public.document_versions for each row execute function s01_i02.scope_content();
create trigger s01_i02_scope before insert or update on public.mail_uploads for each row execute function s01_i02.scope_content();
create index s01_i02_events_archive on public.case_events(archive_message_id,opportunity_id,area) where archive_message_id is not null;
create index s01_i02_messages_archive on public.messages(archive_message_id,conversation_id,area) where archive_message_id is not null;

-- Explicit per-source bounds are restrictive: permissive policies cannot OR past them.
drop policy shared_mail_files on public.gmail_saved_attachments;
drop policy shared_mail_events on public.case_events;
drop policy shared_mail_waits on public.mail_waits;
drop policy shared_mail_tasks on public.tasks;
create policy s01_i02_bound on public.conversations as restrictive for select to authenticated using(s01_i02.can_conversation(id));
create policy s01_i02_bound on public.messages as restrictive for select to authenticated using(s01_i02.can_message(id));
create policy s01_i02_bound on public.conversation_lenders as restrictive for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and public.can_area(c.opportunity_id,'closer')));
create policy s01_i02_bound on public.gmail_saved_attachments as restrictive for select to authenticated using(public.can_area(opportunity_id,area));
create policy s01_i02_bound on public.case_events as restrictive for select to authenticated using(public.can_area(opportunity_id,area));
create policy s01_i02_bound on public.mail_waits as restrictive for select to authenticated using(public.can_area(opportunity_id,area));
create policy s01_i02_bound on public.tasks as restrictive for select to authenticated using(public.can_area(opportunity_id,area));
create policy s01_i02_bound on public.documents as restrictive for select to authenticated using(s01_i02.can_source('document',id));
-- Replace the parent-current-version policy: historical versions have their own scope.
drop policy document_versions_read on public.document_versions;
create policy document_versions_read on public.document_versions for select to authenticated using(s01_i02.can_source('version',id));
drop policy document_reviews_read on public.document_reviews;
create policy document_reviews_read on public.document_reviews for select to authenticated using(s01_i02.can_source('document',document_id,content_hash));
create policy s01_i02_bound on public.mail_uploads as restrictive for select to authenticated using(s01_i02.can_source('upload',id));
create policy s01_i02_bound on public.mail_drafts as restrictive for all to authenticated
 using(public.can_edit_case(opportunity_id) and public.can_area(opportunity_id,s01_i02.visible_phase(opportunity_id)))
 with check(public.can_edit_case(opportunity_id) and public.can_area(opportunity_id,s01_i02.visible_phase(opportunity_id)));
create policy s01_i02_bound on public.financing_processes as restrictive for select to authenticated
 using(public.can_area(opportunity_id,'closer'));
create policy s01_i02_bound on public.mail_review as restrictive for select to authenticated using(
 public.current_app_role() is not null and not exists(select 1 from public.gmail_archive_messages m where m.account_id=mail_review.account_id and m.gmail_message_id=mail_review.gmail_message_id and not s01_i02.can_archive(m.id)));
create policy s01_i02_bound on storage.objects as restrictive for select to authenticated using(
 bucket_id<>'case-documents' or exists(select 1 from public.documents d where d.storage_path=storage.objects.name and s01_i02.can_source('document',d.id))
 or exists(select 1 from public.document_versions v where v.storage_path=storage.objects.name and s01_i02.can_source('version',v.id)));
create policy s01_i02_versions_read on storage.objects for select to authenticated using(
 bucket_id='case-documents' and exists(select 1 from public.document_versions v where v.storage_path=storage.objects.name and s01_i02.can_source('version',v.id)));

-- Only stable identity columns are readable on the mixed raw thread.
revoke select on public.conversations from authenticated;
grant select(id,opportunity_id,account_id) on public.conversations to authenticated;

create function s01_i02.visible_conversations() returns table(
 id uuid,opportunity_id uuid,submission_id uuid,account_id uuid,gmail_thread_id text,subject text,area public.case_area,
 needs_attention boolean,updated_at timestamptz,process_id uuid,recipient_email text,inbox_activated_at timestamptz,
 manually_incorporated_at timestamptz,gmail_delivery_thread_id text,can_reply boolean)
language sql stable security definer set search_path='' as $$
 select c.id,c.opportunity_id,case when public.can_area(c.opportunity_id,'closer') then c.submission_id end,c.account_id,
 c.gmail_thread_id,case when public.can_area(c.opportunity_id,'closer') then c.subject else
 coalesce((select a.subject from public.gmail_archive_messages a where a.id=m.archive_message_id),
 (select x.subject from public.outbox x where x.message_id_header=m.internet_message_id and x.conversation_id=c.id and public.can_area(x.opportunity_id,x.area) limit 1),'Conversation') end,
 coalesce(m.area,c.area),coalesce(m.direction='inbound',false),
 m.sent_at,case when public.can_area(c.opportunity_id,'closer') then c.process_id end,
 (select p->>'email' from jsonb_array_elements(coalesce(m.participants,'[]')) p where p->>'role'='to' limit 1),
 null::timestamptz,null::timestamptz,null::text,
 public.can_edit_case(c.opportunity_id) and public.can_area(c.opportunity_id,s01_i02.phase(c.opportunity_id))
 from public.conversations c left join lateral (
 select x.* from public.messages x where x.conversation_id=c.id and public.can_area(c.opportunity_id,x.area)
 order by x.sent_at desc,x.id desc limit 1) m on true
 where s01_i02.can_conversation(c.id)
$$;
create view public.mail_conversations_visible with(security_invoker=true) as select * from s01_i02.visible_conversations();
grant select on public.mail_conversations_visible to authenticated,service_role;
create policy s01_i02_bound on public.gmail_thread_links as restrictive for select to authenticated using(
 exists(select 1 from public.mail_conversations_visible c where c.opportunity_id=gmail_thread_links.opportunity_id
 and c.account_id=gmail_thread_links.account_id and c.gmail_thread_id=gmail_thread_links.gmail_thread_id));

create function s01_i02.visible_processes() returns setof public.financing_processes
language plpgsql stable security definer set search_path='' as $$
declare p public.financing_processes;visible_date timestamptz;previous_case uuid;sequence int:=0;
begin
 for p in select x.* from public.financing_processes x where public.can_case(x.opportunity_id)
 and (public.can_area(x.opportunity_id,'closer')
 or exists(select 1 from public.case_events e where e.process_id=x.id and public.can_area(e.opportunity_id,e.area))
 or exists(select 1 from public.conversations c join public.messages m on m.conversation_id=c.id where c.process_id=x.id and public.can_area(c.opportunity_id,m.area)))
 order by x.opportunity_id,x.id loop
  if not public.can_area(p.opportunity_id,'closer') then
   if previous_case is distinct from p.opportunity_id then sequence:=0;end if;
   sequence:=sequence+1;previous_case:=p.opportunity_id;
   select min(v.at) into visible_date from (
    select e.occurred_at at from public.case_events e where e.process_id=p.id and public.can_area(e.opportunity_id,e.area)
    union all select m.sent_at from public.messages m join public.conversations c on c.id=m.conversation_id where c.process_id=p.id and public.can_area(c.opportunity_id,m.area)) v;
   p.sequence_number:=sequence;p.started_at:=visible_date;p.created_at:=visible_date;
   p.label:='Process';p.classification:='unknown';p.state:='unclassified';p.is_unclassified_archive:=true;
   p.ended_at:=null;p.source_run_id:=null;p.actual_funded_amount:=null;p.funded_lender_id:=null;p.request_key:=null;
  end if;
  return next p;
 end loop;
end $$;
create view public.mail_processes_visible with(security_invoker=true) as select * from s01_i02.visible_processes();
grant select on public.mail_processes_visible to authenticated,service_role;

create function s01_i02.visible_archive() returns setof public.gmail_archive_messages
language sql stable security definer set search_path='' as $$
 select m.* from public.gmail_archive_messages m where s01_i02.can_archive(m.id)
$$;
create view public.mail_archive_visible with(security_invoker=true) as select * from s01_i02.visible_archive();
grant select on public.mail_archive_visible to authenticated,service_role;

create function public.mail_access_context(case_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when public.can_case(case_id) then jsonb_build_object('area',s01_i02.phase(case_id),'can_write',
 public.can_edit_case(case_id) and public.can_area(case_id,s01_i02.phase(case_id))) end
$$;
create function public.mail_source_allowed(source text,resource uuid,hash text default null) returns boolean
language sql stable security definer set search_path='' as $$ select s01_i02.can_source(source,resource,hash) $$;

-- The worker has no human JWT. Only this private predicate accepts a recorded actor.
create function s01_i02.actor_can_read(actor uuid,case_id uuid,area public.case_area) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.opportunities o on o.id=case_id where p.id=actor and p.active
 and (o.email_qualified_at is not null or o.historical_approved_at is not null)
 and (p.role='superadmin' or (area is not null and (area<>'closer' or p.role in ('closer_admin','closer'))
 and (p.role='seller_admin' or (p.role='seller' and o.seller_id=p.id)
 or (p.role='closer_admin' and o.handed_off_at is not null) or (p.role='closer' and o.closer_id=p.id)))))
$$;
create function s01_i02.actor_can_write(actor uuid,case_id uuid,area public.case_area,account uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.opportunities o on o.id=case_id where p.id=actor and p.active
 and o.archived_at is null and (o.email_qualified_at is not null or o.historical_approved_at is not null)
 and (p.role='superadmin' or (
  (case when o.handed_off_at is null then p.role in ('seller_admin','seller') else p.role in ('closer_admin','closer') end)
  and (p.role in ('seller_admin','closer_admin') or (p.role='seller' and o.seller_id=p.id) or (p.role='closer' and o.closer_id=p.id))
  and (area<>'closer' or p.role in ('closer_admin','closer'))))
 and (account is null or p.role='superadmin' or exists(select 1 from public.mail_permissions x where x.user_id=p.id and x.account_id=account and x.can_send)))
$$;
create function s01_i02.actor_notification_allowed(actor uuid,event text) returns boolean
language sql stable security definer set search_path='' as $$
 select case when event like 'document:%' then exists(
  select 1 from public.documents d where d.id=nullif(split_part(event,':',2),'')::uuid
  and (d.content_hash=split_part(event,':',3) and s01_i02.actor_can_read(actor,d.opportunity_id,d.access_area)
   or exists(select 1 from public.document_versions v where v.document_id=d.id and v.content_hash=split_part(event,':',3) and s01_i02.actor_can_read(actor,d.opportunity_id,v.access_area))))
 when event like 'overdue:%' then exists(select 1 from public.tasks t where t.id=nullif(split_part(event,':',2),'')::uuid and s01_i02.actor_can_read(actor,t.opportunity_id,t.area))
 else exists(select 1 from public.profiles p where p.id=actor and p.active) end
$$;
create function s01_i02.visible_notification(event text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.current_app_role() is not null and s01_i02.actor_notification_allowed(auth.uid(),event)
$$;
create policy s01_i02_bound on public.notifications as restrictive for select to authenticated using(s01_i02.visible_notification(event_key));
create function s01_i02.assert_write(case_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.can_edit_case(case_id) and public.can_area(case_id,s01_i02.phase(case_id)),false) then
  raise exception 'Case and area access required';end if;
end $$;
create function s01_i02.assert_sources(case_id uuid,files uuid[],gmail_files uuid[],uploads uuid[],reply uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform s01_i02.assert_write(case_id);
 if exists(select 1 from unnest(files) f where not s01_i02.can_source('document',f))
 or exists(select 1 from unnest(gmail_files) f where not s01_i02.can_source('saved',f))
 or exists(select 1 from unnest(uploads) f where not s01_i02.can_source('upload',f))
 or (reply is not null and not s01_i02.can_message(reply)) then raise exception 'Case attachments or message access required';end if;
end $$;
create function s01_i02.actor_snapshot_allowed(actor uuid,case_id uuid,s jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.document_versions v join public.documents d on d.id=v.document_id where d.id::text=s->>'id' and d.opportunity_id=case_id and v.content_hash=s->>'content_hash' and v.storage_path=s->>'storage_path' and coalesce(s->>'bucket','case-documents')='case-documents' and s01_i02.actor_can_read(actor,d.opportunity_id,v.access_area))
 or exists(select 1 from public.documents d where d.id::text=s->>'id' and d.opportunity_id=case_id and d.content_hash=s->>'content_hash' and d.storage_path=s->>'storage_path' and coalesce(s->>'bucket','case-documents')='case-documents' and s01_i02.actor_can_read(actor,d.opportunity_id,d.access_area))
 or exists(select 1 from public.gmail_saved_attachments g where g.id::text=s->>'id' and g.opportunity_id=case_id and g.content_hash=s->>'content_hash' and g.storage_path=s->>'storage_path' and coalesce(s->>'bucket','gmail-documents')='gmail-documents' and s01_i02.actor_can_read(actor,g.opportunity_id,g.area))
 or exists(select 1 from public.mail_uploads u where u.id::text=s->>'id' and u.opportunity_id=case_id and u.content_hash=s->>'content_hash' and u.storage_path=s->>'storage_path' and coalesce(s->>'bucket','gmail-documents')='gmail-documents' and s01_i02.actor_can_read(actor,u.opportunity_id,u.access_area))
$$;
create function s01_i02.delivery_allowed(message uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare m public.outbox;s jsonb;f uuid;
begin
 select * into m from public.outbox where id=message;
 if m.id is null then return false;end if;
 if m.opportunity_id is null then return true;end if;
 if not s01_i02.actor_can_write(m.requested_by,m.opportunity_id,m.area,m.account_id) then return false;end if;
 if jsonb_typeof(coalesce(m.attachment_snapshot,'[]'))<>'array' then return false;end if;
 for s in select value from jsonb_array_elements(coalesce(m.attachment_snapshot,'[]')) loop
  if not s01_i02.actor_snapshot_allowed(m.requested_by,m.opportunity_id,s) then return false;end if;
 end loop;
 if jsonb_array_length(coalesce(m.attachment_snapshot,'[]'))=0 then
  foreach f in array coalesce(m.attachment_ids,'{}') loop
   if not exists(select 1 from public.documents d where d.id=f and d.opportunity_id=m.opportunity_id and s01_i02.actor_can_read(m.requested_by,d.opportunity_id,d.access_area)) then return false;end if;
  end loop;
  foreach f in array coalesce(m.gmail_file_ids,'{}') loop
   if not exists(select 1 from public.gmail_saved_attachments g where g.id=f and g.opportunity_id=m.opportunity_id and s01_i02.actor_can_read(m.requested_by,g.opportunity_id,g.area)) then return false;end if;
  end loop;
  foreach f in array coalesce(m.upload_ids,'{}') loop
   if not exists(select 1 from public.mail_uploads u where u.id=f and u.opportunity_id=m.opportunity_id and s01_i02.actor_can_read(m.requested_by,u.opportunity_id,u.access_area)) then return false;end if;
  end loop;
 end if;
 return true;
end $$;

create function public.mail_document_write_allowed(document_id uuid,acting_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.documents d where d.id=document_id and s01_i02.actor_can_write(acting_user,d.opportunity_id,s01_i02.phase(d.opportunity_id)))
$$;

-- Insert guards into the effective definitions, retaining existing validation,
-- idempotency, quota/campaign controls and signatures. Baseline is checked first.
CREATE OR REPLACE FUNCTION public.associate_live_mail(review uuid, case_id uuid, process uuid, submission uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source public.mail_review;
begin
 perform s01_i02.assert_write(case_id);if submission is not null and not coalesce(public.can_area(case_id,'closer'),false) then raise exception 'Closer area access required';end if;
 select * into source from public.mail_review where id=review;
 perform public.associate_live_mail_v23(review,case_id,process,submission);
 update public.conversations c set manually_incorporated_at=now() from public.gmail_archive_messages m
 where m.account_id=source.account_id and m.gmail_message_id=source.gmail_message_id and c.account_id=m.account_id and c.gmail_thread_id=m.gmail_thread_id and c.opportunity_id=case_id
 and exists(select 1 from jsonb_array_elements(m.participants) p where p->>'role'='from' and not public.mail_is_team(p->>'email') and public.mail_lender_for(p->>'email') is null);
 perform public.gmail_refresh_inbox(c.id) from public.conversations c where c.opportunity_id=case_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.associate_live_mail_v23(review uuid, case_id uuid, process uuid, submission uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.mail_review;m public.gmail_archive_messages;
begin
 perform s01_i02.assert_write(case_id);if submission is not null and not coalesce(public.can_area(case_id,'closer'),false) then raise exception 'Closer area access required';end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.case_document_command_internal(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); o public.opportunities; doc public.documents;
 receipt public.command_receipts; result jsonb; source_case uuid; linked uuid;
 area public.case_area; target uuid; file_hash text; file_path text; source_kind text;
begin
 perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if p->>'source_id' is not null and not s01_i02.can_source(p->>'source',(p->>'source_id')::uuid) then raise exception 'Source access required';end if;
 if actor is null or public.current_app_role() is null then raise exception 'Invitation and MFA required'; end if;
 if request_key is null then raise exception 'Idempotency key required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,0));
 select * into receipt from public.command_receipts r where r.user_id=actor and r.request_key=case_document_command_internal.request_key;
 if found then
  if receipt.kind<>kind or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused with different input'; end if;
  if not public.can_edit_case((receipt.result->>'opportunity_id')::uuid) then raise exception 'Case is inaccessible or read-only'; end if;
  return receipt.result;
 end if;
 select * into o from public.opportunities where id=(p->>'opportunity_id')::uuid for update;
 if o.id is null or not public.can_edit_case(o.id) then raise exception 'Case is inaccessible or read-only'; end if;
 area:=case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end;
 target:=(p->>'document_id')::uuid;
 select * into doc from public.documents where id=target and opportunity_id=o.id for update;
 if doc.id is null then raise exception 'Document belongs to another opportunity'; end if;
 if kind='incorporate_document' then
  source_kind:=p->>'source';
  if source_kind='legacy' then
   select c.opportunity_id,a.imported_document_id into source_case,linked
    from public.message_attachments a join public.messages m on m.id=a.message_id
    join public.conversations c on c.id=m.conversation_id
    where a.id=(p->>'source_id')::uuid and public.can_area(c.opportunity_id,coalesce(m.area,c.area)) for update of a;
  elsif source_kind='saved' then
   select f.opportunity_id,f.imported_document_id into source_case,linked from public.gmail_saved_attachments f
    where f.id=(p->>'source_id')::uuid and public.can_area(f.opportunity_id,f.area) for update of f;
  else raise exception 'Unknown document source'; end if;
  if source_case is distinct from o.id then raise exception 'Attachment belongs to another opportunity'; end if;
  if linked is not null and linked<>doc.id then raise exception 'Attachment already incorporated into another document'; end if;
  file_hash:=p->>'content_hash';file_path:=p->>'storage_path';
  if file_hash !~ '^[a-f0-9]{64}$' or file_path !~ ('^'||o.id::text||'/'||doc.id::text||'/'||file_hash||'[.](pdf|jpg|png)$')
   or not exists(select 1 from storage.objects where bucket_id='case-documents' and name=file_path) then raise exception 'Uploaded document required'; end if;
  -- A retry of the same incorporation must not revoke a later approval.
  if linked is null or doc.content_hash is distinct from file_hash then
   if doc.content_hash is distinct from nullif(p->>'expected_hash','') then raise exception 'Document changed; reopen the review'; end if;
   perform public.register_document(doc.id,file_path,file_hash,'conversation',actor);
  end if;
  update public.document_versions set
   source_attachment_id=case when source_kind='legacy' then (p->>'source_id')::uuid else source_attachment_id end,
   source_gmail_file_id=case when source_kind='saved' then (p->>'source_id')::uuid else source_gmail_file_id end
   where document_id=doc.id and content_hash=file_hash;
  if source_kind='legacy' then update public.message_attachments set imported_document_id=doc.id where id=(p->>'source_id')::uuid;
  else update public.gmail_saved_attachments set imported_document_id=doc.id where id=(p->>'source_id')::uuid; end if;
 elsif kind='review_document' then
  if doc.kind='application' and p->>'status'='approved' and doc.source='company_application' and not o.application_signed then raise exception 'A signed application is required; this PDF is an unsigned draft';end if;
  if doc.kind='application' and p->>'status'='approved' then update public.opportunities set application_complete=true,application_signed=true where id=o.id;end if;

  if doc.storage_path is null or doc.content_hash is null then raise exception 'Received document required'; end if;
  if doc.content_hash is distinct from p->>'expected_hash' then raise exception 'Document changed; reopen the review'; end if;
  if p->>'status' not in ('received','approved','correction') then raise exception 'Invalid review status'; end if;
  if length(coalesce(p->>'notes',''))>4000 then raise exception 'Review notes too long'; end if;
  if p->>'status'='correction' and coalesce(btrim(p->>'notes'),'')='' then raise exception 'Explain the requested correction'; end if;
  if coalesce(p->>'period',doc.period)<>doc.period and doc.kind='bank_statement' then
   if coalesce(p->>'period','')<>'' and p->>'period' !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Statement month required'; end if;
  end if;
  update public.documents set status=p->>'status',period=coalesce(p->>'period',doc.period),review_notes=coalesce(p->>'notes',''),
   reviewed_by=actor,reviewed_at=now() where id=doc.id;
  insert into public.document_reviews(document_id,content_hash,status,notes,reviewer_id,period)
   values(doc.id,doc.content_hash,p->>'status',coalesce(p->>'notes',''),actor,coalesce(p->>'period',doc.period));
  insert into public.activities(opportunity_id,actor_id,type,area,body)
   values(o.id,actor,'document',area,doc.name||': '||(p->>'status')||case when coalesce(p->>'notes','')<>'' then ' — '||(p->>'notes') else '' end);
 else raise exception 'Unknown document action'; end if;
 result:=jsonb_build_object('document_id',doc.id,'opportunity_id',o.id);
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata)
 values(actor,'document',doc.id,kind,jsonb_build_object('content_hash',coalesce(file_hash,doc.content_hash),'status',p->>'status','source_id',p->>'source_id'));
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request_key,kind,result,md5(p::text));
 return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_outbox()
 RETURNS SETOF outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare msg public.outbox;
begin
 update public.outbox set status='paused',last_error='AREA_ACCESS_REVOKED' where status='queued' and opportunity_id is not null and not s01_i02.delivery_allowed(id);
 update public.outbox x set available_at=a.send_retry_at from public.mail_accounts a where x.account_id=a.id and x.status='queued' and a.send_retry_at>now() and x.available_at<a.send_retry_at;
 select * into msg from public.claim_outbox_v7();
 if msg.id is null then return; end if;
 if not exists(select 1 from public.opportunities where id=msg.opportunity_id and (email_qualified_at is not null or historical_approved_at is not null)) then update public.outbox set status='paused' where id=msg.id;return;end if;
 return query update public.outbox set send_attempts=send_attempts+1 where id=msg.id returning *;
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_outbox_v15()
 RETURNS SETOF outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare msg public.outbox;
begin
 update public.outbox set status='paused',last_error='AREA_ACCESS_REVOKED' where status='queued' and opportunity_id is not null and not s01_i02.delivery_allowed(id);
 select * into msg from public.claim_outbox_v7();
 if msg.id is null then return; end if;
 if not exists(select 1 from public.opportunities where id=msg.opportunity_id and email_qualified_at is not null) then
  update public.outbox set status='paused' where id=msg.id;
  return;
 end if;
 return next msg;
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_outbox_v7()
 RETURNS SETOF outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare msg public.outbox; account public.mail_accounts; campaign public.campaigns; enrollment public.campaign_enrollments; contact public.contacts; actor public.profiles; o public.opportunities; sent_count int; local_start timestamptz;
begin
 update public.outbox set status='paused',last_error='AREA_ACCESS_REVOKED' where status='queued' and opportunity_id is not null and not s01_i02.delivery_allowed(id);
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
  if contact.id=any(campaign.excluded_contact_ids) or o.stage in ('lost','paused','funded') or enrollment.status<>'active' or contact.verification<>'valid' or o.handed_off_at is not null or (o.application_complete and campaign.requires_application) then update public.outbox set status='cancelled' where id=msg.id; return; end if;
  if campaign.status<>'active' or extract(hour from now() at time zone campaign.timezone)<campaign.start_hour or extract(hour from now() at time zone campaign.timezone)>=campaign.end_hour then update public.outbox set available_at=now()+interval '10 minutes' where id=msg.id; return; end if;
  if actor.role not in ('superadmin','seller_admin') then update public.outbox set status='paused' where id=msg.id; return; end if;
  select count(*) into sent_count from public.outbox x join public.campaign_enrollments e on x.enrollment_id=e.id where e.campaign_id=campaign.id and x.status in ('sent','sending','uncertain') and coalesce(x.sent_at,x.sending_at)>now()-interval '24 hours';
  if account.external_usage_synced_at is null or account.external_usage_synced_at<now()-interval '15 minutes' then update public.outbox set available_at=now()+interval '1 minute',last_error='GMAIL_USAGE_STALE' where id=msg.id;return;end if; if sent_count>=campaign.daily_limit or (public.account_delivery_usage(account.id)->>'campaign_remaining')::int<=0 then update public.outbox set available_at=now()+interval '1 hour' where id=msg.id; return; end if;
 else
  if not (actor.role='superadmin' or actor.role='seller_admin' or (actor.role='closer_admin' and o.handed_off_at is not null) or (actor.role='seller' and o.seller_id=actor.id) or (actor.role='closer' and o.closer_id=actor.id)) then update public.outbox set status='cancelled' where id=msg.id; return; end if;
 end if;
 local_start:=now()-interval '24 hours';
 select count(*) into sent_count from public.outbox where account_id=account.id and status in ('sent','sending','uncertain') and coalesce(sent_at,sending_at)>=local_start;
 if (public.account_delivery_usage(account.id)->>'total_messages')::int>=account.daily_limit or (public.account_delivery_usage(account.id)->>'recipient_count')::int+1+coalesce(cardinality(msg.cc_emails),0)+coalesce(cardinality(msg.bcc_emails),0)>2000 or exists(select 1 from public.outbox where account_id=account.id and sending_at>now()-interval '30 seconds') then update public.outbox set available_at=now()+interval '1 minute' where id=msg.id; return; end if;
 return query update public.outbox set status='sending',sending_at=now() where id=msg.id returning *;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_command(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.campaigns;r jsonb;receipt public.command_receipts;ids uuid[];a record;original jsonb:=p;
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if kind not in ('create_campaign','activate_campaign','schedule_campaign','pause_campaign') then return public.crm_command_v42_first_contact(kind,p,request_key);end if;
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') or request_key is null then raise exception 'Campaign administrator and MFA required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts cr where cr.user_id=auth.uid() and cr.request_key=crm_command.request_key;
 if receipt.user_id is not null then
  if receipt.kind<>kind or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused';end if;return receipt.result;
 end if;
 if kind='create_campaign' then
  if coalesce(btrim(p->>'name'),'')='' or length(p->>'name')>200 then raise exception 'Campaign name required';end if;
  r:=public.crm_command_v42_first_contact(kind,p,request_key);
  update public.campaigns set steps='[]',first_contact=true,batch_id=null,
   requires_application=(subject||body) ~ '\{\{\s*application_url\s*\}\}' where id=(r->>'id')::uuid returning * into c;
  if p ? 'selected_contact_ids' then
   if jsonb_typeof(p->'selected_contact_ids')<>'array' or jsonb_array_length(p->'selected_contact_ids')>5000 then raise exception 'Invalid lead selection';end if;
   ids:=array(select distinct value::uuid from jsonb_array_elements_text(p->'selected_contact_ids'));
   if exists(select 1 from unnest(ids) id where not exists(select 1 from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) x where x.contact_id=id and x.reason='eligible')) then raise exception 'Selecciona solo leads elegibles / Select eligible leads only';end if;
  else
   ids:=array(select x.contact_id from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) x where x.reason='eligible' limit 5000);
  end if;
  -- A draft may be saved before leads are ready; activation always needs recipients.
  update public.campaigns set selected_contact_ids=ids where id=c.id;
  return r;
 end if;
 select * into c from public.campaigns where id=(p->>'id')::uuid for update;
 if c.id is null or not coalesce(public.can_send(c.account_id),false) then raise exception 'Campaign and sender access required';end if;
 if kind='pause_campaign' or not c.first_contact then
  if kind='schedule_campaign' then raise exception 'Schedule first-contact campaigns only';end if;
  r:=public.crm_command_v42_first_contact(kind,p,request_key);
  if kind='activate_campaign' then update public.campaigns set activated_at=coalesce(activated_at,now()) where id=c.id;end if;
  return r;
 end if;
 if c.status not in ('draft','paused') then raise exception 'Campaign must be draft or paused';end if;
 if not exists(select 1 from public.mail_accounts where id=c.account_id and status='connected') then raise exception 'Gmail account disconnected';end if;
 if kind='schedule_campaign' and (nullif(p->>'scheduled_at','') is null or (p->>'scheduled_at')::timestamptz<=now()) then raise exception 'Choose a future date and time';end if;
 -- Lock the selected contacts, then repeat all eligibility checks transactionally.
 perform 1 from public.contacts where id=any(c.selected_contact_ids) order by id for update;
 if exists(select 1 from public.campaign_audience(c.id) x where x.reason='missing_data') then raise exception 'Hay leads con datos faltantes';end if;
 if not exists(select 1 from public.campaign_audience(c.id) x where x.reason='eligible' and not exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id and e.contact_id=x.contact_id and e.status not in ('active','paused'))) then raise exception 'No hay destinatarios elegibles';end if;
 for a in select * from public.campaign_audience(c.id) where reason='eligible' loop
  insert into public.campaign_enrollments(campaign_id,contact_id,opportunity_id,next_at)
  values(c.id,a.contact_id,a.opportunity_id,case when kind='schedule_campaign' then (p->>'scheduled_at')::timestamptz else now() end)
  on conflict(campaign_id,contact_id) do update set status='active' where campaign_enrollments.status='paused';
  update public.opportunities set seller_id=c.seller_id,campaign_id=c.id where id=a.opportunity_id;
 end loop;
 update public.campaigns set status='active',activated_at=case when kind='schedule_campaign' then null else coalesce(activated_at,now()) end,scheduled_at=case when kind='schedule_campaign' then (p->>'scheduled_at')::timestamptz else null end where id=c.id;
 r:=jsonb_build_object('id',c.id);
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request_key,kind,r,md5(original::text));
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'campaign',c.id,kind);
 return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_command_v18(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); role public.app_role:=public.current_app_role(); receipt public.command_receipts;
 c public.contacts; l public.leads; target uuid; company_id uuid; email text; result jsonb; queued int:=0;
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if role is null or actor is null then raise exception 'Invitation and MFA required'; end if;
 if request_key is null then raise exception 'Idempotency key required'; end if;
 if kind not in ('create_lead','verify_contacts','create_opportunity') then return public.crm_command_v7(kind,p,request_key); end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,0));
 select * into receipt from public.command_receipts r where r.user_id=actor and r.request_key=crm_command_v18.request_key;
 if found then
  if receipt.kind<>kind or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused with different input'; end if;
  return receipt.result;
 end if;
 if kind='create_opportunity' then
  select * into c from public.contacts where contacts.email=lower(btrim(p->>'email')) for update;
  if c.id is null or c.verification<>'valid' or not (role in ('superadmin','seller_admin') or exists(select 1 from public.leads ld where ld.contact_id=c.id and public.can_lead(ld.id)) or exists(select 1 from public.opportunities o where o.contact_id=c.id and public.can_case(o.id))) then
   raise exception 'Verify the lead email before creating an opportunity';
  end if;
  return public.crm_command_v7(kind,p,request_key);
 elsif kind='create_lead' then
  if role not in ('superadmin','seller_admin','seller') then raise exception 'Seller access required'; end if;
  email:=lower(btrim(p->>'email'));
  if email is null or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(btrim(p->>'company'),'')='' or coalesce(btrim(p->>'contact'),'')='' then raise exception 'Valid contact and company required'; end if;
  target:=case when role='seller' then actor else (p->>'seller_id')::uuid end;
  if not exists(select 1 from public.profiles where id=target and active and profiles.role in ('superadmin','seller_admin','seller')) then raise exception 'Invalid seller'; end if;
  perform pg_advisory_xact_lock(hashtextextended(email,1));
  select * into c from public.contacts where contacts.email=email;
  if c.id is not null then
   select * into l from public.leads where contact_id=c.id;
   if l.id is null or not public.can_lead(l.id) then raise exception 'Contact already exists; ask your administrator'; end if;
  else
   insert into public.companies(name) values(p->>'company') returning id into company_id;
   insert into public.contacts(company_id,email,name,phone) values(company_id,email,p->>'contact',coalesce(p->>'phone','')) returning * into c;
   insert into public.leads(contact_id,company_id,company,industry,product,amount,seller_id,next_action,next_action_at)
   values(c.id,c.company_id,p->>'company',coalesce(p->>'industry',''),coalesce(p->>'product','Business loan'),coalesce((p->>'amount')::numeric,0),target,coalesce(p->>'next_action',''),nullif(p->>'next_action_at','')::timestamptz) returning * into l;
  end if;
  result:=jsonb_build_object('ok',true,'id',l.id,'opportunity_id',l.opportunity_id);
 else
  if role not in ('superadmin','seller_admin') then raise exception 'Seller administrator required'; end if;
  for target in select distinct value::uuid from jsonb_array_elements_text(p->'contact_ids') loop
   if not exists(select 1 from public.leads ld where ld.contact_id=target and public.can_lead(ld.id)) then raise exception 'Lead is inaccessible'; end if;
   if exists(select 1 from public.contacts ct where ct.id=target and ct.verification in ('pending','uncertain')) and
      not exists(select 1 from public.suppressions s join public.contacts ct on ct.email=s.email where ct.id=target) then
    insert into public.verifications(contact_id,request_key,result) values(target,request_key||':'||target,'pending') on conflict do nothing;
    if found then queued:=queued+1; end if;
   end if;
  end loop;
  if queued>0 then insert into public.jobs(kind,payload,dedupe_key) values('scrub','{}','scrub:'||request_key) on conflict do nothing; end if;
  result:=jsonb_build_object('ok',true,'queued',queued);
 end if;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(actor,kind,l.id,kind,jsonb_build_object('request_key',request_key));
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request_key,kind,result,md5(p::text));
 return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_command_v20(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare address text;
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if auth.uid() is null or public.current_app_role() is null then raise exception 'Invitation and MFA required';end if;
 if kind='create_lead' then
  address:=lower(btrim(p->>'email'));
  perform pg_advisory_xact_lock(hashtextextended(address,1));
  if not exists(select 1 from public.command_receipts r where r.user_id=auth.uid() and r.request_key=crm_command_v20.request_key)
     and not exists(select 1 from public.contacts where email=address)
     and exists(select 1 from public.gmail_known_emails where email=address) then
   raise exception 'Este correo ya aparece en el historial de Gmail. Revisa su importación pendiente con el administrador antes de crear otro lead.';
  end if;
 end if;
 return public.crm_command_v18(kind,p,request_key);
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_command_v24_documents(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if auth.uid() is null or public.current_app_role() is null then raise exception 'Invitation and MFA required';end if;
 if kind='create_lead' then
  perform pg_advisory_xact_lock(hashtextextended(lower(btrim(p->>'email')),1));
  if public.gmail_live_only_address(lower(btrim(p->>'email'))) then return public.crm_command_v18(kind,p,request_key);end if;
 end if;
 if kind='create_opportunity' and not exists(select 1 from public.command_receipts r where r.user_id=auth.uid() and r.request_key=crm_command_v24_documents.request_key) then
  perform 1 from public.contacts where email=lower(btrim(p->>'email')) for update;
  if exists(select 1 from public.opportunities o join public.contacts c on (c.id=o.contact_id or c.company_id is not null and c.company_id=o.company_id or exists(select 1 from public.company_contacts cc where cc.contact_id=c.id and cc.company_id=o.company_id and cc.relationship in ('primary','contact'))) where c.email=lower(btrim(p->>'email'))) then
   raise exception 'Este cliente ya tiene un expediente. Abre su oportunidad y usa Añadir proceso para una nueva solicitud.';
  end if;
 end if;
 return public.crm_command_v20(kind,p,request_key);
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_command_v26_underwriting(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if kind='review_document' then
  return public.case_document_command(kind,p||jsonb_build_object('document_id',coalesce(p->>'document_id',p->>'id')),request_key);
 end if;
 return public.crm_command_v24_documents(kind,p,request_key);
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_command_v28_campaign_templates(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if kind='handoff' and exists(select 1 from public.opportunities where id=(p->>'opportunity_id')::uuid and application_signed and application_complete)
  and exists(select 1 from public.analyses where opportunity_id=(p->>'opportunity_id')::uuid and not is_current)
  and not exists(select 1 from public.analyses where opportunity_id=(p->>'opportunity_id')::uuid and is_current and btrim(summary)<>'' and btrim(conclusion)<>'' and btrim(recommendations)<>'') then raise exception 'Current reviewed analysis required';end if;
 return public.crm_command_v26_underwriting(kind,p,request_key);
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_command_v31_banks(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;t public.email_templates;assets jsonb:='[]';requires_app boolean;receipt public.command_receipts;
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if kind='create_campaign' then
  if public.current_app_role() not in ('superadmin','seller_admin') or public.current_app_role() is null then raise exception 'Administrator required';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
  select * into receipt from public.command_receipts r where r.user_id=auth.uid() and r.request_key=crm_command_v31_banks.request_key;
  if found then return public.crm_command_v28_campaign_templates(kind,p,request_key);end if;
  if nullif(p->>'template_id','') is not null then
   select * into t from public.email_templates where id=(p->>'template_id')::uuid and archived_at is null for share;
   if t.id is null or t.version is distinct from (p->>'template_version')::int then raise exception 'Template changed; reload';end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'mime_type',mime_type,'size',size,'storage_path',storage_path,'content_hash',content_hash,'bucket','campaign-assets') order by id),'[]') into assets from public.campaign_assets where id=any(t.asset_ids);
  end if;
  requires_app:=(coalesce(p->>'subject','')||coalesce(p->>'body','')||coalesce(p->'steps','[]')::text) ~ '\{\{\s*application_url\s*\}\}';
  result:=public.crm_command_v28_campaign_templates(kind,p,request_key);
  update public.campaigns set template_id=t.id,template_version=t.version,asset_snapshot=assets,requires_application=requires_app where id=(result->>'id')::uuid;
  return result;
 end if;
 return public.crm_command_v28_campaign_templates(kind,p,request_key);
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_command_v37_campaign_delivery(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if kind in ('add_document','classify_document') then return public.manage_case_document(kind,p,request_key);end if;
 if kind='handoff' and public.can_edit_case((p->>'opportunity_id')::uuid)
 and exists(select 1 from public.opportunities where id=(p->>'opportunity_id')::uuid and application_signed and application_complete)
 and not public.document_packet_ready((p->>'opportunity_id')::uuid) then raise exception 'Approve the application and at least four bank statements';end if;
 return public.crm_command_v31_banks(kind,p,request_key);
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_command_v42_first_contact(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.email_templates;c public.campaigns;r jsonb;receipt public.command_receipts;ids uuid[];original jsonb:=p;
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if kind in ('archive_campaign_template','campaign_account_settings','campaign_audience_settings','activate_campaign','pause_campaign','create_campaign') then
  if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'Campaign administrator and MFA required';end if;
  if request_key is null then raise exception 'Idempotency key required';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
  select * into receipt from public.command_receipts cr where cr.user_id=auth.uid() and cr.request_key=crm_command_v42_first_contact.request_key;
  if receipt.user_id is not null then
   if receipt.kind<>kind or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused';end if;
   return receipt.result;
  end if;
 end if;
 if kind='create_campaign' then
  if nullif(p->>'template_id','') is not null then
   select * into t from public.email_templates where id=(p->>'template_id')::uuid and archived_at is null for share;
   if t.id is null or t.version is distinct from (p->>'template_version')::int then raise exception 'Template changed; reload';end if;
   -- The selected system template is authoritative, including attachments/format.
   p:=p||jsonb_build_object('subject',t.subject,'body',t.body,'steps',t.steps,'body_format',t.body_format);
  end if;
  if coalesce(p->>'body_format','plain') not in ('plain','markdown') then raise exception 'Invalid content format';end if;
  r:=public.crm_command_v37_campaign_delivery(kind,p,request_key);
  update public.campaigns set body_format=coalesce(p->>'body_format','plain') where id=(r->>'id')::uuid;
  update public.command_receipts set fingerprint=md5(original::text) where user_id=auth.uid() and command_receipts.request_key=crm_command_v42_first_contact.request_key;
  return r;
 elsif kind in ('activate_campaign','pause_campaign','campaign_audience_settings') then
  select * into c from public.campaigns where id=(p->>'id')::uuid for update;
  if c.id is null or not public.can_send(c.account_id) then raise exception 'Campaign and sender access required';end if;
  if kind='pause_campaign' then return public.crm_command_v37_campaign_delivery(kind,p,request_key);end if;
  if kind='campaign_audience_settings' then
   if c.status not in ('draft','paused') then raise exception 'Pause campaign before changing its audience';end if;
   if jsonb_typeof(p->'excluded_contact_ids')<>'array' or jsonb_array_length(p->'excluded_contact_ids')>5000 then raise exception 'Invalid exclusions';end if;
   ids:=array(select distinct value::uuid from jsonb_array_elements_text(p->'excluded_contact_ids'));
   update public.campaigns set excluded_contact_ids=ids where id=c.id;
   update public.outbox set status='cancelled' where enrollment_id in (select e.id from public.campaign_enrollments e where e.campaign_id=c.id and e.contact_id=any(ids)) and status in ('queued','paused');
   update public.campaign_enrollments set status='suppressed' where campaign_id=c.id and contact_id=any(ids) and status in ('active','paused');
  else
   if exists(select 1 from public.campaign_audience(c.id) where reason='missing_data') then raise exception 'Hay clientes con datos faltantes. Corrige o excluye esos contactos antes de activar.';end if;
   if not exists(select 1 from public.campaign_audience(c.id) where reason='eligible') then raise exception 'No hay destinatarios elegibles';end if;
   update public.campaign_enrollments e set status='active' where e.campaign_id=c.id and e.status='paused' and exists(select 1 from public.campaign_audience(c.id) a where a.contact_id=e.contact_id and a.reason='eligible');
   return public.crm_command_v37_campaign_delivery(kind,p,request_key);
  end if;
  r:=jsonb_build_object('id',c.id);
 elsif kind='archive_campaign_template' then
  select * into t from public.email_templates where id=(p->>'id')::uuid for update;
  if t.id is null or t.version is distinct from (p->>'expected_version')::int then raise exception 'Template changed; reload';end if;
  update public.email_templates set archived_at=case when coalesce((p->>'archived')::boolean,true) then now() else null end,version=version+1,updated_at=now(),updated_by=auth.uid() where id=t.id;
  insert into public.email_template_versions select id,version,to_jsonb(et),now() from public.email_templates et where id=t.id;
  r:=jsonb_build_object('id',t.id);
 elsif kind='campaign_account_settings' then
  if public.current_app_role()<>'superadmin' then raise exception 'Superadmin required';end if;
  if (p->>'daily_limit')::int not between 1 and 2000 or (p->>'campaign_daily_limit')::int not between 1 and 2000 or (p->>'operational_reserve')::int not between 0 and 1999 or (p->>'campaign_daily_limit')::int+(p->>'operational_reserve')::int>(p->>'daily_limit')::int then raise exception 'El cupo de campañas más la reserva no puede superar el límite total';end if;
  if not (p ?& array['daily_limit','campaign_daily_limit','operational_reserve']) then raise exception 'Complete limits required';end if;
  update public.mail_accounts set daily_limit=(p->>'daily_limit')::int,campaign_daily_limit=(p->>'campaign_daily_limit')::int,operational_reserve=(p->>'operational_reserve')::int where id=(p->>'id')::uuid;
  if not found then raise exception 'Account not found';end if;
  r:=jsonb_build_object('id',p->>'id');
 else
  return public.crm_command_v37_campaign_delivery(kind,p,request_key);
 end if;
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request_key,kind,r,md5(p::text));
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'campaign',(r->>'id')::uuid,kind);
 return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_command_v7(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
 actor uuid := auth.uid(); role public.app_role := public.current_app_role();
 o public.opportunities; c public.contacts; co public.conversations; camp public.campaigns; sub public.submissions; doc public.documents;
 old_receipt public.command_receipts; result jsonb := '{}'::jsonb; entity uuid; company_id uuid; target uuid;
 area public.case_area; new_stage public.case_stage; row jsonb; reason text; email text; amount numeric; recipient uuid;
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if role is null or actor is null then raise exception 'Invitation and MFA required'; end if;
 if request_key is null then raise exception 'Idempotency key required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,0));
 select * into old_receipt from public.command_receipts r where r.user_id=actor and r.request_key=crm_command_v7.request_key;
 if found then
  if old_receipt.kind<>kind or old_receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused with different input'; end if;
  return old_receipt.result;
 end if;
 if nullif(p->>'opportunity_id','') is not null then
  select * into o from public.opportunities where id=(p->>'opportunity_id')::uuid for update;
  if o.id is null or not public.can_edit_case(o.id) then raise exception 'Case is inaccessible or read-only'; end if;
  area := case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end;
  entity := o.id;
 end if;
 if kind in ('activity','next_action','transition','analysis','add_document','review_document','handoff','assign_closer','fund','create_task','submission','update_submission','offer','lender_email') and o.id is null then raise exception 'Case required'; end if;

 case kind
 when 'create_opportunity' then
  if role not in ('superadmin','seller_admin','seller') then raise exception 'Seller access required'; end if;
  email:=lower(btrim(p->>'email'));
  if email is null or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(p->>'company','')='' or coalesce(p->>'contact','')='' then raise exception 'Valid contact and company required'; end if;
  target:=case when role='seller' then actor else (p->>'seller_id')::uuid end;
  if not exists(select 1 from public.profiles where id=target and active and profiles.role in ('seller','seller_admin','superadmin')) then raise exception 'Invalid seller'; end if;
  perform pg_advisory_xact_lock(hashtextextended(email,1));
  select * into c from public.contacts where contacts.email=email;
  if c.id is null then
   insert into public.companies(name) values(p->>'company') returning id into company_id;
   insert into public.contacts(company_id,email,name,phone) values(company_id,email,p->>'contact',coalesce(p->>'phone','')) returning * into c;
  end if;
  insert into public.opportunities(contact_id,company_id,company,industry,product,amount,seller_id,next_action,next_action_at)
  values(c.id,c.company_id,p->>'company',coalesce(p->>'industry',''),p->>'product',coalesce((p->>'amount')::numeric,0),target,coalesce(p->>'next_action',''),nullif(p->>'next_action_at','')::timestamptz) returning id into entity;
  perform public.initialize_checklist(entity,p->>'product');
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(entity,actor,'created','general','Opportunity created');
 when 'activity' then
  if coalesce(btrim(p->>'body'),'')='' or p->>'type' not in ('note','call') then raise exception 'Valid activity required'; end if;
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,p->>'type',area,p->>'body');
  -- Seller-visible summary must never contain closer negotiations.
  if area='seller' then update public.opportunities set summary=p->>'body',last_contact=case when p->>'type'='call' then now() else last_contact end where id=o.id; end if;
  if p->>'type'='call' then
   update public.opportunities set last_contact=now() where id=o.id;
   if coalesce(p->>'next_action','')='' or nullif(p->>'next_action_at','') is null then raise exception 'Next commitment required'; end if;
   insert into public.tasks(opportunity_id,owner_id,title,due_at,area) values(o.id,coalesce(o.closer_id,o.seller_id),p->>'next_action',(p->>'next_action_at')::timestamptz,area);
   if area='seller' then update public.opportunities set next_action=p->>'next_action',next_action_at=(p->>'next_action_at')::timestamptz where id=o.id; end if;
  end if;
 when 'next_action' then
  if coalesce(btrim(p->>'next_action'),'')='' then raise exception 'Next action required'; end if;
  if area='seller' then update public.opportunities set next_action=p->>'next_action',next_action_at=(p->>'next_action_at')::timestamptz where id=o.id; end if;
  insert into public.tasks(opportunity_id,owner_id,title,due_at,area) values(o.id,coalesce(o.closer_id,o.seller_id),p->>'next_action',(p->>'next_action_at')::timestamptz,area);
 when 'transition' then
  new_stage:=(p->>'stage')::public.case_stage;
  if coalesce(btrim(p->>'reason'),'')='' then raise exception 'Reason required'; end if;
  if new_stage in ('funded','ready_for_closer','unassigned') then raise exception 'Use dedicated workflow'; end if;
  if (area='seller' and new_stage not in ('new','contacting','replied','application_pending','documents_pending','analysis','lost','paused')) or (area='closer' and new_stage not in ('lenders','offers','negotiation','accepted','funding_pending','lost','paused')) then raise exception 'Invalid phase transition'; end if;
  if new_stage='funding_pending' and o.stage<>'accepted' then raise exception 'Acceptance required'; end if;
  if new_stage='accepted' and not exists(select 1 from public.offers where opportunity_id=o.id) then raise exception 'Recorded offer required'; end if;
  if o.stage='funded' then raise exception 'Funded case cannot be reopened by a status update'; end if;
  update public.opportunities set stage=new_stage where id=o.id;
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,'status',area,new_stage::text||': '||(p->>'reason'));
  if new_stage in ('lost','paused') then update public.campaign_enrollments set status='goal_met' where opportunity_id=o.id and status in ('active','paused'); update public.outbox set status='cancelled' where opportunity_id=o.id and enrollment_id is not null and status in ('queued','paused'); end if;
 when 'analysis' then
  if area<>'seller' or coalesce(btrim(p->>'summary'),'')='' or coalesce(btrim(p->>'conclusion'),'')='' or coalesce(btrim(p->>'recommendations'),'')='' then raise exception 'Complete seller analysis required'; end if;
  insert into public.analyses(opportunity_id,summary,conclusion,observations,recommendations,reviewer_id) values(o.id,p->>'summary',p->>'conclusion',coalesce(p->>'observations',''),p->>'recommendations',actor);
 when 'add_document' then
  if coalesce(btrim(p->>'name'),'')='' or length(p->>'name')>200 or p->>'kind' not in ('additional','analysis_report') then raise exception 'Document name and type required'; end if;
  insert into public.documents(opportunity_id,name,kind,period,required) values(o.id,p->>'name',p->>'kind',coalesce(nullif(p->>'period',''),request_key::text),coalesce((p->>'required')::boolean,true));
 when 'review_document' then
  select * into doc from public.documents where id=(p->>'id')::uuid and opportunity_id=o.id for update;
  if doc.id is null or doc.storage_path is null or p->>'status' not in ('received','approved','correction') then raise exception 'Received document required'; end if;
  update public.documents set status=p->>'status',reviewed_by=actor,reviewed_at=now() where id=doc.id;
 when 'handoff' then
  if area<>'seller' or not o.application_signed or not o.application_complete then raise exception 'Signed and complete application required'; end if;
  if not exists(select 1 from public.documents where opportunity_id=o.id) or exists(select 1 from public.documents where opportunity_id=o.id and required and status<>'approved') then raise exception 'All documents must be reviewed and approved'; end if;
  if not exists(select 1 from public.analyses where opportunity_id=o.id and btrim(summary)<>'' and btrim(conclusion)<>'' and btrim(recommendations)<>'') then raise exception 'Analysis and recommendation required'; end if;
  update public.opportunities set stage='unassigned',handed_off_at=now(),next_action='Awaiting closer assignment',next_action_at=now() where id=o.id;
  update public.campaign_enrollments set status='goal_met' where opportunity_id=o.id and status in ('active','paused');
  update public.outbox set status='cancelled' where opportunity_id=o.id and enrollment_id is not null and status in ('queued','paused');
  update public.tasks set status='done' where opportunity_id=o.id and automated and area='seller';
  for recipient in select id from public.profiles where profiles.role in ('superadmin','closer_admin') and active loop perform public.notify_user(recipient,'handoff:'||o.id,'Case ready for assignment'); end loop;
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,'handoff','general','Case handed off to closer team');
 when 'assign_seller' then
  if o.id is null or role not in ('superadmin','seller_admin') or (role='seller_admin' and o.handed_off_at is not null) then raise exception 'Seller administrator required before handoff'; end if;
  target:=(p->>'seller_id')::uuid;
  if not exists(select 1 from public.profiles where id=target and active and profiles.role in ('superadmin','seller_admin','seller')) then raise exception 'Invalid seller'; end if;
  update public.opportunities set seller_id=target where id=o.id;
  update public.tasks set owner_id=target where opportunity_id=o.id and tasks.area='seller' and status='open' and owner_id=o.seller_id;
  perform public.notify_user(target,'assigned:'||o.id||':'||request_key,'New case assigned');
 when 'assign_closer' then
  if role not in ('superadmin','closer_admin') or o.handed_off_at is null then raise exception 'Closer administrator required'; end if;
  target:=(p->>'closer_id')::uuid;
  if not exists(select 1 from public.profiles where id=target and active and profiles.role in ('superadmin','closer_admin','closer')) then raise exception 'Invalid closer'; end if;
  update public.opportunities set closer_id=target,stage=case when stage='unassigned' then 'lenders'::public.case_stage else stage end,next_action='Closer managing lender requests',next_action_at=null where id=o.id;
  perform public.notify_user(target,'assigned:'||o.id||':'||request_key,'New case assigned');
 when 'fund' then
  amount:=(p->>'amount')::numeric;
  if area<>'closer' or o.stage not in ('accepted','funding_pending') or amount<=0 or nullif(p->>'funded_at','') is null or (p->>'funded_at')::date>current_date then raise exception 'Accepted case and valid funding details required'; end if;
  if not exists(select 1 from public.submissions where opportunity_id=o.id and lender_id=(p->>'lender_id')::uuid) then raise exception 'Lender must have a submission for this case'; end if;
  update public.opportunities set stage='funded',funded_amount=amount,funded_at=(p->>'funded_at')::timestamptz,funded_lender_id=(p->>'lender_id')::uuid where id=o.id;
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,'funded','general','Funding confirmed');
  perform public.notify_user(o.seller_id,'funded:'||o.id,'Case funding confirmed');
 when 'create_task' then
  target:=(p->>'owner_id')::uuid;
  if coalesce(p->>'title','')='' or not exists(select 1 from public.profiles where id=target and active and (profiles.role='superadmin' or (area='seller' and profiles.role='seller_admin') or (area='closer' and profiles.role='closer_admin') or (target=o.seller_id and area='seller') or (target=o.closer_id and area='closer'))) then raise exception 'Task owner must have access to this phase'; end if;
  insert into public.tasks(opportunity_id,owner_id,title,due_at,area) values(o.id,target,p->>'title',(p->>'due_at')::timestamptz,area);
 when 'complete_task' then
  select opportunity_id into entity from public.tasks where id=(p->>'id')::uuid;
  if not public.can_edit_case(entity) then raise exception 'Access denied'; end if;
  update public.tasks set status='done' where id=(p->>'id')::uuid and public.can_area(opportunity_id,tasks.area);
 when 'submission' then
  if area<>'closer' or o.closer_id is null or coalesce(p->>'next_action','')='' then raise exception 'Assigned closer and next action required'; end if;
  insert into public.submissions(opportunity_id,lender_id,closer_id,channel,status,next_action,next_action_at,external_reference) values(o.id,(p->>'lender_id')::uuid,o.closer_id,p->>'channel',case when p->>'channel'='email' then 'draft' else 'submitted' end,p->>'next_action',(p->>'next_action_at')::timestamptz,coalesce(p->>'external_reference',''));
 when 'update_submission' then
  if area<>'closer' then raise exception 'Closer required'; end if;
  update public.submissions set status=p->>'status',next_action=p->>'next_action',next_action_at=(p->>'next_action_at')::timestamptz where id=(p->>'id')::uuid and opportunity_id=o.id;
  if not found then raise exception 'Submission not found'; end if;
 when 'offer' then
  if area<>'closer' or not exists(select 1 from public.submissions where id=(p->>'submission_id')::uuid and opportunity_id=o.id) then raise exception 'Submission not found'; end if;
  insert into public.offers(submission_id,opportunity_id,product,amount,term,cost,frequency,fees,expires_at) values((p->>'submission_id')::uuid,o.id,p->>'product',(p->>'amount')::numeric,coalesce(p->>'term',''),coalesce(p->>'cost',''),coalesce(p->>'frequency',''),coalesce(p->>'fees',''),nullif(p->>'expires_at','')::timestamptz);
  update public.submissions set status='offer' where id=(p->>'submission_id')::uuid;
  update public.opportunities set stage='offers' where id=o.id and stage not in ('accepted','funding_pending','funded');
 when 'create_lender' then
  if role not in ('superadmin','closer_admin') then raise exception 'Closer administrator required'; end if;
  insert into public.lenders(name,email,products,channel,notes) values(p->>'name',p->>'email',regexp_split_to_array(p->>'products',',\s*'),p->>'channel',coalesce(p->>'notes','')) returning id into entity;
 when 'update_lender' then
  if role not in ('superadmin','closer_admin') then raise exception 'Closer administrator required'; end if;
  update public.lenders set name=p->>'name',email=lower(btrim(p->>'email')),products=regexp_split_to_array(p->>'products',',\s*'),channel=p->>'channel',notes=coalesce(p->>'notes','') where id=(p->>'id')::uuid;
 when 'create_campaign' then
  if role not in ('superadmin','seller_admin') or not public.can_send((p->>'account_id')::uuid) then raise exception 'Campaign and sender access required'; end if;
  if not exists(select 1 from public.profiles where id=(p->>'seller_id')::uuid and active and profiles.role in ('superadmin','seller_admin','seller')) then raise exception 'Invalid seller'; end if;
  if not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Invalid timezone'; end if;
  if position('{{unsubscribe_url}}' in (p->>'body'))=0 or (coalesce((p->>'followup_days')::int,0)>0 and position('{{unsubscribe_url}}' in (p->>'followup_body'))=0) then raise exception 'Unsubscribe link required in every step'; end if;
  if p ? 'steps' then
   if jsonb_typeof(p->'steps')<>'array' or jsonb_array_length(p->'steps')>20 then raise exception 'Maximum 20 follow-up steps'; end if;
   for row in select value from jsonb_array_elements(p->'steps') loop
    if coalesce((row->>'wait_days')::int,0) not between 1 and 90 or coalesce(btrim(row->>'subject'),'')='' or coalesce(position('{{unsubscribe_url}}' in (row->>'body')),0)=0 then raise exception 'Each follow-up requires a subject, wait time and unsubscribe link'; end if;
   end loop;
  end if;
  insert into public.campaigns(name,account_id,seller_id,created_by,daily_limit,timezone,start_hour,end_hour,subject,body,batch_id,steps)
  values(p->>'name',(p->>'account_id')::uuid,(p->>'seller_id')::uuid,actor,(p->>'daily_limit')::int,p->>'timezone',(p->>'start_hour')::int,(p->>'end_hour')::int,p->>'subject',p->>'body',nullif(p->>'batch_id','')::uuid,coalesce(p->'steps',case when coalesce((p->>'followup_days')::int,0)>0 then jsonb_build_array(jsonb_build_object('subject',p->>'followup_subject','body',p->>'followup_body','wait_days',(p->>'followup_days')::int)) else '[]'::jsonb end)) returning id into entity;
 when 'activate_campaign' then
  select * into camp from public.campaigns where id=(p->>'id')::uuid for update;
  if role not in ('superadmin','seller_admin') or camp.id is null or not public.can_send(camp.account_id) then raise exception 'Campaign and sender access required'; end if;
  if not exists(select 1 from public.mail_accounts where id=camp.account_id and status='connected') then raise exception 'Gmail account disconnected'; end if;
  if camp.status='active' then raise exception 'Campaign already active'; end if;
  -- Lock contacts in deterministic order; the partial unique index enforces exclusivity across concurrent campaigns.
  for c in select ct.* from public.contacts ct where ct.verification='valid' and not (ct.id=any(camp.excluded_contact_ids)) and not exists(select 1 from public.suppressions s where s.email=ct.email)
    and exists(select 1 from public.opportunities op where op.contact_id=ct.id and op.archived_at is null and (not camp.requires_application or not op.application_complete) and op.handed_off_at is null and op.stage not in ('lost','paused','funded') and (op.campaign_id is null or op.campaign_id=camp.id))
    and (camp.batch_id is null or exists(select 1 from public.import_rows r where r.batch_id=camp.batch_id and r.contact_id=ct.id)) order by ct.id for update of ct loop
   if not exists(select 1 from public.campaign_enrollments e where e.contact_id=c.id and e.status in ('active','paused')) then
    select * into o from public.opportunities where contact_id=c.id and archived_at is null and (not camp.requires_application or not application_complete) and handed_off_at is null and stage not in ('lost','paused','funded') and (campaign_id is null or campaign_id=camp.id) order by created_at desc limit 1;
    insert into public.campaign_enrollments(campaign_id,contact_id,opportunity_id) values(camp.id,c.id,o.id) on conflict do nothing;
    if found then update public.opportunities set seller_id=camp.seller_id,campaign_id=camp.id where id=o.id; end if;
   end if;
  end loop;
  update public.campaigns set status='active' where id=camp.id;
  entity:=camp.id;
 when 'pause_campaign' then
  if role not in ('superadmin','seller_admin') then raise exception 'Administrator required'; end if;
  update public.campaigns set status='paused' where id=(p->>'id')::uuid;
  entity:=(p->>'id')::uuid;
 when 'verify_contacts' then
  if role not in ('superadmin','seller_admin') then raise exception 'Administrator required'; end if;
  for target in select distinct value::text::uuid from jsonb_array_elements_text(p->'contact_ids') loop
   if exists(select 1 from public.contacts where id=target and verification in ('pending','uncertain')) and public.can_case((select id from public.opportunities where contact_id=target limit 1)) then
    insert into public.verifications(contact_id,request_key,result) values(target,request_key||':'||target,'pending') on conflict do nothing;
   end if;
  end loop;
  insert into public.jobs(kind,payload,dedupe_key) values('scrub','{}','scrub:'||request_key) on conflict do nothing;
 when 'reply' then
  select * into co from public.conversations where id=(p->>'conversation_id')::uuid;
  if co.id is null or not public.can_area(co.opportunity_id,co.area) or not public.can_edit_case(co.opportunity_id) or not public.can_send(co.account_id) then raise exception 'Case and sender permissions required'; end if;
  if co.area='seller' then select ct.email into email from public.opportunities op join public.contacts ct on ct.id=op.contact_id where op.id=co.opportunity_id;
  elsif co.submission_id is not null then select l.email into email from public.submissions s join public.lenders l on l.id=s.lender_id where s.id=co.submission_id;
  else select ct.email into email from public.opportunities op join public.contacts ct on ct.id=op.contact_id where op.id=co.opportunity_id; end if;
  select case when handed_off_at is not null then 'closer'::public.case_area else co.area end into area from public.opportunities where id=co.opportunity_id;
  insert into public.outbox(account_id,opportunity_id,submission_id,conversation_id,to_email,subject,body,area,message_id_header,requested_by,request_key,gmail_thread_id)
  values(co.account_id,co.opportunity_id,co.submission_id,co.id,email,co.subject,p->>'body',area,'<'||request_key||'@crm.curated.local>',actor,request_key::text,co.gmail_thread_id);
  entity:=co.opportunity_id;
 when 'lender_email' then
  select * into sub from public.submissions where id=(p->>'submission_id')::uuid and opportunity_id=o.id;
  if area<>'closer' or sub.id is null or not public.can_send((p->>'account_id')::uuid) then raise exception 'Case and sender permissions required'; end if;
  select l.email into email from public.lenders l where l.id=sub.lender_id;
  insert into public.outbox(account_id,opportunity_id,submission_id,to_email,subject,body,area,attachment_ids,message_id_header,requested_by,request_key)
  values((p->>'account_id')::uuid,o.id,sub.id,email,p->>'subject',p->>'body','closer',array(select id from public.documents where opportunity_id=o.id and status='approved'), '<'||request_key||'@crm.curated.local>',actor,request_key::text);
 when 'preferences' then
  insert into public.notification_preferences(user_id,internal,email,push,locale) values(actor,(p->>'internal')::boolean,(p->>'email')::boolean,(p->>'push')::boolean,p->>'locale')
  on conflict(user_id) do update set internal=excluded.internal,email=excluded.email,push=excluded.push,locale=excluded.locale;
 when 'read_notification' then update public.notifications set read_at=now() where id=(p->>'id')::uuid and user_id=actor;
 when 'push_subscription' then
  if coalesce(p->'subscription'->>'endpoint','') !~ '^https://([a-zA-Z0-9-]+\.)*(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com)/' then raise exception 'Unsupported push endpoint'; end if;
  insert into public.push_subscriptions(user_id,subscription,endpoint) values(actor,p->'subscription',p->'subscription'->>'endpoint') on conflict(endpoint) do update set user_id=excluded.user_id,subscription=excluded.subscription;
 when 'requirements' then
  if role<>'superadmin' then raise exception 'Superadmin required'; end if;
  insert into public.product_requirements(product,bank_months) values(p->>'product',(p->>'bank_months')::int) on conflict(product) do update set bank_months=excluded.bank_months;
 when 'account_settings' then
  if role<>'superadmin' then raise exception 'Superadmin required'; end if;
  if not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Invalid timezone'; end if;
  update public.mail_accounts set daily_limit=(p->>'daily_limit')::int,timezone=p->>'timezone' where id=(p->>'id')::uuid;
 when 'mail_permission' then
  if role<>'superadmin' then raise exception 'Superadmin required'; end if;
  insert into public.mail_permissions(account_id,user_id,can_send) values((p->>'account_id')::uuid,(p->>'user_id')::uuid,(p->>'can_send')::boolean) on conflict(account_id,user_id) do update set can_send=excluded.can_send;
 when 'user_role' then
  if role<>'superadmin' or (p->>'user_id')::uuid=actor then raise exception 'Superadmin required; own role cannot be changed'; end if;
  update public.profiles set role=(p->>'role')::public.app_role,active=(p->>'active')::boolean where id=(p->>'user_id')::uuid;
 when 'archive' then
  if not public.can_edit_case((p->>'id')::uuid) then raise exception 'Access denied'; end if;
  update public.opportunities set archived_at=now() where id=(p->>'id')::uuid;
  update public.campaign_enrollments set status='goal_met' where opportunity_id=(p->>'id')::uuid and status in ('active','paused');
  update public.outbox set status='cancelled' where opportunity_id=(p->>'id')::uuid and status in ('queued','paused');
 else raise exception 'Unsupported command';
 end case;
 if o.id is not null then update public.opportunities set updated_at=now() where id=o.id; end if;
 -- Only identifiers and action names are audited. Message/application bodies never enter logs.
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(actor,kind,entity,kind,jsonb_build_object('request_key',request_key,'target_id',coalesce(p->>'id',p->>'user_id',p->>'closer_id',p->>'account_id')));
 result:=jsonb_build_object('ok',true,'id',entity);
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request_key,kind,result,md5(p::text));
 return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.gmail_followups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare w public.mail_waits;o public.opportunities;p public.financing_processes;task uuid;recipient uuid;
begin
 for w in select * from public.mail_waits where waiting_for in ('client','lender') and task_id is null and since_at<=now()-interval '5 days' order by since_at for update skip locked limit 200 loop
  select * into o from public.opportunities where id=w.opportunity_id and archived_at is null;
  if o.id is null or o.stage='paused' then continue;end if;
  select * into p from public.financing_processes where id=w.process_id;
  if p.classification='inactive' or p.state in ('disbursed','client_withdrew','funding_declined') then continue;end if;
  if o.stage in ('funded','lost') and (p.classification is distinct from 'active' or p.is_unclassified_archive) then continue;end if;
  recipient:=case when w.area='closer' then o.closer_id else o.seller_id end;if not s01_i02.actor_can_read(recipient,o.id,w.area) then continue;end if;
  insert into public.tasks(opportunity_id,owner_id,title,due_at,area,automated) values(o.id,recipient,'Five calendar days: waiting for '||w.waiting_for,w.since_at+interval '5 days',w.area,true) returning id into task;
  update public.mail_waits set task_id=task where id=w.id;
 end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.mail_pending_threads(page_number integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with visible as (
 select distinct on (m.account_id,m.gmail_thread_id) m.id,m.account_id,m.gmail_thread_id,m.subject,m.sent_at,m.participants,r.id as review_id
 from public.mail_review r join public.gmail_archive_messages m on m.account_id=r.account_id and m.gmail_message_id=r.gmail_message_id
 join public.mail_accounts a on a.id=r.account_id
 where s01_i02.can_archive(m.id) and r.status='pending' and m.direction='inbound' and m.nature='personal' and m.reply_intent is distinct from 'ignored'
  and exists(select 1 from jsonb_array_elements(m.participants) p where p->>'role'='from'
   and public.mail_human_reply(m.direction,m.nature,p->>'email')
   and (m.reply_intent='positive' or public.mail_is_team(p->>'email') or public.mail_lender_for(p->>'email') is not null)) and public.current_app_role() is not null and (a.owner_id=auth.uid() or public.current_app_role()='superadmin')
 order by m.account_id,m.gmail_thread_id,m.sent_at desc,r.id
 ),page as (select * from visible order by sent_at desc,id limit 50 offset greatest(0,least(coalesce(page_number,0),100000))*50)
 select jsonb_build_object('total',(select count(*) from visible),'threads',coalesce((select jsonb_agg(page) from page),'[]'::jsonb))
$function$
;

CREATE OR REPLACE FUNCTION public.notify_user(recipient uuid, event text, title_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare notification_id uuid;
begin
 if not s01_i02.actor_notification_allowed(recipient,event) then return;end if;
 if recipient is null then return; end if;
 insert into public.notifications(user_id,title,body,event_key) values(recipient,title_text,'Open your secure workspace to review this update.',event) on conflict(user_id,event_key) do nothing returning id into notification_id;
 if notification_id is not null then
  insert into public.jobs(kind,payload,dedupe_key) values('notify',jsonb_build_object('notification_id',notification_id),'notify:'||notification_id) on conflict do nothing;
 end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.queue_lender_emails(case_id uuid, account uuid, process uuid, targets jsonb, subject_text text, body_text text, files uuid[], gmail_files uuid[], request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target jsonb; sub public.submissions; receipt public.command_receipts; send_id uuid; result jsonb:='[]';payload jsonb; lender uuid; closer uuid; matches int;
begin
 perform s01_i02.assert_sources(case_id,files,gmail_files,'{}'::uuid[]);
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
 if not public.document_packet_ready(case_id) then raise exception 'Approve the application and at least four bank statements first';end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.queue_lender_reply(input jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.conversations;m public.messages;firm uuid:=(input->>'lender')::uuid;case_id uuid:=(input->>'case_id')::uuid;submission uuid:=(input->>'submission')::uuid;copies text[];result uuid;
begin
 perform s01_i02.assert_sources((input->>'case_id')::uuid,array(select jsonb_array_elements_text(input->'files')::uuid),array(select jsonb_array_elements_text(input->'gmail_files')::uuid),array(select jsonb_array_elements_text(input->'uploads')::uuid),coalesce(input->>'forward_message_id',input->>'reply_message')::uuid);if not coalesce(public.can_area((input->>'case_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;
 if not coalesce(public.can_mail_case(case_id),false) then raise exception 'Case access required';end if;
 select * into c from public.conversations where id=(input->>'conversation')::uuid and opportunity_id=case_id;
 select * into m from public.messages where id=(input->>'reply_message')::uuid and conversation_id=c.id;
 if c.id is null or m.id is null or firm is null then raise exception 'Choose a message in the lender conversation';end if;
 if m.direction='inbound' and not public.mail_is_team(m.sender) then
  if public.mail_lender_for(m.sender) is distinct from firm then raise exception 'Reply must belong to the selected company';end if;
 elsif not exists(select 1 from jsonb_array_elements(m.participants) p where p->>'role' in ('to','cc','bcc') and public.mail_lender_for(p->>'email')=firm)
  and not (m.participants='[]'::jsonb and exists(select 1 from public.submissions s where s.id=c.submission_id and s.lender_id=firm)) then
  raise exception 'Choose an original message addressed to this company';
 end if;
 if public.mail_lender_for(input->>'recipient') is distinct from firm then raise exception 'Recipient must belong to the selected lender';end if;
 copies:=array(select jsonb_array_elements_text(coalesce(input->'copies','[]')))||array(select jsonb_array_elements_text(coalesce(input->'hidden_copies','[]')));
 if exists(select 1 from public.opportunities o join public.contacts ct on ct.id=o.contact_id where o.id=case_id and ct.email=any(array[lower(input->>'recipient')]||copies))
 or exists(select 1 from public.opportunities o join public.company_contacts cc on cc.company_id=o.company_id join public.contacts ct on ct.id=cc.contact_id where o.id=case_id and cc.relationship in ('primary','contact','broker') and ct.email=any(array[lower(input->>'recipient')]||copies)) then raise exception 'Customer recipients cannot be included in this lender reply';end if;
 if exists(select 1 from unnest(copies) e where not public.mail_is_team(e) and public.mail_lender_for(e) is distinct from firm) then raise exception 'Copies cannot include another lender or the customer';end if;
 if submission is not null and not exists(select 1 from public.submissions s where s.id=submission and s.lender_id=firm and s.opportunity_id=case_id and s.process_id is not distinct from c.process_id) then raise exception 'Evaluation belongs to another company or process';end if;
 result:=public.queue_mail_email(case_id,(input->>'account')::uuid,input->>'recipient',c.subject,input->>'body_text',
  array(select jsonb_array_elements_text(input->'files')::uuid),array(select jsonb_array_elements_text(input->'gmail_files')::uuid),array(select jsonb_array_elements_text(input->'uploads')::uuid),
  array(select jsonb_array_elements_text(input->'copies')),array(select jsonb_array_elements_text(input->'hidden_copies')),
  c.process_id,c.id,m.id,submission,input->>'signature',input->>'display_name',(input->>'request')::uuid);
 return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.queue_mail_email(case_id uuid, account uuid, recipient text, subject_text text, body_text text, files uuid[], gmail_files uuid[], uploads uuid[], copies text[], hidden_copies text[], process uuid, conversation uuid, reply_message uuid, submission uuid, signature text, display_name text, request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.opportunities;a public.mail_accounts;c public.conversations;previous public.outbox;result uuid;phase public.case_area;
begin
 perform s01_i02.assert_sources(case_id,files,gmail_files,uploads,reply_message);if (submission is not null or exists(select 1 from public.conversations i02_thread where i02_thread.id=conversation and i02_thread.submission_id is not null)) and not coalesce(public.can_area(case_id,'closer'),false) then raise exception 'Closer area access required';end if;
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
  process:=coalesce(process,c.process_id);submission:=coalesce(submission,case when public.mail_lender_for(recipient) is null or exists(select 1 from public.submissions s where s.id=c.submission_id and s.lender_id=public.mail_lender_for(recipient)) then c.submission_id end);
  if subject_text<>(select v.subject from s01_i02.visible_conversations() v where v.id=c.id) then raise exception 'Reply subject must match';end if;
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
 values(account,case_id,submission,conversation,recipient,copies,hidden_copies,subject_text,body_text,phase,files,gmail_files,uploads,process,reply_message,coalesce(signature,''),display_name,'<'||request::text||'@crm.curated.local>',auth.uid(),request::text,case when c.account_id=account then coalesce(c.gmail_delivery_thread_id,c.gmail_thread_id) else null end,greatest(now(),a.send_retry_at)) returning id into result;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'outbox',result,'mail_queued');
 return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.queue_mail_forward(input jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.messages;source public.outbox;previous public.outbox;result uuid;case_id uuid:=(input->>'case_id')::uuid;request uuid:=(input->>'request')::uuid;files uuid[]:=array(select jsonb_array_elements_text(input->'forward_file_ids')::uuid);
begin
 perform s01_i02.assert_sources((input->>'case_id')::uuid,array(select jsonb_array_elements_text(input->'files')::uuid),array(select jsonb_array_elements_text(input->'gmail_files')::uuid),array(select jsonb_array_elements_text(input->'uploads')::uuid),coalesce(input->>'forward_message_id',input->>'reply_message')::uuid);if exists(select 1 from jsonb_array_elements_text(input->'forward_file_ids') f where not (s01_i02.can_source('saved',f::uuid) or exists(select 1 from public.outbox o join public.messages m on m.internet_message_id=o.message_id_header and m.id=(input->>'forward_message_id')::uuid where o.opportunity_id=(input->>'case_id')::uuid and public.mail_snapshot_allowed(o.id,f::uuid)))) then raise exception 'Original attachment access required';end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.queue_mail_lenders(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target jsonb;s public.submissions;case_id uuid:=(input->>'case_id')::uuid;process uuid:=(input->>'process')::uuid;request uuid:=(input->>'request')::uuid;result jsonb:='[]';send_id uuid;matches int;receipt public.command_receipts;fingerprint text;
begin
 perform s01_i02.assert_sources((input->>'case_id')::uuid,array(select jsonb_array_elements_text(input->'files')::uuid),array(select jsonb_array_elements_text(input->'gmail_files')::uuid),array(select jsonb_array_elements_text(input->'uploads')::uuid),coalesce(input->>'forward_message_id',input->>'reply_message')::uuid);if not coalesce(public.can_area((input->>'case_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;
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
 if not public.document_packet_ready(case_id) then raise exception 'Approve the application and at least four bank statements first';end if;
 if not exists(select 1 from public.documents where opportunity_id=case_id and kind='application' and status='approved' and id in(select jsonb_array_elements_text(input->'files')::uuid))
 or (select count(distinct content_hash) from public.documents where opportunity_id=case_id and kind='bank_statement' and status='approved' and id in(select jsonb_array_elements_text(input->'files')::uuid))<4 then raise exception 'Include the approved application and at least four bank statements in the package';end if;
 for target in select value from jsonb_array_elements(input->'targets') loop
  if jsonb_typeof(coalesce(target->'cc_emails','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(target->'cc_emails','[]'::jsonb))>20 then raise exception 'Invalid lender copies';end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(target->'cc_emails','[]'::jsonb)) e where not exists(select 1 from public.lender_contacts c where c.lender_id=(target->>'lender_id')::uuid and c.email=lower(btrim(e)))) then raise exception 'Copy recipients must belong to this lender';end if;

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
   array(select jsonb_array_elements_text(input->'files')::uuid),array(select jsonb_array_elements_text(input->'gmail_files')::uuid),array(select jsonb_array_elements_text(input->'uploads')::uuid),array(select distinct lower(btrim(e)) from jsonb_array_elements_text(coalesce(target->'cc_emails','[]'::jsonb)) e where lower(btrim(e))<>lower(target->>'email')),'{}',process,null,null,s.id,input->>'signature',input->>'display_name',md5(request::text||':'||s.id)::uuid);
  result:=result||jsonb_build_array(jsonb_build_object('id',send_id,'lender_id',s.lender_id));
 end loop;
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request,'mail_lenders',result,fingerprint);
 return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.queue_manual_email(case_id uuid, account uuid, recipient text, subject_text text, body_text text, files uuid[], gmail_files uuid[], request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.opportunities;a public.mail_accounts;previous public.outbox;target uuid;phase public.case_area;
begin
 perform s01_i02.assert_sources(case_id,files,gmail_files,'{}'::uuid[]);
 if not public.can_edit_case(case_id) then raise exception 'Case is read-only'; end if;
 select * into o from public.opportunities where id=case_id for update;
 if o.archived_at is not null or (o.email_qualified_at is null and o.historical_approved_at is null) then raise exception 'Eligible opportunity required'; end if;
 phase:=case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end;
 if not public.can_send(account) then raise exception 'Sender permission required'; end if;
 select * into a from public.mail_accounts where id=account;
 if a.status<>'connected' then raise exception 'Sender account is not connected'; end if;
 recipient:=lower(btrim(recipient));subject_text:=btrim(subject_text);body_text:=btrim(body_text);
 if recipient is null or recipient !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(recipient)>254 or subject_text is null or length(subject_text) not between 1 and 200 or subject_text ~ '[\r\n]' or body_text is null or length(body_text) not between 1 and 10000 or cardinality(files)>20 or cardinality(gmail_files)>20 or request is null then raise exception 'Invalid email fields'; end if;
 if phase='seller' and exists(select 1 from public.suppressions where email=recipient) then raise exception 'Recipient is suppressed'; end if;
 if files is null or gmail_files is null or exists(select 1 from unnest(files) as f(file_id) where not exists(select 1 from public.documents d where d.id=f.file_id and d.opportunity_id=o.id and d.status='approved' and d.storage_path is not null)) or exists(select 1 from unnest(gmail_files) as f(file_id) where not exists(select 1 from public.gmail_saved_attachments d where d.id=f.file_id and d.opportunity_id=o.id and d.status='approved' and d.storage_path is not null)) then raise exception 'Approved case attachments required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(request::text,27));
 select * into previous from public.outbox where request_key=request::text;
 if previous.id is not null then
  if previous.requested_by is distinct from auth.uid() or previous.opportunity_id is distinct from case_id or previous.account_id is distinct from account or previous.to_email is distinct from recipient or previous.subject is distinct from subject_text or previous.body is distinct from body_text or previous.attachment_ids is distinct from files or previous.gmail_file_ids is distinct from gmail_files then raise exception 'Request key reused with different input'; end if;
  return previous.id;
 end if;
 insert into public.outbox(account_id,opportunity_id,to_email,subject,body,area,attachment_ids,gmail_file_ids,message_id_header,requested_by,request_key,available_at)
 values(account,case_id,recipient,subject_text,body_text,phase,files,gmail_files,'<'||request::text||'@crm.curated.local>',auth.uid(),request::text,greatest(now(),a.send_retry_at)) returning id into target;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'outbox',target,'manual_email_queued');
 return target;
end $function$
;

CREATE OR REPLACE FUNCTION public.recheck_outbox_delivery(message uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.campaigns;e public.campaign_enrollments;o public.opportunities;m public.outbox;
begin
 if not s01_i02.delivery_allowed(message) then update public.outbox set status='paused',last_error='AREA_ACCESS_REVOKED' where id=message and status in ('queued','sending');return false;end if;
 if not public.recheck_outbox_delivery_v42(message) then return false;end if;
 select * into m from public.outbox where id=message;
 select * into e from public.campaign_enrollments where id=m.enrollment_id;
 select * into c from public.campaigns where id=e.campaign_id;
 if c.first_contact then
  select * into o from public.opportunities where id=e.opportunity_id;
  if c.scheduled_at>now() then update public.outbox set status='queued',sending_at=null,available_at=c.scheduled_at where id=m.id;return false;end if;
  if e.step<>0 or not e.contact_id=any(c.selected_contact_ids) or o.stage not in ('new','contacting') or o.application_complete or o.last_contact is not null
   or not exists(select 1 from public.leads l where l.contact_id=e.contact_id and l.opportunity_id=o.id)
   or exists(select 1 from public.opportunities x where x.contact_id=e.contact_id and (x.handed_off_at is not null or x.stage not in ('new','contacting') or x.application_complete or x.archived_at is not null)) then
   update public.outbox set status='cancelled' where id=m.id;
   update public.campaign_enrollments set status='goal_met' where id=e.id;return false;
  end if;
 end if;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.recheck_outbox_delivery_v42(message uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.outbox;a public.mail_accounts;c public.campaigns;e public.campaign_enrollments;o public.opportunities;ct public.contacts;actor public.profiles;usage jsonb;
begin
 if not s01_i02.delivery_allowed(message) then update public.outbox set status='paused',last_error='AREA_ACCESS_REVOKED' where id=message and status in ('queued','sending');return false;end if;
 select * into m from public.outbox where id=message for update;
 if m.id is null or m.status<>'sending' then return false;end if;
 select * into a from public.mail_accounts where id=m.account_id for update;
 select * into actor from public.profiles where id=m.requested_by and active;
 if a.status<>'connected' or (m.opportunity_id is not null and (actor.id is null or not (actor.role='superadmin' or exists(select 1 from public.mail_permissions p where p.account_id=a.id and p.user_id=actor.id and p.can_send)))) then update public.outbox set status='paused' where id=m.id;return false;end if;
 usage:=public.account_delivery_usage(a.id);
 if a.send_retry_at>now() or (usage->>'total_messages')::int>a.daily_limit or (usage->>'recipient_count')::int>2000 then update public.outbox set status='queued',sending_at=null,available_at=greatest(now()+interval '1 minute',coalesce(a.send_retry_at,now())) where id=m.id;return false;end if;
 if m.enrollment_id is not null then
  select * into e from public.campaign_enrollments where id=m.enrollment_id;
  select * into c from public.campaigns where id=e.campaign_id;
  select * into o from public.opportunities where id=m.opportunity_id;
  select * into ct from public.contacts where id=e.contact_id;
  if e.status<>'active' or ct.verification<>'valid' or ct.id=any(c.excluded_contact_ids) or exists(select 1 from public.suppressions s where s.email=m.to_email) or o.archived_at is not null or o.handed_off_at is not null or o.stage in ('lost','paused','funded') or (c.requires_application and o.application_complete) then update public.outbox set status='cancelled' where id=m.id;return false;end if;
  if c.status<>'active' or extract(hour from now() at time zone c.timezone)<c.start_hour or extract(hour from now() at time zone c.timezone)>=c.end_hour or a.external_usage_synced_at is null or a.external_usage_synced_at<now()-interval '15 minutes' or (usage->>'campaign_messages')::int>a.campaign_daily_limit or (usage->>'total_messages')::int>a.daily_limit-a.operational_reserve then update public.outbox set status='queued',sending_at=null,available_at=now()+interval '1 minute' where id=m.id;return false;end if;
 elsif m.area='seller' and not m.campaign_test and exists(select 1 from public.suppressions s where s.email=m.to_email) then
  update public.outbox set status='cancelled' where id=m.id;return false;
 end if;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.register_document(document_id uuid, path text, content_hash text, source text, actor uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare doc public.documents; o public.opportunities;
begin
 if actor is not null and not public.mail_document_write_allowed(document_id,actor) then raise exception 'Case and area access required';end if;
 select * into doc from public.documents where id=document_id for update;
 select * into o from public.opportunities where id=doc.opportunity_id;
 if doc.id is null then raise exception 'Document not found'; end if;
 if doc.content_hash=register_document.content_hash then return; end if;
 insert into public.document_versions(document_id,storage_path,content_hash,source,actor_id) values(doc.id,path,content_hash,source,actor) on conflict do nothing;
 update public.documents set storage_path=path,content_hash=register_document.content_hash,source=register_document.source,status='received',reviewed_by=null,reviewed_at=null where id=doc.id;
 insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,'document',case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end,'Document received; review required');
 perform public.notify_user(coalesce(o.closer_id,o.seller_id),'document:'||doc.id||':'||content_hash,'Document received');
end $function$
;

CREATE OR REPLACE FUNCTION public.register_mail_contact(case_id uuid, address text, display_name text, lender uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare chosen_company uuid;chosen_contact uuid;
begin
 perform s01_i02.assert_write(case_id);
 if not coalesce(public.can_mail_case(case_id),false) then raise exception 'Case access required';end if;
 address:=lower(btrim(address));
 if address !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(address)>254 or length(display_name)>150 then raise exception 'Invalid contact';end if;
 if exists(select 1 from public.gmail_team_members where email=address) or exists(select 1 from public.mail_accounts where email=address) then raise exception 'Internal addresses are managed in team settings';end if;
 if lender is not null then
  if exists(select 1 from public.contacts c join public.company_contacts cc on cc.contact_id=c.id where c.email=address and cc.relationship in ('primary','contact')) then raise exception 'Address already registered as a client';end if;
  if not exists(select 1 from public.lenders where id=lender and archived_at is null) or exists(select 1 from public.lender_contacts where email=address and lender_id<>lender) then raise exception 'Confirm the lender and address';end if;
  insert into public.lender_contacts(email,lender_id,created_by,name) values(address,lender,auth.uid(),coalesce(display_name,'')) on conflict(email) do update set name=excluded.name where public.lender_contacts.lender_id=excluded.lender_id;
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
end $function$
;

-- Pending mailbox review is not permission to reopen a linked closer source.
-- mail_pending_threads is explicitly defined above.
-- gmail_followups is explicitly defined above.

-- A visible message does not grant arbitrary snapshots or names in the same case.
create function public.mail_snapshot_allowed(message uuid,file uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.outbox o cross join lateral jsonb_array_elements(case when jsonb_typeof(o.attachment_snapshot)='array' then o.attachment_snapshot else '[]'::jsonb end) s
 where o.id=message and public.can_area(o.opportunity_id,o.area) and s->>'id'=file::text
 and (exists(select 1 from public.document_versions v join public.documents d on d.id=v.document_id where d.id=file and d.opportunity_id=o.opportunity_id and v.content_hash=s->>'content_hash' and v.storage_path=s->>'storage_path' and coalesce(s->>'bucket','case-documents')='case-documents' and s01_i02.can_source('version',v.id,s->>'content_hash'))
 or exists(select 1 from public.documents d where d.id=file and d.opportunity_id=o.opportunity_id and d.content_hash=s->>'content_hash' and d.storage_path=s->>'storage_path' and coalesce(s->>'bucket','case-documents')='case-documents' and s01_i02.can_source('document',d.id,s->>'content_hash'))
 or exists(select 1 from public.gmail_saved_attachments g where g.id=file and g.opportunity_id=o.opportunity_id and g.content_hash=s->>'content_hash' and g.storage_path=s->>'storage_path' and coalesce(s->>'bucket','gmail-documents')='gmail-documents' and s01_i02.can_source('saved',g.id,s->>'content_hash'))
 or exists(select 1 from public.mail_uploads u where u.id=file and u.opportunity_id=o.opportunity_id and u.content_hash=s->>'content_hash' and u.storage_path=s->>'storage_path' and coalesce(s->>'bucket','gmail-documents')='gmail-documents' and s01_i02.can_source('upload',u.id,s->>'content_hash'))))
$$;
create function s01_i02.can_outbox(message uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare m public.outbox;s jsonb;f uuid;
begin
 if public.current_app_role()='superadmin' then return true;end if;
 select * into m from public.outbox where id=message;
 if m.id is null or not coalesce(public.can_area(m.opportunity_id,m.area),false) then return false;end if;
 if jsonb_typeof(coalesce(m.attachment_snapshot,'[]'))<>'array' then return false;end if;
 for s in select value from jsonb_array_elements(coalesce(m.attachment_snapshot,'[]')) loop
  if coalesce(s->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
  if not public.mail_snapshot_allowed(m.id,(s->>'id')::uuid) then return false;end if;
 end loop;
 if jsonb_array_length(coalesce(m.attachment_snapshot,'[]'))>0 then return true;end if;
 foreach f in array coalesce(m.attachment_ids,'{}') loop
  if not s01_i02.can_source('document',f) then return false;end if;
 end loop;
 foreach f in array coalesce(m.gmail_file_ids,'{}') loop
  if not s01_i02.can_source('saved',f) then return false;end if;
 end loop;
 foreach f in array coalesce(m.upload_ids,'{}') loop
  if not s01_i02.can_source('upload',f) then return false;end if;
 end loop;
 return true;
end $$;
create policy s01_i02_outbox on public.outbox for select to authenticated using(public.can_area(opportunity_id,area));
create policy s01_i02_bound on public.outbox as restrictive for select to authenticated using(s01_i02.can_outbox(id));
revoke select on public.outbox from authenticated;
grant select(id,conversation_id,reply_message_id,account_id,opportunity_id,to_email,cc_emails,body,subject,status,message_id_header,gmail_message_id,created_at,sent_at,last_error,attachment_snapshot,attachment_ids,gmail_file_ids,upload_ids) on public.outbox to authenticated;
create function s01_i02.visible_admin_outbox() returns setof public.outbox
language sql stable security definer set search_path='' as $$
 select o.* from public.outbox o where public.current_app_role()='superadmin'
$$;
create view public.mail_admin_outbox_visible with(security_invoker=true) as select * from s01_i02.visible_admin_outbox();
grant select on public.mail_admin_outbox_visible to authenticated,service_role;

revoke all on all functions in schema s01_i02 from public,anon,authenticated,service_role;
-- Read predicates/projections are scoped to the current authenticated JWT.
grant execute on function s01_i02.can_outbox(uuid),s01_i02.visible_phase(uuid),s01_i02.visible_notification(text),s01_i02.can_message(uuid),s01_i02.can_conversation(uuid),s01_i02.can_archive(uuid),s01_i02.can_content(uuid,public.case_area),s01_i02.can_source(text,uuid,text),s01_i02.visible_conversations(),s01_i02.visible_processes(),s01_i02.visible_archive(),s01_i02.visible_admin_outbox() to authenticated,service_role;
revoke all on function public.mail_access_context(uuid),public.mail_source_allowed(text,uuid,text),public.mail_snapshot_allowed(uuid,uuid) from public,anon;
grant execute on function public.mail_access_context(uuid),public.mail_source_allowed(text,uuid,text),public.mail_snapshot_allowed(uuid,uuid) to authenticated;
revoke all on function public.mail_document_write_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mail_document_write_allowed(uuid,uuid) to service_role;
commit;
