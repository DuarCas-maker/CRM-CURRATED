import test from "node:test";
import { flowOwnerFixture } from "./fixtures/campaign-flow-owner";
import { exerciseLegacyWorkerContext } from "./fixtures/legacy-worker-mail";
test("legacy worker SQL: exact account/lease/claim, route exclusions, ACL and reversal", async () => {
  const f = await flowOwnerFixture();
  try { await exerciseLegacyWorkerContext(f); } finally { await f.db.close(); }
});
