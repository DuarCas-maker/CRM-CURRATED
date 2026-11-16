-- Reviewed local candidate; no production ordinal assigned. Do not rerun sealed releases.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if (select pg_get_userbyid(proowner) from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure) is distinct from current_user then raise exception 'MANUAL_MAIL_OWNER_MISMATCH';end if;
 if (select pg_get_userbyid(proowner) from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure) is distinct from current_user then raise exception 'MANUAL_MAIL_OWNER_MISMATCH';end if;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='brand_b2.claim(boolean)'::regprocedure) is distinct from '0aec6d3a26c490d986324f2f1fc7d50f' then raise exception 'MANUAL_MAIL_CLAIM_BASE_MISMATCH';end if;
 if to_regprocedure('brand_b2.claim_scoped(boolean,uuid)') is not null then raise exception 'MANUAL_MAIL_ALREADY_INSTALLED';end if;
end$$;
create function brand_b2.is_manual_mail(msg public.outbox) returns boolean language sql immutable set search_path='' as $$
 select msg.notification_id is null and msg.enrollment_id is null and not coalesce(msg.campaign_test,true)
 and msg.requested_by is not null and coalesce(msg.brand_snapshot->>'purpose'='mail',false)
$$;
create function brand_b2.claim_scoped(notification_only boolean,manual_account uuid) returns setof public.outbox language plpgsql security definer set search_path='' as $$
declare candidate public.outbox;msg public.outbox;a public.mail_accounts;usage jsonb;c public.campaigns;sent_count integer;next_manual_at timestamptz;
begin
 for candidate in select selected.* from (select o.* from public.outbox o where o.status='queued' and o.available_at<=now() and (o.notification_id is not null)=notification_only and (manual_account is null or (o.account_id=manual_account and brand_b2.is_manual_mail(o))) and (not brand_b2.is_manual_mail(o) or not exists(select 1 from public.outbox older where older.account_id=o.account_id and older.status='queued' and brand_b2.is_manual_mail(older) and (older.created_at,older.id)<(o.created_at,o.id))) order by available_at,id limit 30) selected order by selected.brand_snapshot->>'brand_id',selected.account_id,selected.available_at,selected.id loop
  if not pg_try_advisory_xact_lock(hashtextextended('manual-mail-account:'||candidate.account_id::text,0)) then continue;end if;
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
  if a.send_retry_at>now() or (usage->>'total_messages')::int>=a.daily_limit or (usage->>'recipient_count')::int+1+coalesce(cardinality(msg.cc_emails),0)+coalesce(cardinality(msg.bcc_emails),0)>2000 then
   update public.outbox set available_at=greatest(now()+interval '1 minute',coalesce(a.send_retry_at,now())) where id=msg.id;continue;
  end if;
  if brand_b2.is_manual_mail(msg) then
   if exists(select 1 from public.outbox x where x.account_id=a.id and x.status='sending') then
    update public.outbox set available_at=now()+interval '1 second' where id=msg.id;continue;
   end if;
   select max(x.sending_at)+interval '1 second' into next_manual_at from public.outbox x where x.account_id=a.id;
   if next_manual_at>now() then update public.outbox set available_at=next_manual_at where id=msg.id;continue;end if;
  elsif exists(select 1 from public.outbox x where x.account_id=a.id and (x.status='sending' or x.sending_at>now()-interval '30 seconds')) then
   update public.outbox set available_at=now()+interval '1 minute' where id=msg.id;continue;
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
create or replace function brand_b2.claim(notification_only boolean) returns setof public.outbox language sql security definer set search_path='' as $$
 select * from brand_b2.claim_scoped(notification_only,null)
$$;
create function public.claim_manual_outbox(account uuid) returns setof public.outbox language plpgsql security definer set search_path='' as $$
begin
 if account is null then return;end if;
 return query select * from brand_b2.claim_scoped(false,account);
end$$;
create function public.manual_mail_ready_accounts() returns uuid[] language sql security definer set search_path='' as $$
 select coalesce(array_agg(q.account_id order by q.due,q.account_id),'{}'::uuid[])
 from (select distinct on(o.account_id) o.account_id,o.available_at due from public.outbox o join public.mail_accounts a on a.id=o.account_id
 where o.status='queued' and a.status='connected' and brand_b2.is_manual_mail(o)
 order by o.account_id,o.created_at,o.id) q where q.due<=now()
$$;
create index manual_mail_due_idx on public.outbox(available_at,account_id,id)
 where status='queued' and notification_id is null and enrollment_id is null and not campaign_test and requested_by is not null;
create index manual_mail_order_idx on public.outbox(account_id,created_at,id)
 where status='queued' and notification_id is null and enrollment_id is null and not campaign_test and requested_by is not null;
revoke all on function brand_b2.is_manual_mail(public.outbox),brand_b2.claim_scoped(boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_manual_outbox(uuid),public.manual_mail_ready_accounts() from public,anon,authenticated,service_role;
grant execute on function public.claim_manual_outbox(uuid),public.manual_mail_ready_accounts() to service_role;
notify pgrst,'reload schema';
commit;
