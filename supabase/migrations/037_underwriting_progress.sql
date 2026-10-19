begin;
-- More headroom is configurable, without raising existing spending limits automatically.
alter table public.underwriting_settings drop constraint underwriting_settings_max_output_tokens_check;
alter table public.underwriting_settings add constraint underwriting_settings_max_output_tokens_check check(max_output_tokens between 2000 and 32000);
alter table public.underwriting_runs add column progress_stage text not null default 'queued';
alter table public.underwriting_runs add column progress_percent int not null default 0 check(progress_percent between 0 and 100);
alter table public.underwriting_runs add column documents_processed int not null default 0 check(documents_processed between 0 and 24);
alter table public.underwriting_runs add column progress_updated_at timestamptz not null default now();
alter table public.underwriting_runs add column provider_diagnostics jsonb;

create function public.sync_underwriting_progress() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('draft','approved') then new.progress_stage:='complete';new.progress_percent:=100;new.documents_processed:=jsonb_array_length(new.document_snapshot);
 elsif new.status='running' then new.progress_stage:='analyzing';new.progress_percent:=50;
 elsif new.status='preparing' then new.progress_stage:='preparing';new.progress_percent:=5;new.documents_processed:=0;
 elsif new.status in ('failed','uncertain','outdated') then new.progress_stage:=new.status;new.progress_percent:=least(new.progress_percent,95);
 else new.progress_stage:='queued';new.progress_percent:=0;end if;
 new.progress_updated_at:=now();return new;
end $$;
create trigger sync_underwriting_progress before insert or update of status on public.underwriting_runs for each row execute function public.sync_underwriting_progress();
-- Existing failures cannot be given a cause that was never saved.
update public.underwriting_runs set status=status;

create function public.report_underwriting_progress(run_id uuid,job_id uuid,lease uuid,stage text,processed int default null,diagnostic jsonb default null) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.underwriting_runs;percent int;clean jsonb;
begin
 if not exists(select 1 from public.jobs j where j.id=job_id and j.kind='underwriting' and j.payload->>'run_id'=run_id::text and j.status='running' and j.lease_token=lease and j.locked_at>now()-interval '5 minutes') then return false;end if;
 select * into r from public.underwriting_runs where id=run_id and job_lease=lease and status in ('preparing','running') for update;
 if r.id is null then return false;end if;
 if stage not in ('documents','analyzing','validating','saving','diagnostics') or stage is null then raise exception 'Invalid analysis stage';end if;
 if processed is not null and (processed<r.documents_processed or processed>jsonb_array_length(r.document_snapshot) or processed>24) then raise exception 'Invalid document progress';end if;
 if stage in ('analyzing','validating','saving') and r.status<>'running' then return false;end if;
 if diagnostic is not null then
  if jsonb_typeof(diagnostic)<>'object' then raise exception 'Invalid diagnostic';end if;
  clean:=jsonb_build_object('status',case when diagnostic->>'status' in ('completed','incomplete','failed','cancelled','queued','in_progress') then diagnostic->>'status' else 'unknown' end,
   'incomplete_reason',case when diagnostic->>'incomplete_reason' in ('max_output_tokens','content_filter') then diagnostic->>'incomplete_reason' else null end,'max_output_tokens',r.max_output_tokens);
 end if;
 percent:=case stage when 'documents' then 10+floor(30.0*coalesce(processed,r.documents_processed)/greatest(1,jsonb_array_length(r.document_snapshot)))::int when 'analyzing' then 50 when 'validating' then 85 when 'saving' then 95 else r.progress_percent end;
 if stage<>'diagnostics' and percent<r.progress_percent then return false;end if;
 update public.underwriting_runs set progress_stage=case when stage='diagnostics' then progress_stage else stage end,progress_percent=greatest(progress_percent,percent),documents_processed=coalesce(processed,documents_processed),provider_diagnostics=coalesce(clean,provider_diagnostics),progress_updated_at=now() where id=r.id;
 return true;
end $$;
revoke all on function public.report_underwriting_progress(uuid,uuid,uuid,text,int,jsonb) from public,anon,authenticated;
grant execute on function public.report_underwriting_progress(uuid,uuid,uuid,text,int,jsonb) to service_role;
notify pgrst,'reload schema';commit;
