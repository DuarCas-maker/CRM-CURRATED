-- B2 LOCAL CANDIDATE. Execute only in isolated tests after 001-047 + A + B1.
begin;
do $$begin
 if current_setting('pipeline_os.block_b2_local',true) is distinct from 'in_memory_test' then raise exception 'B2 explicit in-memory marker required';end if;
 if to_regnamespace('brand_b1') is null or to_regnamespace('brand_b2') is not null then raise exception 'B2 requires B1 and a fresh candidate';end if;
end$$;
create schema brand_b2;
revoke all on schema brand_b2 from public,anon,authenticated,service_role;
alter table public.profiles add column mail_authorization_revision bigint not null default 1 check(mail_authorization_revision between 1 and 9007199254740991);
alter table public.mail_permissions add column authorization_revision bigint not null default 1 check(authorization_revision between 1 and 9007199254740991);
alter table public.opportunities add column mail_authorization_revision bigint not null default 1 check(mail_authorization_revision between 1 and 9007199254740991);
alter table public.campaigns add column brand_snapshot jsonb check(brand_snapshot is null or (jsonb_typeof(brand_snapshot)='object' and octet_length(brand_snapshot::text)<=8192)),add column brand_created_tx bigint;
alter table public.mail_drafts add column brand_account_id uuid references public.mail_accounts,add column brand_snapshot jsonb;
alter table public.outbox add column brand_snapshot jsonb check(brand_snapshot is null or (jsonb_typeof(brand_snapshot)='object' and octet_length(brand_snapshot::text)<=8192)),
 add column brand_created_tx bigint,add column brand_claim_token uuid,add column brand_admission_id uuid;
alter table public.messages add column brand_snapshot jsonb,add column brand_provenance text not null default 'unconfirmed' check(brand_provenance in ('unconfirmed','dispatch_snapshot','confirmed_history'));
create table public.mail_brand_dispatch_admissions(
 id uuid primary key default gen_random_uuid(),outbox_id uuid not null references public.outbox on delete restrict,
 claim_token uuid not null,sequence integer not null check(sequence>0),snapshot jsonb not null,
 admitted_at timestamptz not null default now(),deadline timestamptz not null default now()+interval '5 minutes',
 outcome text not null default 'admitted' check(outcome in ('admitted','accepted','known_quota','uncertain')),
 resolved_at timestamptz,unique(outbox_id,claim_token),unique(outbox_id,sequence),check(deadline>admitted_at and deadline-admitted_at<=interval '5 minutes')
);
create unique index brand_one_active_admission on public.mail_brand_dispatch_admissions(outbox_id) where outcome in ('admitted','uncertain');
alter table public.mail_brand_dispatch_admissions enable row level security;
revoke all on public.mail_brand_dispatch_admissions from public,anon,authenticated,service_role;
alter table public.outbox add foreign key(brand_admission_id) references public.mail_brand_dispatch_admissions on delete restrict;

create function brand_b2.revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='profiles' then
  new.mail_authorization_revision:=old.mail_authorization_revision+case when (new.role,new.active,new.email) is distinct from (old.role,old.active,old.email) then 1 else 0 end;
 elsif tg_table_name='mail_permissions' then
  if (new.account_id,new.user_id) is distinct from (old.account_id,old.user_id) then raise exception 'BRAND_IDENTITY_IMMUTABLE';end if;
  new.authorization_revision:=old.authorization_revision+case when new.can_send is distinct from old.can_send then 1 else 0 end;
 else
  new.mail_authorization_revision:=old.mail_authorization_revision+case when (new.seller_id,new.closer_id,new.handed_off_at,new.archived_at,new.stage) is distinct from (old.seller_id,old.closer_id,old.handed_off_at,old.archived_at,old.stage) then 1 else 0 end;
 end if;
 return new;
end$$;
create trigger brand_revision before update on public.profiles for each row execute function brand_b2.revision();
create trigger brand_revision before update on public.mail_permissions for each row execute function brand_b2.revision();
create trigger brand_revision before update on public.opportunities for each row execute function brand_b2.revision();
-- Retain revoked permission rows: deleting/recreating must not reset a revision.
create function brand_b2.revoke_permission() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.mail_permissions set can_send=false where account_id=old.account_id and user_id=old.user_id;return null;end$$;
create trigger brand_revoke before delete on public.mail_permissions for each row execute function brand_b2.revoke_permission();

