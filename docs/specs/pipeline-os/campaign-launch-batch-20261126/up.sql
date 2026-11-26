begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create schema campaign_launch_v1;
revoke all on schema campaign_launch_v1 from public,anon,authenticated,service_role;
create table campaign_launch_v1.function_backup(signature text primary key,definition text not null,before_hash text not null,after_hash text);
revoke all on campaign_launch_v1.function_backup from public,anon,authenticated,service_role;
do $patch$
declare sig text;src text;needle text;replacement text;
begin
 -- Derive the private bounded reader from the authoritative current query.
 -- Only add the selection predicate and preserve its eligibility rules.
 src:=replace(pg_get_functiondef('public.campaign_prepared_leads(text,text,uuid)'::regprocedure),E'\r\n',E'\n');
 needle:='CREATE OR REPLACE FUNCTION public.campaign_prepared_leads(subject_text text, body_text text, campaign uuid DEFAULT NULL::uuid)';
 replacement:='CREATE OR REPLACE FUNCTION campaign_launch_v1.candidates(subject_text text, body_text text, account uuid, campaign uuid, selected_ids uuid[])';
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'LAUNCH_CATALOG_MISMATCH';end if;
 src:=replace(src,needle,replacement);
 needle:=$old$if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin','seller') then raise exception 'Seller access and MFA required';end if;$old$;
 replacement:=$new$if public.current_app_role() is null or public.current_app_role() not in ('superadmin','seller_admin') or not coalesce(public.can_send(account),false) then raise exception 'Campaign and sender access required';end if;$new$;
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'LAUNCH_CATALOG_MISMATCH';end if;
 src:=replace(src,needle,replacement);
 needle:='where public.can_lead(l.id)';replacement:='where ct.id=any(selected_ids) and public.can_lead(l.id)';
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'LAUNCH_CATALOG_MISMATCH';end if;
 execute replace(src,needle,replacement);
 revoke all on function campaign_launch_v1.candidates(text,text,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
 sig:='public.campaign_flow_launch(jsonb,uuid)';
 src:=replace(pg_get_functiondef(sig::regprocedure),E'\r\n',E'\n');
 insert into campaign_launch_v1.function_backup values(sig,pg_get_functiondef(sig::regprocedure),md5(replace((select prosrc from pg_proc where oid=sig::regprocedure),E'\r\n',E'\n')),null);
 needle:=$old$ if exists(select 1 from public.first_contact_candidates(t.subject,(t.body||v_steps::text),(p->>'account_id')::uuid) a where a.contact_id=any(ids) and a.reason='missing_data') then raise exception 'CF_TEMPLATE_DATA';end if;
 if exists(select 1 from unnest(ids) id where not exists(select 1 from public.first_contact_candidates(t.subject,(t.body||v_steps::text),(p->>'account_id')::uuid) a where a.contact_id=id and a.reason='eligible')) then raise exception 'CF_STALE';end if;$old$;
 replacement:=$new$ declare missing boolean;stale boolean;
 begin
  with candidates as materialized(select a.contact_id,a.reason from campaign_launch_v1.candidates(t.subject,(t.body||v_steps::text),(p->>'account_id')::uuid,null,ids) a)
  select exists(select 1 from candidates a where a.contact_id=any(ids) and a.reason='missing_data'),
   exists(select 1 from unnest(ids) id where not exists(select 1 from candidates a where a.contact_id=id and a.reason='eligible')) into missing,stale;
  if missing then raise exception 'CF_TEMPLATE_DATA';end if;
  if stale then raise exception 'CF_STALE';end if;
 end;$new$;
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'LAUNCH_CATALOG_MISMATCH';end if;
 execute replace(src,needle,replacement);
 update campaign_launch_v1.function_backup set after_hash=md5(replace((select prosrc from pg_proc where oid=sig::regprocedure),E'\r\n',E'\n')) where signature=sig;
 sig:='public.crm_command_before_brand_b1(text,jsonb,uuid)';
 src:=replace(pg_get_functiondef(sig::regprocedure),E'\r\n',E'\n');
 insert into campaign_launch_v1.function_backup values(sig,pg_get_functiondef(sig::regprocedure),md5(replace((select prosrc from pg_proc where oid=sig::regprocedure),E'\r\n',E'\n')),null);
 needle:=$old$if exists(select 1 from unnest(ids) id where not exists(select 1 from public.first_contact_candidates(c.subject,c.body,c.account_id,c.id) x where x.contact_id=id and x.reason='eligible'))$old$;
 replacement:=$new$if (with candidates as materialized(select x.contact_id from campaign_launch_v1.candidates(c.subject,c.body,c.account_id,c.id,ids) x where x.reason='eligible') select exists(select 1 from unnest(ids) id where not exists(select 1 from candidates x where x.contact_id=id)))$new$;
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'LAUNCH_CATALOG_MISMATCH';end if;
 execute replace(src,needle,replacement);
 src:=replace(pg_get_functiondef(sig::regprocedure),E'\r\n',E'\n');
 needle:=$old$ if exists(select 1 from public.campaign_audience(c.id) x where x.reason='missing_data') then raise exception 'Hay leads con datos faltantes';end if;
 if not exists(select 1 from public.campaign_audience(c.id) x where x.reason='eligible' and not exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id and e.contact_id=x.contact_id and e.status not in ('active','paused'))) then raise exception 'No hay destinatarios elegibles';end if;
 for a in select * from public.campaign_audience(c.id) where reason='eligible' loop
  insert into public.campaign_enrollments(campaign_id,contact_id,opportunity_id,next_at)
  values(c.id,a.contact_id,a.opportunity_id,case when kind='schedule_campaign' then (p->>'scheduled_at')::timestamptz else now() end)
  on conflict(campaign_id,contact_id) do update set status='active' where campaign_enrollments.status='paused';
  update public.opportunities set seller_id=c.seller_id,campaign_id=c.id where id=a.opportunity_id;
 end loop;$old$;
 replacement:=$new$ declare audience jsonb;
 begin
  select coalesce(jsonb_agg(jsonb_build_object('contact_id',x.contact_id,'opportunity_id',x.opportunity_id,'reason',x.reason)),'[]') into audience from campaign_launch_v1.candidates(c.subject,c.body,c.account_id,c.id,c.selected_contact_ids) x;
  if exists(select 1 from jsonb_to_recordset(audience) x(reason text) where x.reason='missing_data') then raise exception 'Hay leads con datos faltantes';end if;
  if not exists(select 1 from jsonb_to_recordset(audience) x(contact_id uuid,reason text) where x.reason='eligible' and not exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id and e.contact_id=x.contact_id and e.status not in ('active','paused'))) then raise exception 'No hay destinatarios elegibles';end if;
  for a in select * from jsonb_to_recordset(audience) x(contact_id uuid,opportunity_id uuid,reason text) where reason='eligible' loop
   insert into public.campaign_enrollments(campaign_id,contact_id,opportunity_id,next_at)
   values(c.id,a.contact_id,a.opportunity_id,case when kind='schedule_campaign' then (p->>'scheduled_at')::timestamptz else now() end)
   on conflict(campaign_id,contact_id) do update set status='active' where campaign_enrollments.status='paused';
   update public.opportunities set seller_id=c.seller_id,campaign_id=c.id where id=a.opportunity_id;
  end loop;
 end;$new$;
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'LAUNCH_CATALOG_MISMATCH';end if;
 execute replace(src,needle,replacement);
 update campaign_launch_v1.function_backup set after_hash=md5(replace((select prosrc from pg_proc where oid=sig::regprocedure),E'\r\n',E'\n')) where signature=sig;
end$patch$;
notify pgrst,'reload schema';
commit;
