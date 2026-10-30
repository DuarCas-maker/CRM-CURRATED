import { randomBytes, randomUUID } from "node:crypto";
import { cSourceFixture } from "./pipeline-os-instantly-c";
import { bWorkspace } from "./pipeline-os-instantly-b";
import {
  controlBudgets,
  controlHash,
  validateCAppManifest,
} from "../../src/lib/server/instantly/control-contract";
import { validateCInputs } from "../../scripts/pipeline-os/s00-instantly-c";
export const appOrigin = "https://crm.example.invalid",
  appToken = "d".repeat(64);
export async function cAppFixture(now = Date.now()) {
  const f = await cSourceFixture(),
    v = validateCInputs(f.inputs),
    nonce = randomBytes(12).toString("hex");
  const receiver = {
    ...f.inputs.receiver,
    nonce,
    url: appOrigin + "/api/integrations/instantly/webhook/" + nonce,
    startsAt: now - 100,
    endsAt: now + 119900,
  };
  const m = validateCAppManifest({
    draftVersion: 1,
    protocol: "S00_INSTANTLY_C_APP_V1",
    draft: false,
    executionReady: true,
    origin: appOrigin,
    source: {
      version: 7,
      calls: 43,
      canonicalHash: v.sourceHash,
      scopeHash: v.scopeHash,
      bManifestHash: v.manifestHash,
      configurationFingerprint:
        f.inputs.source.prior.prior.prior.prior.prior.predecessor.fingerprint,
      workspaceId: bWorkspace,
      campaignId: f.provider.campaign!.id,
    },
    receiverManifest: receiver,
    control: {
      authorizationMode: "superadmin_mfa_opaque_lease",
      leaseId: null,
      ticketFile: null,
      issuedAt: null,
      expiresAt: null,
      maxLeaseMs: 600000,
      scopes: ["prepare", "arm", "observe", "close", "revoke"],
      maxObservationRequests: 12,
      minimumPollMs: 10000,
    },
    budgets: structuredClone(controlBudgets),
    gates: {
      implementationVerified: true,
      migrationAndDeploymentVerified: true,
      manifestReviewed: true,
      apiAndWebhooksIncludedConfirmed: true,
      logsRedactedVerified: true,
      providerExecutionAuthorized: true,
      controlExecutionAuthorized: true,
      webhookActivationAuthorized: true,
    },
  });
  const inputs = {
    source: f.inputs.source,
    scope: f.inputs.scope,
    bManifest: f.inputs.manifest,
    manifest: m,
  };
  const ticket = (intentId = randomUUID()) => ({
    leaseId: randomUUID(),
    intentId,
    expiresAt: receiver.endsAt + 60000,
    nonce,
    sourceHash: v.sourceHash,
    manifestHash: controlHash(JSON.stringify(receiver)),
  });
  return { ...f, inputs, manifest: m, ticket };
}
