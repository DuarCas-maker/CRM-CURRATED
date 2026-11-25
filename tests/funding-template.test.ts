import test from "node:test";
import { flowOwnerFixture } from "./fixtures/campaign-flow-owner";
import { exerciseFunding } from "./fixtures/funding-template";
test("funding SQL: recovery, permissions, compatible launch and frozen inputs", async () => {
  const f = await flowOwnerFixture();
  try {
    await exerciseFunding(f);
  } finally {
    await f.db.close();
  }
});
