import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {controlFixture as fixture,queueFixture} from './fixtures/campaign-control';
import {readControl,writeControl,controlError} from '../src/lib/server/campaign-control';
const root = "docs/specs/pipeline-os/campaign-control-20261116/migrations/";

test('CC: API validates canonical selections, MFA roles, missing RPC and Bouncer configuration before commands',async()=>{
 const calls:any[]=[];const ctx:any={profile:{role:'superadmin'},db:{rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:{queued:2},error:null};}}};
 const ids=[randomUUID(),randomUUID()],request_key=randomUUID(),body={kind:'verify',request_key,payload:{contact_ids:ids,expected_count:2,cause_resolved:true}};
 const previous=process.env.BOUNCER_API_KEY;
 try{
  delete process.env.BOUNCER_API_KEY;await assert.rejects(writeControl(body,ctx),/not configured/);assert.equal(calls.length,0);
  process.env.BOUNCER_API_KEY='fixture-no-provider';await writeControl(body,ctx);assert.deepEqual(calls.pop().args.p.contact_ids,[...ids].sort());
  for(const bad of [{...body,payload:{...body.payload,contact_ids:[ids[0],ids[0]]}},{...body,payload:{...body.payload,expected_count:1}},{...body,extra:true}])assert.equal(controlError(await writeControl(bad,ctx).catch(e=>e)).status,400);
  await assert.rejects(writeControl(body,{...ctx,profile:{role:'seller'}}),/MFA/);assert.equal(calls.length,0);
  const unavailable={...ctx,db:{rpc:async()=>({data:null,error:{code:'PGRST202',message:'missing'}})}};
  assert.equal(controlError(await readControl(new URL('https://example.test/api/campaigns/control'),unavailable).catch(e=>e)).status,503);
 }finally{if(previous===undefined)delete process.env.BOUNCER_API_KEY;else process.env.BOUNCER_API_KEY=previous;}
});

test('CC: future scheduling, pause and resume are atomic across senders',async()=>{
 const f=await fixture();try{
  const g=await f.command('create',f.payload),scheduled_at=new Date(Date.now()+3600000).toISOString();
  await f.command('schedule',{id:g.id,scheduled_at,senders:f.payload.senders});assert.equal((await f.read()).campaigns[0].status,'scheduled');
  await f.command('pause',{id:g.id});await f.command('activate',{id:g.id,senders:f.payload.senders});
  const result=await f.read();assert.equal(result.campaigns[0].status,'active');assert(result.campaigns[0].senders.every((s:any)=>s.scheduled_at===null));
 }finally{await f.db.close();}
});

test('CC: campaigns created later through the classic import remain visible with their file and limit',async()=>{
 const f=await fixture();try{
  await f.asUser(f.users.admin);
  const {senders,...p}=f.payload;
  const result=(await f.db.query<any>('select campaign_create_from_import($1,$2) r',[{...p,daily_limit:3,account_id:f.accounts[0],brand_preparation:f.prep},randomUUID()])).rows[0].r;
  const view=await f.read();assert.equal(view.total,1);assert.equal(view.campaigns[0].id,result.id);assert.equal(view.campaigns[0].batch_id,f.batch);assert.equal(view.campaigns[0].daily_limit,3);assert.equal(view.campaigns[0].senders.length,1);
 }finally{await f.db.close();}
});

