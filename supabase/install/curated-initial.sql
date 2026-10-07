-- CURATED FINANCIAL CRM - INSTALACION INICIAL
-- Preparado el 2026-10-06 para daniel@curatedfinancial.com.
-- Ejecutar TODO este archivo una sola vez en SQL Editor, con el rol postgres.
-- Incluye 001_core.sql hasta 007_history.sql; NO ejecutar ambos procedimientos.
-- Solo para una base dedicada al CRM, sin tablas en el esquema public.
-- Una transaccion: cualquier error revierte esta instalacion completa.
-- Registra la autorizacion del superadmin; NO crea su usuario Auth,
-- NO establece una contrasena y NO envia un correo de invitacion.

begin;

do $installation_guard$
begin
  if exists (select 1 from pg_catalog.pg_tables where schemaname = 'public') then
    raise exception 'Instalacion cancelada: public ya contiene tablas. No borre datos; revise si las migraciones del CRM ya fueron aplicadas.';
  end if;
end
$installation_guard$;

-- ===== 001_core.sql =====
-- Curated Financial CRM. Apply in order to a new Supabase project.

create type public.app_role as enum ('superadmin','seller_admin','seller','closer_admin','closer');
create type public.case_stage as enum ('new','contacting','replied','application_pending','documents_pending','analysis','ready_for_closer','unassigned','lenders','offers','negotiation','accepted','funding_pending','funded','lost','paused');
create type public.case_area as enum ('general','seller','closer');
create table public.profiles (
  id uuid primary key references auth.users(id), name text not null, email text not null,
  role public.app_role not null, active boolean not null default true, created_at timestamptz not null default now()
);
create table public.companies (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table public.contacts (
  id uuid primary key default gen_random_uuid(), company_id uuid references public.companies,
  email text not null unique check(email = lower(btrim(email))), name text not null default '', phone text not null default '',
  verification text not null default 'pending' check(verification in ('pending','valid','invalid','uncertain')),
  created_at timestamptz not null default now()
);
create table public.product_requirements (product text primary key, bank_months integer not null default 4 check(bank_months between 1 and 24));
insert into public.product_requirements(product) values ('Business loan'),('MCA'),('Line of credit'),('Equipment financing');
create table public.opportunities (
  id uuid primary key default gen_random_uuid(), contact_id uuid not null references public.contacts, company_id uuid references public.companies,
  company text not null, industry text not null default '', product text not null default 'Business loan', amount numeric(16,2) not null default 0 check(amount >= 0),
  seller_id uuid not null references public.profiles, closer_id uuid references public.profiles, stage public.case_stage not null default 'new',
  last_contact timestamptz, summary text not null default '', next_action text not null default '', next_action_at timestamptz,
  application_signed boolean not null default false, application_complete boolean not null default false,
  handed_off_at timestamptz, campaign_id uuid, archived_at timestamptz,
  funded_amount numeric(16,2), funded_at timestamptz, funded_lender_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(stage <> 'funded' or (funded_amount > 0 and funded_at is not null and funded_lender_id is not null)),
  check(closer_id is null or handed_off_at is not null)
);
create index opportunities_seller on public.opportunities(seller_id,created_at desc);
create index opportunities_closer on public.opportunities(closer_id,created_at desc);
create index opportunities_contact on public.opportunities(contact_id);
create table public.activities (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities, actor_id uuid references public.profiles, type text not null, area public.case_area not null, body text not null, created_at timestamptz not null default now());
create index activities_case on public.activities(opportunity_id,created_at desc);
create table public.tasks (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities, owner_id uuid not null references public.profiles, title text not null, due_at timestamptz not null, status text not null default 'open' check(status in ('open','done')), area public.case_area not null, automated boolean not null default false, created_at timestamptz not null default now());
create index tasks_due on public.tasks(due_at) where status='open';
create table public.documents (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities, name text not null, kind text not null, period text not null default '', status text not null default 'pending' check(status in ('pending','received','approved','correction')), source text not null default 'checklist', storage_path text, content_hash text, reviewed_by uuid references public.profiles, reviewed_at timestamptz, created_at timestamptz not null default now(), unique(opportunity_id,kind,period));
create table public.document_versions (id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents, storage_path text not null, content_hash text not null, source text not null, actor_id uuid references public.profiles, created_at timestamptz not null default now(), unique(document_id,content_hash));
create table public.analyses (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities, summary text not null, conclusion text not null, observations text not null default '', recommendations text not null, reviewer_id uuid not null references public.profiles, reviewed_at timestamptz not null default now());
create table public.lenders (id uuid primary key default gen_random_uuid(), name text not null, products text[] not null default '{}', email text not null, channel text not null check(channel in ('email','portal')), notes text not null default '', archived_at timestamptz, created_at timestamptz not null default now());
alter table public.opportunities add foreign key(funded_lender_id) references public.lenders;
create table public.submissions (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities, lender_id uuid not null references public.lenders, closer_id uuid not null references public.profiles, status text not null default 'draft' check(status in ('draft','submitted','reviewing','requirements','offer','rejected','withdrawn')), channel text not null check(channel in ('email','portal')), submitted_at timestamptz not null default now(), next_action text not null, next_action_at timestamptz not null, external_reference text not null default '', created_at timestamptz not null default now());
create table public.offers (id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.submissions, opportunity_id uuid not null references public.opportunities, product text not null, amount numeric(16,2) not null check(amount>0), term text not null default '', cost text not null default '', frequency text not null default '', fees text not null default '', expires_at timestamptz, status text not null default 'received', created_at timestamptz not null default now());
create table public.mail_accounts (id uuid primary key default gen_random_uuid(), email text not null unique, organization text not null, status text not null default 'connected' check(status in ('connected','disconnected','restricted','error')), daily_limit integer not null default 100 check(daily_limit between 1 and 2000), timezone text not null default 'America/New_York', sent_today integer not null default 0, created_at timestamptz not null default now());
create table public.mail_permissions (account_id uuid not null references public.mail_accounts, user_id uuid not null references public.profiles, can_send boolean not null default false, primary key(account_id,user_id));
-- Secrets never granted to authenticated or anonymous users.
create table public.mail_credentials (account_id uuid primary key references public.mail_accounts, encrypted_refresh_token text not null, history_id text, watch_expires_at timestamptz, last_reconciled_at timestamptz);
create table public.oauth_states (state_hash text primary key, user_id uuid not null references public.profiles, organization text not null, expires_at timestamptz not null, used_at timestamptz);
create table public.campaigns (id uuid primary key default gen_random_uuid(), name text not null, account_id uuid not null references public.mail_accounts, seller_id uuid not null references public.profiles, created_by uuid not null references public.profiles, status text not null default 'draft' check(status in ('draft','active','paused','completed')), daily_limit integer not null check(daily_limit between 1 and 2000), timezone text not null, start_hour integer not null check(start_hour between 0 and 23), end_hour integer not null check(end_hour between 1 and 24), subject text not null, body text not null, steps jsonb not null default '[]', batch_id uuid, created_at timestamptz not null default now(), check(start_hour<end_hour));
alter table public.opportunities add foreign key(campaign_id) references public.campaigns;
create table public.campaign_enrollments (id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns, contact_id uuid not null references public.contacts, opportunity_id uuid not null references public.opportunities, status text not null default 'active' check(status in ('active','replied','bounced','suppressed','goal_met','completed','paused')), step integer not null default 0, next_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(campaign_id,contact_id));
create unique index one_active_prospecting_sequence on public.campaign_enrollments(contact_id) where status in ('active','paused');
create table public.suppressions (email text primary key check(email=lower(btrim(email))), reason text not null, created_at timestamptz not null default now());
create table public.verifications (id uuid primary key default gen_random_uuid(), contact_id uuid not null references public.contacts, request_key text not null unique, result text not null check(result in ('pending','valid','invalid','uncertain')), reason text, provider text not null default 'bouncer', provider_batch_id text, state text not null default 'queued' check(state in ('queued','submitted','completed','technical_error','uncertain_request')), verified_at timestamptz, created_at timestamptz not null default now());
create unique index one_pending_verification on public.verifications(contact_id) where state in ('queued','submitted','uncertain_request');
create table public.import_batches (id uuid primary key default gen_random_uuid(), name text not null, status text not null default 'queued', total integer not null default 0, processed integer not null default 0, imported integer not null default 0, duplicates integer not null default 0, skipped integer not null default 0, errors integer not null default 0, storage_path text not null, mapping jsonb not null, sheet text not null default '', created_by uuid not null references public.profiles, request_key uuid not null unique, created_at timestamptz not null default now());
alter table public.campaigns add foreign key(batch_id) references public.import_batches;
create table public.import_rows (batch_id uuid not null references public.import_batches, row_number integer not null, contact_id uuid references public.contacts, result text not null, error text, primary key(batch_id,row_number));
create table public.application_links (id uuid primary key default gen_random_uuid(), token_hash text not null unique, encrypted_token text not null, opportunity_id uuid not null references public.opportunities, created_by uuid not null references public.profiles, expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now());
create table public.applications (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null unique references public.opportunities, link_id uuid not null references public.application_links, encrypted_payload text not null, payload_hash text not null, declaration_version text not null, signature_name text not null, submitted_at timestamptz not null default now(), pdf_path text, request_key uuid not null unique);
create table public.unsubscribe_links (token_hash text primary key, encrypted_token text not null, contact_id uuid not null unique references public.contacts);
create table public.conversations (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities, submission_id uuid references public.submissions, account_id uuid not null references public.mail_accounts, gmail_thread_id text not null, subject text not null, area public.case_area not null, needs_attention boolean not null default false, updated_at timestamptz not null default now(), unique(account_id,gmail_thread_id), check((area='closer' and submission_id is not null) or (area='seller' and submission_id is null)));
create table public.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations, gmail_message_id text not null, direction text not null check(direction in ('inbound','outbound')), sender text not null, body text not null, sent_at timestamptz not null, status text not null, internet_message_id text, references_header text, unique(conversation_id,gmail_message_id));
create table public.message_attachments (id uuid primary key default gen_random_uuid(), message_id uuid not null references public.messages, gmail_attachment_id text not null, name text not null, mime_type text not null, size integer not null, imported_document_id uuid references public.documents, unique(message_id,gmail_attachment_id));
create table public.mail_review (id uuid primary key default gen_random_uuid(), account_id uuid not null references public.mail_accounts, gmail_message_id text not null, reason text not null, candidate_ids uuid[] not null default '{}', status text not null default 'pending', created_at timestamptz not null default now(), unique(account_id,gmail_message_id));
create table public.outbox (id uuid primary key default gen_random_uuid(), account_id uuid not null references public.mail_accounts, opportunity_id uuid not null references public.opportunities, submission_id uuid references public.submissions, conversation_id uuid references public.conversations, enrollment_id uuid references public.campaign_enrollments, to_email text not null, subject text not null, body text not null, area public.case_area not null, attachment_ids uuid[] not null default '{}', status text not null default 'queued' check(status in ('queued','sending','sent','uncertain','cancelled','failed','paused')), message_id_header text not null unique, gmail_message_id text, gmail_thread_id text, requested_by uuid references public.profiles, sent_at timestamptz, sending_at timestamptz, available_at timestamptz not null default now(), request_key text not null unique, created_at timestamptz not null default now());
create table public.jobs (id uuid primary key default gen_random_uuid(), kind text not null, payload jsonb not null, dedupe_key text not null unique, status text not null default 'queued' check(status in ('queued','running','completed','failed','paused')), attempts integer not null default 0, run_at timestamptz not null default now(), locked_at timestamptz, lease_token uuid, last_error text, created_at timestamptz not null default now());
create index jobs_ready on public.jobs(run_at) where status='queued';
create table public.notification_preferences (user_id uuid primary key references public.profiles, internal boolean not null default true, email boolean not null default false, push boolean not null default false, locale text not null default 'es' check(locale in ('es','en')));
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles, title text not null, body text not null, event_key text not null, read_at timestamptz, created_at timestamptz not null default now(), unique(user_id,event_key));
create table public.notification_deliveries (notification_id uuid not null references public.notifications, channel text not null, status text not null default 'queued', primary key(notification_id,channel));
create table public.push_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles, subscription jsonb not null, endpoint text not null unique, created_at timestamptz not null default now());
create table public.audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles, entity_type text not null, entity_id uuid, action text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now());
create table public.command_receipts (user_id uuid not null references public.profiles, request_key uuid not null, kind text not null, result jsonb not null, created_at timestamptz not null default now(), primary key(user_id,request_key));

