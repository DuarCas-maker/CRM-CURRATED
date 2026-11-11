import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const root='docs/specs/pipeline-os/s02/release/workspace-stats-compat-20261109/';
const source=await fs.readFile('supabase/migrations/006_metrics.sql','utf8');
export const original=source.split('$$')[1].replace(/\r\n?/g,'\n');
assert.equal((original.match(/from public\.conversations c/g)||[]).length,1);
export const corrected=original.replace('from public.conversations c','from public.mail_conversations_visible c');
const md5=s=>createHash('md5').update(s).digest('hex');
export const oldHash=md5(original), newHash=md5(corrected);
// PG15 stores parser locations in proargdefaults; reconstruct the expressions
// instead of comparing unstable nodeToString() positions. Keep all other fields.
export const comparableMetadata=(raw,defaults)=>`jsonb_set((${raw})-'prosrc'-'lanname','{proargdefaults}',coalesce(to_jsonb(${defaults}),'null'::jsonb))`;
const signature='public.workspace_stats_base(text,text,uuid,uuid,timestamp with time zone)';
const norm="replace(replace(p.prosrc,E'\\r\\n',E'\\n'),E'\\r',E'\\n')";
const observe=`select jsonb_build_object(
 'protocol','WS-COMPAT-r2','ordinal','051','version',current_setting('server_version_num'),
 'sourceHash',md5(${norm}),
 'sourceExpected',md5(${norm})='${newHash}',
 'readyToApply',md5(${norm}) in('${oldHash}','${newHash}') and not p.prosecdef and p.provolatile='s' and l.lanname='sql' and p.proconfig=array['search_path=""']::text[] and pg_get_userbyid(p.proowner)=current_user,
 'securityInvoker',not p.prosecdef,'stable',p.provolatile='s','emptySearchPath',p.proconfig=array['search_path=""']::text[],
 'rawAttentionDenied',not has_column_privilege('authenticated','public.conversations','needs_attention','SELECT'),
 'rawSubjectDenied',not has_column_privilege('authenticated','public.conversations','subject','SELECT'),
 'rawIdentityAllowed',has_column_privilege('authenticated','public.conversations','id','SELECT'),
 'visibleMailAllowed',has_table_privilege('authenticated','public.mail_conversations_visible','SELECT'),
 'rawRls',(select relrowsecurity from pg_class where oid='public.conversations'::regclass),
 'restrictivePolicy',exists(select 1 from pg_policy where polrelid='public.conversations'::regclass and polname='s01_i02_bound' and not polpermissive),
 'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
 'anonymousExecuteDenied',not has_function_privilege('anon',p.oid,'EXECUTE')
 ) snapshot from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='${signature}'::regprocedure`;
