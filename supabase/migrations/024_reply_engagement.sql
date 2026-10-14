begin;

-- 13 October 2026, 00:00 America/Bogota. Receipt time is authoritative.
alter table public.gmail_archive_messages add column reply_intent text check(reply_intent in ('positive','negative','review','ignored'));
alter table public.gmail_archive_messages add column reply_evaluated_at timestamptz;
alter table public.messages add column reply_intent text check(reply_intent in ('positive','negative','review','ignored'));
alter table public.gmail_runs add column is_live_directory boolean not null default false;
create unique index gmail_live_directory on public.gmail_runs(account_id) where is_live_directory;
alter table public.gmail_candidates add column last_received_at timestamptz;
alter table public.gmail_candidates add column latest_reply_intent text;
alter table public.gmail_candidates add column inbox_approved_at timestamptz;
alter table public.conversations add column inbox_activated_at timestamptz;
alter table public.conversations add column manually_incorporated_at timestamptz;
-- A renewed opportunity can retain the original physical Gmail delivery thread
-- while preserving the previous opportunity's conversations and evidence.
alter table public.conversations add column gmail_delivery_thread_id text;
alter table public.opportunities add column mail_interest_message_id uuid references public.gmail_archive_messages;
alter table public.opportunities add column mail_last_reply_at timestamptz;
alter table public.opportunities add column mail_closed_at timestamptz;
-- Receipt backfills update updated_at; they must not change when a case closed.
update public.opportunities set mail_closed_at=coalesce(funded_at,updated_at) where stage in ('funded','lost');
create function public.gmail_record_case_closure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.stage in ('funded','lost') and old.stage is distinct from new.stage then
  new.mail_closed_at:=case when new.stage='funded' then coalesce(new.funded_at,now())
   when new.mail_last_reply_at is distinct from old.mail_last_reply_at then new.mail_last_reply_at else now() end;
 elsif new.stage not in ('funded','lost') then new.mail_closed_at:=null;end if;
 return new;
end $$;
create trigger gmail_case_closure before update of stage on public.opportunities for each row execute function public.gmail_record_case_closure();
revoke all on function public.gmail_record_case_closure() from public,anon,authenticated;
create index gmail_reply_backfill on public.gmail_archive_messages(id) where reply_evaluated_at is null;
create index conversations_engaged on public.conversations(opportunity_id) where inbox_activated_at is not null;

create function public.mail_human_reply(direction text,nature text,sender text) returns boolean language sql immutable set search_path='' as $$
 select direction='inbound' and nature='personal' and sender<>''
 and sender !~* '^(mailer-daemon|postmaster|no[._-]?reply|do[._-]?not[._-]?reply|bounce(s)?([+._-][^@]*)?)@'
$$;

