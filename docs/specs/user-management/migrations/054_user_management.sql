-- Independent release package after 053; preserve historical base47/catalog.
begin;

create table public.user_private_fields (
  user_id uuid primary key references public.profiles(id),
  encrypted_text text check (octet_length(encrypted_text) <= 24000),
  version integer not null check (version > 0),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.user_private_fields enable row level security;
revoke all on public.user_private_fields from public, anon, authenticated;
grant all on public.user_private_fields to service_role;

create function public.user_management_assert_actor(p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor and active and role='superadmin') then
    raise exception 'USER_FORBIDDEN';
  end if;
end $$;

create function public.user_management_list(p_search text default '', p_page integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if public.current_app_role() is distinct from 'superadmin'::public.app_role then raise exception 'USER_FORBIDDEN'; end if;
  if length(p_search)>100 or p_page<0 or p_page>10000 or p_search is null or p_page is null then raise exception 'USER_INVALID'; end if;
  with matching as (
    select p.id,p.name,p.email,p.role,p.active,
      (s.encrypted_text is not null) as has_private_text,coalesce(s.version,0) as private_version
    from public.profiles p left join public.user_private_fields s on s.user_id=p.id
    where p_search='' or position(lower(p_search) in lower(p.name))>0 or position(lower(p_search) in lower(p.email))>0
  ), page_rows as (select * from matching order by lower(name),id limit 25 offset p_page*25)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by lower(r.name),r.id) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from matching),'page',p_page) into result;
  return result;
end $$;

create function public.user_management_access(p_target uuid,p_role public.app_role,p_active boolean,p_expected_role public.app_role,p_expected_active boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target public.profiles;
begin
  if public.current_app_role() is distinct from 'superadmin'::public.app_role then raise exception 'USER_FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(645483921054::bigint);
  perform public.user_management_assert_actor(auth.uid());
  if p_target=auth.uid() then raise exception 'USER_OWN_ACCESS'; end if;
  if p_role is null or p_active is null or p_expected_role is null or p_expected_active is null then raise exception 'USER_INVALID'; end if;
  select * into target from public.profiles where id=p_target for update;
  if target.id is null then raise exception 'USER_NOT_FOUND'; end if;
  if target.role<>p_expected_role or target.active<>p_expected_active then raise exception 'USER_CONFLICT'; end if;
  update public.profiles set role=p_role,active=p_active where id=p_target;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata)
  values(auth.uid(),'profile',p_target,'user_access_changed',jsonb_build_object('role',p_role,'active',p_active));
end $$;

create function public.user_management_finish_create(p_actor uuid,p_id uuid,p_name text,p_email text,p_role public.app_role) returns uuid
language plpgsql security definer set search_path='' as $$
declare inserted uuid;
begin
  perform public.user_management_assert_actor(p_actor);
  if p_name is null or length(btrim(p_name)) not between 1 and 100 or p_email is null or length(p_email)>254 or p_role is null then raise exception 'USER_INVALID'; end if;
  if not exists(select 1 from auth.users where id=p_id and lower(email)=p_email) then raise exception 'USER_NOT_FOUND'; end if;
  insert into public.profiles(id,name,email,role,active) values(p_id,btrim(p_name),p_email,p_role,true)
    on conflict(id) do nothing returning id into inserted;
  if not exists(select 1 from public.profiles where id=p_id and email=p_email) then raise exception 'USER_CONFLICT'; end if;
  if inserted is not null then
    insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata)
      values(p_actor,'profile',p_id,'user_created',jsonb_build_object('role',p_role));
  end if;
  return p_id;
end $$;

create function public.user_management_private_read(p_actor uuid,p_target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.user_management_assert_actor(p_actor);
  if not exists(select 1 from public.profiles where id=p_target) then raise exception 'USER_NOT_FOUND'; end if;
  select jsonb_build_object('encrypted_text',encrypted_text,'version',version) into result
    from public.user_private_fields where user_id=p_target;
  insert into public.audit_log(actor_id,entity_type,entity_id,action)
    values(p_actor,'profile',p_target,'user_private_text_read');
  return coalesce(result,jsonb_build_object('encrypted_text',null,'version',0));
end $$;

create function public.user_management_private_write(p_actor uuid,p_target uuid,p_ciphertext text,p_expected_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare current_version integer;
begin
  perform public.user_management_assert_actor(p_actor);
  perform 1 from public.profiles where id=p_target for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  select version into current_version from public.user_private_fields where user_id=p_target;
  current_version:=coalesce(current_version,0);
  if p_expected_version is null or p_expected_version<>current_version then raise exception 'USER_CONFLICT'; end if;
  if p_ciphertext='' or octet_length(p_ciphertext)>24000 then raise exception 'USER_INVALID'; end if;
  insert into public.user_private_fields(user_id,encrypted_text,version,updated_by)
    values(p_target,p_ciphertext,current_version+1,p_actor)
    on conflict(user_id) do update set encrypted_text=excluded.encrypted_text,version=excluded.version,updated_by=excluded.updated_by,updated_at=now();
  insert into public.audit_log(actor_id,entity_type,entity_id,action)
    values(p_actor,'profile',p_target,'user_private_text_changed');
  return current_version+1;
end $$;

create function public.user_management_password_audit(p_actor uuid,p_target uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.user_management_assert_actor(p_actor);
  if p_action not in ('user_password_requested','user_password_changed') or p_action is null then raise exception 'USER_INVALID'; end if;
  if not exists(select 1 from public.profiles where id=p_target) then raise exception 'USER_NOT_FOUND'; end if;
  insert into public.audit_log(actor_id,entity_type,entity_id,action) values(p_actor,'profile',p_target,p_action);
end $$;

revoke all on function public.user_management_assert_actor(uuid),public.user_management_list(text,integer),
 public.user_management_access(uuid,public.app_role,boolean,public.app_role,boolean),
 public.user_management_finish_create(uuid,uuid,text,text,public.app_role),public.user_management_private_read(uuid,uuid),
 public.user_management_private_write(uuid,uuid,text,integer),public.user_management_password_audit(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.user_management_list(text,integer),public.user_management_access(uuid,public.app_role,boolean,public.app_role,boolean) to authenticated;
grant execute on function public.user_management_assert_actor(uuid),public.user_management_finish_create(uuid,uuid,text,text,public.app_role),
 public.user_management_private_read(uuid,uuid),public.user_management_private_write(uuid,uuid,text,integer),
 public.user_management_password_audit(uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;
