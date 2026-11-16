import test from "node:test";
import assert from "node:assert/strict";
import { demoWorkspace } from "../src/lib/demo";
import {
  buildPipelineBoard,
  comparePipelineOffers,
  parsePipelineQuery,
  type PipelineProcess,
} from "../src/lib/pipeline-os/module";

const now = Date.parse("2026-11-12T15:00:00Z");
function fixture() {
  const d = demoWorkspace();
  d.opportunities = d.opportunities.slice(0, 1);
  const o = d.opportunities[0];
  o.stage = "lenders";
  o.application_signed = o.application_complete = true;
  o.funded_at = null;
  o.funded_amount = null;
  o.amount = 50000;
  d.offers = [];
  d.submissions = [];
  d.tasks = [];
  d.documents = [];
  d.messages = [];
  d.conversations = [];
  d.opportunity_signals = {};
  return {
    ...d,
    flow_signals: {
      [o.id]: {
        approved: true,
        ready: true,
        sent: 0,
        manualSent: null as boolean | null,
      },
    },
  };
}

test("application signatures are not lender contract evidence; historical processes do not override the active one", () => {
  const d = fixture(),
    o = d.opportunities[0];
  const process = (
    n: number,
    state: string,
    classification = "active",
  ): PipelineProcess => ({
    id: `p${n}`,
    opportunity_id: o.id,
    sequence_number: n,
    state,
    classification,
    is_unclassified_archive: false,
  });
  let b = buildPipelineBoard(d, [], {}, now);
  assert.equal(b.counts.signed, 0);
  assert.equal(b.counts.need, 1);
  b = buildPipelineBoard(
    d,
    [process(1, "contract_signed", "inactive"), process(2, "submitted")],
    {},
    now,
  );
  assert.equal(b.counts.signed, 0);
  b = buildPipelineBoard(d, [process(2, "contract_signed")], {}, now);
  assert.equal(b.counts.signed, 1);
  assert.equal(b.rows[0].processId, "p2");
});

test("a human choice and the highest amount are distinct; expired or declined offers are not active", () => {
  const d = fixture(),
    o = d.opportunities[0];
  const offer = (
    id: string,
    amount: number,
    status = "received",
    expiry = "2026-12-01",
  ): (typeof d.offers)[number] => ({
    id,
    opportunity_id: o.id,
    submission_id: id,
    amount,
    status,
    product: "MCA",
    term: "24 weeks",
    cost: "1.25 factor",
    frequency: "weekly",
    fees: "0",
    expires_at: expiry,
  });
  d.offers = [
    offer("chosen", 45000, "accepted"),
    offer("largest", 65000),
    offer("expired", 90000, "received", "2026-11-01"),
    offer("no", 95000, "rejected"),
  ];
  d.submissions = d.offers.map((f) => ({
    id: f.id,
    opportunity_id: o.id,
    lender_id: f.id,
    closer_id: d.profile.id,
    status: "offer",
    channel: "email",
    submitted_at: "2026-11-10",
    next_action: "Review requirements",
    next_action_at: "2026-11-13",
    external_reference: "",
  }));
  const c = comparePipelineOffers(o, d.offers, d.submissions, [], now);
  assert.equal(c.selected?.id, "chosen");
  assert.equal(c.highest?.id, "largest");
  assert.equal(c.active.length, 2);
  assert.equal(c.active[0].id, "chosen");
  assert.equal(
    comparePipelineOffers(
      o,
      [offer("future-unknown", 1, "received", "bad-date")],
      [],
      [],
      now,
    ).active.length,
    0,
  );
});

test("counts, owner filtering and search run before pagination; one business counts once", () => {
  const d = fixture(),
    seed = d.opportunities[0];
  d.opportunities = Array.from({ length: 123 }, (_, i) => ({
    ...seed,
    id: `c${i}`,
    company: `Business ${i}`,
    seller_id: i < 110 ? "one" : "two",
    closer_id: null,
  }));
  d.flow_signals = Object.fromEntries(
    d.opportunities.map((o) => [
      o.id,
      { approved: true, ready: true, sent: 0, manualSent: null },
    ]),
  );
  const b = buildPipelineBoard(
    d,
    [],
    { group: "need", owner: "one", q: "Business", page: 2 },
    now,
  );
  assert.equal(b.total, 110);
  assert.equal(b.counts.need, 110);
  assert.equal(b.rows.length, 10);
  assert.equal(b.hasMore, false);
  assert.equal(
    b.byRep.reduce((s, r) => s + r.total, 0),
    110,
  );
  assert.equal(buildPipelineBoard(d, [], { q: "no match" }, now).total, 0);
});

test("seller projection never exposes closer offers, contract states, private tasks or other people's cases", () => {
  const d = fixture(),
    o = d.opportunities[0];
  d.profile = { ...d.profile, role: "seller", id: o.seller_id };
  o.handed_off_at = "2026-11-01";
  o.closer_id = "another-current-owner";
  d.tasks = [
    {
      id: "private",
      opportunity_id: o.id,
      owner_id: d.profile.id,
      title: "Private lender amount",
      due_at: "2026-11-01",
      status: "open",
      area: "closer",
    },
  ];
  d.opportunities.push({
    ...o,
    id: "other",
    seller_id: "outsider",
    company: "Secret business",
  });
  const b = buildPipelineBoard(
    d,
    [
      {
        id: "p",
        opportunity_id: o.id,
        state: "contract_signed",
        sequence_number: 1,
        classification: "active",
        is_unclassified_archive: false,
      },
    ],
    {},
    now,
  );
  assert.equal(b.total, 1);
  assert.equal(b.counts.signed, 0);
  assert.equal(b.rows[0].processState, null);
  assert.equal(b.rows[0].offers, null);
  assert.equal(b.rows[0].lenderCount, null);
  assert.equal(b.summary.fundedAmount, null);
  assert(!JSON.stringify(b).includes("Private lender"));
  assert(!JSON.stringify(b).includes("Secret business"));
});

