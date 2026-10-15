begin;
alter table public.documents drop constraint documents_opportunity_id_kind_period_key;
alter table public.documents add column bank_name text not null default '' check(length(bank_name)<=120);
alter table public.documents add column statement_number int check(statement_number>0);
with numbered as (
 select id,row_number() over(partition by opportunity_id order by period,created_at,id)::int number
 from public.documents where kind='bank_statement'
)
update public.documents d set statement_number=n.number,name='Bank Statement '||n.number,
 period=case when d.storage_path is null then '' else d.period end,required=false
from numbered n where d.id=n.id;
create unique index bank_statement_number on public.documents(opportunity_id,lower(btrim(bank_name)),statement_number) where kind='bank_statement';

create or replace function public.initialize_checklist(case_id uuid,product_name text) returns void
language plpgsql security definer set search_path='' as $$
declare i int;missing int;
begin
 perform 1 from public.opportunities where id=case_id for update;
 if not exists(select 1 from public.documents where opportunity_id=case_id and kind='application') then
  insert into public.documents(opportunity_id,name,kind) values(case_id,'Signed application','application');
 end if;
 select greatest(0,4-count(*))::int into missing from public.documents where opportunity_id=case_id and kind='bank_statement';
 for counter in 1..missing loop
  select coalesce(max(statement_number),0)+1 into i from public.documents where opportunity_id=case_id and kind='bank_statement' and bank_name='';
  insert into public.documents(opportunity_id,name,kind,statement_number,required)
  values(case_id,'Bank Statement '||i,'bank_statement',i,false);
 end loop;
end $$;

create function public.document_packet_ready(case_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.can_case(case_id)
 and exists(select 1 from public.documents where opportunity_id=case_id and kind='application' and status='approved' and storage_path is not null and content_hash is not null)
 and (select count(distinct content_hash) from public.documents where opportunity_id=case_id and kind='bank_statement' and status='approved' and storage_path is not null)>=4
 and not exists(select 1 from public.documents where opportunity_id=case_id and required and kind not in ('bank_statement','analysis_report') and (status<>'approved' or storage_path is null or content_hash is null))
$$;
revoke all on function public.document_packet_ready(uuid) from public,anon;
grant execute on function public.document_packet_ready(uuid) to authenticated,service_role;

create function public.manage_case_document(kind text,p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();case_id uuid:=(p->>'opportunity_id')::uuid;doc public.documents;
 receipt public.command_receipts;result jsonb;bank text:=btrim(coalesce(p->>'bank_name',''));number int;doc_kind text:=p->>'kind';doc_name text:=btrim(p->>'name');
begin
 if public.current_app_role() is null or actor is null then raise exception 'Invitation and MFA required';end if;
 if request_key is null then raise exception 'Idempotency key required';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,0));
 perform 1 from public.opportunities where id=case_id for update;
 if not public.can_edit_case(case_id) then raise exception 'Case is inaccessible or read-only';end if;
 select * into receipt from public.command_receipts r where r.user_id=actor and r.request_key=manage_case_document.request_key;
 if found then
  if receipt.kind<>kind or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused with different input';end if;
  return receipt.result;
 end if;
 if length(bank)>120 then raise exception 'Bank name too long';end if;
 perform public.initialize_checklist(case_id,'MCA');
 select coalesce((select d.bank_name from public.documents d where d.opportunity_id=case_id and d.kind='bank_statement' and lower(btrim(d.bank_name))=lower(bank) order by d.created_at,d.id limit 1),bank) into bank;
 if kind='add_document' then
  if doc_kind not in ('bank_statement','additional','analysis_report') or doc_kind is null then raise exception 'Document type required';end if;
  if doc_kind='bank_statement' then
   if bank='' then raise exception 'Bank name required';end if;
   select coalesce(max(d.statement_number),0)+1 into number from public.documents d where d.opportunity_id=case_id and d.kind='bank_statement' and lower(btrim(d.bank_name))=lower(bank);
   doc_name:='Bank Statement '||number;
  elsif coalesce(doc_name,'')='' or length(doc_name)>200 then raise exception 'Document name required';end if;
  insert into public.documents(opportunity_id,name,kind,period,bank_name,statement_number,required)
   values(case_id,doc_name,doc_kind,'',case when doc_kind='bank_statement' then bank else '' end,number,
    case when doc_kind='bank_statement' then false else coalesce((p->>'required')::boolean,false) end) returning * into doc;
 elsif kind='classify_document' then
  select * into doc from public.documents where id=(p->>'document_id')::uuid and opportunity_id=case_id for update;
  if doc.id is null or doc.kind<>'bank_statement' then raise exception 'Bank statement required';end if;
  if bank='' then raise exception 'Bank name required';end if;
  if lower(btrim(doc.bank_name))<>lower(bank) then
   select coalesce(max(d.statement_number),0)+1 into number from public.documents d where d.opportunity_id=case_id and d.kind='bank_statement' and lower(btrim(d.bank_name))=lower(bank);
  else number:=doc.statement_number;end if;
  update public.documents set bank_name=bank,statement_number=number,name='Bank Statement '||number where id=doc.id;
 else raise exception 'Unknown document action';end if;
 result:=jsonb_build_object('id',doc.id,'document_id',doc.id,'opportunity_id',case_id);
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(actor,'document',doc.id,kind,jsonb_build_object('bank_name',bank));
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request_key,kind,result,md5(p::text));
 return result;
