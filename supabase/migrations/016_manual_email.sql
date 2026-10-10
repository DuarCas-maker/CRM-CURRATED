begin;

-- Existing conversation_scope already allows client mail during the closer phase.
alter table public.conversations add column recipient_email text;
alter table public.mail_accounts add column send_retry_at timestamptz;
alter table public.outbox add column last_error text;
alter table public.outbox add column send_attempts integer not null default 0;

create function public.queue_manual_email(case_id uuid,account uuid,recipient text,subject_text text,body_text text,files uuid[],gmail_files uuid[],request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.opportunities;a public.mail_accounts;previous public.outbox;target uuid;phase public.case_area;
begin
 if not public.can_edit_case(case_id) then raise exception 'Case is read-only'; end if;
 select * into o from public.opportunities where id=case_id for update;
 if o.archived_at is not null or (o.email_qualified_at is null and o.historical_approved_at is null) then raise exception 'Eligible opportunity required'; end if;
 phase:=case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end;
 if not public.can_send(account) then raise exception 'Sender permission required'; end if;
 select * into a from public.mail_accounts where id=account;
 if a.status<>'connected' then raise exception 'Sender account is not connected'; end if;
 recipient:=lower(btrim(recipient));subject_text:=btrim(subject_text);body_text:=btrim(body_text);
 if recipient is null or recipient !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(recipient)>254 or subject_text is null or length(subject_text) not between 1 and 200 or subject_text ~ '[\r\n]' or body_text is null or length(body_text) not between 1 and 10000 or cardinality(files)>10 or cardinality(gmail_files)>10 or request is null then raise exception 'Invalid email fields'; end if;
 if phase='seller' and exists(select 1 from public.suppressions where email=recipient) then raise exception 'Recipient is suppressed'; end if;
 if files is null or gmail_files is null or exists(select 1 from unnest(files) as f(file_id) where not exists(select 1 from public.documents d where d.id=f.file_id and d.opportunity_id=o.id and d.status='approved' and d.storage_path is not null)) or exists(select 1 from unnest(gmail_files) as f(file_id) where not exists(select 1 from public.gmail_saved_attachments d where d.id=f.file_id and d.opportunity_id=o.id and d.status='approved' and d.storage_path is not null)) then raise exception 'Approved case attachments required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(request::text,27));
 select * into previous from public.outbox where request_key=request::text;
 if previous.id is not null then
  if previous.requested_by is distinct from auth.uid() or previous.opportunity_id is distinct from case_id or previous.account_id is distinct from account or previous.to_email is distinct from recipient or previous.subject is distinct from subject_text or previous.body is distinct from body_text or previous.attachment_ids is distinct from files or previous.gmail_file_ids is distinct from gmail_files then raise exception 'Request key reused with different input'; end if;
  return previous.id;
 end if;
 insert into public.outbox(account_id,opportunity_id,to_email,subject,body,area,attachment_ids,gmail_file_ids,message_id_header,requested_by,request_key,available_at)
 values(account,case_id,recipient,subject_text,body_text,phase,files,gmail_files,'<'||request::text||'@crm.curated.local>',auth.uid(),request::text,greatest(now(),a.send_retry_at)) returning id into target;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'outbox',target,'manual_email_queued');
 return target;
end $$;

-- Recheck permissions and eligibility at delivery time, including the historical
-- exception. The original claim still enforces campaign validation and limits.
alter function public.claim_outbox() rename to claim_outbox_v15;
create function public.claim_outbox() returns setof public.outbox language plpgsql security definer set search_path='' as $$
declare msg public.outbox;
begin
 update public.outbox x set available_at=a.send_retry_at from public.mail_accounts a where x.account_id=a.id and x.status='queued' and a.send_retry_at>now() and x.available_at<a.send_retry_at;
 select * into msg from public.claim_outbox_v7();
 if msg.id is null then return; end if;
 if not exists(select 1 from public.opportunities where id=msg.opportunity_id and (email_qualified_at is not null or historical_approved_at is not null)) then update public.outbox set status='paused' where id=msg.id;return;end if;
 return query update public.outbox set send_attempts=send_attempts+1 where id=msg.id returning *;
