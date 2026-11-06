-- B1 LOCAL CANDIDATE ONLY. No final migration number or remote approval.
begin;
do $$ begin
 if current_setting('pipeline_os.block_b1_local',true) is distinct from 'in_memory_test'
 then raise exception 'B1 explicit in-memory marker required';end if;
 if to_regclass('public.operating_brands') is null or to_regprocedure('public.mail_access_context(uuid)') is null
 then raise exception 'B1 requires the complete local A candidate';end if;
 if to_regnamespace('brand_b1') is not null then raise exception 'B1 already installed';end if;
end $$;
create schema brand_b1;
revoke all on schema brand_b1 from public,anon,authenticated,service_role;

alter table public.mail_account_brand_reviews
 add column proposed_brand_revision bigint check(proposed_brand_revision between 1 and 9007199254740991),
 add column impact_fingerprint text check(impact_fingerprint is null or impact_fingerprint ~ '^[a-f0-9]{64}$');
alter table public.oauth_states
 add column connection_intent text check(connection_intent in ('new','reconnect')),
 add column selected_brand_id uuid references public.operating_brands on delete restrict,
 add column expected_brand_revision bigint check(expected_brand_revision between 1 and 9007199254740991),
 add column expected_account_id uuid references public.mail_accounts on delete restrict,
 add column expected_account_revision bigint check(expected_account_revision between 1 and 9007199254740991),
 add column expected_mailbox_email text,
 add column completed_at timestamptz;

create function brand_b1.admin_actor() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if public.current_app_role() is distinct from 'superadmin' then raise exception 'BRAND_FORBIDDEN';end if;
 perform 1 from public.profiles where id=actor and active and role='superadmin' for share;
 if not found then raise exception 'BRAND_FORBIDDEN';end if;
 return actor;
end $$;
create function brand_b1.rev(p jsonb,k text,allow_zero boolean default false) returns bigint
language plpgsql set search_path='' as $$
declare v numeric;
begin
 if jsonb_typeof(p->k) is distinct from 'number' then raise exception 'BRAND_INVALID_INPUT';end if;
 v:=(p->>k)::numeric;
 if v<>trunc(v) or v<(case when allow_zero then 0 else 1 end) or v>9007199254740991
 then raise exception 'BRAND_INVALID_INPUT';end if;
 return v::bigint;
end $$;
create function brand_b1.ref(value text) returns text language plpgsql set search_path='' as $$
begin
 if value is null then return null;end if;
 value:=btrim(value);
 if char_length(value) not between 1 and 120 or value ~ '[[:cntrl:]]' then raise exception 'BRAND_INVALID_INPUT';end if;
 return value;
