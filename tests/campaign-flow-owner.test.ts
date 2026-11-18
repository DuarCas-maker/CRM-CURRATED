import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {flowOwnerFixture,ownerRoot} from './fixtures/campaign-flow-owner';
test('CF owner: new selection belongs to the creator, ignores a forged seller, and keeps four reminders',async()=>{
 const f=await flowOwnerFixture();try{
  const key=randomUUID(),p={...f.p,seller_id:f.users.outsider};const r=await f.launch(p,key);assert.equal(r.assigned_to,f.users.admin);assert.deepEqual(await f.launch(p,key),r);
  await f.db.exec('reset role');const rows=(await f.db.query<any>('select seller_id,owner_locked_at from opportunities')).rows;assert.equal(rows.length,4);assert(rows.every(x=>x.seller_id===f.users.admin&&x.owner_locked_at));
  const c=(await f.db.query<any>('select steps,created_by,seller_id from campaigns where id=$1',[r.id])).rows[0];assert.equal(c.created_by,f.users.admin);assert.equal(c.seller_id,f.users.admin);assert.deepEqual(c.steps.map((x:any)=>x.wait_days),[2,3,3,5]);
  await f.asUser(f.users.seller);assert.equal((await f.db.query<any>('select count(*)::int n from opportunities')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('CF owner: historical case and receipt stay untouched; reversal changes only future launches',async()=>{
 const f=await flowOwnerFixture();try{
  await f.db.exec('reset role');const extra=randomUUID();await f.db.query("insert into contacts(id,email,verification) values($1,$2,'valid')",[extra,extra+'@example.test']);await f.db.query("insert into leads(contact_id,company,seller_id) values($1,'Unselected',$2)",[extra,f.users.seller]);await f.asUser(f.users.admin);
  const key=randomUUID(),r=await f.launch(f.p,key);await f.db.exec('reset role');assert.equal((await f.db.query<any>('select seller_id from opportunities where contact_id=$1',[extra])).rows[0].seller_id,f.users.seller);
  await f.db.exec(await readFile(ownerRoot+'down.sql','utf8'));assert.equal((await f.db.query<any>('select count(*)::int n from opportunities where seller_id=$1',[f.users.admin])).rows[0].n,4);
  await f.asUser(f.users.admin);assert.deepEqual(await f.launch(f.p,key),r);await f.db.exec('reset role');await f.db.exec(await readFile(ownerRoot+'up.sql','utf8'));
 }finally{await f.db.close();}
});
test('CF owner: MFA, role, template revision and source guards fail atomically',async()=>{
 const f=await flowOwnerFixture();try{
  await f.asUser(f.users.admin,'aal1');await assert.rejects(f.launch(),/CF_FORBIDDEN/);await f.asUser(f.users.outsider);await assert.rejects(f.launch(),/CF_FORBIDDEN/);await f.asUser(f.users.admin);await assert.rejects(f.launch({...f.p,template_version:2}),/CF_STALE/);
  await f.db.exec('reset role');assert.equal((await f.db.query<any>('select count(*)::int n from campaigns')).rows[0].n,0);assert.equal((await f.db.query<any>('select count(*)::int n from opportunities where seller_id=$1',[f.users.seller])).rows[0].n,4);
  await assert.rejects(f.db.exec(await readFile(ownerRoot+'up.sql','utf8')),/CF_OWNER_BASE_CHANGED/);await f.db.exec('rollback');
  const acl=(await f.db.query<any>("select has_function_privilege('anon','public.campaign_flow_launch(jsonb,uuid)','execute') anon,has_function_privilege('authenticated','public.campaign_flow_launch(jsonb,uuid)','execute') authenticated,has_function_privilege('service_role','public.campaign_flow_launch(jsonb,uuid)','execute') service")).rows[0];assert.deepEqual(acl,{anon:false,authenticated:true,service:false});
 }finally{await f.db.close();}
});
