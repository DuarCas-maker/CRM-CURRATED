begin;

-- Additive package: no replacement of crm_command or delivery functions.
create function public.campaign_import_contact_rows(batch uuid)
returns table(contact_id uuid,verification text,verification_state text,suppressed boolean,can_verify boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'CI_FORBIDDEN' using errcode='42501';end if;
 if not exists(select 1 from public.import_batches b where b.id=batch) then raise exception 'CI_BATCH_NOT_FOUND';end if;
 return query select c.id,c.verification::text,v.state,
  exists(select 1 from public.suppressions s where s.email=c.email),
  exists(select 1 from public.leads l where l.contact_id=c.id and public.can_lead(l.id))
 from (select distinct r.contact_id from public.import_rows r where r.batch_id=batch and r.contact_id is not null) r
 join public.contacts c on c.id=r.contact_id
 left join lateral(select x.state from public.verifications x where x.contact_id=c.id order by x.created_at desc,x.id desc limit 1) v on true;
end $$;
revoke all on function public.campaign_import_contact_rows(uuid) from public,anon,authenticated,service_role;

create function public.campaign_import_status(batch uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.import_batches;r jsonb;
begin
 -- The helper checks the same admin/MFA access as import_batches before reads.
 with contacts as materialized(select * from public.campaign_import_contact_rows(batch))
 select jsonb_build_object(
  'unique_contacts',count(*),'valid',count(*) filter(where verification='valid'),
  'invalid',count(*) filter(where verification='invalid'),'uncertain',count(*) filter(where verification='uncertain'),
  'pending',count(*) filter(where verification='pending' and can_verify and not suppressed and (verification_state is null or verification_state='completed')),
  'running',count(*) filter(where verification_state in ('queued','submitted') and verification<>'valid'),
  'attention',count(*) filter(where verification_state in ('technical_error','uncertain_request','review')),
  'excluded',count(*) filter(where suppressed or not can_verify)
 ) into r from contacts;
 select * into b from public.import_batches where id=batch;
 return jsonb_build_object('batch',jsonb_build_object('id',b.id,'name',b.name,'status',b.status,'total',b.total,'processed',b.processed,'imported',b.imported,'duplicates',b.duplicates,'errors',b.errors),
 'counts',r,'next_verification_count',least((r->>'pending')::int,5000),
 'ready',b.status='completed' and (r->>'pending')::int=0 and (r->>'running')::int=0);
end $$;
revoke all on function public.campaign_import_status(uuid) from public,anon,service_role;
grant execute on function public.campaign_import_status(uuid) to authenticated;

create function public.campaign_import_leads_page(batch uuid,template uuid,account uuid,search_text text default '',page_number int default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.email_templates;result jsonb;
begin
 if page_number<0 or page_number>1000000 or length(coalesce(search_text,''))>200 then raise exception 'CI_INVALID_INPUT';end if;
 perform public.campaign_import_status(batch);
 select * into t from public.email_templates where id=template and archived_at is null;
 if t.id is null then raise exception 'CI_TEMPLATE_CHANGED';end if;
 with scoped as materialized(
  select a.* from public.first_contact_candidates(t.subject,t.body,account) a
  join public.campaign_import_contact_rows(batch) b on b.contact_id=a.contact_id
 ), filtered as materialized(
  select * from scoped where coalesce(search_text,'')='' or concat_ws(' ',company,name,email) ilike '%'||search_text||'%'
 ) select jsonb_build_object(
  'eligible',(select count(*) from scoped where reason='eligible'),
  'excluded',(select count(*) from scoped where reason<>'eligible'),
  'reasons',(select coalesce(jsonb_object_agg(reason,n),'{}') from(select reason,count(*) n from scoped group by reason) x),
  'total',(select count(*) from filtered),
  'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from filtered order by email,contact_id limit 50 offset page_number*50) x),'[]')
 ) into result;
 return result;
end $$;
revoke all on function public.campaign_import_leads_page(uuid,uuid,uuid,text,int) from public,anon,service_role;
grant execute on function public.campaign_import_leads_page(uuid,uuid,uuid,text,int) to authenticated;

create function public.campaign_verify_import(batch uuid,expected_count int,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt public.command_receipts;payload jsonb:=jsonb_build_object('batch',batch,'expected_count',expected_count);ids uuid[];r jsonb;
begin
 perform public.campaign_import_status(batch);
 if request_key is null or expected_count is null or expected_count not between 1 and 5000 then raise exception 'CI_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts c where c.user_id=auth.uid() and c.request_key=campaign_verify_import.request_key;
 if found then
  if receipt.kind<>'verify_import_batch' or receipt.fingerprint<>md5(payload::text) then raise exception 'Idempotency key reused';end if;
  return receipt.result;
 end if;
 perform 1 from public.import_batches b where b.id=batch and b.status='completed' for update;
 if not found then raise exception 'CI_IMPORT_RUNNING';end if;
 perform 1 from public.contacts c where c.id in(select x.contact_id from public.campaign_import_contact_rows(batch) x) order by c.id for update;
 select array(select x.contact_id from public.campaign_import_contact_rows(batch) x
  where x.verification='pending' and x.can_verify and not x.suppressed and (x.verification_state is null or x.verification_state='completed')
  order by x.contact_id limit 5000) into ids;
 if cardinality(ids)<>expected_count then raise exception 'CI_STALE';end if;
 r:=public.crm_command('verify_contacts',jsonb_build_object('contact_ids',to_jsonb(ids)),request_key);
 update public.command_receipts c set kind='verify_import_batch',fingerprint=md5(payload::text) where c.user_id=auth.uid() and c.request_key=campaign_verify_import.request_key;
 return r;
end $$;
revoke all on function public.campaign_verify_import(uuid,int,uuid) from public,anon,service_role;
grant execute on function public.campaign_verify_import(uuid,int,uuid) to authenticated;

create function public.campaign_create_from_import(p jsonb,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare batch uuid:=nullif(p->>'import_batch_id','')::uuid;s jsonb;receipt public.command_receipts;r jsonb;c public.campaigns;ids uuid[];trusted_context jsonb;
begin
 s:=public.campaign_import_status(batch);
 if request_key is null then raise exception 'CI_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts x where x.user_id=auth.uid() and x.request_key=campaign_create_from_import.request_key;
 if found then
  if receipt.kind<>'create_import_campaign' or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused';end if;
  return receipt.result;
 end if;
 perform 1 from public.import_batches b where b.id=batch for update;
 if not coalesce((s->>'ready')::boolean,false) then raise exception 'CI_VERIFICATION_PENDING';end if;
 -- Reuse the current command (including installed brand/template wrappers).
 -- Empty selection prevents any fallback to global recipients during creation.
 r:=public.crm_command('create_campaign',(p-'import_batch_id')||jsonb_build_object('selected_contact_ids','[]'::jsonb,'steps','[]'::jsonb),request_key);
 select * into c from public.campaigns where id=(r->>'id')::uuid for update;
 if c.id is null or c.created_by<>auth.uid() or c.status<>'draft' or not c.first_contact then raise exception 'CI_CREATE_UNAVAILABLE';end if;
 if p ? 'selected_contact_ids' then
  if jsonb_typeof(p->'selected_contact_ids')<>'array' or jsonb_array_length(p->'selected_contact_ids')>5000 then raise exception 'CI_SELECTION_LIMIT';end if;
  ids:=array(select distinct value::uuid from jsonb_array_elements_text(p->'selected_contact_ids'));
  if exists(select 1 from unnest(ids) id where not exists(
   select 1 from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) a
   join public.campaign_import_contact_rows(batch) b on b.contact_id=a.contact_id where a.contact_id=id and a.reason='eligible'
  )) then raise exception 'CI_SELECTION_SCOPE';end if;
 else
  ids:=array(select a.contact_id from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) a
   join public.campaign_import_contact_rows(batch) b on b.contact_id=a.contact_id where a.reason='eligible' order by a.contact_id limit 5001);
  if cardinality(ids)>5000 then raise exception 'CI_SELECTION_LIMIT';end if;
 end if;
 -- The installed brand wrapper clears its transaction context before returning.
 -- Reuse only the snapshot it just generated, never context supplied by the caller.
 -- This keeps the existing audience guard active during the atomic scope update.
 if to_jsonb(c) ? 'brand_snapshot' then
  trusted_context:=to_jsonb(c)->'brand_snapshot';
  if trusted_context is null or trusted_context='null'::jsonb or trusted_context->>'purpose' is distinct from 'campaign'
   or trusted_context->>'actor_id' is distinct from auth.uid()::text or trusted_context->>'account_id' is distinct from c.account_id::text then raise exception 'CI_CREATE_UNAVAILABLE';end if;
  perform set_config('pipeline_os.brand_context',trusted_context::text,true);
 end if;
 update public.campaigns set selected_contact_ids=ids,batch_id=batch where id=c.id;
 perform set_config('pipeline_os.brand_context','',true);
 update public.command_receipts x set kind='create_import_campaign',fingerprint=md5(p::text) where x.user_id=auth.uid() and x.request_key=campaign_create_from_import.request_key;
 return r;
end $$;
revoke all on function public.campaign_create_from_import(jsonb,uuid) from public,anon,service_role;
grant execute on function public.campaign_create_from_import(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
