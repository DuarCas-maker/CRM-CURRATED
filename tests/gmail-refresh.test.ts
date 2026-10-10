import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import {
  HistoryRefreshError,
  historyRefreshMessage,
  initialHistoryRun,
  startHistoryPolling,
} from "../src/lib/gmail-history-refresh";

test("a failed status read retains data, retries only GET and clears the connection warning on recovery", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0,
    data = { scanned: 786 },
    error: unknown = null;
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      assert.equal(
        init.method || "GET",
        "GET",
        "Status retries cannot repeat mutations",
      );
      if (++requests === 1) throw new TypeError("Failed to fetch");
      return Response.json({ scanned: 789 });
    },
  );
  const poll = startHistoryPolling<{ scanned: number }>(
    "/api/gmail/history?run=fixture",
    {
      data: (next) => {
        data = next;
        error = null;
      },
      error: (next) => {
        error = next;
      },
    },
  );
  try {
    await setImmediate();
    assert.equal(data.scanned, 786);
    assert.match(
      historyRefreshMessage(error, "es"),
      /reintentaremos automáticamente/,
    );
    t.mock.timers.tick(10000);
    await setImmediate();
    assert.equal(data.scanned, 789);
    assert.equal(error, null);
    assert.equal(fetch.mock.callCount(), 2);
  } finally {
    poll.stop();
  }
});

test("manual refreshes coalesce during a slow request and never overlap status reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve!: (response: Response) => void;
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const data: unknown[] = [],
    errors: unknown[] = [];
  const poll = startHistoryPolling("/api/gmail/history", {
    data: (next) => data.push(next),
    error: (next) => errors.push(next),
  });
  try {
    poll.refresh();
    poll.refresh();
    t.mock.timers.tick(15000);
    assert.equal(fetch.mock.callCount(), 1);
    resolve(Response.json({ scanned: 3 }));
    await setImmediate();
    t.mock.timers.tick(0);
    assert.equal(fetch.mock.callCount(), 2);
    resolve(Response.json({ scanned: 6 }));
    await setImmediate();
    assert.deepEqual(data, [{ scanned: 3 }, { scanned: 6 }]);
    assert.equal(errors.length, 0);
  } finally {
    poll.stop();
  }
});

test("changing analysis cancels the old read and ignores even late uncancellable responses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve!: (response: Response) => void, signal: AbortSignal | undefined;
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    (_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Promise<Response>((done) => {
        resolve = done;
      });
    },
  );
  const data: unknown[] = [],
    errors: unknown[] = [];
  const poll = startHistoryPolling("/api/gmail/history?run=old", {
    data: (next) => data.push(next),
    error: (next) => errors.push(next),
  });
  poll.stop();
  assert.equal(signal?.aborted, true);
  resolve(Response.json({ scanned: 1 }));
  await setImmediate();
  t.mock.timers.tick(60000);
  assert.deepEqual(data, []);
  assert.deepEqual(errors, []);
  assert.equal(fetch.mock.callCount(), 1);
});

test("a hung status read times out and the next read can recover", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0,
    error: unknown = null,
    scanned = 0;
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    (_url: string, init: RequestInit) => {
      if (++requests > 1)
        return Promise.resolve(Response.json({ scanned: 800 }));
      return new Promise<Response>((_resolve, reject) =>
        init.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        ),
      );
    },
  );
  const poll = startHistoryPolling<{ scanned: number }>("/api/gmail/history", {
    data: (next) => {
      scanned = next.scanned;
      error = null;
    },
    error: (next) => {
      error = next;
    },
  });
  try {
    t.mock.timers.tick(20000);
    await setImmediate();
    assert.ok(error instanceof DOMException);
    t.mock.timers.tick(10000);
    await setImmediate();
    assert.equal(scanned, 800);
    assert.equal(error, null);
    assert.equal(fetch.mock.callCount(), 2);
  } finally {
    poll.stop();
  }
});

test("proxy failures and expired CRM sessions are distinct from Gmail authorization or a stopped analysis", async (t) => {
  const received: unknown[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>Bad gateway</html>", { status: 502 }),
  );
  const poll = startHistoryPolling("/api/gmail/history", {
    data: () => assert.fail("HTML cannot become analysis data"),
    error: (next) => received.push(next),
  });
  try {
    await setImmediate();
    assert.ok(received[0] instanceof HistoryRefreshError);
    assert.equal((received[0] as HistoryRefreshError).status, 502);
    assert.match(
      historyRefreshMessage(received[0], "es"),
      /última información/,
    );
    assert.ok(!historyRefreshMessage(received[0], "es").includes("<html>"));
    assert.match(
      historyRefreshMessage(new HistoryRefreshError(401), "es"),
      /sesión del CRM/,
    );
    assert.match(
      historyRefreshMessage(new HistoryRefreshError(401), "en"),
      /Gmail remains connected/,
    );
    assert.match(
      historyRefreshMessage(
        new HistoryRefreshError(403, "Complete two-factor authentication"),
        "en",
      ),
      /two-factor/,
    );
  } finally {
    poll.stop();
  }
});

test("reloading restores a valid saved analysis; absent or invalid choices prefer an active historical run", () => {
  const runs = [
    { id: "live-completed", purpose: "continuous", status: "completed" },
    { id: "historical-completed", purpose: "historical", status: "completed" },
    { id: "historical-active", purpose: "historical", status: "analyzing" },
    { id: "live-review", purpose: "continuous", status: "review" },
  ];
  assert.equal(
    initialHistoryRun(runs, "historical-completed"),
    "historical-completed",
  );
  assert.equal(initialHistoryRun(runs, "live-review"), "live-review");
  assert.equal(initialHistoryRun(runs, null), "historical-active");
  assert.equal(initialHistoryRun(runs, "removed"), "historical-active");
  assert.equal(initialHistoryRun(runs, "live-completed"), "historical-active");
  assert.equal(
    initialHistoryRun(runs, ""),
    "",
    "Respect a deliberately cleared selection",
  );
  assert.equal(initialHistoryRun([], null), "");
});
