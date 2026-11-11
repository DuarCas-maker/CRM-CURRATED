-- WS-COMPAT-r2; one function only. No provider calls or business writes.
begin isolation level serializable;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,pg_temp;
do $ws$ declare p record; body text; definition text; before_acl text; before_meta jsonb; after_meta jsonb; changed_fields jsonb; source_ok boolean; acl_ok boolean; changed boolean:=false;begin
 select x.*,l.lanname into strict p from pg_proc x join pg_language l on l.oid=x.prolang where x.oid='public.workspace_stats_base(text,text,uuid,uuid,timestamp with time zone)'::regprocedure;
 body:=replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n');
 if current_setting('server_version_num')::int<150000 or pg_get_userbyid(p.proowner)<>current_user or p.prosecdef or p.provolatile<>'s' or p.lanname<>'sql' or p.proconfig is distinct from array['search_path=""']::text[] or p.prorettype<>'jsonb'::regtype or p.proretset then raise exception 'WS_CONTEXT_MISMATCH';end if;
 if md5(body) not in('2d22ca1953b8a8072abd161c29486ec8','eb5b1d217a237c8933d252f8a9d6a4d0') then raise exception 'WS_SOURCE_MISMATCH';end if;
 if has_column_privilege('authenticated','public.conversations','needs_attention','SELECT') or has_column_privilege('authenticated','public.conversations','subject','SELECT') or not has_column_privilege('authenticated','public.conversations','id','SELECT') or not has_table_privilege('authenticated','public.mail_conversations_visible','SELECT') or not (select relrowsecurity from pg_class where oid='public.conversations'::regclass) or not exists(select 1 from pg_policy where polrelid='public.conversations'::regclass and polname='s01_i02_bound' and not polpermissive) or has_function_privilege('anon',p.oid,'EXECUTE') or not has_function_privilege('authenticated',p.oid,'EXECUTE') then raise exception 'WS_VISIBILITY_GUARD_MISMATCH';end if;
 before_acl:=coalesce(p.proacl::text,'');before_meta:=jsonb_set((to_jsonb(p))-'prosrc'-'lanname','{proargdefaults}',coalesce(to_jsonb(pg_get_expr(p.proargdefaults,0,false)),'null'::jsonb));
 if md5(body)='2d22ca1953b8a8072abd161c29486ec8' then
   definition:=pg_get_functiondef(p.oid);
   -- Replace exactly the catalog body, keeping the catalog-rendered header.
   definition:=replace(definition,p.prosrc,replace(body,'from public.mail_conversations_visible c','from public.conversations c'));
   execute definition;changed:=true;
 end if;
 select jsonb_set((to_jsonb(x))-'prosrc'-'lanname','{proargdefaults}',coalesce(to_jsonb(pg_get_expr(x.proargdefaults,0,false)),'null'::jsonb)) into after_meta from pg_proc x where x.oid=p.oid;
 select coalesce(jsonb_agg(k order by k),'[]'::jsonb) into changed_fields from (select jsonb_object_keys(before_meta) k union select jsonb_object_keys(after_meta) k) keys where (before_meta->k) is distinct from (after_meta->k);
 acl_ok:=before_acl is not distinct from (select coalesce(proacl::text,'') from pg_proc where oid=p.oid);
 source_ok:=(select md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n')) from pg_proc where oid=p.oid)='eb5b1d217a237c8933d252f8a9d6a4d0';
 if before_meta is distinct from after_meta or not coalesce(acl_ok,false) or not coalesce(source_ok,false) then raise exception 'WS_PRESERVATION_MISMATCH' using detail=jsonb_build_object('protocol','WS-COMPAT-r2','changedMetadataFields',changed_fields,'aclPreserved',acl_ok,'sourceMatches',source_ok,'commitAllowed',false)::text;end if;
 raise notice 'WS_COMPAT_CHECKED changed=%, function_only=true',changed;
end $ws$;
select jsonb_build_object('protocol','WS-COMPAT-r2','ordinal','051','stage','checked_before_commit','functionOnly',true,'targetHash','eb5b1d217a237c8933d252f8a9d6a4d0') pipeline_os_workspace_stats_application;
commit;
