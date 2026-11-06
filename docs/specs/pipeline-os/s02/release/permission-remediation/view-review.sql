-- VR1 METADATA ONLY. Separate authorization required for any real execution.
begin read only;
set local statement_timeout='15s';
set local lock_timeout='2s';
set local search_path=pg_catalog, pg_temp;
set local standard_conforming_strings=on;
with recursive
expected(key) as (values ('public.campaign_workspace'),('public.opportunity_inbox'),('public.opportunity_tasks')),
rels as (select e.key,c.*,r.rolname owner_name from expected e join pg_class c on c.oid=to_regclass(e.key) and c.relkind='v' join pg_roles r on r.oid=c.relowner),
definitions as (select key,pg_get_viewdef(oid,false) definition from rels),

lex(key,rest,stream,quoted,count,steps,ok) as (
 select key,definition,''::text,''::text,0,0,octet_length(definition)<=16384 from definitions
 union all
 select l.key,case when t.token is null then '' else substr(l.rest,length(t.token)+1) end,
 l.stream||case when k.kind in ('s','q','w','n','p') then k.kind||octet_length(v.value)::text||':'||v.value||';' else '' end,
 l.quoted||case when k.kind in ('s','q') then k.kind||octet_length(v.value)::text||':'||v.value||';' else '' end,
 l.count+case when k.kind='z' then 0 else 1 end,l.steps+1,
 t.token is not null and l.count<2048 and not(l.rest ~ '^(?:[eEbBxXnN]''|[uU]&[''"]|--|/\*)')
 from lex l
 cross join lateral (select substring(l.rest from '^([ \t\r\n\f]+|''(?:[^''\\]|'''')*''|"(?:[^"]|"")*"|[A-Za-z_][A-Za-z_0-9$]*|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[+*/<>=~!@#%^&|?\x60-]+|::|[(),.;\[\]])') token) t
 cross join lateral (select case when t.token ~ '^[ \t\r\n\f]+$' then 'z'
 when left(t.token,1)='''' then 's' when left(t.token,1)='"' then 'q'
 when t.token ~ '^[A-Za-z_]' then 'w' when t.token ~ '^[0-9]' then 'n' else 'p' end kind) k
 cross join lateral (select case when k.kind='w' then translate(t.token,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') else t.token end value) v
 where l.ok and l.rest<>'' and l.steps<4097
),
fingerprints as (
 select distinct on(key) key,jsonb_build_object('status',case when ok and rest='' then 'complete' else 'incomplete' end,
 'count',count,'hash',case when ok and rest='' then md5(stream) else null end,
 'quotedHash',case when ok and rest='' then md5(quoted) else null end) fingerprint
 from lex order by key,steps desc
),
deps as (
 select distinct r.key,d.deptype::text deptype,
 case when d.refclassid='pg_catalog.pg_class'::regclass then 'relation:'||n.nspname||'.'||c.relname||':'||d.refobjsubid::text
 when d.refclassid='pg_catalog.pg_proc'::regclass then 'function:'||pn.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'
 when d.refclassid='pg_catalog.pg_type'::regclass then 'type:'||tn.nspname||'.'||t.typname
 when d.refclassid='pg_catalog.pg_namespace'::regclass then 'schema:'||ns.nspname else null end descriptor
 from rels r join pg_rewrite rw on rw.ev_class=r.oid join pg_depend d on d.classid='pg_catalog.pg_rewrite'::regclass and d.objid=rw.oid
 left join pg_class c on d.refclassid='pg_catalog.pg_class'::regclass and c.oid=d.refobjid left join pg_namespace n on n.oid=c.relnamespace
 left join pg_proc p on d.refclassid='pg_catalog.pg_proc'::regclass and p.oid=d.refobjid left join pg_namespace pn on pn.oid=p.pronamespace
 left join pg_type t on d.refclassid='pg_catalog.pg_type'::regclass and t.oid=d.refobjid left join pg_namespace tn on tn.oid=t.typnamespace
 left join pg_namespace ns on d.refclassid='pg_catalog.pg_namespace'::regclass and ns.oid=d.refobjid
 where not(d.refclassid='pg_catalog.pg_class'::regclass and d.refobjid=r.oid and d.refobjsubid=0)
)
select jsonb_build_object('protocol','VR1','scopeSha256','72df8f3480d7779879ebcf373008d3df8d7746c3bc0a0c2109dfd25b8d6279a3',
 'context',jsonb_build_object('version',current_setting('server_version_num'),'sqlRole',case when current_user in('supabase_admin','postgres') then current_user else 'role_'||md5(current_user) end,'readOnly',current_setting('transaction_read_only'),'searchPath',current_setting('search_path'),'standardStrings',current_setting('standard_conforming_strings')),
 'objectsOk',(select count(*)=3 from rels),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('key',r.key,'kind',r.relkind,'owner',case when r.owner_name in('supabase_admin','postgres') then r.owner_name else 'role_'||md5(r.owner_name) end,
 'security',coalesce(to_jsonb(r.reloptions),'[]'::jsonb),
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',n.nspname||'.'||t.typname,'typmod',a.atttypmod,'notNull',a.attnotnull) order by a.attnum) from pg_attribute a join pg_type t on t.oid=a.atttypid join pg_namespace n on n.oid=t.typnamespace where a.attrelid=r.oid and a.attnum>0 and not a.attisdropped),
 'definition',jsonb_build_object('rawHash',md5(d.definition),'lfHash',md5(replace(d.definition,E'\r\n',E'\n')),'lexical',f.fingerprint),
 'dependencies',jsonb_build_object('count',(select count(*) from deps where key=r.key),'unsupported',(select count(*) from deps where key=r.key and descriptor is null),'hash',(select md5(coalesce(string_agg(deptype||':'||descriptor,'|' order by deptype,descriptor),'')) from deps where key=r.key))) order by r.key),'[]'::jsonb)
 from rels r join definitions d on d.key=r.key join fingerprints f on f.key=r.key)) pipeline_os_abc_view_review;
rollback;
