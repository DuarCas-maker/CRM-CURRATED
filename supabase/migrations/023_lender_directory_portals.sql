begin;

-- Portal lenders keep email blank when no address was supplied. No fictitious
-- email or financial eligibility/product data is created.
create or replace function public.lender_primary_contact() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if btrim(new.email)='' then
  if new.channel<>'portal' then raise exception 'Email required for email channel';end if;
  return new;
 end if;
 if lower(btrim(new.email)) like '%@curatedfinancial.com' or public.mail_is_team(new.email) then raise exception 'Internal address cannot be a lender';end if;
 if exists(select 1 from public.lender_contacts where email=lower(btrim(new.email)) and lender_id<>new.id) then raise exception 'Lender email already belongs to another lender';end if;
 insert into public.lender_contacts(email,lender_id) values(lower(btrim(new.email)),new.id) on conflict do nothing;
 return new;
end $$;
create function public.validate_lender_directory() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.email:=lower(btrim(new.email));new.name:=btrim(new.name);new.products:=array_remove(new.products,'');
 if length(new.name) not between 1 and 200 then raise exception 'Lender name required';end if;
 if new.email<>'' and (length(new.email)>254 or new.email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$') then raise exception 'Invalid lender email';end if;
 if new.email='' and (new.channel<>'portal' or new.notes !~ 'https://[^[:space:]<>]+') then raise exception 'Portal URL required when no email is supplied';end if;
 if new.archived_at is null and new.email like '%@curatedfinancial.com' then raise exception 'Internal address cannot be a lender';end if;
 return new;
end $$;
create trigger lender_directory_validation before insert or update of name,email,channel,products,notes on public.lenders for each row execute function public.validate_lender_directory();

-- Prevent Ricardo and other Curated addresses from being inferred as lenders.
do $$ declare definition text;begin
 select pg_get_functiondef('public.mail_company_domain(text)'::regprocedure) into definition;
 execute replace(definition,'''gmail.com'',''googlemail.com''','''curatedfinancial.com'',''gmail.com'',''googlemail.com''');
 select pg_get_functiondef('public.mail_lender_for(text)'::regprocedure) into definition;
 execute replace(definition,'public.mail_is_team(address)','(public.mail_is_team(address) or lower(btrim(address)) like ''%@curatedfinancial.com'')');
end $$;
create function public.validate_lender_contact_address() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email like '%@curatedfinancial.com' or public.mail_is_team(new.email) then raise exception 'Internal address cannot be a lender contact';end if;
 if new.email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then raise exception 'Valid contact email required';end if;
 return new;
end $$;
create trigger lender_contact_address_validation before insert or update of email,lender_id on public.lender_contacts for each row execute function public.validate_lender_contact_address();

-- Exclude the misclassified identity, retaining emails and the recoverable lender record.
do $$ declare wrong public.lenders;begin
 for wrong in select l.* from public.lenders l where l.email='ricardo@curatedfinancial.com' and l.notes like '[Provisional]%' loop
  insert into public.audit_log(entity_type,entity_id,action,metadata) values('lender',wrong.id,'excluded_internal_identity',jsonb_build_object('before',to_jsonb(wrong),'contacts',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.lender_contacts c where c.lender_id=wrong.id),'routes',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.conversation_lenders r where r.lender_id=wrong.id)));
  update public.lenders set archived_at=coalesce(archived_at,now()) where id=wrong.id;
  delete from public.conversation_lenders where lender_id=wrong.id;
 end loop;
 delete from public.lender_contacts where email='ricardo@curatedfinancial.com';
end $$;

