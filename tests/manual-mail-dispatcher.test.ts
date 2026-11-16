import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ManualSendDispatcher,
  startManualSender,
  manualFastSendEnabled,
} from "../worker/manual-sender";
import {
  mailStatusPollDelay,
  shouldPollMailStatus,
} from "../src/lib/mail-status-poll";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("a slow mailbox cannot block another; repeated polls never duplicate a mailbox", async () => {
  const a = randomUUID(),
    b = randomUUID(),
    c = randomUUID(),
    blocked = deferred(),
    calls: string[] = [];
  let ready = [a, b];
  const dispatcher = new ManualSendDispatcher(
    {
      readyAccounts: async () => ready,
      send: async (id) => {
        calls.push(id);
        if (id === a) await blocked.promise;
      },
      onError: () => assert.fail("unexpected failure"),
    },
    2,
  );
  await dispatcher.poll();
  await flush();
  assert.deepEqual(calls, [a, b]);
  ready = [a, c];
  await dispatcher.poll();
  await flush();
  assert.deepEqual(
    calls,
    [a, b, c],
    "new mailboxes progress while A is still blocked",
  );
  await dispatcher.poll();
  await flush();
  assert.equal(calls.filter((x) => x === a).length, 1);
  blocked.resolve();
  await dispatcher.stop();
});

test("bounded concurrency, stop drains in-flight sends and admits no new requests", async () => {
  const gates = Array.from({ length: 5 }, () => deferred()),
    ids: string[] = gates.map(() => randomUUID()),
    calls: string[] = [];
  const dispatcher = new ManualSendDispatcher(
    {
      readyAccounts: async () => ids,
      send: async (id) => {
        calls.push(id);
        await gates[ids.indexOf(id)].promise;
      },
      onError: () => assert.fail(),
    },
    4,
  );
  await dispatcher.poll();
  await flush();
  assert.equal(calls.length, 4);
  let stopped = false;
  const done = dispatcher.stop().then(() => {
    stopped = true;
  });
  await flush();
  assert.equal(stopped, false);
  await dispatcher.poll();
  assert.equal(calls.length, 4);
  gates.forEach((g) => g.resolve());
  await done;
  assert.equal(stopped, true);
});

test("a mailbox with a permanent backlog cannot starve later mailboxes", async () => {
  const ids = Array.from({ length: 5 }, () => randomUUID()),
    calls: string[] = [];
  const d = new ManualSendDispatcher(
    {
      readyAccounts: async () => ids,
      send: async (id) => {
        calls.push(id);
      },
      onError: () => assert.fail(),
    },
    2,
  );
  await d.poll();
  await flush();
  await d.poll();
  await flush();
  await d.poll();
  await flush();
  assert.deepEqual(calls.slice(0, 5), ids);
  await d.stop();
});

test("stop during discovery and invalid account DTO cannot start wire calls", async () => {
  const discovery = deferred();
  let calls = 0,
    errors = 0;
  const d = new ManualSendDispatcher({
    readyAccounts: async () => {
      await discovery.promise;
      return [randomUUID()];
    },
    send: async () => {
      calls++;
    },
    onError: () => {
      errors++;
    },
  });
  const poll = d.poll();
  await d.stop();
  discovery.resolve();
  await poll;
  assert.equal(calls, 0);
  const invalid = new ManualSendDispatcher({
    readyAccounts: async () => [randomUUID(), "bad"],
    send: async () => {
      calls++;
    },
    onError: () => {
      errors++;
    },
  });
  assert.equal(await invalid.poll(), false);
  await flush();
  assert.equal(calls, 0);
  assert.equal(errors, 1);
  await invalid.stop();
});

test("runtime polls independently of unrelated work and shuts down a pending timer", async () => {
  const gate = deferred();
  let sends = 0;
  const runtime = startManualSender(
    {
      readyAccounts: async () => [randomUUID()],
      send: async () => {
        sends++;
      },
      onError: () => assert.fail(),
    },
    100,
  );
  await flush();
  assert.equal(sends, 1);
  const unrelated = gate.promise;
  await runtime.stop();
  gate.resolve();
  await unrelated;
  assert.equal(sends, 1);
});

test("flags fail closed; UI uses quick initial observation and backs off long waits", () => {
  assert.equal(manualFastSendEnabled(undefined), false);
  assert.equal(manualFastSendEnabled("false"), false);
  assert.equal(manualFastSendEnabled("true"), true);
  for (const value of ["", "TRUE", "0"])
    assert.throws(() => manualFastSendEnabled(value));
  for (const elapsed of [0, 14999])
    assert.equal(mailStatusPollDelay(elapsed), 1000);
  for (const elapsed of [15000, 59999])
    assert.equal(mailStatusPollDelay(elapsed), 2000);
  for (const elapsed of [60000, 3600000])
    assert.equal(mailStatusPollDelay(elapsed), 5000);
  assert.equal(shouldPollMailStatus(false, false), true);
  assert.equal(shouldPollMailStatus(true, false), false);
  assert.equal(shouldPollMailStatus(false, true), false);
});

test("only normal starts the dispatcher before the blocking job loop; UI cleans up and skips hidden tabs", async () => {
  const source = await readFile("worker/index.ts", "utf8");
  const start = source.indexOf("manualSender = startManualSender");
  assert(
    start > source.indexOf('executionMode === "normal" && fastManualEnabled'),
  );
  assert(start < source.indexOf("while (!stopping)"));
  assert(source.includes("await manualSender?.stop()"));
  const ui = await readFile(
    "src/components/conversations-workspace.tsx",
    "utf8",
  );
  assert(ui.includes("if (!document.hidden) bump()"));
  assert(ui.includes("clearTimeout(timer)"));
});
