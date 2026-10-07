begin;
create table public.stage_history (
 id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities,
 stage public.case_stage not null, entered_at timestamptz not null default now(), exited_at timestamptz,
 actor_id uuid references public.profiles
);
create unique index one_open_stage on public.stage_history(opportunity_id) where exited_at is null;
create index stage_history_case on public.stage_history(opportunity_id,entered_at);
alter table public.stage_history enable row level security;
revoke all on public.stage_history from anon,authenticated;
grant select on public.stage_history to authenticated;
grant all on public.stage_history to service_role;
create policy stage_history_read on public.stage_history for select to authenticated using(public.can_case(opportunity_id));
insert into public.stage_history(opportunity_id,stage,entered_at) select id,stage,created_at from public.opportunities;
create function public.track_case_changes() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  insert into public.stage_history(opportunity_id,stage,actor_id) values(new.id,new.stage,auth.uid());
 else
  if old.stage is distinct from new.stage then
   update public.stage_history set exited_at=now() where opportunity_id=new.id and exited_at is null;
   insert into public.stage_history(opportunity_id,stage,actor_id) values(new.id,new.stage,auth.uid());
  end if;
  if old.seller_id is distinct from new.seller_id or old.closer_id is distinct from new.closer_id or old.stage is distinct from new.stage then
   insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'opportunity',new.id,'case_changed',jsonb_build_object('from_seller',old.seller_id,'to_seller',new.seller_id,'from_closer',old.closer_id,'to_closer',new.closer_id,'from_stage',old.stage,'to_stage',new.stage));
  end if;
 end if;
 return new;
end $$;
create trigger case_history after insert or update on public.opportunities for each row execute function public.track_case_changes();
create function public.record_sent_documents() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='sent' and old.status<>'sent' and new.submission_id is not null then
  insert into public.submission_documents(outbox_id,document_id,submission_id,storage_path,content_hash,sent_at)
   select new.id,(entry->>'id')::uuid,new.submission_id,entry->>'storage_path',entry->>'content_hash',new.sent_at from jsonb_array_elements(new.attachment_snapshot) entry on conflict do nothing;
 end if;
 return new;
end $$;
create trigger sent_document_snapshot after update of status on public.outbox for each row execute function public.record_sent_documents();
revoke all on function public.track_case_changes(),public.record_sent_documents() from public,anon,authenticated;
grant execute on function public.track_case_changes(),public.record_sent_documents() to service_role;
-- Enrich global metrics under the caller's RLS policies, independently of UI pagination.
alter function public.workspace_stats(text,text,uuid,uuid,timestamptz) rename to workspace_stats_base;
create function public.workspace_stats(search_text text default '',stage_filter text default null,owner_filter uuid default null,campaign_filter uuid default null,since_filter timestamptz default null) returns jsonb language sql stable security invoker set search_path='' as $$
 with filtered as(select * from public.opportunity_workspace o where o.archived_at is null and (search_text='' or o.company ilike '%'||search_text||'%' or o.contact ilike '%'||search_text||'%' or o.email ilike '%'||search_text||'%') and (stage_filter is null or o.stage::text=stage_filter) and (owner_filter is null or o.seller_id=owner_filter or o.closer_id=owner_filter) and (campaign_filter is null or o.campaign_id=campaign_filter) and (since_filter is null or o.created_at>=since_filter)),
 owners as(select coalesce(closer_id,seller_id) id,count(*) total,sum(amount) amount from filtered group by coalesce(closer_id,seller_id)),
 durations as(select h.stage,round(avg(extract(epoch from (coalesce(h.exited_at,now())-h.entered_at)))/86400,2) days from public.stage_history h where h.opportunity_id in(select id from filtered) group by h.stage)
 select public.workspace_stats_base(search_text,stage_filter,owner_filter,campaign_filter,since_filter)||jsonb_build_object('owners',coalesce((select jsonb_agg(owners) from owners),'[]'::jsonb),'stage_days',coalesce((select jsonb_object_agg(stage,days) from durations),'{}'::jsonb),'imported',(select count(*) from filtered where exists(select 1 from public.import_rows r where r.contact_id=filtered.contact_id and r.result='imported')))
$$;
revoke all on function public.workspace_stats(text,text,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.workspace_stats(text,text,uuid,uuid,timestamptz) to authenticated,service_role;
create view public.opportunity_inbox with(security_invoker=true) as select o.* from public.opportunity_workspace o where exists(select 1 from public.conversations c where c.opportunity_id=o.id);
create view public.opportunity_tasks with(security_invoker=true) as select o.* from public.opportunity_workspace o where exists(select 1 from public.tasks t where t.opportunity_id=o.id and t.status='open');
grant select on public.opportunity_inbox,public.opportunity_tasks to authenticated;
create function public.enqueue_overdue() returns void language plpgsql security definer set search_path='' as $$
declare task public.tasks;
begin
 for task in select t.* from public.tasks t where t.status='open' and t.due_at<now() and not exists(select 1 from public.notifications n where n.user_id=t.owner_id and n.event_key='overdue:'||t.id||':'||extract(epoch from t.due_at)::text) order by t.due_at limit 500 loop
  perform public.notify_user(task.owner_id,'overdue:'||task.id||':'||extract(epoch from task.due_at)::text,'A task is overdue');
 end loop;
end $$;
revoke all on function public.enqueue_overdue() from public,anon,authenticated;
grant execute on function public.enqueue_overdue() to service_role;
drop policy import_rows_read on public.import_rows;
create policy import_rows_read on public.import_rows for select to authenticated using(public.current_app_role() in ('superadmin','seller_admin') or exists(select 1 from public.opportunities o where o.contact_id=import_rows.contact_id and public.can_case(o.id)));
create function public.track_task() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or old.status is distinct from new.status then
  insert into public.activities(opportunity_id,actor_id,type,area,body) values(new.opportunity_id,auth.uid(),'task',new.area,new.title||' · '||new.status);
 end if;
 return new;
end $$;
create trigger task_activity after insert or update of status on public.tasks for each row execute function public.track_task();
create function public.track_analysis() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.activities(opportunity_id,actor_id,type,area,body) values(new.opportunity_id,new.reviewer_id,'analysis','seller',new.summary);
 return new;
end $$;
create trigger analysis_activity after insert on public.analyses for each row execute function public.track_analysis();
revoke all on function public.track_task(),public.track_analysis() from public,anon,authenticated;
grant execute on function public.track_task(),public.track_analysis() to service_role;
create function public.track_message_contact() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.opportunities o set last_contact=greatest(o.last_contact,new.sent_at),stage=case when new.direction='inbound' and o.handed_off_at is null and o.stage in ('new','contacting') and exists(select 1 from public.contacts ct where ct.id=o.contact_id and ct.email=new.sender) then 'replied'::public.case_stage else o.stage end where o.id=(select c.opportunity_id from public.conversations c where c.id=new.conversation_id);
 return new;
end $$;
create trigger message_contact after insert on public.messages for each row execute function public.track_message_contact();
revoke all on function public.track_message_contact() from public,anon,authenticated;
grant execute on function public.track_message_contact() to service_role;
commit;
