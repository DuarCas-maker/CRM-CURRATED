import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { prepareConnectOnboardingSettings } from "../scripts/prepare-composio-connect";

const input = () => ({
  origin: "https://crm.finlabinc.com",
  expectedGeneration: 0,
  projectId: "pr_fixture",
  authConfigId: "ac_fixture",
  credentialVersion: "fixture-v1",
  authConfigRevision: "revision-1",
  provenanceReference: "review-1",
  policy: {
    contract_version: 2,
    policy_id: randomUUID(),
    generation: 1,
    mode: "crm_shared_conservative",
    state: "enabled",
    limits: {
      group_units_per_minute: 4500,
      account_units_per_minute: 4500,
      group_units_per_window: 75000000,
      window_seconds: 86460,
    },
    google_project: { provenance: "unknown", project_id: null },
  },
  organizations: ["Fixture organization"],
  sessionOverlay: { maxAgeSeconds: 0, inactivitySeconds: 0 },
});
test("Connect setup CLI prepares once only under private local storage, never prints key material", () => {
  const folder = path.resolve(".local", "connect-setup-" + randomUUID());
  mkdirSync(folder, { recursive: true });
  const source = path.join(folder, "input.json"),
    target = path.join(folder, "output.json");
  writeFileSync(source, JSON.stringify(input()));
  const args = [
    "--import",
    "tsx",
    "scripts/prepare-composio-connect.ts",
    "--prepare-private",
    source,
    target,
  ];
  const output = execFileSync(process.execPath, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  const bundle = JSON.parse(readFileSync(target, "utf8"));
  assert.equal(bundle.executionAuthorized, false);
  assert.equal(bundle.secretReference.read, false);
  const key = bundle.keyring.keys[bundle.keyring.activeKeyId];
  assert.equal(Buffer.from(key, "base64url").length, 32);
  assert.equal(output.includes(key), false);
  assert.throws(() =>
    execFileSync(process.execPath, args, { stdio: "pipe", windowsHide: true }),
  );
  const outside = path.resolve("forbidden-connect-setup.json");
  assert.throws(() =>
    execFileSync(process.execPath, [...args.slice(0, -1), outside], {
      stdio: "pipe",
      windowsHide: true,
    }),
  );
  assert.equal(existsSync(outside), false);
});
test("Connect setup prepares CAS publication and null Google quota without reading a key or activating transport", () => {
  const result = prepareConnectOnboardingSettings(input());
  assert.equal(result.settings.descriptor.config.generation, 1);
  assert.equal(result.settings.descriptor.config.quota_project_id, null);
  assert.equal(result.publication.arguments.expected_generation, 0);
  assert.equal(result.secretReference.read, false);
  assert.equal(result.executionAuthorized, false);
  assert.deepEqual(result.flagChanges, { COMPOSIO_CONNECT_ENABLED: "true" });
  assert(!JSON.stringify(result).includes("api_key"));
});
test("Connect setup rejects wrong destination, duplicate organizations, disabled policy, secrets and unsafe generations", () => {
  for (const value of [
    { ...input(), origin: "https://other.invalid" },
    { ...input(), organizations: ["same", "same"] },
    { ...input(), policy: { ...input().policy, state: "disabled" } },
    { ...input(), api_key: "must-not-be-written" },
    { ...input(), expectedGeneration: Number.MAX_SAFE_INTEGER },
    { ...input(), sessionOverlay: { maxAgeSeconds: -1, inactivitySeconds: 0 } },
  ])
    assert.throws(() => prepareConnectOnboardingSettings(value));
});