-- User confirmed Funding Futures and the MCA Deals address are one company.
-- Keep the existing canonical ID and all commercial/history/message records.
do $$ declare canonical uuid;other public.lenders;begin
 select c.lender_id into canonical from public.lender_contacts c where c.email='deals@mcadeals.com';
 if canonical is not null then
  for other in select l.* from public.lenders l where l.id<>canonical and l.notes like '[Provisional]%' and split_part(l.email,'@',2)='fundingfutures.biz' and l.archived_at is null loop
   insert into public.audit_log(entity_type,entity_id,action,metadata) values('lender',other.id,'directory_alias_merged',jsonb_build_object('canonical_id',canonical,'before',to_jsonb(other),'contacts',(select coalesce(jsonb_agg(to_jsonb(ct)),'[]') from public.lender_contacts ct where ct.lender_id=other.id),'routes',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.conversation_lenders r where r.lender_id=other.id),'submissions',(select coalesce(jsonb_agg(s.id),'[]') from public.submissions s where s.lender_id=other.id)));
   update public.submissions set lender_id=canonical where lender_id=other.id;
   update public.opportunities set funded_lender_id=canonical where funded_lender_id=other.id;
   update public.financing_processes set funded_lender_id=canonical where funded_lender_id=other.id;
   insert into public.conversation_lenders select conversation_id,canonical from public.conversation_lenders where lender_id=other.id on conflict do nothing;
   delete from public.conversation_lenders where lender_id=other.id;
   update public.lender_contacts set lender_id=canonical where lender_id=other.id;
   update public.lenders set archived_at=now() where id=other.id;
  end loop;
  update public.lenders set name='Funding Futures',notes=case when notes like '%Alias confirmado: MCA Deals%' then notes else notes||E'\nAlias confirmado: MCA Deals' end where id=canonical;
 end if;
end $$;