test('CC: different brands are rejected before group creation; mailbox data stays private for an owner without send permission',async()=>{
 const f=await fixture();try{
  const g=await f.command('create',f.payload);await f.asUser(f.users.seller);await f.db.exec('begin read only');
  const view=(await f.db.query<any>('select campaign_control_read() r')).rows[0].r;await f.db.exec('rollback');
  const hidden=view.campaigns[0].senders.find((s:any)=>s.account_id===f.accounts[1]);assert.equal(hidden.can_view_account,false);assert.equal(hidden.email,'Cuenta de campaña');assert.equal(hidden.budget.total_messages,undefined);assert(!hidden.blockers.includes('brand_review'));
  await f.db.exec('reset role');await f.db.query("update profiles set role='seller_admin' where id=$1",[f.users.outsider]);await f.asUser(f.users.outsider);
  assert.equal((await f.db.query<any>('select campaign_control_read() r')).rows[0].r.total,0);
  assert.equal((await f.db.query<any>('select count(*)::int n from campaign_groups')).rows[0].n,0);
  await f.asUser(f.users.admin);
  const brand=(await f.baseCommand('brand_create',{code:'ALT_'+randomUUID().slice(0,8),name:'Another example brand',active:true})).id;
  const review=(await f.baseCommand('brand_mapping_propose',{account_id:f.accounts[1],proposed_brand_id:brand,expected_account_revision:1,evidence_reference:'fixture-change'})).id;
  await f.baseCommand('brand_mapping_confirm',{review_id:review,expected_review_revision:1,expected_account_revision:1,acknowledge_conflict:true});
  await assert.rejects(f.command('create',{...f.payload,senders:[f.payload.senders[0],{...f.payload.senders[1],brand_preparation:{brand_id:brand,brand_revision:1,account_revision:2}}]}),/CC_MIXED_BRAND/);
  assert.equal((await f.read()).total,1);assert.equal((await f.read()).campaigns[0].id,g.id);
 }finally{await f.db.close();}
});

test("CC: one visible campaign, deterministic disjoint senders, replay and role-gated funnel", async () => {
  const f = await fixture();
  try {
    const key = randomUUID(),
      g = await f.command("create", f.payload, key);
    assert.equal((await f.command("create", f.payload, key)).id, g.id);
    const view = await f.read();
    assert.equal(view.total, 1);
    assert.equal(view.funnel.total, 4);
    assert.equal(view.funnel.valid, 4);
    assert.equal(view.campaigns[0].senders.length, 2);
    await f.db.exec("reset role");
    const members = (
      await f.db.query<any>(
        "select c.selected_contact_ids from campaign_group_members m join campaigns c on c.id=m.campaign_id where m.group_id=$1",
        [g.id],
      )
    ).rows;
    assert(members.every((m) => m.selected_contact_ids.length === 2));
    assert.equal(
      new Set(members.flatMap((m) => m.selected_contact_ids)).size,
      4,
    );
    await assert.rejects(
      f.command("create", { ...f.payload, name: "Changed" }, key),
      /CC_KEY_REUSED/,
    );
    await f.asUser(f.users.outsider);
    assert.equal(
      (await f.db.query<any>("select campaign_control_read() r")).rows[0].r
        .total,
      0,
    );
    await f.asUser(f.users.admin, "aal1");
    await assert.rejects(
      f.db.query("select campaign_control_read()"),
      /CC_FORBIDDEN/,
    );
  } finally {
    await f.db.close();
  }
});
test("CC: activation freezes four unique enrollments and pause applies to all senders", async () => {
  const f = await fixture();
  try {
    const g = await f.command("create", f.payload);
    await f.command("activate", { id: g.id, senders: f.payload.senders });
    const view = await f.read("details", g.id);
    assert.equal(view.total, 4);
    assert.equal(view.campaign.metrics.pending, 4);
    await f.command("pause", { id: g.id });
    assert.equal((await f.read()).campaigns[0].status, "paused");
    await f.db.exec("reset role");
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*)::int n from campaign_enrollments",
        )
      ).rows[0].n,
      4,
    );
  } finally {
    await f.db.close();
  }
});
test("CC: conflicting scopes and changed brands roll back the entire group", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.command("create", {
        ...f.payload,
        selected_contact_ids: [randomUUID()],
      }),
      /CI_SELECTION_SCOPE/,
    );
    await assert.rejects(
      f.command("create", {
        ...f.payload,
        senders: [f.payload.senders[0], f.payload.senders[0]],
      }),
      /CC_INVALID_INPUT/,
    );
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query<any>("select count(*)::int n from campaigns")).rows[0]
        .n,
      0,
    );
    for (const sig of [
      "campaign_control_read(text,uuid,uuid,text,text,integer)",
      "campaign_control_command(text,jsonb,uuid)",
    ])
      assert.equal(
        (
          await f.db.query<any>(
            "select has_function_privilege('service_role',$1,'EXECUTE') ok",
            [sig],
          )
        ).rows[0].ok,
        false,
      );
  } finally {
    await f.db.close();
  }
});


