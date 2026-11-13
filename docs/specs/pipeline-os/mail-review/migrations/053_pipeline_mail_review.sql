-- Additive release candidate after the coordinated 048–052 packages. Local tests apply this explicitly.
begin;
create table public.pipeline_mail_reviews (
 id uuid primary key default gen_random_uuid(), message_id uuid not null unique references public.messages,
 opportunity_id uuid not null references public.opportunities, process_id uuid not null references public.financing_processes,
 submission_id uuid not null references public.submissions, source_hash text not null,
 analysis_key uuid not null unique, revision int not null default 1 check(revision>0),
 status text not null default 'analyzing' check(status in ('analyzing','ready','failed','approved')),
 proposal jsonb, approved_value jsonb, approval_key uuid, result jsonb, error_code text,
 created_by uuid not null references public.profiles, approved_by uuid references public.profiles,
 created_at timestamptz not null default now(), analysis_at timestamptz not null default now(), approved_at timestamptz
);
create index pipeline_mail_reviews_case_time on public.pipeline_mail_reviews(opportunity_id,approved_at desc);
create table public.pipeline_mail_review_attempts (
 review_id uuid not null references public.pipeline_mail_reviews, revision int not null,
 snapshot jsonb not null, restarted_by uuid not null references public.profiles, restarted_at timestamptz not null default now(),
 primary key(review_id,revision)
);
create table public.pipeline_mail_requirements (
 id uuid primary key default gen_random_uuid(), review_id uuid not null unique references public.pipeline_mail_reviews,
 opportunity_id uuid not null references public.opportunities, process_id uuid not null references public.financing_processes,
 submission_id uuid not null references public.submissions, message_id uuid not null references public.messages,
 body text not null check(length(btrim(body)) between 1 and 3000), created_at timestamptz not null default now()
);
alter table public.pipeline_mail_reviews enable row level security;
alter table public.pipeline_mail_review_attempts enable row level security;
alter table public.pipeline_mail_requirements enable row level security;
revoke all on public.pipeline_mail_reviews,public.pipeline_mail_requirements,public.pipeline_mail_review_attempts from public,anon,authenticated,service_role;
grant select on public.pipeline_mail_reviews,public.pipeline_mail_requirements,public.pipeline_mail_review_attempts to authenticated;
create policy pipeline_mail_reviews_read on public.pipeline_mail_reviews for select to authenticated using(
 public.can_edit_case(opportunity_id) and public.can_area(opportunity_id,'closer') and exists(
 select 1 from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=message_id and c.opportunity_id=pipeline_mail_reviews.opportunity_id));
create policy pipeline_mail_requirements_read on public.pipeline_mail_requirements for select to authenticated using(
 exists(select 1 from public.pipeline_mail_reviews r where r.id=review_id));
create policy pipeline_mail_attempts_read on public.pipeline_mail_review_attempts for select to authenticated using(
 exists(select 1 from public.pipeline_mail_reviews r where r.id=review_id));

