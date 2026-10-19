begin;
create table public.ai_usage_events (
 id uuid primary key,
 service text not null check(service in ('risk_analysis','application_extraction','document_classification')),
 credential_name text generated always as (case service when 'risk_analysis' then 'R_OPENAI_API_KEY' when 'application_extraction' then 'A_OPENAI_API_KEY' else 'D_OPENAI_API_KEY' end) stored,
 model text not null check(length(model) between 1 and 120),
 opportunity_id uuid references public.opportunities on delete set null,
 actor_id uuid references public.profiles on delete set null,
 underwriting_run_id uuid references public.underwriting_runs on delete set null,
 status text not null default 'started' check(status in ('started','completed','failed','uncertain')),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 provider_response_id text check(provider_response_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 input_tokens int check(input_tokens>=0),
 output_tokens int check(output_tokens>=0),
 cached_input_tokens int check(cached_input_tokens>=0),
 reasoning_tokens int check(reasoning_tokens>=0),
 duration_ms int check(duration_ms>=0),
 error_code text check(error_code ~ '^OPENAI_[A-Z_]{1,80}$'),
 check(cached_input_tokens is null or input_tokens is null or cached_input_tokens<=input_tokens),
 check(reasoning_tokens is null or output_tokens is null or reasoning_tokens<=output_tokens),
 check((status='started' and finished_at is null) or (status<>'started' and finished_at is not null)),
 check(underwriting_run_id is null or service='risk_analysis')
);
create index ai_usage_events_time on public.ai_usage_events(started_at desc);
create index ai_usage_events_service_time on public.ai_usage_events(service,started_at desc);
create unique index ai_usage_events_risk_once on public.ai_usage_events(underwriting_run_id) where underwriting_run_id is not null;
alter table public.ai_usage_events enable row level security;
create policy ai_usage_events_admin_read on public.ai_usage_events for select to authenticated using(public.current_app_role()='superadmin');
revoke all on public.ai_usage_events from public,anon,authenticated,service_role;
grant select on public.ai_usage_events to authenticated,service_role;
grant insert on public.ai_usage_events to service_role;

create function public.finish_ai_usage_event(event_id uuid,result jsonb) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if result->>'status' is null or result->>'status' not in ('completed','failed','uncertain') then raise exception 'Invalid usage status';end if;
 update public.ai_usage_events set status=result->>'status',finished_at=clock_timestamp(),
  provider_response_id=result->>'provider_response_id',
  input_tokens=(result->>'input_tokens')::int,output_tokens=(result->>'output_tokens')::int,
  cached_input_tokens=(result->>'cached_input_tokens')::int,reasoning_tokens=(result->>'reasoning_tokens')::int,
  duration_ms=(result->>'duration_ms')::int,error_code=result->>'error_code'
 where id=event_id and status='started';
 return found;
end $$;
revoke all on function public.finish_ai_usage_event(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_ai_usage_event(uuid,jsonb) to service_role;

create function public.ai_usage_summary(days int default 30) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare since_time timestamptz; result jsonb;
begin
 if public.current_app_role() is distinct from 'superadmin' then raise exception 'Superadmin required';end if;
 if days is null or days<1 or days>90 then raise exception 'Invalid date range';end if;
 since_time:=now()-make_interval(days=>days);
 select jsonb_build_object('since',since_time,'summary',coalesce((
  select jsonb_agg(to_jsonb(s) order by s.service,s.model) from (
   select service,model,count(*) as calls,
    count(*) filter(where status='completed') as completed,count(*) filter(where status='failed') as failed,
    count(*) filter(where status='uncertain') as uncertain,count(*) filter(where status='started') as started,
    count(*) filter(where input_tokens is null or output_tokens is null) as unknown_usage,
    coalesce(sum(input_tokens),0) as input_tokens,coalesce(sum(output_tokens),0) as output_tokens,
    coalesce(sum(cached_input_tokens),0) as cached_input_tokens,coalesce(sum(reasoning_tokens),0) as reasoning_tokens
   from public.ai_usage_events where started_at>=since_time group by service,model
  ) s),'[]'::jsonb),'events',coalesce((
   select jsonb_agg(to_jsonb(e) order by e.started_at desc,e.id desc) from (
    select id,service,credential_name,model,status,started_at,finished_at,opportunity_id,actor_id,
     input_tokens,output_tokens,cached_input_tokens,reasoning_tokens,error_code,provider_response_id
    from public.ai_usage_events where started_at>=since_time order by started_at desc,id desc limit 50
   ) e),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.ai_usage_summary(int) from public,anon;
grant execute on function public.ai_usage_summary(int) to authenticated;
notify pgrst,'reload schema';
commit;
