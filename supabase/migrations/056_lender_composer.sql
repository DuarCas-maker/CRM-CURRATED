begin;
create schema lender_composer_private;
revoke all on schema lender_composer_private from public,anon,authenticated;
create table lender_composer_private.previous_functions(signature text primary key,definition text not null);
revoke all on lender_composer_private.previous_functions from public,anon,authenticated;

create table public.lender_email_templates (
 id uuid primary key,
 name text not null check(length(btrim(name)) between 1 and 200),
 subject text not null check(length(btrim(subject)) between 1 and 200 and subject !~ '[\r\n]'),
 body text not null check(length(btrim(body)) between 1 and 10000),
 body_format text not null default 'plain' check(body_format in ('plain','markdown')),
 version integer not null default 1 check(version>0),
 archived_at timestamptz,
 updated_by uuid not null references public.profiles,
 updated_at timestamptz not null default now()
);
create table public.lender_email_template_versions (
 template_id uuid not null references public.lender_email_templates,
 version integer not null check(version>0),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 created_at timestamptz not null default now(),
 primary key(template_id,version)
);
alter table public.lender_email_templates enable row level security;
alter table public.lender_email_template_versions enable row level security;
grant select on public.lender_email_templates,public.lender_email_template_versions to authenticated;
grant all on public.lender_email_templates,public.lender_email_template_versions to service_role;
create policy lender_templates_read on public.lender_email_templates for select to authenticated using((select public.current_app_role()) is not null);
create policy lender_template_versions_read on public.lender_email_template_versions for select to authenticated using((select public.current_app_role()) is not null);

create function public.save_lender_email_template(p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target public.lender_email_templates; receipt public.command_receipts; result jsonb;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'Administrator required';end if;
 if request_key is null or p->>'id' is null or p->>'expected_version' is null or octet_length(p::text)>60000 then raise exception 'Invalid template';end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in ('id','expected_version','name','subject','body','body_format','archived')) then raise exception 'Subject and body only';end if;
 if length(btrim(p->>'name')) not between 1 and 200 or length(btrim(p->>'subject')) not between 1 and 200 or p->>'subject' ~ '[\r\n]' or length(btrim(p->>'body')) not between 1 and 10000 or p->>'body_format' not in ('plain','markdown') or p->>'archived' not in ('true','false') then raise exception 'Invalid template';end if;
 if p->>'name' is null or p->>'subject' is null or p->>'body' is null or p->>'body_format' is null or p->>'archived' is null then raise exception 'Template fields required';end if;
 if exists(select 1 from regexp_matches((p->>'subject')||(p->>'body'),'\{\{\s*([^{}]+?)\s*\}\}','g') vars where btrim(vars[1]) not in ('name','company','amount','industry','phone','email','product','lender_name')) then raise exception 'Unknown merge field';end if;
 if regexp_replace((p->>'subject')||(p->>'body'),'\{\{\s*([^{}]+?)\s*\}\}','','g') ~ '\{\{|\}\}' then raise exception 'Invalid variable delimiter';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,56));
 select * into receipt from public.command_receipts r where r.user_id=actor and r.request_key=save_lender_email_template.request_key;
 if receipt.user_id is not null then
  if receipt.kind<>'lender_template' or receipt.fingerprint<>md5(p::text) then raise exception 'Request key reused with different input';end if;
  return receipt.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p->>'id',56));
 select * into target from public.lender_email_templates where id=(p->>'id')::uuid for update;
 if target.id is null then
  if (p->>'expected_version')::int<>0 or (p->>'archived')::boolean then raise exception 'Template changed; reload';end if;
  insert into public.lender_email_templates(id,name,subject,body,body_format,updated_by)
  values((p->>'id')::uuid,btrim(p->>'name'),btrim(p->>'subject'),btrim(p->>'body'),p->>'body_format',actor) returning * into target;
 else
  if target.archived_at is not null or target.version<>(p->>'expected_version')::int then raise exception 'Template changed; reload';end if;
  update public.lender_email_templates set name=btrim(p->>'name'),subject=btrim(p->>'subject'),body=btrim(p->>'body'),body_format=p->>'body_format',version=version+1,updated_by=actor,updated_at=clock_timestamp(),archived_at=case when (p->>'archived')::boolean then clock_timestamp() else null end where id=target.id returning * into target;
 end if;
 result:=to_jsonb(target);
 insert into public.lender_email_template_versions(template_id,version,snapshot) values(target.id,target.version,result);
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request_key,'lender_template',result,md5(p::text));
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(actor,'lender_email_template',target.id,'saved',jsonb_build_object('version',target.version,'archived',target.archived_at is not null));
 return result;
end $$;
revoke all on function public.save_lender_email_template(jsonb,uuid) from public,anon;
grant execute on function public.save_lender_email_template(jsonb,uuid) to authenticated;

-- Keep the 100 KB bound and owner RLS; only the count of lenders changes.
alter table public.mail_recipient_selections drop constraint mail_recipient_selections_targets_check;
alter table public.mail_recipient_selections add constraint mail_recipient_selections_targets_check check(jsonb_typeof(targets)='array' and jsonb_array_length(targets)>=1 and octet_length(targets::text)<=100000);

-- Preserve the installed 049/055 source, actor, brand and packet guards.
-- Refuse unknown definitions rather than silently replacing another front's work.
do $patch$
declare definition text; original text; signature text;
begin
 signature:='public.queue_mail_lenders(jsonb)';
 select pg_get_functiondef(signature::regprocedure) into original;
 if position('jsonb_array_length(input->''targets'') not between 1 and 20' in original)=0
 or position('target->>''email'',input->>''subject_text'',input->>''body_text'',' in original)=0
 or position('result:=result||jsonb_build_array' in original)=0 then raise exception 'Unexpected queue_mail_lenders definition; review migration 056';end if;
 insert into lender_composer_private.previous_functions values(signature,original);
 definition:=replace(original,'jsonb_array_length(input->''targets'') not between 1 and 20','jsonb_array_length(input->''targets'')<1 or octet_length(input::text)>4000000');
 definition:=replace(definition,'target->>''email'',input->>''subject_text'',input->>''body_text'',','target->>''email'',coalesce(target->>''subject_text'',input->>''subject_text''),coalesce(target->>''body_text'',input->>''body_text''),');
 definition:=replace(definition,'result:=result||jsonb_build_array',
 $code$if target->>'body_html' is not null then
   if length(target->>'body_html')>100000 then raise exception 'Message HTML too large';end if;
   update public.outbox set body_html=target->>'body_html' where id=send_id;
  end if;
  result:=result||jsonb_build_array$code$);
 execute definition;

 signature:='public.queue_lender_emails(uuid,uuid,uuid,jsonb,text,text,uuid[],uuid[],uuid)';
 if to_regprocedure(signature) is not null then
  select pg_get_functiondef(signature::regprocedure) into original;
  if position('jsonb_array_length(targets) not between 1 and 20' in original)=0 then raise exception 'Unexpected queue_lender_emails definition';end if;
  insert into lender_composer_private.previous_functions values(signature,original);
  definition:=replace(original,'jsonb_array_length(targets) not between 1 and 20','jsonb_array_length(targets)<1 or octet_length(targets::text)>100000');
  execute replace(definition,'Select 1 to 20 lenders','Select lenders');
 end if;
end $patch$;
notify pgrst,'reload schema';
commit;
