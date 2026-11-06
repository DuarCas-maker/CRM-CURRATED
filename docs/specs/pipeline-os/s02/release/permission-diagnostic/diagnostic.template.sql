-- PD-R1. READ-ONLY DIAGNOSTIC, NOT A MIGRATION. No application RPCs or business rows.
-- Generated scope and SHA are fixed; execution requires a separate authorization.
begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local search_path = pg_catalog;
with recursive
scope as (select '__SCOPE_JSON__'::jsonb v),
expected_relations as (select r.* from scope,pg_catalog.jsonb_to_recordset(v->'relations') r(key text,schema text,name text,acl boolean)),
expected_functions as (select f.* from scope,pg_catalog.jsonb_to_recordset(v->'functions') f(key text,name text,types jsonb,acl boolean)),
expected_policies as (select p.* from scope,pg_catalog.jsonb_to_recordset(v->'policies') p(key text,schema text,relation text,name text)),
rels as (
 select e.key,e.acl inspect_acl,c.*,n.nspname from expected_relations e
 join pg_catalog.pg_namespace n on n.nspname=e.schema
 join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=e.name and c.relkind in ('r','p','v','m')
),
funcs as (
 select e.key,e.acl inspect_acl,p.* from expected_functions e
 join pg_catalog.pg_proc p on p.proname=e.name and p.prokind='f'
 join pg_catalog.pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
 where (select coalesce(pg_catalog.jsonb_agg(tn.nspname||'.'||t.typname order by a.ord),'[]'::jsonb)
 from pg_catalog.unnest(p.proargtypes) with ordinality a(oid,ord)
 join pg_catalog.pg_type t on t.oid=a.oid join pg_catalog.pg_namespace tn on tn.oid=t.typnamespace)=e.types
),
role_labels as (
 select r.*,case when rolname in ('anon','authenticated','service_role','postgres','supabase_admin','authenticator','supabase_auth_admin','supabase_storage_admin','pg_database_owner')
 then rolname else 'role_'||pg_catalog.md5(rolname) end label from pg_catalog.pg_roles r
),
app_roles as (select r.oid,r.label from role_labels r where r.rolname in ('anon','authenticated','service_role')),
raw_acl as (
 select 'relation' kind,r.key,a.* from rels r cross join lateral pg_catalog.aclexplode(coalesce(r.relacl,pg_catalog.acldefault('r',r.relowner))) a where r.inspect_acl
 union all select 'function',f.key,a.* from funcs f cross join lateral pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a where f.inspect_acl
),
owners as (select relowner oid from rels union select proowner from funcs),
default_acls as (
 select d.*,coalesce(n.nspname,'GLOBAL') schema_name from pg_catalog.pg_default_acl d
 left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
 where d.defaclrole in(select oid from owners) and (d.defaclnamespace=0 or n.nspname in ('public','storage')) and d.defaclobjtype in ('r','f','S','n')
),
seeds as (
 select oid from app_roles union select oid from owners union select grantee from raw_acl where grantee<>0 union select grantor from raw_acl
 union select a.grantee from default_acls d cross join lateral pg_catalog.aclexplode(d.defaclacl) a where a.grantee<>0
),
walk(root,node,path,depth,cycle) as (
 select oid,oid,array[oid],0,false from seeds
 union all select w.root,m.roleid,w.path||m.roleid,w.depth+1,m.roleid=any(w.path)
 from walk w join pg_catalog.pg_auth_members m on m.member=w.node
 where not w.cycle and w.depth<8
),
relevant_roles as (select distinct node oid from walk),
pols as (
 select e.key,p.*,r.relowner from expected_policies e join rels r on r.key=e.schema||'.'||e.relation
 join pg_catalog.pg_policy p on p.polrelid=r.oid and p.polname=e.name
),
attrs as (select r.key relation_key,r.inspect_acl,r.relowner,a.* from rels r join pg_catalog.pg_attribute a on a.attrelid=r.oid where a.attnum>0 and not a.attisdropped),
cons as (select r.key relation_key,c.* from rels r join pg_catalog.pg_constraint c on c.conrelid=r.oid where c.contype<>'n'),
storage_triggers as (select r.key relation_key,t.* from rels r join pg_catalog.pg_trigger t on t.tgrelid=r.oid where r.nspname='storage' and not t.tgisinternal),
storage_indexes as (select r.key relation_key,i.* from rels r join pg_catalog.pg_index i on i.indrelid=r.oid where r.nspname='storage'),
deps as (
 select 'function' kind,f.key,d.refclassid,d.refobjid,d.refobjsubid,d.deptype from funcs f join pg_catalog.pg_depend d on d.classid='pg_catalog.pg_proc'::regclass and d.objid=f.oid
 union all select 'policy',p.key,d.refclassid,d.refobjid,d.refobjsubid,d.deptype from pols p join pg_catalog.pg_depend d on d.classid='pg_catalog.pg_policy'::regclass and d.objid=p.oid
 union all select 'view',r.key,d.refclassid,d.refobjid,d.refobjsubid,d.deptype from rels r join pg_catalog.pg_rewrite rw on rw.ev_class=r.oid join pg_catalog.pg_depend d on d.classid='pg_catalog.pg_rewrite'::regclass and d.objid=rw.oid where r.relkind='v'
),
dependency_rows as (
 select distinct kind,key,deptype,
 case when refclassid='pg_catalog.pg_class'::regclass then
   coalesce((select 'relation:'||r.key||':'||deps.refobjsubid from rels r where r.oid=deps.refobjid),
     case when refobjid=pg_catalog.to_regclass('auth.users') then 'relation:auth.users:'||refobjsubid else 'external_relation' end)
 when refclassid='pg_catalog.pg_proc'::regclass then coalesce((select 'function:'||f.key from funcs f where f.oid=deps.refobjid),'external_function')
 when refclassid='pg_catalog.pg_type'::regclass then 'type:'||(select n.nspname||'.'||t.typname from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace where t.oid=deps.refobjid)
 when refclassid='pg_catalog.pg_namespace'::regclass then 'schema:'||(select n.nspname from pg_catalog.pg_namespace n where n.oid=deps.refobjid)
 else 'other_catalog_dependency' end ref from deps
),
counts as (
 select (select count(*) from relevant_roles) roles,(select count(*) from pg_catalog.pg_auth_members m where m.member in(select oid from relevant_roles)) edges,
 (select count(*) from rels) relations,(select count(*) from funcs) functions,(select count(*) from attrs) columns,(select count(*) from cons) constraints,
 (select count(*) from raw_acl) acl,(select count(*) from default_acls) defaults,(select count(*) from dependency_rows) dependencies,
 (select count(*) from pols) policies,(select count(*) from rels where key in(select pg_catalog.jsonb_array_elements_text(v->'views') from scope) and relkind='v') views,
 (select count(*) from storage_triggers) storage_triggers,(select count(*) from storage_indexes) storage_indexes,
 (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and not exists(select 1 from funcs f where f.oid=p.oid)) unexpected_functions,
 exists(select 1 from walk where cycle or(depth=8 and exists(select 1 from pg_catalog.pg_auth_members m where m.member=walk.node))) depth_exceeded
),
gate as (
 select c.*,roles<=256 and edges<=512 and relations<=128 and functions<=256 and columns<=2048 and constraints<=1536 and acl<=8192 and defaults<=1024 and dependencies<=8192 and storage_triggers<=16 and storage_indexes<=32 and not depth_exceeded limits_ok,
 relations=(select count(*) from expected_relations) and functions=(select count(*) from expected_functions) and policies=(select count(*) from expected_policies) and views=3 and unexpected_functions=0 and (select count(*) from app_roles)=3 objects_ok from counts c
),
sections as (
 select pg_catalog.jsonb_build_object(
 'roles',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',r.label,'inherit',r.rolinherit,'superuser',r.rolsuper,'bypass',r.rolbypassrls) order by r.label),'[]') from role_labels r where r.oid in(select oid from relevant_roles)),
 'memberships',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',a.label||'>'||b.label||':'||g.label,'member',a.label,'role',b.label,'grantor',g.label,'admin',m.admin_option,'member_effective',pg_catalog.pg_has_role(a.oid,b.oid,'MEMBER'),'usage_effective',pg_catalog.pg_has_role(a.oid,b.oid,'USAGE')) order by a.label,b.label,g.label),'[]') from pg_catalog.pg_auth_members m join role_labels a on a.oid=m.member join role_labels b on b.oid=m.roleid join role_labels g on g.oid=m.grantor where m.member in(select oid from relevant_roles)),
 'schemas',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',n.nspname,'owner',o.label,'acl_is_null',n.nspacl is null,
 'acl',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',coalesce(g.label,'PUBLIC'),'grantor',g2.label,'privilege',a.privilege_type,'grantable',a.is_grantable) order by coalesce(g.label,'PUBLIC'),g2.label,a.privilege_type),'[]') from pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a left join role_labels g on g.oid=a.grantee join role_labels g2 on g2.oid=a.grantor),
 'access',(select pg_catalog.jsonb_object_agg(a.label,pg_catalog.jsonb_build_object('usage',pg_catalog.has_schema_privilege(a.oid,n.oid,'USAGE'),'create',pg_catalog.has_schema_privilege(a.oid,n.oid,'CREATE'))) from app_roles a)) order by n.nspname),'[]') from pg_catalog.pg_namespace n join role_labels o on o.oid=n.nspowner where n.nspname in ('public','storage')),
 'relations',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',r.key,'owner',o.label,'kind',r.relkind,'rls',r.relrowsecurity,'force',r.relforcerowsecurity,
 'security',(select coalesce(pg_catalog.jsonb_agg(v order by v),'[]') from pg_catalog.unnest(r.reloptions) v where v in ('security_invoker=true','security_invoker=false','security_barrier=true','security_barrier=false')),
 'acl_is_null',r.relacl is null,'acl',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',coalesce(g.label,'PUBLIC'),'grantor',g2.label,'privilege',a.privilege_type,'grantable',a.is_grantable) order by coalesce(g.label,'PUBLIC'),g2.label,a.privilege_type),'[]') from raw_acl a left join role_labels g on g.oid=a.grantee join role_labels g2 on g2.oid=a.grantor where a.kind='relation' and a.key=r.key),
 'access',(select pg_catalog.jsonb_object_agg(a.label,(select coalesce(pg_catalog.jsonb_agg(p order by p),'[]') from pg_catalog.unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where pg_catalog.has_table_privilege(a.oid,r.oid,p))) from app_roles a)) order by r.key),'[]') from rels r join role_labels o on o.oid=r.relowner where r.inspect_acl),
 'columns',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',a.relation_key||'.'||a.attname,'not_null',a.attnotnull,'type',n.nspname||'.'||t.typname,
 'default_hash',pg_catalog.md5(pg_catalog.pg_get_expr(d.adbin,d.adrelid)),
 'acl',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',coalesce(g.label,'PUBLIC'),'grantor',g2.label,'privilege',x.privilege_type,'grantable',x.is_grantable) order by coalesce(g.label,'PUBLIC'),g2.label,x.privilege_type),'[]') from pg_catalog.aclexplode(a.attacl) x left join role_labels g on g.oid=x.grantee join role_labels g2 on g2.oid=x.grantor),
 'access',case when a.inspect_acl then (select pg_catalog.jsonb_object_agg(r.label,(select coalesce(pg_catalog.jsonb_agg(p order by p),'[]') from pg_catalog.unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p where pg_catalog.has_column_privilege(r.oid,a.attrelid,a.attnum,p))) from app_roles r) else null end) order by a.relation_key,a.attnum),'[]') from attrs a join pg_catalog.pg_type t on t.oid=a.atttypid join pg_catalog.pg_namespace n on n.oid=t.typnamespace left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum),
 'functions',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',f.key,'owner',o.label,'language',l.lanname,'kind',f.prokind,'volatility',f.provolatile,'strict',f.proisstrict,'parallel',f.proparallel,'definer',f.prosecdef,'returns_set',f.proretset,'leakproof',f.proleakproof,
 'definition_hash',pg_catalog.md5(pg_catalog.pg_get_functiondef(f.oid)),'definition_lf_hash',pg_catalog.md5(pg_catalog.replace(pg_catalog.pg_get_functiondef(f.oid),E'\r\n',E'\n')),
 'source_hash',pg_catalog.md5(f.prosrc),'source_lf_hash',pg_catalog.md5(pg_catalog.replace(f.prosrc,E'\r\n',E'\n')),'defaults_hash',pg_catalog.md5(pg_catalog.pg_get_expr(f.proargdefaults,0)),
 'config_hash',pg_catalog.md5(coalesce(f.proconfig::text,'')),'result_hash',pg_catalog.md5(pg_catalog.pg_get_function_result(f.oid)),
 'search_path_kind',case when not exists(select 1 from pg_catalog.unnest(f.proconfig) v where v like 'search_path=%') then 'unset' when exists(select 1 from pg_catalog.unnest(f.proconfig) v where v in ('search_path=""','search_path=')) then 'empty' when 'search_path=pg_catalog'=any(f.proconfig) then 'pg_catalog' else 'other' end,
 'inspect_acl',f.inspect_acl,'acl_is_null',f.proacl is null,'acl',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',coalesce(g.label,'PUBLIC'),'grantor',g2.label,'privilege',a.privilege_type,'grantable',a.is_grantable) order by coalesce(g.label,'PUBLIC'),g2.label,a.privilege_type),'[]') from raw_acl a left join role_labels g on g.oid=a.grantee join role_labels g2 on g2.oid=a.grantor where a.kind='function' and a.key=f.key),
 'access',(select pg_catalog.jsonb_object_agg(a.label,pg_catalog.has_function_privilege(a.oid,f.oid,'EXECUTE')) from app_roles a)) order by f.key),'[]') from funcs f join role_labels o on o.oid=f.proowner join pg_catalog.pg_language l on l.oid=f.prolang),
 'defaults',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',o.label||':'||d.schema_name||':'||d.defaclobjtype::text,'owner',o.label,'schema',d.schema_name,'kind',d.defaclobjtype,
 'acl',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',coalesce(g.label,'PUBLIC'),'grantor',g2.label,'privilege',a.privilege_type,'grantable',a.is_grantable) order by coalesce(g.label,'PUBLIC'),g2.label,a.privilege_type),'[]') from pg_catalog.aclexplode(d.defaclacl) a left join role_labels g on g.oid=a.grantee join role_labels g2 on g2.oid=a.grantor)) order by o.label,d.schema_name,d.defaclobjtype),'[]') from default_acls d join role_labels o on o.oid=d.defaclrole),
 'policies',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',p.key,'command',p.polcmd,'permissive',p.polpermissive,
 'roles',(select pg_catalog.jsonb_agg(coalesce(r.label,'PUBLIC') order by coalesce(r.label,'PUBLIC')) from pg_catalog.unnest(p.polroles) id left join role_labels r on r.oid=id),
 'using_hash',pg_catalog.md5(pg_catalog.pg_get_expr(p.polqual,p.polrelid)),'using_lf_hash',pg_catalog.md5(pg_catalog.replace(pg_catalog.pg_get_expr(p.polqual,p.polrelid),E'\r\n',E'\n')),
 'check_hash',pg_catalog.md5(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)),'check_lf_hash',pg_catalog.md5(pg_catalog.replace(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),E'\r\n',E'\n'))) order by p.key),'[]') from pols p),
 'views',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',r.key,'definition_hash',pg_catalog.md5(pg_catalog.pg_get_viewdef(r.oid,true)),'definition_lf_hash',pg_catalog.md5(pg_catalog.replace(pg_catalog.pg_get_viewdef(r.oid,true),E'\r\n',E'\n'))) order by r.key),'[]') from rels r where r.relkind='v' and r.key in(select pg_catalog.jsonb_array_elements_text(v->'views') from scope)),
 'constraints',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',c.relation_key||'.'||c.conname,'kind',c.contype,'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred,'definition_hash',pg_catalog.md5(pg_catalog.pg_get_constraintdef(c.oid)),
 'columns',(select coalesce(pg_catalog.jsonb_agg(a.attname order by x.ord),'[]') from pg_catalog.unnest(c.conkey) with ordinality x(num,ord) join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.num),
 'target',case when c.confrelid=0 then null else coalesce((select r.key from rels r where r.oid=c.confrelid),case when c.confrelid=pg_catalog.to_regclass('auth.users') then 'auth.users' else 'external_relation' end) end,
 'target_columns',(select coalesce(pg_catalog.jsonb_agg(a.attname order by x.ord),'[]') from pg_catalog.unnest(c.confkey) with ordinality x(num,ord) join pg_catalog.pg_attribute a on a.attrelid=c.confrelid and a.attnum=x.num),
 'update_action',c.confupdtype,'delete_action',c.confdeltype,'match',c.confmatchtype) order by c.relation_key,c.conname),'[]') from cons c),
 'dependencies',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',kind||':'||key||':'||deptype::text||':'||pg_catalog.md5(ref),'object',key,'kind',kind,'type',deptype,'reference_hash',pg_catalog.md5(ref)) order by kind,key,deptype,ref),'[]') from dependency_rows),
 'storage_triggers',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',t.relation_key||'.'||t.tgname,'enabled',t.tgenabled,'definition_hash',pg_catalog.md5(pg_catalog.pg_get_triggerdef(t.oid)),'function_hash',pg_catalog.md5(pg_catalog.pg_get_function_identity_arguments(t.tgfoid)||':'||(select p.proname from pg_catalog.pg_proc p where p.oid=t.tgfoid)),
 'extension_hash',(select pg_catalog.md5(pg_catalog.string_agg(e.extname,',' order by e.extname)) from pg_catalog.pg_depend d join pg_catalog.pg_extension e on d.refclassid='pg_catalog.pg_extension'::regclass and d.refobjid=e.oid where d.classid='pg_catalog.pg_trigger'::regclass and d.objid=t.oid and d.deptype='e')) order by t.relation_key,t.tgname),'[]') from storage_triggers t),
 'storage_indexes',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',r.relation_key||'.'||c.relname,'definition_hash',pg_catalog.md5(pg_catalog.pg_get_indexdef(r.indexrelid))) order by r.relation_key,c.relname),'[]') from storage_indexes r join pg_catalog.pg_class c on c.oid=r.indexrelid)
 ) v from gate where limits_ok
),
result as (
 select pg_catalog.jsonb_build_object('protocol','PD-R1','scope_sha256','__SCOPE_SHA256__',
 'context',pg_catalog.jsonb_build_object('sql_role',(select label from role_labels where rolname=current_user),'read_only',pg_catalog.current_setting('transaction_read_only'),'server_version',pg_catalog.current_setting('server_version_num'),'search_path',pg_catalog.current_setting('search_path'),
 'superuser',(select rolsuper from role_labels where rolname=current_user),'bypass',(select rolbypassrls from role_labels where rolname=current_user),'migration_history_present',pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null),
 'completeness',pg_catalog.jsonb_build_object('objects_ok',g.objects_ok,'limits_ok',g.limits_ok,'depth_exceeded',g.depth_exceeded,'counts',pg_catalog.to_jsonb(g)-'objects_ok'-'limits_ok'-'depth_exceeded'),
 'sections',(select v from sections)) v from gate g
)
select case when pg_catalog.octet_length(v::text)<=2097152 then v else
 pg_catalog.jsonb_build_object('protocol','PD-R1','scope_sha256','__SCOPE_SHA256__','error','OUTPUT_LIMIT') end as pipeline_os_abc_permissions_diagnostic from result;
rollback;
