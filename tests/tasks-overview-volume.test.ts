import test from "node:test";
import assert from "node:assert/strict";
import { readTasksOverview } from "../src/lib/server/pipeline-tasks";
import { parseTaskOverviewQuery } from "../src/lib/pipeline-os/tasks-overview";
import { pipelinePerformanceFixture } from "./fixtures/pipeline-performance";

test("tasks load the complete lead catalog without the repeated remote count that times out", async () => {
  const f = pipelinePerformanceFixture({
    count: 4040,
    rejectCountedLeads: true,
  });
  const result = await readTasksOverview(
    f.client,
    f.profile,
    parseTaskOverviewQuery(new URLSearchParams()),
  );
  assert.equal(result.totals.leads, 4040);
  assert.equal(result.totals.stages.app, 4040);
  assert(
    f.calls.filter((c) => c.table === "lead_workspace").every((c) => !c.exact),
  );
});
