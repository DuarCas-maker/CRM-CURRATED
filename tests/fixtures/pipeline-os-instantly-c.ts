import { hash } from "../../scripts/pipeline-os/s00-composio-common";
import { br28SourceFixture } from "./pipeline-os-instantly-b-recovery-from-28";
import {
  runInstantlyBRecoveryFrom28,
  assertBR28Transition,
  validateBR28State,
  type BR28State,
} from "../../scripts/pipeline-os/s00-instantly-b-recovery-from-28";
import type { CFDState } from "../../scripts/pipeline-os/s00-instantly-config-diagnostic";
import { bEnv, BClock, bJson } from "./pipeline-os-instantly-b";
import { validateCManifest } from "../../scripts/pipeline-os/s00-instantly-c-receiver";

// Synthetic lineage and payload contract, never a saved provider/customer response.
export const cToken = "a".repeat(64),
  cDedup = "b".repeat(64),
  cNow = Date.parse("2026-10-29T20:00:00Z");
export const cEnv = {
  ...bEnv,
  INSTANTLY_S00_WEBHOOK_SECRET: cToken,
  INSTANTLY_S00_WEBHOOK_DEDUP_KEY: cDedup,
};
export async function cSourceFixture() {
  const f = await br28SourceFixture();
  f.provider.threePages = true;
  let value: CFDState | BR28State = f.inputs.source;
  await runInstantlyBRecoveryFrom28(
    bEnv,
    {
      load: async () => structuredClone(value),
      save: async (s) => {
        assertBR28Transition(value, s);
        value = structuredClone(s);
      },
    },
    f.inputs,
    {
      execute: true,
      authorizedNew: 20,
      authorizedTotal: 48,
      includedCallsConfirmed: true,
      manifestReviewed: true,
      clock: new BClock(),
      fetchImpl: async (raw, init) =>
        bJson(f.provider.handle(String(raw), init!)),
    },
  );
  const source = validateBR28State(value);
  if (source.calls !== 43 || source.status !== "completed")
    throw Error("BAD_FICTIONAL_C_SOURCE");
  const receiver = validateCManifest({
    version: 1,
    sourceHash: hash(JSON.stringify(source)),
    nonce: "c".repeat(24),
    url: "https://receiver.example.invalid/s00/" + "c".repeat(24),
    startsAt: cNow,
    endsAt: cNow + 120000,
    tokenHash: hash(cToken),
    dedupKeyHash: hash(cDedup),
    controlled: true,
    noAdditionalCost: true,
    persistenceVerified: true,
    logsRedacted: true,
  });
  return {
    inputs: {
      source,
      scope: f.inputs.scope,
      manifest: f.inputs.manifest,
      receiver,
    },
    provider: f.provider,
  };
}
