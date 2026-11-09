import { z } from "zod";
import {
  ConnectError,
  connectBindingSchema,
  connectClaimSchema,
  connectConfigSchema,
  connectIdentitySchema,
  connectLeaseSchema,
  connectLinkSchema,
  connectReceiptSchema,
  connectSnapshotSchema,
  type ConnectAuthority,
  type ConnectConfig,
  type ConnectStore,
  type ConnectStoreCommand,
} from "../../../composio-connect";
import {
  connectAuthority,
  connectDigest,
  currentConnectSession,
  sameConnectDigest,
} from "./session";
import {
  validateConnectProviderConfiguration,
  connectProviderConfigSchema,
} from "./config";
import type { ConnectSecrets } from "./secrets";

export interface ConnectRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface ConnectStoreOptions {
  human: ConnectRpcClient;
  service: ConnectRpcClient;
  secrets: ConnectSecrets;
  session: () => Promise<unknown>;
  now: () => number;
  uuid: () => string;
  proof: () => string;
  configuration: (config: ConnectConfig) => unknown;
}
const nonce = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  digest = z.string().regex(/^[a-f0-9]{64}$/),
  revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const authoritySchema = connectBindingSchema.omit({ state_hash: true });
const commandSchema = z.strictObject({
  attempt_id: z.uuid(),
  expected_revision: revision,
  idempotency_key: z.uuid(),
  fingerprint: digest,
  command: z.enum(["start", "callback", "cancel", "register"]),
  authority: authoritySchema,
  expected_context_hash: digest,
});
const ticketSchema = z.strictObject({ id: z.uuid(), proof: nonce });
const viewSchema = z.strictObject({
  snapshot: z.strictObject({
    attempt: z.record(z.string(), z.unknown()),
    current_context_hash: digest,
  }),
  descriptor: connectProviderConfigSchema,
  state_ciphertext: z.string().max(12000).nullable(),
  navigation_ciphertext: z.string().max(12000).nullable(),
  navigation_expires_ms: revision.nullable(),
  review_id: z.uuid().nullable(),
});
export const connectIntentSchema = z
  .strictObject({
    attempt_id: z.uuid(),
    idempotency_key: z.uuid(),
    browser_proof: nonce,
    callback_state: nonce,
    mode: z.enum(["new", "existing", "reconnect"]),
    email: z.email().max(254).optional(),
    organization: z.string().min(1).max(100).optional(),
    account_id: z.uuid().optional(),
    brand_id: z.uuid(),
    expected_brand_revision: revision,
    expected_account_revision: revision,
    expected_head_revision: revision,
    expected_config_generation: revision.min(1),
  })
  .superRefine((v, ctx) => {
    if (
      v.mode === "new"
        ? !v.email ||
          v.email !== v.email.trim().toLowerCase() ||
          !v.organization ||
          v.account_id !== undefined
        : v.account_id === undefined ||
          v.email !== undefined ||
          v.organization !== undefined
    )
      ctx.addIssue({ code: "custom", message: "Invalid intent" });
  });
const unavailable = () => new ConnectError("CONNECT_UNAVAILABLE");
const codes = new Set([
  "CONNECT_INVALID_INPUT",
  "CONNECT_FORBIDDEN",
  "CONNECT_NOT_FOUND",
  "CONNECT_STALE",
  "CONNECT_CONFLICT",
  "CONNECT_CLOSED",
  "CONNECT_NOT_READY",
  "CONNECT_UNAVAILABLE",
  "CONNECT_IDENTITY_MISMATCH",
  "CONNECT_NEEDS_RECONCILIATION",
]);

