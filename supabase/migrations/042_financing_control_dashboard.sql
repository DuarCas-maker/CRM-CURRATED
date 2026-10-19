begin;

-- Future transitions only: existing process states have no inferred start date.
create table public.process_state_history (
 id uuid primary key default gen_random_uuid(),
 process_id uuid not null references public.financing_processes,
 from_state text, state text not null,
 entered_at timestamptz not null default now(), exited_at timestamptz,
 actor_id uuid references public.profiles
);
create unique index process_state_history_open on public.process_state_history(process_id) where exited_at is null;
alter table public.process_state_history enable row level security;
grant select on public.process_state_history to authenticated;
grant all on public.process_state_history to service_role;
create policy process_state_history_read on public.process_state_history for select to authenticated
 using(exists(select 1 from public.financing_processes p where p.id=process_id and public.can_case(p.opportunity_id)
 and ((process_state_history.state not in ('submitted','lender_evaluation','offers','lender_selected','requirements','contract_sent','contract_signed','final_approval','disbursed','funding_declined')
 and coalesce(process_state_history.from_state,'') not in ('submitted','lender_evaluation','offers','lender_selected','requirements','contract_sent','contract_signed','final_approval','disbursed','funding_declined')) or public.can_area(p.opportunity_id,'closer'))));
create function public.track_process_state() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  insert into public.process_state_history(process_id,state,actor_id) values(new.id,new.state,auth.uid());
 elsif old.state is distinct from new.state then
  update public.process_state_history set exited_at=now() where process_id=new.id and exited_at is null;
  insert into public.process_state_history(process_id,from_state,state,actor_id) values(new.id,old.state,new.state,auth.uid());
 end if;
 return new;
end $$;
create trigger process_state_transition after insert or update of state on public.financing_processes
 for each row execute function public.track_process_state();
revoke all on function public.track_process_state() from public,anon,authenticated;

