begin;
-- Two additive RPCs. Existing import, command, worker and delivery functions stay intact.
create function public.campaign_import_review_page(batch uuid,search_text text default '',review_filter text default 'attention',page_number int default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if page_number is null or page_number not between 0 and 1000000 or length(coalesce(search_text,''))>200 or review_filter is null or review_filter not in ('attention','technical','reconciliation','uncertain','valid','invalid','all') then raise exception 'CI_INVALID_INPUT';end if;
 with scoped as materialized(
  select c.id contact_id,coalesce(c.name,'') name,coalesce(l.company,'') company,c.email,
   x.verification,x.verification_state state,
   case when v.reason ~ '^provider_http_[0-9]{3}$' then v.reason else null end reason_code,
   v.created_at attempted_at,
   coalesce(x.verification_state='technical_error' and x.verification in ('pending','uncertain') and x.can_verify and not x.suppressed,false) retryable
  from public.campaign_import_contact_rows(batch) x join public.contacts c on c.id=x.contact_id
  left join lateral(select ld.company from public.leads ld where ld.contact_id=c.id and public.can_lead(ld.id) order by ld.id limit 1) l on true
  left join lateral(select z.reason,z.created_at from public.verifications z where z.contact_id=c.id order by z.created_at desc,z.id desc limit 1) v on true
 ), filtered as materialized(
  select * from scoped where
   (review_filter='all' or review_filter='attention' and state in ('technical_error','uncertain_request','review')
    or review_filter='technical' and state='technical_error'
    or review_filter='reconciliation' and state in ('uncertain_request','review')
    or review_filter in ('uncertain','valid','invalid') and verification=review_filter)
   and (coalesce(search_text,'')='' or concat_ws(' ',name,company,email) ilike '%'||search_text||'%')
 ) select jsonb_build_object('total',(select count(*) from filtered),
  'summary',(select jsonb_build_object(
   'attention',count(*) filter(where state in ('technical_error','uncertain_request','review')),
   'technical',count(*) filter(where state='technical_error'),
   'reconciliation',count(*) filter(where state in ('uncertain_request','review')),
   'running',count(*) filter(where state in ('queued','submitted')),
   'insufficient_credits',count(*) filter(where state='technical_error' and reason_code='provider_http_402')) from scoped),
  'rows',coalesce((select jsonb_agg(to_jsonb(p)) from(select * from filtered order by email,contact_id limit 50 offset page_number*50) p),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.campaign_import_review_page(uuid,text,text,int) from public,anon,service_role;
grant execute on function public.campaign_import_review_page(uuid,text,text,int) to authenticated;

create function public.campaign_retry_import(batch uuid,contact_ids uuid[],expected_count int,request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt public.command_receipts;ids uuid[];payload jsonb;r jsonb;
begin
 perform public.campaign_import_status(batch);
 if request_key is null or expected_count is null or expected_count not between 1 and 5000 or contact_ids is null
  or cardinality(contact_ids)<>expected_count or array_position(contact_ids,null) is not null then raise exception 'CI_INVALID_INPUT';end if;
 ids:=array(select distinct id from unnest(contact_ids) id order by id);
 if cardinality(ids)<>expected_count then raise exception 'CI_INVALID_INPUT';end if;
 payload:=jsonb_build_object('batch',batch,'contact_ids',to_jsonb(ids),'expected_count',expected_count);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts c where c.user_id=auth.uid() and c.request_key=campaign_retry_import.request_key;
 if found then
  if receipt.kind<>'retry_import_verification' or receipt.fingerprint<>md5(payload::text) then raise exception 'Idempotency key reused';end if;
  return receipt.result;
 end if;
 perform 1 from public.import_batches b where b.id=batch and b.status='completed' for update;
 if not found then raise exception 'CI_IMPORT_RUNNING';end if;
 perform 1 from public.contacts c where c.id=any(ids) order by c.id for update;
 if (select count(*) from public.campaign_import_contact_rows(batch) x where x.contact_id=any(ids)
  and x.verification_state='technical_error' and x.verification in ('pending','uncertain') and x.can_verify and not x.suppressed)<>expected_count then raise exception 'CI_RETRY_STALE';end if;
 r:=public.crm_command('verify_contacts',jsonb_build_object('contact_ids',to_jsonb(ids)),request_key);
 if (r->>'queued')::int is distinct from expected_count then raise exception 'CI_RETRY_STALE';end if;
 update public.command_receipts c set kind='retry_import_verification',fingerprint=md5(payload::text)
  where c.user_id=auth.uid() and c.request_key=campaign_retry_import.request_key;
 return r;
end $$;
revoke all on function public.campaign_retry_import(uuid,uuid[],int,uuid) from public,anon,service_role;
grant execute on function public.campaign_retry_import(uuid,uuid[],int,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
