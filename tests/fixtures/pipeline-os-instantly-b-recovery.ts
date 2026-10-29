import { bdSourceFixture } from "./pipeline-os-instantly-b-diagnostic";
import {
  runInstantlyBDiagnostic,
  assertBDTransition,
  validateBDState,
  type BDState,
} from "../../scripts/pipeline-os/s00-instantly-b-diagnostic";
import type { BState } from "../../scripts/pipeline-os/s00-instantly-b";
import { BClock, BProvider, bEnv, bJson } from "./pipeline-os-instantly-b";

// Entire lineage through real implementations, with fictional data/transports only.
export async function brSourceFixture() {
  const f = await bdSourceFixture();
  const provider = new BProvider();
  provider.campaign = structuredClone(f.body);
  for (const k of ["ai_sdr_id", "is_evergreen", "stop_for_company"])
    delete provider.campaign![k];
  let value: BState | BDState = f.inputs.source;
  await runInstantlyBDiagnostic(
    bEnv,
    {
      load: async () => value,
      save: async (s) => {
        assertBDTransition(value, s);
        value = structuredClone(s);
      },
    },
    f.inputs,
    {
      execute: true,
      authorizedNew: 2,
      authorizedTotal: 20,
      includedCallsConfirmed: true,
      manifestReviewed: true,
      clock: new BClock(),
      fetchImpl: async () => bJson(provider.campaign),
    },
  );
  const source = validateBDState(value);
  if (source.calls !== 19 || source.status !== "completed")
    throw Error("BAD_FICTIONAL_SOURCE");
  return {
    inputs: { source, scope: f.inputs.scope, manifest: f.inputs.manifest },
    provider,
  };
}
