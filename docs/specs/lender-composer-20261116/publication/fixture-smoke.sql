-- Fictional QA only. No outbox writes or provider calls. All rows roll back.
begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
do $qa$
declare actor uuid; template uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); p jsonb; r jsonb; again jsonb; blocked boolean:=false; targets jsonb;
begin
 select id into actor from public.profiles where role='superadmin' and active order by id limit 1;
 if actor is null then raise exception 'QA_NO_ACTIVE_ADMIN';end if;
 perform set_config('lender_056.qa_actor',actor::text,true);
 perform set_config('lender_056.qa_template',template::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
 p:=jsonb_build_object('id',template,'expected_version',0,'name','FICTIONAL 056 ROLLBACK QA','subject','Funding — {{company}}','body','Hello {{lender_name}}: {{amount}}','body_format','plain','archived',false);
 r:=public.save_lender_email_template(p,request);
 again:=public.save_lender_email_template(p,request);
 if r is distinct from again or (r->>'version')::int<>1 then raise exception 'QA_IDEMPOTENCY';end if;
 r:=public.save_lender_email_template(p||'{"expected_version":1}',gen_random_uuid());
 if (r->>'version')::int<>2 then raise exception 'QA_UPDATE';end if;
 begin perform public.save_lender_email_template(p||'{"expected_version":1}',gen_random_uuid());
 exception when others then if sqlerrm like 'Template changed%' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'QA_STALE_VERSION_ALLOWED';end if;
 r:=public.save_lender_email_template(p||'{"expected_version":2,"archived":true}',gen_random_uuid());
 if (r->>'version')::int<>3 or r->>'archived_at' is null or (select count(*) from public.lender_email_template_versions where template_id=template)<>3 then raise exception 'QA_ARCHIVE_HISTORY';end if;
 select jsonb_agg(jsonb_build_object('lender_id',gen_random_uuid(),'email','lender-'||i||'@example.invalid','cc_emails','[]'::jsonb)) into targets from generate_series(1,73) i;
 insert into public.mail_recipient_selections(user_id,name,targets) values(actor,'FICTIONAL 056 ROLLBACK QA',targets);
end $qa$;
set local role authenticated;
do $rls$
declare blocked boolean:=false; actor uuid:=current_setting('lender_056.qa_actor')::uuid; template uuid:=current_setting('lender_056.qa_template')::uuid;
begin
 if (select count(*) from public.lender_email_templates where id=template)<>1 or (select count(*) from public.lender_email_template_versions where template_id=template)<>3 then raise exception 'QA_READ_RLS';end if;
 if (select jsonb_array_length(targets) from public.mail_recipient_selections where user_id=actor and name='FICTIONAL 056 ROLLBACK QA')<>73 then raise exception 'QA_CATALOG_SELECTION';end if;
 begin update public.lender_email_templates set name='Forbidden direct edit' where id=template;
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'QA_DIRECT_UPDATE_ALLOWED';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated','aal','aal2')::text,true);
 if exists(select 1 from public.lender_email_templates where id=template) or exists(select 1 from public.mail_recipient_selections where name='FICTIONAL 056 ROLLBACK QA') then raise exception 'QA_INACTIVE_ACCESS';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal1')::text,true);
 blocked:=false;
 begin perform public.save_lender_email_template(jsonb_build_object('id',gen_random_uuid()),gen_random_uuid());
 exception when others then if sqlerrm='Administrator required' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'QA_MFA_ALLOWED';end if;
 perform set_config('lender_056.qa_result','{"template_crud":true,"idempotency":true,"stale_version_blocked":true,"archive_versions":true,"selection_73":true,"direct_write_blocked":true,"inactive_read_blocked":true,"aal1_blocked":true,"mail_queued":false,"provider_calls":false}',true);
end $rls$;
reset role;
select current_setting('lender_056.qa_result')::jsonb result;
rollback;
