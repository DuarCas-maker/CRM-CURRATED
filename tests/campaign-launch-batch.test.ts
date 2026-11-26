import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { flowOwnerFixture } from "./fixtures/campaign-flow-owner";
import { exerciseLaunchBatch } from "./fixtures/campaign-launch-batch";
import { readFlow } from "../src/lib/server/campaign-flow";
import { controlError } from "../src/lib/server/campaign-control";
test("batch launch preserves eligibility, funding, permissions, receipts and exact rollback", async () => {
  const f = await flowOwnerFixture();
  try {
    await exerciseLaunchBatch(f);
  } finally {
    await f.db.close();
  }
});
test("SQL timeout is a safe 503 without exposing SQL or changing data conflicts", async () => {
  let code = "57014",
    message = "canceling statement due to statement timeout SECRET SQL";
  const ctx: any = {
    profile: { role: "superadmin" },
    db: { rpc: async () => ({ data: null, error: { code, message } }) },
  };
  const url = new URL(
    "https://crm.example.test/api/campaigns/flow?campaign=" + randomUUID(),
  );
  const response = async () => {
    try {
      await readFlow(url, ctx);
      throw Error("expected error");
    } catch (e) {
      return controlError(e);
    }
  };
  const timed = await response();
  assert.equal(timed.status, 503);
  const body = await timed.text();
  assert.match(body, /tiempo de espera/);
  assert.doesNotMatch(body, /SECRET|canceling statement/);
  code = "P0001";
  message = "CF_TEMPLATE_DATA";
  assert.equal((await response()).status, 409);
});