create function public.gmail_refresh_inbox(conversation uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.conversations c set inbox_activated_at=coalesce(c.manually_incorporated_at,(
  select min(m.sent_at) from public.messages m
  where m.conversation_id=c.id and public.mail_human_reply(m.direction,m.nature,m.sender) and m.reply_intent is distinct from 'ignored'
  and (m.reply_intent='positive' or public.mail_is_team(m.sender) or public.mail_lender_for(m.sender) is not null)
 )) where c.id=conversation;
end $$;

-- Derive rejection from the latest client reply, so delayed/backfilled mail
-- has the same result regardless of processing order.
create function public.gmail_apply_rejection(case_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare latest public.messages;process uuid;rejected uuid;
begin
 select msg.* into latest from public.messages msg join public.conversations c on c.id=msg.conversation_id
 join public.opportunities o on o.id=c.opportunity_id
 where o.id=case_id and msg.reply_intent in ('positive','negative') and msg.sent_at>='2026-10-13 05:00:00+00'
 and public.mail_human_reply(msg.direction,msg.nature,msg.sender) and not public.mail_is_team(msg.sender) and public.mail_lender_for(msg.sender) is null
 and exists(select 1 from public.contacts ct where ct.email=msg.sender and (ct.id=o.contact_id or exists(
  select 1 from public.company_contacts cc where cc.company_id=o.company_id and cc.contact_id=ct.id and cc.relationship in ('primary','contact'))))
 order by msg.sent_at desc,msg.id desc limit 1;
 if latest.reply_intent is distinct from 'negative' then return;end if;
 update public.opportunities o set stage='lost',mail_last_reply_at=latest.sent_at
 where o.id=case_id and o.stage<>'funded' and latest.sent_at>=coalesce(o.mail_last_reply_at,'-infinity') and (
 exists(select 1 from public.messages msg join public.conversations c on c.id=msg.conversation_id where c.opportunity_id=o.id and msg.reply_intent='positive' and msg.sent_at<=latest.sent_at
  and not public.mail_is_team(msg.sender) and public.mail_lender_for(msg.sender) is null
  and exists(select 1 from public.contacts ct where ct.email=msg.sender and (ct.id=o.contact_id or exists(select 1 from public.company_contacts cc where cc.company_id=o.company_id and cc.contact_id=ct.id and cc.relationship in ('primary','contact')))))
 or exists(select 1 from public.conversations c where c.opportunity_id=o.id and c.manually_incorporated_at<=latest.sent_at)) returning o.id into rejected;
 if rejected is not null then
  select process_id into process from public.conversations where id=latest.conversation_id;
  insert into public.case_events(opportunity_id,process_id,archive_message_id,kind,body,evidence_type,occurred_at,dedupe_key)
  values(rejected,process,latest.archive_message_id,'mail_rejection','Oportunidad perdida por rechazo explícito del cliente.','inference',latest.sent_at,'mail-rejection:'||rejected||':'||latest.id) on conflict do nothing;
 end if;
end $$;

create function public.gmail_message_engagement() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.gmail_refresh_inbox(new.conversation_id);
 if new.reply_intent in ('positive','negative') then
  perform public.gmail_apply_rejection((select opportunity_id from public.conversations where id=new.conversation_id));
 end if;
 return new;
end $$;
create trigger gmail_message_engagement after insert or update of reply_intent,nature,sender on public.messages
 for each row execute function public.gmail_message_engagement();

create function public.gmail_copy_reply_intent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.archive_message_id is not null then
  new.reply_intent:=(select reply_intent from public.gmail_archive_messages where id=new.archive_message_id);
 end if;
 return new;
end $$;
create trigger gmail_copy_reply_intent before insert or update of archive_message_id on public.messages
 for each row execute function public.gmail_copy_reply_intent();

-- Manual approval is a separate decision from automatic interest detection.
create function public.gmail_manual_engagement() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.import_requested_at is not null and old.import_requested_at is null then new.inbox_approved_at:=now();end if;
 return new;
end $$;
create trigger gmail_manual_engagement before update of import_requested_at on public.gmail_candidates
 for each row execute function public.gmail_manual_engagement();

-- Keep pending contacts current without creating commercial records for them.
create function public.gmail_refresh_participant(archive uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;a public.mail_accounts;r uuid;peer record;stats record;latest text;known uuid;
begin
 select * into m from public.gmail_archive_messages where id=archive;
 select * into a from public.mail_accounts where id=m.account_id;
 if a.owner_id is null then return;end if;
 perform pg_advisory_xact_lock(hashtextextended(a.id::text,64));
 select id into r from public.gmail_runs where account_id=a.id and is_live_directory;
 if r is null then
  insert into public.gmail_runs(account_id,purpose,status,phase,from_at,until_at,copy_since,created_by,is_live_directory)
  values(a.id,'continuous','review','preview','2025-10-13 05:00:00+00',now(),'2026-10-13 05:00:00+00',a.owner_id,true) returning id into r;
 end if;
 for peer in select distinct lower(btrim(p->>'email')) email,coalesce(p->>'name','') name from jsonb_array_elements(m.participants) p
  where p->>'role'=case when m.direction='inbound' then 'from' else 'to' end
 loop
  if peer.email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
   or peer.email ~* '^(mailer-daemon|postmaster|no[._-]?reply|do[._-]?not[._-]?reply|bounce(s)?([+._-][^@]*)?)@'
   or exists(select 1 from public.mail_accounts where email=peer.email) then continue;end if;
  select count(*)::int n,count(*) filter(where x.direction='inbound' and x.participants @> jsonb_build_array(jsonb_build_object('email',peer.email,'role','from')))::int inbound,
   count(*) filter(where x.direction='outbound')::int outbound,count(*) filter(where x.nature='campaign')::int campaigns,
   coalesce(sum(jsonb_array_length(x.attachment_index)),0)::int attachments,min(x.sent_at) first_at,max(x.sent_at) last_at,
   max(x.sent_at) filter(where x.direction='inbound' and x.participants @> jsonb_build_array(jsonb_build_object('email',peer.email,'role','from'))) received,
   array_agg(x.id order by x.sent_at desc,x.id) evidence
  into stats from public.gmail_archive_messages x where x.account_id=a.id and x.participants @> jsonb_build_array(jsonb_build_object('email',peer.email));
  select x.reply_intent into latest from public.gmail_archive_messages x where x.account_id=a.id and x.direction='inbound'
   and x.participants @> jsonb_build_array(jsonb_build_object('email',peer.email,'role','from')) order by x.sent_at desc,x.id desc limit 1;
  select id into known from public.contacts where email=peer.email;
  if not exists(select 1 from public.gmail_candidates c join public.gmail_runs gr on gr.id=c.run_id where gr.account_id=a.id and c.email=peer.email) then
   insert into public.gmail_candidates(run_id,email,name,message_count,inbound_count,outbound_count,campaign_count,attachment_count,copy_count,first_at,last_at,evidence_ids,participant_kind)
   values(r,peer.email,peer.name,stats.n,stats.inbound,stats.outbound,stats.campaigns,stats.attachments,0,stats.first_at,stats.last_at,stats.evidence,
    case when public.mail_is_team(peer.email) then 'team' when public.mail_lender_for(peer.email) is not null then 'lender' else 'unknown' end) on conflict do nothing;
  end if;
  update public.gmail_candidates c set message_count=stats.n,inbound_count=stats.inbound,outbound_count=stats.outbound,
   campaign_count=stats.campaigns,attachment_count=stats.attachments,first_at=stats.first_at,last_at=stats.last_at,
   last_received_at=stats.received,latest_reply_intent=latest,evidence_ids=stats.evidence,existing_contact_id=coalesce(c.existing_contact_id,known)
  from public.gmail_runs gr where gr.id=c.run_id and gr.account_id=a.id and c.email=peer.email;
  if m.direction='inbound' and m.nature='personal' and m.reply_intent is distinct from 'ignored'
   and (m.reply_intent='positive' or public.mail_is_team(peer.email) or public.mail_lender_for(peer.email) is not null) then
   update public.gmail_candidates c set imported_at=coalesce(c.imported_at,now()),result_opportunity_id=l.opportunity_id,selected_process_id=l.process_id
   from public.gmail_runs gr,public.gmail_thread_links l where gr.id=c.run_id and gr.account_id=a.id and c.email=peer.email
   and l.account_id=a.id and l.gmail_thread_id=m.gmail_thread_id;
  end if;
 end loop;
end $$;

create function public.gmail_record_reply(archive uuid,intent text) returns void language plpgsql security definer set search_path='' as $$
begin
 if intent is null or intent not in ('positive','negative','review','ignored') then raise exception 'Invalid reply intent';end if;
 update public.gmail_archive_messages set reply_intent=intent,reply_evaluated_at=now() where id=archive;
 update public.messages set reply_intent=intent where archive_message_id=archive and reply_intent is distinct from intent;
 perform public.gmail_refresh_participant(archive);
end $$;

-- Positive incoming evidence qualifies this opportunity, without changing the
-- address's verification status or enabling campaign delivery to an unverified lead.
do $$ declare definition text;begin
 select pg_get_functiondef('public.require_verified_opportunity()'::regprocedure) into definition;
 definition:=replace(definition,'begin', 'begin
 if new.mail_interest_message_id is not null and exists(
 select 1 from public.gmail_archive_messages m join public.contacts ct on ct.id=new.contact_id
 join public.mail_accounts a on a.id=m.account_id
 where m.id=new.mail_interest_message_id and m.reply_intent=''positive'' and m.direction=''inbound'' and m.nature=''personal''
 and m.sent_at>=''2026-10-13 05:00:00+00'' and a.status=''connected'' and a.owner_id=new.seller_id
 and m.participants @> jsonb_build_array(jsonb_build_object(''email'',ct.email,''role'',''from''))) then
 new.email_qualified_at:=(select sent_at from public.gmail_archive_messages where id=new.mail_interest_message_id);return new;end if;');
 execute definition;
end $$;

create or replace function public.gmail_associate_continuous(archive uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;a public.mail_accounts;link public.gmail_thread_links;ct public.contacts;o public.opportunities;
 sender text;display_name text;target uuid;company uuid;process uuid;matches uuid[];is_peer boolean;
begin
 select * into m from public.gmail_archive_messages where id=archive;
 select * into a from public.mail_accounts where id=m.account_id;
 if a.status<>'connected' or not a.live_enabled then return;end if;
 select lower(p->>'email'),p->>'name' into sender,display_name from jsonb_array_elements(m.participants) p where p->>'role'='from' limit 1;
 is_peer:=public.mail_is_team(sender) or public.mail_lender_for(sender) is not null;
 -- Serialize same-contact arrivals across mailboxes before choosing/creating a case.
 perform pg_advisory_xact_lock(hashtextextended(coalesce(sender,''),1));
 insert into public.gmail_thread_links(account_id,gmail_thread_id,opportunity_id,process_id,submission_id)
 select c.account_id,c.gmail_thread_id,c.opportunity_id,public.mail_process(c.opportunity_id,c.process_id),c.submission_id
 from public.conversations c where c.account_id=m.account_id and c.gmail_thread_id=m.gmail_thread_id on conflict do nothing;
 select * into link from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id for update;
 if link.opportunity_id is not null then
  select * into o from public.opportunities where id=link.opportunity_id;
  -- A later positive reply may start a new opportunity after closing the old one.
  if not (m.reply_intent='positive' and not is_peer and m.sent_at>='2026-10-13 05:00:00+00'
   and o.stage in ('funded','lost') and m.sent_at>coalesce(o.mail_closed_at,o.mail_last_reply_at,o.updated_at)) then return;end if;
 end if;
 if m.direction<>'inbound' or m.reply_intent='ignored' or not public.mail_human_reply(m.direction,m.nature,coalesce(sender,'')) then
  -- Sent messages can update an existing thread but never activate a new lead.
  insert into public.gmail_thread_links(account_id,gmail_thread_id,opportunity_id,process_id,submission_id)
  select c.account_id,c.gmail_thread_id,c.opportunity_id,public.mail_process(c.opportunity_id,c.process_id),c.submission_id
  from public.conversations c where c.account_id=m.account_id and c.gmail_thread_id=m.gmail_thread_id on conflict do nothing;
  return;
 end if;
 if is_peer then
  -- Team and lender senders cannot identify a customer by address. RFC reply
  -- relationships or one explicit client participant must identify the case.
  select array_agg(distinct c.opportunity_id) into matches from public.messages msg join public.conversations c on c.id=msg.conversation_id
   where msg.internet_message_id<>'' and position(msg.internet_message_id in coalesce(m.references_header,''))>0;
  if coalesce(cardinality(matches),0)=0 then
   select array_agg(distinct op.id) into matches from public.opportunities op join public.contacts contact on contact.id=op.contact_id
   where op.archived_at is null and op.stage not in ('funded','lost') and exists(select 1 from jsonb_array_elements(m.participants) p where p->>'email'=contact.email);
  end if;
  if cardinality(matches)=1 then target:=matches[1];end if;
 else
  if m.sent_at<'2026-10-13 05:00:00+00' then return;end if;
  select * into ct from public.contacts where email=sender;
  select array_agg(distinct op.id) into matches from public.opportunities op
   where op.archived_at is null and op.stage not in ('funded','lost') and
   (op.contact_id=ct.id or (ct.company_id is not null and op.company_id=ct.company_id) or exists(
    select 1 from public.company_contacts cc where cc.company_id=op.company_id and cc.contact_id=ct.id and cc.relationship in ('primary','contact')));
  if cardinality(matches)>1 then
   insert into public.mail_review(account_id,gmail_message_id,reason) values(m.account_id,m.gmail_message_id,'Interés confirmado: varias oportunidades abiertas; selecciona el expediente') on conflict do nothing;return;
  end if;
  target:=matches[1];
  if m.reply_intent is distinct from 'positive' then
   -- Once engaged, a customer's new thread remains attached even for an
   -- ambiguous response or rejection. It cannot create an opportunity.
   if target is null then
    select op.id into target from public.opportunities op where op.contact_id=ct.id and op.archived_at is null
     and exists(select 1 from public.conversations c where c.opportunity_id=op.id and c.inbox_activated_at is not null)
     order by op.created_at desc,op.id limit 1;
   end if;
   if target is null or not exists(select 1 from public.conversations c where c.opportunity_id=target and c.inbox_activated_at is not null) then return;end if;
  end if;
  if target is null then
   if a.owner_id is null or not exists(select 1 from public.profiles where id=a.owner_id and active and role in ('seller','seller_admin','superadmin')) then return;end if;
   company:=ct.company_id;
   if company is null then
    insert into public.companies(name) values('Por clasificar · '||sender) returning id into company;
   end if;
   if ct.id is null then
    insert into public.contacts(email,name,company_id) values(sender,coalesce(display_name,''),company) returning * into ct;
   end if;
   insert into public.company_contacts(company_id,contact_id,relationship) values(company,ct.id,'contact') on conflict do nothing;
   insert into public.opportunities(contact_id,company_id,company,seller_id,stage,primary_account_id,mail_interest_message_id,mail_last_reply_at,summary)
   select ct.id,company,co.name,a.owner_id,'replied',a.id,m.id,m.sent_at,'Interés recibido por correo. Clasificación comercial pendiente.' from public.companies co where co.id=company returning id into target;
   update public.leads set opportunity_id=target where contact_id=ct.id;
  elsif m.reply_intent='positive' then
   update public.opportunities set email_qualified_at=coalesce(email_qualified_at,m.sent_at),mail_interest_message_id=m.id,
    mail_last_reply_at=greatest(mail_last_reply_at,m.sent_at),stage=case when stage in ('new','contacting') then 'replied'::public.case_stage else stage end
   where id=target;
  end if;
 end if;
 if target is null then
  insert into public.mail_review(account_id,gmail_message_id,reason) values(m.account_id,m.gmail_message_id,'Respuesta humana: selecciona el expediente correspondiente') on conflict do nothing;return;
 end if;
 process:=public.mail_process(target,null);
 insert into public.gmail_thread_links(account_id,gmail_thread_id,opportunity_id,process_id)
 values(m.account_id,m.gmail_thread_id,target,process)
 on conflict(account_id,gmail_thread_id) do update set opportunity_id=excluded.opportunity_id,process_id=excluded.process_id,submission_id=null,source_candidate_id=null;
 update public.gmail_candidates c set imported_at=coalesce(c.imported_at,now()),result_opportunity_id=target,selected_process_id=process
 from public.gmail_runs r where r.id=c.run_id and r.account_id=m.account_id and c.email=sender;
 delete from public.mail_review where account_id=m.account_id and gmail_message_id=m.gmail_message_id;
 insert into public.jobs(kind,payload,dedupe_key) values('gmail_engagement_thread',jsonb_build_object('account_id',m.account_id,'thread_id',m.gmail_thread_id,'opportunity_id',target),'engagement-thread:'||m.account_id||':'||m.gmail_thread_id||':'||target) on conflict do nothing;
end $$;

-- Keep physical delivery IDs valid when a closed thread starts a new case.
create function public.gmail_case_thread(account uuid,thread text,case_id uuid) returns text language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.conversations where account_id=account and gmail_thread_id=thread and opportunity_id<>case_id)
 then thread||':case:'||case_id else thread end
$$;

-- Gmail confirms the physical thread ID. Record its accepted message in the
-- renewed case's internal conversation while keeping delivery IDs unchanged.
alter function public.mark_sent(uuid,text,text) rename to mark_sent_v23;
create function public.mark_sent(outbox_id uuid,gmail_id text,thread_id text) returns void language plpgsql security definer set search_path='' as $$
declare msg public.outbox;internal_thread text;
begin
 select * into msg from public.outbox where id=outbox_id for update;
 if msg.status='sent' then return;end if;
 internal_thread:=public.gmail_case_thread(msg.account_id,thread_id,msg.opportunity_id);
 perform public.mark_sent_v23(outbox_id,gmail_id,internal_thread);
 update public.outbox set gmail_thread_id=thread_id where id=outbox_id;
 update public.conversations set gmail_delivery_thread_id=thread_id where id=(select conversation_id from public.outbox where id=outbox_id);
end $$;
revoke all on function public.mark_sent_v23(uuid,text,text),public.mark_sent(uuid,text,text) from public,anon,authenticated;
grant execute on function public.mark_sent(uuid,text,text) to service_role;

alter function public.gmail_link_message(uuid,jsonb) rename to gmail_link_message_v23;
do $$ declare definition text;begin
 select pg_get_functiondef('public.gmail_link_message_v23(uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'m.account_id,m.gmail_thread_id,m.subject','m.account_id,public.gmail_case_thread(m.account_id,m.gmail_thread_id,o.id),m.subject');
 definition:=replace(definition,'select id into co from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id','select id into co from public.conversations where account_id=m.account_id and gmail_thread_id=public.gmail_case_thread(m.account_id,m.gmail_thread_id,o.id)');
 execute definition;
end $$;
create function public.gmail_link_message(archive_id uuid,snapshot jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;m public.gmail_archive_messages;link public.gmail_thread_links;approved timestamptz;
begin
 result:=public.gmail_link_message_v23(archive_id,snapshot);
 if result is null then return null;end if;
 select * into m from public.gmail_archive_messages where id=archive_id;
 select * into link from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 select inbox_approved_at into approved from public.gmail_candidates where id=link.source_candidate_id and participant_kind='client';
 update public.messages set reply_intent=m.reply_intent where id=result;
 update public.conversations set gmail_delivery_thread_id=m.gmail_thread_id,manually_incorporated_at=coalesce(manually_incorporated_at,approved)
 where id=(select conversation_id from public.messages where id=result);
 perform public.gmail_refresh_inbox((select conversation_id from public.messages where id=result));
 if m.reply_intent='positive' and m.sent_at>='2026-10-13 05:00:00+00' then
  update public.opportunities o set email_qualified_at=coalesce(email_qualified_at,m.sent_at),mail_interest_message_id=m.id,
   mail_last_reply_at=greatest(mail_last_reply_at,m.sent_at),stage=case when stage in ('new','contacting') then 'replied'::public.case_stage else stage end
  where o.id=link.opportunity_id and exists(select 1 from public.contacts ct where ct.id=o.contact_id
   and m.participants @> jsonb_build_array(jsonb_build_object('email',ct.email,'role','from')) and not public.mail_is_team(ct.email) and public.mail_lender_for(ct.email) is null);
  if found then
   insert into public.case_events(opportunity_id,process_id,archive_message_id,kind,body,evidence_type,occurred_at,dedupe_key)
   values(link.opportunity_id,link.process_id,m.id,'mail_interest','Respuesta con interés comercial; clasificación pendiente.','inference',m.sent_at,'mail-interest:'||link.opportunity_id||':'||m.id) on conflict do nothing;
  end if;
 end if;
 perform public.gmail_apply_rejection(link.opportunity_id);
 return result;
end $$;

-- New analyses also inherit receipt dates from live mail received while scanning.
alter function public.gmail_build_preview(uuid,uuid) rename to gmail_build_preview_v23;
create function public.gmail_build_preview(run uuid,lease uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.gmail_build_preview_v23(run,lease);
 update public.gmail_candidates c set last_received_at=(select max(m.sent_at) from public.gmail_archive_messages m
  where m.account_id=r.account_id and m.direction='inbound' and m.participants @> jsonb_build_array(jsonb_build_object('email',c.email,'role','from'))),
  latest_reply_intent=(select m.reply_intent from public.gmail_archive_messages m where m.account_id=r.account_id and m.direction='inbound'
   and m.participants @> jsonb_build_array(jsonb_build_object('email',c.email,'role','from')) order by m.sent_at desc,m.id desc limit 1)
 from public.gmail_runs r where r.id=run and c.run_id=r.id;
end $$;

alter function public.associate_live_mail(uuid,uuid,uuid,uuid) rename to associate_live_mail_v23;
create function public.associate_live_mail(review uuid,case_id uuid,process uuid,submission uuid) returns void language plpgsql security definer set search_path='' as $$
declare source public.mail_review;
begin
 select * into source from public.mail_review where id=review;
 perform public.associate_live_mail_v23(review,case_id,process,submission);
 update public.conversations c set manually_incorporated_at=now() from public.gmail_archive_messages m
 where m.account_id=source.account_id and m.gmail_message_id=source.gmail_message_id and c.account_id=m.account_id and c.gmail_thread_id=m.gmail_thread_id and c.opportunity_id=case_id
 and exists(select 1 from jsonb_array_elements(m.participants) p where p->>'role'='from' and not public.mail_is_team(p->>'email') and public.mail_lender_for(p->>'email') is null);
 perform public.gmail_refresh_inbox(c.id) from public.conversations c where c.opportunity_id=case_id;
end $$;
revoke all on function public.gmail_build_preview_v23(uuid,uuid),public.gmail_build_preview(uuid,uuid),public.associate_live_mail_v23(uuid,uuid,uuid,uuid),public.associate_live_mail(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_build_preview(uuid,uuid) to service_role;
grant execute on function public.associate_live_mail(uuid,uuid,uuid,uuid) to authenticated,service_role;

-- Previously incorporated history can contain ambiguous wording too. Allow a
-- reviewed positive decision without reimporting or duplicating its opportunity.
create function public.gmail_approve_interest(candidate uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare person public.gmail_candidates;conversation record;
begin
 if not exists(select 1 from public.profiles where id=actor and role='superadmin' and active) then raise exception 'Superadmin required';end if;
 select * into person from public.gmail_candidates where id=candidate and imported_at is not null for update;
 if person.id is null or person.result_opportunity_id is null or person.participant_kind not in ('client','unknown')
  or public.mail_is_team(person.email) or public.mail_lender_for(person.email) is not null then raise exception 'Choose an incorporated client';end if;
 if not exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id
  join public.opportunities o on o.id=c.opportunity_id where o.id=person.result_opportunity_id and o.archived_at is null
  and m.sender=person.email and public.mail_human_reply(m.direction,m.nature,m.sender) and m.reply_intent is distinct from 'ignored') then raise exception 'Human reply evidence required';end if;
 update public.gmail_candidates set inbox_approved_at=coalesce(inbox_approved_at,now()) where id=person.id;
 for conversation in select distinct c.id from public.conversations c join public.messages m on m.conversation_id=c.id
  where c.opportunity_id=person.result_opportunity_id and m.sender=person.email and public.mail_human_reply(m.direction,m.nature,m.sender) and m.reply_intent is distinct from 'ignored'
 loop
  update public.conversations set manually_incorporated_at=coalesce(manually_incorporated_at,now()) where id=conversation.id;
  perform public.gmail_refresh_inbox(conversation.id);
 end loop;
 insert into public.case_events(opportunity_id,kind,body,evidence_type,occurred_at,actor_id,dedupe_key)
 values(person.result_opportunity_id,'manual_interest','Interés comercial confirmado al revisar el historial.','manual',now(),actor,'manual-interest:'||person.id) on conflict do nothing;
end $$;
revoke all on function public.gmail_approve_interest(uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_approve_interest(uuid,uuid) to service_role;

do $$ declare definition text;begin
 select pg_get_functiondef('public.queue_mail_email(uuid,uuid,text,text,text,uuid[],uuid[],uuid[],text[],text[],uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 execute replace(definition,'then c.gmail_thread_id else null end','then coalesce(c.gmail_delivery_thread_id,c.gmail_thread_id) else null end');
 select pg_get_functiondef('public.gmail_track_live_wait(uuid)'::regprocedure) into definition;
 execute replace(definition,'where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;',
  'where account_id=m.account_id and (gmail_thread_id=m.gmail_thread_id or gmail_delivery_thread_id=m.gmail_thread_id) and opportunity_id=(select opportunity_id from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id);');
end $$;

-- Existing records are retained. The inbox exposes only activated conversations.
create or replace view public.opportunity_inbox with(security_invoker=true) as
 select o.* from public.opportunity_workspace o where exists(select 1 from public.conversations c where c.opportunity_id=o.id and c.inbox_activated_at is not null);

-- Ambiguous leads remain in Configuration. The unassigned conversation inbox
-- contains positive replies or human team/lender replies needing a case link.
do $$ declare definition text;begin
 select pg_get_functiondef('public.mail_pending_threads(integer)'::regprocedure) into definition;
 execute replace(definition,'where r.status=''pending'' and',
  'where r.status=''pending'' and m.direction=''inbound'' and m.nature=''personal'' and m.reply_intent is distinct from ''ignored''
  and exists(select 1 from jsonb_array_elements(m.participants) p where p->>''role''=''from''
   and public.mail_human_reply(m.direction,m.nature,p->>''email'')
   and (m.reply_intent=''positive'' or public.mail_is_team(p->>''email'') or public.mail_lender_for(p->>''email'') is not null)) and');
end $$;

update public.gmail_candidates c set last_received_at=(select max(m.sent_at) from public.gmail_archive_messages m join public.gmail_runs r on r.account_id=m.account_id
 where r.id=c.run_id and m.direction='inbound' and m.participants @> jsonb_build_array(jsonb_build_object('email',c.email,'role','from')));

-- One contact row per mailbox across historical analyses and live synchronization.
create view public.gmail_candidate_directory with(security_invoker=true) as
 select distinct on(r.account_id,c.email) c.*,r.account_id,r.status run_status from public.gmail_candidates c join public.gmail_runs r on r.id=c.run_id
 order by r.account_id,c.email,c.imported_at desc nulls last,c.import_requested_at desc nulls last,c.selected desc,r.created_at,c.id;
grant select on public.gmail_candidate_directory to authenticated,service_role;

-- A durable worker pass decrypts and classifies existing evidence locally.
insert into public.jobs(kind,payload,dedupe_key) values('gmail_engagement_reconcile','{"phase":"archive"}','engagement-reconcile:024');

revoke all on function public.mail_human_reply(text,text,text),public.gmail_apply_rejection(uuid),public.gmail_refresh_inbox(uuid),public.gmail_message_engagement(),public.gmail_copy_reply_intent(),public.gmail_manual_engagement(),public.gmail_refresh_participant(uuid),public.gmail_record_reply(uuid,text),public.gmail_case_thread(uuid,text,uuid),public.gmail_link_message_v23(uuid,jsonb),public.gmail_link_message(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mail_human_reply(text,text,text),public.gmail_refresh_inbox(uuid),public.gmail_refresh_participant(uuid),public.gmail_record_reply(uuid,text),public.gmail_case_thread(uuid,text,uuid),public.gmail_link_message(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
