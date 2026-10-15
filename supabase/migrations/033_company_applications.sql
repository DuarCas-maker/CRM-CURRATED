begin;
create table public.company_applications (
 company_id uuid primary key references public.companies,revision int not null default 1,
 encrypted_payload text not null,updated_by uuid not null references public.profiles,updated_at timestamptz not null default now()
);
create table public.company_application_versions (
 company_id uuid not null references public.companies,revision int not null,encrypted_payload text not null,
 created_by uuid not null references public.profiles,created_at timestamptz not null default now(),primary key(company_id,revision)
);
alter table public.company_applications enable row level security;
alter table public.company_application_versions enable row level security;
-- Sensitive application contents are decrypted only by the server after can_edit_case.
revoke all on public.company_applications,public.company_application_versions from anon,authenticated;
grant all on public.company_applications,public.company_application_versions to service_role;
create function public.save_company_application(case_id uuid,payload text,expected_revision int,acting_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.opportunities;current_version int;next_version int;previous_claims text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',acting_user,'aal','aal2','role','authenticated')::text,true);
 select * into o from public.opportunities where id=case_id for update;
 if o.id is null or not public.can_edit_case(o.id) then raise exception 'Case is inaccessible or read-only';end if;
 if length(payload)>500000 then raise exception 'Application too large';end if;
 if o.company_id is null then
  select company_id into o.company_id from public.contacts where id=o.contact_id for update;
  if o.company_id is null then
   insert into public.companies(name) values(o.company) returning id into o.company_id;
   update public.contacts set company_id=o.company_id where id=o.contact_id and company_id is null;
  end if;
  update public.opportunities set company_id=o.company_id where id=o.id;
 end if;
 perform 1 from public.companies where id=o.company_id for update;
 select revision into current_version from public.company_applications where company_id=o.company_id;
 if coalesce(current_version,0)<>expected_revision then raise exception 'Application changed; reload before saving';end if;
 next_version:=coalesce(current_version,0)+1;
 insert into public.company_applications(company_id,revision,encrypted_payload,updated_by) values(o.company_id,next_version,payload,acting_user)
 on conflict(company_id) do update set revision=excluded.revision,encrypted_payload=excluded.encrypted_payload,updated_by=excluded.updated_by,updated_at=now();
 insert into public.company_application_versions(company_id,revision,encrypted_payload,created_by) values(o.company_id,next_version,payload,acting_user);
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(acting_user,'company',o.company_id,'application_saved',jsonb_build_object('opportunity_id',o.id,'revision',next_version));
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 return jsonb_build_object('revision',next_version);
end $$;
create function public.register_company_application_pdf(case_id uuid,document uuid,revision int,path text,content_hash text,signed boolean,acting_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.opportunities;previous_claims text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',acting_user,'aal','aal2','role','authenticated')::text,true);
 select * into o from public.opportunities where id=case_id for update;
 if o.id is null or not public.can_edit_case(o.id) then raise exception 'Case is inaccessible or read-only';end if;
 if o.company_id is null then
  select company_id into o.company_id from public.contacts where id=o.contact_id;
  update public.opportunities set company_id=o.company_id where id=o.id;
 end if;
 perform 1 from public.company_applications a where a.company_id=o.company_id and a.revision=register_company_application_pdf.revision for update;
 if not found then raise exception 'Application changed; reload before generating';end if;
 if not exists(select 1 from public.documents where id=document and opportunity_id=o.id and kind='application') then raise exception 'Application document required';end if;
 if path !~ ('^'||case_id::text||'/'||document::text||'/'||content_hash||'[.]pdf$') or not exists(select 1 from storage.objects where bucket_id='case-documents' and name=path) then raise exception 'Uploaded PDF required';end if;
 perform public.register_document(document,path,content_hash,'company_application',acting_user);
 update public.opportunities set application_complete=true,application_signed=signed where id=o.id;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(acting_user,'document',document,'company_application_generated',jsonb_build_object('revision',revision,'signed',signed));
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
end $$;
revoke all on function public.save_company_application(uuid,text,int,uuid),public.register_company_application_pdf(uuid,uuid,int,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.save_company_application(uuid,text,int,uuid),public.register_company_application_pdf(uuid,uuid,int,text,text,boolean,uuid) to service_role;
-- An unsigned generated draft cannot be approved as a signed application.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.case_document_command_internal(text,jsonb,uuid)'::regprocedure);
 definition:=replace(definition,$old$elsif kind='review_document' then$old$,$new$elsif kind='review_document' then
  if doc.kind='application' and p->>'status'='approved' and doc.source='company_application' and not o.application_signed then raise exception 'A signed application is required; this PDF is an unsigned draft';end if;
  if doc.kind='application' and p->>'status'='approved' then update public.opportunities set application_complete=true,application_signed=true where id=o.id;end if;
$new$);
 execute definition;
end $$;
notify pgrst,'reload schema';commit;
