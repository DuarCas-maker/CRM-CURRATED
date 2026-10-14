begin;

-- Additive directory metadata; original Gmail messages/conversations are retained.
alter table public.lender_contacts add column name text not null default '' check(length(name)<=150);
create index lender_contact_domain on public.lender_contacts ((split_part(email,'@',2)));

create function public.mail_company_domain(address text) returns text language sql immutable set search_path='' as $$
 select case when lower(btrim(address)) ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
 and split_part(lower(btrim(address)),'@',2) not in
 ('gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com','ymail.com','aol.com','icloud.com','me.com','proton.me','protonmail.com','mail.com','gmx.com','yahoo.es')
 then split_part(lower(btrim(address)),'@',2) end
$$;

create function public.mail_is_team(address text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.mail_accounts where email=lower(btrim(address)))
 or exists(select 1 from public.gmail_team_members where email=lower(btrim(address)))
 or exists(select 1 from public.profiles where email=lower(btrim(address)))
$$;

create function public.mail_lender_for(address text) returns uuid language sql stable security definer set search_path='' as $$
 select case when public.mail_is_team(address) then null else coalesce(
 (select c.lender_id from public.lender_contacts c join public.lenders l on l.id=c.lender_id where c.email=lower(btrim(address)) and l.archived_at is null),
 (select min(c.lender_id::text)::uuid from public.lender_contacts c join public.lenders l on l.id=c.lender_id
 where split_part(c.email,'@',2)=public.mail_company_domain(address) and l.archived_at is null having count(distinct c.lender_id)=1)) end
$$;

