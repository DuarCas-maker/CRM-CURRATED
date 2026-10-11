import test from "node:test";
import assert from "node:assert/strict";
import { gmailAnalysisProgress } from "../src/lib/gmail-analysis-progress";

const active = {
  status: "analyzing",
  scanned: 2803,
  skipped: 7,
  estimated_messages: 10000,
};

test("analysis progress includes skipped reads and distinguishes Gmail's estimate from saved messages", () => {
  const result = gmailAnalysisProgress(active);
  assert.equal(result.saved, 2803);
  assert.equal(result.processed, 2810);
  assert.equal(result.remaining, 7190);
  assert.equal(result.percent, 28.1);
  assert.equal(result.complete, false);
  assert.equal(
    gmailAnalysisProgress({
      ...active,
      status: "paused",
      resume_status: "analyzing",
    }).complete,
    false,
  );
});

test("missing, reached or exceeded estimates never falsely report completion or zero remaining", () => {
  for (const estimate of [0, 101, 2810, NaN]) {
    const result = gmailAnalysisProgress({
      ...active,
      estimated_messages: estimate,
    });
    assert.equal(result.complete, false);
    assert.equal(result.percent, null);
    assert.equal(result.remaining, null);
  }
  const almost = gmailAnalysisProgress({
    ...active,
    scanned: 9999,
    skipped: 0,
  });
  assert.ok(almost.percent! < 100);
});

test("completed scanning reports the final saved count while commercial import can still await approval", () => {
  for (const state of [
    { status: "review" },
    { status: "importing" },
    { status: "completed" },
    { status: "undone" },
    { status: "paused", resume_status: "importing" },
    { status: "failed", resume_status: "importing" },
  ]) {
    const result = gmailAnalysisProgress({ ...active, ...state });
    assert.equal(result.complete, true);
    assert.equal(result.saved, 2803);
    assert.equal(result.percent, 100);
    assert.equal(result.remaining, 0);
  }
});
