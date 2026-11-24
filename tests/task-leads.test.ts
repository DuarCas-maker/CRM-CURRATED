import test from "node:test";
import assert from "node:assert/strict";
import { readTaskLeadPages } from "../src/lib/server/task-leads";

for (const cap of [1, 17, 500, 1000]) {
  test(`lead cursor cap ${cap} loads every row through an empty page`, async () => {
    const source = Array.from({ length: 1041 }, (_, i) => ({
      id: String(i).padStart(5, "0"),
    }));
    const cursors: (string | undefined)[] = [];
    const result = await readTaskLeadPages(async (after) => {
      cursors.push(after);
      return source
        .filter((r) => after === undefined || r.id > after)
        .slice(0, cap);
    });
    assert.deepEqual(result, source);
    assert.equal(cursors.length, Math.ceil(source.length / cap) + 1);
    assert.equal(cursors.at(-1), source.at(-1)!.id);
  });
}

test("lead page errors and invalid progress never return a partial successful catalog", async () => {
  const failure = Error("second page failed");
  await assert.rejects(
    readTaskLeadPages(async (after) => {
      if (after) throw failure;
      return [{ id: "a" }];
    }),
    (error) => error === failure,
  );
  for (const page of [
    [{ id: "a" }, { id: "a" }],
    [{ id: "b" }, { id: "a" }],
    [{ id: "" }],
    [{ id: null }],
  ]) {
    await assert.rejects(
      readTaskLeadPages(async () => page as { id: string }[]),
      /Catalog changed/,
    );
  }
  await assert.rejects(
    readTaskLeadPages(async () => [{ id: "a" }, { id: "b" }], 1),
    /exceeds/,
  );
  await assert.rejects(
    readTaskLeadPages(async () =>
      Array.from({ length: 1001 }, (_, i) => ({ id: String(i) })),
    ),
    /exceeds/,
  );
});
