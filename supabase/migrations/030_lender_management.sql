begin;
alter table public.lenders add column guidelines jsonb;
alter table public.lenders add column guideline_version int not null default 0;
create table public.lender_guideline_versions(lender_id uuid not null references public.lenders,version int not null,guidelines jsonb not null,created_by uuid not null references public.profiles,created_at timestamptz not null default now(),primary key(lender_id,version));
alter table public.lender_guideline_versions enable row level security;
create policy guideline_versions_read on public.lender_guideline_versions for select to authenticated using(public.current_app_role() is not null);
grant select on public.lender_guideline_versions to authenticated;grant all on public.lender_guideline_versions to service_role;
create function public.save_lender_guidelines(lender uuid,g jsonb,expected_version int,request_key uuid) returns int language plpgsql security definer set search_path='' as $$
declare current public.lenders;receipt public.command_receipts;fp text:=md5(jsonb_build_object('lender',lender,'guidelines',g,'version',expected_version)::text);number int;
begin
 if coalesce(public.current_app_role()::text,'') not in ('superadmin','closer_admin') then raise exception 'Lender administrator and MFA required';end if;
 if request_key is null then raise exception 'Request key required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts r where r.user_id=auth.uid() and r.request_key=save_lender_guidelines.request_key;
 if found then if receipt.kind<>'lender_guidelines' or receipt.fingerprint<>fp then raise exception 'Idempotency key reused';end if;return (receipt.result->>'version')::int;end if;
 if coalesce(jsonb_typeof(g),'')<>'object' or coalesce(g->>'tier','') not in ('1','2','3','4','5','6','reverse','unknown') or octet_length(g::text)>20000
  or coalesce(jsonb_typeof(g->'verified'),'')<>'boolean' or coalesce(jsonb_typeof(g->'industries'),'')<>'array' or coalesce(jsonb_typeof(g->'excluded_industries'),'')<>'array'
  or (g->>'min_credit')::int not between 300 and 850 or (g->>'min_months_in_business')::int not between 0 and 1200 or (g->>'max_positions')::int not between 0 and 100
  or ((g->>'verified')::boolean and (coalesce(btrim(g->>'source'),'')='' or nullif(g->>'as_of','') is null)) then raise exception 'Invalid guidelines or missing source/date';end if;
 if nullif(g->>'as_of','') is not null then perform (g->>'as_of')::date;end if;
 select * into current from public.lenders where id=lender and archived_at is null for update;
 if current.id is null or current.guideline_version is distinct from expected_version then raise exception 'Guidelines changed; reload';end if;
 number:=current.guideline_version+1;
 update public.lenders set guidelines=g,guideline_version=number where id=lender;
 insert into public.lender_guideline_versions values(lender,number,g,auth.uid(),now());
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request_key,'lender_guidelines',jsonb_build_object('version',number),fp);
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'lender',lender,'guidelines_saved',jsonb_build_object('version',number));
 return number;
end $$;
revoke all on function public.save_lender_guidelines(uuid,jsonb,int,uuid) from public,anon;grant execute on function public.save_lender_guidelines(uuid,jsonb,int,uuid) to authenticated;

create function public.import_lender_directory(rows jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare row jsonb;firm public.lenders;receipt public.command_receipts;address text;company text;created int:=0;added int:=0;existing_contacts int:=0;result jsonb;contact_name text;
begin
 if coalesce(public.current_app_role()::text,'') not in ('superadmin','closer_admin') then raise exception 'Lender administrator and MFA required';end if;
 if request_key is null or coalesce(jsonb_typeof(rows),'')<>'array' or jsonb_array_length(rows) not between 1 and 1000 or octet_length(rows::text)>1048576 then raise exception 'Maximum 1000 rows and 1 MB';end if;
 perform pg_advisory_xact_lock(hashtextextended('lender-directory-import',0));
 select * into receipt from public.command_receipts r where r.user_id=auth.uid() and r.request_key=import_lender_directory.request_key;
 if found then if receipt.kind<>'lender_import' or receipt.fingerprint<>md5(rows::text) then raise exception 'Idempotency key reused';end if;return receipt.result;end if;
 for row in select value from jsonb_array_elements(rows) loop
  company:=btrim(row->>'company');address:=lower(btrim(coalesce(row->>'email','')));contact_name:=btrim(coalesce(row->>'contact',''));
  if coalesce(company,'')='' or length(company)>200 or length(contact_name)>200 then raise exception 'Company and valid contact required';end if;
  if (select count(*) from public.lenders where archived_at is null and lower(btrim(name))=lower(company))>1 then raise exception 'Ambiguous company: %',company;end if;
  select * into firm from public.lenders where archived_at is null and lower(btrim(name))=lower(company) for update;
  if address<>'' and exists(select 1 from public.lender_contacts where email=address and lender_id is distinct from firm.id) then raise exception 'Email belongs to another company: %',address;end if;
  if firm.id is null then
   insert into public.lenders(name,email,channel,products,notes) values(company,address,coalesce(row->>'channel','email'),array(select btrim(value) from regexp_split_to_table(coalesce(row->>'products',''),'[,;]') value where btrim(value)<>''),coalesce(row->>'notes','')||case when coalesce(row->>'portal_url','')<>'' then E'\nPortal: '||(row->>'portal_url') else '' end) returning * into firm;created:=created+1;
   if address<>'' then added:=added+1;end if;
  elsif address<>'' then
   if exists(select 1 from public.lender_contacts where email=address) then existing_contacts:=existing_contacts+1;
   else insert into public.lender_contacts(email,lender_id,name,created_by) values(address,firm.id,contact_name,auth.uid());added:=added+1;end if;
  end if;
  if address<>'' and contact_name<>'' then update public.lender_contacts set name=contact_name where email=address and lender_id=firm.id and btrim(name)='';end if;
 end loop;
 result:=jsonb_build_object('new_companies',created,'new_contacts',added,'existing_contact_rows',existing_contacts,'rows',jsonb_array_length(rows));
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request_key,'lender_import',result,md5(rows::text));
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'lender_import',request_key,'imported',result);
 return result;
end $$;
revoke all on function public.import_lender_directory(jsonb,uuid) from public,anon;grant execute on function public.import_lender_directory(jsonb,uuid) to authenticated;

-- Each run retains the exact guideline versions used for its lender matches.
create function public.snapshot_underwriting_lender_guidelines() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'products',products,'notes',notes,'guidelines',guidelines,'guideline_version',guideline_version) order by name),'[]') into new.lender_snapshot from public.lenders where archived_at is null;
 return new;
end $$;
create trigger underwriting_lender_guideline_snapshot before insert on public.underwriting_runs for each row execute function public.snapshot_underwriting_lender_guidelines();
notify pgrst,'reload schema';commit;
