import test from "node:test";
import assert from "node:assert/strict";
import { readPipelineBoard } from "../src/lib/server/pipeline-os-module";
import { readMasterPipeline } from "../src/lib/server/pipeline-master";
import { parseMasterQuery } from "../src/lib/pipeline-os/master-pipeline";
import { pipelinePerformanceFixture } from "./fixtures/pipeline-performance";
import { readTasksOverview } from "../src/lib/server/pipeline-tasks";
import { parseTaskOverviewQuery } from "../src/lib/pipeline-os/tasks-overview";

for (const kind of ["board", "master"] as const) {
  test(`${kind} loads the complete catalog without the failing global mail probe`, async () => {
    const f = pipelinePerformanceFixture({ rejectUnscopedMail: true });
    const result =
      kind === "board"
        ? await readPipelineBoard(f.client, f.profile)
        : await readMasterPipeline(
            f.client,
            f.profile,
            parseMasterQuery(new URLSearchParams("tab=tasks")),
          );
    assert.equal(result.total, 351);
    assert.equal(result.rows.length, 50);
    const mail = f.calls.filter(
      (c) => c.table === "mail_conversations_visible",
    );
    assert.equal(mail.length, 8);
    assert(mail.every((c) => !!c.batch?.length && c.batch.length <= 50));
    assert(f.metrics().peak <= 6);
  });
}

test("tasks reuse bounded case mail when a global mailbox projection would time out", async () => {
  const f = pipelinePerformanceFixture({ rejectUnscopedMail: true });
  const result = await readTasksOverview(
    f.client,
    f.profile,
    parseTaskOverviewQuery(new URLSearchParams()),
  );
  assert.equal(result.totals.leads, 351);
  const mail = f.calls.filter((c) => c.table === "mail_conversations_visible");
  assert.equal(mail.length, 8);
  assert(mail.every((c) => !!c.batch?.length && c.batch.length <= 50));
});
