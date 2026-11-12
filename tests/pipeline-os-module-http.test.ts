import test from "node:test";
import assert from "node:assert/strict";
import { pipelineBoardResponse } from "../src/lib/server/pipeline-os-http";
import { HttpError } from "../src/lib/server/supabase";
import { demoWorkspace } from "../src/lib/demo";
import { buildPipelineBoard } from "../src/lib/pipeline-os/module";

test("GET validates before loading, preserves authentication/MFA errors and does not cache financial data", async () => {
  let called = false;
  const bad = await pipelineBoardResponse(
    new Request("https://example.test/api/pipeline-os?page=-1"),
    async () => {
      called = true;
      return buildPipelineBoard(demoWorkspace());
    },
  );
  assert.equal(bad.status, 400);
  assert.equal(called, false);
  for (const status of [401, 403, 503]) {
    const denied = await pipelineBoardResponse(
      new Request("https://example.test/api/pipeline-os"),
      async () => {
        throw new HttpError(status, "Access unavailable");
      },
    );
    assert.equal(denied.status, status);
    assert.deepEqual(await denied.json(), { error: "Access unavailable" });
  }
  const ok = await pipelineBoardResponse(
    new Request("https://example.test/api/pipeline-os?group=app"),
    async (q) => buildPipelineBoard(demoWorkspace(), [], q),
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  const failed = await pipelineBoardResponse(
    new Request("https://example.test/api/pipeline-os"),
    async () => {
      throw new Error("sensitive provider body");
    },
  );
  assert.equal(failed.status, 500);
  assert(!(await failed.text()).includes("sensitive"));
});
