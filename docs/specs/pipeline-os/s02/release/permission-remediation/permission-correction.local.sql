-- PRM1 LOCAL CANDIDATE ONLY. NOT A NUMBERED MIGRATION OR AUTHORIZATION.
-- Requires an external offline fixture marker; no production execution command.
begin isolation level serializable;
set local statement_timeout='15s';
set local lock_timeout='2s';
set local search_path=pg_catalog, pg_temp;
do $prm$
declare scope jsonb := '[{"key":"public.campaign_assets","kind":"r","authenticated":["SELECT"]},{"key":"public.campaign_events","kind":"r","authenticated":["SELECT"]},{"key":"public.campaign_workspace","kind":"v","authenticated":["SELECT"]},{"key":"public.company_contacts","kind":"r","authenticated":["SELECT"]},{"key":"public.company_primary_cases","kind":"r","authenticated":["SELECT"]},{"key":"public.conversation_lenders","kind":"r","authenticated":["SELECT"]},{"key":"public.document_reviews","kind":"r","authenticated":["SELECT"]},{"key":"public.email_template_versions","kind":"r","authenticated":["SELECT"]},{"key":"public.email_templates","kind":"r","authenticated":["SELECT"]},{"key":"public.gmail_api_slots","kind":"r","authenticated":[]},{"key":"public.gmail_api_usage","kind":"r","authenticated":[]},{"key":"public.gmail_candidate_directory","kind":"v","authenticated":["SELECT"]},{"key":"public.gmail_pending_associations","kind":"r","authenticated":["SELECT"]},{"key":"public.gmail_sent_usage","kind":"r","authenticated":[]},{"key":"public.lead_workspace","kind":"v","authenticated":["SELECT"]},{"key":"public.lender_contacts","kind":"r","authenticated":["SELECT"]},{"key":"public.lender_guideline_versions","kind":"r","authenticated":["SELECT"]},{"key":"public.mail_drafts","kind":"r","authenticated":["DELETE","INSERT","SELECT","UPDATE"]},{"key":"public.mail_recipient_selections","kind":"r","authenticated":["DELETE","INSERT","SELECT","UPDATE"]},{"key":"public.mail_uploads","kind":"r","authenticated":["SELECT"]},{"key":"public.operational_settings","kind":"r","authenticated":["SELECT"]},{"key":"public.opportunity_inbox","kind":"v","authenticated":["SELECT"]},{"key":"public.opportunity_tasks","kind":"v","authenticated":["SELECT"]},{"key":"public.opportunity_workspace","kind":"v","authenticated":["SELECT"]},{"key":"public.process_state_history","kind":"r","authenticated":["SELECT"]},{"key":"public.underwriting_runs","kind":"r","authenticated":["SELECT"]},{"key":"public.underwriting_setting_versions","kind":"r","authenticated":["SELECT"]},{"key":"public.underwriting_settings","kind":"r","authenticated":["SELECT"]}]'::jsonb;
 s record; c record; role_name text; privilege_name text; expected jsonb;
 protected_before jsonb; protected_after jsonb; role_oid oid; current_access text[];