create function brand_b2.context(account uuid,actor uuid,purpose text,case_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.mail_accounts;b public.operating_brands;p public.profiles;m public.operating_brand_memberships;perm public.mail_permissions;o public.opportunities;phase public.case_area;
begin
 select * into a from public.mail_accounts where id=account;
 if a.id is null or a.operating_brand_id is null then raise exception 'BRAND_PREPARATION_REQUIRED';end if;
 select * into b from public.operating_brands where id=a.operating_brand_id for share;
 select * into a from public.mail_accounts where id=account for update;
 if a.operating_brand_id is distinct from b.id or not b.active or a.status<>'connected' or not exists(select 1 from public.mail_account_brand_reviews r where r.account_id=a.id and r.proposed_brand_id=b.id and r.status='confirmed' and r.expected_account_revision=a.brand_revision-1) then raise exception 'BRAND_PREPARATION_REQUIRED';end if;
 if purpose not in ('mail','campaign','sender','system_notification') or purpose is null then raise exception 'BRAND_INVALID_INPUT';end if;
 if purpose<>'system_notification' then
  select * into m from public.operating_brand_memberships where brand_id=b.id and user_id=actor for share;
  select * into perm from public.mail_permissions where account_id=a.id and user_id=actor for share;
  select * into p from public.profiles where id=actor for share;
  if p.id is null or not p.active or (p.role<>'superadmin' and (m.user_id is null or not m.active or not coalesce(perm.can_send,false))) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
  if purpose='campaign' and p.role not in ('superadmin','seller_admin') then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
  if case_id is not null then
   select * into o from public.opportunities where id=case_id for update;
   phase:=s01_i02.phase(case_id);
   if not s01_i02.actor_can_write(actor,case_id,phase,account) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
  elsif purpose='mail' then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
 end if;
 return jsonb_build_object('version',1,'brand_id',b.id,'brand_code',b.code,'brand_name',b.name,'brand_revision',b.revision,
  'account_id',a.id,'account_revision',a.brand_revision,'actor_id',p.id,'actor_revision',p.mail_authorization_revision,'actor_role',p.role,
  'membership_revision',case when p.role<>'superadmin' then m.revision end,'permission_revision',case when p.role<>'superadmin' then perm.authorization_revision end,
  'purpose',purpose,'authorization',case when purpose='system_notification' then 'system_notification' else 'human_aal2' end,
  'prepared_at',clock_timestamp(),'case_id',case_id,'case_revision',o.mail_authorization_revision,'area',phase);
end$$;
create function brand_b2.same_revision(snapshot jsonb,current_context jsonb) returns boolean language sql immutable set search_path='' as $$
 select snapshot is not null and (snapshot-'prepared_at'-'brand_name'-'brand_code'-'notification_id'-'recipient_id'-'recipient_revision'-'campaign_id'-'area') =
 (current_context-'prepared_at'-'brand_name'-'brand_code'-'notification_id'-'recipient_id'-'recipient_revision'-'campaign_id'-'area')
$$;
create function brand_b2.expected(s jsonb,expected jsonb) returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(expected) is distinct from 'object' or expected is distinct from jsonb_build_object('brand_id',s->'brand_id','brand_revision',s->'brand_revision','account_revision',s->'account_revision') then raise exception 'BRAND_PREPARATION_STALE';end if;
end$$;
create function public.brand_prepare_context(account uuid,preparation jsonb,purpose text,case_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
 if public.current_app_role() is null then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
 if purpose not in ('mail','campaign') or purpose is null then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
 s:=brand_b2.context(account,auth.uid(),purpose,case_id);perform brand_b2.expected(s,preparation);return s;
end$$;
create function public.brand_sender_capabilities() returns setof jsonb language plpgsql security definer set search_path='' as $$
declare a public.mail_accounts;s jsonb;
begin
 if public.current_app_role() is null then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
 for a in select x.* from public.mail_accounts x where x.operating_brand_id is not null and (public.current_app_role()='superadmin' or exists(select 1 from public.mail_permissions p join public.operating_brand_memberships m on m.user_id=p.user_id and m.brand_id=x.operating_brand_id and m.active where p.account_id=x.id and p.user_id=auth.uid() and p.can_send)) order by x.operating_brand_id,x.id loop
  begin
   s:=brand_b2.context(a.id,auth.uid(),'sender');
  exception when raise_exception then
   continue;
  end;
  return next jsonb_build_object('account_id',a.id,'brand_id',s->'brand_id','brand_name',s->'brand_name','brand_code',s->'brand_code','brand_revision',s->'brand_revision','account_revision',s->'account_revision','can_campaign',public.current_app_role() in ('superadmin','seller_admin'));
 end loop;
end$$;

create function brand_b2.validate_snapshot(s jsonb,account uuid,actor uuid,purpose text) returns boolean language plpgsql security definer set search_path='' as $$
declare current_context jsonb;
begin
 if s is null or s->>'version'<>'1' or (s->>'account_id')::uuid is distinct from account or (s->>'actor_id')::uuid is distinct from actor or s->>'purpose' is distinct from purpose then return false;end if;
 current_context:=brand_b2.context(account,actor,purpose,(s->>'case_id')::uuid);
 return brand_b2.same_revision(s,current_context);
exception when raise_exception or invalid_text_representation then return false;
end$$;

create function brand_b2.campaign_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare ctx jsonb:=nullif(current_setting('pipeline_os.brand_context',true),'')::jsonb;
begin
 if tg_op='INSERT' then
  if ctx is null or ctx->>'purpose'<>'campaign' or (ctx->>'actor_id')::uuid is distinct from new.created_by or (ctx->>'account_id')::uuid is distinct from new.account_id then raise exception 'BRAND_PREPARATION_REQUIRED';end if;
  if new.brand_snapshot is not null and new.brand_snapshot is distinct from ctx then raise exception 'BRAND_SNAPSHOT_IMMUTABLE';end if;
  new.brand_snapshot:=ctx;new.brand_created_tx:=txid_current();
 else
  if new.brand_snapshot is distinct from old.brand_snapshot then
   if ctx is null or new.brand_snapshot is distinct from ctx or (ctx->>'actor_id')::uuid is distinct from old.created_by or old.status not in ('draft','paused') or exists(select 1 from public.campaign_enrollments e join public.outbox x on x.enrollment_id=e.id where e.campaign_id=old.id) then raise exception 'BRAND_SNAPSHOT_IMMUTABLE';end if;
  end if;
  if new.brand_created_tx is distinct from old.brand_created_tx then raise exception 'BRAND_SNAPSHOT_IMMUTABLE';end if;
  if (new.selected_contact_ids,new.excluded_contact_ids,new.scheduled_at,new.first_contact) is distinct from (old.selected_contact_ids,old.excluded_contact_ids,old.scheduled_at,old.first_contact) and ctx is null then raise exception 'BRAND_PREPARATION_REQUIRED';end if;
  if (new.account_id,new.created_by,new.subject,new.body,new.steps,new.asset_snapshot,new.template_id,new.template_version,new.seller_id,new.daily_limit,new.timezone,new.start_hour,new.end_hour,new.requires_application) is distinct from (old.account_id,old.created_by,old.subject,old.body,old.steps,old.asset_snapshot,old.template_id,old.template_version,old.seller_id,old.daily_limit,old.timezone,old.start_hour,old.end_hour,old.requires_application)
   and not (old.brand_created_tx=txid_current() and ctx is not null and ctx=old.brand_snapshot) then raise exception 'BRAND_SNAPSHOT_IMMUTABLE';end if;
  if new.status='active' and old.status<>'active' and (ctx is null or ctx->>'purpose'<>'campaign' or not brand_b2.validate_snapshot(new.brand_snapshot,new.account_id,new.created_by,'campaign')) then raise exception 'BRAND_PREPARATION_STALE';end if;
 end if;
 return new;
end$$;
create trigger brand_campaign before insert or update on public.campaigns for each row execute function brand_b2.campaign_guard();

create function brand_b2.outbox_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare ctx jsonb:=nullif(current_setting('pipeline_os.brand_context',true),'')::jsonb;c public.campaigns;e public.campaign_enrollments;s jsonb;p public.profiles;notification public.notifications;
begin
 if tg_op='UPDATE' then
  if new.brand_snapshot is distinct from old.brand_snapshot or new.brand_created_tx is distinct from old.brand_created_tx then raise exception 'BRAND_SNAPSHOT_IMMUTABLE';end if;
  if (to_jsonb(new)-array['status','last_error','available_at','sending_at','sent_at','gmail_message_id','gmail_thread_id','send_attempts','attachment_snapshot','signature_html','sender_name','conversation_id','brand_claim_token','brand_admission_id']) is distinct from
     (to_jsonb(old)-array['status','last_error','available_at','sending_at','sent_at','gmail_message_id','gmail_thread_id','send_attempts','attachment_snapshot','signature_html','sender_name','conversation_id','brand_claim_token','brand_admission_id'])
    and not (old.brand_created_tx=txid_current() and ctx is not null and public.current_app_role() is not null) then raise exception 'BRAND_INTENT_IMMUTABLE';end if;
  if old.status in ('sent','uncertain','sending') and new.status='queued' and (old.status in ('sent','uncertain') or old.brand_admission_id is not null) and current_setting('pipeline_os.brand_known_quota',true) is distinct from old.id::text then raise exception 'BRAND_RECONCILIATION_REQUIRED';end if;
  if new.status='queued' and old.status<>'queued' and new.brand_snapshot is null then raise exception 'BRAND_PREPARATION_REQUIRED';end if;
  return new;
 end if;
 if new.notification_id is not null then
  if ctx is null or ctx->>'purpose'<>'system_notification' or ctx->>'notification_id' is distinct from new.notification_id::text or new.opportunity_id is not null or new.requested_by is not null then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
  select * into notification from public.notifications where id=new.notification_id;select * into p from public.profiles where id=notification.user_id;
  if p.id is null or not p.active or new.to_email<>p.email or not exists(select 1 from public.notification_preferences where user_id=p.id and email) or not s01_i02.actor_notification_allowed(p.id,notification.event_key) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
  s:=ctx;
 elsif new.enrollment_id is not null then
  select * into e from public.campaign_enrollments where id=new.enrollment_id;
  select * into c from public.campaigns where id=e.campaign_id;
  if c.status<>'active' or c.id is null or c.account_id<>new.account_id or c.created_by is distinct from new.requested_by or e.opportunity_id<>new.opportunity_id or new.to_email is distinct from (select email from public.contacts where id=e.contact_id)
    or not brand_b2.validate_snapshot(c.brand_snapshot,c.account_id,c.created_by,'campaign') then raise exception 'BRAND_PREPARATION_STALE';end if;
  s:=c.brand_snapshot||jsonb_build_object('campaign_id',c.id,'case_id',new.opportunity_id,'case_revision',(select mail_authorization_revision from public.opportunities where id=new.opportunity_id),'area',new.area);
  if not s01_i02.actor_can_write(new.requested_by,new.opportunity_id,new.area,new.account_id) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
 else
  if ctx is null or public.current_app_role() is null or (ctx->>'actor_id')::uuid is distinct from auth.uid() or new.requested_by is distinct from auth.uid() or (ctx->>'account_id')::uuid is distinct from new.account_id then raise exception 'BRAND_PREPARATION_REQUIRED';end if;
  if new.campaign_test then
   if ctx->>'purpose'<>'campaign' or new.to_email is distinct from (select email from public.profiles where id=auth.uid()) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
   s:=ctx||jsonb_build_object('case_id',new.opportunity_id,'case_revision',(select mail_authorization_revision from public.opportunities where id=new.opportunity_id),'area',new.area);
  else
   if ctx->>'purpose'<>'mail' or (ctx->>'case_id')::uuid is distinct from new.opportunity_id or not s01_i02.actor_can_write(auth.uid(),new.opportunity_id,new.area,new.account_id) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
   s:=ctx||jsonb_build_object('area',new.area);
  end if;
 end if;
 if new.reply_message_id is not null and exists(select 1 from public.messages m where m.id=new.reply_message_id and m.brand_snapshot is not null and m.brand_snapshot->>'brand_id' is distinct from s->>'brand_id') then raise exception 'BRAND_REPLY_MISMATCH';end if;
 if new.brand_snapshot is not null and new.brand_snapshot is distinct from s then raise exception 'BRAND_SNAPSHOT_IMMUTABLE';end if;
 new.brand_snapshot:=s;new.brand_created_tx:=txid_current();new.brand_claim_token:=null;new.brand_admission_id:=null;return new;
end$$;
create trigger brand_outbox before insert or update on public.outbox for each row execute function brand_b2.outbox_guard();

create function public.brand_queue_mail(operation text,p jsonb,preparation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;answer jsonb;item jsonb;queued public.outbox;case_id uuid:=(p->>'case_id')::uuid;account uuid:=(p->>'account')::uuid;
begin
 s:=public.brand_prepare_context(account,preparation,'mail',case_id);perform set_config('pipeline_os.brand_context',s::text,true);
 case operation
 when 'queue_mail_email' then answer:=to_jsonb(public.queue_mail_email(case_id,account,p->>'recipient',p->>'subject_text',p->>'body_text',array(select jsonb_array_elements_text(p->'files')::uuid),array(select jsonb_array_elements_text(p->'gmail_files')::uuid),array(select jsonb_array_elements_text(p->'uploads')::uuid),array(select jsonb_array_elements_text(p->'copies')),array(select jsonb_array_elements_text(p->'hidden_copies')),(p->>'process')::uuid,(p->>'conversation')::uuid,(p->>'reply_message')::uuid,(p->>'submission')::uuid,p->>'signature',p->>'display_name',(p->>'request')::uuid));
 when 'queue_mail_forward' then answer:=to_jsonb(public.queue_mail_forward(p));
 when 'queue_mail_lenders' then answer:=public.queue_mail_lenders(p);
 when 'queue_lender_reply' then answer:=to_jsonb(public.queue_lender_reply(p));
 when 'queue_manual_email' then answer:=to_jsonb(public.queue_manual_email(case_id,account,p->>'recipient',p->>'subject_text',p->>'body_text',array(select jsonb_array_elements_text(p->'files')::uuid),array(select jsonb_array_elements_text(p->'gmail_files')::uuid),(p->>'request')::uuid));
 when 'queue_lender_emails' then answer:=public.queue_lender_emails(case_id,account,(p->>'process')::uuid,p->'targets',p->>'subject_text',p->>'body_text',array(select jsonb_array_elements_text(p->'files')::uuid),array(select jsonb_array_elements_text(p->'gmail_files')::uuid),(p->>'request')::uuid);
 else raise exception 'BRAND_INVALID_INPUT';end case;
 for item in select value from jsonb_array_elements(case when jsonb_typeof(answer)='array' then answer else jsonb_build_array(jsonb_build_object('id',answer)) end) loop
  select * into queued from public.outbox where id=(item->>'id')::uuid;
  if queued.id is null or queued.requested_by is distinct from auth.uid() or queued.account_id is distinct from account or queued.opportunity_id is distinct from case_id then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
  perform brand_b2.expected(queued.brand_snapshot,preparation);
  if queued.status not in ('sent','uncertain') and not brand_b2.validate_snapshot(queued.brand_snapshot,account,auth.uid(),'mail') then raise exception 'BRAND_PREPARATION_STALE';end if;
 end loop;
 perform set_config('pipeline_os.brand_context','',true);return answer;
end$$;


-- Preserve parameter qualification after renaming the existing CRM wrapper.
CREATE OR REPLACE FUNCTION public.crm_command_before_brand_b1(kind text, p jsonb, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.campaigns;r jsonb;receipt public.command_receipts;ids uuid[];a record;original jsonb:=p;
begin
 if kind='reply' then perform s01_i02.assert_write((select scope_thread.opportunity_id from public.conversations scope_thread where scope_thread.id=(p->>'conversation_id')::uuid));elsif kind='lender_email' then perform s01_i02.assert_write((p->>'opportunity_id')::uuid);if not coalesce(public.can_area((p->>'opportunity_id')::uuid,'closer'),false) then raise exception 'Closer area access required';end if;end if;
 if kind not in ('create_campaign','activate_campaign','schedule_campaign','pause_campaign') then return public.crm_command_v42_first_contact(kind,p,request_key);end if;
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') or request_key is null then raise exception 'Campaign administrator and MFA required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts cr where cr.user_id=auth.uid() and cr.request_key=crm_command_before_brand_b1.request_key;
 if receipt.user_id is not null then
  if receipt.kind<>kind or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused';end if;return receipt.result;
 end if;
 if kind='create_campaign' then
  if coalesce(btrim(p->>'name'),'')='' or length(p->>'name')>200 then raise exception 'Campaign name required';end if;
  r:=public.crm_command_v42_first_contact(kind,p,request_key);
  update public.campaigns set steps='[]',first_contact=true,batch_id=null,
   requires_application=(subject||body) ~ '\{\{\s*application_url\s*\}\}' where id=(r->>'id')::uuid returning * into c;
  if p ? 'selected_contact_ids' then
   if jsonb_typeof(p->'selected_contact_ids')<>'array' or jsonb_array_length(p->'selected_contact_ids')>5000 then raise exception 'Invalid lead selection';end if;
   ids:=array(select distinct value::uuid from jsonb_array_elements_text(p->'selected_contact_ids'));
   if exists(select 1 from unnest(ids) id where not exists(select 1 from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) x where x.contact_id=id and x.reason='eligible')) then raise exception 'Selecciona solo leads elegibles / Select eligible leads only';end if;
  else
   ids:=array(select x.contact_id from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) x where x.reason='eligible' limit 5000);
  end if;
  -- A draft may be saved before leads are ready; activation always needs recipients.
  update public.campaigns set selected_contact_ids=ids where id=c.id;
  return r;
 end if;
 select * into c from public.campaigns where id=(p->>'id')::uuid for update;
 if c.id is null or not coalesce(public.can_send(c.account_id),false) then raise exception 'Campaign and sender access required';end if;
 if kind='pause_campaign' or not c.first_contact then
  if kind='schedule_campaign' then raise exception 'Schedule first-contact campaigns only';end if;
  r:=public.crm_command_v42_first_contact(kind,p,request_key);
  if kind='activate_campaign' then update public.campaigns set activated_at=coalesce(activated_at,now()) where id=c.id;end if;
  return r;
 end if;
 if c.status not in ('draft','paused') then raise exception 'Campaign must be draft or paused';end if;
 if not exists(select 1 from public.mail_accounts where id=c.account_id and status='connected') then raise exception 'Gmail account disconnected';end if;
 if kind='schedule_campaign' and (nullif(p->>'scheduled_at','') is null or (p->>'scheduled_at')::timestamptz<=now()) then raise exception 'Choose a future date and time';end if;
 -- Lock the selected contacts, then repeat all eligibility checks transactionally.
 perform 1 from public.contacts where id=any(c.selected_contact_ids) order by id for update;
 if exists(select 1 from public.campaign_audience(c.id) x where x.reason='missing_data') then raise exception 'Hay leads con datos faltantes';end if;
 if not exists(select 1 from public.campaign_audience(c.id) x where x.reason='eligible' and not exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id and e.contact_id=x.contact_id and e.status not in ('active','paused'))) then raise exception 'No hay destinatarios elegibles';end if;
 for a in select * from public.campaign_audience(c.id) where reason='eligible' loop
  insert into public.campaign_enrollments(campaign_id,contact_id,opportunity_id,next_at)
  values(c.id,a.contact_id,a.opportunity_id,case when kind='schedule_campaign' then (p->>'scheduled_at')::timestamptz else now() end)
  on conflict(campaign_id,contact_id) do update set status='active' where campaign_enrollments.status='paused';
  update public.opportunities set seller_id=c.seller_id,campaign_id=c.id where id=a.opportunity_id;
 end loop;
 update public.campaigns set status='active',activated_at=case when kind='schedule_campaign' then null else coalesce(activated_at,now()) end,scheduled_at=case when kind='schedule_campaign' then (p->>'scheduled_at')::timestamptz else null end where id=c.id;
 r:=jsonb_build_object('id',c.id);
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request_key,kind,r,md5(original::text));
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'campaign',c.id,kind);
 return r;
