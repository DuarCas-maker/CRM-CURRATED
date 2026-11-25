begin;
set local lock_timeout='5s';
create schema funding_v1;
revoke all on schema funding_v1 from public,anon,authenticated,service_role;
create table funding_v1.function_backup(signature text primary key, definition text not null);
create table funding_v1.income_updates(
 batch_id uuid not null references public.import_batches(id),contact_id uuid not null references public.contacts(id),
 before_income numeric,after_income numeric not null,created_at timestamptz not null default now(),primary key(batch_id,contact_id));
alter table funding_v1.function_backup enable row level security;
alter table funding_v1.income_updates enable row level security;
revoke all on all tables in schema funding_v1 from public,anon,authenticated,service_role;
alter table public.contacts add column monthly_income numeric(15,2) check(monthly_income>0 and monthly_income<=1000000000),
 add column income_source_batch_id uuid references public.import_batches(id),add column income_updated_at timestamptz;
alter table public.email_templates add column funding_model jsonb;
alter table public.campaigns add column funding_model jsonb;
alter table public.campaign_enrollments add column funding_income_snapshot numeric(15,2);

create function funding_v1.valid_model(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare o jsonb;i int:=0;
begin
 if p is null then return true;end if;
 if p->>'version' is distinct from '1' or jsonb_typeof(p->'options') is distinct from 'array' or jsonb_array_length(p->'options')<>3 then return false;end if;
 for o in select value from jsonb_array_elements(p->'options') loop
  i:=i+1;
  if jsonb_typeof(o->'months') is distinct from 'number' or (o->>'months')::numeric<>(array[6,9,12])[i]
   or jsonb_typeof(o->'multiplier') is distinct from 'number' or (o->>'multiplier')::numeric not between 0.01 and 100
   or (o->>'multiplier')::numeric<>round((o->>'multiplier')::numeric,2)
   or jsonb_typeof(o->'factor') is distinct from 'number' or (o->>'factor')::numeric not between 1 and 5
   or (o->>'factor')::numeric<>round((o->>'factor')::numeric,2)
   or jsonb_typeof(o->'weeks') is distinct from 'number' or (o->>'weeks')::numeric not between 1 and 520
   or (o->>'weeks')::numeric<>trunc((o->>'weeks')::numeric) then return false;end if;
 end loop;
 return true;
exception when others then return false;
end$$;
alter table public.email_templates add constraint funding_model_valid check(funding_v1.valid_model(funding_model));
alter table public.campaigns add constraint funding_model_valid check(funding_v1.valid_model(funding_model));
-- Views expand c.* at definition time; append the new snapshot without
-- changing the existing columns or the caller's RLS permissions.
do $$declare definition text;begin
 definition:=rtrim(pg_get_viewdef('public.campaign_workspace'::regclass,true),E';\n ');
 execute 'create or replace view public.campaign_workspace with(security_invoker=true) as select previous.*,c.funding_model from ('||definition||') previous join public.campaigns c on c.id=previous.id';
end$$;

-- Preserve the current validation, MFA, receipts and versioning. Only extend
-- the exact merge-field list and store the validated model in the same version.
do $$
declare sig text;src text;before text;needle text;
begin
 foreach sig in array array['public.save_campaign_template_v37(jsonb,uuid)','public.save_campaign_template(jsonb,uuid)',
 'public.campaign_prepared_leads(text,text,uuid)','public.campaign_audience_v42(uuid)','public.campaign_missing_fields(text,text,jsonb,jsonb)',
 'public.ingest_import_chunk(uuid,jsonb)','public.campaign_flow_launch(jsonb,uuid)'] loop
  insert into funding_v1.function_backup values(sig,pg_get_functiondef(sig::regprocedure));
 end loop;
 sig:='public.save_campaign_template_v37(jsonb,uuid)';src:=pg_get_functiondef(sig::regprocedure);
 needle:='''application_url'',''unsubscribe_url''';
 if strpos(src,needle)=0 then raise exception 'FUNDING_CATALOG_MISMATCH';end if;
 src:=replace(src,needle,needle||',''monthly_income'',''sender_email'',''funding_amount_6'',''funding_amount_9'',''funding_amount_12'',''funding_payment_6'',''funding_payment_9'',''funding_payment_12'',''funding_weeks_6'',''funding_weeks_9'',''funding_weeks_12''');
 execute src;
 sig:='public.campaign_flow_launch(jsonb,uuid)';src:=pg_get_functiondef(sig::regprocedure);
 if strpos(src,needle)=0 then raise exception 'FUNDING_CATALOG_MISMATCH';end if;
 src:=replace(src,needle,needle||',''monthly_income'',''sender_email'',''funding_amount_6'',''funding_amount_9'',''funding_amount_12'',''funding_payment_6'',''funding_payment_9'',''funding_payment_12'',''funding_weeks_6'',''funding_weeks_9'',''funding_weeks_12''');execute src;
 sig:='public.save_campaign_template(jsonb,uuid)';src:=pg_get_functiondef(sig::regprocedure);
 src:=replace(src,'target:=public.save_campaign_template_v37(p,request_key);',
 $s$if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'Administrator and MFA required';end if;
 if not funding_v1.valid_model(nullif(p->'funding_model','null'::jsonb)) then raise exception 'Invalid funding model';end if;
 if coalesce(p->>'funding_model','null')='null' and ((p->>'subject')||(p->>'body')||(p->'steps')::text) ~ '\{\{\s*(monthly_income|sender_email|funding_[a-z0-9_]+)\s*\}\}' then raise exception 'Funding model required';end if;
 target:=public.save_campaign_template_v37(p,request_key);$s$);
 needle:='set body_format=fmt where id=target';
 if strpos(src,needle)=0 then raise exception 'FUNDING_CATALOG_MISMATCH';end if;
 src:=replace(src,needle,'set body_format=fmt,funding_model=nullif(p->''funding_model'',''null''::jsonb) where id=target');execute src;
 foreach sig in array array['public.campaign_prepared_leads(text,text,uuid)','public.campaign_audience_v42(uuid)'] loop
  src:=pg_get_functiondef(sig::regprocedure);before:=src;
  src:=replace(src,'''phone'',ct.phone,','''phone'',ct.phone,''monthly_income'',ct.monthly_income,''sender_email'',''preview'',');
  src:=replace(src,'''phone'',c.phone,','''phone'',c.phone,''monthly_income'',case when exists(select 1 from public.campaign_enrollments fe where fe.campaign_id=camp.id and fe.contact_id=c.id) then (select fe.funding_income_snapshot from public.campaign_enrollments fe where fe.campaign_id=camp.id and fe.contact_id=c.id limit 1) else c.monthly_income end,''sender_email'',''preview'',');
  if src=before then raise exception 'FUNDING_CATALOG_MISMATCH';end if;execute src;
 end loop;
end$$;

create or replace function public.campaign_missing_fields(subject text,body text,steps jsonb,vals jsonb)
returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct m[1]),'{}') from regexp_matches(subject||E'\n'||body||E'\n'||steps::text,'\{\{\s*([^{}]+?)\s*\}\}','g') m
 where case when m[1] ~ '^funding_(amount|payment|weeks)_(6|9|12)$' or m[1]='monthly_income'
 then coalesce(vals->>'monthly_income','') !~ '^[0-9]+(\.[0-9]+)?$' or coalesce(nullif(vals->>'monthly_income',''),'0')::numeric<=0
 else coalesce(btrim(vals->>m[1]),'')='' end
$$;

create function funding_v1.snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare model jsonb;
begin
 if tg_table_name='campaigns' then
  if tg_op='UPDATE' and not(old.template_id is null and new.template_id is not null and old.funding_model is null and not exists(select 1 from public.campaign_enrollments where campaign_id=new.id)) then
   if new.funding_model is distinct from old.funding_model then raise exception 'Funding model is frozen';end if;
  else
   select snapshot->'funding_model' into model from public.email_template_versions where template_id=new.template_id and version=new.template_version;
   new.funding_model:=nullif(model,'null'::jsonb);
   if new.template_id is not null and new.funding_model is null and (new.subject||new.body) ~ '\{\{\s*(monthly_income|funding_[a-z0-9_]+)\s*\}\}' then raise exception 'Funding model required';end if;
  end if;
 else
  select c.funding_model into model from public.campaigns c where c.id=new.campaign_id;
  if model is null and exists(select 1 from public.campaigns c where c.id=new.campaign_id and (c.subject||c.body) ~ '\{\{\s*(monthly_income|funding_[a-z0-9_]+)\s*\}\}') then raise exception 'Funding model required';end if;
  if tg_op='UPDATE' then
   if new.funding_income_snapshot is distinct from old.funding_income_snapshot or (model is not null and new.contact_id<>old.contact_id) then raise exception 'Funding income is frozen';end if;
  elsif model is not null then
   select monthly_income into new.funding_income_snapshot from public.contacts where id=new.contact_id for share;
   if new.funding_income_snapshot is null then raise exception 'Monthly income required';end if;
  else new.funding_income_snapshot:=null;end if;
 end if;
 return new;
end$$;
create trigger funding_snapshot before insert or update on public.campaigns for each row execute function funding_v1.snapshot();
create trigger funding_snapshot before insert or update on public.campaign_enrollments for each row execute function funding_v1.snapshot();

-- Service-only scoped recovery. No inserts into contacts/leads, no verification,
-- no suppression changes, no jobs and no provider requests.
create function public.recover_import_monthly_income(batch uuid,entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;ct public.contacts;b public.import_batches;v numeric;updated int:=0;unchanged int:=0;unmatched int:=0;
begin
 if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries)>100 then raise exception 'At most 100 income entries';end if;
 select * into b from public.import_batches where id=batch for share;
 if b.id is null then raise exception 'Import source not found';end if;
 if exists(select 1 from jsonb_array_elements(entries) e group by lower(btrim(e->>'email')) having count(distinct e->>'monthly_income')>1) then raise exception 'Conflicting income';end if;
 for r in select distinct value from jsonb_array_elements(entries) loop
  if coalesce(r->>'monthly_income','') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Invalid monthly income';end if;
  v:=(r->>'monthly_income')::numeric;if v<=0 or v>1000000000 then raise exception 'Invalid monthly income';end if;
  select * into ct from public.contacts c where c.email=lower(btrim(r->>'email')) and exists(select 1 from public.import_rows ir where ir.batch_id=batch and ir.contact_id=c.id) for update;
  if ct.id is null then unmatched:=unmatched+1;continue;end if;
  if exists(select 1 from funding_v1.income_updates u where u.batch_id=batch and u.contact_id=ct.id and u.after_income<>v) then raise exception 'Conflicting source revision';end if;
  if exists(select 1 from public.import_batches newer where newer.id=ct.income_source_batch_id and newer.created_at>b.created_at) then unchanged:=unchanged+1;continue;end if;
  if ct.monthly_income is not distinct from v and ct.income_source_batch_id=batch then unchanged:=unchanged+1;continue;end if;
  insert into funding_v1.income_updates(batch_id,contact_id,before_income,after_income) values(batch,ct.id,ct.monthly_income,v) on conflict do nothing;
  update public.contacts set monthly_income=v,income_source_batch_id=batch,income_updated_at=now() where id=ct.id;
  updated:=updated+1;
 end loop;
 return jsonb_build_object('updated',updated,'unchanged',unchanged,'unmatched',unmatched);
end$$;
revoke all on function public.recover_import_monthly_income(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.recover_import_monthly_income(uuid,jsonb) to service_role;

alter function public.ingest_import_chunk(uuid,jsonb) rename to ingest_import_chunk_before_funding;
revoke all on function public.ingest_import_chunk_before_funding(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.ingest_import_chunk(batch_id uuid,rows jsonb) returns void language plpgsql security definer set search_path='' as $$
declare entries jsonb;
begin
 perform public.ingest_import_chunk_before_funding(batch_id,rows);
 select coalesce(jsonb_agg(jsonb_build_object('email',r->>'email','monthly_income',r->'monthly_income')),'[]') into entries from jsonb_array_elements(rows) r where coalesce((r->>'valid')::boolean,false) and jsonb_typeof(r->'monthly_income')='number';
 -- Worker chunks may contain 250 rows; recovery deliberately bounds writes.
 for i in 0..greatest(0,(jsonb_array_length(entries)-1)/100) loop
  perform public.recover_import_monthly_income(batch_id,(select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(entries) with ordinality e(value,n) where n>i*100 and n<=(i+1)*100));
 end loop;
end$$;
revoke all on function public.ingest_import_chunk(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_import_chunk(uuid,jsonb) to service_role;
revoke all on all functions in schema funding_v1 from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
