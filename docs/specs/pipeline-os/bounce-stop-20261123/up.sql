begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create schema bounce_v1;
revoke all on schema bounce_v1 from public,anon,authenticated,service_role;
create table public.mail_bounce_events(
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.mail_accounts,
 gmail_message_id text not null, recipient text not null check(recipient=lower(btrim(recipient))),
 outbox_id uuid not null references public.outbox, contact_id uuid references public.contacts,
 reason text not null check(reason in('mailbox_full','address_not_found','policy_rejected','delivery_failed')),
 smtp_status text not null check(smtp_status~'^[45]\.[0-9]{1,3}\.[0-9]{1,3}$'),
 action text not null check(action in('failed','delayed')), occurred_at timestamptz not null,
 created_at timestamptz not null default now(),unique(account_id,gmail_message_id,recipient)
);
create index mail_bounce_recipient on public.mail_bounce_events(recipient,occurred_at desc);
create table public.mail_bounce_blocks(
 email text primary key check(email=lower(btrim(email))), reason text not null,
 event_id uuid not null references public.mail_bounce_events, active boolean not null default true,
 blocked_at timestamptz not null default now(), unlocked_at timestamptz,
 unlocked_by uuid references public.profiles, unlock_reason text
);
create table bounce_v1.independent_suppressions(email text not null,reason text not null,primary key(email,reason));
insert into bounce_v1.independent_suppressions select email,reason from public.suppressions;
create function bounce_v1.remember_suppression() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.reason<>'delivery_bounce' then insert into bounce_v1.independent_suppressions values(new.email,new.reason) on conflict do nothing;end if;
 return new;
end$$;
create trigger bounce_suppression_reason before insert or update on public.suppressions for each row execute function bounce_v1.remember_suppression();

alter table public.mail_bounce_events enable row level security;
alter table public.mail_bounce_blocks enable row level security;
create function bounce_v1.visible(a uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.current_app_role() in ('superadmin','seller_admin') or
 (public.current_app_role() is not null and exists(select 1 from public.mail_permissions where account_id=a and user_id=auth.uid()) ) or
 (public.current_app_role() is not null and exists(select 1 from public.mail_accounts where id=a and owner_id=auth.uid())),false)
$$;
-- No direct writes or global address enumeration by authenticated callers.
create policy bounce_read on public.mail_bounce_events for select to authenticated using(bounce_v1.visible(account_id));
create policy bounce_block_read on public.mail_bounce_blocks for select to authenticated using(exists(select 1 from public.mail_bounce_events e where e.recipient=email and bounce_v1.visible(e.account_id)));
revoke all on public.mail_bounce_events,public.mail_bounce_blocks from public,anon,authenticated;
grant select on public.mail_bounce_events,public.mail_bounce_blocks to authenticated;
grant all on public.mail_bounce_events,public.mail_bounce_blocks to service_role;
grant usage on schema bounce_v1 to authenticated;
grant execute on function bounce_v1.visible(uuid) to authenticated;

create function public.record_mail_bounce(account uuid,notice text,thread text,occurred timestamptz,report jsonb,dry_run boolean default false) returns jsonb
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
 and (o.message_id_header=any(refs) or (coalesce(cardinality(refs),0)=0 and o.gmail_thread_id=thread and thread<>''))
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
revoke all on function public.record_mail_bounce(uuid,text,text,timestamptz,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.record_mail_bounce(uuid,text,text,timestamptz,jsonb,boolean) to service_role;

create function bounce_v1.outbox_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in('queued','paused','sending') and exists(select 1 from public.mail_bounce_blocks b where b.active and
 (b.email=lower(btrim(new.to_email)) or b.email=any(new.cc_emails) or b.email=any(new.bcc_emails))) then
  if tg_op='INSERT' or old.status not in('sent','uncertain') then
   -- Never rewrite an already admitted wire attempt; its outcome must reconcile.
   if new.brand_admission_id is null then new.status:='cancelled';new.last_error:='RECIPIENT_BOUNCED';end if;
  end if;
 end if;
 return new;
end$$;
create trigger zz_bounce_outbox before insert or update on public.outbox for each row execute function bounce_v1.outbox_guard();
create function bounce_v1.enrollment_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in('active','paused') and exists(select 1 from public.contacts c join public.mail_bounce_blocks b on b.email=c.email where c.id=new.contact_id and b.active) then new.status:='bounced';end if;
 return new;
end$$;
create trigger zz_bounce_enrollment before insert or update on public.campaign_enrollments for each row execute function bounce_v1.enrollment_guard();

-- Preserve all existing brand, schedule and quota gates; add the block at the
-- same authoritative boundary used for claiming AND final wire admission.
alter function public.recheck_outbox_delivery_before_brand_b2(uuid) set schema bounce_v1;
create function public.recheck_outbox_delivery_before_brand_b2(message uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare m public.outbox;
begin
 select * into m from public.outbox where id=message;
 if m.id is null then return false;end if;
 if exists(select 1 from public.mail_bounce_blocks b where b.active and (b.email=lower(btrim(m.to_email)) or b.email=any(m.cc_emails) or b.email=any(m.bcc_emails))) then
  update public.outbox set status='cancelled',last_error='RECIPIENT_BOUNCED' where id=message and status in('queued','paused','sending') and brand_admission_id is null;return false;
 end if;
 return bounce_v1.recheck_outbox_delivery_before_brand_b2(message);
end$$;
revoke all on function public.recheck_outbox_delivery_before_brand_b2(uuid) from public,anon,authenticated,service_role;

create function public.unlock_full_mailbox(address text,explanation text) returns void language plpgsql security definer set search_path='' as $$
declare b public.mail_bounce_blocks;independent text;
begin
 if public.current_app_role() is null or public.current_app_role() not in('superadmin','seller_admin') then raise exception 'BOUNCE_FORBIDDEN';end if;
 if length(btrim(explanation)) not between 10 and 500 then raise exception 'BOUNCE_REASON_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('bounce:'||lower(btrim(address)),0));
 select * into b from public.mail_bounce_blocks where email=lower(btrim(address)) for update;
 if b.email is null or not b.active or b.reason<>'mailbox_full' then raise exception 'BOUNCE_NOT_UNLOCKABLE';end if;
 update public.mail_bounce_blocks set active=false,unlocked_at=now(),unlocked_by=auth.uid(),unlock_reason=btrim(explanation) where email=b.email;
 select reason into independent from bounce_v1.independent_suppressions where email=b.email order by reason limit 1;
 if independent is null then delete from public.suppressions where email=b.email and reason='delivery_bounce';
 else update public.suppressions set reason=independent where email=b.email and reason='delivery_bounce';end if;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'mail_bounce',b.event_id,'manual_unlock',jsonb_build_object('reason',btrim(explanation),'other_suppression',independent is not null));
 -- Cancelled messages/enrollments are deliberately never resumed here.
end$$;
revoke all on function public.unlock_full_mailbox(text,text) from public,anon,service_role;
grant execute on function public.unlock_full_mailbox(text,text) to authenticated;
-- Private helpers cannot be invoked directly, including by service_role.
revoke all on all functions in schema bounce_v1 from public,anon,authenticated,service_role;
grant execute on function bounce_v1.visible(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