-- Full source directory is included so clean installations and upgrades converge.
-- Real existing names/notes/products are retained; unspecified contact names are not erased.
do $directory$
declare seeds jsonb:=$contacts$[
  {
    "company": "Loan Stacking",
    "contact": "",
    "email": "",
    "portal_url": "https://preferredfundinggroup.wufoo.com/forms/m1rchv1i1jx57fb/"
  },
  {
    "company": "Venture Growth Capital (VGC)",
    "contact": "Tim",
    "email": "tim@venturegrowthcapital.com",
    "portal_url": ""
  },
  {
    "company": "Wayflyer",
    "contact": "Jodie Jarosik",
    "email": "jodie.jarosik@wayflyer.com",
    "portal_url": ""
  },
  {
    "company": "Libertas",
    "contact": "",
    "email": "submissions@libertasfunding.com",
    "portal_url": ""
  },
  {
    "company": "Libertas",
    "contact": "Billy Rosenberg",
    "email": "billy.rosenberg@libertasfunding.com",
    "portal_url": ""
  },
  {
    "company": "Idea",
    "contact": "",
    "email": "",
    "portal_url": "https://partner.ideafinancial.us/sign-in"
  },
  {
    "company": "IOU",
    "contact": "Alex",
    "email": "alex@ioufinancial.com",
    "portal_url": ""
  },
  {
    "company": "Backd",
    "contact": "Maria",
    "email": "maria@backd.com",
    "portal_url": ""
  },
  {
    "company": "Backd",
    "contact": "Chad",
    "email": "chad@backd.com",
    "portal_url": ""
  },
  {
    "company": "Backd",
    "contact": "",
    "email": "submissions@backd.com",
    "portal_url": ""
  },
  {
    "company": "Itria",
    "contact": "Aaron Smith",
    "email": "aaron.smith@biz2credit.com",
    "portal_url": ""
  },
  {
    "company": "Itria",
    "contact": "Mitchell",
    "email": "mitchell@bellprocessingsolutions.com",
    "portal_url": ""
  },
  {
    "company": "Rapid",
    "contact": "",
    "email": "",
    "portal_url": "https://portal.rapidfinance.com/Partner/SubmitNewDeal"
  },
  {
    "company": "Lendini",
    "contact": "",
    "email": "submissions@lendini.com",
    "portal_url": ""
  },
  {
    "company": "Lendini",
    "contact": "Melissa Fernandez",
    "email": "melissa.fernandez@lendini.com",
    "portal_url": ""
  },
  {
    "company": "Fox",
    "contact": "",
    "email": "underwriting@foxbusinessfunding.com",
    "portal_url": ""
  },
  {
    "company": "Fox",
    "contact": "Avner",
    "email": "avner@foxbusinessfunding.com",
    "portal_url": ""
  },
  {
    "company": "Rowan",
    "contact": "",
    "email": "deals@rowanadvance.com",
    "portal_url": ""
  },
  {
    "company": "Simply",
    "contact": "Ryan C.",
    "email": "ryanc@simplyfunding.com",
    "portal_url": ""
  },
  {
    "company": "Simply",
    "contact": "",
    "email": "submissions@simplyfunding.com",
    "portal_url": ""
  },
  {
    "company": "Bizfund",
    "contact": "S. Anz",
    "email": "s.anz@bizfund.com",
    "portal_url": ""
  },
  {
    "company": "Forward Finance",
    "contact": "",
    "email": "submissions@forwardfinancing.com",
    "portal_url": ""
  },
  {
    "company": "Purple Tree Funding",
    "contact": "",
    "email": "submissions@purpletreefunding.com",
    "portal_url": ""
  },
  {
    "company": "Fenix",
    "contact": "",
    "email": "newdeals@fenixcapitalfunding.com",
    "portal_url": ""
  },
  {
    "company": "Fenix",
    "contact": "John",
    "email": "john@fenixcapitalfunding.com",
    "portal_url": ""
  },
  {
    "company": "Bizcap",
    "contact": "",
    "email": "submissions@bizcapfunding.com",
    "portal_url": ""
  },
  {
    "company": "Bizcap",
    "contact": "Ari",
    "email": "ari@bizcapfunding.com",
    "portal_url": ""
  },
  {
    "company": "VCG",
    "contact": "",
    "email": "subs@velocitycg.com",
    "portal_url": ""
  },
  {
    "company": "VCG",
    "contact": "Robert",
    "email": "robert@velocitycg.com",
    "portal_url": ""
  },
  {
    "company": "EFinancial",
    "contact": "Craig",
    "email": "craig@efinancialtree.com",
    "portal_url": ""
  },
  {
    "company": "EFinancial",
    "contact": "",
    "email": "submissions@efinancialtree.com",
    "portal_url": ""
  },
  {
    "company": "TVT",
    "contact": "A. Fellus",
    "email": "afellus@tvtcapital.com",
    "portal_url": ""
  },
  {
    "company": "TVT",
    "contact": "Marcia",
    "email": "marcia@tvtcapital.com",
    "portal_url": ""
  },
  {
    "company": "TVT",
    "contact": "Parul",
    "email": "parul@tvtcapital.com",
    "portal_url": ""
  },
  {
    "company": "Immediate",
    "contact": "",
    "email": "subs@immediateadvances.com",
    "portal_url": ""
  },
  {
    "company": "Immediate",
    "contact": "Brandon",
    "email": "brandon@immediateadvances.com",
    "portal_url": ""
  },
  {
    "company": "Diesel",
    "contact": "Daniel",
    "email": "daniel@dieselfunding.com",
    "portal_url": ""
  },
  {
    "company": "Diesel",
    "contact": "",
    "email": "submissions@dieselfunding.com",
    "portal_url": ""
  },
  {
    "company": "Clearfund",
    "contact": "",
    "email": "deals@clearfund.co",
    "portal_url": ""
  },
  {
    "company": "Clearfund",
    "contact": "Dave",
    "email": "dave@clearfund.co",
    "portal_url": ""
  },
  {
    "company": "Capitalize",
    "contact": "Ben",
    "email": "ben@capitalizegroup.com",
    "portal_url": ""
  },
  {
    "company": "Capitalize",
    "contact": "",
    "email": "subs@capitalizegroup.com",
    "portal_url": ""
  },
  {
    "company": "Lifetime",
    "contact": "",
    "email": "newdeals@lifetimefundingllc.com",
    "portal_url": ""
  },
  {
    "company": "Lifetime",
    "contact": "Abe",
    "email": "abe@lifetimefundingllc.com",
    "portal_url": ""
  },
  {
    "company": "Kapfi",
    "contact": "",
    "email": "subs@kapfi.co",
    "portal_url": ""
  },
  {
    "company": "Kapfi",
    "contact": "Abe",
    "email": "abe@kapfi.co",
    "portal_url": ""
  },
  {
    "company": "Aspire",
    "contact": "",
    "email": "submissions@aspirefundingplatform.com",
    "portal_url": ""
  },
  {
    "company": "Fundfi",
    "contact": "",
    "email": "submissions@fundfimerchantfunding.com",
    "portal_url": ""
  },
  {
    "company": "Fundfi",
    "contact": "Jordan",
    "email": "jordan@fundfimerchantfunding.com",
    "portal_url": ""
  },
  {
    "company": "SBF",
    "contact": "",
    "email": "submit@smartbusinessfunder.com",
    "portal_url": ""
  },
  {
    "company": "SBF",
    "contact": "Anthony",
    "email": "anthony@smartbusinessfunder.com",
    "portal_url": ""
  },
  {
    "company": "Logic Advance",
    "contact": "",
    "email": "submissions@logicadvancegroup.com",
    "portal_url": ""
  },
  {
    "company": "Logic Advance",
    "contact": "Erik",
    "email": "erik@logicadvancegroup.com",
    "portal_url": ""
  },
  {
    "company": "Fundpros",
    "contact": "Brandon",
    "email": "brandon@fundprollc.com",
    "portal_url": ""
  },
  {
    "company": "Fundpros",
    "contact": "",
    "email": "newdeals@fundprollc.com",
    "portal_url": ""
  },
  {
    "company": "Mint",
    "contact": "",
    "email": "deals@mintfunding.com",
    "portal_url": ""
  },
  {
    "company": "Mint",
    "contact": "Alex",
    "email": "alex@mintfunding.com",
    "portal_url": ""
  },
  {
    "company": "Firstline",
    "contact": "",
    "email": "subs@firstlineadvance.com",
    "portal_url": ""
  },
  {
    "company": "Meged",
    "contact": "",
    "email": "submissions@megedfunding.com",
    "portal_url": ""
  },
  {
    "company": "Meged",
    "contact": "Marc",
    "email": "marc@megedfunding.com",
    "portal_url": ""
  },
  {
    "company": "Seamless",
    "contact": "",
    "email": "subs@seamlesscapitalgroup.com",
    "portal_url": ""
  },
  {
    "company": "Funding Futures",
    "contact": "",
    "email": "deals@mcadeals.com",
    "portal_url": ""
  },
  {
    "company": "Cashflow Capital",
    "contact": "",
    "email": "submissions@cflowcapital.com",
    "portal_url": ""
  },
  {
    "company": "Cobalt",
    "contact": "Stephanie",
    "email": "stephanie@cobaltfunding.com",
    "portal_url": ""
  },
  {
    "company": "Cobalt",
    "contact": "",
    "email": "deals@cobaltfunding.com",
    "portal_url": ""
  },
  {
    "company": "Pathway",
    "contact": "",
    "email": "subs@pathwayfunding.com",
    "portal_url": ""
  },
  {
    "company": "Cedar",
    "contact": "Levi",
    "email": "levi@cedaradvance.com",
    "portal_url": ""
  },
  {
    "company": "Cedar",
    "contact": "",
    "email": "funding@cedaradvance.com",
    "portal_url": ""
  },
  {
    "company": "Wynwood",
    "contact": "Josh",
    "email": "josh@wynwoodcapitalgroup.com",
    "portal_url": ""
  },
  {
    "company": "Wynwood",
    "contact": "",
    "email": "submissions@wynwoodcapitalgroup.com",
    "portal_url": ""
  },
  {
    "company": "Peak",
    "contact": "David",
    "email": "david@peakfundingplatform.com",
    "portal_url": ""
  },
  {
    "company": "Peak",
    "contact": "",
    "email": "subs@peakfundingplatform.com",
    "portal_url": ""
  },
  {
    "company": "Forest",
    "contact": "",
    "email": "submissions@forestcapitalgrp.com",
    "portal_url": ""
  },
  {
    "company": "Amerifi",
    "contact": "Raymond",
    "email": "raymond@amerificapital.com",
    "portal_url": ""
  },
  {
    "company": "Amerifi",
    "contact": "",
    "email": "submit@amerificapital.com",
    "portal_url": ""
  },
  {
    "company": "Fantastic",
    "contact": "",
    "email": "subs@fantastic-funding.com",
    "portal_url": ""
  },
  {
    "company": "Fantastic",
    "contact": "David",
    "email": "david@fantastic-funding.com",
    "portal_url": ""
  },
  {
    "company": "Cityview",
    "contact": "",
    "email": "subs@cityviewfunding.com",
    "portal_url": ""
  },
  {
    "company": "Katan",
    "contact": "",
    "email": "subs@katancapital.com",
    "portal_url": ""
  },
  {
    "company": "Thoro",
    "contact": "",
    "email": "submissions@thorocorp.com",
    "portal_url": ""
  },
  {
    "company": "Thoro",
    "contact": "Jay",
    "email": "jay@thorocorp.com",
    "portal_url": ""
  },
  {
    "company": "Vault",
    "contact": "D. Bach",
    "email": "dbach@vaultcapitalllc.com",
    "portal_url": ""
  },
  {
    "company": "Vault",
    "contact": "D. Benjamin",
    "email": "dbenjamin@vaultcapitalllc.com",
    "portal_url": ""
  },
  {
    "company": "App Funding Beta",
    "contact": "",
    "email": "submissions@appfundingbeta.com",
    "portal_url": ""
  },
  {
    "company": "App Funding Beta",
    "contact": "D. Levin",
    "email": "dlevin@appfundingbeta.com",
    "portal_url": ""
  },
  {
    "company": "Fund Me Fast",
    "contact": "",
    "email": "fundmefastllc@gmail.com",
    "portal_url": ""
  },
  {
    "company": "Fund Me Fast",
    "contact": "",
    "email": "subs@fundsmefast.com",
    "portal_url": ""
  },
  {
    "company": "Finpoint",
    "contact": "",
    "email": "deals@finpointfunding.com",
    "portal_url": ""
  },
  {
    "company": "Finpoint",
    "contact": "Daniel",
    "email": "daniel@finpointfunding.com",
    "portal_url": ""
  },
  {
    "company": "Finpoint",
    "contact": "",
    "email": "uw@finpointfunding.com",
    "portal_url": ""
  },
  {
    "company": "Casa Capital",
    "contact": "",
    "email": "submissions@casacapital.org",
    "portal_url": ""
  },
  {
    "company": "Casa Capital",
    "contact": "Nicole",
    "email": "nicole@casacapital.org",
    "portal_url": ""
  },
  {
    "company": "Monday Funding",
    "contact": "",
    "email": "subs@mondayfunding.com",
    "portal_url": ""
  },
  {
    "company": "WG/Rainbow Advance",
    "contact": "",
    "email": "subs@wgfinancinginc.com",
    "portal_url": ""
  },
  {
    "company": "Fintoro",
    "contact": "",
    "email": "submit@fintorocapital.com",
    "portal_url": ""
  },
  {
    "company": "Fintoro",
    "contact": "Anthony",
    "email": "anthony@fintorocapital.com",
    "portal_url": ""
  },
  {
    "company": "Forever Funding",
    "contact": "Mike",
    "email": "mike@foreverfunding.co",
    "portal_url": ""
  },
  {
    "company": "DLP",
    "contact": "",
    "email": "submissions@dlpfunding.com",
    "portal_url": ""
  },
  {
    "company": "DLP",
    "contact": "Sara",
    "email": "sara@dlpfunding.com",
    "portal_url": ""
  },
  {
    "company": "GFE",
    "contact": "",
    "email": "underwriting@ezrevenuefinance.com",
    "portal_url": ""
  },
  {
    "company": "GFE",
    "contact": "",
    "email": "iso@ezrevenuefinance.com",
    "portal_url": ""
  },
  {
    "company": "Silverline",
    "contact": "",
    "email": "submissions@silverlinefunding.com",
    "portal_url": ""
  },
  {
    "company": "QFS",
    "contact": "",
    "email": "submissions@qfscapital.com",
    "portal_url": ""
  },
  {
    "company": "QFS",
    "contact": "Samuel",
    "email": "samuel@qfscapital.com",
    "portal_url": ""
  },
  {
    "company": "Highland Hill",
    "contact": "",
    "email": "submissions@highlandhillcap.com",
    "portal_url": ""
  },
  {
    "company": "Highland Hill",
    "contact": "Tristan",
    "email": "tristan@highlandhillcap.com",
    "portal_url": ""
  },
  {
    "company": "Southwell Co. (Ivan)",
    "contact": "Ivan (J. Erskey)",
    "email": "jerskey@southwellco.net",
    "portal_url": ""
  },
  {
    "company": "The Rente Group (Lior)",
    "contact": "Lior",
    "email": "lior@therentegroup.com",
    "portal_url": ""
  },
  {
    "company": "Belcastro Holdings (Tyler)",
    "contact": "Tyler",
    "email": "belcastroholdings@gmail.com",
    "portal_url": ""
  },
  {
    "company": "Amerifactors Financial Group",
    "contact": "J. Nguyen",
    "email": "jnguyen@amerifactors.com",
    "portal_url": ""
  }
]$contacts$::jsonb;row record;firm uuid;matches uuid[];addresses text[];domains text[];existing public.lenders;
begin
 for row in select * from jsonb_to_recordset(seeds) as s(company text,contact text,email text,portal_url text) loop
  select array_agg(s.email) filter(where s.email<>''),array_agg(public.mail_company_domain(s.email)) filter(where public.mail_company_domain(s.email) is not null)
   into addresses,domains from jsonb_to_recordset(seeds) as s(company text,email text) where s.company=row.company;
  select array_agg(distinct l.id) into matches from public.lenders l where l.archived_at is null and (
   lower(btrim(l.name))=lower(btrim(row.company)) or l.email=any(addresses) or public.mail_company_domain(l.email)=any(domains)
   or exists(select 1 from public.lender_contacts ct where ct.lender_id=l.id and (ct.email=any(addresses) or public.mail_company_domain(ct.email)=any(domains)))
   or (row.portal_url<>'' and position(row.portal_url in l.notes)>0));
  if cardinality(matches)>1 then raise exception 'Directory conflict for company %',row.company;end if;
  firm:=matches[1];
  if firm is null then
   insert into public.lenders(name,email,channel,notes) values(row.company,row.email,case when row.portal_url<>'' then 'portal' else 'email' end,case when row.portal_url<>'' then 'Portal: '||row.portal_url else '' end) returning id into firm;
   insert into public.audit_log(entity_type,entity_id,action,metadata) values('lender',firm,'directory_company_added',jsonb_build_object('source','Lender_Submission_Contacts.xlsx'));
  end if;
  if row.company='Fund Me Fast' then update public.lenders set name='Fund Me Fast',notes=regexp_replace(notes,'^\[Provisional\][^\n]*','') where id=firm and notes like '[Provisional]%';end if;
  if row.email<>'' then
   if exists(select 1 from public.lender_contacts where email=row.email and lender_id<>firm) then raise exception 'Directory contact conflict for %',row.company;end if;
   insert into public.lender_contacts(email,lender_id,name) values(row.email,firm,left(row.contact,150)) on conflict(email) do update set name=case when public.lender_contacts.name='' then excluded.name else public.lender_contacts.name end where public.lender_contacts.lender_id=excluded.lender_id;
  end if;
 end loop;
end $directory$;

do $$ declare row record;begin
 for row in select id from public.messages order by sent_at,id loop perform public.mail_index_lender_message(row.id,false);end loop;
 for row in select id from public.messages order by sent_at,id loop perform public.mail_index_lender_message(row.id,true);end loop;
end $$;
revoke all on function public.validate_lender_directory(),public.validate_lender_contact_address() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
