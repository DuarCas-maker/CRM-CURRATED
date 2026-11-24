import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url);
const catalog=JSON.parse(await fs.readFile(new URL('baseline.json',root),'utf8'));
const get=k=>catalog.functions[k].definition.replaceAll('\r\n','\n').trim();
const summary=get('campaign_control_v1.summary(uuid)'),read=get('campaign_control_read(text,uuid,uuid,text,text,integer)');
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw Error('SOURCE_DRIFT: '+from.slice(0,50));return source.replace(from,to);}
const start=summary.indexOf(' with f as materialized('),end=summary.indexOf(' with s as(',start);
if(start<0||end<0)throw Error('SUMMARY_SHAPE');
const metric=summary.slice(start,end).match(/select (jsonb_build_object\([\s\S]*\)) into metrics from f;/)?.[1];
if(!metric)throw Error('METRICS_SHAPE');
const empty="jsonb_build_object('enrolled',0,'sent',0,'replied',0,'unanswered',0,'pending',0,'failed',0,'uncertain',0,'blocked',0,'attention',0)";
const budgetQuery=groups=>`select coalesce(jsonb_object_agg(a.account_id,case when brand_b2.can_sender(a.account_id) then public.account_delivery_usage(a.account_id) else '{}'::jsonb end),'{}'::jsonb) data from (select distinct m.account_id from public.campaign_group_members m where ${groups}) a`;
let context=summary.slice(0,start)+summary.slice(end);
context=replaceOnce(context,'campaign_control_v1.summary(group_id uuid)','campaign_control_v1.summary_with_context(group_id uuid, metrics jsonb, sender_pending jsonb, budgets jsonb)');
context=replaceOnce(context,'declare g public.campaign_groups;metrics jsonb;senders jsonb;state text;','declare g public.campaign_groups;senders jsonb;state text;');
context=replaceOnce(context,"case when brand_b2.can_sender(a.id) then public.account_delivery_usage(a.id) else '{}'::jsonb end budget","coalesce(budgets->a.id::text,'{}'::jsonb) budget");
context=replaceOnce(context,"(select count(*) from campaign_control_v1.facts(summary.group_id) f where f.account_id=a.id and f.send_status in ('pending','queued','sending','paused')) pending","coalesce((sender_pending->>a.id::text)::bigint,0) pending");
context=context.replaceAll('summary.group_id','summary_with_context.group_id');
const wrapper=`create or replace function campaign_control_v1.summary(group_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare metrics jsonb;sender_pending jsonb;budgets jsonb;
begin
 if not campaign_control_v1.access(group_id) then raise exception 'CC_FORBIDDEN';end if;
 with f as materialized(select * from campaign_control_v1.facts(group_id)),
 pending as(select account_id,count(*) n from f where send_status in ('pending','queued','sending','paused') group by account_id)
 select (select ${metric} from f),(select coalesce(jsonb_object_agg(account_id,n),'{}'::jsonb) from pending),
  (${budgetQuery('m.group_id=summary.group_id')}) into metrics,sender_pending,budgets;
 return campaign_control_v1.summary_with_context(group_id,metrics,sender_pending,budgets);
end $function$;`;
let candidate=replaceOnce(read,'groups as materialized(select g.id,campaign_control_v1.summary(g.id) data from public.campaign_groups g where campaign_control_v1.access(g.id) and (batch is null or g.batch_id=batch)),','groups as materialized(select g.id from public.campaign_groups g where campaign_control_v1.access(g.id) and (batch is null or g.batch_id=batch)),');
candidate=replaceOnce(candidate,'facts as materialized(select f.* from groups g cross join lateral campaign_control_v1.facts(g.id) f),',`facts as materialized(select g.id group_id,f.* from groups g cross join lateral campaign_control_v1.facts(g.id) f),
  metrics as materialized(select group_id,${metric.replaceAll('from f','from facts')} data from facts f group by group_id),
  pending as materialized(select group_id,account_id,count(*) n from facts where send_status in ('pending','queued','sending','paused') group by group_id,account_id),
  budgets as materialized(${budgetQuery('m.group_id in(select id from groups)')}),
  summaries as materialized(select g.id,campaign_control_v1.summary_with_context(g.id,
   coalesce((select data from metrics where group_id=g.id),${empty}),
   (select coalesce(jsonb_object_agg(account_id,n),'{}'::jsonb) from pending where group_id=g.id),budgets.data) data from groups g cross join budgets),`);
candidate=replaceOnce(candidate,'filtered as(select * from groups where data->>','filtered as(select * from summaries where data->>');
candidate=candidate.replaceAll("count(*) from groups where data->>","count(*) from summaries where data->>");
const privateSignature='campaign_control_v1.summary_with_context(uuid,jsonb,jsonb,jsonb)';
const md5=s=>createHash('md5').update(s).digest('hex');
const sourceHash=sql=>md5(sql.split('$function$')[1].replaceAll('\r\n','\n'));
const signatures=['campaign_control_v1.summary(uuid)','public.campaign_control_read(text,uuid,uuid,text,text,integer)'];
const before=[sourceHash(summary),sourceHash(read)],after=[sourceHash(wrapper),sourceHash(candidate)];
function transaction(definitions,expected,next,reverse=false){return `begin;
set local lock_timeout='2s';
do $guard$ begin
 ${signatures.map((s,i)=>`if (select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid='${s}'::regprocedure) is distinct from '${expected[i]}' then raise exception 'CAMPAIGN_READ_SOURCE_DRIFT';end if;`).join('\n ')}
 if ${reverse?'':'not '}(to_regprocedure('${privateSignature}') is null) then raise exception 'CAMPAIGN_READ_HELPER_DRIFT';end if;
end $guard$;
create temporary table campaign_read_attributes on commit drop as select oid,(to_jsonb(p)-array['prosrc','proargdefaults'])||jsonb_build_object('canonical_arguments',pg_get_function_arguments(p.oid)) attributes from pg_proc p where oid in(${signatures.map(s=>`'${s}'::regprocedure`).join(',')});
${definitions}
do $post$ begin
 if exists(select 1 from campaign_read_attributes a join pg_proc p on p.oid=a.oid where a.attributes is distinct from (to_jsonb(p)-array['prosrc','proargdefaults'])||jsonb_build_object('canonical_arguments',pg_get_function_arguments(p.oid))) then raise exception 'CAMPAIGN_READ_ATTRIBUTES_CHANGED';end if;
 ${signatures.map((s,i)=>`if (select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid='${s}'::regprocedure) is distinct from '${next[i]}' then raise exception 'CAMPAIGN_READ_RESULT_DRIFT';end if;`).join('\n ')}
end $post$;
commit;
`;}
const sql=transaction(`${context};\nrevoke all on function ${privateSignature} from public,anon,authenticated,service_role;\n${wrapper}\n${candidate};`,before,after);
const down=transaction(`${summary};\n${read};\ndrop function ${privateSignature};`,after,before,true);
await fs.writeFile(new URL('up.sql',root),sql);await fs.writeFile(new URL('rollback.sql',root),down);
await fs.writeFile(new URL('manifest.json',root),JSON.stringify({target:'https://supabase.finlabinc.com',signatures,before,after,sqlSha256:createHash('sha256').update(sql).digest('hex'),helper:privateSignature},null,2)+'\n');
console.log(JSON.stringify({built:true,sqlBytes:Buffer.byteLength(sql)}));
