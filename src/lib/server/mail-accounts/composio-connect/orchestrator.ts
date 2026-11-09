import { z } from "zod";
import {
  ConnectError,
  connectAttemptSchema,
  connectCallbackSchema,
  connectClaimSchema,
  connectIdentitySchema,
  connectLinkSchema,
  connectReceiptSchema,
  connectRequestSchema,
  connectResumeSchema,
  connectSnapshotSchema,
  connectStatus,
  type ConnectAttempt,
  type ConnectAuthority,
  type ConnectCallback,
  type ConnectDependencies,
  type ConnectLease,
  type ConnectLink,
  type ConnectPhaseKind,
  type ConnectRequest,
  type ConnectSnapshot,
  type ConnectStoreCommand,
} from "../../../composio-connect";
import {
  assertConnectBinding,
  connectAuthority,
  connectDigest,
  currentConnectSession,
  sameConnectDigest,
} from "./session";

// Only a trusted adapter may assert this classification. HTTP errors/timeouts alone do not prove it.
export class ConnectNotEmitted extends Error {
  constructor() {
    super("Provider operation was not emitted");
    this.name = "ConnectNotEmitted";
  }
}
class CallDeadline extends Error {}
const optionsSchema = z.strictObject({
  linkTimeoutMs: z.number().int().min(1).max(10_000).default(10_000),
  identityTimeoutMs: z.number().int().min(1).max(30_000).default(30_000),
});
type Input = Pick<ConnectRequest, "attempt_id" | "browser_proof">;
type View = { snapshot: ConnectSnapshot; authority: ConnectAuthority };
type Command = View & {
  input: ConnectRequest | ConnectCallback;
  storeCommand: ConnectStoreCommand;
};
type Claimed = Command & { lease: ConnectLease };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function fingerprint(
  command: ConnectStoreCommand["command"],
  input: ConnectRequest | ConnectCallback,
): string {
  const { browser_proof, ...safe } = input;
  const clean: Record<string, unknown> = {
    ...safe,
    browser_hash: connectDigest(browser_proof),
    command,
  };
  if ("state" in clean) {
    clean.state_hash = connectDigest(String(clean.state));
    delete clean.state;
  }
  return connectDigest(canonical(clean));
}
function immutable(a: ConnectAttempt): string {
  return canonical({
    id: a.id,
    account_id: a.account_id,
    brand_id: a.brand_id,
    created_at_ms: a.created_at_ms,
    expected_mailbox_email: a.expected_mailbox_email,
    binding: a.binding,
    config: a.config,
    context_hash: a.context_hash,
  });
}
function stable(before: ConnectAttempt, after: ConnectAttempt): void {
  if (
    immutable(before) !== immutable(after) ||
    after.deadline_ms > before.deadline_ms
  )
    throw new ConnectError("CONNECT_STALE");
}
function snapshot(value: unknown): ConnectSnapshot {
  const parsed = connectSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new ConnectError("CONNECT_UNAVAILABLE");
  if (parsed.data.current_context_hash !== parsed.data.attempt.context_hash)
    throw new ConnectError("CONNECT_STALE");
  return parsed.data;
}
function closed(a: ConnectAttempt): boolean {
  return ["completed", "cancelled", "expired", "rejected"].includes(a.state);
}
function unavailable(): ConnectError {
  return new ConnectError("CONNECT_UNAVAILABLE");
}

