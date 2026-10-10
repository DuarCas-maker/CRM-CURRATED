begin;
-- Imported evidence updates the contact date, never overwrites a reviewed case stage.
create or replace function public.track_message_contact() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.nature not in ('personal','campaign') then return new; end if;
 update public.opportunities o set last_contact=greatest(o.last_contact,new.sent_at),
 stage=case when new.archive_message_id is null and new.nature='personal' and new.direction='inbound' and o.handed_off_at is null and o.stage in ('new','contacting')
 and exists(select 1 from public.contacts ct where ct.id=o.contact_id and ct.email=new.sender) then 'replied'::public.case_stage else o.stage end
 where o.id=(select c.opportunity_id from public.conversations c where c.id=new.conversation_id);
 return new;
end $$;
create function public.gmail_lock_manual_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and (old.seller_id is distinct from new.seller_id or old.closer_id is distinct from new.closer_id) then new.owner_locked_at:=now(); end if;
 return new;
end $$;
create trigger gmail_manual_owner before update of seller_id,closer_id on public.opportunities for each row execute function public.gmail_lock_manual_owner();
revoke all on function public.gmail_lock_manual_owner() from public,anon,authenticated;
grant execute on function public.gmail_lock_manual_owner() to service_role;
-- Continuous sync may reuse an existing confirmed thread or an unambiguous exact
-- customer address. Names, domains, copied participants and lender guesses never join cases.
create function public.gmail_associate_continuous(archive uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;co public.conversations;target uuid;process uuid;matches uuid[];active_processes uuid[];
begin
 select * into m from public.gmail_archive_messages where id=archive;
 if not exists(select 1 from public.mail_accounts where id=m.account_id and sync_enabled and status='connected') then return; end if;
 if exists(select 1 from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id) then return; end if;
 select * into co from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if co.id is not null then target:=co.opportunity_id;process:=co.process_id;
 else
  if m.nature not in ('personal','campaign') then return; end if;
  if exists(select 1 from jsonb_array_elements(m.participants) p join public.lenders l on lower(l.email)=p->>'email'
   where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end) then return; end if;
  select array_agg(distinct o.id) into matches from public.opportunities o join public.contacts c on
   (c.id=o.contact_id or exists(select 1 from public.company_contacts cc where cc.company_id=o.company_id and cc.contact_id=c.id and cc.relationship in ('primary','contact')))
  join jsonb_array_elements(m.participants) p on p->>'email'=c.email
  where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end and o.archived_at is null
  and (o.email_qualified_at is not null or o.historical_approved_at is not null);
  if cardinality(matches) is distinct from 1 then return; end if;
  target:=matches[1];
  select array_agg(id) into active_processes from public.financing_processes where opportunity_id=target and classification='active' and not is_unclassified_archive;
  if cardinality(active_processes)=1 then process:=active_processes[1];
  elsif cardinality(active_processes)>1 then return; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,19));
 if process is null then
  select id into process from public.financing_processes where opportunity_id=target and is_unclassified_archive limit 1;
  if process is null then
   insert into public.financing_processes(opportunity_id,sequence_number,started_at,classification,label,is_unclassified_archive)
   select target,coalesce(max(sequence_number),0)+1,m.sent_at,'unknown','Historial pendiente de separar en procesos',true
   from public.financing_processes where opportunity_id=target returning id into process;
  end if;
 end if;
 insert into public.gmail_thread_links(account_id,gmail_thread_id,opportunity_id,process_id,submission_id)
 values(m.account_id,m.gmail_thread_id,target,process,co.submission_id) on conflict do nothing;
 -- A transfer is authoritative: syncing an old mailbox never assigns ownership.
end $$;
revoke all on function public.gmail_associate_continuous(uuid) from public,anon,authenticated;
grant execute on function public.gmail_associate_continuous(uuid) to service_role;

-- A new personal reply stops only a campaign that actually sent to that exact
-- address before the reply. Recovered old mail cannot cancel a newer campaign.
create function public.gmail_process_live_reply(archive uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;link public.gmail_thread_links;enrollment uuid;
begin
 select * into m from public.gmail_archive_messages where id=archive;
 if m.direction is distinct from 'inbound' or m.nature is distinct from 'personal' then return; end if;
 select * into link from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 if link.opportunity_id is null or link.submission_id is not null then return; end if;
 for enrollment in
  update public.campaign_enrollments e set status='replied'
  from public.contacts c where e.contact_id=c.id and e.opportunity_id=link.opportunity_id
  and e.status in ('active','paused') and e.created_at<=m.sent_at
  and exists(select 1 from jsonb_array_elements(m.participants) p where p->>'role'='from' and p->>'email'=c.email)
  and exists(select 1 from public.outbox x where x.enrollment_id=e.id and x.account_id=m.account_id
   and lower(x.to_email)=c.email and x.status='sent' and x.sent_at<=m.sent_at)
  returning e.id
 loop
  update public.outbox set status='cancelled' where enrollment_id=enrollment and status in ('queued','paused');
 end loop;
end $$;
revoke all on function public.gmail_process_live_reply(uuid) from public,anon,authenticated;
grant execute on function public.gmail_process_live_reply(uuid) to service_role;

create function public.gmail_case_mail_stats(case_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('sent',count(*) filter(where m.direction='outbound'),
 'personal',count(*) filter(where m.direction='outbound' and m.nature='personal'),
 'campaign',count(*) filter(where m.direction='outbound' and m.nature='campaign'),
 'automatic',count(*) filter(where m.direction='outbound' and m.nature='automatic'),
 'first_at',min(m.sent_at),'last_at',max(m.sent_at))
 from public.messages m join public.conversations c on c.id=m.conversation_id where c.opportunity_id=case_id
$$;
revoke all on function public.gmail_case_mail_stats(uuid) from public,anon;
grant execute on function public.gmail_case_mail_stats(uuid) to authenticated,service_role;
commit;
