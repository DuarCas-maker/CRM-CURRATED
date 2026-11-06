-- I02 LOCAL SANDBOX ONLY. Not an application migration.
begin;
do $$ begin
 if current_setting('pipeline_os.i02_sandbox',true) is distinct from 'in_memory_test' then
  raise exception 'I02 sandbox marker required';
 end if;
 if to_regnamespace('s01_i02') is not null then raise exception 'I02 already installed';end if;
end $$;

-- Session-local catalog evidence also makes the fixture-only reversal exact.
create temporary table s01_i02_original_functions as
 select oid::regprocedure::text signature,pg_get_functiondef(oid) definition
 from pg_proc where pronamespace='public'::regnamespace and prokind='f';
create temporary table s01_i02_original_policies as
 select * from pg_policies where schemaname in ('public','storage');
create temporary table s01_i02_original_grants as
 select c.oid::regclass::text relation,a.attname,pg_get_userbyid(x.grantee) grantee,x.privilege_type,x.is_grantable
 from pg_class c left join pg_attribute a on a.attrelid=c.oid and a.attnum>0
 cross join lateral aclexplode(case when a.attnum is null then c.relacl else a.attacl end) x
 where false;
insert into s01_i02_original_grants
 select c.oid::regclass::text,null,case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable
 from pg_class c cross join lateral aclexplode(c.relacl) x
 where c.oid in ('public.conversations'::regclass,'public.outbox'::regclass)
 union all
 select c.oid::regclass::text,a.attname,case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable
 from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 cross join lateral aclexplode(a.attacl) x
 where c.oid in ('public.conversations'::regclass,'public.outbox'::regclass);

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
do $$ declare r record;guard text;definition text;needle text;begin
 for r in select p.oid,p.proname,pg_get_functiondef(p.oid) def from pg_proc p where p.pronamespace='public'::regnamespace and
 (p.proname like 'crm_command%' or p.proname in ('queue_mail_email','queue_manual_email','queue_lender_emails','queue_lender_reply','queue_mail_lenders','queue_mail_forward','associate_live_mail','associate_live_mail_v23','register_mail_contact','claim_outbox','claim_outbox_v7','claim_outbox_v15','recheck_outbox_delivery','recheck_outbox_delivery_v42','register_document','case_document_command_internal','notify_user')) loop
  guard:=null;
  if r.proname like 'crm_command%' then
   guard:='if kind=''reply'' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>''conversation_id'')::uuid));elsif kind=''lender_email'' then perform s01_i02.assert_write((p->>''opportunity_id'')::uuid);if not coalesce(public.can_area((p->>''opportunity_id'')::uuid,''closer''),false) then raise exception ''Closer area access required'';end if;end if;';
  elsif r.proname='queue_mail_email' then
   r.def:=replace(r.def,'if subject_text<>c.subject then','if subject_text<>(select v.subject from s01_i02.visible_conversations() v where v.id=c.id) then');
   guard:='perform s01_i02.assert_sources(case_id,files,gmail_files,uploads,reply_message);if (submission is not null or exists(select 1 from public.conversations i02_thread where i02_thread.id=conversation and i02_thread.submission_id is not null)) and not coalesce(public.can_area(case_id,''closer''),false) then raise exception ''Closer area access required'';end if;';
  elsif r.proname in ('queue_manual_email','queue_lender_emails') then guard:='perform s01_i02.assert_sources(case_id,files,gmail_files,''{}''::uuid[]);';
  elsif r.proname in ('queue_mail_lenders','queue_mail_forward','queue_lender_reply') then
   guard:='perform s01_i02.assert_sources((input->>''case_id'')::uuid,array(select jsonb_array_elements_text(input->''files'')::uuid),array(select jsonb_array_elements_text(input->''gmail_files'')::uuid),array(select jsonb_array_elements_text(input->''uploads'')::uuid),coalesce(input->>''forward_message_id'',input->>''reply_message'')::uuid);';
   if r.proname in ('queue_mail_lenders','queue_lender_reply') then guard:=guard||'if not coalesce(public.can_area((input->>''case_id'')::uuid,''closer''),false) then raise exception ''Closer area access required'';end if;';end if;
   if r.proname='queue_mail_forward' then guard:=guard||'if exists(select 1 from jsonb_array_elements_text(input->''forward_file_ids'') f where not (s01_i02.can_source(''saved'',f::uuid) or exists(select 1 from public.outbox o join public.messages m on m.internet_message_id=o.message_id_header and m.id=(input->>''forward_message_id'')::uuid where o.opportunity_id=(input->>''case_id'')::uuid and public.mail_snapshot_allowed(o.id,f::uuid)))) then raise exception ''Original attachment access required'';end if;';end if;
  elsif r.proname in ('associate_live_mail','associate_live_mail_v23') then guard:='perform s01_i02.assert_write(case_id);if submission is not null and not coalesce(public.can_area(case_id,''closer''),false) then raise exception ''Closer area access required'';end if;';
  elsif r.proname='register_mail_contact' then guard:='perform s01_i02.assert_write(case_id);';
  elsif r.proname='register_document' then guard:='if actor is not null and not public.mail_document_write_allowed(document_id,actor) then raise exception ''Case and area access required'';end if;';
  elsif r.proname='case_document_command_internal' then guard:='perform s01_i02.assert_write((p->>''opportunity_id'')::uuid);if p->>''source_id'' is not null and not s01_i02.can_source(p->>''source'',(p->>''source_id'')::uuid) then raise exception ''Source access required'';end if;';
  elsif r.proname='notify_user' then guard:='if not s01_i02.actor_notification_allowed(recipient,event) then return;end if;';
  elsif r.proname like 'recheck_outbox%' then
   guard:='if not s01_i02.delivery_allowed(message) then update public.outbox set status=''paused'',last_error=''AREA_ACCESS_REVOKED'' where id=message and status in (''queued'',''sending'');return false;end if;';
  elsif r.proname like 'claim_outbox%' then
   guard:='update public.outbox set status=''paused'',last_error=''AREA_ACCESS_REVOKED'' where status=''queued'' and opportunity_id is not null and not s01_i02.delivery_allowed(id);';
  end if;
  if guard is not null then
   definition:=regexp_replace(r.def,'\mbegin\M',E'begin\n '||guard,'i');
   if definition=r.def then raise exception 'Unsupported function body: %',r.proname;end if;
   execute definition;
  end if;
 end loop;
end $$;

-- Pending mailbox review is not permission to reopen a linked closer source.
do $$ declare definition text;begin
 select pg_get_functiondef('public.mail_pending_threads(integer)'::regprocedure) into definition;
 definition:=replace(definition,'where r.status=''pending''','where s01_i02.can_archive(m.id) and r.status=''pending''');
 execute definition;
end $$;
do $$ declare definition text;original text;begin
 select pg_get_functiondef('public.gmail_followups()'::regprocedure) into original;
 definition:=replace(original,'recipient:=case when w.area=''closer'' then coalesce(o.closer_id,o.seller_id) else o.seller_id end;',
 'recipient:=case when w.area=''closer'' then o.closer_id else o.seller_id end;if not s01_i02.actor_can_read(recipient,o.id,w.area) then continue;end if;');
 if definition=original then raise exception 'Unsupported followup definition';end if;
 execute definition;
end $$;

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