end $function$
;
alter function public.crm_command(text,jsonb,uuid) rename to crm_command_before_brand_b2;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.campaigns;s jsonb;answer jsonb;account uuid;receipt public.command_receipts;fingerprint text;
begin
 if kind not in ('create_campaign','activate_campaign','schedule_campaign','pause_campaign','campaign_audience_settings','prepare_campaign') then return public.crm_command_before_brand_b2(kind,p,request_key);end if;
 if public.current_app_role() not in ('superadmin','seller_admin') or public.current_app_role() is null then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
 if kind='pause_campaign' then
  if not brand_b2.can_campaign((p->>'id')::uuid) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
  return public.crm_command_before_brand_b2(kind,p,request_key);
 end if;
 if kind='create_campaign' then account:=(p->>'account_id')::uuid;
 else select * into c from public.campaigns where id=(p->>'id')::uuid;account:=c.account_id;end if;
 s:=public.brand_prepare_context(account,p->'brand_preparation','campaign');
 if c.id is not null then
  perform 1 from public.campaigns where id=c.id for update;
  if kind<>'prepare_campaign' and not brand_b2.validate_snapshot(c.brand_snapshot,c.account_id,c.created_by,'campaign') then raise exception 'BRAND_PREPARATION_STALE';end if;
 end if;
 perform set_config('pipeline_os.brand_context',s::text,true);
 if kind='prepare_campaign' then
  if c.created_by is distinct from auth.uid() then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
  if request_key is null or exists(select 1 from jsonb_object_keys(p) k where k not in ('id','brand_preparation')) then raise exception 'BRAND_INVALID_INPUT';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||request_key::text,0));
  fingerprint:=encode(sha256(convert_to(p::text,'UTF8')),'hex');
  select * into receipt from public.command_receipts cr where cr.user_id=auth.uid() and cr.request_key=crm_command.request_key;
  if receipt.user_id is not null then
   if receipt.kind<>kind or receipt.fingerprint<>fingerprint then raise exception 'BRAND_PREPARATION_STALE';end if;
   perform set_config('pipeline_os.brand_context','',true);return receipt.result;
  end if;
  update public.campaigns set brand_snapshot=s where id=c.id;answer:=jsonb_build_object('id',c.id);
  insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request_key,kind,answer,fingerprint);
  insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'campaign',c.id,'brand_campaign_prepared');
 else answer:=public.crm_command_before_brand_b2(kind,p,request_key);end if;
 perform set_config('pipeline_os.brand_context','',true);return answer;
