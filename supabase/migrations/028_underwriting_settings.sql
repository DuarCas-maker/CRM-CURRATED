begin;
alter table public.underwriting_settings add column rules jsonb not null default '{"sba":{"min_credit_score":640,"min_years":3,"max_positions_12_months":2,"requires_profitable_taxes":true},"tier1":{"min_credit_score":620,"min_months":18,"max_negative_days":7,"max_positions":1},"tier23":{"min_credit_score":600,"max_positions":4,"max_term_months":10},"reverse_min_positions":2}';
alter table public.underwriting_runs add column rules jsonb not null default '{"sba":{"min_credit_score":640,"min_years":3,"max_positions_12_months":2,"requires_profitable_taxes":true},"tier1":{"min_credit_score":620,"min_months":18,"max_negative_days":7,"max_positions":1},"tier23":{"min_credit_score":600,"max_positions":4,"max_term_months":10},"reverse_min_positions":2}';
create table public.underwriting_setting_versions (
 version int primary key,prompt text not null,model text not null,enabled boolean not null,max_output_tokens int not null,daily_run_limit int not null,rules jsonb not null,
 updated_by uuid references public.profiles,updated_at timestamptz not null default now()
);
insert into public.underwriting_setting_versions select version,prompt,model,enabled,max_output_tokens,daily_run_limit,rules,updated_by,updated_at from public.underwriting_settings;
alter table public.underwriting_setting_versions enable row level security;
create policy underwriting_versions_read on public.underwriting_setting_versions for select to authenticated using(public.current_app_role() is not null);
grant select on public.underwriting_setting_versions to authenticated;
grant all on public.underwriting_setting_versions to service_role;
create function public.snapshot_underwriting_rules() returns trigger language plpgsql security definer set search_path='' as $$
begin select rules into new.rules from public.underwriting_settings where id=1;return new;end $$;
create trigger underwriting_rules_snapshot before insert on public.underwriting_runs for each row execute function public.snapshot_underwriting_rules();

create function public.save_underwriting_settings(p jsonb,request_key uuid) returns int language plpgsql security definer set search_path='' as $$
declare current_value public.underwriting_settings;receipt public.command_receipts;actor uuid:=auth.uid();
begin
 if public.current_app_role()<>'superadmin' or public.current_app_role() is null then raise exception 'Superadmin and MFA required';end if;
 if request_key is null then raise exception 'Idempotency key required';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,0));
 select * into receipt from public.command_receipts r where r.user_id=actor and r.request_key=save_underwriting_settings.request_key;
 if found then
  if receipt.kind<>'underwriting_settings' or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused';end if;
  return (receipt.result->>'version')::int;
 end if;
 select * into current_value from public.underwriting_settings where id=1 for update;
 if current_value.version is distinct from (p->>'expected_version')::int then raise exception 'Settings changed; reload before saving';end if;
 if length(btrim(p->>'prompt'))<100 or length(p->>'prompt')>30000 then raise exception 'Prompt must contain 100 to 30000 characters';end if;
 if p->>'model' not in ('gpt-6.1-sol','gpt-6-sol','gpt-6-luna','gpt-6-astra') then raise exception 'Choose a supported model';end if;
 if coalesce(jsonb_typeof(p->'rules')<>'object' or jsonb_typeof(p->'rules'->'sba')<>'object' or jsonb_typeof(p->'rules'->'tier1')<>'object' or jsonb_typeof(p->'rules'->'tier23')<>'object',true) then raise exception 'Screening rules required';end if;
 if coalesce((p->'rules'->'sba'->>'min_credit_score')::int not between 300 and 850 or (p->'rules'->'sba'->>'min_years')::numeric not between 0 and 50 or (p->'rules'->'sba'->>'max_positions_12_months')::int not between 0 and 20
  or (p->'rules'->'tier1'->>'min_credit_score')::int not between 300 and 850 or (p->'rules'->'tier1'->>'min_months')::int not between 0 and 600 or (p->'rules'->'tier1'->>'max_negative_days')::int not between 0 and 124 or (p->'rules'->'tier1'->>'max_positions')::int not between 0 and 4
  or (p->'rules'->'tier23'->>'min_credit_score')::int not between 300 and 850 or (p->'rules'->'tier23'->>'max_positions')::int not between 1 and 20 or (p->'rules'->'tier23'->>'max_term_months')::int not between 1 and 60
  or (p->'rules'->>'reverse_min_positions')::int not between 1 and 20 or jsonb_typeof(p->'rules'->'sba'->'requires_profitable_taxes')<>'boolean',true) then raise exception 'Invalid screening rules';end if;
 update public.underwriting_settings set version=version+1,prompt=p->>'prompt',model=p->>'model',enabled=(p->>'enabled')::boolean,
  max_output_tokens=(p->>'max_output_tokens')::int,daily_run_limit=(p->>'daily_run_limit')::int,rules=p->'rules',updated_by=actor,updated_at=now() where id=1;
 insert into public.underwriting_setting_versions select version,prompt,model,enabled,max_output_tokens,daily_run_limit,rules,updated_by,updated_at from public.underwriting_settings;
 if not (p->>'enabled')::boolean then update public.underwriting_runs set status='failed',last_error='UNDERWRITING_DISABLED' where status in ('queued','preparing');end if;
 insert into public.audit_log(actor_id,entity_type,action,metadata) values(actor,'underwriting_settings','updated',jsonb_build_object('version',current_value.version+1));
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request_key,'underwriting_settings',jsonb_build_object('version',current_value.version+1),md5(p::text));
 return current_value.version+1;
end $$;
revoke all on function public.save_underwriting_settings(jsonb,uuid) from public,anon;
grant execute on function public.save_underwriting_settings(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
