begin;
create index gmail_candidates_thread_evidence on public.gmail_candidates using gin(evidence_ids);

-- A participant can outlive its original scan. Its authoritative scope is the
-- exact Gmail threads anchored by its evidence, within the scan's own mailbox.
-- Later messages in those threads must not depend on gmail_run_messages.
create function public.gmail_import_message_ids(run uuid,candidate uuid default null)
returns table(message_id uuid) language sql stable security definer set search_path='' as $$
 select m.id from public.gmail_archive_messages m join public.gmail_runs r on r.account_id=m.account_id
 where r.id=run and (
  (candidate is null and exists(select 1 from public.gmail_run_messages rm where rm.run_id=r.id and rm.message_id=m.id))
  or exists(select 1 from public.gmail_candidates c join public.gmail_archive_messages anchor on anchor.id=any(c.evidence_ids)
   where c.run_id=r.id and (candidate is null or c.id=candidate)
   and anchor.account_id=r.account_id and anchor.gmail_thread_id=m.gmail_thread_id)
 )
$$;
revoke all on function public.gmail_import_message_ids(uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_import_message_ids(uuid,uuid) to service_role;

-- Use the same scope to display files, save a choice, queue its copy and import
-- the full conversation. Existing selection, size and permission gates remain.
do $$ declare definition text;before_scope text;after_scope text;begin
 select pg_get_functiondef('public.gmail_attachment_list(uuid,uuid,uuid,text[],boolean,integer)'::regprocedure) into definition;
 before_scope:='exists(select 1 from public.gmail_run_messages rm where rm.run_id=run and rm.message_id=m.id)
 and (candidate is null or exists(select 1 from public.gmail_candidates c where c.id=candidate and m.id=any(c.evidence_ids)))';
 after_scope:='exists(select 1 from public.gmail_import_message_ids(run,candidate) scope where scope.message_id=m.id)';
 if position(before_scope in definition)=0 then raise exception 'Unexpected Gmail attachment listing definition';end if;
 execute replace(definition,before_scope,after_scope);

 select pg_get_functiondef('public.gmail_select_attachments(uuid,uuid,jsonb,boolean)'::regprocedure) into definition;
 definition:=replace(definition,'exists(select 1 from public.gmail_run_messages rm where rm.run_id=run and rm.message_id=m.id)',
  'exists(select 1 from public.gmail_import_message_ids(run,null) scope where scope.message_id=m.id)');
 definition:=replace(definition,'exists(select 1 from public.gmail_run_messages rm where rm.run_id=run and rm.message_id=s.archive_message_id)',
  'exists(select 1 from public.gmail_import_message_ids(run,null) scope where scope.message_id=s.archive_message_id)');
 execute definition;
end $$;

create or replace function public.gmail_import_message_page(run uuid,cursor_offset int)
returns setof public.gmail_archive_messages language sql security definer set search_path='' as $$
 select m.* from public.gmail_archive_messages m
 where exists(select 1 from public.gmail_import_message_ids(run,null) scope where scope.message_id=m.id)
 and exists(select 1 from public.gmail_thread_links l where l.account_id=m.account_id and l.gmail_thread_id=m.gmail_thread_id
  and exists(select 1 from public.gmail_candidates c where c.run_id=run and c.selected and c.imported_at is not null
   and c.result_opportunity_id=l.opportunity_id
   and exists(select 1 from public.gmail_import_message_ids(run,c.id) scope where scope.message_id=m.id)))
 order by m.id offset greatest(cursor_offset,0) limit 10
$$;

create function public.gmail_refresh_candidate_thread_stats(candidate uuid) returns void language plpgsql security definer set search_path='' as $$
declare person public.gmail_candidates;r public.gmail_runs;stats record;
begin
 select * into person from public.gmail_candidates where id=candidate for update;
 if person.id is null then return;end if;
 select * into r from public.gmail_runs where id=person.run_id;
 select count(*)::int n,count(*) filter(where m.direction='inbound')::int inbound,
  count(*) filter(where m.direction='outbound')::int outbound,count(*) filter(where m.nature='campaign')::int campaigns,
  coalesce(sum(jsonb_array_length(m.attachment_index)),0)::int attachments,
  coalesce(sum(jsonb_array_length(m.attachment_index)) filter(where m.sent_at>=r.copy_since),0)::int copies,
  min(m.sent_at) first_at,max(m.sent_at) last_at,max(m.sent_at) filter(where m.direction='inbound') last_received,
  max(m.sent_at) filter(where m.nature='personal') last_personal,
  array_agg(m.id order by m.sent_at desc,m.id) evidence into stats
 from public.gmail_archive_messages m where exists(select 1 from public.gmail_import_message_ids(person.run_id,person.id) scope where scope.message_id=m.id);
 if stats.n=0 then return;end if;
 update public.gmail_candidates set message_count=stats.n,inbound_count=stats.inbound,outbound_count=stats.outbound,
  campaign_count=stats.campaigns,attachment_count=stats.attachments,copy_count=stats.copies,
  first_at=stats.first_at,last_at=stats.last_at,last_received_at=stats.last_received,last_personal_at=stats.last_personal,evidence_ids=stats.evidence
 where id=person.id;
end $$;
revoke all on function public.gmail_refresh_candidate_thread_stats(uuid) from public,anon,authenticated;
grant execute on function public.gmail_refresh_candidate_thread_stats(uuid) to service_role;

-- Refresh every participant sharing this exact thread, including replies from
-- another sender/alias in the thread. A shared subject/address is not a thread.
alter function public.gmail_refresh_participant(uuid) rename to gmail_refresh_participant_v24;
create function public.gmail_refresh_participant(archive uuid) returns void language plpgsql security definer set search_path='' as $$
declare person record;incoming public.gmail_archive_messages;thread_messages uuid[];
begin
 perform public.gmail_refresh_participant_v24(archive);
 select * into incoming from public.gmail_archive_messages where id=archive;
 select array_agg(id) into thread_messages from public.gmail_archive_messages where account_id=incoming.account_id and gmail_thread_id=incoming.gmail_thread_id;
 for person in select distinct c.id from public.gmail_candidates c join public.gmail_runs r on r.id=c.run_id
  where r.account_id=incoming.account_id and c.evidence_ids && thread_messages
  order by c.id
 loop perform public.gmail_refresh_candidate_thread_stats(person.id);end loop;
end $$;
revoke all on function public.gmail_refresh_participant_v24(uuid),public.gmail_refresh_participant(uuid) from public,anon,authenticated;
grant execute on function public.gmail_refresh_participant(uuid) to service_role;

alter function public.gmail_build_preview(uuid,uuid) rename to gmail_build_preview_v24;
create function public.gmail_build_preview(run uuid,lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare person record;
begin
 perform public.gmail_build_preview_v24(run,lease);
 for person in select id from public.gmail_candidates where run_id=run order by id
 loop perform public.gmail_refresh_candidate_thread_stats(person.id);end loop;
end $$;
revoke all on function public.gmail_build_preview_v24(uuid,uuid),public.gmail_build_preview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_build_preview(uuid,uuid) to service_role;

-- Repair cached counters/evidence in bounded worker batches, preserving all
-- choices and already copied documents. This job never copies files itself.
insert into public.jobs(kind,payload,dedupe_key)
values('gmail_attachment_reconcile','{}','gmail-attachment-reconcile:026') on conflict do nothing;
notify pgrst,'reload schema';
commit;
