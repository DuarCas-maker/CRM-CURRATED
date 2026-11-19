begin;
do $$declare x record;s jsonb;t public.email_templates;
begin
 for x in select * from campaign_template_v2.revisions loop
  select * into t from public.email_templates where id=x.template_id for update;
  if t.version is distinct from x.after_version then raise exception 'CSIG_ROLLBACK_STALE';end if;
  select snapshot into s from public.email_template_versions where template_id=x.template_id and version=x.before_version;
  if s is null then raise exception 'CSIG_HISTORY_REQUIRED';end if;
  update public.email_templates set body=s->>'body',steps=s->'steps',version=version+1,updated_at=now() where id=t.id;
  insert into public.email_template_versions select id,version,to_jsonb(et),now() from public.email_templates et where id=t.id;
 end loop;
end$$;
drop function public.campaign_signature_scope(uuid,jsonb);
drop table campaign_template_v2.revisions;
drop schema campaign_template_v2;
notify pgrst,'reload schema';
commit;
