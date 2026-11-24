import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {controlFixture,queueFixture} from './campaign-control';
const root='docs/specs/pipeline-os/campaign-read-recovery-20261123/';
type DB=Awaited<ReturnType<typeof controlFixture>>['db'];
async function attributes(db:DB){return (await db.query(`select oid::regprocedure::text signature,(to_jsonb(p)-array['prosrc','proargdefaults'])||jsonb_build_object('canonical_arguments',pg_get_function_arguments(p.oid)) attributes from pg_proc p where oid in('campaign_control_v1.summary(uuid)'::regprocedure,'public.campaign_control_read(text,uuid,uuid,text,text,integer)'::regprocedure) order by oid`)).rows;}
export async function exerciseCampaignRead(f:Awaited<ReturnType<typeof controlFixture>>){
 const {db,users}=f;
 await db.exec('reset role');
 await db.query("update profiles set role='seller_admin' where id=$1",[users.closer]);
 const baseline=JSON.parse(await readFile(root+'baseline.json','utf8'));
 for(const value of Object.values(baseline.functions) as {definition:string}[])await db.exec(value.definition);
 const a=await f.command('create',{...f.payload,name:'Alpha campaign'});
 const b=await f.command('create',{...f.payload,name:'Beta campaign'});
 await f.command('activate',{id:a.id,senders:f.payload.senders});await queueFixture(f,a.id);
 await db.exec('reset role');
 await db.query("insert into campaign_groups(id,name,seller_id,created_by,daily_limit) values($1,'Empty group',$2,$3,100)",[randomUUID(),users.seller,users.admin]);
 const beforeAttributes=await attributes(db);
 const sample=async()=>{
  const out:unknown[]=[];
  for(const actor of [users.admin,users.seller,users.outsider,users.closer]){
   await f.asUser(actor);
   for(const [mode,id,filter,search,page] of [['overview',null,'all','',0],['overview',null,'draft','Beta',0],['overview',null,'all','',1],['details',a.id,'all','',0],['details',a.id,'pending','',0],['leads',null,'all','',0]] as const){
    try{out.push((await db.query('select campaign_control_read($1,null,$2,$3,$4,$5) r',[mode,id,filter,search,page])).rows[0]);}
    catch(e){out.push({denied:true,code:(e as {code:string}).code});}
   }
  }
  return out;
 };
 const before=await sample();
 assert.equal((before[0] as {r:{total:number}}).r.total,3);
 const ownerView=(before[6] as {r:{campaigns:{senders:{can_view_account:boolean;email:string}[]}[]}}).r;
 assert.ok(ownerView.campaigns.some(c=>c.senders.some(s=>!s.can_view_account&&s.email==='Cuenta de campaña')),'the test exercises actual private sender data');
 await db.exec('reset role');
 await db.exec(await readFile(root+'up.sql','utf8'));
 assert.deepEqual(await attributes(db),beforeAttributes,'function attributes, owner and ACL must not change');
 const after=await sample();assert.deepEqual(after,before,'all JSON and denials must be identical');
 await f.asUser(users.admin,'aal1');await assert.rejects(db.query('select campaign_control_read()'),/CC_FORBIDDEN/);
 await f.asUser(users.admin);await assert.rejects(db.query("select campaign_control_v1.summary_with_context($1,'{}','{}','{}')",[a.id]),/permission denied/);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select campaign_control_read()'),/permission denied/);
 await db.exec('reset role;set role service_role');await assert.rejects(db.query("select campaign_control_v1.summary_with_context($1,'{}','{}','{}')",[a.id]),/permission denied/);
 await db.exec('reset role');await db.exec(await readFile(root+'rollback.sql','utf8'));
 assert.deepEqual(await sample(),before,'rollback restores the original response');
 await db.exec('reset role');assert.equal((await db.query<{absent:string|null}>("select to_regprocedure('campaign_control_v1.summary_with_context(uuid,jsonb,jsonb,jsonb)') absent")).rows[0].absent,null);
 return {comparisons:before.length,roles:4,mfaDenied:true,privateHelperDenied:true,rollback:true};
}
