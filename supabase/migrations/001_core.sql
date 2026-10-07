-- Curated Financial CRM. Apply in order to a new Supabase project.
begin;
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
commit;
