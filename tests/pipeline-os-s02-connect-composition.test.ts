import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectCompositionFixture } from "./fixtures/pipeline-os-s02-connect-composition";
import { ConnectError } from "../src/lib/composio-connect";
import { createConnectProvider } from "../src/lib/server/mail-accounts/composio-connect/provider";
import { validateConnectProviderConfiguration } from "../src/lib/server/mail-accounts/composio-connect/config";
import { verificationContextHash as neutralHash } from "../src/lib/server/mail-transport/verification-context";
import {
  verifyComposioBinding,
  verificationPassed,
  verificationContextHash as c2Hash,
  requiredComposioScopes,
  type VerificationTarget,
} from "../src/lib/server/mail-accounts/composio-verifier";
import { composioProductOperationEnabled } from "../src/lib/server/mail-transport/runtime-context";

test("CW2-AC02/04: engine and real offline adapter register one candidate; replay emits no second link", async () => {
  const f = connectCompositionFixture(),
    first = f.request();
  f.queueLink();
  const started = await f.engine.start(first);
  assert.equal(started.state, "awaiting_consent");
  assert.equal(started.composio_enabled, false);
  assert.equal(f.calls.length, 1);
  const replay = await f.engine.start(first);
  assert.equal(replay.state, "awaiting_consent");
  assert.equal(f.calls.length, 1);
  const safe = JSON.stringify(replay);
  for (const secret of [
    f.proof,
    f.state,
    "api_key",
    "browser_hash",
    "fictional-composition-key",
    "https://connect.composio.dev",
  ])
    assert(!safe.includes(secret));
  const navigation = await f.engine.resume({
    attempt_id: first.attempt_id,
    browser_proof: f.proof,
  });
  assert.equal(navigation.kind, "server_navigation");
  f.queueIdentity();
  const checked = await f.engine.callback(f.callback());
  assert.equal(checked.state, "ready_to_register");
  const registration = f.request();
  const completed = await f.engine.register(registration);
  assert.equal(completed.state, "completed");
  assert.equal(completed.composio_enabled, false);
  await f.engine.register(registration);
  assert.equal(f.counts.registered, 1);
  assert.equal(f.calls.length, 4);
  assert.equal(f.timers.size, 0);
  assert.equal(composioProductOperationEnabled, false);
  assert.deepEqual(
    f.calls.map((c) => [c.url.split("/api/v3.1")[1], c.method]),
    [
      ["/connected_accounts/link", "POST"],
      ["/connected_accounts/ca_composition", "GET"],
      ["/auth_configs/ac_composition", "GET"],
      ["/tools/execute/proxy", "POST"],
    ],
  );
  assert.deepEqual(f.calls[3].body, {
    connected_account_id: "ca_composition",
    user_id: f.config.config.owner_id,
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    method: "GET",
  });
});
test("CW2-AC04: identity mismatch never registers or activates a transport", async () => {
  const f = connectCompositionFixture();
  f.queueLink();
  await f.engine.start(f.request());
  f.queueIdentity("other@composition.test");
  await assert.rejects(
    f.engine.callback(f.callback()),
    (e: unknown) =>
      e instanceof ConnectError && e.code === "CONNECT_IDENTITY_MISMATCH",
  );
  assert.equal(f.snapshot().attempt.state, "rejected");
  assert.equal(f.counts.registered, 0);
  assert.equal(f.calls.length, 4);
  assert.equal(composioProductOperationEnabled, false);
});
test("CW2-AC04: unknown link emission becomes uncertain; neither start nor resume creates a retry", async () => {
  const f = connectCompositionFixture();
  f.responses.push(Error("fictional network interruption"));
  await assert.rejects(
    f.engine.start(f.request()),
    (e: unknown) =>
      e instanceof ConnectError &&
      e.code === "CONNECT_NEEDS_RECONCILIATION" &&
      e.ledgerRecorded === true,
  );
  assert.equal(f.counts.uncertain, 1);
  assert.equal(f.snapshot().attempt.state, "uncertain");
  assert.equal(f.calls.length, 1);
  await assert.rejects(f.engine.start(f.request()));
  await assert.rejects(
    f.engine.resume({
      attempt_id: f.snapshot().attempt.id,
      browser_proof: f.proof,
    }),
  );
  assert.equal(f.calls.length, 1);
});
test("CW2-AC04: changed context and expired MFA session deny before provider", async () => {
  const f = connectCompositionFixture();
  f.changeContext();
  await assert.rejects(
    f.engine.start(f.request()),
    (e: unknown) => e instanceof ConnectError && e.code === "CONNECT_STALE",
  );
  assert.equal(f.calls.length, 0);
  const g = connectCompositionFixture();
  g.session.expires_at_ms = g.clock.now();
  await assert.rejects(
    g.engine.start(g.request()),
    (e: unknown) => e instanceof ConnectError && e.code === "CONNECT_FORBIDDEN",
  );
  assert.equal(g.calls.length, 0);
});
test("CW2-AC03: upstream descriptor uses the same C2/R06 context and rejects rotated expected version", () => {
  const f = connectCompositionFixture();
  const descriptor = validateConnectProviderConfiguration(
    f.config,
    structuredClone(f.config),
  );
  assert.equal(neutralHash(descriptor.context), c2Hash(descriptor.context));
  assert(neutralHash(descriptor.context));
  const stale = structuredClone(f.config);
  stale.context.credential_version = "fixture_v2";
  assert.throws(
    () => createConnectProvider({ ...f.options, expectedConfiguration: stale }),
    (e: unknown) => e instanceof ConnectError && e.code === "CONNECT_STALE",
  );
  assert.equal(f.calls.length, 0);
});
test("CW2-AC03: a successful onboarding profile cannot replace effective-grant evidence C2", async () => {
  const f = connectCompositionFixture();
  f.queueIdentity();
  const identity = (await f.provider.readIdentity({
    connected_account_id: "ca_composition",
    project_id: f.config.config.project_id,
    auth_config_id: f.config.config.auth_config_id,
    owner_id: f.config.config.owner_id,
    signal: new AbortController().signal,
  })) as { primary_email: string };
  const target: VerificationTarget = {
    account_id: randomUUID(),
    binding_id: randomUUID(),
    composio_project_id: f.config.config.project_id,
    auth_config_id: f.config.config.auth_config_id,
    connected_account_id: "ca_composition",
    composio_user_id: f.config.config.owner_id,
    google_quota_project_id: f.config.config.quota_project_id,
    expected_mailbox_email: "mailbox@composition.test",
  };
  assert.equal(
    identity.primary_email.toLowerCase(),
    target.expected_mailbox_email,
  );
  let profileReads = 0;
  const facts = await verifyComposioBinding(target, f.config.context, {
    connection: async () => ({
      id: target.connected_account_id,
      auth_config_id: target.auth_config_id,
      user_id: target.composio_user_id,
      toolkit: "gmail",
      status: "ACTIVE",
      disabled: false,
      effective_grants: null,
    }),
    authConfig: async () => ({
      id: target.auth_config_id,
      toolkit: "gmail",
      enabled: true,
      revision: f.config.context.auth_config_revision,
      declared_scopes: [...requiredComposioScopes],
    }),
    profile: async () => {
      profileReads++;
      return {
        connected_account_id: target.connected_account_id,
        primary_email: identity.primary_email,
      };
    },
  });
  assert.equal(profileReads, 0);
  assert.equal(facts.mailbox, false);
  assert.equal(facts.permissions, false);
  assert.equal(verificationPassed(facts), false);
  assert.equal(facts.reason, "permission_unproven");
});
