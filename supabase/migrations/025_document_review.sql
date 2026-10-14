begin;

alter table public.documents add column review_notes text not null default '';
alter table public.gmail_saved_attachments add column imported_document_id uuid references public.documents;
alter table public.document_versions add column source_attachment_id uuid references public.message_attachments;
alter table public.document_versions add column source_gmail_file_id uuid references public.gmail_saved_attachments;
create table public.document_reviews (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents,
 content_hash text not null, status text not null check(status in ('received','approved','correction')),
 notes text not null default '', reviewer_id uuid not null references public.profiles,
 period text not null default '',
 reviewed_at timestamptz not null default now()
);
alter table public.document_reviews enable row level security;
create policy document_reviews_read on public.document_reviews for select to authenticated
 using(exists(select 1 from public.documents d where d.id=document_id and public.can_case(d.opportunity_id)));
grant select on public.document_reviews to authenticated;
grant all on public.document_reviews to service_role;

-- Receipt, file association and review are committed in one transaction.
create function public.case_document_command_internal(kind text,p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); o public.opportunities; doc public.documents;
 receipt public.command_receipts; result jsonb; source_case uuid; linked uuid;
 area public.case_area; target uuid; file_hash text; file_path text; source_kind text;
begin
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
  if doc.storage_path is null or doc.content_hash is null then raise exception 'Received document required'; end if;
  if doc.content_hash is distinct from p->>'expected_hash' then raise exception 'Document changed; reopen the review'; end if;
  if p->>'status' not in ('received','approved','correction') then raise exception 'Invalid review status'; end if;
  if length(coalesce(p->>'notes',''))>4000 then raise exception 'Review notes too long'; end if;
  if p->>'status'='correction' and coalesce(btrim(p->>'notes'),'')='' then raise exception 'Explain the requested correction'; end if;
  if coalesce(p->>'period',doc.period)<>doc.period and doc.kind='bank_statement' then
   if p->>'period' !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Statement month required'; end if;
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
end $$;
revoke all on function public.case_document_command_internal(text,jsonb,uuid) from public,anon,authenticated;

create function public.case_document_command(kind text,p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if kind<>'review_document' then raise exception 'Server incorporation required'; end if;
 return public.case_document_command_internal(kind,p,request_key);
end $$;
revoke all on function public.case_document_command(text,jsonb,uuid) from public,anon;
grant execute on function public.case_document_command(text,jsonb,uuid) to authenticated;

-- Only the server that validated and read the original bytes may associate their provenance.
create function public.incorporate_case_document(p jsonb,request_key uuid,acting_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous_claims text:=current_setting('request.jwt.claims',true);result jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',acting_user,'aal','aal2','role','authenticated')::text,true);
 result:=public.case_document_command_internal('incorporate_document',p,request_key);
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 return result;
end $$;
revoke all on function public.incorporate_case_document(jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.incorporate_case_document(jsonb,uuid,uuid) to service_role;

-- The older generic command must not bypass version checks or review history.
alter function public.crm_command(text,jsonb,uuid) rename to crm_command_v24_documents;
do $$ begin
 execute replace(pg_get_functiondef('public.crm_command_v24_documents(text,jsonb,uuid)'::regprocedure),
 'crm_command.request_key','crm_command_v24_documents.request_key');
end $$;
revoke all on function public.crm_command_v24_documents(text,jsonb,uuid) from public,anon,authenticated;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if kind='review_document' then
  return public.case_document_command(kind,p||jsonb_build_object('document_id',coalesce(p->>'document_id',p->>'id')),request_key);
 end if;
 return public.crm_command_v24_documents(kind,p,request_key);
end $$;
revoke all on function public.crm_command(text,jsonb,uuid) from public,anon;
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated;

-- Replacing a file invalidates the notes attached to the old review.
create function public.clear_replaced_document_review() returns trigger language plpgsql set search_path='' as $$
begin
 if old.content_hash is distinct from new.content_hash then new.review_notes:=''; end if;
 return new;
end $$;
create trigger document_review_replacement before update of content_hash on public.documents
 for each row execute function public.clear_replaced_document_review();
notify pgrst,'reload schema';
commit;
