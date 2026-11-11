import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import {
  transportProvider,
  transportRevision,
  type TransportRequest,
} from "../../mail-transport-selection";
import {
  verificationContextSchema,
  verificationContextHash,
} from "./verification-context";
import {
  executeSelectedTransport,
  TransportSelectionError,
  type SelectionPorts,
  type TransportTicket,
} from "./selection";
import { createMailTransport } from "./factory";
import {
  verificationContextV2Schema,
  verificationContextV2Hash,
} from "./verification-context-v2";
import { GmailError } from "../../gmail-errors";
import { MailTransportError } from "./errors";
import {
  authorizeWorkerRequest,
  inWorkerPilot,
  WorkerPilotError,
} from "../worker-request-control";
import type { PreparedGmailTransport } from "./contract";
import { mailboxScope, validateMailboxScope } from "./mailbox-context";
import {
  mailQuotaEnabled,
  recheckMailQuotaEmission,
  MailQuotaError,
  type MailQuotaLease,
} from "../mail-quota";

export const composioProductOperationEnabled = false;
export function productRoutingEnabled() {
  const value = process.env.MAIL_TRANSPORT_ROUTING_ENABLED ?? "false";
  if (value !== "true" && value !== "false")
    throw new TransportSelectionError("R06_UNAVAILABLE");
  return value === "true";
}
export type RuntimeDependencies = {
  rpc(name: string, input: Record<string, unknown>): Promise<unknown>;
  composioEnabled: boolean;
  configuration(): unknown;
  fetchImpl: typeof fetch;
  now(): number;
};
const contexts = new AsyncLocalStorage<RuntimeDependencies>();
type Dispatch = {
  runtime: RuntimeDependencies;
  account: string;
  outbox: string;
  records: Map<string, string>;
  used: boolean;
};
const dispatches = new AsyncLocalStorage<Dispatch>();
export function withMailRuntime<T>(
  runtime: RuntimeDependencies,
  action: () => Promise<T>,
): Promise<T> {
  return contexts.run(Object.freeze({ ...runtime }), action);
}
export function mailRoutingActive() {
  return !!contexts.getStore() || productRoutingEnabled();
}
export async function mailRuntimeDependencies() {
  const current = contexts.getStore();
  if (current) return current;
  if (!productRoutingEnabled()) throw new TransportSelectionError("R06_DENIED");
  const { serviceMailRuntime } = await import("./runtime-service");
  return serviceMailRuntime();
}
export function withMailDispatch<T>(
  account: string,
  outbox: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!mailRoutingActive()) return action();
  return dispatch(account, outbox, action);
}
async function dispatch<T>(
  account: string,
  outbox: string,
  action: () => Promise<T>,
) {
  if (
    !z.uuid().safeParse(account).success ||
    !z.uuid().safeParse(outbox).success ||
    dispatches.getStore()
  )
    throw new TransportSelectionError("R06_DENIED");
  const deps = await mailRuntimeDependencies(),
    frame: Dispatch = {
      runtime: deps,
      account,
      outbox,
      records: new Map(),
      used: false,
    };
  return withMailRuntime(deps, () =>
    dispatches.run(frame, async () => {
      try {
        return await action();
      } finally {
        let failed = false;
        for (const [attempt, capability] of frame.records) {
          try {
            const outcome = await deps.rpc("mail_transport_settle_dispatch", {
              attempt,
              capability,
            });
            if (
              ![
                "finished",
                "known_rejection",
                "cancelled_before_wire",
              ].includes(String(outcome))
            )
              failed = true;
          } catch {
            failed = true;
          }
        }
        if (failed) throw new TransportSelectionError("R06_UNCERTAIN", true);
      }
    }),
  );
}
const snapshotBase = z.strictObject({
  account_id: z.uuid(),
  provider: transportProvider,
  revision: transportRevision,
  verification_context_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  config_generation: transportRevision,
  project_id: z.string().nullable(),
  auth_config_id: z.string().nullable(),
  quota_project_id: z.string().nullable(),
});
const snapshotSchema = z.union([
  snapshotBase.extend({ quota_contract_version: z.literal(1).optional() }),
  snapshotBase.extend({
    quota_contract_version: z.literal(2),
    quota_project_id: z.null(),
    quota_policy_id: z.uuid(),
    quota_policy_generation: z.number().int().positive().safe(),
  }),
]);
const configurationSchema = z.strictObject({
  context: z.union([verificationContextSchema, verificationContextV2Schema]),
  apiKey: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\s\x00-\x1f\x7f]+$/),
});
export type RuntimeRequest = {
  account: string;
  path: string;
  init: RequestInit;
  beforeRequest?: () => Promise<void>;
};
export type DirectPreparation = {
  transport: PreparedGmailTransport;
  quotaProjectId: string | null;
};
export type RuntimeCallbacks = {
  direct(): Promise<DirectPreparation>;
  quota(
    project: string | undefined,
    ticket?: TransportTicket,
  ): Promise<void | MailQuotaLease>;
};

