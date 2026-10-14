begin;
create table public.operational_settings(id int primary key check(id=1),version int not null default 1,reply_hours int not null default 24 check(reply_hours between 1 and 720),followup_hours int not null default 120 check(followup_hours between 1 and 2160),offer_warning_hours int not null default 48 check(offer_warning_hours between 1 and 720),updated_by uuid references public.profiles,updated_at timestamptz not null default now());
insert into public.operational_settings(id) values(1);
alter table public.operational_settings enable row level security;
create policy operational_settings_read on public.operational_settings for select to authenticated using(public.current_app_role() is not null);
grant select on public.operational_settings to authenticated;grant all on public.operational_settings to service_role;
create function public.save_operational_settings(p jsonb,request_key uuid) returns int language plpgsql security definer set search_path='' as $$
declare settings public.operational_settings;receipt public.command_receipts;
begin
 if public.current_app_role() is distinct from 'superadmin' then raise exception 'Superadmin and MFA required';end if;
 if request_key is null then raise exception 'Request key required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_key::text,0));
 select * into receipt from public.command_receipts r where r.user_id=auth.uid() and r.request_key=save_operational_settings.request_key;
 if found then if receipt.kind<>'operational_settings' or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused';end if;return (receipt.result->>'version')::int;end if;
 if coalesce((p->>'reply_hours')::int,0) not between 1 and 720 or coalesce((p->>'followup_hours')::int,0) not between 1 and 2160 or coalesce((p->>'offer_warning_hours')::int,0) not between 1 and 720 then raise exception 'Invalid response limits';end if;
 select * into settings from public.operational_settings where id=1 for update;
 if settings.version is distinct from (p->>'expected_version')::int then raise exception 'Settings changed; reload';end if;
 update public.operational_settings set reply_hours=(p->>'reply_hours')::int,followup_hours=(p->>'followup_hours')::int,offer_warning_hours=(p->>'offer_warning_hours')::int,version=version+1,updated_by=auth.uid(),updated_at=now() where id=1 returning * into settings;
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(auth.uid(),request_key,'operational_settings',jsonb_build_object('version',settings.version),md5(p::text));
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'operational_settings',request_key,'updated',to_jsonb(settings));return settings.version;
end $$;
revoke all on function public.save_operational_settings(jsonb,uuid) from public,anon;grant execute on function public.save_operational_settings(jsonb,uuid) to authenticated;

