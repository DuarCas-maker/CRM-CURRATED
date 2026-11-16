begin;
alter table public.case_events add column if not exists workflow_value jsonb check(workflow_value is null or jsonb_typeof(workflow_value)='object');
alter table public.submissions add column if not exists requirements_state text not null default 'not_requested' check(requirements_state in ('not_requested','pending','resolved'));
alter table public.submissions add column if not exists agreed_amount numeric(16,2) check(agreed_amount>0);
create index if not exists case_flow_event_lookup on public.case_events(opportunity_id,process_id,created_at desc,id) where kind in ('workflow_confirmation','workflow_lender');

create or replace function public.can_case(case_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.opportunities o where o.id=case_id and (o.email_qualified_at is not null or o.historical_approved_at is not null) and
 (public.current_app_role() in ('superadmin','seller_admin','closer_admin') or (public.current_app_role()='seller' and o.seller_id=auth.uid()) or (public.current_app_role()='closer' and o.closer_id=auth.uid())))
$$;
create or replace function public.can_manage_case_flow(case_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_case(case_id) and exists(select 1 from public.opportunities o where o.id=case_id and o.archived_at is null and
 (public.current_app_role() in ('superadmin','seller_admin','closer_admin') or coalesce(o.closer_id,o.seller_id)=auth.uid()))
$$;
revoke all on function public.can_manage_case_flow(uuid) from public,anon;
grant execute on function public.can_manage_case_flow(uuid) to authenticated;
create or replace function public.can_area(case_id uuid, area public.case_area) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_case(case_id) and (area<>'closer' or public.can_manage_case_flow(case_id))
$$;
create or replace function public.can_edit_case(case_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select public.can_manage_case_flow(case_id) $$;

-- Existing mail workers validate the recorded actor without a human JWT.
-- Align case ownership while preserving each mailbox's explicit send grant.
do $compat$ begin
 if to_regprocedure('s01_i02.actor_can_write(uuid,uuid,public.case_area,uuid)') is not null then
 execute $ddl$create or replace function s01_i02.actor_can_write(actor uuid,case_id uuid,area public.case_area,account uuid default null) returns boolean
 language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.profiles p join public.opportunities o on o.id=case_id where p.id=actor and p.active
 and o.archived_at is null and (o.email_qualified_at is not null or o.historical_approved_at is not null)
 and (area is not null or p.role='superadmin')
 and (p.role in ('superadmin','seller_admin','closer_admin') or coalesce(o.closer_id,o.seller_id)=p.id)
 and (account is null or p.role='superadmin' or exists(select 1 from public.mail_permissions x where x.user_id=p.id and x.account_id=account and x.can_send)))
 $fn$ $ddl$;
 execute $ddl$create or replace function s01_i02.actor_can_read(actor uuid,case_id uuid,area public.case_area) returns boolean
 language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.profiles p join public.opportunities o on o.id=case_id where p.id=actor and p.active
 and (o.email_qualified_at is not null or o.historical_approved_at is not null)
 and (p.role='superadmin' or (area is not null
 and (p.role in ('seller_admin','closer_admin') or (p.role='seller' and o.seller_id=p.id) or (p.role='closer' and o.closer_id=p.id))
 and (area<>'closer' or p.role in ('seller_admin','closer_admin') or coalesce(o.closer_id,o.seller_id)=p.id))))
 $fn$ $ddl$;
 end if;
end $compat$;

-- Retain the installed package/brand/send guards; change only who owns a new evaluation.
do $queue_owner$ declare definition text;old_text text:='select closer_id into closer from public.opportunities where opportunities.id=case_id;';new_text text:='select coalesce(closer_id,seller_id) into closer from public.opportunities where opportunities.id=case_id;';begin
 definition:=pg_get_functiondef('public.queue_lender_emails(uuid,uuid,uuid,jsonb,text,text,uuid[],uuid[],uuid)'::regprocedure);
 if strpos(definition,old_text)>0 then execute replace(definition,old_text,new_text);
 elsif strpos(definition,new_text)=0 then raise exception 'Unrecognized lender queue ownership contract';end if;
