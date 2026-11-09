import { randomUUID } from "node:crypto";
import {
  ConnectError,
  type ConnectAttempt,
  type ConnectClock,
  type ConnectLease,
  type ConnectLeaseCommand,
  type ConnectStore,
  type ConnectStoreCommand,
} from "../../src/lib/composio-connect";
import { connectDigest } from "../../src/lib/server/mail-accounts/composio-connect/session";
import { createComposioConnectOrchestrator } from "../../src/lib/server/mail-accounts/composio-connect/orchestrator";
import { createConnectProvider } from "../../src/lib/server/mail-accounts/composio-connect/provider";

// Composition fixture only. No transaction, session signature, encryption or PostgreSQL claims.
export function connectCompositionFixture() {
  const now = 1_799_999_000_000;
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const clock: ConnectClock = {
    now: () => now,
    setTimer(callback) {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
  };
  const proof = randomUUID(),
    state = randomUUID();
  const session = {
    actor_id: randomUUID(),
    session_id: randomUUID(),
    role: "superadmin" as const,
    active: true,
    aal: "aal2" as const,
    authorization_revision: 1,
    expires_at_ms: now + 3_600_000,
  };
  const config = {
    enabled: true as const,
    config: {
      generation: 1,
      project_id: "pr_composition",
      auth_config_id: "ac_composition",
      quota_project_id: "google_composition",
      owner_id: "crm-mail:fictional",
      callback_mode: "standard" as const,
    },
    context: {
      composio_project_id: "pr_composition",
      credential_version: "fixture_v1",
      google_quota_project_id: "google_composition",
      auth_config_revision: "fixture_r1",
      provenance_reference: "fixture_review",
      project_provenance: "server_reviewed" as const,
      quota_provenance: "oauth_client_reviewed" as const,
    },
    callback_origin: "https://crm.composition.test",
  };
  let attempt: ConnectAttempt = {
    id: randomUUID(),
    revision: 0,
    state: "prepared",
    created_at_ms: now,
    deadline_ms: now + 600_000,
    account_id: randomUUID(),
    brand_id: randomUUID(),
    expected_mailbox_email: "mailbox@composition.test",
    binding: {
      actor_id: session.actor_id,
      session_hash: connectDigest(session.session_id),
      authorization_revision: 1,
      browser_hash: connectDigest(proof),
      state_hash: connectDigest(state),
    },
    config: structuredClone(config.config),
    context_hash: connectDigest("reviewed-composition-context"),
    phase: null,
    connection_id: null,
    navigation: null,
    binding_id: null,
    cleanup_required: false,
  };
  let context = attempt.context_hash;
  const receipts = new Map<string, { command: string; fingerprint: string }>();
  const leases = new Map<string, ConnectLease>();
  const snapshot = () => ({
    attempt: structuredClone(attempt),
    current_context_hash: context,
  });
  const counts = { registered: 0, uncertain: 0, residual: 0 };
  function guard(c: ConnectStoreCommand) {
    if (
      c.attempt_id !== attempt.id ||
      c.expected_revision !== attempt.revision ||
      c.expected_context_hash !== context
    )
      throw new ConnectError("CONNECT_STALE");
  }
  function leased(c: ConnectLeaseCommand) {
    if (
      c.lease.id !== attempt.phase?.id ||
      c.lease.capability !== leases.get(c.lease.id)?.capability ||
      c.command.fingerprint !== attempt.phase.fingerprint
    )
      throw new ConnectError("CONNECT_STALE");
  }
  function remember(c: ConnectStoreCommand) {
    receipts.set(c.idempotency_key, {
      command: c.command,
      fingerprint: c.fingerprint,
    });
  }
  const store: ConnectStore = {
    async load(input) {
      return input.attempt_id === attempt.id ? snapshot() : null;
    },
    async lookupReceipt(c) {
      const found = receipts.get(c.idempotency_key);
      return {
        kind: !found
          ? "absent"
          : found.command === c.command && found.fingerprint === c.fingerprint
            ? "replay"
            : "conflict",
      };
    },
    async claimPhase(c) {
      guard(c);
      if (attempt.phase) return { kind: "conflict" };
      const id = randomUUID();
      attempt.revision++;
      attempt.phase = { id, kind: c.phase, fingerprint: c.fingerprint };
      attempt.state =
        c.phase === "link"
          ? "link_pending"
          : c.phase === "identity"
            ? "identity_checking"
            : "ready_to_register";
      const lease: ConnectLease = {
        id,
        kind: c.phase,
        fingerprint: c.fingerprint,
        revision: attempt.revision,
        capability: randomUUID(),
        callback_state: c.phase === "link" ? state : null,
      };
      leases.set(id, lease);
      return {
        kind: "claimed",
        snapshot: snapshot(),
        lease: structuredClone(lease),
      };
    },
    async saveLink(c) {
      leased(c);
      attempt = {
        ...attempt,
        state: "awaiting_consent",
        revision: attempt.revision + 1,
        deadline_ms: c.deadline_ms,
        phase: null,
        connection_id: c.link.connected_account_id,
        navigation: { url: c.link.url, expires_at_ms: c.link.expires_at_ms },
      };
      remember(c.command);
      return snapshot();
    },
    async finishIdentity(c) {
      leased(c);
      attempt = {
        ...attempt,
        state: "ready_to_register",
        revision: attempt.revision + 1,
        phase: null,
        navigation: null,
      };
      remember(c.command);
      return snapshot();
    },
    async releaseClaim(c) {
      leased(c);
      attempt = {
        ...attempt,
        state:
          c.lease.kind === "link"
            ? "prepared"
            : c.lease.kind === "identity"
              ? "awaiting_consent"
              : "ready_to_register",
        revision: attempt.revision + 1,
        phase: null,
      };
    },
    async reject(c) {
      if (c.lease) leased({ command: c.command, lease: c.lease });
      else guard(c.command);
      attempt = {
        ...attempt,
        state: "rejected",
        revision: attempt.revision + 1,
        phase: null,
        navigation: null,
        cleanup_required: !!attempt.connection_id,
      };
      remember(c.command);
      return snapshot();
    },
    async cancel(c) {
      guard(c);
      attempt = {
        ...attempt,
        state: "cancelled",
        revision: attempt.revision + 1,
        phase: null,
        navigation: null,
        cleanup_required: !!attempt.connection_id,
      };
      remember(c);
      return snapshot();
    },
    async registerCandidate(c) {
      leased(c);
      counts.registered++;
      attempt = {
        ...attempt,
        state: "completed",
        revision: attempt.revision + 1,
        phase: null,
        navigation: null,
        binding_id: randomUUID(),
      };
      remember(c.command);
      return snapshot();
    },
    async markUncertain(c) {
      if (c.lease.capability !== leases.get(c.lease.id)?.capability)
        throw new ConnectError("CONNECT_FORBIDDEN");
      counts.uncertain++;
      attempt = {
        ...attempt,
        state: "uncertain",
        revision: attempt.revision + 1,
        phase: null,
        navigation: null,
        cleanup_required: true,
        connection_id: c.observed_connection_id ?? attempt.connection_id,
      };
    },
    async recordResidual() {
      counts.residual++;
    },
  };
  const calls: { url: string; method: string; body: unknown }[] = [],
    responses: (Response | Error)[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const response = responses.shift();
    if (!response) throw Error("UNEXPECTED_FIXTURE_REQUEST");
    if (response instanceof Error) throw response;
    return response;
  };
  const options = {
    configuration: config,
    expectedConfiguration: structuredClone(config),
    credential: { version: "fixture_v1", api_key: "fictional-composition-key" },
    fetchImpl,
    clock,
  };
  const provider = createConnectProvider(options);
  const engine = createComposioConnectOrchestrator({
    session: { readCurrent: async () => structuredClone(session) },
    store,
    provider,
    clock,
    callbackOrigin: config.callback_origin,
  });
  const request = () => ({
    attempt_id: attempt.id,
    expected_revision: attempt.revision,
    idempotency_key: randomUUID(),
    browser_proof: proof,
  });
  function queueLink() {
    responses.push(
      Response.json(
        {
          connected_account_id: "ca_composition",
          redirect_url:
            "https://connect.composio.dev/link/fictional_composition",
          expires_at: new Date(now + 600_000).toISOString(),
        },
        { status: 201 },
      ),
    );
  }
  function queueIdentity(email = "MAILBOX@composition.test") {
    responses.push(
      Response.json({
        id: "ca_composition",
        user_id: config.config.owner_id,
        toolkit: { slug: "gmail" },
        authScheme: "OAUTH2",
        auth_config: {
          id: config.config.auth_config_id,
          auth_scheme: "OAUTH2",
          is_disabled: false,
        },
        status: "ACTIVE",
        is_disabled: false,
        requested_scopes: ["not_effective_grants"],
      }),
      Response.json({
        id: config.config.auth_config_id,
        toolkit: { slug: "gmail" },
        auth_scheme: "OAUTH2",
        status: "ENABLED",
      }),
      Response.json({ status: 200, data: { emailAddress: email } }),
    );
  }
  return {
    clock,
    config,
    options,
    provider,
    engine,
    session,
    store,
    counts,
    calls,
    responses,
    timers,
    request,
    queueLink,
    queueIdentity,
    state,
    proof,
    snapshot,
    changeContext() {
      context = connectDigest("changed-context");
    },
    callback: () => ({
      ...request(),
      state,
      status: "success" as const,
      connected_account_id: "ca_composition",
    }),
  };
}
