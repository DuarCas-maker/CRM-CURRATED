begin;
create function public.legacy_worker_mail_context(account uuid,job_id uuid default null,lease uuid default null,outbox_id uuid default null,claim uuid default null) returns text
language plpgsql stable security definer set search_path='' as $$
declare a public.mail_accounts;j public.jobs;m public.outbox;proof text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'QGR_DENIED';end if;
 select * into a from public.mail_accounts where id=account;
 if a.id is null or a.status<>'connected'
  or not exists(select 1 from public.mail_credentials where account_id=account)
  or exists(select 1 from mail_runtime.routes where account_id=account)
  or exists(select 1 from simple_mail.health where account_id=account)
  or not exists(select 1 from mail_quota.head h join mail_quota.policies p on p.policy_id=h.policy_id and p.generation=h.generation
    where h.id=1 and not h.closed and p.policy->>'state'='enabled') then return null;end if;
 if job_id is not null and lease is not null and outbox_id is null and claim is null then
  select * into j from public.jobs where id=job_id;
  if j.id is null or j.status<>'running' or j.lease_token is distinct from lease or j.locked_at is null or j.locked_at<=now()-interval '5 minutes'
   or j.kind not in ('gmail_sending_usage','gmail_sync','gmail_message','gmail_live_thread','gmail_engagement_thread','gmail_watch')
   or j.payload->>'account_id' is distinct from account::text then return null;end if;
  proof:='job:'||j.id||':'||j.kind||':'||j.lease_token;
 elsif outbox_id is not null and job_id is null and lease is null then
  select * into m from public.outbox where id=outbox_id;
  if m.id is null or m.account_id is distinct from account or m.brand_snapshot is null then return null;end if;
  if claim is not null then
   if m.status<>'sending' or m.brand_claim_token is distinct from claim or m.sending_at is null or m.sending_at<=now()-interval '5 minutes' then return null;end if;
   proof:='outbox:'||m.id||':'||m.brand_claim_token;
  else
   if not(m.status='uncertain' or (m.status='sending' and m.sending_at<now()-interval '5 minutes')) then return null;end if;
   proof:='reconcile:'||m.id||':'||m.status;
  end if;
 else return null;end if;
 return encode(sha256(convert_to(jsonb_build_array(a.id,a.status,a.organization,a.brand_revision,a.sync_enabled,a.live_enabled,proof)::text,'UTF8')),'hex');
end$$;
revoke all on function public.legacy_worker_mail_context(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.legacy_worker_mail_context(uuid,uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
