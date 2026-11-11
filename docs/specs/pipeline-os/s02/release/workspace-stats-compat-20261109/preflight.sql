begin transaction read only;
set local search_path=pg_catalog,pg_temp;
select snapshot || jsonb_build_object('readyToApply',(snapshot->>'readyToApply')::boolean and (snapshot->>'rawAttentionDenied')::boolean and (snapshot->>'rawSubjectDenied')::boolean and (snapshot->>'rawIdentityAllowed')::boolean and (snapshot->>'visibleMailAllowed')::boolean and (snapshot->>'rawRls')::boolean and (snapshot->>'restrictivePolicy')::boolean and (snapshot->>'authenticatedExecute')::boolean and (snapshot->>'anonymousExecuteDenied')::boolean) as pipeline_os_workspace_stats_preflight from (select jsonb_build_object(
 'protocol','WS-COMPAT-r2','ordinal','051','version',current_setting('server_version_num'),
 'sourceHash',md5(replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n')),
 'sourceExpected',md5(replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n'))='2d22ca1953b8a8072abd161c29486ec8',
 'readyToApply',md5(replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n')) in('eb5b1d217a237c8933d252f8a9d6a4d0','2d22ca1953b8a8072abd161c29486ec8') and not p.prosecdef and p.provolatile='s' and l.lanname='sql' and p.proconfig=array['search_path=""']::text[] and pg_get_userbyid(p.proowner)=current_user,
 'securityInvoker',not p.prosecdef,'stable',p.provolatile='s','emptySearchPath',p.proconfig=array['search_path=""']::text[],
 'rawAttentionDenied',not has_column_privilege('authenticated','public.conversations','needs_attention','SELECT'),
 'rawSubjectDenied',not has_column_privilege('authenticated','public.conversations','subject','SELECT'),
 'rawIdentityAllowed',has_column_privilege('authenticated','public.conversations','id','SELECT'),
 'visibleMailAllowed',has_table_privilege('authenticated','public.mail_conversations_visible','SELECT'),
 'rawRls',(select relrowsecurity from pg_class where oid='public.conversations'::regclass),
 'restrictivePolicy',exists(select 1 from pg_policy where polrelid='public.conversations'::regclass and polname='s01_i02_bound' and not polpermissive),
 'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
 'anonymousExecuteDenied',not has_function_privilege('anon',p.oid,'EXECUTE')
 ) snapshot from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='public.workspace_stats_base(text,text,uuid,uuid,timestamp with time zone)'::regprocedure) q;
rollback;
