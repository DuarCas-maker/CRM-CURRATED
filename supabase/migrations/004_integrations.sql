begin;
create function public.claim_verifications() returns table(id uuid,email text) language plpgsql security definer set search_path='' as $$
begin
 return query with pending as(select v.id from public.verifications v where state='queued' order by v.id for update skip locked limit 1000), reserved as(update public.verifications v set state='uncertain_request' from pending p where v.id=p.id returning v.id,v.contact_id) select r.id,c.email from reserved r join public.contacts c on c.id=r.contact_id;
end $$;
create function public.apply_verification_results(batch text,results jsonb) returns void language plpgsql security definer set search_path='' as $$
declare entry jsonb; v public.verifications;
begin
 for entry in select value from jsonb_array_elements(results) loop
  select vr.* into v from public.verifications vr join public.contacts c on c.id=vr.contact_id where vr.provider_batch_id=batch and c.email=entry->>'email' for update of vr;
  if v.id is null or v.state='completed' then continue; end if;
  update public.verifications set result=entry->>'result',reason=entry->>'reason',state='completed',verified_at=now() where id=v.id;
  update public.contacts set verification=entry->>'result' where id=v.contact_id;
 end loop;
end $$;
create function public.advance_gmail_history(account uuid,checkpoint text) returns void language plpgsql security definer set search_path='' as $$
begin update public.mail_credentials set history_id=checkpoint,last_reconciled_at=now() where account_id=account and (history_id is null or history_id::numeric<checkpoint::numeric); end $$;
alter table public.outbox alter column opportunity_id drop not null;
alter table public.outbox add column notification_id uuid references public.notifications;
alter table public.outbox add constraint outbox_purpose check((opportunity_id is not null and notification_id is null) or (opportunity_id is null and notification_id is not null));
-- Use the same sender queue and account limits for internal notification emails.
create function public.claim_notification_outbox() returns setof public.outbox language plpgsql security definer set search_path='' as $$
declare msg public.outbox; account public.mail_accounts; recipient public.profiles; sent_count int;
begin
 select * into msg from public.outbox where status='queued' and notification_id is not null and available_at<=now() order by available_at for update skip locked limit 1;
 if msg.id is null then return; end if;
 select * into account from public.mail_accounts where id=msg.account_id for update;
 select p.* into recipient from public.profiles p join public.notifications n on n.user_id=p.id where n.id=msg.notification_id;
 if account.status<>'connected' then update public.outbox set status='paused' where id=msg.id; return; end if;
 if recipient.id is null or not recipient.active or msg.to_email<>recipient.email or not exists(select 1 from public.notification_preferences where user_id=recipient.id and email) then update public.outbox set status='cancelled' where id=msg.id; return; end if;
 select count(*) into sent_count from public.outbox where account_id=account.id and status in ('sent','sending','uncertain') and coalesce(sent_at,sending_at)>=date_trunc('day',now() at time zone account.timezone) at time zone account.timezone;
 if sent_count>=account.daily_limit or exists(select 1 from public.outbox where account_id=account.id and sending_at>now()-interval '30 seconds') then update public.outbox set available_at=now()+interval '1 minute' where id=msg.id; return; end if;
 return query update public.outbox set status='sending',sending_at=now() where id=msg.id returning *;
end $$;
revoke all on function public.claim_verifications(),public.apply_verification_results(text,jsonb),public.advance_gmail_history(uuid,text),public.claim_notification_outbox() from public,anon,authenticated;
grant execute on all functions in schema public to service_role;
commit;