end $$;
alter function public.claim_notification_outbox() rename to claim_notification_outbox_v15;
create function public.claim_notification_outbox() returns setof public.outbox language plpgsql security definer set search_path='' as $$
declare msg public.outbox;
begin
 update public.outbox x set available_at=a.send_retry_at from public.mail_accounts a where x.account_id=a.id and x.status='queued' and a.send_retry_at>now() and x.available_at<a.send_retry_at;
 select * into msg from public.claim_notification_outbox_v15();
 if msg.id is null then return;end if;
 return query update public.outbox set send_attempts=send_attempts+1 where id=msg.id returning *;
end $$;

create function public.defer_gmail_send(message uuid,seconds integer,error_code text) returns void language plpgsql security definer set search_path='' as $$
declare msg public.outbox;until_at timestamptz;
begin
 select * into msg from public.outbox where id=message for update;
 if msg.status<>'sending' then return;end if;
 if seconds<1 or error_code !~ '^GMAIL_HTTP_(403|429)(_[A-Za-z_]+)?$' then raise exception 'Invalid retry';end if;
 update public.mail_accounts set send_retry_at=greatest(send_retry_at,now()+make_interval(secs=>seconds)) where id=msg.account_id returning send_retry_at into until_at;
 update public.outbox set status='queued',sending_at=null,available_at=until_at,last_error=error_code where id=msg.id;
 update public.outbox set available_at=greatest(available_at,until_at) where account_id=msg.account_id and status='queued';
end $$;

alter function public.mark_sent(uuid,text,text) rename to mark_sent_v15;
create function public.mark_sent(outbox_id uuid,gmail_id text,thread_id text) returns void language plpgsql security definer set search_path='' as $$
declare msg public.outbox;
begin
 select * into msg from public.outbox where id=outbox_id for update;
 if exists(select 1 from public.conversations where account_id=msg.account_id and gmail_thread_id=thread_id and opportunity_id<>msg.opportunity_id) then raise exception 'Thread belongs to another case';end if;
 perform public.mark_sent_v15(outbox_id,gmail_id,thread_id);
 update public.outbox set last_error=null,conversation_id=(select id from public.conversations where account_id=msg.account_id and gmail_thread_id=thread_id) where id=msg.id;
 update public.conversations set recipient_email=coalesce(recipient_email,msg.to_email) where account_id=msg.account_id and gmail_thread_id=thread_id and opportunity_id=msg.opportunity_id;
end $$;

create function public.mail_send_status(cases uuid[]) returns table(id uuid,status text,account_id uuid,opportunity_id uuid,to_email text,subject text,available_at timestamptz,last_error text,created_at timestamptz) language sql stable security definer set search_path='' as $$
 select x.id,x.status,x.account_id,x.opportunity_id,x.to_email,x.subject,x.available_at,x.last_error,x.created_at from public.outbox x
 where x.opportunity_id=any(cases) and public.can_area(x.opportunity_id,x.area)
 order by x.created_at desc limit 200
$$;
revoke all on function public.queue_manual_email(uuid,uuid,text,text,text,uuid[],uuid[],uuid),public.mail_send_status(uuid[]),public.defer_gmail_send(uuid,integer,text),public.claim_outbox(),public.claim_outbox_v15(),public.claim_notification_outbox(),public.claim_notification_outbox_v15(),public.mark_sent(uuid,text,text),public.mark_sent_v15(uuid,text,text) from public,anon,authenticated;
grant execute on function public.queue_manual_email(uuid,uuid,text,text,text,uuid[],uuid[],uuid),public.mail_send_status(uuid[]) to authenticated;
grant execute on function public.defer_gmail_send(uuid,integer,text),public.claim_outbox(),public.claim_notification_outbox(),public.mark_sent(uuid,text,text),public.mark_sent_v15(uuid,text,text) to service_role;
commit;
