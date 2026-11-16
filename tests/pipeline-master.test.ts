import test from "node:test";
import assert from "node:assert/strict";
import { pipelineModuleDemo } from "../src/lib/pipeline-os/demo";
import {
  buildMasterPipeline,
  parseMasterQuery,
  type MasterSource,
} from "../src/lib/pipeline-os/master-pipeline";

const now = Date.parse("2026-11-15T18:00:00Z");
function fixture(): MasterSource {
  const { data } = pipelineModuleDemo();
  const o = {
    ...data.opportunities[0],
    id: "case-a",
    company: "Fixture Market",
    seller_id: data.profile.id,
    closer_id: data.profile.id,
    stage: "lenders" as const,
    funded_at: null,
    funded_amount: null,
    next_action_at: null,
  };
  return {
    ...data,
    opportunities: [o],
    tasks: [],
    offers: [],
    submissions: [],
    documents: [],
    conversations: [],
    messages: [],
    opportunity_signals: {},
    processes: [],
    events: [],
    offerEvidence: [],
    archive: [],
    leadCoverage: true,
  };
}
test("individual tasks use their owner, deduplicate IDs, and never count completed work", () => {
  const s = fixture(),
    o = s.opportunities[0];
  const task = {
    id: "t1",
    opportunity_id: o.id,
    owner_id: s.profile.id,
    title: "Review fixture",
    due_at: "2026-11-14T12:00:00Z",
    status: "open" as const,
    area: "seller" as const,
  };
  s.tasks = [
    task,
    { ...task, id: "t2" },
    { ...task },
    { ...task, id: "done", status: "done" },
  ];
  const b = buildMasterPipeline(s, { tab: "tasks" }, now),
    rep = b.byRep.find((r) => r.id === s.profile.id)!;
  assert.equal(rep.tasks, 2);
  assert.equal(rep.p1, 2);
  assert.equal(b.total, 2);
});
test("all authorized reps include zero workload and no name exclusions", () => {
  const s = fixture();
  s.profiles.push({
    id: "rep-empty",
    name: "Alejandro",
    email: "rep@fixture.example",
    role: "seller",
    active: true,
  });
  assert(
    buildMasterPipeline(s, {}, now).byRep.some(
      (r) => r.id === "rep-empty" && r.tasks === 0,
    ),
  );
});
test("seller cannot receive another case, closer-only financial data, or another rep by forged owner", () => {
  const s = fixture();
  s.profile = { ...s.profile, role: "seller" };
  s.opportunities.push({
    ...s.opportunities[0],
    id: "foreign",
    seller_id: "other",
    company: "Secret fixture",
  });
  s.offers = [
    {
      id: "secret-offer",
      opportunity_id: s.opportunities[0].id,
      submission_id: "sub",
      amount: 970000,
      product: "MCA",
      term: "",
      cost: "",
      fees: "",
      frequency: "",
      expires_at: "2027-01-01",
      status: "received",
    },
  ];
  const b = buildMasterPipeline(s, { tab: "offers", owner: "other" }, now);
  assert.equal(b.total, 0);
  assert(!JSON.stringify(b).includes("970000"));
  assert(!JSON.stringify(b).includes("Secret fixture"));
  assert.equal(b.byRep.find((r) => r.id === s.profile.id)?.offers, null);
});
test("application signature and inactive history cannot become lender contract or funding", () => {
  const s = fixture(),
    o = s.opportunities[0];
  o.application_signed = true;
  o.application_complete = true;
  s.processes = [
    {
      id: "history",
      opportunity_id: o.id,
      sequence_number: 1,
      state: "contract_signed",
      classification: "inactive",
      is_unclassified_archive: false,
    },
    {
      id: "current",
      opportunity_id: o.id,
      sequence_number: 2,
      state: "submitted",
      classification: "active",
      is_unclassified_archive: false,
    },
  ];
  const b = buildMasterPipeline(s, { tab: "pipeline" }, now);
  assert.equal(b.rows[0].stage, "submitted");
  assert.equal(b.byRep.find((r) => r.id === s.profile.id)?.funded, 0);
});
test("withdrawal stays distinct from lender decline and current requirements map without writes", () => {
  const s = fixture(),
    o = s.opportunities[0];
  const p = {
    id: "p",
    opportunity_id: o.id,
    sequence_number: 1,
    state: "requirements",
    classification: "active",
    is_unclassified_archive: false,
  };
  s.processes = [p];
  assert.equal(
    buildMasterPipeline(s, { tab: "pipeline" }, now).rows[0].stage,
    "requirements",
  );
  p.state = "client_withdrew";
  assert.equal(
    buildMasterPipeline(s, { tab: "pipeline" }, now).rows[0].stage,
    "withdrawn",
  );
});
test("aggregate totals precede pagination across more than fifty cases", () => {
  const s = fixture(),
    seed = s.opportunities[0];
  s.opportunities = Array.from({ length: 73 }, (_, i) => ({
    ...seed,
    id: "c" + i,
    company: "Fixture " + String(i).padStart(3, "0"),
  }));
  const a = buildMasterPipeline(s, { tab: "pipeline" }, now),
    b = buildMasterPipeline(s, { tab: "pipeline", page: 1 }, now);
  assert.equal(a.total, 73);
  assert.equal(a.rows.length, 50);
  assert.equal(b.rows.length, 23);
  assert.deepEqual(a.byRep, b.byRep);
});
test("events need explicit evidence and valid historical dates; editing does not create a milestone", () => {
  const s = fixture(),
    o = s.opportunities[0];
  o.updated_at = new Date(now).toISOString();
  o.application_complete = true;
  s.events = [
    {
      id: "e",
      opportunity_id: o.id,
      process_id: null,
      submission_id: null,
      kind: "application_received",
      area: "seller",
      evidence_type: "manual",
      occurred_at: "2026-11-14T23:00:00Z",
    },
    {
      id: "bad",
      opportunity_id: o.id,
      process_id: null,
      submission_id: null,
      kind: "contract_signed",
      area: "closer",
      evidence_type: "inference",
      occurred_at: new Date(now).toISOString(),
    },
  ];
  const b = buildMasterPipeline(s, { tab: "stats", days: 7 }, now);
  assert.equal(
    b.daily.reduce((n, d) => n + d.applications, 0),
    1,
  );
  assert.equal(b.events.length, 1);
  assert.equal(b.daily.find((d) => d.day === "2026-11-15")?.applications, 0);
});
test("query rejects invalid ranges, pages and unexpected commands", () => {
  assert.throws(() => parseMasterQuery(new URLSearchParams("days=365")));
  assert.throws(() => parseMasterQuery(new URLSearchParams("page=-1")));
  assert.throws(() => parseMasterQuery(new URLSearchParams("operation=send")));
  assert.equal(parseMasterQuery(new URLSearchParams()).tab, "tasks");
});

