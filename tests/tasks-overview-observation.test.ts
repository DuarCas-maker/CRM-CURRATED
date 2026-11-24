import test from "node:test";
import assert from "node:assert/strict";
import { observeTasksRead } from "../src/lib/server/pipeline-tasks-observation";

test("task observations preserve results and never retain request identities or bodies", async () => {
  const logs: string[] = [];
  const result = await observeTasksRead(
    async (send) => {
      await send(
        "https://fixture.test/rest/v1/messages?email=private@example.test",
        {
          headers: { Authorization: "private-token" },
          body: "private body",
          method: "POST",
        },
      );
      return 42;
    },
    async function (this: unknown) {
      assert.equal(this, globalThis);
      return new Response("{}");
    },
    (event, data) => logs.push(event + " " + data),
  );
  assert.equal(result, 42);
  assert.match(logs[0], /pipeline_tasks_read/);
  assert.match(logs[0], /"messages":\{"calls":1/);
  assert.doesNotMatch(logs[0], /private|fixture|Authorization|https/);
});

test("task observations rethrow original failures with only safe operation and code", async () => {
  const failure = new Error("private details", {
    cause: { operation: "pipeline_tasks.campaign_facts", code: "57014" },
  });
  const logs: string[] = [];
  await assert.rejects(
    observeTasksRead(
      async () => {
        throw failure;
      },
      fetch,
      (_, data) => logs.push(data),
    ),
    (error) => error === failure,
  );
  assert.match(logs[0], /57014/);
  assert.doesNotMatch(logs[0], /private details/);
});
