import { brSourceFixture } from "./pipeline-os-instantly-b-recovery";
import {
  runInstantlyBRecovery,
  assertBRTransition,
  validateBRState,
  type BRState,
} from "../../scripts/pipeline-os/s00-instantly-b-recovery";
import type { BDState } from "../../scripts/pipeline-os/s00-instantly-b-diagnostic";
import { bEnv, bJson, BClock } from "./pipeline-os-instantly-b";

// An invalid unit is a synthetic failure trigger, NOT a captured provider response.
export async function cfdSourceFixture() {
  const f = await brSourceFixture();
  let value: BDState | BRState = f.inputs.source;
  await runInstantlyBRecovery(
    bEnv,
    {
      load: async () => structuredClone(value),
      save: async (s) => {
        assertBRTransition(value, s);
        value = structuredClone(s);
      },
    },
    f.inputs,
    {
      execute: true,
      authorizedNew: 22,
      authorizedTotal: 41,
      includedCallsConfirmed: true,
      manifestReviewed: true,
      clock: new BClock(),
      fetchImpl: async (raw, init) => {
        const result = f.provider.handle(String(raw), init!);
        if (validateBRState(value).requests.at(-1)?.step === "configure")
          f.provider.campaign!.sequences[0].steps[0].delay_unit = "weeks";
        return bJson(result);
      },
    },
  );
  const source = validateBRState(value);
  if (
    source.calls !== 27 ||
    source.stage !== 5 ||
    source.emergency !== "verified_paused"
  )
    throw Error("BAD_FICTIONAL_CFD_SOURCE");
  return {
    inputs: { source, scope: f.inputs.scope, manifest: f.inputs.manifest },
    body: structuredClone(f.provider.campaign!),
  };
}