end $queue_owner$;

create or replace function public.case_flow_command(case_id uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare o public.opportunities;pr public.financing_processes;s public.submissions;r public.underwriting_runs;
 actor uuid:=auth.uid();op text:=p->>'operation';request uuid:=(p->>'request_key')::uuid;receipt public.command_receipts;
 process uuid:=nullif(p->>'process_id','')::uuid;lender uuid:=nullif(p->>'lender_id','')::uuid;
 mail uuid:=nullif(p->>'archive_message_id','')::uuid;doc uuid:=nullif(p->>'document_id','')::uuid;
 conversation uuid:=nullif(p->>'conversation_id','')::uuid;credit_amount numeric;final_amount numeric;previous_offer numeric;previous_agreed numeric;
 prior uuid;event uuid;offer uuid;result jsonb;hash text:=(p-'request_key')::text;milestone text:=p->>'milestone';lang text:=p->>'locale';
begin
 if public.current_app_role() is null or not public.can_manage_case_flow(case_id) then raise exception 'Case flow access denied';end if;
 if request is null then raise exception 'Request key required';end if;
 if op is null or op not in ('report','lender','confirmation','closing') then raise exception 'Invalid flow operation';end if;
 if length(coalesce(p->>'reason',''))>2000 then raise exception 'Reason too long';end if;
 select * into o from public.opportunities where id=case_id for update;
 select * into receipt from public.command_receipts where user_id=actor and request_key=request;
 if found then
   if receipt.kind<>'case_flow' or receipt.result->>'input' is distinct from hash then raise exception 'Request key conflict';end if;
   return receipt.result->'value';
 end if;
 if op='report' then
   select * into r from public.underwriting_runs where id=(p->>'run_id')::uuid and opportunity_id=case_id for update;
   if r.id is null or r.report is null then raise exception 'Report unavailable';end if;
   if p->>'decision'='approved' then
     if lang is null or lang not in ('es','en') then raise exception 'Invalid language';end if;
     if r.status='approved' and not exists(select 1 from public.analyses where id=r.analysis_id and is_current) then raise exception 'Documents changed; generate a new analysis';end if;
     perform public.approve_underwriting(r.id,
       coalesce(nullif(r.report#>>array['compact_report','conclusion',lang],''),nullif(r.report->>'summary',''),'Ver informe IA aprobado.'),
       coalesce(nullif(r.report#>>array['compact_report','pitch',lang],''),nullif(r.report->>'strategy',''),nullif(r.report->>'summary',''),'Ver conclusión del informe IA aprobado.'),
       coalesce((r.report->'missing_information')::text,''),
       coalesce(nullif((r.report->'lender_matches')::text,'[]'),nullif((r.report#>'{compact_report,lenders}')::text,'[]'),'Consultar recomendaciones del informe IA aprobado.'));
   elsif p->>'decision'='rejected' then
     if r.status='approved' then
       if length(btrim(coalesce(p->>'reason','')))=0 then raise exception 'Reason required to correct an approved report';end if;
       update public.analyses set is_current=false where id=r.analysis_id;
       update public.underwriting_runs set status='rejected',reviewed_by=actor,reviewed_at=clock_timestamp(),review_notes=p->>'reason' where id=r.id;
       insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(actor,'underwriting',r.id,'approval_corrected',jsonb_build_object('reason',p->>'reason'));
     else
       perform public.reject_underwriting(r.id,coalesce(nullif(btrim(p->>'reason'),''),'Informe no aprobado por el responsable.'));
     end if;
   else raise exception 'Invalid report decision';end if;
   result:=jsonb_build_object('run_id',r.id);
 else
   if op not in ('lender','confirmation','closing') then raise exception 'Invalid flow operation';end if;
   if length(btrim(coalesce(p->>'reason','')))=0 or length(p->>'reason')>2000 then raise exception 'Reason required';end if;
   if mail is null and doc is null then raise exception 'Case evidence required';end if;
   if mail is not null and not exists(select 1 from public.case_events e where e.opportunity_id=case_id and e.archive_message_id=mail) then raise exception 'Evidence belongs to another case';end if;
   if doc is not null and not exists(select 1 from public.documents d where d.id=doc and d.opportunity_id=case_id and d.storage_path is not null) then raise exception 'Evidence belongs to another case';end if;
   if process is not null then
     select * into pr from public.financing_processes where id=process and opportunity_id=case_id and not is_unclassified_archive for update;
     if pr.id is null then raise exception 'Process unavailable';end if;
   elsif op in ('lender','closing') or milestone in ('submissions','contract-sent','contract-signed','final-approval') then
     select * into pr from public.financing_processes where opportunity_id=case_id and classification='active' and not is_unclassified_archive order by sequence_number desc limit 1 for update;
     if pr.id is null then
       insert into public.financing_processes(opportunity_id,sequence_number,started_at,classification,label)
       select case_id,coalesce(max(sequence_number),0)+1,
         coalesce(greatest((select max(u.reviewed_at) from public.underwriting_runs u join public.analyses a on a.id=u.analysis_id where u.opportunity_id=case_id and u.status='approved' and a.is_current),o.funded_at),clock_timestamp()),
         'active','Operación actual' from public.financing_processes where opportunity_id=case_id returning * into pr;
     end if;
     process:=pr.id;
   end if;
   if op='confirmation' then
     if milestone not in ('application','application-file','statements','additional-documents','sources','submissions','contract-sent','contract-signed','final-approval') then raise exception 'Structured evidence required for this milestone';end if;
     if p->>'decision' is null or p->>'decision' not in ('confirmed','pending','automatic') then raise exception 'Invalid confirmation';end if;
     if milestone in ('application','application-file','statements','additional-documents','sources') then process:=null;end if;
     select e.id into prior from public.case_events e where e.opportunity_id=case_id and e.process_id is not distinct from process and e.kind='workflow_confirmation' and e.workflow_value->>'milestone'=milestone order by e.created_at desc,e.id desc limit 1;
     if prior is distinct from nullif(p->>'expected_event_id','')::uuid then raise exception 'Flow changed; refresh before saving';end if;
     insert into public.case_events(opportunity_id,process_id,archive_message_id,document_id,area,kind,body,evidence_type,occurred_at,created_at,actor_id,workflow_value)
     values(case_id,process,mail,doc,case when process is null then 'seller'::public.case_area else 'closer'::public.case_area end,'workflow_confirmation',p->>'reason','manual',clock_timestamp(),clock_timestamp(),actor,jsonb_build_object('milestone',milestone,'decision',p->>'decision')) returning id into event;
   elsif op='lender' then
     if lender is null or not exists(select 1 from public.lenders where id=lender and archived_at is null) then raise exception 'Lender unavailable';end if;
     if pr.state in ('disbursed','client_withdrew','funding_declined') then raise exception 'Closed process is read-only';end if;
     if conversation is not null and not exists(select 1 from public.conversations c where c.id=conversation and c.opportunity_id=case_id) then raise exception 'Conversation belongs to another case';end if;
     select e.id into prior from public.case_events e where e.opportunity_id=case_id and e.process_id=process and e.kind='workflow_lender' order by e.created_at desc,e.id desc limit 1;
     if prior is distinct from nullif(p->>'expected_event_id','')::uuid then raise exception 'Flow changed; refresh before saving';end if;
     select x.* into s from public.submissions x where x.opportunity_id=case_id and x.process_id=process and x.lender_id=lender
       order by exists(select 1 from public.offers f where f.submission_id=x.id and f.status in ('selected','accepted')) desc,
       exists(select 1 from public.offers f where f.submission_id=x.id and f.status in ('received','approved','offered','active')) desc,x.id limit 1 for update;
     if s.id is null then
       insert into public.submissions(opportunity_id,process_id,lender_id,closer_id,channel,status,next_action,next_action_at)
       values(case_id,process,lender,coalesce(o.closer_id,o.seller_id),'email','draft','Revisar gestión del lender',clock_timestamp()) returning * into s;
     end if;
     credit_amount:=nullif(p->>'offered_amount','')::numeric;final_amount:=nullif(p->>'agreed_amount','')::numeric;
     previous_agreed:=s.agreed_amount;
     if (credit_amount is not null and (credit_amount<=0 or credit_amount>1e12 or credit_amount<>trunc(credit_amount,2))) or (final_amount is not null and (final_amount<=0 or final_amount>1e12 or final_amount<>trunc(final_amount,2))) then raise exception 'Invalid credit amount';end if;
     if p->>'state'='offer' then
       if credit_amount is null then raise exception 'Offered amount required';end if;
       select id into offer from public.offers where submission_id=s.id and status in ('received','selected','accepted','approved','offered','active') order by id limit 1;
       if offer is null then insert into public.offers(submission_id,opportunity_id,product,amount) values(s.id,case_id,o.product,credit_amount) returning id into offer;
       else select amount into previous_offer from public.offers where id=offer;update public.offers set amount=credit_amount,expires_at=null where id=offer;end if;
       update public.submissions set status='offer' where id=s.id;
       if pr.state not in ('contract_sent','contract_signed','final_approval') then update public.financing_processes set state=case when exists(select 1 from public.offers f join public.submissions x on x.id=f.submission_id where x.process_id=process and f.status in ('selected','accepted')) then 'lender_selected' else 'offers' end where id=process;end if;
     elsif p->>'state'='selected' then
       select id into offer from public.offers where submission_id=s.id and amount>0 and status in ('received','selected','accepted','approved','offered','active') and (expires_at is null or expires_at>clock_timestamp()) order by id limit 1;
       if offer is null then raise exception 'Available offer required';end if;
       if pr.state in ('contract_sent','contract_signed','final_approval') and not exists(select 1 from public.offers where id=offer and status in ('selected','accepted')) then raise exception 'Contract already recorded; review the operation before changing lender';end if;
       update public.offers f set status='received' from public.submissions x where x.id=f.submission_id and x.process_id=process and f.status in ('selected','accepted') and f.id<>offer;
       update public.offers set status='selected' where id=offer;
       if pr.state not in ('contract_sent','contract_signed','final_approval') then update public.financing_processes set state='lender_selected' where id=process;end if;
     elsif p->>'state' in ('requirements_pending','requirements_resolved') then
       update public.submissions set requirements_state=case when p->>'state'='requirements_pending' then 'pending' else 'resolved' end,
       status=case when p->>'state'='requirements_pending' then 'requirements' when exists(select 1 from public.offers where submission_id=s.id) then 'offer' else status end where id=s.id;
       if exists(select 1 from public.offers where submission_id=s.id and status in ('selected','accepted')) and pr.state not in ('contract_sent','contract_signed','final_approval') then update public.financing_processes set state=case when p->>'state'='requirements_pending' then 'requirements' else 'lender_selected' end where id=process;end if;
     elsif p->>'state'='agreed_amount' then
       if final_amount is null or not exists(select 1 from public.offers where submission_id=s.id and status in ('selected','accepted')) then raise exception 'Selected lender and final amount required';end if;
       update public.submissions set agreed_amount=final_amount where id=s.id;
     else raise exception 'Invalid lender state';end if;
     insert into public.case_events(opportunity_id,process_id,submission_id,archive_message_id,document_id,area,kind,body,evidence_type,occurred_at,created_at,actor_id,workflow_value)
     values(case_id,process,s.id,mail,doc,'closer','workflow_lender',p->>'reason','manual',clock_timestamp(),clock_timestamp(),actor,jsonb_build_object('lender_id',lender,'conversation_id',conversation,'state',p->>'state','offered_amount',case when p->>'state'='offer' then credit_amount end,'previous_offered_amount',previous_offer,'agreed_amount',case when p->>'state'='agreed_amount' then final_amount end,'previous_agreed_amount',previous_agreed)) returning id into event;
   else
     if p->>'state' is null or p->>'state' not in ('contract_sent','contract_signed','final_approval','disbursed') then raise exception 'Invalid closing state';end if;
     if pr.state in ('disbursed','client_withdrew','funding_declined') then raise exception 'Closed process is read-only';end if;
     credit_amount:=nullif(p->>'funded_amount','')::numeric;
     if p->>'state'='disbursed' and (credit_amount is null or credit_amount<=0 or credit_amount>1e12 or credit_amount<>trunc(credit_amount,2) or lender is null or not exists(select 1 from public.lenders where id=lender)) then raise exception 'Actual funding amount and lender required';end if;
     perform public.gmail_record_process(process,p->>'state',mail,doc,p->>'reason',clock_timestamp(),actor,credit_amount,lender);
   end if;
   update public.opportunities set updated_at=clock_timestamp() where id=case_id;
   insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(actor,'opportunity',case_id,'case_flow_'||op,jsonb_build_object('process_id',process,'event_id',event));
   result:=jsonb_build_object('process_id',process,'event_id',event);
 end if;
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request,'case_flow',jsonb_build_object('input',hash,'value',result),md5(hash));
 return result;
end $$;
revoke all on function public.case_flow_command(uuid,jsonb) from public,anon;
grant execute on function public.case_flow_command(uuid,jsonb) to authenticated;

-- Keep alternatives when the previous history control is used as well.
create or replace function public.gmail_select_lender(process uuid,submission uuid,evidence uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.financing_processes;chosen uuid;
begin
 select * into p from public.financing_processes where id=process;
 perform 1 from public.opportunities where id=p.opportunity_id for update;
 select * into p from public.financing_processes where id=process for update;
 if p.state in ('disbursed','client_withdrew','funding_declined') then raise exception 'Closed process is read-only';end if;
 if not exists(select 1 from public.submissions where id=submission and opportunity_id=p.opportunity_id and process_id=p.id and status='offer') then raise exception 'Select an offer in this process';end if;
 if not exists(select 1 from public.case_events where opportunity_id=p.opportunity_id and archive_message_id=evidence) then raise exception 'Selection evidence required';end if;
 select id into chosen from public.offers where submission_id=submission and amount>0 and status in ('received','selected','accepted','approved','offered','active') and (expires_at is null or expires_at>clock_timestamp()) order by case when status in ('selected','accepted') then 0 else 1 end,id limit 1;
 if chosen is null then raise exception 'Available offer required';end if;
 if p.state in ('contract_sent','contract_signed','final_approval') and not exists(select 1 from public.offers where id=chosen and status in ('selected','accepted')) then raise exception 'Contract already recorded; review the operation before changing lender';end if;
 update public.offers f set status='received' from public.submissions s where s.id=f.submission_id and s.process_id=p.id and f.id<>chosen and f.status in ('selected','accepted');
 update public.offers set status='selected' where id=chosen;
 if p.state not in ('contract_sent','contract_signed','final_approval') then update public.financing_processes set state='lender_selected' where id=p.id;end if;
 insert into public.case_events(opportunity_id,process_id,submission_id,archive_message_id,area,kind,body,evidence_type,occurred_at,created_at,actor_id,workflow_value)
 values(p.opportunity_id,p.id,submission,evidence,'closer','workflow_lender','Selección confirmada; las otras ofertas continúan disponibles.','manual',clock_timestamp(),clock_timestamp(),actor,jsonb_build_object('state','selected','lender_id',(select lender_id from public.submissions where id=submission)));
end $$;
revoke all on function public.gmail_select_lender(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_select_lender(uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
