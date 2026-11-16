import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  caseFlowCommandSchema,
  confirmedLenderSends,
  latestConfirmation,
} from "../src/lib/pipeline-os/case-flow";
import { buildCaseProgress } from "../src/lib/pipeline-os/case-progress";
import { buildPipelineBoard } from "../src/lib/pipeline-os/module";
import { progressFixture, progressNow } from "./fixtures/case-progress";
import { demoWorkspace } from "../src/lib/demo";

test("FR03: only real sent email to an exact lender starts negotiation; no draft or request metadata substitutes", () => {
  const s = progressFixture();
  const send = () =>
    confirmedLenderSends(
      {
        ...s,
        reports: s.reports!,
        conversations: s.conversations!,
        messages: s.messages!,
        lenders: s.lenders!,
        process: s.processes[0],
      },
      progressNow,
    );
  assert.equal(send().length, 1);
  s.messages![0].status = "queued";
  assert.equal(send().length, 0);
  s.messages![0].status = "uncertain";
  assert.equal(send().length, 0);
  s.messages![0].status = "sent";
  s.messages![0].direction = "inbound";
  assert.equal(send().length, 0);
  s.messages![0].direction = "outbound";
  s.lenders!.push({ id: "ambiguous", email: s.lenders![0].email });
  assert.equal(send().length, 0);
  s.lenders!.pop();
  s.conversations![0].process_id = "previous-process";
  assert.equal(send().length, 0);
  s.conversations![0].process_id = null;
  s.conversations![0].submission_id = null;
  s.processes[0].started_at = "2026-11-14T12:00:00Z";
  assert.equal(send().length, 1);
  s.messages![0].sent_at = "2026-11-13T12:00:00Z";
  assert.equal(send().length, 0);
});

test("FR02/03: one approved current AI report is enough; no process is needed to observe a new lender send", () => {
  const s = progressFixture();
  s.opportunity.handed_off_at = null;
  s.processes = [];
  s.conversations![0].process_id = null;
  s.conversations![0].submission_id = null;
  const p = buildCaseProgress(s, progressNow);
  assert.equal(p.phases[1].state, "complete");
  assert.equal(p.phases[1].items.length, 2);
  assert.equal(p.phases[2].state, "complete");
  s.reports!.push({ ...s.reports![0], id: "other-report", status: "draft" });
  assert.equal(buildCaseProgress(s, progressNow).phases[1].state, "complete");
  s.analyses[0].is_current = false;
  assert.equal(buildCaseProgress(s, progressNow).phases[1].state, "pending");
  s.reports![0].status = "rejected";
  const review = buildCaseProgress(s, progressNow).phases[1].items.find(
    (i) => i.id === "review",
  )!;
  assert.equal(review.state, "pending");
  assert.ok(!review.detail[0].includes("desactualizado"));
});

test("FR05: manual corrections are scoped, reversible and cannot manufacture report approval or funding", () => {
  const s = progressFixture();
  const caseId = s.opportunity.id;
  const event = {
    id: randomUUID(),
    opportunity_id: caseId,
    process_id: "process-1",
    kind: "workflow_confirmation",
    occurred_at: "2026-11-15T10:00:00Z",
    archive_message_id: "message-1",
    document_id: null,
    workflow_value: { milestone: "submissions", decision: "pending" as const },
  };
  s.events = [event];
  assert.equal(buildCaseProgress(s, progressNow).phases[2].state, "pending");
  assert.equal(
    latestConfirmation(s.events, caseId, "submissions", "renewal"),
    undefined,
  );
  s.events.push({
    ...event,
    id: randomUUID(),
    occurred_at: "2026-11-15T11:00:00Z",
    workflow_value: { milestone: "submissions", decision: "automatic" },
  });
  assert.equal(buildCaseProgress(s, progressNow).phases[2].state, "complete");
  const base = {
    operation: "confirmation",
    request_key: randomUUID(),
    process_id: null,
    expected_event_id: null,
    decision: "confirmed",
    reason: "Prueba con evidencia",
    archive_message_id: null,
    document_id: randomUUID(),
  };
  for (const milestone of ["review", "selection", "funding", "agreed-amount"])
    assert.equal(
      caseFlowCommandSchema.safeParse({ ...base, milestone }).success,
      false,
    );
});

test("FR04/06: credit amounts require positive cents and real funding also requires a lender", () => {
  const base = {
    operation: "lender",
    request_key: randomUUID(),
    process_id: null,
    expected_event_id: null,
    conversation_id: null,
    lender_id: randomUUID(),
    state: "offer",
    offered_amount: 10.01,
    agreed_amount: null,
    reason: "Prueba ficticia",
    archive_message_id: null,
    document_id: randomUUID(),
  };
  assert.equal(caseFlowCommandSchema.safeParse(base).success, true);
  for (const offered_amount of [null, 0, -1, 10.001, Infinity, NaN])
    assert.equal(
      caseFlowCommandSchema.safeParse({ ...base, offered_amount }).success,
      false,
    );
  assert.equal(
    caseFlowCommandSchema.safeParse({
      operation: "closing",
      request_key: randomUUID(),
      process_id: null,
      state: "disbursed",
      funded_amount: 50000,
      lender_id: null,
      reason: "Prueba",
      archive_message_id: null,
      document_id: randomUUID(),
    }).success,
    false,
  );
});

test("FR03: pending lenders requires approved risk; first sent email moves the board before any offer", () => {
  const s = progressFixture(),
    d = demoWorkspace(),
    o = s.opportunity;
  const base = {
    ...d,
    opportunities: [o],
    documents: s.documents,
    offers: [],
    submissions: s.submissions,
    tasks: [],
    flow_signals: {
      [o.id]: {
        approved: true,
        ready: true,
        sent: 0,
        manualSent: null as boolean | null,
      },
    },
  };
  assert.equal(
    buildPipelineBoard(base, s.processes, {}, progressNow).counts.need,
    1,
  );
  base.flow_signals[o.id].approved = false;
  assert.equal(
    buildPipelineBoard(base, s.processes, {}, progressNow).counts.need,
    0,
  );
  base.flow_signals[o.id].sent = 1;
  const board = buildPipelineBoard(base, s.processes, {}, progressNow);
  assert.equal(board.counts.offers, 1);
  assert.equal(board.rows[0].offers?.length, 0);
  base.flow_signals[o.id].manualSent = false;
  assert.equal(
    buildPipelineBoard(base, s.processes, {}, progressNow).counts.offers,
    0,
  );
});
