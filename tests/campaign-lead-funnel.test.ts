import test from "node:test";
import assert from "node:assert/strict";
import { flowOwnerFixture } from "./fixtures/campaign-flow-owner";
import { exerciseLeadFunnel } from "./fixtures/campaign-lead-funnel";
import { readFlow } from "../src/lib/server/campaign-flow";
import { controlError } from "../src/lib/server/campaign-control";

test("Lead funnel: real SQL exclusive states, counts, transitions, pool, permissions and reversal", async () => {
  const f = await flowOwnerFixture();
  try { await exerciseLeadFunnel(f); } finally { await f.db.close(); }
});
test("Lead funnel: HTTP reader bounds, admin gate and missing-schema failure", async () => {
  const calls: any[] = [];
  const context: any = { profile: { role: "superadmin" }, db: { rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { total: 0, rows: [] }, error: null }; } } };
  const url = (query = "") => new URL("https://example.test/api/campaigns/flow?mode=leads" + query);
  await readFlow(url("&filter=running&search=example&page=2&size=20"), context);
  assert.deepEqual(calls.pop(), { name: "campaign_income_leads", args: { filter: "running", search_text: "example", page_number: 2, page_size: 20, income_filter: "all" } });
  for (const query of ["&filter=valid", "&page=-1", "&size=25", "&search=" + "a".repeat(201)])
    assert.equal(controlError(await readFlow(url(query), context).catch(e => e)).status, 400);
  await assert.rejects(readFlow(url(), { ...context, profile: { role: "seller" } }), /MFA/);
  assert.equal(calls.length, 0);
  const absent = { ...context, db: { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "missing" } }) } };
  assert.equal(controlError(await readFlow(url(), absent).catch(e => e)).status, 503);
});
