import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceReader } from "../src/lib/workspace-reader";

test("the default browser fetch keeps its global receiver", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(Response.json({ ok: true }));
    };
    const reader = new WorkspaceReader<{ ok: boolean }>();
    assert.deepEqual(await reader.read("/api/workspace"), { ok: true });
  } finally {
    globalThis.fetch = previous;
  }
});

function port() {
  const calls: {
    url: string;
    signal: AbortSignal;
    resolve: (r: Response) => void;
  }[] = [];
  const fetchImpl = ((input: string, init: RequestInit) =>
    new Promise<Response>((resolve) =>
      calls.push({ url: input, signal: init.signal!, resolve }),
    )) as typeof fetch;
  return { calls, fetchImpl };
}
test("workspace shares identical in-flight reads and discards superseded responses", async () => {
  const p = port(),
    reader = new WorkspaceReader<{ value: number }>(p.fetchImpl);
  const first = reader.read("/api/workspace?q=first");
  assert.equal(first, reader.read("/api/workspace?q=first"));
  assert.equal(p.calls.length, 1);
  const second = reader.read("/api/workspace?q=second");
  assert(p.calls[0].signal.aborted);
  p.calls[1].resolve(Response.json({ value: 2 }));
  assert.deepEqual(await second, { value: 2 });
  p.calls[0].resolve(Response.json({ value: 1 }));
  assert.equal(await first, undefined);
});
test("a refresh after a mutation replaces earlier reads even for the same URL", async () => {
  const p = port(),
    reader = new WorkspaceReader<{ value: number }>(p.fetchImpl);
  const old = reader.read("/api/workspace");
  const fresh = reader.read("/api/workspace", true);
  p.calls[1].resolve(Response.json({ value: 3 }));
  assert.deepEqual(await fresh, { value: 3 });
  assert.equal(await old, undefined);
  p.calls[0].resolve(Response.json({ value: 1 }));
});
test("timeouts settle even when the transport hangs and the next read can recover", async () => {
  const p = port(),
    reader = new WorkspaceReader<{ ok: boolean }>(p.fetchImpl, 5);
  await assert.rejects(
    reader.read("/api/workspace"),
    /La carga tardó demasiado/,
  );
  assert(p.calls[0].signal.aborted);
  const retry = reader.read("/api/workspace");
  p.calls[1].resolve(Response.json({ ok: true }));
  assert.deepEqual(await retry, { ok: true });
});
test("unmount cancellation settles without errors while current HTTP errors remain visible", async () => {
  const p = port(),
    reader = new WorkspaceReader(p.fetchImpl);
  const cancelled = reader.read("/api/workspace");
  reader.cancel();
  assert.equal(await cancelled, undefined);
  const denied = reader.read("/api/workspace");
  p.calls[1].resolve(Response.json({ error: "Sign in" }, { status: 401 }));
  await assert.rejects(denied, /Sign in/);
  assert.equal(p.calls.length, 2);
});