// Narrow RPC clients are injected; the constructor never creates a client, reads env or contacts a provider.
export function createConnectStore(options: ConnectStoreOptions) {
  if (
    !options ||
    typeof options.human?.rpc !== "function" ||
    typeof options.service?.rpc !== "function" ||
    typeof options.secrets?.seal !== "function" ||
    typeof options.secrets?.open !== "function" ||
    [
      options.session,
      options.now,
      options.uuid,
      options.proof,
      options.configuration,
    ].some((f) => typeof f !== "function")
  )
    throw unavailable();
  const { human, service, secrets } = options;
  async function rpc(
    client: ConnectRpcClient,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    let result: { data: unknown; error: unknown };
    try {
      result = await client.rpc(name, args);
    } catch {
      throw unavailable();
    }
    if (!result || typeof result !== "object") throw unavailable();
    if (result.error) {
      const message = (result.error as { message?: unknown }).message;
      if (typeof message === "string" && codes.has(message))
        throw new ConnectError(
          message as ConstructorParameters<typeof ConnectError>[0],
        );
      throw unavailable();
    }
    return result.data;
  }
  function bounded(value: unknown) {
    const encoded = JSON.stringify(value);
    if (!encoded || Buffer.byteLength(encoded) > 65536) throw unavailable();
    return JSON.parse(encoded);
  }
  async function execute(
    operation: string,
    p: Record<string, unknown>,
    negative = false,
  ): Promise<unknown> {
    const payload = bounded(p);
    if (negative)
      return rpc(service, "composio_connect_runtime_ledger", {
        operation,
        p: payload,
      });
    const ticket = ticketSchema.safeParse(
      await rpc(human, "composio_connect_runtime_authorize", {
        operation,
        p: payload,
      }),
    );
    if (!ticket.success) throw unavailable();
    return rpc(service, "composio_connect_runtime_execute", {
      operation,
      p: payload,
      ticket: ticket.data,
    });
  }
  function project(value: unknown) {
    const parsed = viewSchema.safeParse(value);
    if (!parsed.success) throw unavailable();
    const raw = parsed.data;
    const a = raw.snapshot.attempt;
    const config = connectConfigSchema.safeParse(a.config),
      id = z.uuid().safeParse(a.id);
    if (!config.success || !id.success) throw unavailable();
    const descriptor = validateConnectProviderConfiguration(
      options.configuration(config.data),
      raw.descriptor,
    );
    if (JSON.stringify(descriptor.config) !== JSON.stringify(config.data))
      throw unavailable();
    const context = { attempt_id: id.data, generation: config.data.generation };
    const navigation =
      raw.navigation_ciphertext === null
        ? null
        : {
            url: secrets.open(raw.navigation_ciphertext, {
              ...context,
              slot: "navigation",
            }),
            expires_at_ms: raw.navigation_expires_ms,
          };
    const snapshot = connectSnapshotSchema.safeParse({
      ...raw.snapshot,
      attempt: { ...a, navigation },
    });
    if (!snapshot.success) throw unavailable();
    return {
      snapshot: snapshot.data,
      descriptor,
      review_id: raw.review_id,
      state_ciphertext: raw.state_ciphertext,
    };
  }
  const cmd = (value: unknown) => {
    const parsed = commandSchema.safeParse(value);
    if (!parsed.success) throw unavailable();
    return parsed.data;
  };
  async function view(operation: string, p: Record<string, unknown>) {
    return project(await execute(operation, p));
  }
  const leasePayload = (value: unknown) => {
    const { callback_state: _state, ...lease } =
      connectLeaseSchema.parse(value);
    return lease;
  };
  const store: ConnectStore = {
    async load(input) {
      const authority = authoritySchema.parse(input.authority);
      return (
        await view("load", {
          attempt_id: z.uuid().parse(input.attempt_id),
          authority,
        })
      ).snapshot;
    },
    async lookupReceipt(input) {
      const result = connectReceiptSchema.safeParse(
        await execute("receipt", { command: cmd(input) }),
      );
      if (!result.success) throw unavailable();
      return result.data;
    },
    async claimPhase(input) {
      const { phase: requestedPhase, ...baseCommand } = input;
      const command = cmd(baseCommand);
      const phase = z
        .enum(["link", "identity", "registration"])
        .parse(requestedPhase);
      const material = {
        id: z.uuid().parse(options.uuid()),
        kind: phase,
        capability: nonce.parse(options.proof()),
      };
      const raw = await execute("claim", {
        command,
        phase,
        phase_id: material.id,
        capability_hash: connectDigest(material.capability),
      });
      const result = z
        .discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("claimed"),
            view: z.unknown(),
            lease: connectLeaseSchema.omit({
              capability: true,
              callback_state: true,
            }),
          }),
          z.strictObject({ kind: z.literal("replay") }),
          z.strictObject({ kind: z.literal("conflict") }),
        ])
        .safeParse(raw);
      if (!result.success) throw unavailable();
      if (result.data.kind !== "claimed") return result.data;
      const data = project(result.data.view);
      const lease = connectLeaseSchema.safeParse({
        ...result.data.lease,
        capability: material.capability,
        callback_state:
          phase === "link" && data.state_ciphertext
            ? secrets.open(data.state_ciphertext, {
                attempt_id: command.attempt_id,
                generation: data.snapshot.attempt.config.generation,
                slot: "state",
              })
            : null,
      });
      if (
        !lease.success ||
        lease.data.id !== material.id ||
        lease.data.kind !== phase ||
        lease.data.fingerprint !== command.fingerprint ||
        lease.data.revision !== data.snapshot.attempt.revision ||
        (phase === "link" &&
          (!lease.data.callback_state ||
            !sameConnectDigest(
              lease.data.callback_state,
              data.snapshot.attempt.binding.state_hash,
            )))
      )
        throw unavailable();
      return connectClaimSchema.parse({
        kind: "claimed",
        snapshot: data.snapshot,
        lease: lease.data,
      });
    },
    async saveLink(input) {
      const command = cmd(input.command),
        lease = leasePayload(input.lease),
        link = connectLinkSchema.parse(input.link);
      const loaded = await view("load", {
        attempt_id: command.attempt_id,
        authority: command.authority,
      });
      const ciphertext = secrets.seal(link.url, {
        attempt_id: command.attempt_id,
        generation: loaded.snapshot.attempt.config.generation,
        slot: "navigation",
      });
      return (
        await view("save", {
          command,
          lease,
          link: {
            connected_account_id: link.connected_account_id,
            expires_at_ms: link.expires_at_ms,
          },
          navigation_ciphertext: ciphertext,
          deadline_ms: revision.parse(input.deadline_ms),
        })
      ).snapshot;
    },
    async finishIdentity(input) {
      return (
        await view("identity", {
          command: cmd(input.command),
          lease: leasePayload(input.lease),
          identity: connectIdentitySchema.parse(input.identity),
        })
      ).snapshot;
    },
    async releaseClaim(input) {
      await execute(
        "release",
        {
          command: cmd(input.command),
          lease: leasePayload(input.lease),
        },
        true,
      );
    },
    async reject(input) {
      return (
        await view("reject", {
          command: cmd(input.command),
          ...(input.lease ? { lease: leasePayload(input.lease) } : {}),
          reason: z
            .enum(["provider_cancelled", "identity_mismatch"])
            .parse(input.reason),
        })
      ).snapshot;
    },
    async cancel(input) {
      return (await view("cancel", { command: cmd(input) })).snapshot;
    },
    async registerCandidate(input) {
      const p = {
        command: cmd(input.command),
        lease: leasePayload(input.lease),
      };
      const grant = ticketSchema.safeParse(await execute("register", p));
      if (!grant.success) throw unavailable();
      return project(
        await rpc(human, "composio_connect_runtime_register", {
          operation: "register",
          p: bounded(p),
          ticket: grant.data,
        }),
      ).snapshot;
    },
    async markUncertain(input) {
      await execute(
        "uncertain",
        {
          attempt_id: z.uuid().parse(input.attempt_id),
          lease: leasePayload(input.lease),
          reason: z
            .enum(["provider_unknown", "save_failed"])
            .parse(input.reason),
          observed_connection_id: input.observed_connection_id,
        },
        true,
      );
    },
    async recordResidual(input) {
      await execute(
        "residual",
        {
          attempt_id: z.uuid().parse(input.attempt_id),
          lease: leasePayload(input.lease),
          reason: z
            .enum(["late_result", "verification_unavailable"])
            .parse(input.reason),
          connection_id: input.connection_id,
        },
        true,
      );
    },
  };
  // Normalize all port failures, including thrown parse/dependency errors. Never propagate an arbitrary dependency Error instance.
  const safeStore = Object.fromEntries(
    Object.entries(store).map(([name, fn]) => [
      name,
      async (...args: unknown[]) => {
        try {
          return await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
        } catch (e) {
          if (e instanceof ConnectError && codes.has(e.code))
            throw new ConnectError(e.code);
          throw unavailable();
        }
      },
    ]),
  ) as unknown as ConnectStore;
  return {
    store: safeStore,
    // Coordinator additive read: same authorized projection; no new SQL or approval path.
    async inspectIntent(input: {
      attempt_id: string;
      authority: ConnectAuthority;
    }) {
      try {
        const result = await view("load", {
          attempt_id: z.uuid().parse(input.attempt_id),
          authority: authoritySchema.parse(input.authority),
        });
        return { snapshot: result.snapshot, review_id: result.review_id };
      } catch (e) {
        if (e instanceof ConnectError && codes.has(e.code))
          throw new ConnectError(e.code);
        throw unavailable();
      }
    },
    async beginIntent(value: unknown) {
      try {
        const input = connectIntentSchema.parse(value),
          session = currentConnectSession(
            await options.session(),
            options.now(),
          );
        const { browser_proof, callback_state, ...intent } = input;
        const raw = await execute("begin", {
          attempt_id: input.attempt_id,
          authority: connectAuthority(session, browser_proof),
          intent,
          state_hash: connectDigest(callback_state),
          state_ciphertext: secrets.seal(callback_state, {
            attempt_id: input.attempt_id,
            generation: input.expected_config_generation,
            slot: "state",
          }),
          capability_hash: connectDigest(nonce.parse(options.proof())),
        });
        const data = project(raw);
        return { snapshot: data.snapshot, review_id: data.review_id };
      } catch (e) {
        if (e instanceof ConnectError && codes.has(e.code))
          throw new ConnectError(e.code);
        throw unavailable();
      }
    },
    async adoptBrand(command: ConnectStoreCommand, reviewId: string) {
      try {
        return (
          await view("adopt", {
            command: cmd(command),
            review_id: z.uuid().parse(reviewId),
          })
        ).snapshot;
      } catch (e) {
        if (e instanceof ConnectError && codes.has(e.code))
          throw new ConnectError(e.code);
        throw unavailable();
      }
    },
    async bindConfiguration(input: {
      attempt_id: string;
      authority: ConnectAuthority;
    }) {
      try {
        return (
          await view("load", {
            attempt_id: z.uuid().parse(input.attempt_id),
            authority: authoritySchema.parse(input.authority),
          })
        ).descriptor;
      } catch (e) {
        if (e instanceof ConnectError && codes.has(e.code))
          throw new ConnectError(e.code);
        throw unavailable();
      }
    },
  };
}
