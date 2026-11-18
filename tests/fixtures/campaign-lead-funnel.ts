import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { flowOwnerFixture } from "./campaign-flow-owner";
import { queueFixture } from "./campaign-control";
import type { LeadFunnelPage } from "../../src/lib/campaign-lead-funnel";
export const funnelRoot = "docs/specs/pipeline-os/campaign-flow-20261117/revisions/lead-funnel/";
export async function funnelFixture() {
  const f = await flowOwnerFixture();
  await f.db.exec("reset role");
  await f.db.exec(await readFile(funnelRoot + "up.sql", "utf8"));
  return f;
}
export async function exerciseLeadFunnel(f: Awaited<ReturnType<typeof flowOwnerFixture>>, installed = false) {
  const { db } = f;
  await db.exec("reset role");
  const before = (await db.query<{ hash: string }>("select md5(prosrc) hash from pg_proc where oid='public.campaign_flow_launch(jsonb,uuid)'::regprocedure")).rows[0].hash;
  const up = await readFile(funnelRoot + "up.sql", "utf8");
  if (!installed) await db.exec(up);
  async function add(name: string, verification = "pending", state?: string) {
    await db.exec("reset role");
    const id = randomUUID();
    await db.query("insert into contacts(id,email,name,verification) values($1,$2,$3,$4)", [id, name + "@example.test", name, verification]);
    await db.query("insert into leads(contact_id,company,seller_id) values($1,$2,$3)", [id, "Example " + name, f.users.seller]);
    if (state) await db.query("insert into verifications(contact_id,request_key,result,state) values($1,$2,'pending',$3)", [id, randomUUID(), state]);
    return id;
  }
  const pending = await add("pending"), queued = await add("queued", "pending", "queued"), submitted = await add("submitted", "pending", "submitted");
  const technical = await add("technical", "pending", "technical_error");
  await add("unknown", "pending", "uncertain_request");
  const credits = await add("credits", "pending", "technical_error");
  await db.query("update verifications set reason='provider_http_402' where contact_id=$1", [credits]);
  await add("uncertain", "uncertain");
  await add("invalid", "invalid");
  const suppressed = await add("suppressed");
  await db.query("insert into suppressions(email,reason) values('suppressed@example.test','fixture')");
  const advanced = await add("advanced", "valid");
  await db.query("update opportunities set stage='documents_pending' where contact_id=$1", [advanced]);
  const previous = await add("previous", "valid");
  await db.query("update opportunities set last_contact=now() where contact_id=$1", [previous]);
  // The existing schema prevents duplicate lead rows for the same contact.
  await assert.rejects(db.query("insert into leads(contact_id,company,seller_id) values($1,'Duplicate fixture lead',$2)", [pending, f.users.seller]), /leads_contact_id_key/);
  const read = async (filter = "all", search = "", page = 0, size = 50) => {
    await f.asUser(f.users.admin);
    return (await db.query<{ r: LeadFunnelPage }>("select campaign_flow_leads($1,$2,$3,$4) r", [filter, search, page, size])).rows[0].r;
  };
  let result = await read();
  assert.deepEqual(result.funnel, { total: 15, pending: 1, running: 2, available: 4, campaign: 0, contacted: 0, review: 4, excluded: 2, restricted: 2 });
  assert.equal(result.rows.find(x => x.contact_id === queued)!.retryable, false);
  assert.equal(result.rows.find(x => x.contact_id === submitted)!.retryable, false);
  assert.equal(result.rows.find(x => x.contact_id === suppressed)!.retryable, false);
  assert.equal(result.rows.find(x => x.contact_id === technical)!.retryable, true);
  for (const [filter, count] of Object.entries(result.funnel)) {
    if (filter === "total") continue;
    const view = await read(filter);
    assert.equal(view.total, count);
    assert.equal(view.rows.length, count);
    assert(view.rows.every(x => x.funnel_state === filter));
  }
  const search = await read("running", "submitted");
  assert.equal(search.total, 1);
  assert.equal(search.funnel.total, 15); // Global funnel unaffected by list search.
  assert.equal((await read("all", "", 1, 20)).rows.length, 0);
  // Change actual data, then read: queued -> completed valid moves to available.
  await db.exec("reset role");
  await db.query("update contacts set verification='valid' where id=$1", [queued]);
  await db.query("update verifications set state='completed',result='valid' where contact_id=$1", [queued]);
  result = await read();
  assert.equal(result.funnel.running, 1);
  assert.equal(result.funnel.available, 5);
  const launched = await f.launch();
  result = await read();
  assert.equal(result.funnel.campaign, 4);
  assert.equal(result.funnel.available, 1);
  await queueFixture(f, launched.id);
  await db.exec("reset role");
  const outbox = (await db.query<{ id: string; contact_id: string }>("select b.id,e.contact_id from outbox b join campaign_enrollments e on e.id=b.enrollment_id order by b.id")).rows;
  // A test send with full Gmail fields is still not a real contact confirmation.
  await db.query("insert into outbox(account_id,opportunity_id,enrollment_id,to_email,subject,body,area,message_id_header,requested_by,request_key,campaign_test,status,gmail_message_id,sent_at) select account_id,opportunity_id,enrollment_id,to_email,subject,body,area,$2,requested_by,$2,true,'sent','synthetic-test',now() from outbox where id=$1", [outbox[0].id, randomUUID()]);
  await db.query("update outbox set status='uncertain' where id=$1", [outbox[1].id]);
  result = await read();
  assert.equal(result.funnel.contacted, 0);
  await db.exec("reset role");
  await db.query("update outbox set status='sent',gmail_message_id='synthetic-confirmed',sent_at=now() where id=$1", [outbox[0].id]);
  result = await read();
  assert.equal(result.funnel.contacted, 1);
  assert.equal(result.funnel.campaign, 3);
  assert.equal(result.rows.find(x => x.contact_id === outbox[0].contact_id)!.funnel_state, "contacted");
  assert.equal(Object.entries(result.funnel).filter(([k]) => k !== "total").reduce((n, [, count]) => n + count, 0), result.funnel.total);
  const pool = (await db.query<any>("select campaign_flow_pool() r")).rows[0].r;
  assert.equal(pool.total, result.funnel.available);
  assert.deepEqual(pool.rows.map((x: any) => x.contact_id).sort(), (await read("available")).rows.map(x => x.contact_id).sort());
  for (const args of [["invalid", "", 0, 50], ["all", "", -1, 50], ["all", "", 0, 25], [null, "", 0, 50], ["all", null, 0, 50]])
    await assert.rejects(db.query("select campaign_flow_leads($1,$2,$3,$4)", args), /CF_INVALID_INPUT/);
  await f.asUser(f.users.admin, "aal1");
  await assert.rejects(db.query("select campaign_flow_leads()"), /CF_FORBIDDEN/);
  await f.asUser(f.users.seller);
  await assert.rejects(db.query("select campaign_flow_leads()"), /CF_FORBIDDEN/);
  await db.exec("reset role");
  await db.query("update profiles set role='seller_admin' where id=$1", [f.users.outsider]);
  await f.asUser(f.users.outsider);
  // seller_admin already has global lead visibility in the existing can_lead policy.
  assert.equal((await db.query<any>("select campaign_flow_leads() r")).rows[0].r.funnel.total, result.funnel.total);
  await db.exec("reset role");
  await db.query("update profiles set active=false where id=$1", [f.users.outsider]);
  await f.asUser(f.users.outsider);
  await assert.rejects(db.query("select campaign_flow_leads()"), /CF_FORBIDDEN/);
  await db.exec("reset role");
  const acl = (await db.query<any>("select has_function_privilege('anon','public.campaign_flow_leads(text,text,integer,integer)','execute') anon,has_function_privilege('service_role','public.campaign_flow_leads(text,text,integer,integer)','execute') service,has_function_privilege('authenticated','campaign_flow_v1.lead_states()','execute') private")).rows[0];
  assert.deepEqual(acl, { anon: false, service: false, private: false });
  await db.exec(await readFile(funnelRoot + "down.sql", "utf8"));
  assert.equal((await db.query<any>("select to_regprocedure('public.campaign_flow_leads(text,text,integer,integer)') removed")).rows[0].removed, null);
  assert.equal((await db.query<{ hash: string }>("select md5(prosrc) hash from pg_proc where oid='public.campaign_flow_launch(jsonb,uuid)'::regprocedure")).rows[0].hash, before);
  await db.exec(up);
  assert.deepEqual((await read()).funnel, result.funnel);
  return { passed: true, exclusiveStates: 8, distinctContacts: 15, countsMatchEveryFilter: true, nativeEligiblePoolMatches: true, permissionsAndMfa: true, reversalPassed: true, existingLaunchUnchanged: true, sqlSha256: createHash("sha256").update(up).digest("hex"), realProviderRequests: 0 };
}