end $$;
create function brand_b1.normalize(kind text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare keys text[];q jsonb;code text;label text;from_at timestamptz;to_at timestamptz;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>8192 then raise exception 'BRAND_INVALID_INPUT';end if;
 keys:=case kind
 when 'brand_create' then array['code','name','active']
 when 'brand_update' then array['brand_id','name','expected_revision']
 when 'brand_set_status' then array['brand_id','active','expected_revision']
 when 'brand_membership_set' then array['brand_id','user_id','active','expected_revision']
 when 'brand_mapping_propose' then array['account_id','proposed_brand_id','evidence_reference','expected_account_revision','review_id','expected_review_revision','history_approved','history_from','history_to']
 when 'brand_mapping_confirm' then array['review_id','expected_review_revision','expected_account_revision','acknowledge_conflict']
 when 'brand_mapping_discard' then array['review_id','expected_review_revision','reason']
 else null end;
 if keys is null or exists(select 1 from jsonb_object_keys(p) k where not k=any(keys)) then raise exception 'BRAND_INVALID_INPUT';end if;
 if kind='brand_create' then
  if jsonb_typeof(p->'code') is distinct from 'string' or jsonb_typeof(p->'name') is distinct from 'string' then raise exception 'BRAND_INVALID_INPUT';end if;
  code:=upper(btrim(p->>'code'));label:=brand_b1.ref(p->>'name');
  if code !~ '^[A-Z0-9][A-Z0-9_-]{0,31}$' then raise exception 'BRAND_INVALID_INPUT';end if;
  if p?'active' and jsonb_typeof(p->'active') is distinct from 'boolean' then raise exception 'BRAND_INVALID_INPUT';end if;
  return jsonb_build_object('code',code,'name',label,'active',coalesce((p->>'active')::boolean,false));
 end if;
 if kind in ('brand_update','brand_set_status','brand_membership_set') then
  if jsonb_typeof(p->'brand_id') is distinct from 'string' or nullif(p->>'brand_id','')::uuid is null then raise exception 'BRAND_INVALID_INPUT';end if;
  q:=jsonb_build_object('brand_id',(p->>'brand_id')::uuid,'expected_revision',brand_b1.rev(p,'expected_revision',kind='brand_membership_set'));
  if kind='brand_update' then
   if jsonb_typeof(p->'name') is distinct from 'string' then raise exception 'BRAND_INVALID_INPUT';end if;
   return q||jsonb_build_object('name',brand_b1.ref(p->>'name'));
  end if;
  if jsonb_typeof(p->'active') is distinct from 'boolean' then raise exception 'BRAND_INVALID_INPUT';end if;
  q:=q||jsonb_build_object('active',(p->>'active')::boolean);
  if kind='brand_membership_set' then
   if jsonb_typeof(p->'user_id') is distinct from 'string' or nullif(p->>'user_id','')::uuid is null then raise exception 'BRAND_INVALID_INPUT';end if;
   q:=q||jsonb_build_object('user_id',(p->>'user_id')::uuid);
  end if;
  return q;
 end if;
 if kind='brand_mapping_propose' then
  if jsonb_typeof(p->'account_id') is distinct from 'string' or nullif(p->>'account_id','')::uuid is null then raise exception 'BRAND_INVALID_INPUT';end if;
  if p->>'proposed_brand_id' is not null and (jsonb_typeof(p->'proposed_brand_id')<>'string' or nullif(p->>'proposed_brand_id','')::uuid is null) then raise exception 'BRAND_INVALID_INPUT';end if;
  if not p?'proposed_brand_id' then raise exception 'BRAND_INVALID_INPUT';end if;
  if p->>'evidence_reference' is not null and jsonb_typeof(p->'evidence_reference')<>'string' then raise exception 'BRAND_INVALID_INPUT';end if;
  if p?'history_approved' and jsonb_typeof(p->'history_approved') is distinct from 'boolean' then raise exception 'BRAND_INVALID_INPUT';end if;
  if p->>'history_from' is not null then
   if jsonb_typeof(p->'history_from')<>'string' or p->>'history_from' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then raise exception 'BRAND_INVALID_INPUT';end if;
   from_at:=(p->>'history_from')::timestamptz;
  end if;
  if p->>'history_to' is not null then
   if jsonb_typeof(p->'history_to')<>'string' or p->>'history_to' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then raise exception 'BRAND_INVALID_INPUT';end if;
   to_at:=(p->>'history_to')::timestamptz;
  end if;
  if (from_at is null)<>(to_at is null) or (from_at is not null and (not isfinite(from_at) or not isfinite(to_at) or from_at>=to_at)) then raise exception 'BRAND_INVALID_INPUT';end if;
  q:=jsonb_build_object('account_id',(p->>'account_id')::uuid,'proposed_brand_id',(p->>'proposed_brand_id')::uuid,
   'expected_account_revision',brand_b1.rev(p,'expected_account_revision',true),'evidence_reference',brand_b1.ref(p->>'evidence_reference'),
   'history_approved',coalesce((p->>'history_approved')::boolean,false),
   'history_from',to_char(from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'history_to',to_char(to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'review_id',(p->>'review_id')::uuid,'expected_review_revision',case when p->>'review_id' is not null then brand_b1.rev(p,'expected_review_revision') end);
  if (p->>'review_id' is null)<>(p->>'expected_review_revision' is null) then raise exception 'BRAND_INVALID_INPUT';end if;
  if (q->>'history_approved')::boolean and (from_at is null or q->>'evidence_reference' is null) then raise exception 'BRAND_INVALID_INPUT';end if;
  return q;
 end if;
 if jsonb_typeof(p->'review_id') is distinct from 'string' or nullif(p->>'review_id','')::uuid is null then raise exception 'BRAND_INVALID_INPUT';end if;
 q:=jsonb_build_object('review_id',(p->>'review_id')::uuid,'expected_review_revision',brand_b1.rev(p,'expected_review_revision'));
 if kind='brand_mapping_confirm' then
  if p?'acknowledge_conflict' and jsonb_typeof(p->'acknowledge_conflict') is distinct from 'boolean' then raise exception 'BRAND_INVALID_INPUT';end if;
  return q||jsonb_build_object('expected_account_revision',brand_b1.rev(p,'expected_account_revision',true),'acknowledge_conflict',coalesce((p->>'acknowledge_conflict')::boolean,false));
 end if;
 if p->>'reason' is distinct from 'admin_discarded' then raise exception 'BRAND_INVALID_INPUT';end if;
 return q||jsonb_build_object('reason','admin_discarded');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'BRAND_INVALID_INPUT';
end $$;

create function brand_b1.impact(account uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with rows as (
 select 'outbox' kind,id,status from public.outbox where account_id=account and status in ('queued','sending','uncertain')
 union all select 'campaign',id,status from public.campaigns where account_id=account and status='active')
 select jsonb_build_object('queued',count(*) filter(where kind='outbox' and status='queued'),
 'sending',count(*) filter(where kind='outbox' and status='sending'),'uncertain',count(*) filter(where kind='outbox' and status='uncertain'),
 'active_campaigns',count(*) filter(where kind='campaign'),
 'fingerprint',encode(sha256(convert_to(coalesce(string_agg(kind||':'||id::text||':'||status,',' order by kind,id),''),'UTF8')),'hex')) from rows
$$;

create function brand_b1.command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=brand_b1.admin_actor();q jsonb:=brand_b1.normalize(kind,p);fingerprint text;
 receipt public.command_receipts;b public.operating_brands;m public.operating_brand_memberships;
 a public.mail_accounts;r public.mail_account_brand_reviews;observed public.mail_account_brand_reviews;
 effect jsonb;target uuid;result jsonb;next_status text;profile_active boolean;
begin
 if request_key is null then raise exception 'BRAND_INVALID_INPUT';end if;
 fingerprint:=encode(sha256(convert_to(kind||':'||q::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||request_key::text,0));
 select * into receipt from public.command_receipts x where x.user_id=actor and x.request_key=command.request_key;
 if found then
  if receipt.kind<>kind or receipt.fingerprint<>fingerprint then raise exception 'BRAND_KEY_REUSED';end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 if kind='brand_create' then
  insert into public.operating_brands(code,name,active,created_by,updated_by)
  values(q->>'code',q->>'name',(q->>'active')::boolean,actor,actor) returning * into b;
  target:=b.id;result:=jsonb_build_object('id',b.id,'revision',b.revision);
 elsif kind in ('brand_update','brand_set_status','brand_membership_set') then
  select * into b from public.operating_brands where id=(q->>'brand_id')::uuid for update;
  if b.id is null then raise exception 'BRAND_NOT_FOUND';end if;
  if kind='brand_membership_set' then
   select active into profile_active from public.profiles where id=(q->>'user_id')::uuid;
   if not found then raise exception 'BRAND_NOT_FOUND';end if;
   if (q->>'active')::boolean and not profile_active then raise exception 'BRAND_USER_INACTIVE';end if;
   select * into m from public.operating_brand_memberships where brand_id=b.id and user_id=(q->>'user_id')::uuid for update;
   if coalesce(m.revision,0)<>(q->>'expected_revision')::bigint then raise exception 'BRAND_STALE_REVISION';end if;
   insert into public.operating_brand_memberships(brand_id,user_id,active,assigned_by,revoked_by,revoked_at)
   values(b.id,(q->>'user_id')::uuid,(q->>'active')::boolean,actor,
    case when not (q->>'active')::boolean then actor end,case when not (q->>'active')::boolean then now() end)
   on conflict(brand_id,user_id) do update set active=excluded.active,revision=operating_brand_memberships.revision+1,
    assigned_by=case when excluded.active then actor else operating_brand_memberships.assigned_by end,
    assigned_at=case when excluded.active then now() else operating_brand_memberships.assigned_at end,
    revoked_by=excluded.revoked_by,revoked_at=excluded.revoked_at returning * into m;
   target:=b.id;result:=jsonb_build_object('id',b.id,'user_id',m.user_id,'revision',m.revision);
  else
   if b.revision<>(q->>'expected_revision')::bigint then raise exception 'BRAND_STALE_REVISION';end if;
   update public.operating_brands set name=case when kind='brand_update' then q->>'name' else name end,
    active=case when kind='brand_set_status' then (q->>'active')::boolean else active end,
    revision=revision+1,updated_by=actor,updated_at=now() where id=b.id returning * into b;
   target:=b.id;result:=jsonb_build_object('id',b.id,'revision',b.revision);
  end if;
 else
  if kind='brand_mapping_propose' then
   if q->>'proposed_brand_id' is not null then
    select * into b from public.operating_brands where id=(q->>'proposed_brand_id')::uuid for update;
    if b.id is null then raise exception 'BRAND_NOT_FOUND';end if;
   end if;
   select * into a from public.mail_accounts where id=(q->>'account_id')::uuid for update;
  else
   select * into observed from public.mail_account_brand_reviews where id=(q->>'review_id')::uuid;
   if observed.id is null then raise exception 'BRAND_NOT_FOUND';end if;
   if observed.proposed_brand_id is not null then
    select * into b from public.operating_brands where id=observed.proposed_brand_id for update;
   end if;
   select * into a from public.mail_accounts where id=observed.account_id for update;
  end if;
  if a.id is null then raise exception 'BRAND_NOT_FOUND';end if;
  if kind='brand_mapping_propose' then
   if a.brand_revision<>(q->>'expected_account_revision')::bigint then raise exception 'BRAND_STALE_REVISION';end if;
   select * into r from public.mail_account_brand_reviews where account_id=a.id and status in ('pending','conflict') for update;
   if (r.id is null)<>(q->>'review_id' is null) or (r.id is not null and (r.id is distinct from (q->>'review_id')::uuid or r.revision<>(q->>'expected_review_revision')::bigint)) then raise exception 'BRAND_REVIEW_STALE';end if;
   effect:=brand_b1.impact(a.id);
   next_status:=case when (a.operating_brand_id is not null and a.operating_brand_id is distinct from b.id)
    or (effect->>'queued')::bigint+(effect->>'sending')::bigint+(effect->>'uncertain')::bigint+(effect->>'active_campaigns')::bigint>0 then 'conflict' else 'pending' end;
   if r.id is null then
    insert into public.mail_account_brand_reviews(account_id,proposed_brand_id,status,expected_account_revision,evidence_reference,request_key,created_by,
     history_approved,history_from,history_to,proposed_brand_revision,impact_fingerprint)
    values(a.id,b.id,next_status,a.brand_revision,q->>'evidence_reference',request_key,actor,
     (q->>'history_approved')::boolean,(q->>'history_from')::timestamptz,(q->>'history_to')::timestamptz,b.revision,effect->>'fingerprint') returning * into r;
   else
    update public.mail_account_brand_reviews set proposed_brand_id=b.id,proposed_brand_revision=b.revision,status=next_status,
     expected_account_revision=a.brand_revision,evidence_reference=q->>'evidence_reference',revision=revision+1,
     history_approved=(q->>'history_approved')::boolean,history_from=(q->>'history_from')::timestamptz,history_to=(q->>'history_to')::timestamptz,
     impact_fingerprint=effect->>'fingerprint' where id=r.id returning * into r;
   end if;
  else
   select * into r from public.mail_account_brand_reviews where id=observed.id for update;
   if r.account_id is distinct from observed.account_id or r.proposed_brand_id is distinct from observed.proposed_brand_id
    or r.status not in ('pending','conflict') or r.revision<>(q->>'expected_review_revision')::bigint then raise exception 'BRAND_REVIEW_STALE';end if;
   if kind='brand_mapping_confirm' then
    if r.proposed_brand_id is null or r.evidence_reference is null then raise exception 'BRAND_REVIEW_REQUIRED';end if;
    if a.brand_revision<>r.expected_account_revision or a.brand_revision<>(q->>'expected_account_revision')::bigint
     or b.revision is distinct from r.proposed_brand_revision or r.impact_fingerprint is distinct from brand_b1.impact(a.id)->>'fingerprint'
     then raise exception 'BRAND_REVIEW_STALE';end if;
    if r.status='conflict' and not (q->>'acknowledge_conflict')::boolean then raise exception 'BRAND_CONFLICT_ACK_REQUIRED';end if;
    update public.mail_accounts set operating_brand_id=b.id,brand_revision=brand_revision+1 where id=a.id returning * into a;
   end if;
   update public.mail_account_brand_reviews set status=case when kind='brand_mapping_confirm' then 'confirmed' else 'discarded' end,
    revision=revision+1,reviewed_by=actor,reviewed_at=now() where id=r.id returning * into r;
  end if;
  target:=r.id;result:=jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'account_id',a.id,'account_revision',a.brand_revision);
 end if;
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request_key,kind,result,fingerprint);
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata)
 values(actor,'operating_brand',target,kind,jsonb_build_object('request_key',request_key,'revision',result->'revision','account_revision',result->'account_revision'));
 return result;
exception when unique_violation then raise exception 'BRAND_CONFLICT';
 when foreign_key_violation then raise exception 'BRAND_NOT_FOUND';
 when check_violation or not_null_violation then raise exception 'BRAND_INVALID_INPUT';
end $$;

alter function public.crm_command(text,jsonb,uuid) rename to crm_command_before_brand_b1;
revoke all on function public.crm_command_before_brand_b1(text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if kind like 'brand\_%' escape '\' then return brand_b1.command(kind,p,request_key);end if;
 return public.crm_command_before_brand_b1(kind,p,request_key);
end $$;
revoke all on function public.crm_command(text,jsonb,uuid) from public,anon;
-- Preserve the existing service caller contract for legacy command kinds.
-- brand_* still requires an active human superadmin/AAL2 inside admin_actor().
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated,service_role;

create function public.brand_management_page(collection text default 'brands',cursor text default null,page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare role public.app_role:=public.current_app_role();items jsonb;visible jsonb;last_key text;next_key text;
begin
 if role is null then raise exception 'BRAND_FORBIDDEN';end if;
 if collection is null or collection not in ('brands','memberships','reviews','accounts','people') or page_size is null or page_size not between 1 and 100 then raise exception 'BRAND_INVALID_INPUT';end if;
 if collection in ('reviews','accounts','people') and role<>'superadmin' then raise exception 'BRAND_FORBIDDEN';end if;
 if cursor is not null and (char_length(cursor)>73 or
  (collection='memberships' and cursor !~ '^[a-f0-9-]{36}:[a-f0-9-]{36}$') or
  (collection<>'memberships' and cursor !~ '^[a-f0-9-]{36}$')) then raise exception 'BRAND_INVALID_INPUT';end if;
 if collection='brands' then
  select coalesce(jsonb_agg(row order by key),'[]') into items from (
   select b.id::text key,to_jsonb(b)||jsonb_build_object('key',b.id::text) row from public.operating_brands b
   where (cursor is null or b.id::text>cursor) and (role='superadmin' or exists(select 1 from public.operating_brand_memberships m where m.brand_id=b.id and m.user_id=auth.uid() and m.active)) order by b.id limit page_size+1) x;
 elsif collection='memberships' then
  select coalesce(jsonb_agg(row order by key),'[]') into items from (
   select m.brand_id::text||':'||m.user_id::text key,to_jsonb(m)||jsonb_build_object('key',m.brand_id::text||':'||m.user_id::text,
    'brand_name',b.name,'brand_code',b.code) row
   from public.operating_brand_memberships m join public.operating_brands b on b.id=m.brand_id
   where (role='superadmin' or m.user_id=auth.uid()) and (cursor is null or m.brand_id::text||':'||m.user_id::text>cursor)
   order by m.brand_id,m.user_id limit page_size+1) x;
 elsif collection='accounts' then
  select coalesce(jsonb_agg(row order by key),'[]') into items from (
   select a.id::text key,jsonb_build_object('key',a.id,'id',a.id,'email',a.email,'organization',a.organization,'status',a.status,
    'operating_brand_id',a.operating_brand_id,'brand_revision',a.brand_revision,'brand_name',b.name,'brand_code',b.code) row
   from public.mail_accounts a left join public.operating_brands b on b.id=a.operating_brand_id
   where cursor is null or a.id::text>cursor order by a.id limit page_size+1) x;
 elsif collection='reviews' then
  select coalesce(jsonb_agg(row order by key),'[]') into items from (
   select r.id::text key,to_jsonb(r)||jsonb_build_object('key',r.id,'account_email',a.email,'brand_name',b.name,'brand_code',b.code,
    'impact',brand_b1.impact(a.id)-'fingerprint') row
   from public.mail_account_brand_reviews r join public.mail_accounts a on a.id=r.account_id left join public.operating_brands b on b.id=r.proposed_brand_id
   where cursor is null or r.id::text>cursor order by r.id limit page_size+1) x;
 else
  select coalesce(jsonb_agg(row order by key),'[]') into items from (
   select p.id::text key,jsonb_build_object('key',p.id,'id',p.id,'name',p.name,'role',p.role,'active',p.active) row
   from public.profiles p where cursor is null or p.id::text>cursor order by p.id limit page_size+1) x;
 end if;
 select coalesce(jsonb_agg(value order by ordinality),'[]'),max(value->>'key') into visible,last_key
 from jsonb_array_elements(items) with ordinality where ordinality<=page_size;
 next_key:=case when jsonb_array_length(items)>page_size then last_key end;
 return jsonb_build_object('items',visible,'next_cursor',next_key,'is_admin',role='superadmin');
end $$;
revoke all on function public.brand_management_page(text,text,integer) from public,anon,service_role;
grant execute on function public.brand_management_page(text,text,integer) to authenticated;

create function public.brand_oauth_begin(state_hash text,organization_id text,intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=brand_b1.admin_actor();b public.operating_brands;a public.mail_accounts;mode text:=intent->>'mode';
begin
 if state_hash is null or state_hash !~ '^[a-f0-9]{64}$' or organization_id is null or char_length(organization_id) not between 1 and 100
 or jsonb_typeof(intent) is distinct from 'object' or mode is null or mode not in ('new','reconnect')
 or exists(select 1 from jsonb_object_keys(intent) k where k not in ('mode','brand_id','expected_brand_revision','account_id','expected_account_revision'))
 then raise exception 'BRAND_INVALID_INPUT';end if;
 select * into b from public.operating_brands where id=(intent->>'brand_id')::uuid for share;
 if b.id is null or not b.active then raise exception 'BRAND_REVIEW_REQUIRED';end if;
 if b.revision<>brand_b1.rev(intent,'expected_brand_revision') then raise exception 'BRAND_STALE_REVISION';end if;
 if mode='reconnect' then
  select * into a from public.mail_accounts where id=(intent->>'account_id')::uuid for update;
  if a.id is null then raise exception 'BRAND_NOT_FOUND';end if;
  if a.operating_brand_id is null then raise exception 'BRAND_REVIEW_REQUIRED';end if;
  if a.organization<>organization_id or a.operating_brand_id<>b.id or a.brand_revision<>brand_b1.rev(intent,'expected_account_revision') then raise exception 'BRAND_STALE_REVISION';end if;
 elsif intent->>'account_id' is not null or intent->>'expected_account_revision' is not null then raise exception 'BRAND_INVALID_INPUT';end if;
 insert into public.oauth_states(state_hash,user_id,organization,expires_at,connection_intent,selected_brand_id,expected_brand_revision,expected_account_id,expected_account_revision,expected_mailbox_email)
 values(state_hash,actor,organization_id,now()+interval '10 minutes',mode,b.id,b.revision,a.id,a.brand_revision,a.email);
 return jsonb_build_object('organization',organization_id);
exception when invalid_text_representation or unique_violation or not_null_violation or check_violation then raise exception 'BRAND_INVALID_INPUT';
end $$;

create function brand_b1.oauth_context(state_hash text,actor_id uuid,claimed boolean) returns public.oauth_states
language plpgsql security definer set search_path='' as $$
declare s public.oauth_states;b public.operating_brands;a public.mail_accounts;
begin
 if state_hash is null or state_hash !~ '^[a-f0-9]{64}$' then raise exception 'BRAND_OAUTH_INVALID';end if;
 perform 1 from public.profiles where id=actor_id and active and role='superadmin' for share;
 if not found then raise exception 'BRAND_FORBIDDEN';end if;
 select * into s from public.oauth_states x where x.state_hash=oauth_context.state_hash;
 if s.user_id is distinct from actor_id or s.connection_intent is null then raise exception 'BRAND_OAUTH_INVALID';end if;
 select * into b from public.operating_brands where id=s.selected_brand_id for share;
 if b.id is null or not b.active or b.revision is distinct from s.expected_brand_revision then raise exception 'BRAND_STALE_REVISION';end if;
 if s.connection_intent='reconnect' then
  select * into a from public.mail_accounts where id=s.expected_account_id for update;
  if a.id is null or a.email is distinct from s.expected_mailbox_email or a.operating_brand_id is distinct from b.id
   or a.brand_revision is distinct from s.expected_account_revision or a.organization<>s.organization then raise exception 'BRAND_STALE_REVISION';end if;
 end if;
 select * into s from public.oauth_states x where x.state_hash=oauth_context.state_hash for update;
 if s.user_id is distinct from actor_id or s.expires_at<=now() or s.completed_at is not null
 or (claimed and s.used_at is null) or (not claimed and s.used_at is not null) then raise exception 'BRAND_OAUTH_INVALID';end if;
 return s;
end $$;
create function public.brand_oauth_claim(state_hash text,actor_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.oauth_states;
begin
 s:=brand_b1.oauth_context(state_hash,actor_id,false);
 update public.oauth_states x set used_at=now() where x.state_hash=s.state_hash;
 return jsonb_build_object('organization',s.organization);
end $$;
create function public.brand_oauth_finish(state_hash text,actor_id uuid,mailbox_email text,encrypted_token text,watch_enabled boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.oauth_states;a public.mail_accounts;created boolean:=false;effect jsonb;
begin
 s:=brand_b1.oauth_context(state_hash,actor_id,true);
 if mailbox_email is null or mailbox_email<>lower(btrim(mailbox_email)) or mailbox_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or encrypted_token is null or char_length(encrypted_token) not between 1 and 50000 or watch_enabled is null then raise exception 'BRAND_INVALID_INPUT';end if;
 if s.connection_intent='reconnect' then
  if mailbox_email is distinct from s.expected_mailbox_email then raise exception 'BRAND_IDENTITY_MISMATCH';end if;
  select * into a from public.mail_accounts where id=s.expected_account_id;
 else
  if exists(select 1 from public.mail_accounts where email=mailbox_email) then raise exception 'BRAND_RECONNECT_REQUIRED';end if;
  insert into public.mail_accounts(email,organization,status,live_enabled) values(mailbox_email,s.organization,'connected',true) returning * into a;
  created:=true;
 end if;
 update public.mail_accounts set status='connected',live_enabled=true where id=a.id;
 insert into public.mail_credentials(account_id,encrypted_refresh_token) values(a.id,encrypted_token)
 on conflict(account_id) do update set encrypted_refresh_token=excluded.encrypted_refresh_token;
 insert into public.mail_permissions(account_id,user_id,can_send) values(a.id,actor_id,true)
 on conflict(account_id,user_id) do update set can_send=true;
 if created then
  effect:=brand_b1.impact(a.id);
  insert into public.mail_account_brand_reviews(account_id,proposed_brand_id,expected_account_revision,evidence_reference,request_key,created_by,proposed_brand_revision,impact_fingerprint)
  values(a.id,s.selected_brand_id,0,'oauth:'||a.id::text,gen_random_uuid(),actor_id,s.expected_brand_revision,effect->>'fingerprint');
 end if;
 if watch_enabled then
  insert into public.jobs(kind,payload,dedupe_key) values('gmail_watch',jsonb_build_object('account_id',a.id),'watch:brand-oauth:'||s.state_hash);
 end if;
 insert into public.jobs(kind,payload,dedupe_key) values('gmail_sync',jsonb_build_object('account_id',a.id),'sync:brand-oauth:'||s.state_hash);
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata)
 values(actor_id,'mail_account',a.id,'connected',jsonb_build_object('connection_intent',s.connection_intent,'created',created));
 update public.oauth_states x set completed_at=now() where x.state_hash=s.state_hash;
 return jsonb_build_object('id',a.id,'created',created);
exception when unique_violation then raise exception 'BRAND_RECONNECT_REQUIRED';
end $$;

revoke all on all functions in schema brand_b1 from public,anon,authenticated,service_role;
revoke all on function public.brand_oauth_begin(text,text,jsonb) from public,anon,service_role;
grant execute on function public.brand_oauth_begin(text,text,jsonb) to authenticated;
revoke all on function public.brand_oauth_claim(text,uuid),public.brand_oauth_finish(text,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.brand_oauth_claim(text,uuid),public.brand_oauth_finish(text,uuid,text,text,boolean) to service_role;
revoke insert,update,delete,truncate,references,trigger on public.operating_brands,public.operating_brand_memberships,public.mail_account_brand_reviews from service_role;
revoke insert,update,delete on public.oauth_states from service_role;
revoke insert,update on public.mail_accounts from service_role;
do $$ declare columns text;begin
 select string_agg(quote_ident(attname),',' order by attnum) into columns from pg_attribute
 where attrelid='public.mail_accounts'::regclass and attnum>0 and not attisdropped and attname not in ('operating_brand_id','brand_revision');
 execute 'grant update('||columns||') on public.mail_accounts to service_role';
end $$;
commit;
