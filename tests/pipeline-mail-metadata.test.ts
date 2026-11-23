import test from "node:test";
import assert from "node:assert/strict";
import { readMailMetadataPages } from "../src/lib/server/pipeline-mail-metadata";

for (const cap of [1, 17, 1000]) {
  test(`mail keyset cap ${cap} follows all rows without a remote count`, async () => {
    const source = Array.from({ length: 73 }, (_, i) => ({
      id: String(i).padStart(4, "0"),
      opportunity_id: i % 2 ? "case" : "excluded",
    }));
    const cursors: (string | undefined)[] = [];
    const rows = await readMailMetadataPages(
      async (after) => {
        cursors.push(after);
        return source
          .filter((r) => after === undefined || r.id > after)
          .slice(0, cap);
      },
      ["case"],
    );
    assert.deepEqual(
      rows,
      source.filter((r) => r.opportunity_id === "case"),
    );
    assert.equal(cursors.length, Math.ceil(73 / cap) + 1);
    assert.equal(cursors.at(-1), "0072");
  });
}
test("mail metadata errors, duplicate/decreasing IDs and row limit never return partial success", async () => {
  const row = { id: "a", opportunity_id: "case" };
  await assert.rejects(
    readMailMetadataPages(
      async (after) => {
        if (after) throw Error("second page failed");
        return [row];
      },
      ["case"],
    ),
    /second page failed/,
  );
  await assert.rejects(
    readMailMetadataPages(async () => [row, row], ["case"]),
    /Catalog changed/,
  );
  await assert.rejects(
    readMailMetadataPages(async () => [{ ...row, id: "b" }, row], ["case"]),
    /Catalog changed/,
  );
  await assert.rejects(
    readMailMetadataPages(async () => [row, { ...row, id: "b" }], ["case"], 1),
    /exceeds the limit/,
  );
  let reads = 0;
  assert.deepEqual(
    await readMailMetadataPages(async () => {
      reads++;
      return [row];
    }, []),
    [],
  );
  assert.equal(reads, 0);
});