begin
 if current_setting('pipeline_os.prm1_mode',true) is distinct from 'offline_fixture_only'
 or current_user<>'supabase_admin' or not exists(select 1 from pg_roles where rolname=current_user and rolsuper)
 then raise exception 'PRM_OFFLINE_GUARD'; end if;
 if (select count(*) from pg_roles where rolname in('anon','authenticated','service_role'))<>3
 or exists(select 1 from pg_roles where rolname in('anon','authenticated') and (rolsuper or rolbypassrls or not rolinherit))
 or exists(select 1 from pg_roles a join pg_roles b on b.oid<>a.oid where a.rolname in('anon','authenticated') and pg_has_role(a.oid,b.oid,'USAGE'))
 then raise exception 'PRM_ROLE_DRIFT'; end if;
 -- Locks are deterministic and held through COMMIT; real DDL/DCL concurrency QA remains a release gate.
 for s in select * from jsonb_to_recordset(scope) t(key text,kind text,authenticated jsonb) order by key loop
  if to_regclass(s.key) is null then raise exception 'PRM_OBJECT_DRIFT'; end if;
  execute format('lock table %s in access exclusive mode',s.key::regclass);
 end loop;
 for s in select * from jsonb_to_recordset(scope) t(key text,kind text,authenticated jsonb) order by key loop
  select r.*,o.rolname owner_name into c from pg_class r join pg_roles o on o.oid=r.relowner where r.oid=to_regclass(s.key);
  if c.relkind::text<>s.kind or c.owner_name<>'supabase_admin' or c.relforcerowsecurity
   or (s.kind='r' and not c.relrowsecurity) or (s.kind='v' and not coalesce(c.reloptions @> array['security_invoker=true'],false))
  then raise exception 'PRM_OBJECT_DRIFT'; end if;
  if exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attacl is not null)
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_roles r on r.oid=a.grantee
    where a.grantee=0 or r.rolname not in('supabase_admin','postgres','service_role','anon','authenticated')
      or (r.rolname in('anon','authenticated') and (a.grantor<>c.relowner or a.is_grantable)))
  then raise exception 'PRM_ACL_SOURCE_DRIFT'; end if;
  foreach role_name in array array['anon','authenticated'] loop
   select oid into role_oid from pg_roles where rolname=role_name;
   expected:=case when role_name='anon' then '[]'::jsonb else s.authenticated end;
   if exists(select 1 from jsonb_array_elements_text(expected) p where not has_table_privilege(role_oid,c.oid,p))
   then raise exception 'PRM_LEGITIMATE_ACCESS_MISSING'; end if;
  end loop;
 end loop;
 protected_before:=jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_object('key',_scope_entry.key,'owner',_catalog_relation.relowner::text,'kind',_catalog_relation.relkind,'rls',_catalog_relation.relrowsecurity,'force',_catalog_relation.relforcerowsecurity,'options',_catalog_relation.reloptions,
 'acl',(select coalesce(jsonb_agg(x::text order by x::text),'[]'::jsonb) from aclexplode(coalesce(_catalog_relation.relacl,acldefault('r',_catalog_relation.relowner))) x where x.grantee not in(select oid from pg_roles where rolname in('anon','authenticated'))),
 'view',case when _catalog_relation.relkind='v' then md5(pg_get_viewdef(_catalog_relation.oid,false)) else null end,
 'columns',(select jsonb_agg(a::text order by a.attnum) from pg_attribute a where a.attrelid=_catalog_relation.oid and a.attnum>0 and not a.attisdropped)) order by _scope_entry.key)
 from jsonb_to_recordset(scope) _scope_entry(key text,kind text,authenticated jsonb) join pg_class _catalog_relation on _catalog_relation.oid=to_regclass(_scope_entry.key)),
 'policies',(select md5(string_agg(p::text,'|' order by p.oid)) from pg_policy p),
 'functions',(select md5(string_agg(p::text,'|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','storage')),
 'defaults',(select md5(string_agg(d::text,'|' order by d.oid)) from pg_default_acl d),
 'memberships',(select md5(string_agg(m::text,'|' order by m.member,m.roleid)) from pg_auth_members m),
 'storage',(select md5(string_agg(_catalog_relation::text,'|' order by _catalog_relation.oid)) from pg_class _catalog_relation join pg_namespace n on n.oid=_catalog_relation.relnamespace where n.nspname='storage')
);
 for s in select * from jsonb_to_recordset(scope) t(key text,kind text,authenticated jsonb) order by key loop
  foreach role_name in array array['anon','authenticated'] loop
   expected:=case when role_name='anon' then '[]'::jsonb else s.authenticated end;
   for privilege_name in select a.privilege_type from pg_class acl_rel cross join lateral aclexplode(coalesce(acl_rel.relacl,acldefault('r',acl_rel.relowner))) a
    join pg_roles r on r.oid=a.grantee where acl_rel.oid=to_regclass(s.key) and r.rolname=role_name and not (expected ? a.privilege_type) order by a.privilege_type loop
    execute format('revoke %s on table %s from %I restrict',privilege_name,s.key::regclass,role_name);
   end loop;
  end loop;
 end loop;
 protected_after:=jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_object('key',_scope_entry.key,'owner',_catalog_relation.relowner::text,'kind',_catalog_relation.relkind,'rls',_catalog_relation.relrowsecurity,'force',_catalog_relation.relforcerowsecurity,'options',_catalog_relation.reloptions,
 'acl',(select coalesce(jsonb_agg(x::text order by x::text),'[]'::jsonb) from aclexplode(coalesce(_catalog_relation.relacl,acldefault('r',_catalog_relation.relowner))) x where x.grantee not in(select oid from pg_roles where rolname in('anon','authenticated'))),
 'view',case when _catalog_relation.relkind='v' then md5(pg_get_viewdef(_catalog_relation.oid,false)) else null end,
 'columns',(select jsonb_agg(a::text order by a.attnum) from pg_attribute a where a.attrelid=_catalog_relation.oid and a.attnum>0 and not a.attisdropped)) order by _scope_entry.key)
 from jsonb_to_recordset(scope) _scope_entry(key text,kind text,authenticated jsonb) join pg_class _catalog_relation on _catalog_relation.oid=to_regclass(_scope_entry.key)),
 'policies',(select md5(string_agg(p::text,'|' order by p.oid)) from pg_policy p),
 'functions',(select md5(string_agg(p::text,'|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','storage')),
 'defaults',(select md5(string_agg(d::text,'|' order by d.oid)) from pg_default_acl d),
 'memberships',(select md5(string_agg(m::text,'|' order by m.member,m.roleid)) from pg_auth_members m),
 'storage',(select md5(string_agg(_catalog_relation::text,'|' order by _catalog_relation.oid)) from pg_class _catalog_relation join pg_namespace n on n.oid=_catalog_relation.relnamespace where n.nspname='storage')
);
 if protected_before is distinct from protected_after then raise exception 'PRM_PRESERVATION_FAILED'; end if;
 for s in select * from jsonb_to_recordset(scope) t(key text,kind text,authenticated jsonb) order by key loop
  foreach role_name in array array['anon','authenticated'] loop
   expected:=case when role_name='anon' then '[]'::jsonb else s.authenticated end;
   select coalesce(array_agg(p order by p),array[]::text[]) into current_access
    from unnest(array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) p where has_table_privilege(role_name,s.key,p);
   if to_jsonb(current_access)<>expected then raise exception 'PRM_POSTFLIGHT_FAILED'; end if;
  end loop;
 end loop;
end $prm$;
commit;
