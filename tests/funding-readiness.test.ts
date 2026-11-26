import test from "node:test";
import assert from "node:assert/strict";
import { flowOwnerFixture } from "./fixtures/campaign-flow-owner";
import { exerciseFundingReadiness } from "./fixtures/funding-readiness";
import { readFlow, checkFlowTemplate } from "../src/lib/server/campaign-flow";
import { defaultReminders } from "../src/lib/campaign-sequence";
import { randomUUID } from "node:crypto";
test("income filters and selected-template readiness preserve gates and read-only behavior", async () => {
  const f = await flowOwnerFixture();
  try {
    await exerciseFundingReadiness(f);
  } finally {
    await f.db.close();
  }
});
test("HTTP contract bounds, income filters and admin gate", async () => {
  const calls: any[] = [];
  const ctx: any = {
    profile: { role: "superadmin" },
    db: {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { data: { rows: [] }, error: null };
      },
    },
  };
  await readFlow(
    new URL("https://example.test/api/campaigns/flow?income=without&size=50"),
    ctx,
  );
  assert.equal(calls[0].name, "campaign_income_pool");
  assert.equal(calls[0].args.income_filter, "without");
  const p = {
    account_id: randomUUID(),
    template_id: randomUUID(),
    template_version: 1,
    contact_ids: [randomUUID()],
    reminders: defaultReminders,
  };
  await checkFlowTemplate(p, ctx);
  assert.equal(calls[1].name, "campaign_template_readiness");
  await assert.rejects(
    checkFlowTemplate(
      { ...p, contact_ids: [p.contact_ids[0], p.contact_ids[0]] },
      ctx,
    ),
  );
  await assert.rejects(
    checkFlowTemplate(p, { ...ctx, profile: { role: "seller" } }),
    /MFA/,
  );
  await assert.rejects(
    readFlow(new URL("https://example.test?income=invalid"), ctx),
  );
  assert.equal(calls.length, 2);
});
