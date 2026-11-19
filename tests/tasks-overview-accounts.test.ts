import test from "node:test";
import assert from "node:assert/strict";
import { buildTasksOverview } from "../src/lib/pipeline-os/tasks-overview";
import { tasksOverviewFixture, overviewNow } from "./fixtures/tasks-overview";

test("one email row merges owner/campaign associations, account aliases and repeated campaign sends", () => {
  const s = tasksOverviewFixture();
  s.accounts[0].owner_id = null;
  s.accounts.push({
    id: "alias-a",
    email: " SANTINO@TEAM-ONE.EXAMPLE.TEST ",
    owner_id: "samuel",
  });
  s.campaigns.push({
    id: "alias-campaign",
    seller_id: "samuel",
    account_id: "alias-a",
  });
  s.facts.push({ ...s.facts[0], campaignId: "alias-campaign" });
  const result = buildTasksOverview(s, {}, overviewNow);
  const rows = result.byAccount;
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((a) => a.email)).size, rows.length);
  const a = rows.find((a) => a.email === "santino@team-one.example.test")!;
  assert.equal(a.sent, 1);
  assert.equal(a.replied, 1);
  assert.equal(a.leads, 3);
  assert.equal(a.stages.app, 1);
  assert.equal(a.stages.offers, 1);
  assert.equal(a.stages.signed, 1);
  assert.equal(result.totals.sent, 2);
  assert.equal(result.totals.leads, 73);
});

test("a reply on one account never marks the same lead replied on another account", () => {
  const s = tasksOverviewFixture();
  s.facts.find((f) => f.campaignId === "campaign-b")!.reply_at = null;
  const result = buildTasksOverview(s, { account: "account-b" }, overviewNow);
  const b = result.byAccount.find(
    (a) => a.email === "santino@team-two.example.test",
  )!;
  assert.equal(b.sent, 1);
  assert.equal(b.replied, 0);
  assert.equal(result.rows[0].replied, false);
  assert.equal(result.rows[0].lastReplyAt, null);
  assert.equal(
    buildTasksOverview(s, { account: b.id, status: "replied" }, overviewNow)
      .total,
    0,
  );
  assert.equal(result.totals.replied, 2);
});

test("pending account activity stays pending even when another account has contacted that lead", () => {
  const s = tasksOverviewFixture();
  s.conversations.push({
    ...s.conversations[0],
    id: "cross-account",
    opportunity_id: "case-3",
    recipient_email: "lead3@example.test",
    account_id: "account-a",
  });
  s.messages.push({
    ...s.messages[0],
    id: "cross-send",
    conversation_id: "cross-account",
  });
  const result = buildTasksOverview(
    s,
    { account: "account-c", status: "pending" },
    overviewNow,
  );
  assert.deepEqual(
    result.rows.map((r) => r.id),
    ["contact-3"],
  );
  assert.equal(result.rows[0].managed, false);
  assert.equal(result.rows[0].lastSentAt, null);
  assert.equal(
    result.byAccount.find((a) => a.email === "samuel@example.test")!.leads,
    2,
  );
  assert.equal(
    buildTasksOverview(
      s,
      { account: "account-a", status: "managed" },
      overviewNow,
    ).rows.find((r) => r.id === "contact-3")?.managed,
    true,
  );
});

test("an authorized audience includes unsent leads once and account/stage filters preserve global totals", () => {
  const s = tasksOverviewFixture();
  s.audience = [
    {
      campaignId: "campaign-a",
      contact_id: "contact-6",
      opportunity_id: "case-6",
    },
    {
      campaignId: "campaign-a",
      contact_id: "contact-6",
      opportunity_id: "case-6",
    },
  ];
  const result = buildTasksOverview(
    s,
    { account: "account-a", stage: "need", status: "pending" },
    overviewNow,
  );
  assert.deepEqual(
    result.rows.map((r) => r.id),
    ["contact-6"],
  );
  assert.equal(
    result.byAccount.find((a) => a.email === "santino@team-one.example.test")!
      .leads,
    4,
  );
  assert.equal(result.totals.leads, 73);
  s.profile = s.profiles.find((p) => p.id === "santino")!;
  const seller = buildTasksOverview(s, { account: "account-c" }, overviewNow);
  assert.equal(seller.total, 0);
  assert(!seller.byAccount.some((a) => a.email === "samuel@example.test"));
});