create function public.operational_dashboard(search_text text default '',owner_filter uuid default null,stage_filter text default null,campaign_filter uuid default null,since_filter timestamptz default null,attention_filter text default 'all',cursor_offset int default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;settings public.operational_settings;
begin
 if public.current_app_role() is null then raise exception 'Active user and MFA required';end if;
 if cursor_offset<0 or cursor_offset>1000000 or attention_filter not in ('all','attention','reply','overdue','documents','analysis','lender','negotiation','offers') then raise exception 'Invalid dashboard filter';end if;
 select * into settings from public.operational_settings where id=1;
 with scope as (
  select o.id,o.company,c.name contact,c.email,o.stage,o.seller_id,o.closer_id,o.handed_off_at,o.next_action,o.next_action_at,
   case when o.handed_off_at is not null then o.closer_id else o.seller_id end owner_id
  from public.opportunities o join public.contacts c on c.id=o.contact_id
  where o.archived_at is null and o.stage not in ('funded','lost','paused') and public.can_case(o.id)
   and (coalesce(search_text,'')='' or o.company ilike '%'||search_text||'%' or c.name ilike '%'||search_text||'%' or c.email ilike '%'||search_text||'%')
   and (owner_filter is null or o.seller_id=owner_filter or o.closer_id=owner_filter) and (stage_filter is null or o.stage::text=stage_filter)
   and (campaign_filter is null or o.campaign_id=campaign_filter) and (since_filter is null or o.created_at>=since_filter)
 ), facts as (
  select s.*,coalesce((select name from public.profiles where id=s.owner_id),'') owner_name,
   coalesce(w.waits,'[]') waits,coalesce(w.reply_count,0)+coalesce(legacy.reply_count,0) reply_count,least(w.reply_since,legacy.reply_since) reply_since,
   least(w.reply_since,legacy.reply_since)+make_interval(hours=>settings.reply_hours) reply_due_at,
   coalesce(w.lender_count,0) waiting_lender_count,coalesce(w.client_count,0) waiting_client_count,w.followup_due_at,
   coalesce(t.overdue_count,0) overdue_tasks,t.next_task,t.next_task_at,
   coalesce(d.review_count,0) document_review_count,coalesce(d.missing_count,0) missing_document_count,
   coalesce(sub.lenders,'[]') lenders,sub.next_lender_action,sub.next_lender_action_at,
   off.next_offer_expiry,coalesce(off.expiring_count,0) expiring_offer_count,
   a.status analysis_status,
   s.stage in ('offers','negotiation','accepted','funding_pending') negotiation,
   (s.stage in ('analysis','documents_pending') and not exists(select 1 from public.analyses an where an.opportunity_id=s.id and an.is_current)) analysis_pending
  from scope s
  left join lateral (
   select jsonb_agg(jsonb_build_object('conversation_id',mw.conversation_id,'waiting_for',mw.waiting_for,'since_at',mw.since_at,'due_at',mw.since_at+make_interval(hours=>case when mw.waiting_for='team' then settings.reply_hours else settings.followup_hours end)) order by mw.since_at) waits,
    count(*) filter(where mw.waiting_for='team') reply_count,min(mw.since_at) filter(where mw.waiting_for='team') reply_since,
    count(*) filter(where mw.waiting_for='lender') lender_count,count(*) filter(where mw.waiting_for='client') client_count,
    min(mw.since_at+make_interval(hours=>settings.followup_hours)) filter(where mw.waiting_for in ('lender','client')) followup_due_at
   from public.mail_waits mw left join public.financing_processes fp on fp.id=mw.process_id
   where mw.opportunity_id=s.id and public.can_area(s.id,mw.area) and (fp.id is null or (fp.classification='active' and fp.state not in ('disbursed','client_withdrew','funding_declined')))
  ) w on true
  left join lateral (
   select count(*) reply_count,min(m.sent_at) reply_since from public.conversations cv
   join lateral (select sent_at,direction from public.messages where conversation_id=cv.id and status in ('received','sent') order by sent_at desc,id desc limit 1) m on m.direction='inbound'
   where cv.opportunity_id=s.id and cv.needs_attention and public.can_area(s.id,cv.area) and not exists(select 1 from public.mail_waits mw where mw.conversation_id=cv.id)
  ) legacy on true
  left join lateral (
   select count(*) filter(where due_at<now()) overdue_count,(array_agg(title order by due_at,id))[1] next_task,min(due_at) next_task_at from public.tasks where opportunity_id=s.id and status='open' and public.can_area(s.id,area)
  ) t on true
  left join lateral (
   select count(*) filter(where status in ('pending','received','needs_correction') and storage_path is not null) review_count,count(*) filter(where required and storage_path is null) missing_count from public.documents where opportunity_id=s.id and kind<>'analysis_report'
  ) d on true
  left join lateral (
   select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'status',sb.status,'next_action',sb.next_action,'next_action_at',sb.next_action_at) order by sb.next_action_at) lenders,
    (array_agg(sb.next_action order by sb.next_action_at,sb.id))[1] next_lender_action,min(sb.next_action_at) next_lender_action_at
   from public.submissions sb join public.lenders l on l.id=sb.lender_id left join public.financing_processes fp on fp.id=sb.process_id
   where sb.opportunity_id=s.id and sb.status not in ('rejected','withdrawn','draft') and public.can_area(s.id,'closer') and (fp.id is null or (fp.classification='active' and fp.state not in ('disbursed','client_withdrew','funding_declined')))
  ) sub on true
  left join lateral (select min(expires_at) next_offer_expiry,count(*) filter(where expires_at<=now()+make_interval(hours=>settings.offer_warning_hours)) expiring_count from public.offers where opportunity_id=s.id and status='received' and expires_at is not null and public.can_area(s.id,'closer')) off on true
  left join lateral (select status from public.underwriting_runs where opportunity_id=s.id order by created_at desc,id desc limit 1) a on true
 ), signals as (
  select f.*,coalesce((overdue_tasks>0 or reply_due_at<=now() or (handed_off_at is null and next_action_at<now()) or next_lender_action_at<now() or followup_due_at<=now()),false) overdue,
   coalesce((reply_count>0 or overdue_tasks>0 or reply_due_at<=now() or (handed_off_at is null and next_action_at<now()) or next_lender_action_at<now() or followup_due_at<=now() or document_review_count>0 or expiring_offer_count>0 or analysis_status in ('draft','uncertain','failed','outdated') or owner_id is null),false) needs_attention,
   least(reply_due_at,next_task_at,case when handed_off_at is null then next_action_at end,next_lender_action_at,followup_due_at,next_offer_expiry) due_at,
   case when reply_count>0 then 'reply' when overdue_tasks>0 or (handed_off_at is null and next_action_at<now()) or next_lender_action_at<now() or followup_due_at<=now() then 'overdue' when expiring_offer_count>0 then 'offers' when owner_id is null then 'unassigned' when document_review_count>0 then 'documents' when analysis_status in ('draft','uncertain','failed','outdated') then 'analysis' when negotiation then 'negotiation' when waiting_lender_count>0 or jsonb_array_length(lenders)>0 then 'lender' else 'scheduled' end priority,
   case when reply_count>0 then 'team' when waiting_lender_count>0 then 'lender' when waiting_client_count>0 then 'client' else null end waiting_for
  from facts f
 ), filtered as (
  select * from signals where attention_filter='all' or (attention_filter='attention' and needs_attention) or (attention_filter='reply' and reply_count>0) or (attention_filter='overdue' and overdue) or (attention_filter='documents' and (document_review_count>0 or missing_document_count>0)) or (attention_filter='analysis' and (analysis_pending or analysis_status in ('draft','uncertain','failed','outdated'))) or (attention_filter='lender' and (waiting_lender_count>0 or jsonb_array_length(lenders)>0)) or (attention_filter='negotiation' and negotiation) or (attention_filter='offers' and expiring_offer_count>0)
 ), page as (select * from filtered order by needs_attention desc,case when priority='reply' then 0 when priority='overdue' then 1 when priority='offers' then 2 else 3 end,due_at nulls last,company,id limit 50 offset cursor_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'total',(select count(*) from filtered),'counts',jsonb_build_object('active',(select count(*) from signals),'attention',(select count(*) from signals where needs_attention),'reply',(select count(*) from signals where reply_count>0),'overdue',(select count(*) from signals where overdue),'documents',(select count(*) from signals where document_review_count>0 or missing_document_count>0),'analysis',(select count(*) from signals where analysis_pending or analysis_status in ('draft','uncertain','failed','outdated')),'lender',(select count(*) from signals where waiting_lender_count>0 or jsonb_array_length(lenders)>0),'negotiation',(select count(*) from signals where negotiation),'offers',(select count(*) from signals where expiring_offer_count>0)),'settings',to_jsonb(settings)) into result;
 return result;
end $$;
revoke all on function public.operational_dashboard(text,uuid,text,uuid,timestamptz,text,int) from public,anon;
grant execute on function public.operational_dashboard(text,uuid,text,uuid,timestamptz,text,int) to authenticated;
create index dashboard_open_tasks on public.tasks(opportunity_id,due_at) where status='open';
create index dashboard_waits on public.mail_waits(opportunity_id,waiting_for,since_at);
notify pgrst,'reload schema';commit;