function requestScope(
  input: RuntimeRequest,
): Omit<TransportRequest, "expected_revision"> {
  if (!z.uuid().safeParse(input.account).success)
    throw new TransportSelectionError("R06_INVALID_INPUT");
  const { account, path, init } = input,
    method = init.method ?? "GET",
    part = path.split("?")[0],
    frame = dispatches.getStore();
  let operation: TransportRequest["operation"], resource: string;
  if (method === "POST" && path === "messages/send") {
    if (!frame || frame.account !== account || frame.used)
      throw new TransportSelectionError("R06_DENIED");
    frame.used = true;
    operation = "send";
    resource = frame.outbox;
  } else if (
    method === "GET" &&
    ["profile", "history", "messages"].includes(part)
  ) {
    operation = part as "profile" | "history" | "messages";
    resource = part;
  } else if (method === "GET" && /^messages\/[a-f0-9]+$/i.test(part)) {
    operation = "message";
    resource = part.slice(9);
  } else if (method === "GET" && /^threads\/[a-f0-9]+$/i.test(part)) {
    operation = "thread";
    resource = part.slice(8);
  } else if (
    method === "GET" &&
    /^messages\/[a-f0-9]+\/attachments\/[A-Za-z0-9_-]+$/i.test(part)
  ) {
    const p = part.split("/");
    operation = "attachment";
    resource = p[1] + ":" + p[3];
  } else if (method === "GET" && part.startsWith("settings/sendAs/")) {
    operation = "signature";
    try {
      resource = decodeURIComponent(part.slice(16));
    } catch {
      throw new TransportSelectionError("R06_INVALID_INPUT");
    }
  } else if (method === "POST" && ["watch", "stop"].includes(part)) {
    operation = part as "watch" | "stop";
    resource = part;
  } else throw new TransportSelectionError("R06_INVALID_INPUT");
  return { account_id: account, operation, resource };
}
function safeError(error: unknown): Error | null {
  return error instanceof GmailError ||
    error instanceof MailTransportError ||
    error instanceof WorkerPilotError ||
    error instanceof MailQuotaError
    ? error
    : null;
}
function definiteReadRejection(error: unknown) {
  return (
    (error instanceof GmailError && error.status >= 400) ||
    (error instanceof MailTransportError &&
      [
        "COMPOSIO_AUTH_REJECTED",
        "COMPOSIO_RATE_LIMITED",
        "COMPOSIO_UNAVAILABLE",
        "COMPOSIO_HTTP_REJECTED",
      ].includes(error.code))
  );
}
export async function executeRuntimeMail<T>(
  input: RuntimeRequest,
  callbacks: RuntimeCallbacks,
): Promise<T> {
  const deps = await mailRuntimeDependencies(),
    request = requestScope(input),
    frame = dispatches.getStore();
  let raw;
  try {
    raw = snapshotSchema.safeParse(
      await deps.rpc("mail_transport_snapshot", { account: input.account }),
    );
  } catch {
    throw new TransportSelectionError("R06_UNAVAILABLE");
  }
  if (!raw.success || raw.data.account_id !== input.account)
    throw new TransportSelectionError("R06_UNAVAILABLE");
  const snapshot = Object.freeze(raw.data);
  const scope = mailboxScope();
  if (
    scope &&
    (scope.account !== input.account ||
      scope.revision !== snapshot.revision ||
      (scope.directOnly && snapshot.provider !== "gmail_oauth"))
  )
    throw new TransportSelectionError("R06_DENIED");
  await validateMailboxScope();
  if (snapshot.provider === "composio" && !deps.composioEnabled)
    throw new TransportSelectionError("R06_DENIED");
  let prepared: DirectPreparation | undefined,
    quotaLease: MailQuotaLease | undefined,
    configuration: z.infer<typeof configurationSchema> | undefined,
    lastError: unknown;
  const readConfiguration = () => {
    const config = configurationSchema.safeParse(deps.configuration());
    const context = config.success ? config.data.context : null;
    const v2 = context && "contract_version" in context;
    const validQuota =
      context &&
      (v2
        ? snapshot.quota_contract_version === 2 &&
          mailQuotaEnabled() &&
          context.policy.state === "enabled" &&
          context.policy.policy_id === snapshot.quota_policy_id &&
          context.policy.generation === snapshot.quota_policy_generation
        : snapshot.quota_contract_version !== 2 &&
          context.google_quota_project_id === snapshot.quota_project_id);
    if (
      !config.success ||
      !validQuota ||
      (v2
        ? verificationContextV2Hash(config.data.context)
        : verificationContextHash(config.data.context)) !==
        snapshot.verification_context_hash ||
      config.data.context.composio_project_id !== snapshot.project_id
    )
      throw new TransportSelectionError("R06_DENIED");
    return Object.freeze({
      context: Object.freeze(config.data.context),
      apiKey: config.data.apiKey,
    });
  };
  const validate = (
    ticket: TransportTicket,
    capability: string,
    admit: boolean,
  ) =>
    deps
      .rpc("mail_transport_validate_context", {
        attempt: ticket.id,
        capability,
        context_digest: snapshot.verification_context_hash,
        config_generation: snapshot.config_generation,
        admit,
      })
      .then((v) => v === true);
  const ports: SelectionPorts = {
    acquire: (p, capability_hash) =>
      scope?.cycle
        ? deps.rpc("mail_sync_acquire", {
            cycle: scope.cycle,
            capability: scope.capability,
            operation: p.operation,
            resource: p.resource,
            capability_hash,
          })
        : deps.rpc("mail_transport_acquire", {
            account: p.account_id,
            expected_revision: p.expected_revision,
            operation: p.operation,
            resource: p.resource,
            capability_hash,
          }),
    validate: (ticket, capability) => validate(ticket, capability, false),
    beforeCredential: async (ticket) => {
      await validateMailboxScope();
      if (ticket.provider !== snapshot.provider)
        throw new TransportSelectionError("R06_DENIED");
      if (request.operation === "send") {
        if (!frame || frame.account !== input.account)
          throw new TransportSelectionError("R06_DENIED");
      }
      if (inWorkerPilot())
        await authorizeWorkerRequest(
          ticket.provider,
          input.account,
          input.path,
          input.init.method ?? "GET",
        );
      if (ticket.provider === "composio") configuration = readConfiguration();
    },
    prepareDirect: async () => {
      prepared = await callbacks.direct();
      if (
        prepared.transport.provider !== "gmail_oauth" ||
        !prepared.quotaProjectId
      )
        throw new TransportSelectionError("R06_DENIED");
      return prepared;
    },
    prepareComposio: async (ticket, binding) => {
      if (
        !configuration ||
        binding.authConfigId !== snapshot.auth_config_id ||
        binding.quotaProjectId !== snapshot.quota_project_id ||
        (snapshot.quota_contract_version === 2
          ? binding.quotaContractVersion !== 2 ||
            binding.quotaPolicyId !== snapshot.quota_policy_id ||
            binding.quotaPolicyGeneration !== snapshot.quota_policy_generation
          : binding.quotaContractVersion === 2)
      )
        throw new TransportSelectionError("R06_DENIED");
      const guardedFetch: typeof fetch = async (input, init) => {
        await validateMailboxScope();
        const current = readConfiguration();
        if (current.apiKey !== configuration!.apiKey)
          throw new TransportSelectionError("R06_DENIED");
        recheckMailQuotaEmission();
        return deps.fetchImpl(input, init);
      };
      prepared = {
        transport: createMailTransport({
          provider: "composio",
          apiKey: configuration.apiKey,
          binding,
          fetchImpl: guardedFetch,
        }),
        quotaProjectId: binding.quotaProjectId,
      };
      return prepared;
    },
    quota: async (ticket) => {
      if (
        !prepared ||
        (!prepared.quotaProjectId && snapshot.quota_contract_version !== 2)
      )
        throw new TransportSelectionError("R06_UNAVAILABLE");
      quotaLease =
        (await callbacks.quota(prepared.quotaProjectId ?? undefined, ticket)) ??
        undefined;
      if (mailQuotaEnabled() && !quotaLease)
        throw new MailQuotaError("QGR_DENIED");
    },
    beforeRequest: async () => {
      if (configuration) {
        const current = readConfiguration();
        if (current.apiKey !== configuration.apiKey)
          throw new TransportSelectionError("R06_DENIED");
      }
      await input.beforeRequest?.();
      await validateMailboxScope();
    },
    admit: async (ticket, capability) => {
      if (configuration && readConfiguration().apiKey !== configuration.apiKey)
        throw new TransportSelectionError("R06_DENIED");
      if (request.operation === "send")
        frame!.records.set(ticket.id, capability);
      return validate(ticket, capability, true);
    },
    execute: async <R>(ticket: TransportTicket) => {
      try {
        await validateMailboxScope();
        if (ticket.provider === "gmail_oauth" && inWorkerPilot())
          await authorizeWorkerRequest(
            "gmail_oauth",
            input.account,
            input.path,
            input.init.method ?? "GET",
            true,
          );
        const execute = () =>
          prepared!.transport.execute<R>({
            path: input.path,
            init: input.init,
          });
        return quotaLease ? await quotaLease.emit(execute) : await execute();
      } catch (error) {
        lastError = error;
        throw error;
      }
    },
    finish: (ticket, capability, outcome) =>
      deps
        .rpc("mail_transport_finish", {
          attempt: ticket.id,
          capability,
          outcome:
            outcome === "uncertain" &&
            ticket.operation !== "send" &&
            definiteReadRejection(lastError)
              ? "known_rejection"
              : outcome,
        })
        .then(() => undefined),
    deferCompletion: (ticket) => ticket.operation === "send",
    safeError,
    now: deps.now,
  };
  return executeSelectedTransport<T>(
    { ...request, expected_revision: snapshot.revision },
    ports,
  );
}