test('CC: global cap reserves at most one across two senders without altering admission or attempts',async()=>{
 const f=await fixture();try{
  const g=await f.command('create',f.payload);await f.command('activate',{id:g.id,senders:f.payload.senders});await queueFixture(f,g.id);
  await f.db.exec('set role service_role');
  const first=(await f.db.query<any>('select * from claim_outbox()')).rows;assert.equal(first.length,1);
  const second=(await f.db.query<any>('select * from claim_outbox()')).rows;assert.equal(second.length,0);
  await f.db.exec('reset role');
  assert.equal((await f.db.query<any>("select count(*)::int n from outbox where status='sending'")).rows[0].n,1);
  const blocked=(await f.db.query<any>("select status,send_attempts,brand_admission_id from outbox where last_error='CC_GROUP_LIMIT'")).rows;
  assert(blocked.length>0);assert(blocked.every(r=>r.status==='queued'&&r.send_attempts===0&&r.brand_admission_id===null));
  await assert.rejects(f.db.exec(await readFile(root+'down.sql','utf8')),/CC_KEEP_GROUP_LIMIT/);
  await f.db.exec('rollback');
 }finally{await f.db.close();}
});
test('CC: manual reassignment preserves frozen intent and one active sequence; unsafe sends cannot move',async()=>{
 const f=await fixture();try{
  const g=await f.command('create',f.payload);await f.command('activate',{id:g.id,senders:f.payload.senders});await queueFixture(f,g.id);
  const before=await f.read('details',g.id),row=before.rows[0],target=f.accounts.find(a=>a!==row.account_id)!;
  const payload={id:g.id,contact_ids:[row.contact_id],expected_count:1,target_account_id:target,target_preparation:f.prep},key=randomUUID();
  await f.command('reassign',payload,key);assert.equal((await f.command('reassign',payload,key)).changed,1);
  const after=await f.read('details',g.id);assert.equal(after.total,4);assert.equal(after.rows.find((r:any)=>r.contact_id===row.contact_id).account_id,target);
  await f.db.exec('reset role');
  const history=(await f.db.query<any>("select o.status,o.account_id,o.brand_snapshot from outbox o join campaign_enrollments e on e.id=o.enrollment_id where e.contact_id=$1",[row.contact_id])).rows;
  assert.equal(history.length,1);assert.equal(history[0].status,'cancelled');assert.equal(history[0].account_id,row.account_id);
  assert.equal((await f.db.query<any>("select count(*)::int n from campaign_enrollments where contact_id=$1 and status in ('active','paused')",[row.contact_id])).rows[0].n,1);
  await queueFixture(f,g.id);
  assert.equal((await f.db.query<any>("select count(*)::int n from outbox o join campaign_enrollments e on e.id=o.enrollment_id where e.contact_id=$1 and o.status='queued' and o.account_id=$2",[row.contact_id,target])).rows[0].n,1);
  await assert.rejects(f.command('reassign',{...payload,target_account_id:row.account_id}),/CC_TARGET_HISTORY/);
  assert.equal((await f.read('details',g.id)).rows.find((r:any)=>r.contact_id===row.contact_id).account_id,target);
  const unsafe=after.rows.find((r:any)=>r.contact_id!==row.contact_id);
  await f.db.exec('reset role');
  await f.db.query("update outbox set status='uncertain' where enrollment_id in(select id from campaign_enrollments where contact_id=$1)",[unsafe.contact_id]);
  await assert.rejects(f.command('reassign',{...payload,contact_ids:[unsafe.contact_id],target_account_id:f.accounts.find(a=>a!==unsafe.account_id)}),/CC_STALE/);
 }finally{await f.db.close();}
});
test('CC: review categories and Bouncer confirmation remain scoped, atomic and non-repeating',async()=>{
 const f=await fixture();try{
  await f.db.exec('reset role');
  const id=f.contacts[0];await f.db.query("update contacts set verification='pending' where id=$1",[id]);
  await f.db.query("insert into verifications(contact_id,request_key,result,state,reason) values($1,$2,'pending','technical_error','provider_http_402')",[id,randomUUID()]);
  const overview=await f.read();assert.equal(overview.funnel.review,1);assert.equal(overview.funnel.valid,3);
  const payload={batch:f.batch,contact_ids:[id],expected_count:1,cause_resolved:false};
  await assert.rejects(f.command('verify',payload),/CC_STALE/);
  const key=randomUUID();assert.equal((await f.command('verify',{...payload,cause_resolved:true},key)).queued,1);
  assert.equal((await f.command('verify',{...payload,cause_resolved:true},key)).queued,1);
  await assert.rejects(f.command('verify',{...payload,cause_resolved:true}),/CC_STALE/);
  assert.equal((await f.read('leads',null,'pending')).rows[0].retryable,false);
  await f.db.exec('reset role');const uncertain=f.contacts[1];await f.db.query("update contacts set verification='pending' where id=$1",[uncertain]);
  await f.db.query("insert into verifications(contact_id,request_key,result,state) values($1,$2,'pending','uncertain_request')",[uncertain,randomUUID()]);
  assert.equal((await f.read('leads',null,'review')).rows.find((r:any)=>r.contact_id===uncertain).retryable,false);
  await assert.rejects(f.command('verify',{...payload,contact_ids:[uncertain],cause_resolved:true}),/CC_STALE/);
 }finally{await f.db.close();}
});

