begin;
create schema campaign_template_v2;
revoke all on schema campaign_template_v2 from public,anon,authenticated,service_role;
create table campaign_template_v2.revisions(template_id uuid primary key,before_version int not null,after_version int not null);
alter table campaign_template_v2.revisions enable row level security;
revoke all on campaign_template_v2.revisions from public,anon,authenticated,service_role;

create function public.campaign_signature_scope(account uuid,preparation jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;a public.mail_accounts;r mail_runtime.routes;
begin
 if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') then raise exception 'CSIG_FORBIDDEN';end if;
 ctx:=public.brand_prepare_context(account,preparation,'campaign',null);
 select * into a from public.mail_accounts where id=account;
 if a.id is null or a.status<>'connected' then raise exception 'CSIG_NOT_READY';end if;
 select * into r from mail_runtime.routes where account_id=account;
 if r.account_id is null and not exists(select 1 from public.mail_credentials where account_id=account) then raise exception 'CSIG_NOT_READY';end if;
 return jsonb_build_object('account_id',a.id,'email',a.email,'actor_id',ctx->>'actor_id','brand_id',ctx->>'brand_id',
  'brand_revision',ctx->'brand_revision','account_revision',ctx->'account_revision',
  'route_exists',r.account_id is not null,'revision',coalesce(r.revision,0),'provider',coalesce(r.provider,'gmail_oauth'),
  'managed',exists(select 1 from simple_mail.health where account_id=account));
end$$;
revoke all on function public.campaign_signature_scope(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.campaign_signature_scope(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
