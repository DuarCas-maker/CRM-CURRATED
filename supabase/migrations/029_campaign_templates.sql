begin;
create table public.campaign_assets(id uuid primary key,created_by uuid not null references public.profiles,request_key uuid not null,name text not null,mime_type text not null,size int not null check(size between 1 and 10485760),storage_path text not null,content_hash text not null,created_at timestamptz not null default now(),unique(created_by,request_key));
create table public.email_templates(id uuid primary key default gen_random_uuid(),name text not null,subject text not null,body text not null,steps jsonb not null default '[]',asset_ids uuid[] not null default '{}',version int not null default 1,created_by uuid not null references public.profiles,updated_by uuid not null references public.profiles,archived_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
alter table public.email_templates enable row level security;alter table public.campaign_assets enable row level security;
create policy templates_read on public.email_templates for select to authenticated using(public.current_app_role() is not null);
create policy campaign_assets_read on public.campaign_assets for select to authenticated using(public.current_app_role() is not null);
grant select on public.email_templates,public.campaign_assets to authenticated;
grant all on public.email_templates,public.campaign_assets to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('campaign-assets','campaign-assets',false,10485760,array['application/pdf','image/png','image/jpeg']);
alter table public.campaigns add column template_id uuid references public.email_templates;
alter table public.campaigns add column template_version int;
alter table public.campaigns add column requires_application boolean not null default true;
alter table public.campaigns add column asset_snapshot jsonb not null default '[]';
alter table public.outbox add column campaign_asset_snapshot jsonb not null default '[]';

create function public.save_campaign_template(p jsonb,request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();target uuid;existing public.email_templates;receipt public.command_receipts;assets uuid[];message jsonb;
begin
 if public.current_app_role() not in ('superadmin','seller_admin') or public.current_app_role() is null then raise exception 'Administrator and MFA required';end if;
 if request_key is null then raise exception 'Idempotency key required';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,0));
 select * into receipt from public.command_receipts r where r.user_id=actor and r.request_key=save_campaign_template.request_key;
 if found then if receipt.kind<>'campaign_template' or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused';end if;return (receipt.result->>'id')::uuid;end if;
 if coalesce(btrim(p->>'name'),'')='' or length(p->>'name')>200 or coalesce(btrim(p->>'subject'),'')='' or length(p->>'subject')>200 or coalesce(btrim(p->>'body'),'')='' or length(p->>'body')>20000 then raise exception 'Complete template required';end if;
 if coalesce(jsonb_typeof(p->'steps'),'')<>'array' or jsonb_array_length(p->'steps')>20 or octet_length(p::text)>90000 then raise exception 'Invalid follow-up steps';end if;
 for message in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_object('body',p->>'body','subject',p->>'subject'))||(p->'steps')) loop
  if coalesce(position('{{unsubscribe_url}}' in message->>'body'),0)=0 or message->>'subject' ~ E'[\r\n]' then raise exception 'Unsubscribe and safe subject required';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p->'steps') s where coalesce(btrim(s->>'subject'),'')='' or length(s->>'subject')>200 or coalesce(btrim(s->>'body'),'')='' or length(s->>'body')>20000 or coalesce((s->>'wait_days')::int,0) not between 1 and 90) then raise exception 'Invalid follow-up content';end if;
 if exists(select 1 from regexp_matches((p->>'subject')||(p->>'body')||(p->'steps')::text,'\{\{\s*(\w+)\s*\}\}','g') vars where vars[1] not in ('name','company','amount','industry','phone','application_url','unsubscribe_url')) then raise exception 'Unknown merge field';end if;
 assets:=array(select value::uuid from jsonb_array_elements_text(p->'asset_ids'));
 if cardinality(assets)>5 or exists(select 1 from unnest(assets) f where not exists(select 1 from public.campaign_assets where id=f))
  or (select coalesce(sum(size),0) from public.campaign_assets where id=any(assets))>15728640 then raise exception 'Up to five generic files and 15 MB total';end if;
 target:=nullif(p->>'id','')::uuid;
 if target is null then
  insert into public.email_templates(name,subject,body,steps,asset_ids,created_by,updated_by) values(p->>'name',p->>'subject',p->>'body',p->'steps',assets,actor,actor) returning id into target;
 else
  select * into existing from public.email_templates where id=target and archived_at is null for update;
  if existing.id is null or existing.version is distinct from (p->>'expected_version')::int then raise exception 'Template changed; reload';end if;
  update public.email_templates set name=p->>'name',subject=p->>'subject',body=p->>'body',steps=p->'steps',asset_ids=assets,version=version+1,updated_by=actor,updated_at=now() where id=target;
 end if;
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request_key,'campaign_template',jsonb_build_object('id',target),md5(p::text));
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(actor,'email_template',target,'saved');
 return target;
