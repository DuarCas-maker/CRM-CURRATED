begin;
alter table public.command_receipts add column fingerprint text not null;
create function public.initialize_checklist(case_id uuid, product_name text) returns void language plpgsql security definer set search_path='' as $$
declare months int; i int; period text;
begin
 select coalesce((select bank_months from public.product_requirements where product=product_name),4) into months;
 insert into public.documents(opportunity_id,name,kind) values(case_id,'Signed application','application') on conflict do nothing;
 for i in 1..months loop
  period := to_char(now()-make_interval(months=>i),'YYYY-MM');
  insert into public.documents(opportunity_id,name,kind,period) values(case_id,'Bank statement — '||period,'bank_statement',period) on conflict do nothing;
 end loop;
end $$;
create function public.notify_user(recipient uuid,event text,title_text text) returns void language plpgsql security definer set search_path='' as $$
declare notification_id uuid;
begin
 if recipient is null then return; end if;
 insert into public.notifications(user_id,title,body,event_key) values(recipient,title_text,'Open your secure workspace to review this update.',event) on conflict(user_id,event_key) do nothing returning id into notification_id;
 if notification_id is not null then
  insert into public.jobs(kind,payload,dedupe_key) values('notify',jsonb_build_object('notification_id',notification_id),'notify:'||notification_id) on conflict do nothing;
 end if;
