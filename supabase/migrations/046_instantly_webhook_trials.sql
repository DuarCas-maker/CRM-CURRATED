begin;

-- Technical S00 receipts only. No campaign/message/job trigger or provider operation.
create table public.instantly_webhook_trials (
 id uuid primary key default gen_random_uuid(),
 nonce text not null unique check(nonce ~ '^[a-f0-9]{24}$'),
 manifest jsonb not null check(jsonb_typeof(manifest)='object' and octet_length(manifest::text)<=8192),
 manifest_hash text not null check(manifest_hash ~ '^[a-f0-9]{64}$'),
 workspace_id uuid not null, campaign_id uuid not null,
 revision integer not null default 0 check(revision>=0),
 armed_at timestamptz, deadline timestamptz, closed boolean not null default false,
 created_at timestamptz not null default now(),
 check((armed_at is null and deadline is null and not closed) or
       (armed_at is not null and deadline>armed_at and deadline-armed_at<=interval '120 seconds'))
);
create table public.instantly_webhook_receipts (
 trial_id uuid not null references public.instantly_webhook_trials(id) on delete restrict,
 ordinal smallint not null check(ordinal between 1 and 16),
 digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 payload_digest text not null check(payload_digest ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null, context_validated boolean not null,
 classification text not null check(classification in ('accepted','quarantined')),
 duplicate boolean not null,
 primary key(trial_id,ordinal)
);
alter table public.instantly_webhook_trials enable row level security;
alter table public.instantly_webhook_receipts enable row level security;
revoke all on public.instantly_webhook_trials,public.instantly_webhook_receipts from public,anon,authenticated,service_role;

create function public.instantly_webhook_trial_read(p_nonce text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.instantly_webhook_trials; receipts jsonb;
begin
 if p_nonce is null or p_nonce !~ '^[a-f0-9]{24}$' then raise exception 'INVALID_TRIAL';end if;
 select * into t from public.instantly_webhook_trials where nonce=p_nonce;
 if not found then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('digest',r.digest,'payloadDigest',r.payload_digest,
   'receivedAt',(extract(epoch from r.received_at)*1000)::bigint,'contextValidated',r.context_validated,
   'classification',r.classification,'duplicate',r.duplicate) order by r.ordinal),'[]'::jsonb)
 into receipts from public.instantly_webhook_receipts r where r.trial_id=t.id;
 return jsonb_build_object('manifest',t.manifest,'workspace',t.workspace_id,'campaign',t.campaign_id,'revision',t.revision,
   'state',case when t.armed_at is null then null else jsonb_build_object('version',1,'manifestHash',t.manifest_hash,
   'armedAt',(extract(epoch from t.armed_at)*1000)::bigint,'deadline',(extract(epoch from t.deadline)*1000)::bigint,
   'closed',t.closed,'receipts',receipts) end);
end $$;

