-- Explicit operational rollback only, after the previous web build is restored.
-- Keep new columns, financial values, events and audit history intact.
begin;
create or replace function public.can_case(case_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.opportunities o where o.id=case_id and
 (o.email_qualified_at is not null or o.historical_approved_at is not null) and (
 public.current_app_role() in ('superadmin','seller_admin') or
 (public.current_app_role()='seller' and o.seller_id=auth.uid()) or
 (public.current_app_role()='closer_admin' and o.handed_off_at is not null) or
 (public.current_app_role()='closer' and o.closer_id=auth.uid())))
$$;
create or replace function public.can_area(case_id uuid, area public.case_area) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_case(case_id) and (area<>'closer' or public.current_app_role() in ('superadmin','closer_admin','closer'))
$$;
create or replace function public.can_edit_case(case_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_case(case_id) and exists(select 1 from public.opportunities o where o.id=case_id and ((o.handed_off_at is null and public.current_app_role() in ('superadmin','seller_admin','seller')) or (o.handed_off_at is not null and public.current_app_role() in ('superadmin','closer_admin','closer'))))
$$;
-- The compatibility selection helper keeps alternatives in both web versions.
do $compat$ begin
 if to_regprocedure('s01_i02.actor_can_write(uuid,uuid,public.case_area,uuid)') is not null then
 execute $ddl$create or replace function s01_i02.actor_can_write(actor uuid,case_id uuid,area public.case_area,account uuid default null) returns boolean
 language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.profiles p join public.opportunities o on o.id=case_id where p.id=actor and p.active
 and o.archived_at is null and (o.email_qualified_at is not null or o.historical_approved_at is not null)
 and (p.role='superadmin' or (
 (case when o.handed_off_at is null then p.role in ('seller_admin','seller') else p.role in ('closer_admin','closer') end)
 and (p.role in ('seller_admin','closer_admin') or (p.role='seller' and o.seller_id=p.id) or (p.role='closer' and o.closer_id=p.id))
 and (area<>'closer' or p.role in ('closer_admin','closer'))))
 and (account is null or p.role='superadmin' or exists(select 1 from public.mail_permissions x where x.user_id=p.id and x.account_id=account and x.can_send)))
 $fn$ $ddl$;
 execute $ddl$create or replace function s01_i02.actor_can_read(actor uuid,case_id uuid,area public.case_area) returns boolean
 language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.profiles p join public.opportunities o on o.id=case_id where p.id=actor and p.active
 and (o.email_qualified_at is not null or o.historical_approved_at is not null)
 and (p.role='superadmin' or (area is not null and (area<>'closer' or p.role in ('closer_admin','closer'))
 and (p.role='seller_admin' or (p.role='seller' and o.seller_id=p.id)
 or (p.role='closer_admin' and o.handed_off_at is not null) or (p.role='closer' and o.closer_id=p.id)))))
 $fn$ $ddl$;
 end if;
end $compat$;
do $queue_owner$ declare definition text;begin
 definition:=pg_get_functiondef('public.queue_lender_emails(uuid,uuid,uuid,jsonb,text,text,uuid[],uuid[],uuid)'::regprocedure);
 execute replace(definition,'select coalesce(closer_id,seller_id) into closer from public.opportunities where opportunities.id=case_id;','select closer_id into closer from public.opportunities where opportunities.id=case_id;');
end $queue_owner$;
revoke all on function public.case_flow_command(uuid,jsonb) from public,anon,authenticated;
drop function public.case_flow_command(uuid,jsonb);
drop function public.can_manage_case_flow(uuid);
notify pgrst,'reload schema';
commit;