create function public.current_app_role() returns public.app_role language sql stable security definer set search_path='' as $$
  select role from public.profiles where id=auth.uid() and active and coalesce(auth.jwt()->>'aal','')='aal2'
$$;
create function public.can_case(case_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(exists(select 1 from public.opportunities o where o.id=case_id and (
    public.current_app_role() in ('superadmin','seller_admin') or
    (public.current_app_role()='seller' and o.seller_id=auth.uid()) or
    (public.current_app_role()='closer_admin' and o.handed_off_at is not null) or
    (public.current_app_role()='closer' and o.closer_id=auth.uid())
  )),false)
$$;
create function public.can_area(case_id uuid, area public.case_area) returns boolean language sql stable security definer set search_path='' as $$
  select public.can_case(case_id) and (area<>'closer' or public.current_app_role() in ('superadmin','closer_admin','closer'))
$$;
create function public.can_edit_case(case_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.can_case(case_id) and exists(select 1 from public.opportunities o where o.id=case_id and ((o.handed_off_at is null and public.current_app_role() in ('superadmin','seller_admin','seller')) or (o.handed_off_at is not null and public.current_app_role() in ('superadmin','closer_admin','closer'))))
$$;
create function public.can_send(account uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.current_app_role()='superadmin' or (public.current_app_role() is not null and exists(select 1 from public.mail_permissions where account_id=account and user_id=auth.uid() and can_send))
$$;

do $$ declare tab text; begin
  for tab in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from anon, authenticated',tab);
  end loop;
end $$;
grant select on public.profiles,public.companies,public.contacts,public.opportunities,public.activities,public.tasks,public.documents,public.document_versions,public.analyses,public.lenders,public.submissions,public.offers,public.mail_accounts,public.mail_permissions,public.campaigns,public.campaign_enrollments,public.verifications,public.import_batches,public.import_rows,public.conversations,public.messages,public.message_attachments,public.notifications,public.notification_preferences,public.product_requirements,public.audit_log,public.mail_review to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(public.current_app_role() is not null);
create policy cases_read on public.opportunities for select to authenticated using(public.can_case(id));
create policy contacts_read on public.contacts for select to authenticated using(exists(select 1 from public.opportunities o where o.contact_id=contacts.id and public.can_case(o.id)));
create policy companies_read on public.companies for select to authenticated using(exists(select 1 from public.opportunities o where o.company_id=companies.id and public.can_case(o.id)));
create policy activities_read on public.activities for select to authenticated using(public.can_area(opportunity_id,area));
create policy tasks_read on public.tasks for select to authenticated using(public.can_area(opportunity_id,area));
create policy documents_read on public.documents for select to authenticated using(public.can_case(opportunity_id));
create policy document_versions_read on public.document_versions for select to authenticated using(exists(select 1 from public.documents d where d.id=document_id and public.can_case(d.opportunity_id)));
create policy analyses_read on public.analyses for select to authenticated using(public.can_case(opportunity_id));
create policy lenders_read on public.lenders for select to authenticated using(public.current_app_role() is not null);
create policy submissions_read on public.submissions for select to authenticated using(public.can_area(opportunity_id,'closer'));
create policy offers_read on public.offers for select to authenticated using(public.can_area(opportunity_id,'closer'));
create policy mail_permissions_read on public.mail_permissions for select to authenticated using(user_id=auth.uid() or public.current_app_role()='superadmin');
create policy accounts_read on public.mail_accounts for select to authenticated using(public.current_app_role()='superadmin' or (public.current_app_role() is not null and exists(select 1 from public.mail_permissions p where p.account_id=id and p.user_id=auth.uid())));
create policy campaigns_read on public.campaigns for select to authenticated using(public.current_app_role() in ('superadmin','seller_admin') or (public.current_app_role()='seller' and seller_id=auth.uid()));
create policy enrollments_read on public.campaign_enrollments for select to authenticated using(public.can_area(opportunity_id,'seller'));
create policy verifications_read on public.verifications for select to authenticated using(exists(select 1 from public.contacts c where c.id=contact_id));
create policy imports_read on public.import_batches for select to authenticated using(public.current_app_role() in ('superadmin','seller_admin'));
create policy import_rows_read on public.import_rows for select to authenticated using(public.current_app_role() in ('superadmin','seller_admin'));
create policy conversations_read on public.conversations for select to authenticated using(public.can_area(opportunity_id,area));
create policy messages_read on public.messages for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and public.can_area(c.opportunity_id,c.area)));
create policy attachments_read on public.message_attachments for select to authenticated using(exists(select 1 from public.messages m where m.id=message_id));
create policy notifications_read on public.notifications for select to authenticated using(user_id=auth.uid() and public.current_app_role() is not null);
create policy preferences_read on public.notification_preferences for select to authenticated using(user_id=auth.uid() and public.current_app_role() is not null);
create policy requirements_read on public.product_requirements for select to authenticated using(public.current_app_role() is not null);
create policy audit_read on public.audit_log for select to authenticated using(public.current_app_role()='superadmin');
create policy mail_review_read on public.mail_review for select to authenticated using(public.current_app_role()='superadmin');

create view public.opportunity_workspace with(security_invoker=true) as select o.*,c.name as contact,c.email,c.phone,c.verification from public.opportunities o join public.contacts c on c.id=o.contact_id;
create view public.campaign_workspace with(security_invoker=true) as select c.*,(select count(*)::int from public.campaign_enrollments e where e.campaign_id=c.id) as audience_count from public.campaigns c;
grant select on public.opportunity_workspace,public.campaign_workspace to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('case-documents','case-documents',false,20971520,array['application/pdf','image/jpeg','image/png']),
 ('imports','imports',false,52428800,array['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream']);
-- Browser clients cannot list/upload objects. Temporary URLs are minted only after RLS checks.
create policy case_document_read on storage.objects for select to authenticated using(bucket_id='case-documents' and exists(select 1 from public.documents d where d.storage_path=storage.objects.name and public.can_case(d.opportunity_id)));
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.current_app_role(),public.can_case(uuid),public.can_area(uuid,public.case_area),public.can_edit_case(uuid),public.can_send(uuid) to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ===== 002_commands.sql =====
alter table public.command_receipts add column fingerprint text not null;
create function public.initialize_checklist(case_id uuid, product_name text) returns void language plpgsql security definer set search_path='' as $$
declare months int; i int; period text;
begin
 select coalesce((select bank_months from public.product_requirements where product=product_name),4) into months;
 insert into public.documents(opportunity_id,name,kind) values(case_id,'Signed application','application') on conflict do nothing;
 for i in 1..months loop
  period := to_char(now()-make_interval(months=>i),'YYYY-MM');
  insert into public.documents(opportunity_id,name,kind,period) values(case_id,'Bank statement — '||period,'bank_statement',period) on conflict do nothing;
 end loop;
end $$;
create function public.notify_user(recipient uuid,event text,title_text text) returns void language plpgsql security definer set search_path='' as $$
declare notification_id uuid;
begin
 if recipient is null then return; end if;
 insert into public.notifications(user_id,title,body,event_key) values(recipient,title_text,'Open your secure workspace to review this update.',event) on conflict(user_id,event_key) do nothing returning id into notification_id;
 if notification_id is not null then
  insert into public.jobs(kind,payload,dedupe_key) values('notify',jsonb_build_object('notification_id',notification_id),'notify:'||notification_id) on conflict do nothing;
 end if;
end $$;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
 actor uuid := auth.uid(); role public.app_role := public.current_app_role();
 o public.opportunities; c public.contacts; co public.conversations; camp public.campaigns; sub public.submissions; doc public.documents;
 old_receipt public.command_receipts; result jsonb := '{}'::jsonb; entity uuid; company_id uuid; target uuid;
 area public.case_area; new_stage public.case_stage; row jsonb; reason text; email text; amount numeric; recipient uuid;
begin
 if role is null or actor is null then raise exception 'Invitation and MFA required'; end if;
 if request_key is null then raise exception 'Idempotency key required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,0));
 select * into old_receipt from public.command_receipts r where r.user_id=actor and r.request_key=crm_command.request_key;
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
  for c in select ct.* from public.contacts ct where ct.verification='valid' and not exists(select 1 from public.suppressions s where s.email=ct.email)
    and exists(select 1 from public.opportunities op where op.contact_id=ct.id and op.handed_off_at is null and op.stage not in ('lost','paused','funded') and (op.campaign_id is null or op.campaign_id=camp.id))
    and (camp.batch_id is null or exists(select 1 from public.import_rows r where r.batch_id=camp.batch_id and r.contact_id=ct.id)) order by ct.id for update of ct loop
   if not exists(select 1 from public.campaign_enrollments e where e.contact_id=c.id and e.status in ('active','paused')) then
    select * into o from public.opportunities where contact_id=c.id and handed_off_at is null and stage not in ('lost','paused','funded') and (campaign_id is null or campaign_id=camp.id) order by created_at desc limit 1;
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
end $$;
revoke all on function public.crm_command(text,jsonb,uuid),public.initialize_checklist(uuid,text),public.notify_user(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated;
grant execute on all functions in schema public to service_role;

-- ===== 003_service_workflows.sql =====
create table public.invitations(email text primary key,name text not null,role public.app_role not null,invited_by uuid references public.profiles,sent_at timestamptz,created_at timestamptz not null default now());
alter table public.invitations enable row level security;
revoke all on public.invitations from anon,authenticated;
create function public.accept_invitation() returns trigger language plpgsql security definer set search_path='' as $$
declare invite public.invitations;
begin
 select * into invite from public.invitations where email=lower(new.email);
 if invite.email is not null then insert into public.profiles(id,name,email,role) values(new.id,invite.name,lower(new.email),invite.role); end if;
 return new;
end $$;
create trigger on_invited_user_created after insert on auth.users for each row execute function public.accept_invitation();

create function public.register_import(batch_id uuid,file_name text,storage_path text,mapping jsonb,sheet text,total int,actor uuid,request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
 if not exists(select 1 from public.profiles where id=actor and active and role in ('superadmin','seller_admin')) then raise exception 'Administrator required'; end if;
 insert into public.import_batches(id,name,storage_path,mapping,sheet,total,created_by,request_key) values(batch_id,file_name,storage_path,mapping,sheet,total,actor,request_key) on conflict on constraint import_batches_request_key_key do nothing returning id into existing;
 if existing is null then select id into existing from public.import_batches b where b.request_key=register_import.request_key; end if;
 insert into public.jobs(kind,payload,dedupe_key) values('import',jsonb_build_object('batch_id',existing),'import:'||existing) on conflict do nothing;
 return existing;
end $$;
create function public.ingest_import_chunk(batch_id uuid,rows jsonb) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare b public.import_batches; row jsonb; contact_id uuid; company_id uuid; opportunity_id uuid; result text; email text;
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
    insert into public.opportunities(contact_id,company_id,company,industry,seller_id) values(contact_id,company_id,coalesce(nullif(row->>'company',''),'Unspecified business'),coalesce(row->>'industry',''),b.created_by) returning id into opportunity_id;
    perform public.initialize_checklist(opportunity_id,'Business loan');
   end if;
  end if;
  insert into public.import_rows(batch_id,row_number,contact_id,result,error) values(b.id,(row->>'row_number')::int,contact_id,result,row->>'error');
  update public.import_batches set processed=processed+1,imported=imported+case when result='imported' then 1 else 0 end,duplicates=duplicates+case when result='duplicate' then 1 else 0 end,errors=errors+case when result='error' then 1 else 0 end,status='running' where id=b.id;
 end loop;
 update public.import_batches set status='completed' where id=b.id and processed>=total;
end $$;

create function public.claim_job() returns setof public.jobs language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 -- A lease token fences a stale worker from acknowledging another worker's job.
 select id into target from public.jobs where (status='queued' and run_at<=now()) or (status='running' and locked_at<now()-interval '5 minutes') order by run_at for update skip locked limit 1;
 if target is null then return; end if;
 return query update public.jobs set status='running',locked_at=now(),attempts=attempts+1,lease_token=gen_random_uuid() where id=target returning *;
end $$;
create function public.finish_job(job_id uuid,lease uuid,success boolean,error_code text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.jobs set status=case when success then 'completed' when attempts>=5 then 'failed' else 'queued' end,run_at=now()+make_interval(secs=>least(3600,power(2,attempts)::int*30)),last_error=error_code,locked_at=null where id=job_id and lease_token=lease and status='running';
end $$;
create function public.extend_job(job_id uuid,lease uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin update public.jobs set locked_at=now() where id=job_id and lease_token=lease and status='running'; return found; end $$;

create function public.persist_application(link_hash text,payload_encrypted text,payload_hash text,declaration_version text,signature_name text,request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare link public.application_links; app public.applications; opportunity public.opportunities;
begin
 select * into link from public.application_links where token_hash=link_hash and revoked_at is null and expires_at>now() for update;
 if link.id is null then raise exception 'Invalid or expired application link'; end if;
 select * into opportunity from public.opportunities where id=link.opportunity_id for update;
 if opportunity.handed_off_at is not null or opportunity.archived_at is not null then raise exception 'Application is no longer open'; end if;
 select * into app from public.applications where opportunity_id=link.opportunity_id;
 if app.id is not null then
  if app.payload_hash<>persist_application.payload_hash then raise exception 'Application already submitted; contact your representative to correct it'; end if;
  return app.id;
 end if;
 insert into public.applications(opportunity_id,link_id,encrypted_payload,payload_hash,declaration_version,signature_name,request_key) values(link.opportunity_id,link.id,payload_encrypted,payload_hash,declaration_version,signature_name,request_key) returning * into app;
 update public.opportunities set application_signed=true,application_complete=true,stage='documents_pending',updated_at=now() where id=link.opportunity_id;
 update public.campaign_enrollments set status='goal_met' where opportunity_id=link.opportunity_id and status in ('active','paused');
 update public.outbox set status='cancelled' where opportunity_id=link.opportunity_id and enrollment_id is not null and status in ('queued','paused');
 insert into public.jobs(kind,payload,dedupe_key) values('pdf',jsonb_build_object('application_id',app.id),'pdf:'||app.id) on conflict do nothing;
 insert into public.activities(opportunity_id,actor_id,type,area,body) values(link.opportunity_id,null,'application','seller','Signed application received');
 perform public.notify_user(opportunity.seller_id,'application:'||app.id,'Application received');
 return app.id;
end $$;
create function public.register_document(document_id uuid,path text,content_hash text,source text,actor uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare doc public.documents; o public.opportunities;
begin
 select * into doc from public.documents where id=document_id for update;
 select * into o from public.opportunities where id=doc.opportunity_id;
 if doc.id is null then raise exception 'Document not found'; end if;
 if doc.content_hash=register_document.content_hash then return; end if;
 insert into public.document_versions(document_id,storage_path,content_hash,source,actor_id) values(doc.id,path,content_hash,source,actor) on conflict do nothing;
 update public.documents set storage_path=path,content_hash=register_document.content_hash,source=register_document.source,status='received',reviewed_by=null,reviewed_at=null where id=doc.id;
 insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,'document',case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end,'Document received; review required');
 perform public.notify_user(coalesce(o.closer_id,o.seller_id),'document:'||doc.id||':'||content_hash,'Document received');
end $$;
create function public.suppress_contact(contact uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare contact_email text;
begin
 select contacts.email into contact_email from public.contacts where id=contact for update;
 if contact_email is null then raise exception 'Contact not found'; end if;
 insert into public.suppressions(email,reason) values(contact_email,reason) on conflict(email) do nothing;
 update public.campaign_enrollments set status='suppressed' where contact_id=contact and status in ('active','paused');
 update public.outbox set status='cancelled' where lower(to_email)=contact_email and area='seller' and status in ('queued','paused');
end $$;
create function public.stop_contact_sequence(contact uuid,why text) returns void language plpgsql security definer set search_path='' as $$
begin
 if why not in ('replied','bounced','goal_met') then raise exception 'Invalid stop reason'; end if;
 perform 1 from public.contacts where id=contact for update;
 update public.campaign_enrollments set status=why where contact_id=contact and status in ('active','paused');
 update public.outbox set status='cancelled' where enrollment_id in (select id from public.campaign_enrollments where contact_id=contact) and status in ('queued','paused');
end $$;

create function public.claim_outbox() returns setof public.outbox language plpgsql security definer set search_path='' as $$
declare msg public.outbox; account public.mail_accounts; campaign public.campaigns; enrollment public.campaign_enrollments; contact public.contacts; actor public.profiles; o public.opportunities; sent_count int; local_start timestamptz;
begin
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
  if enrollment.status<>'active' or contact.verification<>'valid' or o.handed_off_at is not null or o.application_complete then update public.outbox set status='cancelled' where id=msg.id; return; end if;
  if campaign.status<>'active' or extract(hour from now() at time zone campaign.timezone)<campaign.start_hour or extract(hour from now() at time zone campaign.timezone)>=campaign.end_hour then update public.outbox set available_at=now()+interval '10 minutes' where id=msg.id; return; end if;
  if actor.role not in ('superadmin','seller_admin') then update public.outbox set status='paused' where id=msg.id; return; end if;
  select count(*) into sent_count from public.outbox x join public.campaign_enrollments e on x.enrollment_id=e.id where e.campaign_id=campaign.id and x.status in ('sent','sending','uncertain') and coalesce(x.sent_at,x.sending_at)>=date_trunc('day',now() at time zone campaign.timezone) at time zone campaign.timezone;
  if sent_count>=campaign.daily_limit then update public.outbox set available_at=now()+interval '1 hour' where id=msg.id; return; end if;
 else
  if not (actor.role='superadmin' or (msg.area='seller' and o.handed_off_at is null and (actor.role='seller_admin' or o.seller_id=actor.id)) or (msg.area='closer' and o.handed_off_at is not null and (actor.role='closer_admin' or o.closer_id=actor.id))) then update public.outbox set status='cancelled' where id=msg.id; return; end if;
 end if;
 local_start:=date_trunc('day',now() at time zone account.timezone) at time zone account.timezone;
 select count(*) into sent_count from public.outbox where account_id=account.id and status in ('sent','sending','uncertain') and coalesce(sent_at,sending_at)>=local_start;
 if sent_count>=account.daily_limit or exists(select 1 from public.outbox where account_id=account.id and sending_at>now()-interval '30 seconds') then update public.outbox set available_at=now()+interval '1 minute' where id=msg.id; return; end if;
 return query update public.outbox set status='sending',sending_at=now() where id=msg.id returning *;
end $$;
create function public.mark_sent(outbox_id uuid,gmail_id text,thread_id text) returns void language plpgsql security definer set search_path='' as $$
declare msg public.outbox; conversation uuid; enrollment public.campaign_enrollments; campaign public.campaigns; next_step jsonb;
begin
 select * into msg from public.outbox where id=outbox_id for update;
 if msg.status='sent' then return; end if;
 update public.outbox set status='sent',gmail_message_id=gmail_id,gmail_thread_id=thread_id,sent_at=now() where id=outbox_id;
 if msg.opportunity_id is null then return; end if;
 insert into public.conversations(opportunity_id,submission_id,account_id,gmail_thread_id,subject,area) values(msg.opportunity_id,msg.submission_id,msg.account_id,thread_id,msg.subject,msg.area) on conflict(account_id,gmail_thread_id) do update set updated_at=now() returning id into conversation;
 insert into public.messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status,internet_message_id) values(conversation,gmail_id,'outbound',(select email from public.mail_accounts where id=msg.account_id),msg.body,now(),'sent',msg.message_id_header) on conflict do nothing;
 update public.conversations set needs_attention=exists(select 1 from public.messages where conversation_id=conversation and direction='inbound' and sent_at>msg.sending_at) where id=conversation;
 if msg.submission_id is not null then update public.submissions set status='submitted',submitted_at=now() where id=msg.submission_id and status='draft'; end if;
 if msg.area='seller' then update public.opportunities set last_contact=now(),stage=case when stage='new' then 'contacting'::public.case_stage else stage end where id=msg.opportunity_id; end if;
 if msg.enrollment_id is not null then
  select * into enrollment from public.campaign_enrollments where id=msg.enrollment_id for update;
  select * into campaign from public.campaigns where id=enrollment.campaign_id;
  next_step:=campaign.steps->enrollment.step;
  if next_step is null then update public.campaign_enrollments set status='completed' where id=enrollment.id and status='active';
  else update public.campaign_enrollments set step=step+1,next_at=now()+make_interval(days=>(next_step->>'wait_days')::int) where id=enrollment.id and status='active'; end if;
 end if;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(msg.requested_by,'outbox',msg.id,'gmail_accepted');
end $$;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.current_app_role(),public.can_case(uuid),public.can_area(uuid,public.case_area),public.can_edit_case(uuid),public.can_send(uuid),public.crm_command(text,jsonb,uuid) to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ===== 004_integrations.sql =====
create function public.claim_verifications() returns table(id uuid,email text) language plpgsql security definer set search_path='' as $$
begin
 return query with pending as(select v.id from public.verifications v where state='queued' order by v.id for update skip locked limit 1000), reserved as(update public.verifications v set state='uncertain_request' from pending p where v.id=p.id returning v.id,v.contact_id) select r.id,c.email from reserved r join public.contacts c on c.id=r.contact_id;
end $$;
create function public.apply_verification_results(batch text,results jsonb) returns void language plpgsql security definer set search_path='' as $$
declare entry jsonb; v public.verifications;
begin
 for entry in select value from jsonb_array_elements(results) loop
  select vr.* into v from public.verifications vr join public.contacts c on c.id=vr.contact_id where vr.provider_batch_id=batch and c.email=entry->>'email' for update of vr;
  if v.id is null or v.state='completed' then continue; end if;
  update public.verifications set result=entry->>'result',reason=entry->>'reason',state='completed',verified_at=now() where id=v.id;
  update public.contacts set verification=entry->>'result' where id=v.contact_id;
 end loop;
end $$;
create function public.advance_gmail_history(account uuid,checkpoint text) returns void language plpgsql security definer set search_path='' as $$
begin update public.mail_credentials set history_id=checkpoint,last_reconciled_at=now() where account_id=account and (history_id is null or history_id::numeric<checkpoint::numeric); end $$;
alter table public.outbox alter column opportunity_id drop not null;
alter table public.outbox add column notification_id uuid references public.notifications;
alter table public.outbox add constraint outbox_purpose check((opportunity_id is not null and notification_id is null) or (opportunity_id is null and notification_id is not null));
-- Use the same sender queue and account limits for internal notification emails.
create function public.claim_notification_outbox() returns setof public.outbox language plpgsql security definer set search_path='' as $$
declare msg public.outbox; account public.mail_accounts; recipient public.profiles; sent_count int;
begin
 select * into msg from public.outbox where status='queued' and notification_id is not null and available_at<=now() order by available_at for update skip locked limit 1;
 if msg.id is null then return; end if;
 select * into account from public.mail_accounts where id=msg.account_id for update;
 select p.* into recipient from public.profiles p join public.notifications n on n.user_id=p.id where n.id=msg.notification_id;
 if account.status<>'connected' then update public.outbox set status='paused' where id=msg.id; return; end if;
 if recipient.id is null or not recipient.active or msg.to_email<>recipient.email or not exists(select 1 from public.notification_preferences where user_id=recipient.id and email) then update public.outbox set status='cancelled' where id=msg.id; return; end if;
 select count(*) into sent_count from public.outbox where account_id=account.id and status in ('sent','sending','uncertain') and coalesce(sent_at,sending_at)>=date_trunc('day',now() at time zone account.timezone) at time zone account.timezone;
 if sent_count>=account.daily_limit or exists(select 1 from public.outbox where account_id=account.id and sending_at>now()-interval '30 seconds') then update public.outbox set available_at=now()+interval '1 minute' where id=msg.id; return; end if;
 return query update public.outbox set status='sending',sending_at=now() where id=msg.id returning *;
end $$;
revoke all on function public.claim_verifications(),public.apply_verification_results(text,jsonb),public.advance_gmail_history(uuid,text),public.claim_notification_outbox() from public,anon,authenticated;
grant execute on all functions in schema public to service_role;

-- ===== 005_mail_visibility.sql =====
-- A Gmail thread can span the handoff. Visibility belongs to each message,
-- not only the original thread, otherwise negotiations would leak to sellers.
alter table public.messages add column area public.case_area not null default 'seller';
update public.messages m set area=c.area from public.conversations c where c.id=m.conversation_id;
drop policy messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and public.can_area(c.opportunity_id,messages.area)));
alter table public.conversations drop constraint conversations_check;
alter table public.conversations add constraint conversation_scope check(area in ('seller','closer') and (submission_id is null or area='closer'));
create policy job_admin_read on public.jobs for select to authenticated using(public.current_app_role()='superadmin');
create policy outbox_admin_read on public.outbox for select to authenticated using(public.current_app_role()='superadmin');
grant select on public.jobs,public.outbox to authenticated;
-- Message-area derivation is also enforced for service-side sync inserts.
create function public.message_phase() returns trigger language plpgsql security definer set search_path='' as $$
declare handoff timestamptz; thread_area public.case_area;
begin
 select o.handed_off_at,c.area into handoff,thread_area from public.conversations c join public.opportunities o on o.id=c.opportunity_id where c.id=new.conversation_id;
 new.area:=case when thread_area='closer' or (handoff is not null and new.sent_at>=handoff) then 'closer'::public.case_area else 'seller'::public.case_area end;
 return new;
end $$;
create trigger message_phase_before_insert before insert on public.messages for each row execute function public.message_phase();
revoke all on function public.message_phase() from public,anon,authenticated;
grant execute on function public.message_phase() to service_role;

-- ===== 006_metrics.sql =====
create function public.workspace_stats(search_text text default '',stage_filter text default null,owner_filter uuid default null,campaign_filter uuid default null,since_filter timestamptz default null) returns jsonb language sql stable security invoker set search_path='' as $$
 with filtered as(select * from public.opportunity_workspace o where o.archived_at is null and (search_text='' or o.company ilike '%'||search_text||'%' or o.contact ilike '%'||search_text||'%' or o.email ilike '%'||search_text||'%') and (stage_filter is null or o.stage::text=stage_filter) and (owner_filter is null or o.seller_id=owner_filter or o.closer_id=owner_filter) and (campaign_filter is null or o.campaign_id=campaign_filter) and (since_filter is null or o.created_at>=since_filter)), counts as(select stage,count(*) n from filtered group by stage)
 select jsonb_build_object('total',count(*),'active_count',count(*) filter(where stage not in ('funded','lost','paused')),'active_amount',coalesce(sum(amount) filter(where stage not in ('funded','lost','paused')),0),'funded_count',count(*) filter(where stage='funded'),'funded_amount',coalesce(sum(funded_amount),0),'review_count',count(*) filter(where stage in ('analysis','documents_pending')),'verified',count(*) filter(where verification='valid'),'contacted',count(*) filter(where last_contact is not null),'applications',count(*) filter(where application_complete),'transferred',count(*) filter(where handed_off_at is not null),'offers',count(*) filter(where exists(select 1 from public.offers f where f.opportunity_id=filtered.id)),'without_action',count(*) filter(where next_action=''),'stage_counts',coalesce((select jsonb_object_agg(stage,n) from counts),'{}'::jsonb),'overdue',(select count(*) from public.tasks t where t.opportunity_id in(select id from filtered) and t.status='open' and t.due_at<now()),'unread',(select count(*) from public.conversations c where c.opportunity_id in(select id from filtered) and c.needs_attention)) from filtered
$$;
grant execute on function public.workspace_stats(text,text,uuid,uuid,timestamptz) to authenticated,service_role;
revoke execute on function public.workspace_stats(text,text,uuid,uuid,timestamptz) from public,anon;
create table public.submission_documents (outbox_id uuid not null references public.outbox,document_id uuid not null references public.documents,submission_id uuid not null references public.submissions,storage_path text not null,content_hash text not null,sent_at timestamptz not null default now(),primary key(outbox_id,document_id));
alter table public.submission_documents enable row level security;
revoke all on public.submission_documents from anon,authenticated;
grant select on public.submission_documents to authenticated;
grant all on public.submission_documents to service_role;
create policy submission_documents_read on public.submission_documents for select to authenticated using(exists(select 1 from public.submissions s where s.id=submission_id and public.can_area(s.opportunity_id,'closer')));
alter table public.outbox add column attachment_snapshot jsonb not null default '[]';
alter table public.documents add column required boolean not null default true;

-- ===== 007_history.sql =====
create table public.stage_history (
 id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities,
 stage public.case_stage not null, entered_at timestamptz not null default now(), exited_at timestamptz,
 actor_id uuid references public.profiles
);
create unique index one_open_stage on public.stage_history(opportunity_id) where exited_at is null;
create index stage_history_case on public.stage_history(opportunity_id,entered_at);
alter table public.stage_history enable row level security;
revoke all on public.stage_history from anon,authenticated;
grant select on public.stage_history to authenticated;
grant all on public.stage_history to service_role;
create policy stage_history_read on public.stage_history for select to authenticated using(public.can_case(opportunity_id));
insert into public.stage_history(opportunity_id,stage,entered_at) select id,stage,created_at from public.opportunities;
create function public.track_case_changes() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  insert into public.stage_history(opportunity_id,stage,actor_id) values(new.id,new.stage,auth.uid());
 else
  if old.stage is distinct from new.stage then
   update public.stage_history set exited_at=now() where opportunity_id=new.id and exited_at is null;
   insert into public.stage_history(opportunity_id,stage,actor_id) values(new.id,new.stage,auth.uid());
  end if;
  if old.seller_id is distinct from new.seller_id or old.closer_id is distinct from new.closer_id or old.stage is distinct from new.stage then
   insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'opportunity',new.id,'case_changed',jsonb_build_object('from_seller',old.seller_id,'to_seller',new.seller_id,'from_closer',old.closer_id,'to_closer',new.closer_id,'from_stage',old.stage,'to_stage',new.stage));
  end if;
 end if;
 return new;
end $$;
create trigger case_history after insert or update on public.opportunities for each row execute function public.track_case_changes();
create function public.record_sent_documents() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='sent' and old.status<>'sent' and new.submission_id is not null then
  insert into public.submission_documents(outbox_id,document_id,submission_id,storage_path,content_hash,sent_at)
   select new.id,(entry->>'id')::uuid,new.submission_id,entry->>'storage_path',entry->>'content_hash',new.sent_at from jsonb_array_elements(new.attachment_snapshot) entry on conflict do nothing;
 end if;
 return new;
end $$;
create trigger sent_document_snapshot after update of status on public.outbox for each row execute function public.record_sent_documents();
revoke all on function public.track_case_changes(),public.record_sent_documents() from public,anon,authenticated;
grant execute on function public.track_case_changes(),public.record_sent_documents() to service_role;
-- Enrich global metrics under the caller's RLS policies, independently of UI pagination.
alter function public.workspace_stats(text,text,uuid,uuid,timestamptz) rename to workspace_stats_base;
create function public.workspace_stats(search_text text default '',stage_filter text default null,owner_filter uuid default null,campaign_filter uuid default null,since_filter timestamptz default null) returns jsonb language sql stable security invoker set search_path='' as $$
 with filtered as(select * from public.opportunity_workspace o where o.archived_at is null and (search_text='' or o.company ilike '%'||search_text||'%' or o.contact ilike '%'||search_text||'%' or o.email ilike '%'||search_text||'%') and (stage_filter is null or o.stage::text=stage_filter) and (owner_filter is null or o.seller_id=owner_filter or o.closer_id=owner_filter) and (campaign_filter is null or o.campaign_id=campaign_filter) and (since_filter is null or o.created_at>=since_filter)),
 owners as(select coalesce(closer_id,seller_id) id,count(*) total,sum(amount) amount from filtered group by coalesce(closer_id,seller_id)),
 durations as(select h.stage,round(avg(extract(epoch from (coalesce(h.exited_at,now())-h.entered_at)))/86400,2) days from public.stage_history h where h.opportunity_id in(select id from filtered) group by h.stage)
 select public.workspace_stats_base(search_text,stage_filter,owner_filter,campaign_filter,since_filter)||jsonb_build_object('owners',coalesce((select jsonb_agg(owners) from owners),'[]'::jsonb),'stage_days',coalesce((select jsonb_object_agg(stage,days) from durations),'{}'::jsonb),'imported',(select count(*) from filtered where exists(select 1 from public.import_rows r where r.contact_id=filtered.contact_id and r.result='imported')))
$$;
revoke all on function public.workspace_stats(text,text,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.workspace_stats(text,text,uuid,uuid,timestamptz) to authenticated,service_role;
create view public.opportunity_inbox with(security_invoker=true) as select o.* from public.opportunity_workspace o where exists(select 1 from public.conversations c where c.opportunity_id=o.id);
create view public.opportunity_tasks with(security_invoker=true) as select o.* from public.opportunity_workspace o where exists(select 1 from public.tasks t where t.opportunity_id=o.id and t.status='open');
grant select on public.opportunity_inbox,public.opportunity_tasks to authenticated;
create function public.enqueue_overdue() returns void language plpgsql security definer set search_path='' as $$
declare task public.tasks;
begin
 for task in select t.* from public.tasks t where t.status='open' and t.due_at<now() and not exists(select 1 from public.notifications n where n.user_id=t.owner_id and n.event_key='overdue:'||t.id||':'||extract(epoch from t.due_at)::text) order by t.due_at limit 500 loop
  perform public.notify_user(task.owner_id,'overdue:'||task.id||':'||extract(epoch from task.due_at)::text,'A task is overdue');
 end loop;
end $$;
revoke all on function public.enqueue_overdue() from public,anon,authenticated;
grant execute on function public.enqueue_overdue() to service_role;
drop policy import_rows_read on public.import_rows;
create policy import_rows_read on public.import_rows for select to authenticated using(public.current_app_role() in ('superadmin','seller_admin') or exists(select 1 from public.opportunities o where o.contact_id=import_rows.contact_id and public.can_case(o.id)));
create function public.track_task() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or old.status is distinct from new.status then
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(new.opportunity_id,auth.uid(),'task',new.area,new.title||' · '||new.status);
 end if;
 return new;
end $$;
create trigger task_activity after insert or update of status on public.tasks for each row execute function public.track_task();
create function public.track_analysis() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.activities(opportunity_id,actor_id,type,area,body) values(new.opportunity_id,new.reviewer_id,'analysis','seller',new.summary);
 return new;
end $$;
create trigger analysis_activity after insert on public.analyses for each row execute function public.track_analysis();
revoke all on function public.track_task(),public.track_analysis() from public,anon,authenticated;
grant execute on function public.track_task(),public.track_analysis() to service_role;
create function public.track_message_contact() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.opportunities o set last_contact=greatest(o.last_contact,new.sent_at),stage=case when new.direction='inbound' and o.handed_off_at is null and o.stage in ('new','contacting') and exists(select 1 from public.contacts ct where ct.id=o.contact_id and ct.email=new.sender) then 'replied'::public.case_stage else o.stage end where o.id=(select c.opportunity_id from public.conversations c where c.id=new.conversation_id);
 return new;
end $$;
create trigger message_contact after insert on public.messages for each row execute function public.track_message_contact();
revoke all on function public.track_message_contact() from public,anon,authenticated;
grant execute on function public.track_message_contact() to service_role;

-- Preparar al primer administrador antes de crearlo o invitarlo en Auth.
insert into public.invitations(email, name, role)
values ('daniel@curatedfinancial.com', 'Daniel', 'superadmin');

-- Actualizar el esquema que expone la API al confirmar la transaccion.
notify pgrst, 'reload schema';

commit;

-- Resultado esperado en SQL Editor tras completar la instalacion.
select email, name, role,
  'Migraciones 001-007 instaladas; pendiente crear o invitar el usuario en Auth' as resultado
from public.invitations
where email = 'daniel@curatedfinancial.com';