export function createComposioConnectOrchestrator(
  deps: ConnectDependencies,
  options: unknown = {},
) {
  const opts = optionsSchema.safeParse(options);
  if (
    !opts.success ||
    !deps ||
    !deps.session ||
    !deps.store ||
    !deps.provider ||
    !deps.clock
  )
    throw unavailable();
  for (const method of [
    "load",
    "lookupReceipt",
    "claimPhase",
    "saveLink",
    "finishIdentity",
    "releaseClaim",
    "reject",
    "cancel",
    "registerCandidate",
    "markUncertain",
    "recordResidual",
  ] as const)
    if (typeof deps.store[method] !== "function") throw unavailable();
  if (
    typeof deps.session.readCurrent !== "function" ||
    typeof deps.provider.createLink !== "function" ||
    typeof deps.provider.readIdentity !== "function" ||
    typeof deps.clock.now !== "function" ||
    typeof deps.clock.setTimer !== "function" ||
    typeof deps.clock.clearTimer !== "function"
  )
    throw unavailable();
  let callbackOrigin: string;
  try {
    const u = new URL(deps.callbackOrigin);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash
    )
      throw unavailable();
    callbackOrigin = u.origin;
  } catch {
    throw unavailable();
  }

  function now(): number {
    try {
      const value = deps.clock.now();
      if (!Number.isSafeInteger(value) || value < 0) throw unavailable();
      return value;
    } catch {
      throw unavailable();
    }
  }
  function live(a: ConnectAttempt): void {
    const time = now();
    if (time < a.created_at_ms) throw unavailable();
    if (
      time >= a.deadline_ms ||
      ["cancelled", "expired", "rejected"].includes(a.state)
    )
      throw new ConnectError("CONNECT_CLOSED");
    if (a.state === "uncertain")
      throw new ConnectError("CONNECT_NEEDS_RECONCILIATION");
  }
  async function load(input: Input, anchor?: ConnectAttempt): Promise<View> {
    let rawSession: unknown;
    try {
      rawSession = await deps.session.readCurrent();
    } catch {
      throw unavailable();
    }
    const session = currentConnectSession(rawSession, now());
    const authority = connectAuthority(session, input.browser_proof);
    let raw: unknown;
    try {
      raw = await deps.store.load({ attempt_id: input.attempt_id, authority });
    } catch {
      throw unavailable();
    }
    if (raw === null) throw new ConnectError("CONNECT_NOT_FOUND");
    const data = snapshot(raw);
    if (data.attempt.id !== input.attempt_id) throw unavailable();
    currentConnectSession(session, now());
    assertConnectBinding(session, data.attempt.binding, input.browser_proof);
    if (anchor) stable(anchor, data.attempt);
    return { snapshot: data, authority };
  }
  function request(value: unknown): ConnectRequest {
    const parsed = connectRequestSchema.safeParse(value);
    if (!parsed.success) throw new ConnectError("CONNECT_INVALID_INPUT");
    return parsed.data;
  }
  async function command(
    name: ConnectStoreCommand["command"],
    input: ConnectRequest | ConnectCallback,
  ): Promise<Command> {
    const view = await load(input);
    const a = view.snapshot.attempt;
    // Terminal cancellation may still replay its own cancellation receipt until original expiry.
    if (now() < a.created_at_ms) throw unavailable();
    if (now() >= a.deadline_ms) throw new ConnectError("CONNECT_CLOSED");
    if (a.state === "uncertain")
      throw new ConnectError("CONNECT_NEEDS_RECONCILIATION");
    return {
      ...view,
      input,
      storeCommand: {
        attempt_id: a.id,
        command: name,
        expected_revision: input.expected_revision,
        idempotency_key: input.idempotency_key,
        fingerprint: fingerprint(name, input),
        authority: view.authority,
        expected_context_hash: a.context_hash,
      },
    };
  }
  async function reply(c: Command) {
    const latest = await load(c.input, c.snapshot.attempt);
    if (now() >= latest.snapshot.attempt.deadline_ms)
      throw new ConnectError("CONNECT_CLOSED");
    return connectStatus(latest.snapshot.attempt);
  }
  async function replay(c: Command) {
    let raw: unknown;
    try {
      raw = await deps.store.lookupReceipt(c.storeCommand);
    } catch {
      throw unavailable();
    }
    const receipt = connectReceiptSchema.safeParse(raw);
    if (!receipt.success) throw unavailable();
    if (receipt.data.kind === "conflict")
      throw new ConnectError("CONNECT_CONFLICT");
    return receipt.data.kind === "replay" ? reply(c) : null;
  }
  async function claim(
    c: Command,
    phase: ConnectPhaseKind,
  ): Promise<Claimed | { replay: Awaited<ReturnType<typeof reply>> }> {
    let raw: unknown;
    try {
      raw = await deps.store.claimPhase({ ...c.storeCommand, phase });
    } catch {
      throw new ConnectError("CONNECT_UNAVAILABLE", { beforeEmission: true });
    }
    const parsed = connectClaimSchema.safeParse(raw);
    if (!parsed.success)
      throw new ConnectError("CONNECT_UNAVAILABLE", { beforeEmission: true });
    if (parsed.data.kind === "replay") return { replay: await reply(c) };
    if (parsed.data.kind === "conflict")
      throw new ConnectError("CONNECT_CONFLICT");
    const { snapshot: next, lease } = parsed.data;
    stable(c.snapshot.attempt, next.attempt);
    if (
      next.attempt.revision !== c.input.expected_revision + 1 ||
      lease.revision !== next.attempt.revision ||
      next.attempt.phase?.id !== lease.id ||
      lease.kind !== phase ||
      next.attempt.phase?.kind !== phase ||
      next.attempt.phase?.fingerprint !== c.storeCommand.fingerprint ||
      lease.fingerprint !== c.storeCommand.fingerprint ||
      (phase === "link" &&
        (!lease.callback_state ||
          !sameConnectDigest(
            lease.callback_state,
            next.attempt.binding.state_hash,
          )))
    )
      throw new ConnectError("CONNECT_UNAVAILABLE", { beforeEmission: true });
    const claimed = { ...c, snapshot: next, lease };
    if (next.current_context_hash !== next.attempt.context_hash) {
      await release(claimed);
      throw new ConnectError("CONNECT_STALE", { beforeEmission: true });
    }
    return claimed;
  }
  async function fresh(c: Claimed): Promise<Claimed> {
    const view = await load(c.input, c.snapshot.attempt);
    const a = view.snapshot.attempt;
    live(a);
    if (
      a.phase?.id !== c.lease.id ||
      a.revision !== c.lease.revision ||
      a.phase?.fingerprint !== c.lease.fingerprint
    )
      throw new ConnectError("CONNECT_STALE");
    return {
      ...c,
      ...view,
      storeCommand: { ...c.storeCommand, authority: view.authority },
    };
  }
  async function release(c: Claimed): Promise<void> {
    try {
      await deps.store.releaseClaim({
        command: c.storeCommand,
        lease: c.lease,
      });
    } catch {
      /* Retain durable pending claim; never issue again. */
    }
  }
  async function residual(
    c: Claimed,
    reason: "late_result" | "verification_unavailable",
    connectionId?: string,
  ): Promise<void> {
    try {
      await deps.store.recordResidual({
        attempt_id: c.input.attempt_id,
        lease: c.lease,
        reason,
        connection_id: connectionId,
      });
    } catch {
      throw new ConnectError("CONNECT_NEEDS_RECONCILIATION", {
        ledgerRecorded: false,
      });
    }
  }
  async function uncertain(
    c: Claimed,
    reason: "provider_unknown" | "save_failed",
    connectionId?: string,
  ): Promise<never> {
    let ledgerRecorded = false;
    try {
      await deps.store.markUncertain({
        attempt_id: c.input.attempt_id,
        lease: c.lease,
        reason,
        observed_connection_id: connectionId,
      });
      ledgerRecorded = true;
    } catch {
      /* Missing ledger acknowledgement is explicitly surfaced. */
    }
    throw new ConnectError("CONNECT_NEEDS_RECONCILIATION", { ledgerRecorded });
  }
  async function external<T>(
    a: ConnectAttempt,
    limit: number,
    effect: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const started = now();
    const budget = Math.min(limit, a.deadline_ms - started);
    if (budget <= 0) throw new ConnectNotEmitted();
    const controller = new AbortController();
    let handle: unknown;
    let rejectTimeout!: (reason: unknown) => void;
    const timeout = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    try {
      handle = deps.clock.setTimer(() => {
        controller.abort();
        rejectTimeout(new CallDeadline());
      }, budget);
    } catch {
      controller.abort();
      throw new ConnectNotEmitted();
    }
    const operation = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new ConnectNotEmitted();
      return effect(controller.signal);
    });
    try {
      const result = await Promise.race([operation, timeout]);
      if (now() - started >= budget || now() >= a.deadline_ms) {
        controller.abort();
        throw new CallDeadline();
      }
      return result;
    } finally {
      deps.clock.clearTimer(handle);
    }
  }

  return {
    async start(value: unknown) {
      const c = await command("start", request(value));
      const old = await replay(c);
      if (old) return old;
      if (closed(c.snapshot.attempt)) throw new ConnectError("CONNECT_CLOSED");
      if (c.snapshot.attempt.state !== "prepared")
        throw new ConnectError("CONNECT_CONFLICT");
      const result = await claim(c, "link");
      if ("replay" in result) return result.replay;
      let claimed: Claimed;
      try {
        claimed = await fresh(result);
      } catch (error) {
        await release(result);
        throw error;
      }
      const callback = new URL(
        "/api/mail/composio/connect/callback",
        callbackOrigin,
      );
      callback.searchParams.set("state", claimed.lease.callback_state!);
      let link: ConnectLink | undefined;
      try {
        const a = claimed.snapshot.attempt;
        const raw = await external(a, opts.data.linkTimeoutMs, (signal) =>
          deps.provider.createLink({
            attempt_id: a.id,
            project_id: a.config.project_id,
            auth_config_id: a.config.auth_config_id,
            owner_id: a.config.owner_id,
            callback_url: callback.href,
            signal,
          }),
        );
        const parsed = connectLinkSchema.safeParse(raw);
        if (!parsed.success || parsed.data.expires_at_ms <= now())
          throw unavailable();
        link = parsed.data;
        claimed = await fresh(claimed);
        const deadline = Math.min(
          claimed.snapshot.attempt.deadline_ms,
          link.expires_at_ms,
        );
        const saved = snapshot(
          await deps.store.saveLink({
            command: claimed.storeCommand,
            lease: claimed.lease,
            link,
            deadline_ms: deadline,
          }),
        );
        stable(claimed.snapshot.attempt, saved.attempt);
        if (
          saved.attempt.state !== "awaiting_consent" ||
          saved.attempt.phase ||
          saved.attempt.connection_id !== link.connected_account_id ||
          saved.attempt.navigation?.url !== link.url ||
          saved.attempt.deadline_ms !== deadline
        )
          throw unavailable();
        return await reply({ ...claimed, snapshot: saved });
      } catch (error) {
        if (error instanceof ConnectNotEmitted) {
          await release(claimed);
          if (now() >= claimed.snapshot.attempt.deadline_ms)
            throw new ConnectError("CONNECT_CLOSED", { beforeEmission: true });
          throw new ConnectError("CONNECT_UNAVAILABLE", {
            beforeEmission: true,
          });
        }
        // Recover only a matching result that is demonstrably already durable, never a new creation.
        if (link) {
          try {
            const saved = await load(c.input, c.snapshot.attempt);
            if (
              saved.snapshot.attempt.state === "awaiting_consent" &&
              !saved.snapshot.attempt.phase &&
              saved.snapshot.attempt.connection_id ===
                link.connected_account_id &&
              saved.snapshot.attempt.navigation?.url === link.url
            ) {
              live(saved.snapshot.attempt);
              return connectStatus(saved.snapshot.attempt);
            }
          } catch {
            /* No durable authorized match: do not return a navigation target. */
          }
        }
        return await uncertain(
          claimed,
          link ? "save_failed" : "provider_unknown",
          link?.connected_account_id,
        );
      }
    },

    async resume(value: unknown) {
      const parsed = connectResumeSchema.safeParse(value);
      if (!parsed.success) throw new ConnectError("CONNECT_INVALID_INPUT");
      const first = await load(parsed.data);
      const latest = await load(parsed.data, first.snapshot.attempt);
      const a = latest.snapshot.attempt;
      live(a);
      if (
        a.state !== "awaiting_consent" ||
        !a.navigation ||
        !a.connection_id ||
        a.navigation.expires_at_ms <= now()
      )
        throw new ConnectError("CONNECT_NOT_READY");
      // Server-only navigation action: the future route uses303; never serialize this as a status DTO.
      return {
        kind: "server_navigation" as const,
        attempt_id: a.id,
        deadline_ms: a.deadline_ms,
        url: a.navigation.url,
      };
    },

    async callback(value: unknown) {
      const parsed = connectCallbackSchema.safeParse(value);
      if (!parsed.success) throw new ConnectError("CONNECT_INVALID_INPUT");
      const input = parsed.data;
      const c = await command("callback", input);
      if (
        !sameConnectDigest(input.state, c.snapshot.attempt.binding.state_hash)
      )
        throw new ConnectError("CONNECT_FORBIDDEN");
      if (
        input.connected_account_id &&
        input.connected_account_id !== c.snapshot.attempt.connection_id
      )
        throw new ConnectError("CONNECT_IDENTITY_MISMATCH");
      const old = await replay(c);
      if (old) return old;
      if (closed(c.snapshot.attempt)) throw new ConnectError("CONNECT_CLOSED");
      if (c.snapshot.attempt.state !== "awaiting_consent")
        throw new ConnectError("CONNECT_CONFLICT");
      if (input.status === "failed") {
        try {
          const rejected = snapshot(
            await deps.store.reject({
              command: c.storeCommand,
              reason: "provider_cancelled",
            }),
          );
          stable(c.snapshot.attempt, rejected.attempt);
          if (rejected.attempt.state !== "rejected") throw unavailable();
          return await reply({ ...c, snapshot: rejected });
        } catch {
          throw unavailable();
        }
      }
      const result = await claim(c, "identity");
      if ("replay" in result) return result.replay;
      let claimed: Claimed;
      try {
        claimed = await fresh(result);
      } catch (error) {
        await release(result);
        throw error;
      }
      let identity: z.infer<typeof connectIdentitySchema>;
      try {
        const a = claimed.snapshot.attempt;
        const raw = await external(a, opts.data.identityTimeoutMs, (signal) =>
          deps.provider.readIdentity({
            connected_account_id: a.connection_id!,
            project_id: a.config.project_id,
            auth_config_id: a.config.auth_config_id,
            owner_id: a.config.owner_id,
            signal,
          }),
        );
        const facts = connectIdentitySchema.safeParse(raw);
        if (!facts.success) throw unavailable();
        identity = facts.data;
      } catch {
        await release(claimed);
        await residual(
          claimed,
          "verification_unavailable",
          claimed.snapshot.attempt.connection_id!,
        );
        throw unavailable();
      }
      try {
        claimed = await fresh(claimed);
      } catch (error) {
        await residual(
          claimed,
          "late_result",
          claimed.snapshot.attempt.connection_id!,
        );
        await release(claimed);
        throw error;
      }
      const a = claimed.snapshot.attempt;
      const matches =
        identity.connected_account_id === a.connection_id &&
        identity.project_id === a.config.project_id &&
        identity.auth_config_id === a.config.auth_config_id &&
        identity.owner_id === a.config.owner_id &&
        identity.primary_email.toLowerCase() === a.expected_mailbox_email &&
        identity.toolkit === "gmail" &&
        identity.active;
      if (!matches) {
        try {
          const rejected = snapshot(
            await deps.store.reject({
              command: claimed.storeCommand,
              lease: claimed.lease,
              reason: "identity_mismatch",
            }),
          );
          stable(a, rejected.attempt);
          if (rejected.attempt.state !== "rejected") throw unavailable();
        } catch {
          await residual(claimed, "verification_unavailable", a.connection_id!);
          throw unavailable();
        }
        throw new ConnectError("CONNECT_IDENTITY_MISMATCH");
      }
      try {
        const saved = snapshot(
          await deps.store.finishIdentity({
            command: claimed.storeCommand,
            lease: claimed.lease,
            identity,
          }),
        );
        stable(a, saved.attempt);
        if (
          !["awaiting_brand", "ready_to_register"].includes(
            saved.attempt.state,
          ) ||
          saved.attempt.phase ||
          saved.attempt.connection_id !== a.connection_id
        )
          throw unavailable();
        return await reply({ ...claimed, snapshot: saved });
      } catch {
        await residual(claimed, "verification_unavailable", a.connection_id!);
        throw unavailable();
      }
    },

    async cancel(value: unknown) {
      const c = await command("cancel", request(value));
      const old = await replay(c);
      if (old) return old;
      if (closed(c.snapshot.attempt)) throw new ConnectError("CONNECT_CLOSED");
      try {
        const cancelled = snapshot(await deps.store.cancel(c.storeCommand));
        stable(c.snapshot.attempt, cancelled.attempt);
        if (
          cancelled.attempt.state !== "cancelled" ||
          cancelled.attempt.phase ||
          cancelled.attempt.navigation
        )
          throw unavailable();
        return await reply({ ...c, snapshot: cancelled });
      } catch (error) {
        if (error instanceof ConnectError && error.code === "CONNECT_CONFLICT")
          throw new ConnectError("CONNECT_CONFLICT");
        throw unavailable();
      }
    },

    async register(value: unknown) {
      const c = await command("register", request(value));
      const old = await replay(c);
      if (old) return old;
      if (closed(c.snapshot.attempt)) throw new ConnectError("CONNECT_CLOSED");
      if (
        c.snapshot.attempt.state !== "ready_to_register" ||
        c.snapshot.attempt.phase
      )
        throw new ConnectError("CONNECT_NOT_READY");
      const result = await claim(c, "registration");
      if ("replay" in result) return result.replay;
      let claimed: Claimed;
      try {
        claimed = await fresh(result);
      } catch (error) {
        await release(result);
        throw error;
      }
      try {
        const saved = snapshot(
          await deps.store.registerCandidate({
            command: claimed.storeCommand,
            lease: claimed.lease,
          }),
        );
        stable(claimed.snapshot.attempt, saved.attempt);
        if (
          saved.attempt.state !== "completed" ||
          !saved.attempt.binding_id ||
          saved.attempt.connection_id !== claimed.snapshot.attempt.connection_id
        )
          throw unavailable();
        return await reply({ ...claimed, snapshot: saved });
      } catch {
        throw unavailable();
      }
    },
  };
}
