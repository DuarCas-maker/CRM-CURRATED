-- Synthetic transaction only. No provider calls; every business row is rolled back.
begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
do $qa$
declare actor uuid;c uuid:=gen_random_uuid();ct uuid:=gen_random_uuid();d uuid;run uuid:=gen_random_uuid();la uuid:=gen_random_uuid();lb uuid:=gen_random_uuid();r jsonb;a jsonb;b jsonb;s jsonb;f jsonb;payload jsonb;request uuid:=gen_random_uuid();i int;blocked boolean:=false;checks jsonb:='{}';
begin
 select id into actor from public.profiles where role='superadmin' and active order by id limit 1;
 if actor is null then raise exception 'QA_NO_ACTIVE_ADMIN';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
 insert into public.contacts(id,email,name,verification) values(ct,'case-flow-qa-'||ct||'@example.invalid','Fictional rollback fixture','valid');
 insert into public.opportunities(id,contact_id,company,seller_id,historical_approved_at) values(c,ct,'FICTIONAL 055 ROLLBACK TEST',actor,clock_timestamp());
 for i in 0..4 loop
  insert into public.documents(opportunity_id,name,kind,period,status,storage_path,content_hash) values(c,'Fictional rollback source',case when i=0 then 'application' else 'bank_statement' end,'2026-0'||(i+1),'approved','qa/no-real-file-'||i,md5(c::text||i)) returning id into d;
 end loop;
 insert into public.underwriting_runs(id,opportunity_id,status,requested_by,request_key,model,prompt,prompt_version,max_output_tokens,document_snapshot,lender_snapshot,report)
 values(run,c,'draft',actor,gen_random_uuid(),'fictional-no-model-call','fictional',1,1000,(select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'period',period,'content_hash',content_hash)) from public.documents where opportunity_id=c),'[]','{"summary":"Fictional report for rollback QA","strategy":"Fictional review","missing_information":[],"lender_matches":[]}');
 perform public.case_flow_command(c,jsonb_build_object('operation','report','request_key',gen_random_uuid(),'run_id',run,'decision','approved','locale','es','reason',''));
 if not exists(select 1 from public.underwriting_runs u join public.analyses x on x.id=u.analysis_id where u.id=run and u.status='approved' and x.is_current) then raise exception 'QA_REPORT_APPROVAL';end if;
 checks:=checks||'{"report_approval":true,"without_handoff":true}';
 insert into public.lenders(id,name,email,channel) values(la,'Fictional A','qa-'||la||'@example.invalid','email'),(lb,'Fictional B','qa-'||lb||'@example.invalid','email');
 payload:=jsonb_build_object('operation','lender','request_key',request,'process_id',null,'expected_event_id',null,'lender_id',la,'conversation_id',null,'state','offer','offered_amount',50000,'agreed_amount',null,'reason','Fictional evidence; rollback only','document_id',d,'archive_message_id',null);
 a:=public.case_flow_command(c,payload);
 if public.case_flow_command(c,payload) is distinct from a then raise exception 'QA_IDEMPOTENCY';end if;
 b:=public.case_flow_command(c,payload||jsonb_build_object('request_key',gen_random_uuid(),'process_id',a->>'process_id','expected_event_id',a->>'event_id','lender_id',lb,'offered_amount',60000));
 s:=public.case_flow_command(c,payload||jsonb_build_object('request_key',gen_random_uuid(),'process_id',a->>'process_id','expected_event_id',b->>'event_id','state','selected'));
 if (select count(*) from public.offers where opportunity_id=c and status='selected')<>1 or (select count(*) from public.offers where opportunity_id=c and status='received')<>1 then raise exception 'QA_ALTERNATIVES';end if;
 begin
  perform public.case_flow_command(c,payload||jsonb_build_object('request_key',gen_random_uuid(),'process_id',a->>'process_id','expected_event_id',b->>'event_id','state','selected','lender_id',lb));
 exception when others then if sqlerrm like 'Flow changed%' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'QA_CAS_NOT_BLOCKED';end if;
 f:=public.case_flow_command(c,payload||jsonb_build_object('request_key',gen_random_uuid(),'process_id',a->>'process_id','expected_event_id',s->>'event_id','state','agreed_amount','agreed_amount',48000));
 if exists(select 1 from public.financing_processes where id=(a->>'process_id')::uuid and (actual_funded_amount is not null or funded_lender_id is not null or state='disbursed')) then raise exception 'QA_AGREEMENT_IS_NOT_FUNDING';end if;
 checks:=checks||'{"idempotency":true,"alternatives_kept":true,"single_selected":true,"stale_edit_blocked":true,"agreement_not_funding":true}';
 r:=public.case_flow_command(c,jsonb_build_object('operation','confirmation','request_key',gen_random_uuid(),'process_id',null,'expected_event_id',null,'milestone','sources','decision','pending','reason','Fictional correction','document_id',d,'archive_message_id',null));
 perform public.case_flow_command(c,jsonb_build_object('operation','confirmation','request_key',gen_random_uuid(),'process_id',null,'expected_event_id',r->>'event_id','milestone','sources','decision','automatic','reason','Fictional reset','document_id',d,'archive_message_id',null));
 checks:=checks||'{"manual_correction_and_reset":true}';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal1')::text,true);
 blocked:=false;begin perform public.case_flow_command(c,payload);exception when others then if sqlerrm='Case flow access denied' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'QA_MFA_NOT_BLOCKED';end if;
 checks:=checks||'{"aal1_blocked":true,"provider_calls":false,"mail_queued":false,"real_data_import":false}';
 perform set_config('case_flow_055.qa',checks::text,true);
end $qa$;
select current_setting('case_flow_055.qa')::jsonb result;
rollback;