-- v1 stays available. Every fact is aggregated at its own grain before joining.
create function public.financing_control_dashboard(
 search_text text default '',owner_filter uuid default null,stage_filter text default null,
 campaign_filter uuid default null,since_filter timestamptz default null,
 attention_filter text default 'all',cursor_offset int default 0,
 process_state_filter text default null,stalled_days int default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; settings public.operational_settings;
begin
 if public.current_app_role() is null then raise exception 'Active user and MFA required';end if;
 if cursor_offset<0 or cursor_offset>1000000 or attention_filter is null or attention_filter not in
 ('all','attention','reply','overdue','documents','analysis','lender','negotiation','offers','missing','review','application','unsent','unassigned')
 or (stalled_days is not null and stalled_days not in (3,5,7,14)) then raise exception 'Invalid dashboard filter';end if;
 select * into settings from public.operational_settings where id=1;
 with authorized as materialized (
  select o.*,c.name contact,
   case when o.handed_off_at is not null then o.closer_id else o.seller_id end owner_id,
   public.can_area(o.id,'closer') closer_visible
  from public.opportunities o join public.contacts c on c.id=o.contact_id
  where o.archived_at is null and public.can_case(o.id)
   and (coalesce(search_text,'')='' or o.company ilike '%'||search_text||'%' or c.name ilike '%'||search_text||'%' or c.email ilike '%'||search_text||'%')
   and (owner_filter is null or o.seller_id=owner_filter or o.closer_id=owner_filter)
   and (campaign_filter is null or o.campaign_id=campaign_filter)
 ), scope as materialized (
  select * from authorized where (since_filter is null or created_at>=since_filter)
   and (stage_filter is null or stage::text=stage_filter)
 ), process_scope as materialized (
  select p.* from public.financing_processes p join scope s on s.id=p.opportunity_id
  where not p.is_unclassified_archive
 ), active_processes as materialized (
  select * from process_scope where classification='active' and ended_at is null
   and state not in ('disbursed','client_withdrew','funding_declined')
 ), case_scope as materialized (
  select s.* from scope s where s.stage not in ('funded','lost','paused')
   or exists(select 1 from active_processes p where p.opportunity_id=s.id)
 ), case_facts as materialized (
  select s.id,s.company,s.contact,s.stage,s.owner_id,s.closer_visible,
   coalesce((select name from public.profiles where id=s.owner_id),'') owner_name,
   s.handed_off_at,s.next_action,s.next_action_at,
   d.required_count,d.received_count,d.approved_count,d.review_count,d.correction_count,
   (d.required_count=d.approved_count and s.application_signed and s.application_complete) documents_complete,
   greatest(0,d.required_count-d.received_count) missing_count,
   case when d.app_approved and s.application_signed and s.application_complete then 'approved'
    when d.app_received and s.application_signed and d.app_signature_source then 'signed' when d.app_received then 'received'
    when exists(select 1 from public.company_applications ca where ca.company_id=s.company_id) then 'draft' else 'pending' end application_status,
   case when r.status is not null then
    case when r.status='approved' and not exists(select 1 from public.analyses a where a.id=r.analysis_id and a.is_current) then 'outdated' else r.status end
    when exists(select 1 from public.analyses a where a.opportunity_id=s.id and a.is_current and a.reviewer_id is not null and a.reviewed_at is not null and btrim(a.summary)<>'' and btrim(a.conclusion)<>'' and btrim(a.recommendations)<>'') then 'approved'
    when exists(select 1 from public.analyses a where a.opportunity_id=s.id and not a.is_current) then 'outdated'
    when d.required_count<>d.approved_count or not s.application_signed or d.source_count>24 then 'blocked' else 'not_started' end risk_status,
   (select count(*) from public.tasks t where t.opportunity_id=s.id and t.status='open' and public.can_area(s.id,t.area) and t.due_at<now()) overdue_tasks,
   tk.id task_id,tk.title next_task,tk.due_at next_task_at,tk.owner_id task_owner_id,
   (select name from public.profiles where id=tk.owner_id) task_owner_name
  from case_scope s
  cross join lateral (
   select 1+4+count(*) filter(where required and kind not in ('application','bank_statement','analysis_report')) required_count,
    (case when coalesce(bool_or(storage_path is not null and content_hash is not null) filter(where kind='application'),false) then 1 else 0 end)
     +least(4,count(distinct content_hash) filter(where kind='bank_statement' and storage_path is not null and content_hash is not null))
     +count(*) filter(where required and kind not in ('application','bank_statement','analysis_report') and storage_path is not null and content_hash is not null) received_count,
    (case when coalesce(bool_or(status='approved' and storage_path is not null and content_hash is not null and reviewed_by is not null and reviewed_at is not null) filter(where kind='application'),false) then 1 else 0 end)
     +least(4,count(distinct content_hash) filter(where kind='bank_statement' and status='approved' and storage_path is not null and content_hash is not null and reviewed_by is not null and reviewed_at is not null))
     +count(*) filter(where required and kind not in ('application','bank_statement','analysis_report') and status='approved' and storage_path is not null and content_hash is not null and reviewed_by is not null and reviewed_at is not null) approved_count,
    count(*) filter(where kind<>'analysis_report' and storage_path is not null and content_hash is not null and status in ('pending','received')) review_count,
    count(*) filter(where kind<>'analysis_report' and status='correction') correction_count,
    coalesce(bool_or(storage_path is not null and content_hash is not null) filter(where kind='application'),false) app_received,
    coalesce(bool_or(storage_path is not null and content_hash is not null and source in ('company_application','application_pdf')) filter(where kind='application'),false) app_signature_source,
    coalesce(bool_or(status='approved' and storage_path is not null and content_hash is not null and reviewed_by is not null and reviewed_at is not null) filter(where kind='application'),false) app_approved,
    count(*) filter(where kind<>'analysis_report' and status='approved' and storage_path is not null and content_hash is not null) source_count
   from public.documents where opportunity_id=s.id
  ) d
  left join lateral (select * from public.underwriting_runs where opportunity_id=s.id order by created_at desc,id desc limit 1) r on true
  left join lateral (select * from public.tasks t where t.opportunity_id=s.id and t.status='open' and public.can_area(s.id,t.area) order by t.due_at,t.id limit 1) tk on true
 ), row_links as (
  select f.id opportunity_id,p.id process_id from case_facts f left join active_processes p on p.opportunity_id=f.id
  union
  select f.id,null::uuid from case_facts f where exists(select 1 from active_processes p where p.opportunity_id=f.id)
   and (exists(select 1 from public.conversations c where c.opportunity_id=f.id and c.process_id is null and c.needs_attention and public.can_area(f.id,c.area))
    or exists(select 1 from public.submissions sb where sb.opportunity_id=f.id and sb.process_id is null and sb.status<>'draft' and f.closer_visible))
 ), row_scope as materialized (
  select f.*,p.id process_id,p.sequence_number,p.label process_label,
   case when not f.closer_visible and p.state in ('submitted','lender_evaluation','offers','lender_selected','requirements','contract_sent','contract_signed','final_approval') then 'restricted' else p.state end process_state,
   case when not f.closer_visible and p.state in ('submitted','lender_evaluation','offers','lender_selected','requirements','contract_sent','contract_signed','final_approval') then null else h.entered_at end stage_entered_at,
   coalesce(p.id::text,'case:'||f.id::text) row_key
  from case_facts f join row_links link on link.opportunity_id=f.id left join active_processes p on p.id=link.process_id
  left join public.process_state_history h on h.process_id=p.id and h.exited_at is null and h.state=p.state
 ), confirmed as materialized (
  select sb.*,x.first_sent_at,x.application_sent,exists(
   select 1 from public.conversations c join public.messages m on m.conversation_id=c.id
   where c.submission_id=sb.id and c.opportunity_id=sb.opportunity_id and public.can_area(c.opportunity_id,c.area)
    and m.direction='inbound' and m.status='received' and m.sent_at>=x.first_sent_at
  ) responded
  from public.submissions sb join case_facts f on f.id=sb.opportunity_id and f.closer_visible
  cross join lateral (
   select min(ob.sent_at) first_sent_at,coalesce(bool_or(exists(
    select 1 from public.submission_documents sd join public.documents d on d.id=sd.document_id
    where sd.outbox_id=ob.id and sd.submission_id=sb.id and d.kind='application' and sd.content_hash<>''
   )),false) application_sent
   from public.outbox ob where ob.submission_id=sb.id and ob.opportunity_id=sb.opportunity_id
    and ob.status='sent' and ob.sent_at is not null and nullif(ob.gmail_message_id,'') is not null
    and exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id
     where c.opportunity_id=sb.opportunity_id and c.submission_id=sb.id and m.gmail_message_id=ob.gmail_message_id and m.direction='outbound' and m.status='sent')
  ) x
  where x.first_sent_at is not null and sb.status<>'draft'
 ), row_facts as materialized (
  select rs.*,coalesce(w.reply_count,0)+coalesce(lw.reply_count,0) reply_count,
   least(w.reply_since,lw.reply_since) reply_since,
   least(w.reply_since,lw.reply_since)+make_interval(hours=>settings.reply_hours) reply_due_at,
   w.followup_due_at,w.waiting_for,w.waiting_lender_count,w.waiting_client_count,
   cm.last_inbound_at,cm.last_outbound_at,
   coalesce(sub.confirmed_count,0) confirmed_count,coalesce(sub.response_count,0) response_count,
   coalesce(sub.application_sent_count,0) application_sent_count,coalesce(sub.lenders,'[]') lenders,
   sub.next_lender_action,sub.next_lender_action_at,
   coalesce(off.active_offers,0) active_offers,coalesce(off.expiring_offers,0) expiring_offers,coalesce(off.expired_offers,0) expired_offers,off.next_offer_expiry
  from row_scope rs
  left join lateral (
   select count(*) filter(where mw.waiting_for='team') reply_count,min(mw.since_at) filter(where mw.waiting_for='team') reply_since,
    min(mw.since_at+make_interval(hours=>settings.followup_hours)) filter(where mw.waiting_for in ('client','lender')) followup_due_at,
    (array_agg(mw.waiting_for order by case when mw.waiting_for='team' then 0 else 1 end,mw.since_at))[1] waiting_for,
    count(*) filter(where mw.waiting_for='lender') waiting_lender_count,count(*) filter(where mw.waiting_for='client') waiting_client_count
   from public.mail_waits mw where mw.opportunity_id=rs.id and mw.process_id is not distinct from rs.process_id and public.can_area(rs.id,mw.area)
  ) w on true
  left join lateral (
   select count(*) reply_count,min(m.sent_at) reply_since from public.conversations c
   join lateral (select sent_at,direction from public.messages where conversation_id=c.id and status in ('sent','received') order by sent_at desc,id desc limit 1) m on m.direction='inbound'
   where c.opportunity_id=rs.id and c.process_id is not distinct from rs.process_id and c.needs_attention and public.can_area(rs.id,c.area)
    and not exists(select 1 from public.mail_waits mw where mw.conversation_id=c.id)
  ) lw on true
  left join lateral (
   select max(m.sent_at) filter(where m.direction='inbound' and m.status='received') last_inbound_at,
    max(m.sent_at) filter(where m.direction='outbound' and m.status='sent') last_outbound_at
   from public.conversations c join public.messages m on m.conversation_id=c.id
   where c.opportunity_id=rs.id and c.process_id is not distinct from rs.process_id and public.can_area(rs.id,c.area)
  ) cm on true
  left join lateral (
   select count(*) confirmed_count,count(*) filter(where sb.responded) response_count,
    count(*) filter(where sb.application_sent) application_sent_count,
    jsonb_agg(jsonb_build_object('id',sb.id,'name',l.name,'status',sb.status,'responded',sb.responded,'sent_at',sb.first_sent_at,'application_sent',sb.application_sent) order by sb.first_sent_at,sb.id) lenders,
    (array_agg(sb.next_action order by sb.next_action_at,sb.id) filter(where sb.status not in ('rejected','withdrawn')))[1] next_lender_action,
    min(sb.next_action_at) filter(where sb.status not in ('rejected','withdrawn')) next_lender_action_at
   from confirmed sb join public.lenders l on l.id=sb.lender_id where sb.opportunity_id=rs.id and sb.process_id is not distinct from rs.process_id
  ) sub on true
  left join lateral (
   select count(*) filter(where o.expires_at is null or o.expires_at>now()) active_offers,
    count(*) filter(where o.expires_at>now() and o.expires_at<=now()+make_interval(hours=>settings.offer_warning_hours)) expiring_offers,
    count(*) filter(where o.expires_at<=now()) expired_offers,min(o.expires_at) filter(where o.expires_at>now()) next_offer_expiry
   from public.offers o join public.submissions sb on sb.id=o.submission_id and sb.opportunity_id=o.opportunity_id
   where o.opportunity_id=rs.id and rs.closer_visible and sb.process_id is not distinct from rs.process_id and o.status='received'
  ) off on true
 ), signals as materialized (
  select f.*,
   (f.overdue_tasks>0 or f.reply_due_at<=now() or f.followup_due_at<=now() or f.next_lender_action_at<now() or (f.handed_off_at is null and f.next_action_at<now())) is_overdue,
   case when f.expiring_offers>0 then 'offers' when f.reply_count>0 then 'reply'
    when f.overdue_tasks>0 or f.followup_due_at<=now() or f.next_lender_action_at<now() or (f.handed_off_at is null and f.next_action_at<now()) then 'overdue'
    when f.owner_id is null then 'unassigned' when f.review_count>0 or f.correction_count>0 then 'documents'
    when f.risk_status in ('draft','outdated','failed','uncertain','rejected') then 'analysis'
    when f.stage_entered_at<=now()-interval '7 days' then 'stalled'
    when f.followup_due_at is not null or f.confirmed_count>f.response_count then 'lender' else 'scheduled' end priority,
   least(f.reply_due_at,f.next_task_at,case when f.handed_off_at is null then f.next_action_at end,f.followup_due_at,f.next_lender_action_at,f.next_offer_expiry) due_at
  from row_facts f
 ), classified as materialized (
  select s.*,s.priority not in ('scheduled','lender') needs_attention,
   case priority when 'offers' then 0 when 'reply' then 1 when 'overdue' then 2 when 'unassigned' then 3 when 'documents' then 4 when 'analysis' then 5 when 'stalled' then 6 else 7 end priority_rank
  from signals s
 ), filtered as materialized (
  select * from classified where
   (process_state_filter is null or coalesce(process_state,'no_process')=process_state_filter)
   and (stalled_days is null or stage_entered_at<=now()-make_interval(days=>stalled_days))
   and (attention_filter='all' or (attention_filter='attention' and needs_attention)
    or (attention_filter='reply' and reply_count>0) or (attention_filter='overdue' and is_overdue)
    or (attention_filter='documents' and (review_count>0 or missing_count>0 or correction_count>0))
    or (attention_filter='missing' and missing_count>0) or (attention_filter='review' and review_count>0)
    or (attention_filter='application' and application_status<>'approved')
    or (attention_filter='analysis' and risk_status<>'approved')
    or (attention_filter='lender' and (confirmed_count>0 or waiting_lender_count>0))
    or (attention_filter='negotiation' and closer_visible and stage in ('offers','negotiation','accepted','funding_pending'))
    or (attention_filter='offers' and (expiring_offers>0 or expired_offers>0))
    or (attention_filter='unsent' and closer_visible and application_sent_count=0)
    or (attention_filter='unassigned' and owner_id is null))
 ), page as (select * from filtered order by priority_rank,due_at nulls last,company,row_key limit 50 offset cursor_offset),
 stage_counts as (select coalesce(process_state,'no_process') state,count(*) n from filtered group by process_state),
 funding as (
  select a.id,a.funded_amount from authorized a where a.closer_visible and a.funded_at is not null and a.funded_amount is not null
   and (since_filter is null or a.funded_at>=since_filter) and a.funded_at<=now()
 ), selected_cases as (select distinct id from filtered), selected_processes as (select process_id from filtered where process_id is not null)
 select jsonb_build_object('version',2,'as_of',now(),'rows',coalesce((select jsonb_agg(to_jsonb(page)-'closer_visible'-'task_owner_id') from page),'[]'::jsonb),
  'total',(select count(*) from filtered),'settings',jsonb_build_object('id',1,'version',settings.version,'reply_hours',settings.reply_hours,'followup_hours',settings.followup_hours,'offer_warning_hours',settings.offer_warning_hours),
  'stages',coalesce((select jsonb_object_agg(state,n) from stage_counts),'{}'::jsonb),
  'alerts',coalesce((select jsonb_agg(to_jsonb(a)-'closer_visible'-'task_owner_id') from (select * from filtered where needs_attention order by priority_rank,due_at nulls last,company,row_key limit 5) a),'[]'::jsonb),
  'summary',jsonb_build_object(
   'active_opportunities',(select count(*) from selected_cases), 'total_opportunities',(select count(*) from scope),
   'active_processes',(select count(*) from selected_processes),'total_processes',(select count(*) from process_scope),
   'unknown_processes',(select count(*) from process_scope where classification='unknown'),
   'pipeline_amount',(select coalesce(sum(amount),0) from scope where id in(select id from selected_cases) and stage not in ('funded','lost','paused')),
   'total_requested_amount',(select coalesce(sum(amount),0) from scope),
   'complete_cases',(select count(*) from case_facts where id in(select id from selected_cases) and documents_complete),
   'required_documents',(select coalesce(sum(required_count),0) from case_facts where id in(select id from selected_cases)),
   'received_documents',(select coalesce(sum(received_count),0) from case_facts where id in(select id from selected_cases)),
   'approved_documents',(select coalesce(sum(approved_count),0) from case_facts where id in(select id from selected_cases)),
   'review_documents',(select coalesce(sum(review_count),0) from case_facts where id in(select id from selected_cases)),
   'application_counts',coalesce((select jsonb_object_agg(application_status,n) from (select application_status,count(*) n from case_facts where id in(select id from selected_cases) group by application_status) a),'{}'::jsonb),
   'risk_counts',coalesce((select jsonb_object_agg(risk_status,n) from (select risk_status,count(*) n from case_facts where id in(select id from selected_cases) group by risk_status) a),'{}'::jsonb),
   'confirmed_processes',case when public.current_app_role() in ('superadmin','closer_admin','closer') then (select count(*) from filtered where process_id is not null and confirmed_count>0) else null end,
   'confirmed_submissions',case when public.current_app_role() in ('superadmin','closer_admin','closer') then (select coalesce(sum(confirmed_count),0) from filtered) else null end,
   'responded_submissions',case when public.current_app_role() in ('superadmin','closer_admin','closer') then (select coalesce(sum(response_count),0) from filtered) else null end,
   'application_sent_cases',case when public.current_app_role() in ('superadmin','closer_admin','closer') then (select count(distinct id) from filtered where application_sent_count>0) else null end,
   'active_offers',case when public.current_app_role() in ('superadmin','closer_admin','closer') then (select coalesce(sum(active_offers),0) from filtered) else null end,
   'expiring_offers',case when public.current_app_role() in ('superadmin','closer_admin','closer') then (select coalesce(sum(expiring_offers),0) from filtered) else null end,
   'funded_amount',case when public.current_app_role() in ('superadmin','closer_admin','closer') then (select coalesce(sum(funded_amount),0) from funding) else null end,
   'funded_count',case when public.current_app_role() in ('superadmin','closer_admin','closer') then (select count(*) from funding) else null end,
   'historical_funding_records',case when public.current_app_role() in ('superadmin','closer_admin','closer') then (select count(*) from public.financing_processes p join authorized a on a.id=p.opportunity_id where p.actual_funded_amount is not null) else null end,
   'attention',(select count(*) from filtered where needs_attention),
   'lender_counts',case when public.current_app_role() in ('superadmin','closer_admin','closer') then coalesce((select jsonb_agg(x) from (select l.name,count(*) submissions,count(*) filter(where c.responded) responses from confirmed c join public.lenders l on l.id=c.lender_id where exists(select 1 from filtered f where f.id=c.opportunity_id and f.process_id is not distinct from c.process_id) group by l.id,l.name order by l.name) x),'[]'::jsonb) else null end
  )) into result;
 return result;
end $$;
revoke all on function public.financing_control_dashboard(text,uuid,text,uuid,timestamptz,text,int,text,int) from public,anon;
grant execute on function public.financing_control_dashboard(text,uuid,text,uuid,timestamptz,text,int,text,int) to authenticated;
create index dashboard_process_scope on public.financing_processes(opportunity_id,classification,state);
create index dashboard_confirmed_sends on public.outbox(submission_id,sent_at) where status='sent';
create index dashboard_case_documents on public.documents(opportunity_id,kind);
create index dashboard_submission_messages on public.conversations(opportunity_id,process_id,submission_id);
notify pgrst,'reload schema';
commit;