export const catalog=observe;
function patch(reverse=false){
 const expected=reverse?newHash:oldHash, target=reverse?oldHash:newHash;
 const from=reverse?'public.mail_conversations_visible':'public.conversations';
 const to=reverse?'public.conversations':'public.mail_conversations_visible';
 return `-- WS-COMPAT-r2; one function only. No provider calls or business writes.
begin isolation level serializable;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,pg_temp;
do $ws$ declare p record; body text; definition text; before_acl text; before_meta jsonb; after_meta jsonb; changed_fields jsonb; source_ok boolean; acl_ok boolean; changed boolean:=false;begin
 select x.*,l.lanname into strict p from pg_proc x join pg_language l on l.oid=x.prolang where x.oid='${signature}'::regprocedure;
 body:=replace(replace(p.prosrc,E'\\r\\n',E'\\n'),E'\\r',E'\\n');
 if current_setting('server_version_num')::int<150000 or pg_get_userbyid(p.proowner)<>current_user or p.prosecdef or p.provolatile<>'s' or p.lanname<>'sql' or p.proconfig is distinct from array['search_path=""']::text[] or p.prorettype<>'jsonb'::regtype or p.proretset then raise exception 'WS_CONTEXT_MISMATCH';end if;
 if md5(body) not in('${expected}','${target}') then raise exception 'WS_SOURCE_MISMATCH';end if;
 if has_column_privilege('authenticated','public.conversations','needs_attention','SELECT') or has_column_privilege('authenticated','public.conversations','subject','SELECT') or not has_column_privilege('authenticated','public.conversations','id','SELECT') or not has_table_privilege('authenticated','public.mail_conversations_visible','SELECT') or not (select relrowsecurity from pg_class where oid='public.conversations'::regclass) or not exists(select 1 from pg_policy where polrelid='public.conversations'::regclass and polname='s01_i02_bound' and not polpermissive) or has_function_privilege('anon',p.oid,'EXECUTE') or not has_function_privilege('authenticated',p.oid,'EXECUTE') then raise exception 'WS_VISIBILITY_GUARD_MISMATCH';end if;
 before_acl:=coalesce(p.proacl::text,'');before_meta:=${comparableMetadata('to_jsonb(p)','pg_get_expr(p.proargdefaults,0,false)')};
 if md5(body)='${expected}' then
   definition:=pg_get_functiondef(p.oid);
   -- Replace exactly the catalog body, keeping the catalog-rendered header.
   definition:=replace(definition,p.prosrc,replace(body,'from ${from} c','from ${to} c'));
   execute definition;changed:=true;
 end if;
 select ${comparableMetadata('to_jsonb(x)','pg_get_expr(x.proargdefaults,0,false)')} into after_meta from pg_proc x where x.oid=p.oid;
 select coalesce(jsonb_agg(k order by k),'[]'::jsonb) into changed_fields from (select jsonb_object_keys(before_meta) k union select jsonb_object_keys(after_meta) k) keys where (before_meta->k) is distinct from (after_meta->k);
 acl_ok:=before_acl is not distinct from (select coalesce(proacl::text,'') from pg_proc where oid=p.oid);
 source_ok:=(select md5(replace(replace(prosrc,E'\\r\\n',E'\\n'),E'\\r',E'\\n')) from pg_proc where oid=p.oid)='${target}';
 if before_meta is distinct from after_meta or not coalesce(acl_ok,false) or not coalesce(source_ok,false) then raise exception 'WS_PRESERVATION_MISMATCH' using detail=jsonb_build_object('protocol','WS-COMPAT-r2','changedMetadataFields',changed_fields,'aclPreserved',acl_ok,'sourceMatches',source_ok,'commitAllowed',false)::text;end if;
 raise notice 'WS_COMPAT_CHECKED changed=%, function_only=true',changed;
end $ws$;
select jsonb_build_object('protocol','WS-COMPAT-r2','ordinal','051','stage','checked_before_commit','functionOnly',true,'targetHash','${target}') pipeline_os_workspace_stats_application;
commit;
`;
}
export const application=patch(), rollback=patch(true);
const allChecks=`(snapshot->>'readyToApply')::boolean and (snapshot->>'rawAttentionDenied')::boolean and (snapshot->>'rawSubjectDenied')::boolean and (snapshot->>'rawIdentityAllowed')::boolean and (snapshot->>'visibleMailAllowed')::boolean and (snapshot->>'rawRls')::boolean and (snapshot->>'restrictivePolicy')::boolean and (snapshot->>'authenticatedExecute')::boolean and (snapshot->>'anonymousExecuteDenied')::boolean`;
export const preflight=`begin transaction read only;\nset local search_path=pg_catalog,pg_temp;\nselect snapshot || jsonb_build_object('readyToApply',${allChecks}) as pipeline_os_workspace_stats_preflight from (${observe}) q;\nrollback;\n`;
export const postflight=`begin transaction read only;\nset local search_path=pg_catalog,pg_temp;\nselect snapshot || jsonb_build_object('targetsOk',(${allChecks}) and (snapshot->>'sourceExpected')::boolean) as pipeline_os_workspace_stats_postflight from (${observe}) q;\nrollback;\n`;
if(process.argv[1]?.replaceAll('\\','/').endsWith('/prepare-workspace-stats-compat.mjs')){
 await fs.mkdir(root,{recursive:true});
 for(const [name,text] of Object.entries({'051_fix_workspace_stats_visible_mail.sql':application,'rollback.sql':rollback,'preflight.sql':preflight,'postflight.sql':postflight})) await fs.writeFile(root+name,text);
 console.log(JSON.stringify({protocol:'WS-COMPAT-r2',oldHash,newHash,files:4}));
}
