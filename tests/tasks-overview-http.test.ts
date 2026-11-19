import test from "node:test";
import assert from "node:assert/strict";
import { tasksOverviewResponse } from "../src/lib/server/pipeline-tasks-http";
import { buildTasksOverview } from "../src/lib/pipeline-os/tasks-overview";
import { HttpError } from "../src/lib/server/supabase";
import { tasksOverviewFixture } from "./fixtures/tasks-overview";

test("task overview HTTP validates filters before reading and preserves session/MFA/catalog errors", async () => {
  let calls = 0;
  const bad = await tasksOverviewResponse(
    new Request("https://example.test/api/pipeline-os/tasks?status=unknown"),
    async () => {
      calls++;
      return buildTasksOverview(tasksOverviewFixture());
    },
  );
  assert.equal(bad.status, 400);
  assert.equal(calls, 0);
  for (const status of [401, 403, 503]) {
    const r = await tasksOverviewResponse(
      new Request("https://example.test/api/pipeline-os/tasks"),
      async () => {
        throw new HttpError(status, "Unavailable");
      },
    );
    assert.equal(r.status, status);
  }
  const ok = await tasksOverviewResponse(
    new Request("https://example.test/api/pipeline-os/tasks?owner=santino"),
    async (q) => buildTasksOverview(tasksOverviewFixture(), q),
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert(
    (await ok.json()).rows.every(
      (r: { ownerId: string }) => r.ownerId === "santino",
    ),
  );
  const failed = await tasksOverviewResponse(
    new Request("https://example.test/api/pipeline-os/tasks"),
    async () => {
      throw new Error("private upstream body");
    },
  );
  assert.equal(failed.status, 500);
  assert(!(await failed.text()).includes("private upstream"));
});
