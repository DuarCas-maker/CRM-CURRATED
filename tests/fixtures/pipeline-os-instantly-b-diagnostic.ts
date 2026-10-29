import {
  runInstantlyB,
  assertBTransition,
  validateBState,
  type BState,
} from "../../scripts/pipeline-os/s00-instantly-b";
import type { InstantlyRecovery } from "../../scripts/pipeline-os/s00-instantly-recovery";
import {
  bSourceFixture,
  bEnv,
  bJson,
  BClock,
  BProvider,
} from "./pipeline-os-instantly-b";

// Synthetic B18 through the real runner. The chosen missing field is NOT remote evidence.
export async function bdSourceFixture() {
  const base = await bSourceFixture(),
    provider = new BProvider();
  let value: InstantlyRecovery | BState = base.prior;
  await runInstantlyB(
    bEnv,
    {
      load: async () => structuredClone(value),
      save: async (s) => {
        assertBTransition(value, s);
        value = structuredClone(s);
      },
    },
    base,
    {
      execute: true,
      authorizedNew: 25,
      authorizedTotal: 36,
      includedCallsConfirmed: true,
      manifestReviewed: true,
      clock: new BClock(),
      fetchImpl: async (raw, init) => {
        const result = provider.handle(String(raw), init!);
        const current = validateBState(value);
        if (current.requests.at(-1)?.step === "initial") delete result.cc_list;
        return bJson(result);
      },
    },
  );
  return {
    inputs: {
      source: validateBState(value),
      scope: base.scope,
      manifest: base.manifest,
    },
    body: structuredClone(provider.campaign!),
  };
}
