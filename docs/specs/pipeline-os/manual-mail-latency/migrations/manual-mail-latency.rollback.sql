-- Stop the fast dispatcher before reverting; preserve queued/sending/uncertain rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if (select pg_get_userbyid(proowner) from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure) is distinct from current_user then raise exception 'MANUAL_MAIL_OWNER_MISMATCH';end if;
 if (select pg_get_userbyid(proowner) from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure) is distinct from current_user then raise exception 'MANUAL_MAIL_OWNER_MISMATCH';end if;
 if to_regprocedure('brand_b2.claim_scoped(boolean,uuid)') is null
 or position('brand_b2.claim_scoped(notification_only,null)' in replace(pg_get_functiondef('brand_b2.claim(boolean)'::regprocedure),' ',''))=0
 then raise exception 'MANUAL_MAIL_ROLLBACK_BASE_MISMATCH';end if;
end$$;
create or replace function brand_b2.claim(notification_only boolean) returns setof public.outbox language plpgsql security definer set search_path='' as $$
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
drop function public.claim_manual_outbox(uuid);
drop function public.manual_mail_ready_accounts();
drop function brand_b2.claim_scoped(boolean,uuid);
drop function brand_b2.is_manual_mail(public.outbox);
drop index public.manual_mail_due_idx;
drop index public.manual_mail_order_idx;
notify pgrst,'reload schema';
commit;
