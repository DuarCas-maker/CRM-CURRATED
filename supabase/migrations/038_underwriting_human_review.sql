begin;
alter table public.underwriting_runs drop constraint underwriting_runs_status_check;
alter table public.underwriting_runs add constraint underwriting_runs_status_check check(status in ('queued','preparing','running','draft','approved','rejected','failed','uncertain','outdated'));
alter table public.underwriting_runs add column reviewed_by uuid references public.profiles;
alter table public.underwriting_runs add column reviewed_at timestamptz;
alter table public.underwriting_runs add column review_notes text not null default '' check(length(review_notes)<=20000);

-- A saved report is complete regardless of the human's decision about its findings.
create or replace function public.sync_underwriting_progress() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('draft','approved','rejected') then new.progress_stage:='complete';new.progress_percent:=100;new.documents_processed:=jsonb_array_length(new.document_snapshot);
 elsif new.status='running' then new.progress_stage:='analyzing';new.progress_percent:=50;
 elsif new.status='preparing' then new.progress_stage:='preparing';new.progress_percent:=5;new.documents_processed:=0;
 elsif new.status in ('failed','uncertain','outdated') then new.progress_stage:=new.status;new.progress_percent:=least(new.progress_percent,95);
 else new.progress_stage:='queued';new.progress_percent:=0;end if;
 new.progress_updated_at:=now();return new;
end $$;

create function public.record_underwriting_human_review() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='approved' and old.status<>'approved' then
  new.reviewed_by:=auth.uid();new.reviewed_at:=now();
 end if;
 return new;
end $$;
create trigger record_underwriting_human_review before update of status on public.underwriting_runs for each row execute function public.record_underwriting_human_review();

create function public.reject_underwriting(run_id uuid,notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.underwriting_runs;o public.opportunities;
begin
 select * into r from public.underwriting_runs where id=run_id;
 select * into o from public.opportunities where id=r.opportunity_id for update;
 if public.current_app_role() is null or o.id is null or not public.can_edit_case(o.id) then raise exception 'Case is inaccessible or read-only';end if;
 select * into r from public.underwriting_runs where id=run_id for update;
 if r.status='rejected' then return r.id;end if;
 if r.status<>'draft' or r.report is null then raise exception 'Analysis draft required';end if;
 if coalesce(btrim(notes),'')='' or length(notes)>20000 then raise exception 'Review note required (1-20000 characters)';end if;
 update public.underwriting_runs set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),review_notes=btrim(notes) where id=r.id;
 insert into public.activities(opportunity_id,actor_id,type,area,body) values(o.id,auth.uid(),'analysis',case when o.handed_off_at is null then 'seller'::public.case_area else 'closer'::public.case_area end,'AI analysis discarded by the team: '||btrim(notes));
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(auth.uid(),'underwriting',r.id,'rejected',jsonb_build_object('notes',btrim(notes)));
 return r.id;
end $$;
revoke all on function public.reject_underwriting(uuid,text) from public,anon;
grant execute on function public.reject_underwriting(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