test('CC: a sender with no assigned leads stays draft; excluding a pending contact preserves history and totals',async()=>{
 const f=await fixture();try{
  const g=await f.command('create',{...f.payload,selected_contact_ids:[f.contacts[0]]});await f.command('activate',{id:g.id,senders:f.payload.senders});
  const details=await f.read('details',g.id);assert.equal(details.total,1);assert.equal(details.campaign.status,'active');assert.equal(details.campaign.senders.filter((s:any)=>s.campaign_status==='draft').length,1);
  await queueFixture(f,g.id);await f.command('exclude',{id:g.id,contact_ids:[f.contacts[0]],expected_count:1});
  const after=await f.read('details',g.id);assert.equal(after.total,1);assert.equal(after.campaign.metrics.pending,0);assert.equal(after.rows[0].manageable,false);
  await f.db.exec('reset role');assert.equal((await f.db.query<any>("select status from outbox")).rows[0].status,'cancelled');
 }finally{await f.db.close();}
});
test('CC: migration reversal restores the installed claim and keeps legacy metadata/history',async()=>{
 const f=await fixture();try{
  await f.db.exec('reset role');
  const source=(await f.db.query<any>("select prosrc from pg_proc where oid='campaign_control_v1.claim_outbox()'::regprocedure")).rows[0].prosrc;
  await f.db.exec(await readFile(root+'down.sql','utf8'));
  assert.equal((await f.db.query<any>("select prosrc from pg_proc where oid='public.claim_outbox()'::regprocedure")).rows[0].prosrc,source);
  assert.equal((await f.db.query<any>('select count(*)::int n from contacts')).rows[0].n,4);
 }finally{await f.db.close();}
});
