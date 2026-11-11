import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {abcFinalFixture,abcSnapshot} from './fixtures/pipeline-os-abc-final';
import {application,rollback,preflight,postflight,root,original,oldHash,newHash,comparableMetadata} from '../scripts/pipeline-os/prepare-workspace-stats-compat.mjs';
let f:Awaited<ReturnType<typeof abcFinalFixture>>;
const oldFetch=globalThis.fetch;
let network=0;
globalThis.fetch=async()=>{network++;throw Error('WS_NETWORK_DISABLED');};
const run=async(sql:string)=>{await f.admin();try{return await f.db.exec(sql);}catch(e){await f.db.exec('rollback');throw e;}};
const scalar=async<T>(sql:string,args:unknown[]=[])=> (await f.db.query<{v:T}>(sql,args)).rows[0].v;
const businessRows=async()=>{
 await f.admin();
 const out:Record<string,string>={};
 for(const table of ['conversations','messages','outbox','jobs','mail_accounts','operating_brands','operating_brand_memberships']) out[table]=await scalar<string>(`select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]')::text) v from public.${table} x`);
 return out;
};
const receipt=async(sql:string,key:string)=> (await run(sql)).flatMap(r=>r.rows).find((r:any)=>r[key])?.[key] as any;
before(async()=>{
 f=await abcFinalFixture(true);await f.admin();
 await f.db.exec(await readFile('docs/specs/pipeline-os/s02/release/abc-final/049_integrate_mail_identity_brands_and_bindings.sql','utf8'));
 await f.db.exec('create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz,refreshed_at timestamp,not_after timestamptz)');
 await f.db.exec(await readFile('docs/specs/pipeline-os/s02/release/mail-runtime-final/050_integrate_mail_runtime_and_connect.sql','utf8'));
});
after(async()=>{await f?.db.close();globalThis.fetch=oldFetch;assert.equal(network,0);});
test('WS01 reproduces authenticated workspace_stats 42501 after 049/050',async()=>{
 await f.asUser(f.users.admin);
 await assert.rejects(f.db.query('select public.workspace_stats()'),(e:any)=>e.code==='42501'&&/conversations/.test(e.message));
});
test('WS02 generated SQL artifacts match and preflight is read-only',async()=>{
 for(const[name,expected]of Object.entries({'051_fix_workspace_stats_visible_mail.sql':application,'preflight.sql':preflight,'postflight.sql':postflight,'rollback.sql':rollback})) assert.equal(await readFile(root+name,'utf8'),expected);
 const p=await receipt(preflight,'pipeline_os_workspace_stats_preflight');assert.equal(p.readyToApply,true);assert.equal(p.sourceExpected,false);assert.equal(p.sourceHash,oldHash);
 assert.match(preflight,/begin transaction read only/);assert.match(postflight,/begin transaction read only/);
});
test('WS03 changes exactly one function source; all other catalog metadata stays identical',async()=>{
 const rowsBefore=await businessRows();const before=await abcSnapshot(f);await run(application);const after=await abcSnapshot(f);
 const key='public.workspace_stats_base(text, text, uuid, uuid, timestamp with time zone)';
 assert.notEqual(before.functions[key].sourceHash,after.functions[key].sourceHash);
 before.functions[key].sourceHash=after.functions[key].sourceHash;
 assert.deepEqual(after,before);
 assert.deepEqual(await businessRows(),rowsBefore);
 assert.equal((await receipt(postflight,'pipeline_os_workspace_stats_postflight')).targetsOk,true);
 await f.asUser(f.users.admin);assert.equal(typeof await scalar('select public.workspace_stats() v'),'object');
});
test('WS04 visible unread count follows actor area and does not disclose hidden closer state',async()=>{
 await f.admin();
 const opportunity=await scalar<string>('select id v from public.opportunities limit 1');
 const account=await scalar<string>('select id v from public.mail_accounts limit 1');
 const conversation=randomUUID(),message=randomUUID();
 await f.db.query("insert into public.conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area,needs_attention) values($1,$2,$3,'ws-hidden','Hidden','seller',true)",[conversation,opportunity,account]);
 await f.db.query("insert into public.messages(id,conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1,$2,'ws-msg','inbound','fixture@example.invalid','Synthetic',now(),'received')",[message,conversation]);
 await f.db.query("update public.opportunities set closer_id=$2,handed_off_at=now() where id=$1",[opportunity,f.users.closer]);
 await f.db.query("update public.messages set area='closer' where id=$1",[message]);
 await f.asUser(f.users.seller);const seller=await scalar<any>('select public.workspace_stats() v');
 await f.asUser(f.users.closer);const closer=await scalar<any>('select public.workspace_stats() v');
 await f.asUser(f.users.outsider);const outsider=await scalar<any>('select public.workspace_stats() v');
 assert.equal(seller.unread,0);assert.equal(closer.unread,1);assert.equal(outsider.unread,0);assert.equal(outsider.total,0);
});
test('WS05 raw columns and anonymous RPC remain denied after the fix',async()=>{
 await f.asUser(f.users.admin);
 for(const col of ['subject','needs_attention']) await assert.rejects(f.db.query(`select ${col} from public.conversations`),(e:any)=>e.code==='42501');
 await f.admin();await f.db.exec('set role anon');await assert.rejects(f.db.query('select public.workspace_stats()'),(e:any)=>e.code==='42501');
});
test('WS06 rerun is idempotent and rollback is source-guarded/reproduces prior failure',async()=>{
 await run(application);assert.equal((await receipt(postflight,'pipeline_os_workspace_stats_postflight')).sourceHash,newHash);
 await run(rollback);assert.equal((await receipt(preflight,'pipeline_os_workspace_stats_preflight')).sourceHash,oldHash);
 await f.asUser(f.users.admin);await assert.rejects(f.db.query('select public.workspace_stats()'),(e:any)=>e.code==='42501');
 await run(application);
});
test('WS07 unknown source drift fails without touching the function',async()=>{
 await f.admin();
 const definition=await scalar<string>("select pg_get_functiondef('public.workspace_stats_base(text,text,uuid,uuid,timestamptz)'::regprocedure) v");
 await f.db.exec(definition.replace('from public.mail_conversations_visible c','from public.mail_conversations_visible c /* drift */'));
 try{await assert.rejects(run(application),/WS_SOURCE_MISMATCH/);}finally{await f.admin();await f.db.exec(definition);}
});
test('WS08 LF/CRLF source normalization keeps guards and applies safely',async()=>{
 await run(rollback);await f.admin();
 const definition=await scalar<string>("select pg_get_functiondef('public.workspace_stats_base(text,text,uuid,uuid,timestamptz)'::regprocedure) v");
 await f.db.exec(definition.replace(original,original.replaceAll('\n','\r\n')));
 assert.equal((await receipt(preflight,'pipeline_os_workspace_stats_preflight')).sourceHash,oldHash);
 await run(application);assert.equal((await receipt(postflight,'pipeline_os_workspace_stats_postflight')).targetsOk,true);
});
test('WS09 widened raw grants fail closed, and preflight reports not ready',async()=>{
 await f.admin();await f.db.exec('grant select(needs_attention) on public.conversations to authenticated');
 try{assert.equal((await receipt(preflight,'pipeline_os_workspace_stats_preflight')).readyToApply,false);await assert.rejects(run(application),/WS_VISIBILITY_GUARD_MISMATCH/);}finally{await f.admin();await f.db.exec('revoke select(needs_attention) on public.conversations from authenticated');}
});
test('WS10 PG15 parser-location model reproduces the old false mismatch, with identical reconstructed defaults',async()=>{
 await f.admin();
 const row=(await f.db.query<{raw:any,defaults:string,arguments:string}>("select to_jsonb(p) raw,pg_get_expr(proargdefaults,0,false) defaults,pg_get_function_arguments(oid) arguments from pg_proc p where oid='public.workspace_stats_base(text,text,uuid,uuid,timestamptz)'::regprocedure")).rows[0];
 assert.match(row.raw.proargdefaults,/:location -?\d+/);
 // Model the PG15 serialized positions from its official outfuncs.c. This is
 // explicitly not a native PG15 execution or a production catalog mutation.
 const before={...row.raw,proargdefaults:row.raw.proargdefaults.replace(/:location -?\d+/g,':location 41')};
 const after={...row.raw,proargdefaults:row.raw.proargdefaults.replace(/:location -?\d+/g,':location 199')};
 assert.notDeepEqual(before,after);
 const sql=`select ${comparableMetadata('$1::jsonb','$3::text')} = ${comparableMetadata('$2::jsonb','$3::text')} v`;
 assert.equal(await scalar<boolean>(sql,[JSON.stringify(before),JSON.stringify(after),row.defaults]),true);
 assert.equal(await scalar<boolean>(`select ${comparableMetadata('$1::jsonb','$2::text')} = ${comparableMetadata('$1::jsonb','$3::text')} v`,[JSON.stringify(before),row.defaults,"'different'::text, NULL::text, NULL::uuid, NULL::uuid, NULL::timestamp with time zone"]),false);
 assert.match(row.arguments,/DEFAULT/);
});
test('WS11 a real default-value change is rejected and rolled back with field-level detail',async()=>{
 await run(rollback);
 const faulty=application.replace('execute definition;changed:=true;',"execute replace(definition,$bad$DEFAULT ''::text$bad$,$bad$DEFAULT 'different'::text$bad$);changed:=true;");
 assert.notEqual(faulty,application);
 await assert.rejects(run(faulty),(e:any)=>{
  assert.match(e.message,/WS_PRESERVATION_MISMATCH/);
  const detail=JSON.parse(e.detail);assert(detail.changedMetadataFields.includes('proargdefaults'));assert.equal(detail.commitAllowed,false);assert.equal(detail.sourceMatches,true);return true;
 });
 assert.equal((await receipt(preflight,'pipeline_os_workspace_stats_preflight')).sourceHash,oldHash);
 await run(application);
});
test('WS12 owner, ACL, security mode and search_path changes still fail preservation',async()=>{
 const signature='public.workspace_stats_base(text,text,uuid,uuid,timestamptz)';
 for(const change of [`alter function ${signature} owner to postgres`,`grant execute on function ${signature} to anon`,`alter function ${signature} security definer`,`alter function ${signature} set search_path=public`]){
  await run(rollback);
  const faulty=application.replace('execute definition;changed:=true;',`execute definition;execute $bad$${change}$bad$;changed:=true;`);
  await assert.rejects(run(faulty),(e:any)=>{
   assert.match(e.message,/WS_PRESERVATION_MISMATCH/);assert(JSON.parse(e.detail).changedMetadataFields.length>0);return true;
  });
  await run(application);
 }
 assert.equal((await receipt(postflight,'pipeline_os_workspace_stats_postflight')).targetsOk,true);
});
