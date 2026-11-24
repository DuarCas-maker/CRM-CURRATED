import test from "node:test";
import assert from "node:assert/strict";
import {buildTasksOverview} from "../src/lib/pipeline-os/tasks-overview";
import {tasksOverviewFixture,overviewNow} from "./fixtures/tasks-overview";
test("bounces count unique addresses per mailbox and overall, with account-local detail and retained unlocked history",()=>{
 const s=tasksOverviewFixture();
 const before=buildTasksOverview(s,{},overviewNow).totals.replied;
 const base={recipient:s.leads[0].email,contact_id:s.leads[0].contact_id,reason:"mailbox_full",smtp_status:"5.2.2",occurred_at:new Date(overviewNow-1000).toISOString(),active:false,blockReason:"mailbox_full"};
 s.bounces=[{...base,id:"event-1",account_id:"account-a"},{...base,id:"event-2",account_id:"account-a"},{...base,id:"event-3",account_id:"account-b"}];
 const result=buildTasksOverview(s,{status:"bounced"},overviewNow);
 assert.equal(result.totals.bounced,1);assert.equal(result.total,1);assert.equal(result.rows[0].bounces?.length,3);
 for(const id of ["account-a","account-b"]) {
  const account=buildTasksOverview(s,{status:"bounced",account:id},overviewNow);
  assert.equal(account.total,1);assert(account.rows[0].bounces?.every(b=>b.account_id===id));
  assert.equal(account.byAccount.find(a=>a.email===s.accounts.find(a=>a.id===id)?.email)?.bounced,1);
 }
 assert.equal(result.totals.replied,before,"bounce never creates or erases a human reply");
});