end $$;
create function public.crm_command(kind text,p jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
 actor uuid := auth.uid(); role public.app_role := public.current_app_role();
 o public.opportunities; c public.contacts; co public.conversations; camp public.campaigns; sub public.submissions; doc public.documents;
 old_receipt public.command_receipts; result jsonb := '{}'::jsonb; entity uuid; company_id uuid; target uuid;
 area public.case_area; new_stage public.case_stage; row jsonb; reason text; email text; amount numeric; recipient uuid;
begin
 if role is null or actor is null then raise exception 'Invitation and MFA required'; end if;
 if request_key is null then raise exception 'Idempotency key required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,0));
 select * into old_receipt from public.command_receipts r where r.user_id=actor and r.request_key=crm_command.request_key;
 if found then
  if old_receipt.kind<>kind or old_receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused with different input'; end if;
  return old_receipt.result;
 end if;
 if nullif(p->>'opportunity_id','') is not null then
  select * into o from public.opportunities where id=(p->>'opportunity_id')::uuid for update;
  if o.id is null or not public.can_edit_case(o.id) then raise exception 'Case is inaccessible or read-only'; end if;
  area := case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end;
  entity := o.id;
 end if;
 if kind in ('activity','next_action','transition','analysis','add_document','review_document','handoff','assign_closer','fund','create_task','submission','update_submission','offer','lender_email') and o.id is null then raise exception 'Case required'; end if;

 case kind
 when 'create_opportunity' then
  if role not in ('superadmin','seller_admin','seller') then raise exception 'Seller access required'; end if;
  email:=lower(btrim(p->>'email'));
  if email is null or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(p->>'company','')='' or coalesce(p->>'contact','')='' then raise exception 'Valid contact and company required'; end if;
  target:=case when role='seller' then actor else (p->>'seller_id')::uuid end;
  if not exists(select 1 from public.profiles where id=target and active and profiles.role in ('seller','seller_admin','superadmin')) then raise exception 'Invalid seller'; end if;
  perform pg_advisory_xact_lock(hashtextextended(email,1));
  select * into c from public.contacts where contacts.email=email;
  if c.id is null then
   insert into public.companies(name) values(p->>'company') returning id into company_id;
   insert into public.contacts(company_id,email,name,phone) values(company_id,email,p->>'contact',coalesce(p->>'phone','')) returning * into c;
  end if;
  insert into public.opportunities(contact_id,company_id,company,industry,product,amount,seller_id,next_action,next_action_at)
  values(c.id,c.company_id,p->>'company',coalesce(p->>'industry',''),p->>'product',coalesce((p->>'amount')::numeric,0),target,coalesce(p->>'next_action',''),nullif(p->>'next_action_at','')::timestamptz) returning id into entity;
  perform public.initialize_checklist(entity,p->>'product');
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(entity,actor,'created','general','Opportunity created');
 when 'activity' then
  if coalesce(btrim(p->>'body'),'')='' or p->>'type' not in ('note','call') then raise exception 'Valid activity required'; end if;
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,p->>'type',area,p->>'body');
  -- Seller-visible summary must never contain closer negotiations.
  if area='seller' then update public.opportunities set summary=p->>'body',last_contact=case when p->>'type'='call' then now() else last_contact end where id=o.id; end if;
  if p->>'type'='call' then
   update public.opportunities set last_contact=now() where id=o.id;
   if coalesce(p->>'next_action','')='' or nullif(p->>'next_action_at','') is null then raise exception 'Next commitment required'; end if;
   insert into public.tasks(opportunity_id,owner_id,title,due_at,area) values(o.id,coalesce(o.closer_id,o.seller_id),p->>'next_action',(p->>'next_action_at')::timestamptz,area);
   if area='seller' then update public.opportunities set next_action=p->>'next_action',next_action_at=(p->>'next_action_at')::timestamptz where id=o.id; end if;
  end if;
 when 'next_action' then
  if coalesce(btrim(p->>'next_action'),'')='' then raise exception 'Next action required'; end if;
  if area='seller' then update public.opportunities set next_action=p->>'next_action',next_action_at=(p->>'next_action_at')::timestamptz where id=o.id; end if;
  insert into public.tasks(opportunity_id,owner_id,title,due_at,area) values(o.id,coalesce(o.closer_id,o.seller_id),p->>'next_action',(p->>'next_action_at')::timestamptz,area);
 when 'transition' then
  new_stage:=(p->>'stage')::public.case_stage;
  if coalesce(btrim(p->>'reason'),'')='' then raise exception 'Reason required'; end if;
  if new_stage in ('funded','ready_for_closer','unassigned') then raise exception 'Use dedicated workflow'; end if;
  if (area='seller' and new_stage not in ('new','contacting','replied','application_pending','documents_pending','analysis','lost','paused')) or (area='closer' and new_stage not in ('lenders','offers','negotiation','accepted','funding_pending','lost','paused')) then raise exception 'Invalid phase transition'; end if;
  if new_stage='funding_pending' and o.stage<>'accepted' then raise exception 'Acceptance required'; end if;
  if new_stage='accepted' and not exists(select 1 from public.offers where opportunity_id=o.id) then raise exception 'Recorded offer required'; end if;
  if o.stage='funded' then raise exception 'Funded case cannot be reopened by a status update'; end if;
  update public.opportunities set stage=new_stage where id=o.id;
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,'status',area,new_stage::text||': '||(p->>'reason'));
  if new_stage in ('lost','paused') then update public.campaign_enrollments set status='goal_met' where opportunity_id=o.id and status in ('active','paused'); update public.outbox set status='cancelled' where opportunity_id=o.id and enrollment_id is not null and status in ('queued','paused'); end if;
 when 'analysis' then
  if area<>'seller' or coalesce(btrim(p->>'summary'),'')='' or coalesce(btrim(p->>'conclusion'),'')='' or coalesce(btrim(p->>'recommendations'),'')='' then raise exception 'Complete seller analysis required'; end if;
  insert into public.analyses(opportunity_id,summary,conclusion,observations,recommendations,reviewer_id) values(o.id,p->>'summary',p->>'conclusion',coalesce(p->>'observations',''),p->>'recommendations',actor);
 when 'add_document' then
  if coalesce(btrim(p->>'name'),'')='' or length(p->>'name')>200 or p->>'kind' not in ('additional','analysis_report') then raise exception 'Document name and type required'; end if;
  insert into public.documents(opportunity_id,name,kind,period,required) values(o.id,p->>'name',p->>'kind',coalesce(nullif(p->>'period',''),request_key::text),coalesce((p->>'required')::boolean,true));
 when 'review_document' then
  select * into doc from public.documents where id=(p->>'id')::uuid and opportunity_id=o.id for update;
  if doc.id is null or doc.storage_path is null or p->>'status' not in ('received','approved','correction') then raise exception 'Received document required'; end if;
  update public.documents set status=p->>'status',reviewed_by=actor,reviewed_at=now() where id=doc.id;
 when 'handoff' then
  if area<>'seller' or not o.application_signed or not o.application_complete then raise exception 'Signed and complete application required'; end if;
  if not exists(select 1 from public.documents where opportunity_id=o.id) or exists(select 1 from public.documents where opportunity_id=o.id and required and status<>'approved') then raise exception 'All documents must be reviewed and approved'; end if;
  if not exists(select 1 from public.analyses where opportunity_id=o.id and btrim(summary)<>'' and btrim(conclusion)<>'' and btrim(recommendations)<>'') then raise exception 'Analysis and recommendation required'; end if;
  update public.opportunities set stage='unassigned',handed_off_at=now(),next_action='Awaiting closer assignment',next_action_at=now() where id=o.id;
  update public.campaign_enrollments set status='goal_met' where opportunity_id=o.id and status in ('active','paused');
  update public.outbox set status='cancelled' where opportunity_id=o.id and enrollment_id is not null and status in ('queued','paused');
  update public.tasks set status='done' where opportunity_id=o.id and automated and area='seller';
  for recipient in select id from public.profiles where profiles.role in ('superadmin','closer_admin') and active loop perform public.notify_user(recipient,'handoff:'||o.id,'Case ready for assignment'); end loop;
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,'handoff','general','Case handed off to closer team');
 when 'assign_seller' then
  if o.id is null or role not in ('superadmin','seller_admin') or (role='seller_admin' and o.handed_off_at is not null) then raise exception 'Seller administrator required before handoff'; end if;
  target:=(p->>'seller_id')::uuid;
  if not exists(select 1 from public.profiles where id=target and active and profiles.role in ('superadmin','seller_admin','seller')) then raise exception 'Invalid seller'; end if;
  update public.opportunities set seller_id=target where id=o.id;
  update public.tasks set owner_id=target where opportunity_id=o.id and tasks.area='seller' and status='open' and owner_id=o.seller_id;
  perform public.notify_user(target,'assigned:'||o.id||':'||request_key,'New case assigned');
 when 'assign_closer' then
  if role not in ('superadmin','closer_admin') or o.handed_off_at is null then raise exception 'Closer administrator required'; end if;
  target:=(p->>'closer_id')::uuid;
  if not exists(select 1 from public.profiles where id=target and active and profiles.role in ('superadmin','closer_admin','closer')) then raise exception 'Invalid closer'; end if;
  update public.opportunities set closer_id=target,stage=case when stage='unassigned' then 'lenders'::public.case_stage else stage end,next_action='Closer managing lender requests',next_action_at=null where id=o.id;
  perform public.notify_user(target,'assigned:'||o.id||':'||request_key,'New case assigned');
 when 'fund' then
  amount:=(p->>'amount')::numeric;
  if area<>'closer' or o.stage not in ('accepted','funding_pending') or amount<=0 or nullif(p->>'funded_at','') is null or (p->>'funded_at')::date>current_date then raise exception 'Accepted case and valid funding details required'; end if;
  if not exists(select 1 from public.submissions where opportunity_id=o.id and lender_id=(p->>'lender_id')::uuid) then raise exception 'Lender must have a submission for this case'; end if;
  update public.opportunities set stage='funded',funded_amount=amount,funded_at=(p->>'funded_at')::timestamptz,funded_lender_id=(p->>'lender_id')::uuid where id=o.id;
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,actor,'funded','general','Funding confirmed');
  perform public.notify_user(o.seller_id,'funded:'||o.id,'Case funding confirmed');
 when 'create_task' then
  target:=(p->>'owner_id')::uuid;
  if coalesce(p->>'title','')='' or not exists(select 1 from public.profiles where id=target and active and (profiles.role='superadmin' or (area='seller' and profiles.role='seller_admin') or (area='closer' and profiles.role='closer_admin') or (target=o.seller_id and area='seller') or (target=o.closer_id and area='closer'))) then raise exception 'Task owner must have access to this phase'; end if;
  insert into public.tasks(opportunity_id,owner_id,title,due_at,area) values(o.id,target,p->>'title',(p->>'due_at')::timestamptz,area);
 when 'complete_task' then
  select opportunity_id into entity from public.tasks where id=(p->>'id')::uuid;
  if not public.can_edit_case(entity) then raise exception 'Access denied'; end if;
  update public.tasks set status='done' where id=(p->>'id')::uuid and public.can_area(opportunity_id,tasks.area);
 when 'submission' then
  if area<>'closer' or o.closer_id is null or coalesce(p->>'next_action','')='' then raise exception 'Assigned closer and next action required'; end if;
  insert into public.submissions(opportunity_id,lender_id,closer_id,channel,status,next_action,next_action_at,external_reference) values(o.id,(p->>'lender_id')::uuid,o.closer_id,p->>'channel',case when p->>'channel'='email' then 'draft' else 'submitted' end,p->>'next_action',(p->>'next_action_at')::timestamptz,coalesce(p->>'external_reference',''));
 when 'update_submission' then
  if area<>'closer' then raise exception 'Closer required'; end if;
  update public.submissions set status=p->>'status',next_action=p->>'next_action',next_action_at=(p->>'next_action_at')::timestamptz where id=(p->>'id')::uuid and opportunity_id=o.id;
  if not found then raise exception 'Submission not found'; end if;
 when 'offer' then
  if area<>'closer' or not exists(select 1 from public.submissions where id=(p->>'submission_id')::uuid and opportunity_id=o.id) then raise exception 'Submission not found'; end if;
  insert into public.offers(submission_id,opportunity_id,product,amount,term,cost,frequency,fees,expires_at) values((p->>'submission_id')::uuid,o.id,p->>'product',(p->>'amount')::numeric,coalesce(p->>'term',''),coalesce(p->>'cost',''),coalesce(p->>'frequency',''),coalesce(p->>'fees',''),nullif(p->>'expires_at','')::timestamptz);
  update public.submissions set status='offer' where id=(p->>'submission_id')::uuid;
  update public.opportunities set stage='offers' where id=o.id and stage not in ('accepted','funding_pending','funded');
 when 'create_lender' then
  if role not in ('superadmin','closer_admin') then raise exception 'Closer administrator required'; end if;
  insert into public.lenders(name,email,products,channel,notes) values(p->>'name',p->>'email',regexp_split_to_array(p->>'products',',\s*'),p->>'channel',coalesce(p->>'notes','')) returning id into entity;
 when 'update_lender' then
  if role not in ('superadmin','closer_admin') then raise exception 'Closer administrator required'; end if;
  update public.lenders set name=p->>'name',email=lower(btrim(p->>'email')),products=regexp_split_to_array(p->>'products',',\s*'),channel=p->>'channel',notes=coalesce(p->>'notes','') where id=(p->>'id')::uuid;
 when 'create_campaign' then
  if role not in ('superadmin','seller_admin') or not public.can_send((p->>'account_id')::uuid) then raise exception 'Campaign and sender access required'; end if;
  if not exists(select 1 from public.profiles where id=(p->>'seller_id')::uuid and active and profiles.role in ('superadmin','seller_admin','seller')) then raise exception 'Invalid seller'; end if;
  if not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Invalid timezone'; end if;
  if position('{{unsubscribe_url}}' in (p->>'body'))=0 or (coalesce((p->>'followup_days')::int,0)>0 and position('{{unsubscribe_url}}' in (p->>'followup_body'))=0) then raise exception 'Unsubscribe link required in every step'; end if;
  if p ? 'steps' then
   if jsonb_typeof(p->'steps')<>'array' or jsonb_array_length(p->'steps')>20 then raise exception 'Maximum 20 follow-up steps'; end if;
   for row in select value from jsonb_array_elements(p->'steps') loop
    if coalesce((row->>'wait_days')::int,0) not between 1 and 90 or coalesce(btrim(row->>'subject'),'')='' or coalesce(position('{{unsubscribe_url}}' in (row->>'body')),0)=0 then raise exception 'Each follow-up requires a subject, wait time and unsubscribe link'; end if;
   end loop;
  end if;
  insert into public.campaigns(name,account_id,seller_id,created_by,daily_limit,timezone,start_hour,end_hour,subject,body,batch_id,steps)
  values(p->>'name',(p->>'account_id')::uuid,(p->>'seller_id')::uuid,actor,(p->>'daily_limit')::int,p->>'timezone',(p->>'start_hour')::int,(p->>'end_hour')::int,p->>'subject',p->>'body',nullif(p->>'batch_id','')::uuid,coalesce(p->'steps',case when coalesce((p->>'followup_days')::int,0)>0 then jsonb_build_array(jsonb_build_object('subject',p->>'followup_subject','body',p->>'followup_body','wait_days',(p->>'followup_days')::int)) else '[]'::jsonb end)) returning id into entity;
 when 'activate_campaign' then
  select * into camp from public.campaigns where id=(p->>'id')::uuid for update;
  if role not in ('superadmin','seller_admin') or camp.id is null or not public.can_send(camp.account_id) then raise exception 'Campaign and sender access required'; end if;
  if not exists(select 1 from public.mail_accounts where id=camp.account_id and status='connected') then raise exception 'Gmail account disconnected'; end if;
  if camp.status='active' then raise exception 'Campaign already active'; end if;
  -- Lock contacts in deterministic order; the partial unique index enforces exclusivity across concurrent campaigns.
  for c in select ct.* from public.contacts ct where ct.verification='valid' and not exists(select 1 from public.suppressions s where s.email=ct.email)
    and exists(select 1 from public.opportunities op where op.contact_id=ct.id and op.handed_off_at is null and op.stage not in ('lost','paused','funded') and (op.campaign_id is null or op.campaign_id=camp.id))
    and (camp.batch_id is null or exists(select 1 from public.import_rows r where r.batch_id=camp.batch_id and r.contact_id=ct.id)) order by ct.id for update of ct loop
   if not exists(select 1 from public.campaign_enrollments e where e.contact_id=c.id and e.status in ('active','paused')) then
    select * into o from public.opportunities where contact_id=c.id and handed_off_at is null and stage not in ('lost','paused','funded') and (campaign_id is null or campaign_id=camp.id) order by created_at desc limit 1;
    insert into public.campaign_enrollments(campaign_id,contact_id,opportunity_id) values(camp.id,c.id,o.id) on conflict do nothing;
    if found then update public.opportunities set seller_id=camp.seller_id,campaign_id=camp.id where id=o.id; end if;
   end if;
  end loop;
  update public.campaigns set status='active' where id=camp.id;
  entity:=camp.id;
 when 'pause_campaign' then
  if role not in ('superadmin','seller_admin') then raise exception 'Administrator required'; end if;
  update public.campaigns set status='paused' where id=(p->>'id')::uuid;
  entity:=(p->>'id')::uuid;
 when 'verify_contacts' then
  if role not in ('superadmin','seller_admin') then raise exception 'Administrator required'; end if;
  for target in select distinct value::text::uuid from jsonb_array_elements_text(p->'contact_ids') loop
   if exists(select 1 from public.contacts where id=target and verification in ('pending','uncertain')) and public.can_case((select id from public.opportunities where contact_id=target limit 1)) then
    insert into public.verifications(contact_id,request_key,result) values(target,request_key||':'||target,'pending') on conflict do nothing;
   end if;
  end loop;
  insert into public.jobs(kind,payload,dedupe_key) values('scrub','{}','scrub:'||request_key) on conflict do nothing;
 when 'reply' then
  select * into co from public.conversations where id=(p->>'conversation_id')::uuid;
  if co.id is null or not public.can_area(co.opportunity_id,co.area) or not public.can_edit_case(co.opportunity_id) or not public.can_send(co.account_id) then raise exception 'Case and sender permissions required'; end if;
  if co.area='seller' then select ct.email into email from public.opportunities op join public.contacts ct on ct.id=op.contact_id where op.id=co.opportunity_id;
  elsif co.submission_id is not null then select l.email into email from public.submissions s join public.lenders l on l.id=s.lender_id where s.id=co.submission_id;
  else select ct.email into email from public.opportunities op join public.contacts ct on ct.id=op.contact_id where op.id=co.opportunity_id; end if;
  select case when handed_off_at is not null then 'closer'::public.case_area else co.area end into area from public.opportunities where id=co.opportunity_id;
  insert into public.outbox(account_id,opportunity_id,submission_id,conversation_id,to_email,subject,body,area,message_id_header,requested_by,request_key,gmail_thread_id)
  values(co.account_id,co.opportunity_id,co.submission_id,co.id,email,co.subject,p->>'body',area,'<'||request_key||'@crm.curated.local>',actor,request_key::text,co.gmail_thread_id);
  entity:=co.opportunity_id;
 when 'lender_email' then
  select * into sub from public.submissions where id=(p->>'submission_id')::uuid and opportunity_id=o.id;
  if area<>'closer' or sub.id is null or not public.can_send((p->>'account_id')::uuid) then raise exception 'Case and sender permissions required'; end if;
  select l.email into email from public.lenders l where l.id=sub.lender_id;
  insert into public.outbox(account_id,opportunity_id,submission_id,to_email,subject,body,area,attachment_ids,message_id_header,requested_by,request_key)
  values((p->>'account_id')::uuid,o.id,sub.id,email,p->>'subject',p->>'body','closer',array(select id from public.documents where opportunity_id=o.id and status='approved'), '<'||request_key||'@crm.curated.local>',actor,request_key::text);
 when 'preferences' then
  insert into public.notification_preferences(user_id,internal,email,push,locale) values(actor,(p->>'internal')::boolean,(p->>'email')::boolean,(p->>'push')::boolean,p->>'locale')
  on conflict(user_id) do update set internal=excluded.internal,email=excluded.email,push=excluded.push,locale=excluded.locale;
 when 'read_notification' then update public.notifications set read_at=now() where id=(p->>'id')::uuid and user_id=actor;
 when 'push_subscription' then
  if coalesce(p->'subscription'->>'endpoint','') !~ '^https://([a-zA-Z0-9-]+\.)*(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com)/' then raise exception 'Unsupported push endpoint'; end if;
  insert into public.push_subscriptions(user_id,subscription,endpoint) values(actor,p->'subscription',p->'subscription'->>'endpoint') on conflict(endpoint) do update set user_id=excluded.user_id,subscription=excluded.subscription;
 when 'requirements' then
  if role<>'superadmin' then raise exception 'Superadmin required'; end if;
  insert into public.product_requirements(product,bank_months) values(p->>'product',(p->>'bank_months')::int) on conflict(product) do update set bank_months=excluded.bank_months;
 when 'account_settings' then
  if role<>'superadmin' then raise exception 'Superadmin required'; end if;
  if not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Invalid timezone'; end if;
  update public.mail_accounts set daily_limit=(p->>'daily_limit')::int,timezone=p->>'timezone' where id=(p->>'id')::uuid;
 when 'mail_permission' then
  if role<>'superadmin' then raise exception 'Superadmin required'; end if;
  insert into public.mail_permissions(account_id,user_id,can_send) values((p->>'account_id')::uuid,(p->>'user_id')::uuid,(p->>'can_send')::boolean) on conflict(account_id,user_id) do update set can_send=excluded.can_send;
 when 'user_role' then
  if role<>'superadmin' or (p->>'user_id')::uuid=actor then raise exception 'Superadmin required; own role cannot be changed'; end if;
  update public.profiles set role=(p->>'role')::public.app_role,active=(p->>'active')::boolean where id=(p->>'user_id')::uuid;
 when 'archive' then
  if not public.can_edit_case((p->>'id')::uuid) then raise exception 'Access denied'; end if;
  update public.opportunities set archived_at=now() where id=(p->>'id')::uuid;
  update public.campaign_enrollments set status='goal_met' where opportunity_id=(p->>'id')::uuid and status in ('active','paused');
  update public.outbox set status='cancelled' where opportunity_id=(p->>'id')::uuid and status in ('queued','paused');
 else raise exception 'Unsupported command';
 end case;
 if o.id is not null then update public.opportunities set updated_at=now() where id=o.id; end if;
 -- Only identifiers and action names are audited. Message/application bodies never enter logs.
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(actor,kind,entity,kind,jsonb_build_object('request_key',request_key,'target_id',coalesce(p->>'id',p->>'user_id',p->>'closer_id',p->>'account_id')));
 result:=jsonb_build_object('ok',true,'id',entity);
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request_key,kind,result,md5(p::text));
 return result;
end $$;
revoke all on function public.crm_command(text,jsonb,uuid),public.initialize_checklist(uuid,text),public.notify_user(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_command(text,jsonb,uuid) to authenticated;
grant execute on all functions in schema public to service_role;
commit;
