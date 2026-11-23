import test from "node:test";
import assert from "node:assert/strict";
import { readPipelineBoard } from "../src/lib/server/pipeline-os-module";
import { readMasterPipeline } from "../src/lib/server/pipeline-master";
import { parseMasterQuery } from "../src/lib/pipeline-os/master-pipeline";
import { pipelinePerformanceFixture } from "./fixtures/pipeline-performance";
import { createPipelineReadQueue } from "../src/lib/server/pipeline-read-queue";

for (const kind of ["board", "master"] as const) {
  test(`${kind} overlaps ID batches within one six-request budget and retains complete catalogs`, async () => {
    const f = pipelinePerformanceFixture({ cap: 17 });
    const result =
      kind === "board"
        ? await readPipelineBoard(f.client, f.profile, { group: "files" })
        : await readMasterPipeline(
            f.client,
            f.profile,
            parseMasterQuery(new URLSearchParams("tab=tasks")),
            Date.parse("2026-11-18T18:00:00Z"),
          );
    assert.equal(result.total, 351);
    assert.equal(result.rows.length, 50);
    const metrics = f.metrics();
    assert(metrics.peak <= 6, `global query peak ${metrics.peak} exceeds six`);
    assert(
      Object.values(metrics.byTable).every((peak) => peak <= 4),
      "each relation retains its four-batch cap",
    );
    assert(
      metrics.byTable.tasks > 1,
      "independent task ID batches should overlap",
    );
    assert.equal(metrics.active, 0);
    assert(f.calls.every((c) => !c.batch || c.batch.length <= 50));
    assert(
      f.calls.filter((c) => !c.table.startsWith("rpc:")).every((c) => c.exact),
    );
    assert(!f.calls.some((c) => c.columns.includes("encrypted_payload")));
  });
}

test("a failed catalog read propagates instead of returning partial successful totals", async () => {
  const f = pipelinePerformanceFixture({ count: 101, failTable: "documents" });
  await assert.rejects(
    readPipelineBoard(f.client, f.profile),
    /Fixture permission denied/,
  );
});

test("case-scoped mail batches exclude unrelated cases before message reads", async () => {
  const f = pipelinePerformanceFixture();
  f.tables.mail_conversations_visible.push({
    id: "archived-thread",
    opportunity_id: "excluded-case",
    area: "seller",
  });
  const board = await readPipelineBoard(f.client, f.profile);
  assert.equal(board.total, 351);
  const reads = f.calls.filter((c) => c.table === "mail_conversations_visible");
  assert.equal(reads.length, 8);
  assert(reads.every((c) => !!c.batch?.length && c.batch.length <= 50));
  assert(
    f.calls
      .filter((c) => c.table === "messages")
      .every((c) => !c.batch?.includes("archived-thread")),
  );
});

test("a large mailbox never adds an unbounded probe before scoped batches", async () => {
  const f = pipelinePerformanceFixture();
  f.tables.mail_conversations_visible.push(
    ...Array.from({ length: 1001 }, (_, i) => ({
      id: `extra-${i}`,
      opportunity_id: "excluded-case",
      area: "seller",
    })),
  );
  const board = await readPipelineBoard(f.client, f.profile);
  assert.equal(board.total, 351);
  const reads = f.calls.filter((c) => c.table === "mail_conversations_visible");
  assert.equal(reads.length, 8);
  assert.equal(reads.filter((c) => !c.batch).length, 0);
  assert(
    f.calls
      .filter((c) => c.table === "messages")
      .every((c) => !c.batch?.some((id) => String(id).startsWith("extra-"))),
  );
});

test("a missing count, duplicate identity or permission error in scoped pages fails closed", async () => {
  for (const kind of ["count", "duplicate", "permission"]) {
    const f = pipelinePerformanceFixture({
      missingCountTable:
        kind === "count" ? "mail_conversations_visible" : undefined,
      failTable:
        kind === "permission" ? "mail_conversations_visible" : undefined,
    });
    if (kind === "duplicate")
      f.tables.mail_conversations_visible.push({
        ...f.tables.mail_conversations_visible[0],
      });
    await assert.rejects(
      readPipelineBoard(f.client, f.profile),
      /count unavailable|Catalog changed|Fixture permission denied/,
    );
  }
});

test("a source failure stops queued reads without poisoning a later request", async () => {
  const run = createPipelineReadQueue();
  let started = 0;
  const reads = Array.from({ length: 12 }, (_, i) =>
    run(async () => {
      started++;
      if (i === 0) throw new Error("Fixture source unavailable");
      return i;
    }),
  );
  const results = await Promise.allSettled(reads);
  assert.equal(started, 6);
  assert.equal(results.filter((r) => r.status === "rejected").length, 7);
  assert.equal(
    await createPipelineReadQueue()(() => "new request"),
    "new request",
  );
});
