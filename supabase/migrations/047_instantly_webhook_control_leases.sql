begin;

create table public.instantly_webhook_control_leases (
 id uuid primary key default gen_random_uuid(),
 trial_id uuid not null unique references public.instantly_webhook_trials(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 intent_id uuid not null unique,
 issued_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 normal smallint not null default 1 check(normal between 1 and 19),
 reserve smallint not null default 0 check(reserve between 0 and 4),
 emergency smallint not null default 0 check(emergency between 0 and 2),
 observations smallint not null default 0 check(observations between 0 and 12),
 admissions smallint not null default 0 check(admissions between 0 and 16),
 arm_attempted boolean not null default false,
 close_attempted boolean not null default false,
 revoke_attempted boolean not null default false,
 attempts jsonb not null default '[]' check(jsonb_typeof(attempts)='array' and jsonb_array_length(attempts)<=24),
 check(expires_at>issued_at and expires_at-issued_at<=interval '10 minutes'),
 check(normal+reserve+emergency<=25),
 check(jsonb_array_length(attempts)=normal+reserve+emergency-1)
);
alter table public.instantly_webhook_control_leases enable row level security;
revoke all on public.instantly_webhook_control_leases from public,anon,authenticated,service_role;

create function public.instantly_webhook_control_snapshot(p_nonce text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.instantly_webhook_trials; s jsonb; first_receipt jsonb; conflict boolean;
begin
 select * into t from public.instantly_webhook_trials where nonce=p_nonce;
 if not found then return null;end if;
 s=public.instantly_webhook_trial_read(p_nonce)->'state';first_receipt=s->'receipts'->0;
 select coalesce(bool_or(x->>'digest' is distinct from first_receipt->>'digest'),false) into conflict
 from jsonb_array_elements(coalesce(s->'receipts','[]')) x;
 return jsonb_build_object('nonce',t.nonce,'sourceHash',t.manifest->>'sourceHash','manifestHash',t.manifest_hash,
   'revision',t.revision,'armed',t.armed_at is not null,'closed',t.closed,
   'authenticated',first_receipt is not null,'contextValidated',coalesce((first_receipt->>'contextValidated')::boolean,false),
   'conflict',conflict,'payloadDigest',first_receipt->>'payloadDigest',
   'receivedAt',first_receipt->'receivedAt','observations',coalesce(jsonb_array_length(s->'receipts'),0));
end $$;

create function public.instantly_webhook_control_issue(p_actor uuid,p_nonce text,p_manifest jsonb,p_hash text,p_workspace uuid,p_campaign uuid,p_token_hash text,p_intent uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.instantly_webhook_trials; l public.instantly_webhook_control_leases; now_at timestamptz=clock_timestamp(); end_at timestamptz;
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and role='superadmin') then return jsonb_build_object('status',403);end if;
 if p_intent is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status',400);end if;
 perform pg_advisory_xact_lock(hashtextextended('instantly-control:'||coalesce(p_nonce,''),0));
 if exists(select 1 from public.instantly_webhook_control_leases lease_row join public.instantly_webhook_trials trial_row on trial_row.id=lease_row.trial_id where trial_row.nonce=p_nonce or lease_row.intent_id=p_intent) then return jsonb_build_object('status',409);end if;
 begin
   perform public.instantly_webhook_trial_prepare(p_nonce,p_manifest,p_hash,p_workspace,p_campaign);
   select * into t from public.instantly_webhook_trials where nonce=p_nonce for update;
   end_at=to_timestamp((t.manifest->>'endsAt')::numeric/1000);
   if t.armed_at is not null or t.closed or end_at<=now_at or end_at>now_at+interval '9 minutes' then raise exception 'INVALID_WINDOW';end if;
   insert into public.instantly_webhook_control_leases(trial_id,actor_id,token_hash,intent_id,issued_at,expires_at)
   values(t.id,p_actor,p_token_hash,p_intent,now_at,least(now_at+interval '10 minutes',end_at+interval '1 minute')) returning * into l;
 exception when others then return jsonb_build_object('status',409);end;
 return jsonb_build_object('status',201,'leaseId',l.id,'intentId',l.intent_id,
   'expiresAt',(extract(epoch from l.expires_at)*1000)::bigint,'snapshot',public.instantly_webhook_control_snapshot(p_nonce));
end $$;

create function public.instantly_webhook_control_execute(p_nonce text,p_token_hash text,p_action text,p_bucket text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.instantly_webhook_control_leases; t public.instantly_webhook_trials; s jsonb; now_ms bigint=(extract(epoch from clock_timestamp())*1000)::bigint; duplicate_request boolean; response jsonb;
begin
 select lease_row.* into l from public.instantly_webhook_control_leases lease_row join public.instantly_webhook_trials trial_row on trial_row.id=lease_row.trial_id
 where trial_row.nonce=p_nonce and lease_row.token_hash=p_token_hash for update of lease_row;
 if not found or l.revoked_at is not null or clock_timestamp()>=l.expires_at then return jsonb_build_object('status',401);end if;
 if not exists(select 1 from public.profiles where id=l.actor_id and active and role='superadmin') then return jsonb_build_object('status',403);end if;
 if p_request is null or p_action is null or p_action not in ('probe','observe','final','arm','close','revoke') or p_bucket is null or p_bucket not in ('N','R','H') or
   (p_bucket='R' and p_action not in ('probe','observe','final')) or (p_bucket='H' and p_action not in ('close','revoke')) then return jsonb_build_object('status',400);end if;
 if l.normal+l.reserve+l.emergency>=25 or (p_bucket='N' and l.normal>=19) or (p_bucket='R' and l.reserve>=4) or (p_bucket='H' and l.emergency>=2) then return jsonb_build_object('status',429);end if;
 select exists(select 1 from jsonb_array_elements(l.attempts) x where x->>'requestId'=p_request::text) into duplicate_request;
 update public.instantly_webhook_control_leases set normal=normal+case when p_bucket='N' then 1 else 0 end,
 reserve=reserve+case when p_bucket='R' then 1 else 0 end,emergency=emergency+case when p_bucket='H' then 1 else 0 end,
 attempts=attempts||jsonb_build_array(jsonb_build_object('requestId',p_request,'action',p_action,'bucket',p_bucket)) where id=l.id;
 if duplicate_request then return jsonb_build_object('status',409);end if;
 select * into t from public.instantly_webhook_trials where id=l.trial_id for update;
 if (p_action='arm' and l.arm_attempted) or (p_action='close' and l.close_attempted) or (p_action='revoke' and l.revoke_attempted) then return jsonb_build_object('status',409);end if;
 if p_action='arm' then update public.instantly_webhook_control_leases set arm_attempted=true where id=l.id;
 elsif p_action='close' then update public.instantly_webhook_control_leases set close_attempted=true where id=l.id;
 elsif p_action='revoke' then update public.instantly_webhook_control_leases set revoke_attempted=true where id=l.id;end if;
 begin
   s=public.instantly_webhook_trial_read(p_nonce)->'state';
   if p_action='arm' then
     if s<>'null'::jsonb then raise exception 'ALREADY_ARMED';end if;
     s=jsonb_build_object('version',1,'manifestHash',t.manifest_hash,'armedAt',now_ms,'deadline',(t.manifest->>'endsAt')::bigint,'closed',false,'receipts','[]'::jsonb);
     perform public.instantly_webhook_trial_cas(p_nonce,t.revision,s);
   elsif p_action='close' then
     if s='null'::jsonb then raise exception 'UNARMED';end if;
     perform public.instantly_webhook_trial_cas(p_nonce,t.revision,jsonb_set(s,'{closed}','true'));
   elsif p_action='final' and not t.closed then raise exception 'NOT_CLOSED';
   elsif p_action='observe' then
     if t.armed_at is null or (p_bucket='N' and l.observations>=12) then return jsonb_build_object('status',429);end if;
     if p_bucket='N' then update public.instantly_webhook_control_leases set observations=observations+1 where id=l.id;end if;
   elsif p_action='revoke' then update public.instantly_webhook_control_leases set revoked_at=clock_timestamp() where id=l.id;
   end if;
   response=public.instantly_webhook_control_snapshot(p_nonce);
 exception when others then return jsonb_build_object('status',409);end;
 return jsonb_build_object('status',200,'snapshot',response);
end $$;

create function public.instantly_webhook_control_admit(p_nonce text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.instantly_webhook_control_leases; t public.instantly_webhook_trials;
begin
 select lease_row.* into l from public.instantly_webhook_control_leases lease_row join public.instantly_webhook_trials trial_row on trial_row.id=lease_row.trial_id where trial_row.nonce=p_nonce for update of lease_row;
 if not found then return jsonb_build_object('status',404);end if;
 if l.revoked_at is not null or clock_timestamp()>=l.expires_at or not exists(select 1 from public.profiles where id=l.actor_id and active and role='superadmin') then return jsonb_build_object('status',410);end if;
 select * into t from public.instantly_webhook_trials where id=l.trial_id for update;
 if t.armed_at is null or t.closed or clock_timestamp()<t.armed_at or clock_timestamp()>t.deadline then return jsonb_build_object('status',410);end if;
 if l.admissions>=16 then return jsonb_build_object('status',429);end if;
 update public.instantly_webhook_control_leases set admissions=admissions+1 where id=l.id;
 return jsonb_build_object('status',200,'trial',public.instantly_webhook_trial_read(p_nonce));
end $$;

revoke all on function public.instantly_webhook_control_snapshot(text) from public,anon,authenticated,service_role;
revoke all on function public.instantly_webhook_control_issue(uuid,text,jsonb,text,uuid,uuid,text,uuid),public.instantly_webhook_control_execute(text,text,text,text,uuid),public.instantly_webhook_control_admit(text) from public,anon,authenticated;
grant execute on function public.instantly_webhook_control_issue(uuid,text,jsonb,text,uuid,uuid,text,uuid),public.instantly_webhook_control_execute(text,text,text,text,uuid),public.instantly_webhook_control_admit(text) to service_role;
commit;
