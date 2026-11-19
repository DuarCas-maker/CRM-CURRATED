import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTasksOverview,
  parseTaskOverviewQuery,
} from "../src/lib/pipeline-os/tasks-overview";
import { overviewNow, tasksOverviewFixture } from "./fixtures/tasks-overview";

test("overview matches Campaign Control unique sends, deduplicates replied leads and separates every account", () => {
  const result = buildTasksOverview(tasksOverviewFixture(), {}, overviewNow);
  assert.equal(result.totals.sent, 2);
  assert.equal(result.totals.leads, 73);
  assert.equal(result.totals.managed, 3);
  assert.equal(result.totals.replied, 2);
  const santino = result.byRep.find((r) => r.id === "santino")!;
  assert.equal(santino.sent, 1);
  assert.equal(santino.replied, 1);
  assert.deepEqual(
    santino.accounts.map((a) => [a.email, a.sent, a.replied]),
    [
      ["santino@team-one.example.test", 1, 1],
      ["santino@team-two.example.test", 1, 1],
    ],
  );
  assert.equal(result.byRep.find((r) => r.id === "zero")?.leads, 0);
  assert.equal(result.byRep.find((r) => r.id === "zero")?.accounts[0].sent, 0);
  assert.equal(result.total, 73);
  assert.equal(result.rows.length, 50);
  assert.equal(result.hasMore, true);
});

test("rep/account/status/search filters page leads without altering the complete historical summary", () => {
  const source = tasksOverviewFixture();
  const all = buildTasksOverview(source, {}, overviewNow);
  const managed = buildTasksOverview(
    source,
    { owner: "santino", status: "managed" },
    overviewNow,
  );
  assert.deepEqual(
    managed.rows.map((r) => r.id),
    ["contact-0", "contact-4"],
  );
  assert.deepEqual(managed.totals, all.totals);
  assert.equal(
    buildTasksOverview(
      source,
      { owner: "samuel", status: "replied" },
      overviewNow,
    ).total,
    1,
  );
  assert.equal(
    buildTasksOverview(
      source,
      { owner: "santino", account: "account-b" },
      overviewNow,
    ).total,
    1,
  );
  assert.equal(
    buildTasksOverview(
      source,
      { owner: "santino", account: "account-c" },
      overviewNow,
    ).total,
    0,
  );
  assert.equal(
    buildTasksOverview(source, { status: "pending" }, overviewNow).total,
    70,
  );
  const second = buildTasksOverview(source, { page: 1 }, overviewNow);
  assert.equal(second.rows.length, 23);
  assert.equal(second.hasMore, false);
  assert.equal(
    buildTasksOverview(source, { q: "LEAD72@EXAMPLE.TEST" }, overviewNow).total,
    1,
  );
  assert.equal(
    Object.values(all.totals.stages).reduce((n, v) => n + v, 0),
    73,
  );
});

test("drafts, queued sends, automated/ignored/third-party replies and lender threads never prove lead management", () => {
  const s = tasksOverviewFixture();
  s.facts = [];
  const conversation = {
    ...s.conversations[0],
    id: "check",
    opportunity_id: "case-2",
    recipient_email: "lead2@example.test",
  };
  s.conversations = [
    conversation,
    { ...conversation, id: "lender", submission_id: "submission" },
  ];
  const base = {
    ...s.messages[0],
    conversation_id: "check",
    id: "draft",
    status: "draft",
  };
  s.messages = [
    base,
    { ...base, id: "queued", status: "queued" },
    {
      ...base,
      id: "other-recipient",
      status: "sent",
      participants: [{ role: "to", email: "someone-else@example.test" }],
    },
    { ...base, id: "lender-sent", conversation_id: "lender", status: "sent" },
    { ...base, id: "future", status: "sent", sent_at: "2027-01-01T00:00:00Z" },
    {
      ...base,
      id: "third-party",
      direction: "inbound",
      status: "received",
      sender: "stranger@example.test",
      nature: "personal",
    },
    {
      ...base,
      id: "ignored",
      direction: "inbound",
      status: "received",
      sender: "lead2@example.test",
      nature: "personal",
      reply_intent: "ignored",
    },
    {
      ...base,
      id: "automated",
      direction: "inbound",
      status: "received",
      sender: "lead2@example.test",
      nature: "automated",
    },
  ];
  const result = buildTasksOverview(s, {}, overviewNow);
  assert.equal(result.totals.managed, 0);
  assert.equal(result.totals.replied, 0);
  assert.equal(result.totals.sent, 0);
});

test("seller projection rejects forged other-rep filters and closer never gains campaign data", () => {
  const s = tasksOverviewFixture();
  s.profile = s.profiles.find((p) => p.id === "santino")!;
  const seller = buildTasksOverview(s, { owner: "samuel" }, overviewNow);
  assert.equal(seller.total, 0);
  assert(seller.byRep.every((r) => r.id === "santino"));
  assert(!JSON.stringify(seller).includes("samuel@example.test"));
  s.profile = { ...s.profile, role: "closer" };
  const closer = buildTasksOverview(s, {}, overviewNow);
  assert.equal(closer.totals.sent, null);
  assert.equal(closer.campaignsAvailable, false);
  assert(closer.rows.every((r) => !r.campaignSent));
  for (const params of [
    "page=-1",
    "status=sent",
    "days=30",
    "account=",
    "page=1.2",
  ])
    assert.throws(() => parseTaskOverviewQuery(new URLSearchParams(params)));
});

test("unqualified leads remain visible without links or mail evidence from unavailable cases", () => {
  const source = tasksOverviewFixture();
  source.cases = [];
  source.facts = [];
  const result = buildTasksOverview(source, {}, overviewNow);
  assert.equal(result.totals.leads, 73);
  assert(result.rows.every((r) => r.caseId === null));
  assert.equal(result.totals.managed, 0);
  assert.equal(result.totals.replied, 0);
});
