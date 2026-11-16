import test from "node:test";
import assert from "node:assert/strict";
import { buildCaseProgress } from "../src/lib/pipeline-os/case-progress";
import {
  progressFixture,
  progressOffer,
  progressEvent,
  progressNow,
} from "./fixtures/case-progress";

const phase = (source: ReturnType<typeof progressFixture>, id: string) =>
  buildCaseProgress(source, progressNow).phases.find((p) => p.id === id)!;
const item = (source: ReturnType<typeof progressFixture>, id: string) =>
  buildCaseProgress(source, progressNow)
    .phases.flatMap((p) => p.items)
    .find((i) => i.id === id)!;

test("AC002/003: complete documentation, current human review and handoff verify the first two steps without mutating inputs", () => {
  const s = progressFixture(),
    before = JSON.stringify(s);
  const p = buildCaseProgress(s, progressNow);
  assert.deepEqual(
    p.phases.map((p) => p.id),
    ["documents", "risk", "lenders", "offers", "closing"],
  );
  assert.equal(phase(s, "documents").state, "complete");
  assert.equal(phase(s, "risk").state, "complete");
  assert.equal(phase(s, "lenders").state, "complete");
  assert.equal(phase(s, "offers").state, "pending");
  assert.equal(JSON.stringify(s), before);
});
test("AC002: duplicate, missing, unapproved sources and report files do not satisfy documentary evidence", () => {
  const s = progressFixture();
  s.documents[4].content_hash = s.documents[3].content_hash;
  assert.equal(item(s, "statements").state, "pending");
  s.documents[4].kind = "analysis_report";
  assert.equal(item(s, "statements").state, "pending");
  s.documents[0].storage_path = "";
  assert.equal(item(s, "application-file").state, "pending");
  assert.equal(item(s, "sources").state, "pending");
});
test("AC002: application flags, extra requirements and source hash/size limits remain independent", () => {
  const s = progressFixture();
  s.opportunity.application_signed = false;
  assert.equal(item(s, "application").state, "pending");
  s.documents.push({
    ...s.documents[0],
    id: "extra",
    kind: "ar_aging",
    status: "pending",
  });
  assert.equal(item(s, "additional-documents").state, "pending");
  s.documents.pop();
  s.documents[0].content_hash = "";
  assert.equal(item(s, "sources").state, "pending");
  s.documents[0].content_hash = "fixture-hash-0";
  for (let i = 0; i < 21; i++)
    s.documents.push({
      ...s.documents[0],
      id: `extra-${i}`,
      kind: "other",
      content_hash: `other-${i}`,
      required: false,
    });
  assert.equal(item(s, "sources").state, "pending");
});
test("AC003: stale, incomplete, unreviewed analyses and missing handoff never finish risk", () => {
  const s = progressFixture();
  for (const update of [
    { is_current: false },
    { reviewer_id: "" },
    { reviewed_at: "invalid" },
    { reviewed_at: "2027-01-01" },
    { recommendations: " " },
    { conclusion: "" },
  ]) {
    const next = structuredClone(s);
    Object.assign(next.analyses[0], update);
    assert.equal(item(next, "review").state, "pending");
    assert.equal(phase(next, "risk").state, "pending");
  }
  s.analyses = [];
  assert.equal(item(s, "review").state, "pending");
  s.opportunity.handed_off_at = null;
  assert.equal(item(s, "handoff").state, "pending");
});
test("AC004: no active process means unverified lender/offer/closing evidence rather than legacy completion", () => {
  const s = progressFixture();
  s.offers = [progressOffer(s, "accepted")];
  s.processes[0].classification = "inactive";
  const p = buildCaseProgress(s, progressNow);
  assert.equal(p.processNumber, null);
  assert.deepEqual(
    p.phases.slice(2).map((p) => p.state),
    ["unknown", "unknown", "unknown"],
  );
  assert.ok(
    p.phases
      .slice(2)
      .flatMap((p) => p.items)
      .every((i) => i.action === "mail_history"),
  );
});
test("AC004: renewal uses only latest active process, excluding archives, previous offers, events and global funding", () => {
  const s = progressFixture();
  s.processes[0].state = "disbursed";
  s.processes[0].actual_funded_amount = 50000;
  s.processes[0].funded_lender_id = "lender-fictional";
  s.events.push(progressEvent(s, "contract_signed"));
  s.offers.push(progressOffer(s, "selected"));
  s.opportunity.funded_amount = 50000;
  s.opportunity.funded_at = "2026-11-14T12:00:00Z";
  s.processes.push({
    ...s.processes[0],
    id: "process-2",
    sequence_number: 2,
    state: "new",
    actual_funded_amount: null,
    funded_lender_id: null,
  });
  s.processes.push({
    ...s.processes[0],
    id: "archive",
    sequence_number: 99,
    is_unclassified_archive: true,
  });
  const p = buildCaseProgress(s, progressNow);
  assert.equal(p.processNumber, 2);
  assert.equal(p.multipleActive, true);
  assert.equal(p.outcome, "open");
  for (const id of ["submissions", "offer", "contract-signed", "funding"])
    assert.equal(item(s, id).state, "pending");
});
test("AC005: draft/queued/uncertain/withdrawn, invalid dates and future submissions never count as sent", () => {
  const s = progressFixture();
  for (const status of ["draft", "queued", "uncertain", "withdrawn"]) {
    s.submissions[0].status = status;
    assert.equal(item(s, "submissions").state, "pending", status);
  }
  for (const status of [
    "submitted",
    "reviewing",
    "requirements",
    "offer",
    "rejected",
  ]) {
    s.submissions[0].status = status;
    assert.equal(item(s, "submissions").state, "complete", status);
  }
  for (const date of ["bad", "2027-01-01"]) {
    s.submissions[0].submitted_at = date;
    assert.equal(item(s, "submissions").state, "pending");
  }
});
test("AC006: only positive, current offers count; selected and accepted are explicit choices, never highest amount", () => {
  const s = progressFixture();
  s.offers = [progressOffer(s)];
  assert.equal(item(s, "offer").state, "complete");
  assert.equal(item(s, "selection").state, "pending");
  for (const status of ["selected", "accepted"]) {
    s.offers[0].status = status;
    assert.equal(item(s, "selection").state, "complete");
  }
  for (const update of [
    { expires_at: "2026-11-01" },
    { expires_at: "bad" },
    { status: "rejected" },
    { status: "discarded_other_offer" },
    { amount: 0 },
    { amount: NaN },
    { submission_id: "other-process" },
  ]) {
    const next = structuredClone(s);
    Object.assign(next.offers[0], update);
    assert.equal(item(next, "offer").state, "pending", JSON.stringify(update));
  }
});
test("AC006: conflicting selections and selected lender requirements remain visible; unselected alternatives do not block", () => {
  const s = progressFixture();
  s.offers = [progressOffer(s, "selected")];
  s.offers.push({ ...s.offers[0], id: "conflict" });
  assert.equal(item(s, "selection").state, "pending");
  s.offers.pop();
  s.submissions[0].status = "requirements";
  assert.equal(item(s, "requirements").state, "pending");
  s.submissions[0].status = "offer";
  s.submissions.push({
    ...s.submissions[0],
    id: "alternative",
    status: "requirements",
  });
  assert.equal(item(s, "requirements").state, "complete");
  s.processes[0].state = "requirements";
  assert.equal(item(s, "requirements").state, "pending");
});
test("AC007: application signatures and offers do not prove contracts; evidence must belong to current case/process", () => {
  const s = progressFixture();
  s.offers = [progressOffer(s, "approved")];
  assert.equal(item(s, "contract-signed").state, "pending");
  for (const update of [
    { opportunity_id: "other" },
    { process_id: "other" },
    { archive_message_id: null, document_id: null },
    { occurred_at: "bad" },
    { occurred_at: "2027-01-01" },
  ]) {
    s.events = [{ ...progressEvent(s, "contract_signed"), ...update }];
    assert.equal(item(s, "contract-signed").state, "pending");
  }
  s.events = [progressEvent(s, "contract_out")];
  assert.equal(item(s, "contract-sent").state, "complete");
  assert.equal(item(s, "contract-signed").state, "pending");
  s.events.push(progressEvent(s, "contract_signed"));
  assert.equal(item(s, "contract-signed").state, "complete");
  assert.equal(item(s, "final-approval").state, "pending");
});
test("AC007: contracted selected offers remain evidence after expiry; funding requires current state and process-specific amount/lender", () => {
  const s = progressFixture();
  s.offers = [progressOffer(s, "selected", "2026-11-01")];
  s.processes[0].state = "contract_signed";
  assert.equal(item(s, "offer").state, "complete");
  assert.equal(item(s, "contract-signed").state, "complete");
  assert.equal(item(s, "funding").state, "pending");
  s.processes[0].state = "disbursed";
  assert.equal(item(s, "funding").state, "pending");
  s.processes[0].actual_funded_amount = 0;
  s.processes[0].funded_lender_id = "lender-fictional";
  assert.equal(item(s, "funding").state, "pending");
  s.processes[0].actual_funded_amount = 50000;
  s.processes[0].funded_lender_id = null;
  assert.equal(item(s, "funding").state, "pending");
  s.processes[0].funded_lender_id = "lender-fictional";
  assert.equal(buildCaseProgress(s, progressNow).outcome, "funded");
  assert.equal(phase(s, "closing").state, "complete");
  s.processes[0].state = "requirements";
  s.events.push(progressEvent(s, "disbursed"));
  assert.equal(item(s, "funding").state, "pending");
});
test("AC008/009: terminal loss is not funding; sellers receive no private process facts, unauthorized users receive nothing", () => {
  const s = progressFixture();
  for (const state of ["client_withdrew", "funding_declined"]) {
    s.processes[0].state = state;
    assert.equal(buildCaseProgress(s, progressNow).outcome, "without_funding");
  }
  s.profile.role = "seller";
  s.opportunity.seller_id = s.profile.id;
  const p = buildCaseProgress(s, progressNow);
  assert.equal(p.processNumber, null);
  assert.equal(p.outcome, "open");
  assert.equal(p.closerVisible, false);
  assert.ok(
    p.phases
      .slice(2)
      .every(
        (p) =>
          p.state === "restricted" && p.items.every((i) => i.action === null),
      ),
  );
  s.opportunity.seller_id = "other";
  assert.throws(() => buildCaseProgress(s, progressNow), /access denied/);
});