test("a task follows its assigned rep even when the file belongs to another rep", () => {
  const s = fixture(),
    o = s.opportunities[0];
  s.profiles.push({
    id: "helper",
    name: "Helper Fixture",
    email: "helper@fixture.example",
    role: "seller",
    active: true,
  });
  s.tasks = [
    {
      id: "t",
      opportunity_id: o.id,
      owner_id: "helper",
      title: "Assigned task",
      due_at: "2026-11-14T12:00:00Z",
      area: "seller",
      status: "open",
    },
  ];
  const b = buildMasterPipeline(s, { owner: "helper", tab: "tasks" }, now);
  assert.equal(b.total, 1);
  assert.equal(b.byRep.find((r) => r.id === "helper")?.tasks, 1);
  assert.equal(b.byRep.find((r) => r.id === s.profile.id)?.tasks, 0);
});
test("renewal uses the current process rather than a historical funding on the file", () => {
  const s = fixture(),
    o = s.opportunities[0];
  o.funded_at = "2026-10-01T10:00:00Z";
  o.funded_amount = 45000;
  s.processes = [
    {
      id: "renewal",
      opportunity_id: o.id,
      sequence_number: 2,
      state: "submitted",
      classification: "active",
      is_unclassified_archive: false,
    },
  ];
  assert.equal(
    buildMasterPipeline(s, { tab: "pipeline" }, now).rows[0].stage,
    "submitted",
  );
});
test("highest offer and selected offer stay distinct; only the anchored thread can prove a reply", () => {
  const s = fixture(),
    o = s.opportunities[0],
    sub = {
      id: "sub",
      opportunity_id: o.id,
      lender_id: s.lenders[0]?.id || "l",
      closer_id: s.profile.id,
      status: "offer",
      channel: "email",
      submitted_at: "2026-11-13T12:00:00Z",
      next_action: "Review",
      next_action_at: "2026-11-16T12:00:00Z",
      external_reference: "",
    };
  s.submissions = [sub, { ...sub, id: "sub2" }];
  const offer = {
    id: "large",
    opportunity_id: o.id,
    submission_id: sub.id,
    product: "MCA",
    amount: 70000,
    term: "20 weeks",
    cost: "1.3",
    fees: "0",
    frequency: "weekly",
    status: "received",
    expires_at: "2027-01-01",
    created_at: "2026-11-13T12:00:00Z",
  };
  s.offers = [
    offer,
    { ...offer },
    {
      ...offer,
      id: "chosen",
      submission_id: "sub2",
      amount: 40000,
      status: "selected",
    },
  ];
  s.conversations = [
    {
      id: "right",
      opportunity_id: o.id,
      submission_id: sub.id,
      account_id: "account",
      subject: "Fixture offer",
      area: "closer",
      needs_attention: true,
      updated_at: null,
    },
    {
      id: "other",
      opportunity_id: o.id,
      submission_id: "sub2",
      account_id: "account",
      subject: "Different thread",
      area: "closer",
      needs_attention: false,
      updated_at: null,
    },
  ];
  const inbound = {
    id: "in",
    conversation_id: "right",
    direction: "inbound" as const,
    sender: "lender@fixture.example",
    body: "Fixture offer",
    sent_at: "2026-11-13T12:00:00Z",
    status: "received",
    area: "closer" as const,
  };
  s.messages = [
    inbound,
    {
      ...inbound,
      id: "unrelated",
      conversation_id: "other",
      direction: "outbound",
      status: "sent",
      sent_at: "2026-11-14T12:00:00Z",
    },
    {
      ...inbound,
      id: "draft",
      direction: "outbound",
      status: "draft",
      sent_at: "2026-11-14T13:00:00Z",
    },
  ];
  s.offerEvidence = [{ offer_id: offer.id, message_id: inbound.id }];
  let row = buildMasterPipeline(s, { tab: "offers" }, now).rows[0];
  assert.equal(row.offers?.length, 2);
  assert.equal(row.best?.amount, 70000);
  assert.equal(row.best?.selected, false);
  assert.equal(row.offers?.find((o) => o.id === "chosen")?.selected, true);
  assert.equal(row.best?.answered, false);
  s.messages.push({
    ...inbound,
    id: "answer",
    direction: "outbound",
    status: "sent",
    sent_at: "2026-11-14T14:00:00Z",
  });
  row = buildMasterPipeline(s, { tab: "offers" }, now).rows[0];
  assert.equal(row.best?.answered, true);
  s.offerEvidence = [];
  assert.equal(
    buildMasterPipeline(s, { tab: "offers" }, now).rows[0].best?.answered,
    null,
  );
});
test("recorded legacy funding contributes its actual date once even during a renewal", () => {
  const s = fixture(),
    o = s.opportunities[0];
  o.funded_at = "2026-11-10T12:00:00Z";
  o.funded_amount = 45000;
  s.processes = [
    {
      id: "renewal",
      opportunity_id: o.id,
      sequence_number: 2,
      state: "submitted",
      classification: "active",
      is_unclassified_archive: false,
    },
  ];
  let b = buildMasterPipeline(s, { tab: "stats" }, now);
  assert.equal(b.events.filter((e) => e.kind === "disbursed").length, 1);
  assert.equal(b.events.find((e) => e.kind === "disbursed")?.at, o.funded_at);
  s.events = [
    {
      id: "funded-event",
      opportunity_id: o.id,
      process_id: null,
      submission_id: null,
      kind: "disbursed",
      area: "closer",
      evidence_type: "manual",
      occurred_at: o.funded_at,
    },
  ];
  b = buildMasterPipeline(s, { tab: "stats" }, now);
  assert.equal(b.events.filter((e) => e.kind === "disbursed").length, 1);
  assert.equal(
    b.events.find((e) => e.kind === "disbursed")?.id,
    "funded-event",
  );
});
test("expired offers remain dated activity without inflating active workload", () => {
  const s = fixture(),
    o = s.opportunities[0];
  s.submissions = [
    {
      ...pipelineModuleDemo().data.submissions[0],
      id: "history",
      opportunity_id: o.id,
      lender_id: "l",
    },
  ];
  const f = {
    ...pipelineModuleDemo().data.offers[0],
    id: "expired",
    opportunity_id: o.id,
    submission_id: "history",
    amount: 45000,
    status: "received",
    expires_at: "2026-11-14T12:00:00Z",
    created_at: "2026-11-13T12:00:00Z",
  };
  s.offers = [f, { ...f }, { ...f, id: "draft", status: "draft" }];
  const b = buildMasterPipeline(s, { tab: "stats" }, now);
  assert.equal(b.daily.find((d) => d.day === "2026-11-13")?.offers, 1);
  assert.equal(b.byRep.find((r) => r.id === s.profile.id)?.offerFiles, 1);
  assert.equal(b.byRep.find((r) => r.id === s.profile.id)?.offers, 0);
});
test("task excerpts point to the latest received message rather than an outbound response", () => {
  const s = fixture(),
    o = s.opportunities[0];
  s.tasks = [
    {
      id: "task",
      opportunity_id: o.id,
      owner_id: s.profile.id,
      title: "Review",
      due_at: "2026-11-14T12:00:00Z",
      status: "open",
      area: "seller",
    },
  ];
  s.conversations = [
    {
      id: "c",
      opportunity_id: o.id,
      submission_id: null,
      account_id: "a",
      subject: "Fixture",
      area: "seller",
      needs_attention: false,
      updated_at: null,
    },
  ];
  const m = {
    id: "in",
    conversation_id: "c",
    direction: "inbound" as const,
    sender: o.email,
    body: "Client words",
    sent_at: "2026-11-13T12:00:00Z",
    status: "received",
    area: "seller" as const,
  };
  s.messages = [
    m,
    {
      ...m,
      id: "out",
      direction: "outbound",
      status: "sent",
      sent_at: "2026-11-14T12:00:00Z",
    },
  ];
  assert.equal(
    buildMasterPipeline(s, { tab: "tasks" }, now).rows[0].messageId,
    "in",
  );
});
test("mail counts deduplicate the same physical archive message and exclude failed drafts", () => {
  const s = fixture(),
    o = s.opportunities[0];
  s.conversations = [
    {
      id: "c",
      opportunity_id: o.id,
      submission_id: null,
      account_id: "account",
      subject: "Fixture",
      area: "seller",
      needs_attention: false,
      updated_at: null,
    },
  ];
  const m = {
    id: "one",
    archive_message_id: "physical",
    conversation_id: "c",
    direction: "inbound" as const,
    sender: o.email,
    body: "Hello",
    sent_at: "2026-11-14T12:00:00Z",
    status: "received",
    area: "seller" as const,
  };
  s.messages = [
    m,
    { ...m, id: "copy" },
    {
      ...m,
      id: "failed",
      archive_message_id: "other",
      direction: "outbound",
      status: "failed",
    },
  ];
  assert.equal(
    buildMasterPipeline(s, { tab: "comms" }, now).byRep.find(
      (r) => r.id === s.profile.id,
    )?.emails,
    1,
  );
});
test("negative and automatic archived lead replies do not become open leads; later recorded reply closes the count", () => {
  const s = fixture(),
    o = s.opportunities[0];
  s.leads = [
    {
      id: "lead",
      contact_id: "contact",
      company: "Fixture Lead",
      contact: "Sample",
      email: "lead@fixture.example",
      phone: "",
      industry: "",
      product: "",
      amount: 0,
      seller_id: s.profile.id,
      next_action: "",
      next_action_at: null,
      verification: "valid",
      suppressed: false,
      opportunity_id: null,
      created_at: "2026-11-01T12:00:00Z",
    },
  ];
  const m = {
    id: "a",
    account_id: "account",
    gmail_thread_id: "thread",
    subject: "Fixture lead reply",
    sent_at: "2026-11-14T12:00:00Z",
    direction: "inbound",
    nature: "personal",
    reply_intent: "positive",
    participants: [{ email: "lead@fixture.example", role: "from" }],
  };
  s.archive = [m];
  let b = buildMasterPipeline(s, { tab: "leads" }, now);
  assert.equal(b.total, 1);
  assert.equal(b.byRep.find((r) => r.id === s.profile.id)?.leadsOpen, 1);
  s.archive.push({
    ...m,
    id: "negative",
    reply_intent: "negative",
    sent_at: "2026-11-15T12:00:00Z",
  });
  assert.equal(buildMasterPipeline(s, { tab: "leads" }, now).total, 0);
  s.archive = [
    m,
    { ...m, id: "out", direction: "outbound", sent_at: "2026-11-15T12:00:00Z" },
  ];
  b = buildMasterPipeline(s, { tab: "leads" }, now);
  assert.equal(b.rows[0].answered, true);
  assert.equal(b.byRep.find((r) => r.id === s.profile.id)?.leadsOpen, 0);
  s.archive = [{ ...m, nature: "automatic" }];
  assert.equal(buildMasterPipeline(s, { tab: "leads" }, now).total, 0);
});
test("UTC calendar keys normalize offsets independently of the server timezone", () => {
  const s = fixture(),
    o = s.opportunities[0];
  s.events = [
    {
      id: "offset",
      opportunity_id: o.id,
      process_id: null,
      submission_id: null,
      kind: "application_received",
      area: "seller",
      evidence_type: "manual",
      occurred_at: "2026-11-14T23:30:00-05:00",
    },
  ];
  const before = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Bogota", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      const b = buildMasterPipeline(s, { tab: "stats", days: 7 }, now);
      assert.equal(
        b.daily.find((d) => d.day === "2026-11-15")?.applications,
        1,
      );
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
test("seller archive metadata without visible case evidence stays out of the payload", () => {
  const s = fixture();
  s.profile = { ...s.profile, role: "seller" };
  s.archive = [
    {
      id: "unreadable",
      account_id: "other",
      gmail_thread_id: "foreign",
      subject: "Hidden fixture archive",
      sent_at: "2026-11-14T12:00:00Z",
      direction: "inbound",
      nature: "personal",
      participants: [],
    },
  ];
  s.leadCoverage = false;
  const b = buildMasterPipeline(s, { tab: "comms" }, now);
  assert(!JSON.stringify(b).includes("Hidden fixture archive"));
  assert.equal(b.byRep[0].leadsOpen, null);
});
