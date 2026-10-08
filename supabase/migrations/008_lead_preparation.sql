-- Apply once after 001-007. Imports are leads; a valid email opens a case.
begin;

alter table public.opportunities add column email_qualified_at timestamptz;
update public.opportunities o set email_qualified_at=coalesce(
 (select max(v.verified_at) from public.verifications v where v.contact_id=o.contact_id and v.result='valid'),now())
where exists(select 1 from public.contacts c where c.id=o.contact_id and c.verification='valid');

create table public.leads (
 id uuid primary key default gen_random_uuid(), contact_id uuid not null unique references public.contacts,
 company_id uuid references public.companies, company text not null, industry text not null default '',
 product text not null default 'Business loan', amount numeric(16,2) not null default 0 check(amount>=0),
 seller_id uuid not null references public.profiles, batch_id uuid references public.import_batches,
 next_action text not null default '', next_action_at timestamptz,
 opportunity_id uuid references public.opportunities, created_at timestamptz not null default now()
);
create index leads_preparation on public.leads(created_at desc) where opportunity_id is null;
create index leads_seller on public.leads(seller_id,created_at desc);
-- Preserve every existing case and its history. Unverified cases become inaccessible
-- as commercial cases until validation, then resume with their original IDs/stages.
insert into public.leads(contact_id,company_id,company,industry,product,amount,seller_id,next_action,next_action_at,opportunity_id,created_at)
select distinct on(o.contact_id) o.contact_id,o.company_id,o.company,o.industry,o.product,o.amount,o.seller_id,o.next_action,o.next_action_at,
 case when o.email_qualified_at is not null then o.id else null end,o.created_at
from public.opportunities o order by o.contact_id,o.created_at,o.id;

create function public.can_lead(lead_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.leads l where l.id=lead_id and
 (public.current_app_role() in ('superadmin','seller_admin') or
 (public.current_app_role()='seller' and l.seller_id=auth.uid())))
$$;
create or replace function public.can_case(case_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.opportunities o where o.id=case_id and o.email_qualified_at is not null and (
 public.current_app_role() in ('superadmin','seller_admin') or
 (public.current_app_role()='seller' and o.seller_id=auth.uid()) or
 (public.current_app_role()='closer_admin' and o.handed_off_at is not null) or
 (public.current_app_role()='closer' and o.closer_id=auth.uid())))
$$;
alter table public.leads enable row level security;
revoke all on public.leads from public,anon,authenticated;
grant select on public.leads to authenticated;
grant all on public.leads to service_role;
create policy leads_read on public.leads for select to authenticated using(public.can_lead(id));
create policy lead_contacts_read on public.contacts for select to authenticated using(exists(select 1 from public.leads l where l.contact_id=contacts.id and public.can_lead(l.id)));
create policy lead_companies_read on public.companies for select to authenticated using(exists(select 1 from public.leads l where l.company_id=companies.id and public.can_lead(l.id)));
grant select on public.suppressions to authenticated;
create policy own_suppressions_read on public.suppressions for select to authenticated using(exists(select 1 from public.contacts c where c.email=suppressions.email));
create view public.lead_workspace with(security_invoker=true) as
 select l.*,c.name as contact,c.email,c.phone,c.verification,
 exists(select 1 from public.suppressions s where s.email=c.email) as suppressed,
 (select v.state from public.verifications v where v.contact_id=c.id order by v.created_at desc,v.id desc limit 1) as verification_state
 from public.leads l join public.contacts c on c.id=l.contact_id;
grant select on public.lead_workspace to authenticated,service_role;

create function public.require_verified_opportunity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.contacts c where c.id=new.contact_id and c.verification='valid' for update;
 if not found or exists(select 1 from public.suppressions s join public.contacts c on c.email=s.email where c.id=new.contact_id) then
  raise exception 'Verify the lead email before creating an opportunity';
 end if;
 new.email_qualified_at:=now();
 return new;
end $$;
create trigger verified_opportunity before insert on public.opportunities for each row execute function public.require_verified_opportunity();