end$$;

alter function public.queue_campaign_test(uuid,uuid,text,text,text,uuid) rename to queue_campaign_test_before_brand_b2;
create function public.queue_brand_campaign_test(campaign uuid,contact uuid,subject_text text,body_text text,html text,request uuid,preparation jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;s jsonb;result uuid;
begin
 select * into c from public.campaigns where id=campaign;
 s:=public.brand_prepare_context(c.account_id,preparation,'campaign');
 if not brand_b2.validate_snapshot(c.brand_snapshot,c.account_id,c.created_by,'campaign') then raise exception 'BRAND_PREPARATION_STALE';end if;
 perform 1 from public.campaigns where id=c.id for share;
 perform set_config('pipeline_os.brand_context',s::text,true);
 result:=public.queue_campaign_test_before_brand_b2(campaign,contact,subject_text,body_text,html,request);
 perform set_config('pipeline_os.brand_context','',true);return result;
end$$;
create function public.queue_campaign_test(campaign uuid,contact uuid,subject_text text,body_text text,html text,request uuid) returns uuid language plpgsql set search_path='' as $$begin raise exception 'BRAND_PREPARATION_REQUIRED';end$$;

create function public.brand_campaign_ready(campaign uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.campaigns;begin select * into c from public.campaigns where id=campaign;return c.id is not null and c.status='active' and brand_b2.validate_snapshot(c.brand_snapshot,c.account_id,c.created_by,'campaign');end$$;
create function public.queue_brand_notification(notification uuid,account uuid,origin text) returns uuid language plpgsql security definer set search_path='' as $$
declare n public.notifications;p public.profiles;s jsonb;answer uuid;
begin
 s:=brand_b2.context(account,null,'system_notification');
 select * into n from public.notifications where id=notification;select * into p from public.profiles where id=n.user_id and active for share;
 if n.id is null or p.id is null or origin !~ '^https://[^[:space:]<>]+$' or length(origin)>500 or not exists(select 1 from public.notification_preferences where user_id=p.id and email) or not s01_i02.actor_notification_allowed(p.id,n.event_key) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
 s:=s||jsonb_build_object('notification_id',n.id,'recipient_id',p.id,'recipient_revision',p.mail_authorization_revision);
 perform set_config('pipeline_os.brand_context',s::text,true);
 insert into public.outbox(notification_id,account_id,to_email,subject,body,area,message_id_header,requested_by,request_key)
 values(n.id,account,p.email,'Your Curated Financial workspace has an update','You have a new update. Sign in to your secure workspace to review it.'||E'\n\n'||origin,'general','<notification.'||n.id::text||'@crm.curated.local>',null,'notification:'||n.id::text)
 on conflict(request_key) do nothing returning id into answer;
 perform set_config('pipeline_os.brand_context','',true);
 return coalesce(answer,(select id from public.outbox where request_key='notification:'||n.id::text));
end$$;

create function brand_b2.draft_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if public.current_app_role() is null or new.user_id is distinct from auth.uid() or not public.can_mail_case(new.opportunity_id) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
 new.brand_account_id:=(new.payload->>'account_id')::uuid;
 if new.brand_account_id is null then new.brand_snapshot:=null;
 else new.brand_snapshot:=public.brand_prepare_context(new.brand_account_id,new.payload->'brand_preparation','mail',new.opportunity_id);end if;
 return new;
end$$;
create trigger brand_draft before insert or update on public.mail_drafts for each row execute function brand_b2.draft_guard();
create function brand_b2.delivery_allowed(msg public.outbox) returns boolean language plpgsql security definer set search_path='' as $$
declare p public.profiles;n public.notifications;c public.campaigns;s jsonb:=msg.brand_snapshot;
begin
 if not brand_b2.validate_snapshot(s,msg.account_id,msg.requested_by,s->>'purpose') then return false;end if;
 if msg.enrollment_id is not null then
  select c0.* into c from public.campaigns c0 join public.campaign_enrollments e on e.campaign_id=c0.id where e.id=msg.enrollment_id for share of c0;
  if s->>'campaign_id' is distinct from c.id::text or not brand_b2.validate_snapshot(c.brand_snapshot,c.account_id,c.created_by,'campaign') then return false;end if;
 end if;
 if msg.notification_id is not null then
  select * into n from public.notifications where id=msg.notification_id;
  select * into p from public.profiles where id=n.user_id and active for share;
  return s->>'purpose'='system_notification' and s->>'notification_id'=n.id::text and s->>'recipient_id'=p.id::text and (s->>'recipient_revision')::bigint=p.mail_authorization_revision
   and msg.requested_by is null and msg.to_email=p.email and exists(select 1 from public.notification_preferences where user_id=p.id and email) and s01_i02.actor_notification_allowed(p.id,n.event_key);
 end if;
 return msg.opportunity_id is not null and (s->>'area')::public.case_area=msg.area and s01_i02.delivery_allowed(msg.id);
end$$;

alter function public.recheck_outbox_delivery(uuid) rename to recheck_outbox_delivery_before_brand_b2;
create function brand_b2.claim(notification_only boolean) returns setof public.outbox language plpgsql security definer set search_path='' as $$
declare candidate public.outbox;msg public.outbox;a public.mail_accounts;usage jsonb;c public.campaigns;sent_count integer;
begin
 for candidate in select selected.* from (select * from public.outbox where status='queued' and available_at<=now() and (notification_id is not null)=notification_only order by available_at,id limit 30) selected order by selected.brand_snapshot->>'brand_id',selected.account_id,selected.available_at,selected.id loop
  -- context locks brand -> account -> membership/permission/profile/case; no outbox lock yet.
  if not brand_b2.delivery_allowed(candidate) then
   update public.outbox set status='paused',last_error='BRAND_PREPARATION_STALE' where id=candidate.id and status='queued';continue;
  end if;
  select * into msg from public.outbox where id=candidate.id and status='queued' and available_at<=now() for update skip locked;
  if msg.id is null or msg.brand_snapshot is distinct from candidate.brand_snapshot then continue;end if;
  if exists(select 1 from public.mail_brand_dispatch_admissions where outbox_id=msg.id and outcome in ('admitted','uncertain','accepted')) then
   update public.outbox set status='uncertain',last_error='BRAND_RECONCILIATION_REQUIRED' where id=msg.id;continue;
  end if;
  select * into a from public.mail_accounts where id=msg.account_id;
  usage:=public.account_delivery_usage(a.id);
  if a.send_retry_at>now() or (usage->>'total_messages')::int>=a.daily_limit or (usage->>'recipient_count')::int+1+coalesce(cardinality(msg.cc_emails),0)+coalesce(cardinality(msg.bcc_emails),0)>2000
   or exists(select 1 from public.outbox x where x.account_id=a.id and x.sending_at>now()-interval '30 seconds') then
   update public.outbox set available_at=greatest(now()+interval '1 minute',coalesce(a.send_retry_at,now())) where id=msg.id;continue;
  end if;
  if msg.enrollment_id is not null then
   select c0.* into c from public.campaigns c0 join public.campaign_enrollments e on e.campaign_id=c0.id where e.id=msg.enrollment_id;
   select count(*) into sent_count from public.outbox x join public.campaign_enrollments e on e.id=x.enrollment_id where e.campaign_id=c.id and x.status in ('sent','sending','uncertain') and coalesce(x.sent_at,x.sending_at)>now()-interval '24 hours';
   if sent_count>=c.daily_limit or (usage->>'campaign_remaining')::int<=0 then update public.outbox set available_at=now()+interval '1 hour' where id=msg.id;continue;end if;
  end if;
  if msg.opportunity_id is not null and not exists(select 1 from public.opportunities o where o.id=msg.opportunity_id and (o.email_qualified_at is not null or o.historical_approved_at is not null)) then
   update public.outbox set status='paused',last_error='BRAND_PREPARATION_STALE' where id=msg.id;continue;
  end if;
  update public.outbox set status='sending',sending_at=now(),send_attempts=send_attempts+1,brand_claim_token=gen_random_uuid(),brand_admission_id=null where id=msg.id returning * into msg;
  if not public.recheck_outbox_delivery_before_brand_b2(msg.id) then continue;end if;
  return next msg;return;
 end loop;
end$$;
create or replace function public.claim_outbox() returns setof public.outbox language sql security definer set search_path='' as $$select * from brand_b2.claim(false)$$;
create or replace function public.claim_notification_outbox() returns setof public.outbox language sql security definer set search_path='' as $$select * from brand_b2.claim(true)$$;
-- The old boolean is a closed compatibility endpoint, never a reusable permit.
create function public.recheck_outbox_delivery(message uuid) returns boolean language sql security definer set search_path='' as $$select false$$;

create function public.brand_signature_allowed(message uuid,claim_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare m public.outbox;begin select * into m from public.outbox where id=message;return m.id is not null and m.status='sending' and m.brand_claim_token is not distinct from claim_token and claim_token is not null and brand_b2.delivery_allowed(m);end$$;
create function public.admit_brand_dispatch(message uuid,claim_token uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare observed public.outbox;m public.outbox;permit uuid;seq integer;
begin
 select * into observed from public.outbox where id=message;
 if observed.id is null or not brand_b2.delivery_allowed(observed) then
  update public.outbox set status='paused',last_error='BRAND_PREPARATION_STALE' where id=message and status in ('queued','sending') and brand_admission_id is null;return null;
 end if;
 select * into m from public.outbox where id=message for update;
 if m.status<>'sending' or m.brand_claim_token is distinct from claim_token or claim_token is null or m.brand_snapshot is distinct from observed.brand_snapshot or m.brand_admission_id is not null
  or exists(select 1 from public.mail_brand_dispatch_admissions where outbox_id=m.id and (outcome in ('admitted','uncertain','accepted') or mail_brand_dispatch_admissions.claim_token=admit_brand_dispatch.claim_token)) then return null;end if;
 if not public.recheck_outbox_delivery_before_brand_b2(m.id) then return null;end if;
 select coalesce(max(sequence),0)+1 into seq from public.mail_brand_dispatch_admissions where outbox_id=m.id;
 insert into public.mail_brand_dispatch_admissions(outbox_id,claim_token,sequence,snapshot) values(m.id,claim_token,seq,m.brand_snapshot) returning id into permit;
 update public.outbox set brand_admission_id=permit where id=m.id;return permit;
end$$;

alter function public.mark_sent(uuid,text,text) rename to mark_sent_before_brand_b2;
create function public.mark_sent(outbox_id uuid,gmail_id text,thread_id text) returns void language plpgsql security definer set search_path='' as $$
declare m public.outbox;ad public.mail_brand_dispatch_admissions;observed public.outbox;
begin
 -- Result reconciliation does not renew authorization or create another admission.
 select * into observed from public.outbox where id=outbox_id;
 perform 1 from public.operating_brands where id=(observed.brand_snapshot->>'brand_id')::uuid for share;
 perform 1 from public.mail_accounts where id=observed.account_id for update;
 perform 1 from public.operating_brand_memberships where brand_id=(observed.brand_snapshot->>'brand_id')::uuid and user_id=observed.requested_by for share;
 perform 1 from public.mail_permissions where account_id=observed.account_id and user_id=observed.requested_by for share;
 perform 1 from public.profiles where id=observed.requested_by for share;
 perform 1 from public.opportunities where id=observed.opportunity_id for update;
 perform 1 from public.campaigns c join public.campaign_enrollments e on e.campaign_id=c.id where e.id=observed.enrollment_id for share of c;
 select * into m from public.outbox where id=outbox_id for update;
 if m.status='sent' then return;end if;
 if m.brand_snapshot is null and m.status in ('sending','uncertain') then perform public.mark_sent_before_brand_b2(outbox_id,gmail_id,thread_id);return;end if;
 select * into ad from public.mail_brand_dispatch_admissions where id=m.brand_admission_id and mail_brand_dispatch_admissions.outbox_id=m.id for update;
 if ad.id is null or ad.outcome not in ('admitted','uncertain') then raise exception 'BRAND_ADMISSION_REQUIRED';end if;
 perform public.mark_sent_before_brand_b2(outbox_id,gmail_id,thread_id);
 update public.mail_brand_dispatch_admissions set outcome='accepted',resolved_at=now() where id=ad.id;
 update public.messages set brand_snapshot=jsonb_build_object('brand_id',m.brand_snapshot->'brand_id','brand_name',m.brand_snapshot->'brand_name','brand_code',m.brand_snapshot->'brand_code'),brand_provenance='dispatch_snapshot' where internet_message_id=m.message_id_header;
end$$;
alter function public.defer_gmail_send(uuid,integer,text) rename to defer_gmail_send_before_brand_b2;
create function public.defer_gmail_send(message uuid,seconds integer,error_code text) returns void language plpgsql security definer set search_path='' as $$
declare observed public.outbox;m public.outbox;
begin
 select * into observed from public.outbox where id=message;
 -- Acquire the account before outbox even when a settings read hit a known quota.
 perform 1 from public.operating_brands where id=(observed.brand_snapshot->>'brand_id')::uuid for share;
 perform 1 from public.mail_accounts where id=observed.account_id for update;
 select * into m from public.outbox where id=message for update;
 if m.status<>'sending' then return;end if;
 if m.brand_admission_id is not null then
  update public.mail_brand_dispatch_admissions set outcome='known_quota',resolved_at=now() where id=m.brand_admission_id and outcome='admitted';
  if not found then raise exception 'BRAND_RECONCILIATION_REQUIRED';end if;
 end if;
 perform set_config('pipeline_os.brand_known_quota',message::text,true);
 perform public.defer_gmail_send_before_brand_b2(message,seconds,error_code);
 perform set_config('pipeline_os.brand_known_quota','',true);
end$$;
create function public.brand_dispatch_uncertain(message uuid,admission uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.outbox;
begin
 select * into m from public.outbox where id=message for update;
 if m.status='sent' then return;end if;
 if m.brand_admission_id is distinct from admission then raise exception 'BRAND_ADMISSION_REQUIRED';end if;
 update public.mail_brand_dispatch_admissions set outcome='uncertain',resolved_at=now() where id=admission and outbox_id=message and outcome in ('admitted','uncertain');
 update public.outbox set status='uncertain',last_error='SEND_RESULT_UNCERTAIN' where id=message;
end$$;

create function brand_b2.message_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.outbox;
begin
 if tg_op='UPDATE' and (old.brand_snapshot is not null or old.brand_provenance<>'unconfirmed') then
  if (new.brand_snapshot,new.brand_provenance) is distinct from (old.brand_snapshot,old.brand_provenance) then raise exception 'BRAND_SNAPSHOT_IMMUTABLE';end if;return new;
 end if;
 if new.direction='outbound' then select * into o from public.outbox where message_id_header=new.internet_message_id and status='sent' and brand_admission_id is not null;
  if o.id is not null then new.brand_snapshot:=jsonb_build_object('brand_id',o.brand_snapshot->'brand_id','brand_name',o.brand_snapshot->'brand_name','brand_code',o.brand_snapshot->'brand_code');new.brand_provenance:='dispatch_snapshot';return new;end if;
 end if;
 if new.brand_snapshot is not null or new.brand_provenance<>'unconfirmed' then raise exception 'BRAND_HISTORY_UNCONFIRMED';end if;
 return new;
end$$;
create trigger brand_message before insert or update on public.messages for each row execute function brand_b2.message_guard();

create policy brand_campaign_read on public.campaigns as restrictive for select to authenticated using(
 public.current_app_role()='superadmin' or (public.current_app_role() in ('seller_admin','seller') and exists(select 1 from public.operating_brand_memberships m where m.brand_id=(brand_snapshot->>'brand_id')::uuid and m.user_id=auth.uid() and m.active)));
-- Business snapshot columns remain available only through row-scoped reads/RPCs.
create or replace view public.campaign_workspace with(security_invoker=true) as
select c.id,c.name,c.account_id,c.seller_id,c.created_by,c.status,c.daily_limit,c.timezone,c.start_hour,c.end_hour,c.subject,c.body,c.steps,c.batch_id,c.created_at,
c.template_id,c.template_version,c.requires_application,c.asset_snapshot,c.body_format,c.excluded_contact_ids,
(select count(*)::int from public.campaign_enrollments e where e.campaign_id=c.id) audience_count,public.campaign_delivery_stats(c.id) delivery_stats,
c.first_contact,c.selected_contact_ids,c.scheduled_at,c.activated_at,c.brand_snapshot from public.campaigns c;



-- Materialized, row-scoped versions of existing campaign readers.
create function brand_b2.can_sender(account uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.current_app_role() is not null and exists(select 1 from public.mail_accounts a join public.operating_brands b on b.id=a.operating_brand_id where a.id=account and (public.current_app_role()='superadmin' or (b.active and public.can_send(a.id) and exists(select 1 from public.operating_brand_memberships m where m.brand_id=b.id and m.user_id=auth.uid() and m.active))))
$$;
create function brand_b2.can_campaign(campaign uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.current_app_role() is not null and exists(select 1 from public.campaigns c where c.id=campaign and (public.current_app_role()='superadmin' or (public.current_app_role() in ('seller_admin','seller') and exists(select 1 from public.operating_brand_memberships m where m.brand_id=(c.brand_snapshot->>'brand_id')::uuid and m.user_id=auth.uid() and m.active))))
$$;
create function brand_b2.visible_campaigns() returns setof public.campaigns language sql stable security definer set search_path='' as $$select c.* from public.campaigns c where current_setting('role',true)='service_role' or brand_b2.can_campaign(c.id)$$;
CREATE OR REPLACE FUNCTION public.campaign_center(search_text text DEFAULT ''::text, page_number integer DEFAULT 0, status_filter text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin','seller') then raise exception 'Seller access required';end if;
 with visible as(select c.* from brand_b2.visible_campaigns() c where public.current_app_role() in ('superadmin','seller_admin') or c.seller_id=auth.uid()),
 facts as(select f.* from visible c cross join lateral public.campaign_contact_facts(c.id) f)
 select jsonb_build_object('summary',jsonb_build_object('active',(select count(*) from visible where status='active' and (scheduled_at is null or scheduled_at<=now())),
 'sent',(select count(*) from facts where send_status='sent'),'replied',(select count(distinct contact_id) from facts where send_status='sent' and reply_at is not null),
 'unanswered',(select count(distinct contact_id) from facts f where send_status='sent' and reply_at is null and not exists(select 1 from facts r where r.contact_id=f.contact_id and r.reply_at is not null))),
 'total',(select count(*) from visible where name ilike '%'||search_text||'%' and (status_filter='all' or (status_filter='scheduled' and status='active' and scheduled_at>now()) or (status_filter='active' and status='active' and (scheduled_at is null or scheduled_at<=now())) or (status_filter not in ('active','scheduled') and status=status_filter))),
 'campaigns',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('metrics',public.campaign_contact_summary(p.id))) from
 (select * from visible where name ilike '%'||search_text||'%' and (status_filter='all' or (status_filter='scheduled' and status='active' and scheduled_at>now()) or (status_filter='active' and status='active' and (scheduled_at is null or scheduled_at<=now())) or (status_filter not in ('active','scheduled') and status=status_filter)) order by created_at desc,id limit 25 offset greatest(0,page_number)*25) p),'[]')) into result;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.campaign_activity_page(page_number integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with visible as(select c.* from brand_b2.visible_campaigns() c where public.current_app_role() in ('superadmin','seller_admin') or (public.current_app_role()='seller' and c.seller_id=auth.uid())),
 events as(
 select c.id campaign_id,c.name,e.id::text id,e.kind,e.occurred_at,e.email from visible c join public.campaign_events e on e.campaign_id=c.id
 where e.opportunity_id is null or public.can_area(e.opportunity_id,'seller')
 union all
 select c.id,c.name,'reply:'||f.message_id::text,'replied',f.sent_at,f.email from visible c cross join lateral public.campaign_reply_rows(c.id) f)
 select jsonb_build_object('total',(select count(*) from events),'rows',coalesce((select jsonb_agg(p) from(select * from events order by occurred_at desc,id limit 50 offset greatest(0,page_number)*50) p),'[]'))
$function$
;
CREATE OR REPLACE FUNCTION public.campaign_contacts_page(campaign uuid, search_text text DEFAULT ''::text, state_filter text DEFAULT 'all'::text, page_number integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with filtered as(select * from public.campaign_contact_facts(campaign) f where
 (f.company||' '||f.name||' '||f.email) ilike '%'||search_text||'%' and
 (state_filter='all' or (state_filter='replied' and reply_at is not null) or (state_filter='unanswered' and send_status='sent' and reply_at is null)
 or (state_filter='pending' and send_status in ('pending','queued','sending','paused')) or (state_filter='attention' and needs_attention)
 or (state_filter='errors' and send_status in ('failed','uncertain','cancelled','blocked','suppressed','bounced','goal_met'))))
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(p) from(select * from filtered order by email,contact_id limit 50 offset greatest(0,page_number)*50) p),'[]'))
$function$
;
CREATE OR REPLACE FUNCTION public.campaign_leads_page(template uuid, account uuid, search_text text DEFAULT ''::text, page_number integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.email_templates;result jsonb;
begin
 if not brand_b2.can_sender(account) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
 select * into t from public.email_templates where id=template and archived_at is null;
 if t.id is null then raise exception 'Template changed; reload';end if;
 with candidates as(select * from public.first_contact_candidates(t.subject,t.body,account)),
 reasons as(select reason,count(*) total from candidates group by reason)
 select jsonb_build_object('eligible',(select count(*) from candidates where reason='eligible'),
 'excluded',(select count(*) from candidates where reason<>'eligible'),
 'reasons',coalesce((select jsonb_object_agg(reason,total) from reasons),'{}'),
 'total',(select count(*) from candidates where (company||' '||name||' '||email) ilike '%'||search_text||'%'),
 'rows',coalesce((select jsonb_agg(p) from(select * from candidates where (company||' '||name||' '||email) ilike '%'||search_text||'%' order by email,contact_id limit 50 offset greatest(0,page_number)*50) p),'[]')) into result;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.campaign_delivery_stats(campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.campaigns;result jsonb;
begin
 select * into c from brand_b2.visible_campaigns() where id=campaign_id;
 if public.current_app_role() is null or c.id is null or not (public.current_app_role() in ('superadmin','seller_admin') or c.seller_id=auth.uid()) then raise exception 'Campaign access required';end if;
 select jsonb_build_object('sent',count(*) filter(where o.status='sent'),'pending',count(*) filter(where o.status in ('queued','sending','paused')),'failed',count(*) filter(where o.status='failed'),'uncertain',count(*) filter(where o.status='uncertain'),
 'replied',(select count(*) from public.campaign_enrollments e where e.campaign_id=c.id and e.status='replied' and public.can_case(e.opportunity_id)),
 'suppressed',(select count(*) from public.campaign_enrollments e where e.campaign_id=c.id and e.status='suppressed' and public.can_case(e.opportunity_id)),
 'bounced',(select count(*) from public.campaign_enrollments e where e.campaign_id=c.id and e.status='bounced' and public.can_case(e.opportunity_id))) into result
 from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id where e.campaign_id=c.id and public.can_case(e.opportunity_id);
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.campaign_sending_budgets()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(public.account_delivery_usage(a.id)),'[]') from public.mail_accounts a where public.current_app_role() in ('superadmin','seller_admin') and brand_b2.can_sender(a.id)
$function$
;
CREATE OR REPLACE FUNCTION public.campaign_audience(campaign_id uuid)
 RETURNS TABLE(contact_id uuid, opportunity_id uuid, name text, email text, company text, amount text, industry text, phone text, reason text, missing_fields text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.campaigns;
begin
 select * into c from brand_b2.visible_campaigns() where id=campaign_id;
 if not coalesce(c.first_contact,false) then return query select * from public.campaign_audience_v42(campaign_id);return;end if;
 return query select a.contact_id,a.opportunity_id,a.name,a.email,a.company,a.amount,a.industry,a.phone,
 case when a.contact_id=any(c.excluded_contact_ids) then 'excluded' else a.reason end,a.missing_fields
 from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) a where a.contact_id=any(c.selected_contact_ids);
end $function$
;
CREATE OR REPLACE FUNCTION public.campaign_contact_facts(campaign uuid)
 RETURNS TABLE(contact_id uuid, opportunity_id uuid, company text, name text, email text, send_status text, sent_at timestamp with time zone, reply_at timestamp with time zone, last_interaction timestamp with time zone, needs_attention boolean, conversation_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.campaigns;
begin
 select * into c from brand_b2.visible_campaigns() where id=campaign;
 if public.current_app_role() is null or c.id is null or not(public.current_app_role() in ('superadmin','seller_admin') or (public.current_app_role()='seller' and c.seller_id=auth.uid())) then raise exception 'Campaign access required';end if;
 return query
 with recipients as (
  select e.contact_id,e.opportunity_id,e.id,e.status from public.campaign_enrollments e where e.campaign_id=c.id
  union all
  select l.contact_id,l.opportunity_id,null::uuid,'selected'::text from public.leads l where c.first_contact and l.contact_id=any(c.selected_contact_ids)
  and not exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id and e.contact_id=l.contact_id)
 ), replies as materialized(select rp.contact_id,max(rp.sent_at) at from public.campaign_reply_rows(c.id) rp group by rp.contact_id)
 select ct.id,r.opportunity_id,coalesce(op.company,l.company,''),ct.name,ct.email,
 case when b.status='sent' and b.gmail_message_id is not null and b.sent_at is not null then 'sent'
 when b.status='sent' then 'uncertain'
 when b.status is not null then b.status
 when ct.id=any(c.excluded_contact_ids) or exists(select 1 from public.suppressions s where s.email=ct.email) or ct.verification<>'valid' then 'blocked'
 when c.first_contact and (op.id is null or op.stage not in ('new','contacting') or op.application_complete or op.handed_off_at is not null or op.archived_at is not null) then 'blocked'
 when r.status in ('suppressed','bounced','goal_met') then r.status else 'pending' end,
 case when b.status='sent' and b.gmail_message_id is not null then b.sent_at end,reply.at,
 greatest(b.sent_at,reply.at,co.updated_at),coalesce(reply.at is not null and co.needs_attention
  and reply.at >= coalesce((select max(latest.sent_at) from public.messages latest where latest.conversation_id=co.id
   and public.mail_human_reply(latest.direction,latest.nature,latest.sender) and lower(btrim(latest.sender))=lower(btrim(b.to_email)) and latest.reply_intent is distinct from 'ignored'),reply.at)
  and reply.at >= coalesce((select max(latest.sent_at) from public.messages latest where latest.conversation_id=co.id and latest.direction='outbound' and latest.status='sent'),reply.at),false),co.id
 from recipients r join public.contacts ct on ct.id=r.contact_id
 left join public.opportunities op on op.id=r.opportunity_id left join public.leads l on l.contact_id=ct.id
 left join lateral(select x.* from public.outbox x where x.enrollment_id=r.id and not x.campaign_test
  and (x.request_key='campaign:'||r.id::text||':0' or x.message_id_header='<'||r.id::text||'.0@crm.curated.local>') order by x.created_at,x.id limit 1) b on true
 left join public.conversations co on co.id=b.conversation_id and co.account_id=c.account_id and public.can_area(co.opportunity_id,co.area)
 left join replies reply on reply.contact_id=ct.id
 where (r.opportunity_id is not null and public.can_area(r.opportunity_id,'seller'))
 or (r.opportunity_id is null and l.id is not null and public.can_lead(l.id));
end $function$
;
CREATE OR REPLACE FUNCTION public.campaign_reply_rows(campaign uuid)
 RETURNS TABLE(contact_id uuid, message_id uuid, sent_at timestamp with time zone, email text, opportunity_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.campaigns;
begin
 select * into c from brand_b2.visible_campaigns() where id=campaign;
 if public.current_app_role() is null or c.id is null or not(public.current_app_role() in ('superadmin','seller_admin') or (public.current_app_role()='seller' and c.seller_id=auth.uid())) then raise exception 'Campaign access required';end if;
 return query select distinct e.contact_id,m.id,m.sent_at,b.to_email,e.opportunity_id
 from public.campaign_enrollments e join lateral(
  select x.* from public.outbox x where x.enrollment_id=e.id and not x.campaign_test
   and (x.request_key='campaign:'||e.id::text||':0' or x.message_id_header='<'||e.id::text||'.0@crm.curated.local>') order by x.created_at,x.id limit 1
 ) b on true
 join public.conversations co on co.id=b.conversation_id and co.account_id=c.account_id
 join public.messages m on m.conversation_id=co.id
 where e.campaign_id=c.id and public.can_area(e.opportunity_id,'seller') and public.can_area(co.opportunity_id,co.area)
 and b.status='sent' and b.gmail_message_id is not null and b.sent_at is not null
 and m.status='received' and public.mail_human_reply(m.direction,m.nature,m.sender)
 and lower(btrim(m.sender))=lower(btrim(b.to_email)) and m.sent_at>=b.sent_at and m.reply_intent is distinct from 'ignored'
 and (regexp_split_to_array(btrim(coalesce(m.references_header,'')),E'\\s+') @> array[b.message_id_header]
  or (coalesce(btrim(m.references_header),'')='' and coalesce(co.gmail_delivery_thread_id,co.gmail_thread_id)=b.gmail_thread_id
   and not exists(select 1 from public.outbox other join public.campaign_enrollments oe on oe.id=other.enrollment_id
    where other.account_id=b.account_id and other.gmail_thread_id=b.gmail_thread_id and oe.campaign_id<>c.id and other.status='sent' and not other.campaign_test)));
end $function$
;
CREATE OR REPLACE FUNCTION public.campaign_contact_summary(campaign uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('enrolled',count(*),'sent',count(*) filter(where send_status='sent'),
 'replied',count(*) filter(where send_status='sent' and reply_at is not null),'unanswered',count(*) filter(where send_status='sent' and reply_at is null),
 'pending',count(*) filter(where send_status in ('pending','queued','sending','paused')),'attention',count(*) filter(where needs_attention),
 'failed',count(*) filter(where send_status='failed'),'uncertain',count(*) filter(where send_status='uncertain'),
 'cancelled',count(*) filter(where send_status='cancelled'),'blocked',count(*) filter(where send_status in ('blocked','suppressed','bounced','goal_met')))
 from public.campaign_contact_facts(campaign)
$function$
;

create policy brand_account_read on public.mail_accounts as restrictive for select to authenticated using(brand_b2.can_sender(id));

-- Budget metadata follows the same sender/brand scope, including direct RPC access.
alter function public.account_delivery_usage(uuid) rename to account_delivery_usage_before_brand_b2;
create function public.account_delivery_usage(account uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if current_setting('role',true) not in ('service_role','none') and not brand_b2.can_sender(account) then raise exception 'BRAND_DELIVERY_FORBIDDEN';end if;
 return public.account_delivery_usage_before_brand_b2(account);
end$$;
revoke all on function public.account_delivery_usage_before_brand_b2(uuid) from public,anon,authenticated,service_role;
revoke all on function public.account_delivery_usage(uuid),public.queue_campaign_test(uuid,uuid,text,text,text,uuid) from public,anon;
grant execute on function public.account_delivery_usage(uuid) to authenticated,service_role;
grant execute on function public.queue_campaign_test(uuid,uuid,text,text,text,uuid) to authenticated;
revoke all on all functions in schema brand_b2 from public,anon,authenticated,service_role;
revoke all on function public.crm_command_before_brand_b2(text,jsonb,uuid),public.queue_campaign_test_before_brand_b2(uuid,uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.crm_command(text,jsonb,uuid),public.brand_prepare_context(uuid,jsonb,text,uuid),public.brand_sender_capabilities(),public.brand_queue_mail(text,jsonb,jsonb),public.queue_brand_campaign_test(uuid,uuid,text,text,text,uuid,jsonb) from public,anon,service_role;
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated,service_role;
grant execute on function public.brand_prepare_context(uuid,jsonb,text,uuid),public.brand_sender_capabilities(),public.brand_queue_mail(text,jsonb,jsonb),public.queue_brand_campaign_test(uuid,uuid,text,text,text,uuid,jsonb) to authenticated;
revoke all on function public.brand_campaign_ready(uuid),public.brand_signature_allowed(uuid,uuid),public.queue_brand_notification(uuid,uuid,text),public.admit_brand_dispatch(uuid,uuid),public.brand_dispatch_uncertain(uuid,uuid) from public,anon,authenticated;
grant execute on function public.brand_campaign_ready(uuid),public.brand_signature_allowed(uuid,uuid),public.queue_brand_notification(uuid,uuid,text),public.admit_brand_dispatch(uuid,uuid),public.brand_dispatch_uncertain(uuid,uuid) to service_role;
revoke all on function public.claim_outbox(),public.claim_notification_outbox(),public.recheck_outbox_delivery(uuid),public.mark_sent(uuid,text,text),public.defer_gmail_send(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.claim_outbox(),public.claim_notification_outbox(),public.recheck_outbox_delivery(uuid),public.mark_sent(uuid,text,text),public.defer_gmail_send(uuid,integer,text) to service_role;
-- Historical public aliases must not provide a route around the new boundary.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'claim_outbox\_%' escape '\' or p.proname like 'claim_notification_outbox\_%' escape '\' or p.proname like 'recheck_outbox_delivery\_%' escape '\' or p.proname like 'mark_sent\_%' escape '\' or p.proname like 'defer_gmail_send\_%' escape '\') loop
  execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
 end loop;
end$$;
grant execute on function brand_b2.can_sender(uuid),brand_b2.can_campaign(uuid) to authenticated,service_role;
commit;
