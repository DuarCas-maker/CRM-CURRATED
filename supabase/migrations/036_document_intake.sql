begin;
-- Content classification is private, cached by exact file version, and never approves files.
create table public.document_classifications (
 opportunity_id uuid not null references public.opportunities,
 source text not null check(source in ('saved','legacy','upload')),
 source_id uuid not null, content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 status text not null check(status in ('processing','ready','failed')),
 suggestion jsonb, updated_at timestamptz not null default now(),
 primary key(opportunity_id,source,source_id,content_hash)
);
alter table public.document_classifications enable row level security;
revoke all on public.document_classifications from public,anon,authenticated;
grant all on public.document_classifications to service_role;

create function public.receive_case_document(p jsonb, request_key uuid, acting_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous_claims text:=current_setting('request.jwt.claims',true); case_id uuid:=(p->>'opportunity_id')::uuid;
 target uuid:=(p->>'document_id')::uuid; doc public.documents; receipt public.command_receipts;
 bank text:=btrim(coalesce(p->>'bank_name','')); doc_kind text:=p->>'kind'; number int; result jsonb;
 approve boolean:=coalesce((p->>'approve')::boolean,false); filename text:=btrim(coalesce(p->>'name',''));
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',acting_user,'aal','aal2','role','authenticated')::text,true);
 if acting_user is null or public.current_app_role() is null or request_key is null then raise exception 'Invitation, MFA and idempotency key required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(acting_user::text||request_key::text,0));
 perform 1 from public.opportunities where id=case_id for update;
 if not public.can_edit_case(case_id) then raise exception 'Case is inaccessible or read-only'; end if;
 select * into receipt from public.command_receipts r where r.user_id=acting_user and r.request_key=receive_case_document.request_key;
 if found then
  if receipt.kind<>'receive_document' or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused with different input'; end if;
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true); return receipt.result;
 end if;
 if doc_kind is null or doc_kind not in ('bank_statement','application','additional') then raise exception 'Document type required'; end if;
 if doc_kind='bank_statement' and (bank='' or length(bank)>120) then raise exception 'Bank name required'; end if;
 if doc_kind='additional' and (filename='' or length(filename)>200) then raise exception 'Document name required'; end if;
 if approve and not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirm you reviewed the file'; end if;
 if coalesce(p->>'expected_source_hash','') !~ '^[a-f0-9]{64}$' or p->>'content_hash' is distinct from p->>'expected_source_hash' then raise exception 'Source file changed; reopen the review'; end if;
 select * into doc from public.documents where id=target for update;
 if found then
  if doc.opportunity_id<>case_id or doc.kind<>doc_kind then raise exception 'Document belongs to another opportunity or type'; end if;
  if doc.content_hash is distinct from nullif(p->>'expected_target_hash','') then raise exception 'Document changed; reopen the review'; end if;
  if doc.storage_path is not null and nullif(p->>'replace_document_id','')::uuid is distinct from doc.id then raise exception 'Document changed; choose replacement explicitly'; end if;
 end if;
 if doc_kind='bank_statement' then
  select coalesce((select d.bank_name from public.documents d where d.opportunity_id=case_id and d.kind='bank_statement' and lower(btrim(d.bank_name))=lower(bank) order by d.created_at,d.id limit 1),bank) into bank;
  if doc.id is not null and lower(btrim(doc.bank_name))=lower(bank) then number:=doc.statement_number;
  else select coalesce(max(d.statement_number),0)+1 into number from public.documents d where d.opportunity_id=case_id and d.kind='bank_statement' and lower(btrim(d.bank_name))=lower(bank); end if;
  filename:='Bank Statement '||number;
 elsif doc_kind='application' then filename:='Signed application'; bank:='';
 else bank:=''; end if;
 if doc.id is null then
  insert into public.documents(id,opportunity_id,name,kind,bank_name,statement_number,required)
   values(target,case_id,filename,doc_kind,bank,number,doc_kind='application');
 else
  update public.documents set name=filename,bank_name=bank,statement_number=number where id=target;
 end if;
 if not exists(select 1 from public.documents where opportunity_id=case_id and kind='application') then
  insert into public.documents(opportunity_id,name,kind,required) values(case_id,'Signed application','application',true);
 end if;
 if p->>'source'='upload' then
  if p->>'content_hash' !~ '^[a-f0-9]{64}$' or p->>'storage_path' !~ ('^'||case_id::text||'/'||target::text||'/'||(p->>'content_hash')||'[.](pdf|jpg|png)$')
   or not exists(select 1 from storage.objects where bucket_id='case-documents' and name=p->>'storage_path') then raise exception 'Uploaded document required'; end if;
  perform public.register_document(target,p->>'storage_path',p->>'content_hash','team_upload',acting_user);
  result:=jsonb_build_object('document_id',target,'opportunity_id',case_id);
  insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(acting_user,'document',target,'receive_document',jsonb_build_object('content_hash',p->>'content_hash','source','team_upload'));
 else
  result:=public.case_document_command_internal('incorporate_document',p||jsonb_build_object('expected_hash',p->'expected_target_hash'),gen_random_uuid());
 end if;
 if approve then
  perform public.case_document_command_internal('review_document',jsonb_build_object('opportunity_id',case_id,'document_id',target,'expected_hash',p->>'content_hash','status','approved','notes','','period',(select period from public.documents where id=target)),gen_random_uuid());
 end if;
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(acting_user,request_key,'receive_document',result,md5(p::text));
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 return result;
end $$;
revoke all on function public.receive_case_document(jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.receive_case_document(jsonb,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