-- Internal authorization/context contract. No service-role fallback for source reads.
create function public.pipeline_mail_source(message uuid,process uuid,submission uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m public.messages;c public.conversations;
begin
 select * into m from public.messages where id=message;
 select * into c from public.conversations where id=m.conversation_id;
 if public.current_app_role() is null or m.id is null or not public.can_edit_case(c.opportunity_id)
  or not public.can_area(c.opportunity_id,'closer') or not public.can_mail_case(c.opportunity_id)
 then raise exception 'MR_FORBIDDEN' using errcode='42501';end if;
 if m.direction<>'inbound' or m.status<>'received' then raise exception 'MR_SOURCE_INVALID';end if;
 if length(m.body)>40000 then raise exception 'MR_SOURCE_TOO_LARGE';end if;
 if (c.process_id is not null and c.process_id<>process) or (c.submission_id is not null and c.submission_id<>submission)
  or not exists(select 1 from public.financing_processes p where p.id=process and p.opportunity_id=c.opportunity_id and p.classification='active' and not p.is_unclassified_archive)
  or not exists(select 1 from public.submissions s where s.id=submission and s.opportunity_id=c.opportunity_id and s.process_id=process)
  or exists(select 1 from public.gmail_thread_links g where g.account_id=c.account_id and g.gmail_thread_id=c.gmail_thread_id
    and (g.opportunity_id<>c.opportunity_id or g.process_id<>process or (g.submission_id is not null and g.submission_id<>submission)))
 then raise exception 'MR_ASSOCIATION_REQUIRED';end if;
 return jsonb_build_object('opportunity_id',c.opportunity_id,'body',m.body,'subject',c.subject,
  'hash',md5(jsonb_build_array(m.body,m.conversation_id,c.opportunity_id,c.process_id,c.submission_id,m.direction,m.sent_at,m.sender)::text));
end $$;
revoke all on function public.pipeline_mail_source(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.pipeline_mail_page(case_id uuid,before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if public.current_app_role() is null or not public.can_edit_case(case_id) or not public.can_area(case_id,'closer') or not public.can_mail_case(case_id)
 then raise exception 'MR_FORBIDDEN' using errcode='42501';end if;
 with page as (
 select m.id,m.sender,m.sent_at,left(m.body,12000) body,c.subject,coalesce(c.process_id,g.process_id) process_id,coalesce(c.submission_id,g.submission_id) submission_id,to_jsonb(r) review
 from public.messages m join public.conversations c on c.id=m.conversation_id
 left join public.gmail_thread_links g on g.account_id=c.account_id and g.gmail_thread_id=c.gmail_thread_id
 left join public.pipeline_mail_reviews r on r.message_id=m.id
 where c.opportunity_id=case_id and m.direction='inbound' and m.status='received' and (before_id is null or m.id<before_id)
 order by m.id desc limit 21), visible as (select * from page order by id desc limit 20)
 select jsonb_build_object('messages',coalesce((select jsonb_agg(to_jsonb(v) order by v.id desc) from visible v),'[]'::jsonb),
 'next_cursor',case when (select count(*) from page)>20 then (select id from visible order by id limit 1) end,
 'processes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label) order by sequence_number desc) from public.financing_processes where opportunity_id=case_id and classification='active' and not is_unclassified_archive),'[]'::jsonb),
 'submissions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'process_id',s.process_id,'lender_name',l.name) order by s.id) from public.submissions s join public.lenders l on l.id=s.lender_id where s.opportunity_id=case_id),'[]'::jsonb),
 'owners',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.name) from public.profiles p join public.opportunities o on o.id=case_id where p.active and (p.role in ('superadmin','closer_admin') or (p.role='closer' and p.id=o.closer_id))),'[]'::jsonb),
 'owner_id',(select coalesce(closer_id,auth.uid()) from public.opportunities where id=case_id)) into result;
 return result;
end $$;
revoke all on function public.pipeline_mail_page(uuid,uuid) from public,anon;
grant execute on function public.pipeline_mail_page(uuid,uuid) to authenticated;

create function public.pipeline_mail_begin(message uuid,process uuid,submission uuid,request_key uuid,retry boolean default false,expected_revision int default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare source jsonb;r public.pipeline_mail_reviews;fresh boolean:=false;
begin
 if request_key is null then raise exception 'MR_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(message::text,53));
 source:=public.pipeline_mail_source(message,process,submission);
 select * into r from public.pipeline_mail_reviews where message_id=message for update;
 if r.id is null then
  insert into public.pipeline_mail_reviews(message_id,opportunity_id,process_id,submission_id,source_hash,analysis_key,created_by)
  values(message,(source->>'opportunity_id')::uuid,process,submission,source->>'hash',request_key,auth.uid()) returning * into r;
  fresh:=true;
 elsif retry and r.analysis_key<>request_key then
  if r.opportunity_id is distinct from (source->>'opportunity_id')::uuid then raise exception 'MR_CONTEXT_CHANGED';end if;
  if expected_revision is distinct from r.revision or not (r.status in ('failed','ready') or (r.status='analyzing' and r.analysis_at<now()-interval '5 minutes')) then raise exception 'MR_STALE';end if;
  insert into public.pipeline_mail_review_attempts(review_id,revision,snapshot,restarted_by) values(r.id,r.revision,to_jsonb(r),auth.uid());
  update public.pipeline_mail_reviews set analysis_key=request_key,revision=revision+1,status='analyzing',proposal=null,error_code=null,analysis_at=now(),
   process_id=process,submission_id=submission,source_hash=source->>'hash' where id=r.id returning * into r;
  insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'pipeline_mail_review',r.id,'analysis_restarted');
  fresh:=true;
 elsif r.process_id<>process or r.submission_id<>submission or r.source_hash<>source->>'hash' then raise exception 'MR_CONTEXT_CHANGED';
 end if;
 return jsonb_build_object('review',to_jsonb(r),'fresh',fresh,'source',case when fresh then source end);
