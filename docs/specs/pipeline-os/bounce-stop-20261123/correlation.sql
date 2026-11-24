-- Gmail may rewrite the submitted RFC Message-ID. Accept its archived outbound
-- ID only when the same-account Gmail message ID is tied to that exact outbox.
begin;set local lock_timeout='3s';set local statement_timeout='15s';
do $guard$begin if (select md5(prosrc) from pg_proc where oid='public.record_mail_bounce(uuid,text,text,timestamptz,jsonb,boolean)'::regprocedure)<>'bf206aab989a14309149e747b7655577' then raise exception 'BOUNCE_CORRELATION_SOURCE_CHANGED';end if;end$guard$;
create or replace function public.record_mail_bounce(account uuid,notice text,thread text,occurred timestamptz,report jsonb,dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare recipient text:=lower(btrim(report->>'recipient'));m public.outbox;ct uuid;ev uuid;changed integer:=0;stopped integer:=0;refs text[];
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' and session_user not in('postgres','supabase_admin') then raise exception 'BOUNCE_FORBIDDEN';end if;
 if notice is null or length(notice)>200 or recipient is null or recipient!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or occurred>now()+interval '5 minutes'
 or coalesce(report->>'status','')!~'^[45]\.[0-9]{1,3}\.[0-9]{1,3}$' or coalesce(report->>'action','') not in('failed','delayed')
 or coalesce(report->>'reason','') not in('mailbox_full','address_not_found','policy_rejected','delivery_failed') then raise exception 'BOUNCE_INVALID';end if;
 select array_agg(x) into refs from jsonb_array_elements_text(coalesce(report->'references','[]')) x;
 -- Recipient plus the original RFC identity (or an unambiguous same-account
 -- Gmail thread) is mandatory. No subject-only or body-email attribution.
 select o.* into m from public.outbox o where o.account_id=account and lower(btrim(o.to_email))=recipient
 and o.status in('sent','uncertain','sending') and coalesce(o.sent_at,o.sending_at,o.created_at)<=occurred+interval '5 minutes'
 and (o.message_id_header=any(refs) or exists(select 1 from public.gmail_archive_messages actual where actual.account_id=o.account_id and actual.direction='outbound' and actual.gmail_message_id=o.gmail_message_id and actual.internet_message_id=any(refs)) or (coalesce(cardinality(refs),0)=0 and o.gmail_thread_id=thread and thread<>''))
 order by coalesce(o.sent_at,o.sending_at,o.created_at) desc,o.id limit 1;
 if m.id is null then return jsonb_build_object('matched',false);end if;
 if dry_run then return jsonb_build_object('matched',true,'dry_run',true);end if;
 select id into ct from public.contacts where email=recipient;
 perform pg_advisory_xact_lock(hashtextextended('bounce:'||recipient,0));
 insert into public.mail_bounce_events(account_id,gmail_message_id,recipient,outbox_id,contact_id,reason,smtp_status,action,occurred_at)
 values(account,notice,recipient,m.id,ct,report->>'reason',report->>'status',report->>'action',occurred)
 on conflict do nothing returning id into ev;
 if ev is null then return jsonb_build_object('matched',true,'duplicate',true);end if;
 insert into public.mail_bounce_blocks(email,reason,event_id,blocked_at) values(recipient,report->>'reason',ev,occurred)
 on conflict(email) do update set active=true,
 reason=case when mail_bounce_blocks.active and mail_bounce_blocks.reason<>'mailbox_full' then mail_bounce_blocks.reason else excluded.reason end,
 event_id=excluded.event_id,blocked_at=greatest(mail_bounce_blocks.blocked_at,excluded.blocked_at)
 where mail_bounce_blocks.unlocked_at is null or excluded.blocked_at>mail_bounce_blocks.unlocked_at;
 if not exists(select 1 from public.mail_bounce_blocks where email=recipient and active) then return jsonb_build_object('matched',true,'historical_only',true);end if;
 insert into public.suppressions(email,reason) values(recipient,'delivery_bounce') on conflict do nothing;
 update public.campaign_enrollments e set status='bounced' where e.contact_id=ct and e.status in('active','paused','completed');get diagnostics stopped=row_count;
 update public.outbox o set status='cancelled',last_error='RECIPIENT_BOUNCED' where (lower(btrim(o.to_email))=recipient or recipient=any(o.cc_emails) or recipient=any(o.bcc_emails)) and o.status in('queued','paused');get diagnostics changed=row_count;
 insert into public.audit_log(entity_type,entity_id,action,metadata) values('mail_bounce',ev,'block',jsonb_build_object('cancelled',changed,'stopped',stopped));
 return jsonb_build_object('matched',true,'duplicate',false,'cancelled',changed,'stopped',stopped);
end$$;
notify pgrst,'reload schema';
commit;