end $$;
revoke all on function public.manage_case_document(text,jsonb,uuid) from public,anon,authenticated;

alter function public.crm_command(text,jsonb,uuid) rename to crm_command_v31_banks;
do $$ begin
 execute replace(pg_get_functiondef('public.crm_command_v31_banks(text,jsonb,uuid)'::regprocedure),'crm_command.request_key','crm_command_v31_banks.request_key');
end $$;
revoke all on function public.crm_command_v31_banks(text,jsonb,uuid) from public,anon,authenticated;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if kind in ('add_document','classify_document') then return public.manage_case_document(kind,p,request_key);end if;
 if kind='handoff' and public.can_edit_case((p->>'opportunity_id')::uuid)
 and exists(select 1 from public.opportunities where id=(p->>'opportunity_id')::uuid and application_signed and application_complete)
 and not public.document_packet_ready((p->>'opportunity_id')::uuid) then raise exception 'Approve the application and at least four bank statements';end if;
 return public.crm_command_v31_banks(kind,p,request_key);
end $$;
revoke all on function public.crm_command(text,jsonb,uuid) from public,anon;
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated;

-- Receipt/review no longer asks a user to guess a statement month. Preserve periods already identified.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.case_document_command_internal(text,jsonb,uuid)'::regprocedure);
 definition:=replace(definition,$old$if p->>'period' !~ '^\d{4}-(0[1-9]|1[0-2])$'$old$,$new$if coalesce(p->>'period','')<>'' and p->>'period' !~ '^\d{4}-(0[1-9]|1[0-2])$'$new$);
 execute definition;
end $$;

-- Analysis reads every approved bank, including overlapping months; the period is extracted from the file.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.request_underwriting(uuid,uuid)'::regprocedure);
 definition:=regexp_replace(definition,' for i in 1\.\.4 loop.*? end loop;',
  ' if (select count(distinct content_hash) from public.documents where opportunity_id=case_id and kind=''bank_statement'' and status=''approved'' and storage_path is not null)<4 then raise exception ''Four approved bank statements required'';end if;','s');
 definition:=replace(definition,$old$and (kind<>'bank_statement' or d.period between to_char((now() at time zone 'America/Bogota')-interval '4 months','YYYY-MM') and to_char((now() at time zone 'America/Bogota')-interval '1 month','YYYY-MM'))$old$,'');
 definition:=replace(definition,'''period'',d.period,','''period'',d.period,''bank_name'',d.bank_name,''statement_number'',d.statement_number,');
 definition:=replace(definition,'jsonb_array_length(document_set)>10','jsonb_array_length(document_set)>24');
 definition:=replace(definition,'Select at most ten approved source documents','Analysis supports at most 24 approved source documents');
 execute definition;
end $$;
create or replace function public.underwriting_snapshot_current(case_id uuid,snapshot jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select jsonb_array_length(snapshot)>0 and not exists(select 1 from jsonb_array_elements(snapshot) s
  where not exists(select 1 from public.documents d where d.id=(s->>'id')::uuid and d.opportunity_id=case_id
   and d.status='approved' and d.content_hash=s->>'content_hash' and d.period=s->>'period' and d.kind=s->>'kind'
   and (not s?'bank_name' or d.bank_name=s->>'bank_name')))
  and not exists(select 1 from public.documents d where opportunity_id=case_id and required and kind not in ('bank_statement','analysis_report') and not snapshot @> jsonb_build_array(jsonb_build_object('id',d.id::text)))
$$;
create function public.invalidate_bank_classification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.bank_name is distinct from new.bank_name then
  update public.analyses a set is_current=false where a.opportunity_id=new.opportunity_id and exists(select 1 from public.underwriting_runs r where r.id=a.underwriting_run_id and r.document_snapshot @> jsonb_build_array(jsonb_build_object('id',new.id::text)));
  update public.underwriting_runs set status='outdated',last_error='DOCUMENTS_CHANGED' where opportunity_id=new.opportunity_id and status in ('queued','preparing','running','draft','approved') and document_snapshot @> jsonb_build_array(jsonb_build_object('id',new.id::text));
 end if;
 return new;
end $$;
create trigger bank_classification_change after update of bank_name on public.documents for each row execute function public.invalidate_bank_classification();
notify pgrst,'reload schema';
commit;
