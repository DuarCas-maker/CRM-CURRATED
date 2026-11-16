import test from "node:test";
import assert from "node:assert/strict";
import { masterPipelineResponse } from "../src/lib/server/pipeline-master-http";
import { HttpError } from "../src/lib/server/supabase";
import type { MasterDashboard } from "../src/lib/pipeline-os/master-pipeline";
test("Master GET rejects invalid filters before reaching the authenticated reader", async () => {
  let calls = 0;
  for (const search of [
    "days=200",
    "page=-1",
    "operation=send",
    "tab=unknown",
  ]) {
    const r = await masterPipelineResponse(
      new Request("https://crm.invalid/api/pipeline-os/master?" + search),
      async () => {
        calls++;
        return {} as MasterDashboard;
      },
    );
    assert.equal(r.status, 400);
  }
  assert.equal(calls, 0);
});
test("Master authentication and MFA failures remain denied without public caching", async () => {
  for (const status of [401, 403]) {
    const r = await masterPipelineResponse(
      new Request("https://crm.invalid/api/pipeline-os/master"),
      async () => {
        throw new HttpError(status, "Denied fixture");
      },
    );
    assert.equal(r.status, status);
    assert(!r.headers.get("Cache-Control")?.includes("public"));
  }
});
test("Master response is private/no-store and passes a bounded read query only", async () => {
  const r = await masterPipelineResponse(
    new Request("https://crm.invalid/api/pipeline-os/master?tab=leads&days=7"),
    async (q) => {
      assert.equal(q.tab, "leads");
      assert.equal(q.days, 7);
      assert.equal(q.page, 0);
      return { source: "crm" } as MasterDashboard;
    },
  );
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
});
