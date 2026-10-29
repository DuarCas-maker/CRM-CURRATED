import { cfdSourceFixture } from "./pipeline-os-instantly-config-diagnostic";
import {
  runInstantlyConfigDiagnostic,
  assertCFDTransition,
  validateCFDState,
  type CFDState,
} from "../../scripts/pipeline-os/s00-instantly-config-diagnostic";
import type { BRState } from "../../scripts/pipeline-os/s00-instantly-b-recovery";
import { BClock, BProvider, bEnv, bJson } from "./pipeline-os-instantly-b";

// Full synthetic lineage through the real phase machines; no provider bodies or credentials.
export async function br28SourceFixture() {
  const f = await cfdSourceFixture(),
    body = structuredClone(f.body);
  body.is_evergreen = false;
  body.stop_for_company = false;
  Object.assign(body.sequences[0].steps[0], {
    delay_unit: "days",
    pre_delay_unit: "days",
  });
  let value: BRState | CFDState = f.inputs.source;
  await runInstantlyConfigDiagnostic(
    bEnv,
    {
      load: async () => structuredClone(value),
      save: async (s) => {
        assertCFDTransition(value, s);
        value = structuredClone(s);
      },
    },
    f.inputs,
    {
      execute: true,
      authorizedNew: 2,
      authorizedTotal: 29,
      includedCallsConfirmed: true,
      manifestReviewed: true,
      clock: new BClock(),
      fetchImpl: async () => bJson(body),
    },
  );
  const source = validateCFDState(value),
    provider = new BProvider();
  provider.campaign = structuredClone(body);
  if (source.calls !== 28 || source.status !== "completed")
    throw Error("BAD_FICTIONAL_BR28_SOURCE");
  return {
    inputs: { source, scope: f.inputs.scope, manifest: f.inputs.manifest },
    provider,
  };
}
