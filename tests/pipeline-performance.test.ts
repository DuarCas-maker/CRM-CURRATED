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
    assert(Object.values(metrics.byTable).every(peak => peak <= 4), "each relation retains its four-batch cap");
    assert(
      metrics.byTable.mail_conversations_visible > 1,
      "separate conversation ID batches should overlap",
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
