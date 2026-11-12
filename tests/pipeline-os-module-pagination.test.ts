import test from "node:test";
import assert from "node:assert/strict";
import { readPipelinePages } from "../src/lib/server/pipeline-os-module";

test("catalog follows the server's actual page cap without dropping rows", async () => {
  const all = Array.from({ length: 1234 }, (_, id) => ({ id }));
  const offsets: number[] = [];
  const rows = await readPipelinePages(async (offset) => {
    offsets.push(offset);
    return { rows: all.slice(offset, offset + 127), total: all.length };
  });
  assert.deepEqual(rows, all);
  assert.deepEqual(offsets.slice(0, 3), [0, 127, 254]);
});
test("a partial page, missing count or source failure cannot produce a plausible complete dashboard", async () => {
  await assert.rejects(
    () => readPipelinePages(async () => ({ rows: [], total: 2 })),
    /Incomplete/,
  );
  await assert.rejects(
    () => readPipelinePages(async () => ({ rows: [], total: null })),
    /unavailable/,
  );
  await assert.rejects(
    () =>
      readPipelinePages(async () => {
        throw new Error("source unavailable");
      }),
    /source unavailable/,
  );
  assert.deepEqual(
    await readPipelinePages(async () => ({ rows: [], total: 0 })),
    [],
  );
});

test("concurrent count changes or repeated records fail closed instead of duplicating totals", async () => {
  await assert.rejects(
    () =>
      readPipelinePages(async (offset) => ({
        rows: [{ id: offset }],
        total: offset ? 3 : 2,
      })),
    /Catalog changed/,
  );
  await assert.rejects(
    () => readPipelinePages(async () => ({ rows: [{ id: "same" }], total: 2 })),
    /Catalog changed/,
  );
});