end $$;
revoke all on function public.save_campaign_template(jsonb,uuid) from public,anon;
grant execute on function public.save_campaign_template(jsonb,uuid) to authenticated;

alter function public.crm_command(text,jsonb,uuid) rename to crm_command_v28_campaign_templates;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;t public.email_templates;assets jsonb:='[]';requires_app boolean;receipt public.command_receipts;
begin
 if kind='create_campaign' then
  if public.current_app_role() not in ('superadmin','seller_admin') or public.current_app_role() is null then raise exception 'Administrator required';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
  select * into receipt from public.command_receipts r where r.user_id=auth.uid() and r.request_key=crm_command.request_key;
  if found then return public.crm_command_v28_campaign_templates(kind,p,request_key);end if;
  if nullif(p->>'template_id','') is not null then
   select * into t from public.email_templates where id=(p->>'template_id')::uuid and archived_at is null for share;
   if t.id is null or t.version is distinct from (p->>'template_version')::int then raise exception 'Template changed; reload';end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'mime_type',mime_type,'size',size,'storage_path',storage_path,'content_hash',content_hash,'bucket','campaign-assets') order by id),'[]') into assets from public.campaign_assets where id=any(t.asset_ids);
  end if;
  requires_app:=(coalesce(p->>'subject','')||coalesce(p->>'body','')||coalesce(p->'steps','[]')::text) ~ '\{\{\s*application_url\s*\}\}';
  result:=public.crm_command_v28_campaign_templates(kind,p,request_key);
  update public.campaigns set template_id=t.id,template_version=t.version,asset_snapshot=assets,requires_application=requires_app where id=(result->>'id')::uuid;
  return result;
 end if;
 return public.crm_command_v28_campaign_templates(kind,p,request_key);
end $$;
revoke all on function public.crm_command_v28_campaign_templates(text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.crm_command(text,jsonb,uuid) from public,anon;grant execute on function public.crm_command(text,jsonb,uuid) to authenticated;
do $$ declare definition text;begin
 select pg_get_functiondef('public.claim_outbox_v7()'::regprocedure) into definition;
 execute replace(definition,'or o.application_complete then','or (o.application_complete and campaign.requires_application) then');
end $$;

create function public.campaign_delivery_stats(campaign_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.campaigns;result jsonb;
begin
 select * into c from public.campaigns where id=campaign_id;
 if public.current_app_role() is null or c.id is null or not (public.current_app_role() in ('superadmin','seller_admin') or c.seller_id=auth.uid()) then raise exception 'Campaign access required';end if;
 select jsonb_build_object('sent',count(*) filter(where o.status='sent'),'pending',count(*) filter(where o.status in ('queued','sending','paused')),'failed',count(*) filter(where o.status='failed'),'uncertain',count(*) filter(where o.status='uncertain'),
  'replied',(select count(*) from public.campaign_enrollments where campaign_enrollments.campaign_id=c.id and status='replied' and public.can_case(opportunity_id))) into result
  from public.outbox o join public.campaign_enrollments e on e.id=o.enrollment_id where e.campaign_id=c.id and public.can_case(e.opportunity_id);
 return result;
end $$;
revoke all on function public.campaign_delivery_stats(uuid) from public,anon;grant execute on function public.campaign_delivery_stats(uuid) to authenticated;
drop view public.campaign_workspace;
create view public.campaign_workspace with(security_invoker=true) as select c.*,(select count(*)::int from public.campaign_enrollments e where e.campaign_id=c.id) audience_count,public.campaign_delivery_stats(c.id) delivery_stats from public.campaigns c;
grant select on public.campaign_workspace to authenticated,service_role;
notify pgrst,'reload schema';
commit;
