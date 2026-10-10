begin;
create function public.gmail_preview_stats(run uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if public.current_app_role() is distinct from 'superadmin'::public.app_role then raise exception 'Superadmin required'; end if;
 select jsonb_build_object('messages',count(*),'first_at',min(m.sent_at),'last_at',max(m.sent_at),
 'documents',coalesce(sum(jsonb_array_length(m.attachment_index)),0),
 'documents_to_copy',coalesce(sum(case when m.sent_at>=r.copy_since then jsonb_array_length(m.attachment_index) else 0 end),0)) into result
 from public.gmail_run_messages rm join public.gmail_archive_messages m on m.id=rm.message_id join public.gmail_runs r on r.id=rm.run_id where rm.run_id=run;
 return result||jsonb_build_object('candidates',(select count(*) from public.gmail_candidates where run_id=run),
 'selected',(select count(*) from public.gmail_candidates where run_id=run and selected),
 'matches',(select count(*) from public.gmail_candidates where run_id=run and existing_contact_id is not null),
 'ambiguous',(select count(*) from public.gmail_candidates where run_id=run and (copied_only or cardinality(candidate_opportunity_ids)>1)),
 'months',coalesce((select jsonb_agg(x order by x.month_label) from (
 select to_char(m.sent_at,'YYYY-MM') month_label,count(distinct m.id) messages,count(distinct p->>'email') direct_participants
 from public.gmail_run_messages rm join public.gmail_archive_messages m on m.id=rm.message_id cross join lateral jsonb_array_elements(m.participants) p
 where rm.run_id=run and ((m.direction='inbound' and p->>'role'='from') or (m.direction='outbound' and p->>'role'='to'))
 and not exists(select 1 from public.mail_accounts a where a.email=p->>'email') group by 1) x),'[]'::jsonb));
end $$;
revoke all on function public.gmail_preview_stats(uuid) from public,anon;
grant execute on function public.gmail_preview_stats(uuid) to authenticated,service_role;
create function public.gmail_import_message_page(run uuid,cursor_offset int) returns setof public.gmail_archive_messages language sql security definer set search_path='' as $$
 select m.* from public.gmail_archive_messages m join public.gmail_run_messages rm on rm.message_id=m.id
 where rm.run_id=run and exists(select 1 from public.gmail_thread_links l
 where l.account_id=m.account_id and l.gmail_thread_id=m.gmail_thread_id and exists(
  select 1 from public.gmail_candidates c join public.gmail_archive_messages evidence on evidence.id=any(c.evidence_ids)
  where c.run_id=run and c.selected and c.imported_at is not null and c.result_opportunity_id=l.opportunity_id
  and evidence.account_id=m.account_id and evidence.gmail_thread_id=m.gmail_thread_id))
 order by m.id offset greatest(cursor_offset,0) limit 10
$$;
revoke all on function public.gmail_import_message_page(uuid,int) from public,anon,authenticated;
grant execute on function public.gmail_import_message_page(uuid,int) to service_role;
create function public.gmail_unlinked_message_count(run uuid) returns int language sql security definer set search_path='' as $$
 select count(*)::int from public.gmail_run_messages rm join public.gmail_archive_messages m on m.id=rm.message_id
 where rm.run_id=run and not exists(select 1 from public.gmail_thread_links l where l.account_id=m.account_id and l.gmail_thread_id=m.gmail_thread_id)
$$;
create function public.gmail_archive_checkpoint(account uuid,checkpoint text) returns void language sql security definer set search_path='' as $$
 insert into public.gmail_sync_state(account_id,history_id) values(account,checkpoint)
 on conflict(account_id) do update set history_id=case when public.gmail_sync_state.history_id is null or public.gmail_sync_state.history_id::numeric<excluded.history_id::numeric then excluded.history_id else public.gmail_sync_state.history_id end
$$;
revoke all on function public.gmail_unlinked_message_count(uuid),public.gmail_archive_checkpoint(uuid,text) from public,anon,authenticated;
grant execute on function public.gmail_unlinked_message_count(uuid),public.gmail_archive_checkpoint(uuid,text) to service_role;
commit;