end $$;
revoke all on function public.pipeline_mail_begin(uuid,uuid,uuid,uuid,boolean,int) from public,anon;
grant execute on function public.pipeline_mail_begin(uuid,uuid,uuid,uuid,boolean,int) to authenticated;

create function public.pipeline_mail_finish(review_id uuid,attempt uuid,value jsonb,failure text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if (value is not null and (jsonb_typeof(value)<>'object' or octet_length(value::text)>30000)) or (failure is not null and failure!~'^[A-Z_]{1,80}$') then raise exception 'MR_INVALID';end if;
 update public.pipeline_mail_reviews set status=case when failure is null then 'ready' else 'failed' end,proposal=value,error_code=failure,revision=revision+1
 where id=review_id and analysis_key=attempt and status='analyzing';
end $$;
revoke all on function public.pipeline_mail_finish(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.pipeline_mail_finish(uuid,uuid,jsonb,text) to service_role;

create function public.pipeline_mail_approve(review_id uuid,expected_revision int,request_key uuid,value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.pipeline_mail_reviews;source jsonb;owner uuid;due timestamptz;expiry timestamptz;
 offer_id uuid;requirement_id uuid;task_id uuid;event_id uuid;event_kind text;approval_time timestamptz:=clock_timestamp();
begin
 select * into r from public.pipeline_mail_reviews where id=review_id for update;
 if r.id is null then raise exception 'MR_FORBIDDEN' using errcode='42501';end if;
 -- Lock source/association through commit; a concurrent reassociation cannot change the context mid-approval.
 perform 1 from public.messages where id=r.message_id for share;
 perform 1 from public.conversations where id=(select conversation_id from public.messages where id=r.message_id) for update;
 source:=public.pipeline_mail_source(r.message_id,r.process_id,r.submission_id);
 if r.status='approved' then
  if r.approval_key=request_key and r.approved_value=value then return r.result;end if;
  raise exception 'MR_ALREADY_APPROVED';
 end if;
 if r.source_hash<>source->>'hash' then raise exception 'MR_CONTEXT_CHANGED';end if;
 if request_key is null or expected_revision is distinct from r.revision or r.status<>'ready' then raise exception 'MR_STALE';end if;
 if jsonb_typeof(value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(value) k where k<>all(array['kind','amount','product','term','cost','frequency','fees','expires_at','requirement','summary','task_title','owner_id','due_at'])) then raise exception 'MR_INVALID';end if;
 if coalesce(value->>'kind','') not in ('offer','requirement') or length(btrim(coalesce(value->>'summary',''))) not between 1 and 2000
  or length(btrim(coalesce(value->>'task_title',''))) not between 1 and 300 then raise exception 'MR_INVALID';end if;
 if exists(select 1 from jsonb_each(value) e where e.key in ('product','term','cost','frequency','fees','requirement','summary','task_title','owner_id','due_at') and jsonb_typeof(e.value)<>'string')
 or length(coalesce(value->>'product',''))>100 or greatest(length(coalesce(value->>'term','')),length(coalesce(value->>'cost','')),length(coalesce(value->>'frequency','')),length(coalesce(value->>'fees','')))>1000 then raise exception 'MR_INVALID';end if;
 owner:=(value->>'owner_id')::uuid;due:=(value->>'due_at')::timestamptz;expiry:=(value->>'expires_at')::timestamptz;
 if owner is null or due is null or not isfinite(due) or (expiry is not null and not isfinite(expiry)) or not exists(
  select 1 from public.profiles p join public.opportunities o on o.id=r.opportunity_id where p.id=owner and p.active
  and (p.role in ('superadmin','closer_admin') or (p.role='closer' and p.id=o.closer_id))) then raise exception 'MR_OWNER_INVALID';end if;
 if value->>'kind'='offer' then
  if jsonb_typeof(value->'amount') is distinct from 'number' or coalesce((value->>'amount')::numeric,0)<=0 or (value->>'amount')::numeric>1000000000000
   or (value->>'amount')::numeric*100<>trunc((value->>'amount')::numeric*100) or length(btrim(coalesce(value->>'product',''))) not between 1 and 100 then raise exception 'MR_INVALID';end if;
  insert into public.offers(opportunity_id,submission_id,product,amount,term,cost,frequency,fees,expires_at,status)
  values(r.opportunity_id,r.submission_id,value->>'product',(value->>'amount')::numeric,coalesce(value->>'term',''),coalesce(value->>'cost',''),coalesce(value->>'frequency',''),coalesce(value->>'fees',''),expiry,'received') returning id into offer_id;
  event_kind:='offer';
 else
  if length(btrim(coalesce(value->>'requirement',''))) not between 1 and 3000 then raise exception 'MR_INVALID';end if;
  insert into public.pipeline_mail_requirements(review_id,opportunity_id,process_id,submission_id,message_id,body)
  values(r.id,r.opportunity_id,r.process_id,r.submission_id,r.message_id,value->>'requirement') returning id into requirement_id;
  event_kind:='requirement';
 end if;
 update public.conversations set process_id=r.process_id,submission_id=r.submission_id
 where id=(select conversation_id from public.messages where id=r.message_id);
 update public.gmail_thread_links g set submission_id=r.submission_id where g.account_id=(select c.account_id from public.conversations c join public.messages m on m.conversation_id=c.id where m.id=r.message_id)
 and g.gmail_thread_id=(select c.gmail_thread_id from public.conversations c join public.messages m on m.conversation_id=c.id where m.id=r.message_id)
 and g.opportunity_id=r.opportunity_id and g.process_id=r.process_id;
 insert into public.tasks(opportunity_id,owner_id,title,due_at,area,automated)
 values(r.opportunity_id,owner,value->>'task_title',due,'closer',false) returning id into task_id;
 update public.submissions set next_action=case when event_kind='requirement' then value->>'requirement' else value->>'task_title' end,next_action_at=due where id=r.submission_id;
 insert into public.activities(opportunity_id,actor_id,type,area,body) values(r.opportunity_id,auth.uid(),'pipeline_mail_review','closer',value->>'summary');
 insert into public.case_events(opportunity_id,process_id,submission_id,archive_message_id,area,kind,body,evidence_type,occurred_at,actor_id,dedupe_key)
 values(r.opportunity_id,r.process_id,r.submission_id,(select archive_message_id from public.messages where id=r.message_id),'closer',event_kind,value->>'summary','manual',approval_time,auth.uid(),'pipeline-mail-review:'||r.id) returning id into event_id;
 update public.opportunities set updated_at=approval_time where id=r.opportunity_id;
 update public.pipeline_mail_reviews set status='approved',revision=revision+1,approved_value=value,approval_key=request_key,approved_by=auth.uid(),approved_at=approval_time,
 result=jsonb_build_object('offer_id',offer_id,'requirement_id',requirement_id,'task_id',task_id,'event_id',event_id) where id=r.id returning * into r;
 insert into public.audit_log(actor_id,entity_type,entity_id,action) values(auth.uid(),'pipeline_mail_review',r.id,'approved');
 return r.result;
end $$;
revoke all on function public.pipeline_mail_approve(uuid,int,uuid,jsonb) from public,anon;
grant execute on function public.pipeline_mail_approve(uuid,int,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