-- Only a case-linked lender exchange can create provisional companies. Unknown
-- independent customer/team mail stays in review, and public mailbox domains are never companies.
create function public.mail_index_lender_message(message uuid,provisionals boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare m public.messages;c public.conversations;peer record;firm uuid;domain text;borrower text;is_lender_exchange boolean;
begin
 select * into m from public.messages where id=message;
 select * into c from public.conversations where id=m.conversation_id;
 if c.id is null then return;end if;
 select ct.email into borrower from public.opportunities o join public.contacts ct on ct.id=o.contact_id where o.id=c.opportunity_id;
 is_lender_exchange:=c.submission_id is not null or exists(select 1 from public.conversation_lenders where conversation_id=c.id);
 for peer in
  select lower(m.sender) email,coalesce((select p->>'name' from jsonb_array_elements(m.participants) p where p->>'role'='from' limit 1),'') name
  where m.direction='inbound' and not public.mail_is_team(m.sender)
  union
  select lower(p->>'email'),coalesce(p->>'name','') from jsonb_array_elements(m.participants) p
  where (m.direction='outbound' or public.mail_is_team(m.sender)) and p->>'role' in ('to','cc','bcc')
 loop
  if peer.email=borrower or public.mail_is_team(peer.email) or exists(
   select 1 from public.opportunities o join public.company_contacts cc on cc.company_id=o.company_id join public.contacts ct on ct.id=cc.contact_id
   where o.id=c.opportunity_id and ct.email=peer.email and cc.relationship in ('primary','contact','broker')) then continue;end if;
  firm:=public.mail_lender_for(peer.email);domain:=public.mail_company_domain(peer.email);
  if firm is null and provisionals and is_lender_exchange and domain is not null
   and not exists(select 1 from public.contacts where email=peer.email)
   and not exists(select 1 from public.lender_contacts where split_part(email,'@',2)=domain)
   and coalesce(m.nature,'personal')='personal' then
   perform pg_advisory_xact_lock(hashtextextended(domain,72));
   firm:=public.mail_lender_for(peer.email);
   if firm is null and not exists(select 1 from public.lender_contacts where split_part(email,'@',2)=domain) then
    insert into public.lenders(name,email,channel,notes) values('Por confirmar · '||domain,peer.email,'email','[Provisional] Identificado automáticamente por dominio en una conversación con lenders. Confirmar nombre de empresa.') returning id into firm;
    insert into public.audit_log(entity_type,entity_id,action,metadata) values('lender',firm,'company_domain_detected',jsonb_build_object('domain',domain,'conversation_id',c.id));
   end if;
  end if;
  if firm is not null then
   insert into public.lender_contacts(email,lender_id,name) values(peer.email,firm,left(peer.name,150))
   on conflict(email) do update set name=case when public.lender_contacts.name='' then excluded.name else public.lender_contacts.name end
   where public.lender_contacts.lender_id=excluded.lender_id;
   insert into public.conversation_lenders values(c.id,firm) on conflict do nothing;
  end if;
 end loop;
end $$;

create or replace function public.mail_index_lenders() returns trigger language plpgsql security definer set search_path='' as $$
declare had_routes boolean;previous record;
begin
 had_routes:=exists(select 1 from public.conversation_lenders where conversation_id=new.conversation_id);
 insert into public.conversation_lenders select new.conversation_id,s.lender_id from public.conversations c join public.submissions s on s.id=c.submission_id where c.id=new.conversation_id on conflict do nothing;
 perform public.mail_index_lender_message(new.id,false);
 perform public.mail_index_lender_message(new.id,true);
 if not had_routes and exists(select 1 from public.conversation_lenders where conversation_id=new.conversation_id) then
  for previous in select id from public.messages where conversation_id=new.conversation_id and id<>new.id loop
   perform public.mail_index_lender_message(previous.id,true);
  end loop;
 end if;
 return new;
end $$;

-- The case contact action already checks assigned-team access; retain that check
-- and persist the supplied lender contact name instead of discarding it.
do $$ declare definition text;begin
 select pg_get_functiondef('public.register_mail_contact(uuid,text,text,uuid)'::regprocedure) into definition;
 definition:=replace(definition,
 'insert into public.lender_contacts(email,lender_id,created_by) values(address,lender,auth.uid()) on conflict do nothing;',
 'insert into public.lender_contacts(email,lender_id,created_by,name) values(address,lender,auth.uid(),coalesce(display_name,'''')) on conflict(email) do update set name=excluded.name where public.lender_contacts.lender_id=excluded.lender_id;');
 execute definition;
end $$;
drop trigger mail_channel_index on public.messages;
create trigger mail_channel_index after insert or update of participants,sender on public.messages for each row execute function public.mail_index_lenders();

-- Approved customer-provided directory: 32 companies, 55 distinct addresses.
do $$
declare row record;firm uuid;matches uuid[];
begin
 for row in select * from (values
 ('Fox Business Funding','Underwriting','underwriting@foxbusinessfunding.com'),
 ('Fox Business Funding','Avner','avner@foxbusinessfunding.com'),
 ('Rowan Advance','Deals','deals@rowanadvance.com'),
 ('Simply Funding','Ryan C.','ryanc@simplyfunding.com'),
 ('Simply Funding','Submissions','submissions@simplyfunding.com'),
 ('Biz Fund','S. Anz','s.anz@bizfund.com'),
 ('Forward Financing','Submissions','submissions@forwardfinancing.com'),
 ('Purple Tree Funding','Submissions','submissions@purpletreefunding.com'),
 ('Fenix Capital Funding','New Deals','newdeals@fenixcapitalfunding.com'),
 ('Fenix Capital Funding','John','john@fenixcapitalfunding.com'),
 ('Biz Cap Funding','Submissions','submissions@bizcapfunding.com'),
 ('Biz Cap Funding','Ari','ari@bizcapfunding.com'),
 ('Velocity CG','Subs','subs@velocitycg.com'),
 ('Velocity CG','Robert','robert@velocitycg.com'),
 ('E Financial Tree','Craig','craig@efinancialtree.com'),
 ('E Financial Tree','Submissions','submissions@efinancialtree.com'),
 ('TVT Capital','A. Fellus','afellus@tvtcapital.com'),
 ('TVT Capital','Marcia','marcia@tvtcapital.com'),
 ('TVT Capital','Parul','parul@tvtcapital.com'),
 ('Immediate Advances','Subs','subs@immediateadvances.com'),
 ('Immediate Advances','Brandon','brandon@immediateadvances.com'),
 ('Diesel Funding','Daniel','daniel@dieselfunding.com'),
 ('Diesel Funding','Submissions','submissions@dieselfunding.com'),
 ('Clear Fund','Deals','deals@clearfund.co'),
 ('Clear Fund','Dave','dave@clearfund.co'),
 ('Capitalize Group','Ben','ben@capitalizegroup.com'),
 ('Capitalize Group','Subs','subs@capitalizegroup.com'),
 ('Lifetime Funding LLC','New Deals','newdeals@lifetimefundingllc.com'),
 ('Lifetime Funding LLC','Abe','abe@lifetimefundingllc.com'),
 ('Kapfi','Subs','subs@kapfi.co'),
 ('Kapfi','Abe','abe@kapfi.co'),
 ('Aspire Funding Platform','Submissions','submissions@aspirefundingplatform.com'),
 ('Fundfi Merchant Funding','Submissions','submissions@fundfimerchantfunding.com'),
 ('Fundfi Merchant Funding','Jordan','jordan@fundfimerchantfunding.com'),
 ('Smart Business Funder','Submit','submit@smartbusinessfunder.com'),
 ('Smart Business Funder','Anthony','anthony@smartbusinessfunder.com'),
 ('Logic Advance Group','Submissions','submissions@logicadvancegroup.com'),
 ('Logic Advance Group','Erik','erik@logicadvancegroup.com'),
 ('Fund Pro LLC','Brandon','brandon@fundprollc.com'),
 ('Fund Pro LLC','New Deals','newdeals@fundprollc.com'),
 ('Mint Funding','Deals','deals@mintfunding.com'),
 ('Mint Funding','Alex','alex@mintfunding.com'),
 ('First Line Advance','Subs','subs@firstlineadvance.com'),
 ('Meged Funding','Submissions','submissions@megedfunding.com'),
 ('Meged Funding','Marc','marc@megedfunding.com'),
 ('Seamless Capital Group','Subs','subs@seamlesscapitalgroup.com'),
 ('MCA Deals','Deals','deals@mcadeals.com'),
 ('Cflow Capital','Submissions','submissions@cflowcapital.com'),
 ('Cobalt Funding','Stephanie','stephanie@cobaltfunding.com'),
 ('Cobalt Funding','Deals','deals@cobaltfunding.com'),
 ('Pathway Funding','Subs','subs@pathwayfunding.com'),
 ('Cedar Advance','Levi','levi@cedaradvance.com'),
 ('Cedar Advance','Funding','funding@cedaradvance.com'),
 ('Wynwood Capital Group','Josh','josh@wynwoodcapitalgroup.com'),
 ('Wynwood Capital Group','Submissions','submissions@wynwoodcapitalgroup.com')
 ) seed(company,contact,email) loop
  select array_agg(distinct id) into matches from public.lenders l where
   lower(btrim(l.name))=lower(row.company) or public.mail_company_domain(l.email)=public.mail_company_domain(row.email)
   or exists(select 1 from public.lender_contacts ct where ct.lender_id=l.id and split_part(ct.email,'@',2)=public.mail_company_domain(row.email));
  if cardinality(matches)>1 then raise exception 'Directory conflict for company %. Review existing companies before importing.',row.company;end if;
  firm:=matches[1];
  if firm is null then
   insert into public.lenders(name,email,channel) values(row.company,row.email,'email') returning id into firm;
  elsif exists(select 1 from public.lenders where id=firm and archived_at is not null) then
   raise exception 'Directory company % is archived. Review before importing.',row.company;
  else
   update public.lenders set name=row.company,notes='' where id=firm and notes like '[Provisional]%';
  end if;
  if public.mail_is_team(row.email) or exists(select 1 from public.lender_contacts where email=row.email and lender_id<>firm) then raise exception 'Directory email conflict for %',row.company;end if;
  insert into public.lender_contacts(email,lender_id,name) values(row.email,firm,row.contact)
  on conflict(email) do update set name=excluded.name where public.lender_contacts.lender_id=excluded.lender_id;
 end loop;
end $$;

-- Reclassify all imported history without rewriting/deleting any email evidence.
do $$ declare row record;begin
 for row in select id from public.messages order by sent_at,id loop perform public.mail_index_lender_message(row.id,false);end loop;
 for row in select id from public.messages order by sent_at,id loop perform public.mail_index_lender_message(row.id,true);end loop;
end $$;

create function public.register_named_lender_contact(lender uuid,address text,display_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if display_name is null or length(display_name)>150 then raise exception 'Invalid contact name';end if;
 perform public.register_lender_contact(lender,address);
 update public.lender_contacts set name=btrim(display_name) where email=lower(btrim(address)) and lender_id=lender;
end $$;

-- Preserve the existing mail queue contract and all its access/attachment checks.
-- For mixed Gmail threads, a reply must not inherit another company's evaluation.
do $$ declare definition text;begin
 select pg_get_functiondef('public.queue_mail_email(uuid,uuid,text,text,text,uuid[],uuid[],uuid[],text[],text[],uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'submission:=coalesce(submission,c.submission_id);',
 'submission:=coalesce(submission,case when public.mail_lender_for(recipient) is null or exists(select 1 from public.submissions s where s.id=c.submission_id and s.lender_id=public.mail_lender_for(recipient)) then c.submission_id end);');
 execute definition;
end $$;

create function public.queue_lender_reply(input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.conversations;m public.messages;firm uuid:=(input->>'lender')::uuid;case_id uuid:=(input->>'case_id')::uuid;submission uuid:=(input->>'submission')::uuid;copies text[];result uuid;
begin
 if not coalesce(public.can_mail_case(case_id),false) then raise exception 'Case access required';end if;
 select * into c from public.conversations where id=(input->>'conversation')::uuid and opportunity_id=case_id;
 select * into m from public.messages where id=(input->>'reply_message')::uuid and conversation_id=c.id;
 if c.id is null or m.id is null or firm is null then raise exception 'Choose a message in the lender conversation';end if;
 if m.direction='inbound' and not public.mail_is_team(m.sender) then
  if public.mail_lender_for(m.sender) is distinct from firm then raise exception 'Reply must belong to the selected company';end if;
 elsif not exists(select 1 from jsonb_array_elements(m.participants) p where p->>'role' in ('to','cc','bcc') and public.mail_lender_for(p->>'email')=firm)
  and not (m.participants='[]'::jsonb and exists(select 1 from public.submissions s where s.id=c.submission_id and s.lender_id=firm)) then
  raise exception 'Choose an original message addressed to this company';
 end if;
 if public.mail_lender_for(input->>'recipient') is distinct from firm then raise exception 'Recipient must belong to the selected lender';end if;
 copies:=array(select jsonb_array_elements_text(coalesce(input->'copies','[]')))||array(select jsonb_array_elements_text(coalesce(input->'hidden_copies','[]')));
 if exists(select 1 from public.opportunities o join public.contacts ct on ct.id=o.contact_id where o.id=case_id and ct.email=any(array[lower(input->>'recipient')]||copies))
 or exists(select 1 from public.opportunities o join public.company_contacts cc on cc.company_id=o.company_id join public.contacts ct on ct.id=cc.contact_id where o.id=case_id and cc.relationship in ('primary','contact','broker') and ct.email=any(array[lower(input->>'recipient')]||copies)) then raise exception 'Customer recipients cannot be included in this lender reply';end if;
 if exists(select 1 from unnest(copies) e where not public.mail_is_team(e) and public.mail_lender_for(e) is distinct from firm) then raise exception 'Copies cannot include another lender or the customer';end if;
 if submission is not null and not exists(select 1 from public.submissions s where s.id=submission and s.lender_id=firm and s.opportunity_id=case_id and s.process_id is not distinct from c.process_id) then raise exception 'Evaluation belongs to another company or process';end if;
 result:=public.queue_mail_email(case_id,(input->>'account')::uuid,input->>'recipient',c.subject,input->>'body_text',
  array(select jsonb_array_elements_text(input->'files')::uuid),array(select jsonb_array_elements_text(input->'gmail_files')::uuid),array(select jsonb_array_elements_text(input->'uploads')::uuid),
  array(select jsonb_array_elements_text(input->'copies')),array(select jsonb_array_elements_text(input->'hidden_copies')),
  c.process_id,c.id,m.id,submission,input->>'signature',input->>'display_name',(input->>'request')::uuid);
 return result;
end $$;

revoke all on function public.mail_company_domain(text),public.mail_is_team(text),public.mail_lender_for(text),public.mail_index_lender_message(uuid,boolean),public.register_named_lender_contact(uuid,text,text),public.queue_lender_reply(jsonb) from public,anon,authenticated;
grant execute on function public.register_named_lender_contact(uuid,text,text),public.queue_lender_reply(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
