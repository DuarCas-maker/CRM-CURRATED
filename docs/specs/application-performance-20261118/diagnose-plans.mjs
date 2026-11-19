// Planner metadata only: EXPLAIN without ANALYZE, no business rows or mutations.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const target="https://supabase.finlabinc.com";
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!==target || !key) throw new Error('DIAGNOSTIC_TARGET_OR_CREDENTIAL_MISSING');
const metadata=JSON.parse(await readFile('.local/application-performance-20261118/sql-diagnosis/metadata.json','utf8'));
const functions=metadata.find(m=>m.name==='statistics_functions').rows;
const expected={workspace_stats:'8e058cf7c9f791cd708c4509bb2c1be7',workspace_stats_base:'2d22ca1953b8a8072abd161c29486ec8'};
const plans=[];
for(const f of functions){
  if(expected[f.name]!==f.source_hash || !f.security_invoker)throw new Error('DIAGNOSTIC_SOURCE_CHANGED');
  const body=f.definition.split('$function$')[1];
  const args=`with args as(select ''::text search_text,null::text stage_filter,null::uuid owner_filter,null::uuid campaign_filter,null::timestamptz since_filter) `;
  // Replace function parameters with scalar subqueries to retain the original SQL.
  let sql=body;
  for(const p of ['search_text','stage_filter','owner_filter','campaign_filter','since_filter']) sql=sql.replace(new RegExp('\\b'+p+'\\b','g'),'(select '+p+' from args)');
  sql=sql.trim().replace(/^with /i,args+', ');
  const statement=`begin read only;set local statement_timeout='5s';set local role authenticated;explain(format json) ${sql};rollback;`;
  const response=await fetch(target+'/pg/query',{method:'POST',headers:{apikey:key,'content-type':'application/json'},body:JSON.stringify({query:statement}),redirect:'error',signal:AbortSignal.timeout(12_000)});
  if(!response.ok)throw new Error('DIAGNOSTIC_PLAN_HTTP_'+response.status);
  const result=await response.json();
  const plan=result.find(r=>r['QUERY PLAN'])?.['QUERY PLAN'];
  if(!plan)throw new Error('DIAGNOSTIC_PLAN_MISSING');
  const nodes=[];function walk(value){if(!value||typeof value!=='object')return;if(value['Node Type'])nodes.push({type:value['Node Type'],relation:value['Relation Name'],index:value['Index Name'],rows:value['Plan Rows'],total_cost:value['Total Cost']});for(const v of Object.values(value))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
  walk(plan);plans.push({function:f.name,role:'authenticated',jwt_supplied:false,analyze:false,plan,nodes});
}
await writeFile(resolve('.local/application-performance-20261118/sql-diagnosis/plans.json'),JSON.stringify(plans,null,2)+'\n');
console.log(JSON.stringify(plans.map(p=>({function:p.function,role:p.role,jwt_supplied:false,analyze:false,nodes:p.nodes.filter(n=>n.relation||n.index)})),null,2));
