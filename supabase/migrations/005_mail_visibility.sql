begin;
-- A Gmail thread can span the handoff. Visibility belongs to each message,
-- not only the original thread, otherwise negotiations would leak to sellers.
alter table public.messages add column area public.case_area not null default 'seller';
update public.messages m set area=c.area from public.conversations c where c.id=m.conversation_id;
drop policy messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and public.can_area(c.opportunity_id,messages.area)));
alter table public.conversations drop constraint conversations_check;
alter table public.conversations add constraint conversation_scope check(area in ('seller','closer') and (submission_id is null or area='closer'));
create policy job_admin_read on public.jobs for select to authenticated using(public.current_app_role()='superadmin');
create policy outbox_admin_read on public.outbox for select to authenticated using(public.current_app_role()='superadmin');
grant select on public.jobs,public.outbox to authenticated;
-- Message-area derivation is also enforced for service-side sync inserts.
create function public.message_phase() returns trigger language plpgsql security definer set search_path='' as $$
declare handoff timestamptz; thread_area public.case_area;
begin
 select o.handed_off_at,c.area into handoff,thread_area from public.conversations c join public.opportunities o on o.id=c.opportunity_id where c.id=new.conversation_id;
 new.area:=case when thread_area='closer' or (handoff is not null and new.sent_at>=handoff) then 'closer'::public.case_area else 'seller'::public.case_area end;
 return new;
end $$;
create trigger message_phase_before_insert before insert on public.messages for each row execute function public.message_phase();
revoke all on function public.message_phase() from public,anon,authenticated;
grant execute on function public.message_phase() to service_role;
commit;
