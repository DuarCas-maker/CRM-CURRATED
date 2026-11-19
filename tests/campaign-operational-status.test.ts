import test from "node:test";
import assert from "node:assert/strict";
import { campaignUsageBlocked, type ControlCampaign } from "../src/lib/campaign-control";
test("campaign operational status distinguishes full sync blockage from partial sender waits", () => {
  const held = { pending: 5, blockers: ["usage_unknown"] }, ready = { pending: 5, blockers: [] };
  const campaign = (senders: unknown[], pending = 10, status = "active") => ({ status, metrics: { pending }, senders }) as ControlCampaign;
  assert.equal(campaignUsageBlocked(campaign([held])), true);
  assert.equal(campaignUsageBlocked(campaign([held, ready])), false);
  assert.equal(campaignUsageBlocked(campaign([ready])), false);
  assert.equal(campaignUsageBlocked(campaign([held], 0)), false);
  assert.equal(campaignUsageBlocked(campaign([held], 5, "paused")), false);
});
