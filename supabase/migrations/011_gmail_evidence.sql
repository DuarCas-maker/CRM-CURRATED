begin;
alter table public.messages add column archive_message_id uuid references public.gmail_archive_messages;
alter table public.messages add column nature text not null default 'personal';
alter table public.messages add column participants jsonb not null default '[]';
create unique index message_archive_once on public.messages(archive_message_id) where archive_message_id is not null;

create function public.gmail_link_message(archive_id uuid,snapshot jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;link public.gmail_thread_links;o public.opportunities;co uuid;stored uuid;area public.case_area;event_key text;
begin
 select * into m from public.gmail_archive_messages where id=archive_id;
 select * into link from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if link.opportunity_id is null then return null; end if;
 select * into o from public.opportunities where id=link.opportunity_id;
 area:=case when link.submission_id is not null or (o.handed_off_at is not null and m.sent_at>=o.handed_off_at) then 'closer'::public.case_area else 'seller'::public.case_area end;
 insert into public.conversations(opportunity_id,submission_id,account_id,gmail_thread_id,subject,area,process_id,updated_at)
 values(o.id,link.submission_id,m.account_id,m.gmail_thread_id,m.subject,area,link.process_id,m.sent_at)
 on conflict(account_id,gmail_thread_id) do nothing;
 select id into co from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if not exists(select 1 from public.conversations where id=co and opportunity_id=o.id) then raise exception 'Thread conflict'; end if;
 event_key:='message:'||o.id||':'||case when m.internet_message_id<>'' then md5(m.internet_message_id) else m.id::text end;
 perform pg_advisory_xact_lock(hashtextextended(event_key,41));
 if m.internet_message_id<>'' then
  select msg.id into stored from public.messages msg join public.conversations cv on cv.id=msg.conversation_id where cv.opportunity_id=o.id and msg.internet_message_id=m.internet_message_id limit 1;
 end if;
 if stored is null then
 insert into public.messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status,internet_message_id,archive_message_id,nature,participants)
 values(co,m.gmail_message_id,m.direction,coalesce((select p->>'email' from jsonb_array_elements(m.participants) p where p->>'role'='from' limit 1),''),snapshot->>'body',m.sent_at,case when m.direction='outbound' then 'sent' else 'received' end,m.internet_message_id,m.id,m.nature,m.participants)
 on conflict(conversation_id,gmail_message_id) do update set archive_message_id=excluded.archive_message_id,nature=excluded.nature,participants=excluded.participants returning id into stored;
 else
  update public.messages set archive_message_id=coalesce(archive_message_id,m.id),nature=m.nature,participants=m.participants where id=stored;
 end if;
 insert into public.case_events(opportunity_id,process_id,submission_id,archive_message_id,area,kind,body,evidence_type,occurred_at,dedupe_key)
 values(o.id,link.process_id,link.submission_id,m.id,area,m.nature,case when m.direction='inbound' then 'Received: ' else 'Sent: ' end||m.subject,'explicit',m.sent_at,event_key) on conflict do nothing;
 insert into public.gmail_saved_attachments(archive_message_id,opportunity_id,process_id,submission_id,part_id,name,mime_type,size,received_at,area)
 select m.id,o.id,link.process_id,link.submission_id,a->>'part_id',a->>'name',a->>'mime_type',(a->>'size')::int,m.sent_at,area
 from jsonb_array_elements(m.attachment_index) a on conflict do nothing;
 update public.conversations set updated_at=greatest(updated_at,m.sent_at),needs_attention=case when m.nature='personal' and m.sent_at>=updated_at then m.direction='inbound' else needs_attention end where id=co;
 -- Automatic mail and delivery reports never count as a personal reply.
 if m.nature='personal' and exists(
  select 1 from jsonb_array_elements(m.participants) p where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end
  and (case when link.submission_id is not null then exists(select 1 from public.submissions s join public.lenders l on l.id=s.lender_id where s.id=link.submission_id and lower(l.email)=p->>'email')
  else exists(select 1 from public.contacts c where c.email=p->>'email' and (c.id=o.contact_id or exists(select 1 from public.company_contacts cc where cc.contact_id=c.id and cc.company_id=o.company_id and cc.relationship in ('primary','contact')))) end)
 ) then
  if not exists(select 1 from public.mail_waits where conversation_id=co and since_at>=m.sent_at) then
   if exists(select 1 from public.mail_waits w join public.tasks t on t.id=w.task_id where w.conversation_id=co and t.status='open') then
    update public.tasks set status='done' where id=(select task_id from public.mail_waits where conversation_id=co);
   end if;
   insert into public.mail_waits(opportunity_id,conversation_id,process_id,area,waiting_for,since_at,source_message_id,draft)
   values(o.id,co,link.process_id,area,case when m.direction='inbound' then 'team' when link.submission_id is not null then 'lender' else 'client' end,m.sent_at,m.id,
   case when m.direction='inbound' then 'Thank you for your message. We are reviewing your request and will follow up with the next steps.' else 'Hello, I am following up on our previous message. Could you please share an update?' end)
   on conflict(conversation_id) do update set waiting_for=excluded.waiting_for,since_at=excluded.since_at,source_message_id=excluded.source_message_id,task_id=null,draft=excluded.draft,updated_at=now();
  end if;
 end if;
 return stored;
end $$;

create function public.gmail_followups() returns void language plpgsql security definer set search_path='' as $$
declare w public.mail_waits;o public.opportunities;task uuid;recipient uuid;
begin
 for w in select * from public.mail_waits where task_id is null and since_at<=now()-interval '5 days' order by since_at for update skip locked limit 200 loop
  select * into o from public.opportunities where id=w.opportunity_id and archived_at is null and stage not in ('funded','lost','paused');
  if o.id is null then continue; end if;
  recipient:=case when w.area='closer' then coalesce(o.closer_id,o.seller_id) else o.seller_id end;
  insert into public.tasks(opportunity_id,owner_id,title,due_at,area,automated)
  values(o.id,recipient,'Five calendar days: waiting for '||w.waiting_for,w.since_at+interval '5 days',w.area,true) returning id into task;
  update public.mail_waits set task_id=task where id=w.id;
 end loop;
end $$;

revoke all on function public.gmail_link_message(uuid,jsonb),public.gmail_followups() from public,anon,authenticated;
grant execute on function public.gmail_link_message(uuid,jsonb),public.gmail_followups() to service_role;
commit;