create function public.promote_verified_lead(contact uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.contacts; l public.leads; case_id uuid;
begin
 select * into c from public.contacts where id=contact for update;
 if c.id is null or c.verification<>'valid' or exists(select 1 from public.suppressions where email=c.email) then return null; end if;
 select * into l from public.leads where contact_id=c.id for update;
 if l.id is null then return null; end if;
 if l.opportunity_id is not null then return l.opportunity_id; end if;
 select id into case_id from public.opportunities where contact_id=c.id order by created_at,id limit 1;
 if case_id is not null then
  update public.opportunities set email_qualified_at=coalesce(email_qualified_at,now()) where contact_id=c.id;
 else
  insert into public.opportunities(contact_id,company_id,company,industry,product,amount,seller_id,next_action,next_action_at)
  values(c.id,c.company_id,l.company,l.industry,l.product,l.amount,l.seller_id,l.next_action,l.next_action_at) returning id into case_id;
  perform public.initialize_checklist(case_id,l.product);
  insert into public.activities(opportunity_id,type,area,body) values(case_id,'created','seller','Verified lead converted to opportunity');
 end if;
 update public.leads set opportunity_id=case_id where id=l.id;
 insert into public.audit_log(entity_type,entity_id,action,metadata) values('lead',l.id,'email_validated_conversion',jsonb_build_object('opportunity_id',case_id));
 return case_id;
end $$;
create function public.convert_valid_lead() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='contacts' then perform public.promote_verified_lead(new.id);
 else perform public.promote_verified_lead(new.contact_id); end if;
 return new;
end $$;
create trigger contact_validated after update of verification on public.contacts for each row
 when(new.verification='valid') execute function public.convert_valid_lead();
create trigger lead_created after insert on public.leads for each row execute function public.convert_valid_lead();

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

-- Keep the existing commercial commands, their permissions and receipts intact.
alter function public.crm_command(text,jsonb,uuid) rename to crm_command_v7;
-- The original function qualifies its request_key parameter by function name.
do $$ begin
 execute replace(pg_get_functiondef('public.crm_command_v7(text,jsonb,uuid)'::regprocedure),
 'r.request_key=crm_command.request_key','r.request_key=crm_command_v7.request_key');
end $$;
revoke all on function public.crm_command_v7(text,jsonb,uuid) from public,anon,authenticated;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); role public.app_role:=public.current_app_role(); receipt public.command_receipts;
 c public.contacts; l public.leads; target uuid; company_id uuid; email text; result jsonb; queued int:=0;
begin
 if role is null or actor is null then raise exception 'Invitation and MFA required'; end if;
 if request_key is null then raise exception 'Idempotency key required'; end if;
 if kind not in ('create_lead','verify_contacts','create_opportunity') then return public.crm_command_v7(kind,p,request_key); end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,0));
 select * into receipt from public.command_receipts r where r.user_id=actor and r.request_key=crm_command.request_key;
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
end $$;

-- Older queued manual sends must also wait for the validation gate.
alter function public.claim_outbox() rename to claim_outbox_v7;
revoke all on function public.claim_outbox_v7() from public,anon,authenticated;
create function public.claim_outbox() returns setof public.outbox language plpgsql security definer set search_path='' as $$
declare msg public.outbox;
begin
 select * into msg from public.claim_outbox_v7();
 if msg.id is null then return; end if;
 if not exists(select 1 from public.opportunities where id=msg.opportunity_id and email_qualified_at is not null) then
  update public.outbox set status='paused' where id=msg.id;
  return;
 end if;
 return next msg;
end $$;
revoke all on function public.claim_outbox() from public,anon,authenticated;
grant execute on function public.claim_outbox() to service_role;

do $$ declare contact uuid; begin
 for contact in select c.id from public.contacts c where c.verification='valid' loop perform public.promote_verified_lead(contact); end loop;
end $$;
revoke all on function public.can_lead(uuid),public.promote_verified_lead(uuid),public.convert_valid_lead(),public.require_verified_opportunity(),public.crm_command(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.can_lead(uuid),public.crm_command(text,jsonb,uuid) to authenticated;
grant execute on function public.can_lead(uuid),public.promote_verified_lead(uuid),public.convert_valid_lead(),public.require_verified_opportunity(),public.crm_command(text,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
commit;