create function public.instantly_webhook_trial_prepare(p_nonce text,p_manifest jsonb,p_manifest_hash text,p_workspace uuid,p_campaign uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.instantly_webhook_trials; k text;
begin
 if p_nonce is null or p_nonce !~ '^[a-f0-9]{24}$' or p_workspace is null or p_campaign is null or
    p_manifest_hash is null or p_manifest_hash !~ '^[a-f0-9]{64}$' or p_manifest is null or
    jsonb_typeof(p_manifest)<>'object' or octet_length(p_manifest::text)>8192 then raise exception 'INVALID_TRIAL';end if;
 if (select count(*) from jsonb_object_keys(p_manifest))<>12 or p_manifest->'version' is distinct from '1'::jsonb or
    p_manifest->>'nonce' is distinct from p_nonce or
    coalesce(p_manifest->>'url','') !~ ('^https://[A-Za-z0-9.-]+/api/integrations/instantly/webhook/'||p_nonce||'$') then raise exception 'INVALID_TRIAL';end if;
 foreach k in array array['sourceHash','tokenHash','dedupKeyHash'] loop
   if jsonb_typeof(p_manifest->k) is distinct from 'string' or (p_manifest->>k) !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_TRIAL';end if;
 end loop;
 if p_manifest->>'tokenHash'=p_manifest->>'dedupKeyHash' then raise exception 'INVALID_TRIAL';end if;
 foreach k in array array['controlled','noAdditionalCost','persistenceVerified','logsRedacted'] loop
   if p_manifest->k is distinct from 'true'::jsonb then raise exception 'INVALID_TRIAL';end if;
 end loop;
 foreach k in array array['startsAt','endsAt'] loop
   if jsonb_typeof(p_manifest->k) is distinct from 'number' or (p_manifest->>k) !~ '^[0-9]{1,16}$' then raise exception 'INVALID_TRIAL';end if;
 end loop;
 if (p_manifest->>'endsAt')::numeric-(p_manifest->>'startsAt')::numeric<>120000 or
   (p_manifest->>'endsAt')::numeric>9007199254740991 then raise exception 'INVALID_TRIAL';end if;
 insert into public.instantly_webhook_trials(nonce,manifest,manifest_hash,workspace_id,campaign_id)
 values(p_nonce,p_manifest,p_manifest_hash,p_workspace,p_campaign) on conflict(nonce) do nothing;
 select * into t from public.instantly_webhook_trials where nonce=p_nonce for update;
 if t.manifest<>p_manifest or t.manifest_hash<>p_manifest_hash or t.workspace_id<>p_workspace or t.campaign_id<>p_campaign then raise exception 'TRIAL_IMMUTABLE';end if;
 return public.instantly_webhook_trial_read(p_nonce);
end $$;

create function public.instantly_webhook_trial_cas(p_nonce text,p_revision integer,p_state jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.instantly_webhook_trials; old_state jsonb; n integer; old_n integer; r jsonb; k text;
 arm_ms bigint; end_ms bigint; received_ms bigint; expected_duplicate boolean; expected_class text;
begin
 if p_nonce is null or p_nonce !~ '^[a-f0-9]{24}$' or p_revision is null or p_revision<0 then raise exception 'INVALID_TRIAL';end if;
 select * into t from public.instantly_webhook_trials where nonce=p_nonce for update;
 if not found then raise exception 'TRIAL_NOT_FOUND';end if;
 if t.revision<>p_revision then return jsonb_build_object('applied',false,'revision',t.revision);end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>16384 or
    (select count(*) from jsonb_object_keys(p_state))<>6 or p_state->'version' is distinct from '1'::jsonb or
    p_state->>'manifestHash' is distinct from t.manifest_hash or jsonb_typeof(p_state->'closed') is distinct from 'boolean' or
    jsonb_typeof(p_state->'receipts') is distinct from 'array' then raise exception 'INVALID_RECEIPT';end if;
 foreach k in array array['armedAt','deadline'] loop
   if jsonb_typeof(p_state->k) is distinct from 'number' or (p_state->>k) !~ '^[0-9]{1,16}$' then raise exception 'INVALID_RECEIPT';end if;
 end loop;
 arm_ms=(p_state->>'armedAt')::bigint;end_ms=(p_state->>'deadline')::bigint;
 if arm_ms<(t.manifest->>'startsAt')::bigint or arm_ms>=end_ms or end_ms<>(t.manifest->>'endsAt')::bigint then raise exception 'INVALID_RECEIPT';end if;
 n=jsonb_array_length(p_state->'receipts');if n>16 then raise exception 'RECEIPT_LIMIT';end if;
 old_state=public.instantly_webhook_trial_read(p_nonce)->'state';
 if t.armed_at is null then
   if n<>0 or p_state->'closed'<>'false'::jsonb or abs(extract(epoch from clock_timestamp())*1000-arm_ms)>5000 or clock_timestamp()>=to_timestamp(end_ms/1000.0) then raise exception 'INVALID_ARM';end if;
 else
   if p_state=old_state then return jsonb_build_object('applied',true,'revision',t.revision);end if;
   old_n=jsonb_array_length(old_state->'receipts');
   if t.closed or p_state->'armedAt'<>old_state->'armedAt' or p_state->'deadline'<>old_state->'deadline' or
     n<old_n or n>old_n+1 or (p_state->'closed'='true'::jsonb and n<>old_n) then raise exception 'RECEIPT_IMMUTABLE';end if;
   for i in 0..old_n-1 loop
     if p_state->'receipts'->i is distinct from old_state->'receipts'->i then raise exception 'RECEIPT_IMMUTABLE';end if;
   end loop;
   if n=old_n and p_state->'closed'<>'true'::jsonb then raise exception 'INVALID_TRANSITION';end if;
   if n=old_n+1 then
     r=p_state->'receipts'->old_n;
     if jsonb_typeof(r)<>'object' or (select count(*) from jsonb_object_keys(r))<>6 then raise exception 'INVALID_RECEIPT';end if;
     foreach k in array array['digest','payloadDigest'] loop
       if jsonb_typeof(r->k) is distinct from 'string' or (r->>k) !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_RECEIPT';end if;
     end loop;
     if jsonb_typeof(r->'receivedAt') is distinct from 'number' or (r->>'receivedAt') !~ '^[0-9]{1,16}$' or
       jsonb_typeof(r->'contextValidated') is distinct from 'boolean' or jsonb_typeof(r->'duplicate') is distinct from 'boolean' or
       jsonb_typeof(r->'classification') is distinct from 'string' then raise exception 'INVALID_RECEIPT';end if;
     received_ms=(r->>'receivedAt')::bigint;
     if received_ms<arm_ms or received_ms>end_ms or (old_n>0 and received_ms<(old_state->'receipts'->(old_n-1)->>'receivedAt')::bigint) or
       abs(extract(epoch from clock_timestamp())*1000-received_ms)>30000 or clock_timestamp()>t.deadline then raise exception 'TRIAL_WINDOW_CLOSED';end if;
     select exists(select 1 from public.instantly_webhook_receipts x where x.trial_id=t.id and x.digest=r->>'digest') into expected_duplicate;
     expected_class=case when (r->>'contextValidated')::boolean and (old_n=0 or r->>'digest'=old_state->'receipts'->0->>'digest') then 'accepted' else 'quarantined' end;
     if (r->>'duplicate')::boolean<>expected_duplicate or r->>'classification'<>expected_class then raise exception 'INVALID_RECEIPT';end if;
     insert into public.instantly_webhook_receipts(trial_id,ordinal,digest,payload_digest,received_at,context_validated,classification,duplicate)
     values(t.id,n,r->>'digest',r->>'payloadDigest',to_timestamp(received_ms/1000.0),(r->>'contextValidated')::boolean,r->>'classification',expected_duplicate);
   end if;
 end if;
 update public.instantly_webhook_trials set armed_at=to_timestamp(arm_ms/1000.0),deadline=to_timestamp(end_ms/1000.0),
   closed=(p_state->>'closed')::boolean,revision=revision+1 where id=t.id;
 return jsonb_build_object('applied',true,'revision',t.revision+1);
end $$;

revoke all on function public.instantly_webhook_trial_read(text) from public,anon,authenticated;
revoke all on function public.instantly_webhook_trial_prepare(text,jsonb,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.instantly_webhook_trial_cas(text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.instantly_webhook_trial_read(text),public.instantly_webhook_trial_prepare(text,jsonb,text,uuid,uuid),public.instantly_webhook_trial_cas(text,integer,jsonb) to service_role;
commit;