test("confirmed lender signal is reused, queued rows are not counted and funding is not multiplied by processes", () => {
  const d = fixture(),
    o = d.opportunities[0];
  o.stage = "funded";
  o.funded_at = "2026-11-11";
  o.funded_amount = 48000;
  d.opportunity_signals = {
    [o.id]: {
      lenderCount: 40,
      documentCount: 4,
      lastClientSentAt: null,
      lastLenderSentAt: "2026-11-11",
    },
  };
  const b = buildPipelineBoard(
    d,
    [1, 2].map((i) => ({
      id: `p${i}`,
      opportunity_id: o.id,
      state: "disbursed",
      sequence_number: i,
      classification: "active",
      is_unclassified_archive: false,
    })),
    {},
    now,
  );
  assert.equal(b.rows[0].lenderCount, 40);
  assert.equal(b.summary.fundedAmount, 48000);
  assert.equal(b.counts.clients, 1);
  delete d.opportunity_signals;
  d.submissions = [
    {
      id: "queued",
      opportunity_id: o.id,
      lender_id: "l",
      closer_id: d.profile.id,
      status: "queued",
      channel: "email",
      submitted_at: "2026-11-11",
      next_action: "",
      next_action_at: "",
      external_reference: "",
    },
  ];
  assert.equal(buildPipelineBoard(d, [], {}, now).rows[0].lenderCount, 0);
});

test("filters reject invalid input and reports expose an observation time without claiming a Gmail scan", () => {
  assert.throws(() => parsePipelineQuery(new URLSearchParams("page=-1")));
  assert.throws(() => parsePipelineQuery(new URLSearchParams("group=secret")));
  assert.throws(() => parsePipelineQuery(new URLSearchParams("hours=7")));
  const d = fixture();
  d.opportunities[0].updated_at = "2026-11-12T14:00:00Z";
  const b = buildPipelineBoard(d, [], { hours: 24 }, now);
  assert.equal(b.asOf, new Date(now).toISOString());
  assert.equal(b.source, "crm");
  assert.equal(b.hours, 24);
});

test("old-process offers and draft offers never turn a new submission into an active offer", () => {
  const d = fixture(),
    o = d.opportunities[0];
  d.submissions = [
    {
      id: "s",
      opportunity_id: o.id,
      process_id: "old",
      lender_id: "l",
      closer_id: d.profile.id,
      status: "offer",
      channel: "email",
      submitted_at: "2026-11-11",
      next_action: "",
      next_action_at: "",
      external_reference: "",
    },
  ];
  d.offers = [
    {
      id: "f",
      opportunity_id: o.id,
      submission_id: "s",
      product: "MCA",
      amount: 50000,
      term: "24 weeks",
      cost: "1.2",
      frequency: "weekly",
      fees: "",
      expires_at: "2026-12-01",
      status: "received",
    },
  ];
  const b = buildPipelineBoard(
    d,
    [
      {
        id: "new",
        opportunity_id: o.id,
        sequence_number: 2,
        state: "submitted",
        classification: "active",
        is_unclassified_archive: false,
      },
    ],
    {},
    now,
  );
  assert.equal(b.counts.offers, 0);
  assert.equal(b.counts.need, 1);
  d.offers[0].status = "draft";
  assert.equal(
    comparePipelineOffers(o, d.offers, d.submissions, [], now).active.length,
    0,
  );
});

test("document progress uses the existing five-document minimum and does not credit duplicate statements", () => {
  const d = fixture(),
    id = d.opportunities[0].id;
  assert.equal(buildPipelineBoard(d, [], {}, now).rows[0].requiredCount, 5);
  d.documents = Array.from({ length: 4 }, (_, i) => ({
    id: `d${i}`,
    opportunity_id: id,
    name: "Statement",
    kind: "bank_statement",
    period: "2026-10",
    status: "approved",
    source: "fixture",
    created_at: "2026-11-11",
    storage_path: `fixture/${i}`,
    content_hash: "same-file",
  }));
  const row = buildPipelineBoard(d, [], {}, now).rows[0];
  assert.equal(row.approvedCount, 1);
  assert.equal(row.requiredCount, 5);
});

test("campaign summary counts the complete authorized source independently of the case page", () => {
  const d = fixture();
  const source = {
    ...d,
    campaigns: Array.from({ length: 713 }, (_, i) => ({
      id: `c${i}`,
      status: i < 601 ? "active" : "scheduled",
    })),
  };
  const b = buildPipelineBoard(source, [], {}, now);
  assert.deepEqual(b.campaigns, { total: 713, active: 601, scheduled: 112 });
});

test("a funded customer's new submitted renewal stays active without duplicating recorded funding", () => {
  const d = fixture(),
    o = d.opportunities[0];
  o.stage = "funded";
  o.funded_at = "2026-11-01";
  o.funded_amount = 48000;
  const b = buildPipelineBoard(
    d,
    [
      {
        id: "renewal",
        opportunity_id: o.id,
        sequence_number: 2,
        state: "submitted",
        classification: "active",
        is_unclassified_archive: false,
      },
    ],
    {},
    now,
  );
  assert.equal(b.counts.clients, 1);
  assert.equal(b.counts.need, 1);
  assert.equal(b.counts.tasks, 1);
  assert.equal(b.summary.fundedAmount, 48000);
});
