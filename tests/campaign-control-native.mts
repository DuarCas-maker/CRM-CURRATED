// Explicit local-only PostgreSQL15 assay. No provider, production DB or .env access.
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {execFileSync,execFile} from 'node:child_process';
import {controlFixture,queueFixture} from './fixtures/campaign-control';
const bin=process.env.CAMPAIGN_TEST_PG_BIN||path.resolve('.local/toolchains/postgresql-15/bin');
if(!fs.existsSync(path.join(bin,'postgres.exe')))throw Error('NATIVE_PG15_UNAVAILABLE');
const runtime=path.resolve('.local/campaign-audit/native-pg-'+randomUUID()),data=path.join(runtime,'data');fs.mkdirSync(runtime,{recursive:true});
if(fs.existsSync(data))throw Error('NATIVE_PG15_DATA_ALREADY_EXISTS');
const server=net.createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(r=>server.close(()=>r()));
const env={...process.env,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGDATABASE:'postgres',PGCONNECT_TIMEOUT:'5',PGPASSWORD:'',PGSSLMODE:'disable',PGCLIENTENCODING:'UTF8'};
const run=(exe:string,args:string[],input?:string)=>execFileSync(path.join(bin,exe+'.exe'),args,{env,encoding:'utf8',windowsHide:true,input,maxBuffer:16*1024*1024,...(exe==='pg_ctl'?{stdio:'ignore' as const}:{})})||'';
const lit=(v:any):string=>v==null?'null':typeof v==='number'?String(v):typeof v==='boolean'?String(v):Array.isArray(v)?`array[${v.map(lit).join(',')}]::uuid[]`:`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
const sql=(text:string)=>run('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],text).trim();
const asyncSql=(text:string)=>new Promise<string>((resolve,reject)=>{const child=execFile(path.join(bin,'psql.exe'),['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024},(e,out,err)=>e?reject(Error(err)):resolve(out.trim()));child.stdin!.end(text);});
run('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
let started=false;
try{
 run('pg_ctl',['-D',data,'-l',path.join(runtime,'server.log'),'-o',`-p ${port} -h 127.0.0.1`,'-w','start']);started=true;
 let role='',claims='{}';const settings=new Map<string,string>();
 const prefix=()=>`set request.jwt.claims=${lit(claims)};${[...settings].map(([k,v])=>`set ${k}=${lit(v)};`).join('')}${role?`set role ${role};`:''}`;
 function state(text:string){let rest=text;while(true){let m=rest.match(/^\s*reset role\s*;?/i);if(m){role='';rest=rest.slice(m[0].length);continue;}m=rest.match(/^\s*set role (authenticated|service_role)\s*;?/i);if(m){role=m[1];rest=rest.slice(m[0].length);continue;}m=rest.match(/^\s*set (pipeline_os\.[a-z0-9_]+)='([^']*)'\s*;?/i);if(m){settings.set(m[1],m[2]);rest=rest.slice(m[0].length);continue;}break;}return rest;}
 const db={
  exec:async(text:string)=>{const rest=state(text);if(rest.trim())sql(prefix()+rest);},
  query:async<T=any>(text:string,args:unknown[]=[])=>{
   if(text.includes("set_config('request.jwt.claims'"))claims=String(args[0]);
   const q=text.replace(/\$(\d+)/g,(_,i)=>lit(args[Number(i)-1])).replace(/;\s*$/,'');
   if(/^\s*(select|with)\b/i.test(q))return {rows:JSON.parse(sql(prefix()+`with results_native as(${q}) select coalesce(json_agg(row_to_json(results_native)),'[]'::json) from results_native;`)) as T[]};
   sql(prefix()+q);return {rows:[] as T[]};
  },close:async()=>{},
 };
 const factory=async()=>{
  const source=fs.readFileSync('tests/feature-database.ts','utf8'),bootstrap=source.match(/await db\.exec\(`([\s\S]*?)`\);/)?.[1];if(!bootstrap)throw Error('NATIVE_BASE_DRIFT');await db.exec(bootstrap);
  for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  const users={admin:randomUUID(),seller:randomUUID(),outsider:randomUUID(),closer:randomUUID()};
  for(const [name,id] of Object.entries(users)){await db.query('insert into auth.users values($1,$2)',[id,name+'@example.test']);await db.query('insert into profiles(id,name,email,role) values($1,$2,$3,$4)',[id,name,name+'@example.test',name==='admin'?'superadmin':name==='closer'?'closer':'seller']);}
  const asUser=async(id:string,aal='aal2')=>{role='authenticated';claims=JSON.stringify({sub:id,aal});};
  const command=async(kind:string,p:object,key=randomUUID())=>(await db.query<any>('select crm_command($1,$2,$3) result',[kind,p,key])).rows[0].result;
  return {db,users,asUser,command} as any;
 };
 const f=await controlFixture(factory),g=await f.command('create',f.payload);await f.command('activate',{id:g.id,senders:f.payload.senders});await queueFixture(f,g.id);
 const original=sql("select pg_get_functiondef('campaign_control_v1.claim_outbox()'::regprocedure)");
 // Force independent account candidates to test the group lock rather than serialize on one sender.
 sql(`create or replace function campaign_control_v1.claim_outbox() returns setof public.outbox language plpgsql security definer set search_path='' as $$declare msg public.outbox;begin select * into msg from public.outbox where status='queued' and account_id=current_setting('campaign_control_test.account')::uuid order by id for update skip locked limit 1;if msg.id is null then return;end if;update public.outbox set status='sending',sending_at=now(),send_attempts=send_attempts+1,brand_claim_token=gen_random_uuid() where id=msg.id returning * into msg;perform pg_sleep(0.4);return next msg;end$$;`);
 const race=await Promise.all(f.accounts.map(account=>asyncSql(`begin;set local request.jwt.claims=${lit(JSON.stringify({sub:f.users.admin,aal:'aal2'}))};set local role service_role;set local campaign_control_test.account=${lit(account)};select count(*) from public.claim_outbox();select pg_sleep(0.4);commit;`)));
 const returned=race.map(x=>Number(x.split(/\r?\n/).find(x=>/^[0-9]+$/.test(x))));assert.equal(returned.reduce((a,b)=>a+b,0),1);
 assert.equal(Number(sql("select count(*) from public.outbox where status='sending'")),1);assert.equal(Number(sql("select count(*) from public.outbox where status='queued' and last_error='CC_GROUP_LIMIT' and send_attempts=0")),3);
 sql(original);
 const result={sqlSha256:createHash('sha256').update(fs.readFileSync('docs/specs/pipeline-os/campaign-control-20261116/migrations/up.sql')).digest('hex'),postgres:sql('select version()'),parallelClaims:2,claimsReturned:returned,totalSending:1,blockedRemainQueued:3,realProviderRequests:0,remoteMutations:0,fullBrandFixture:true,concurrencyBase:'account-specific inert claim adapter; original restored after assay',passed:true};
 fs.writeFileSync('docs/specs/pipeline-os/campaign-control-20261116/native-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
