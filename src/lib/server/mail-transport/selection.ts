import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  transportRequest,
  transportProvider,
  transportRevision,
  type TransportRequest,
} from "../../mail-transport-selection";
import type { ResolvedComposioBinding } from "./contract";

const binding = z
  .strictObject({
    accountId: z.uuid(),
    connectedAccountId: z.string().regex(/^ca_[A-Za-z0-9_-]{1,128}$/),
    authConfigId: z.string().regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
    userId: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[^\s\x00-\x1f\x7f]+$/),
    mailboxEmail: z.email().max(254),
    verifiedMailboxEmail: z.email().max(254),
    identityVerified: z.literal(true),
    status: z.literal("active"),
    revision: transportRevision.min(1),
    quotaProjectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  })
  .superRefine((b, c) => {
    if (b.mailboxEmail.toLowerCase() !== b.verifiedMailboxEmail.toLowerCase())
      c.addIssue({ code: "custom", message: "Identity mismatch" });
  });
const ticketSchema = z
  .strictObject({
    id: z.uuid(),
    account_id: z.uuid(),
    provider: transportProvider,
    revision: transportRevision,
    operation: transportRequest.shape.operation,
    resource: z.string(),
    deadline: z.iso.datetime({ offset: true }),
    binding: binding.nullable(),
  })
  .superRefine((t, c) => {
    if (
      (t.provider === "composio") !== (t.binding !== null) ||
      (t.binding && t.binding.accountId !== t.account_id) ||
      (t.provider === "composio" && ["watch", "stop"].includes(t.operation))
    )
      c.addIssue({ code: "custom", message: "Invalid provider context" });
  });
export type TransportTicket = z.infer<typeof ticketSchema>;
export type SelectionPorts = {
  acquire(input: TransportRequest, capabilityHash: string): Promise<unknown>;
  validate(ticket: TransportTicket, capability: string): Promise<boolean>;
  beforeCredential(ticket: TransportTicket): Promise<void>;
  prepareDirect(ticket: TransportTicket): Promise<unknown>;
  prepareComposio(
    ticket: TransportTicket,
    binding: ResolvedComposioBinding,
  ): Promise<unknown>;
  quota(ticket: TransportTicket): Promise<void>;
  beforeRequest(ticket: TransportTicket): Promise<void>;
  admit(ticket: TransportTicket, capability: string): Promise<boolean>;
  execute<T>(ticket: TransportTicket, prepared: unknown): Promise<T>;
  finish(
    ticket: TransportTicket,
    capability: string,
    outcome:
      "finished" | "cancelled_before_wire" | "uncertain" | "known_rejection",
  ): Promise<void>;
  // Server-only lifecycle hooks. Default I01 semantics remain unchanged.
  deferCompletion?: (ticket: TransportTicket) => boolean;
  safeError?: (error: unknown) => Error | null;
  now(): number;
};
export class TransportSelectionError extends Error {
  constructor(
    public readonly code:
      "R06_INVALID_INPUT" | "R06_UNAVAILABLE" | "R06_DENIED" | "R06_UNCERTAIN",
    public readonly deliveryUncertain = false,
  ) {
    super(code);
    this.name = "TransportSelectionError";
  }
}

// Injectable only: no route/worker caller, environment access, HTTP, SDK or live store.
export async function executeSelectedTransport<T>(
  input: unknown,
  ports: SelectionPorts,
): Promise<T> {
  const parsed = transportRequest.safeParse(input);
  if (!parsed.success) throw new TransportSelectionError("R06_INVALID_INPUT");
  const capability = randomBytes(32).toString("hex");
  const capabilityHash = createHash("sha256").update(capability).digest("hex");
  let ticket: TransportTicket | undefined,
    admitted = false;
  try {
    const raw = ticketSchema.safeParse(
      await ports.acquire(parsed.data, capabilityHash),
    );
    if (!raw.success) throw new TransportSelectionError("R06_UNAVAILABLE");
    ticket = Object.freeze({
      ...raw.data,
      binding: raw.data.binding ? Object.freeze({ ...raw.data.binding }) : null,
    });
    const alive = () =>
      Number.isFinite(ports.now()) &&
      Date.parse(ticket!.deadline) > ports.now();
    if (
      ticket.account_id !== parsed.data.account_id ||
      ticket.revision !== parsed.data.expected_revision ||
      ticket.operation !== parsed.data.operation ||
      ticket.resource !== parsed.data.resource
    )
      throw new TransportSelectionError("R06_DENIED");
    if (!alive() || !(await ports.validate(ticket, capability)))
      throw new TransportSelectionError("R06_DENIED");
    await ports.beforeCredential(ticket);
    if (!alive() || !(await ports.validate(ticket, capability)))
      throw new TransportSelectionError("R06_DENIED");
    const prepared =
      ticket.provider === "gmail_oauth"
        ? await ports.prepareDirect(ticket)
        : await ports.prepareComposio(ticket, ticket.binding!);
    await ports.quota(ticket);
    await ports.beforeRequest(ticket);
    if (!alive() || !(await ports.admit(ticket, capability)))
      throw new TransportSelectionError("R06_DENIED");
    admitted = true;
    const result = await ports.execute<T>(ticket, prepared);
    if (!ports.deferCompletion?.(ticket))
      await ports.finish(ticket, capability, "finished");
    return result;
  } catch (error) {
    if (ticket) {
      try {
        await ports.finish(
          ticket,
          capability,
          admitted ? "uncertain" : "cancelled_before_wire",
        );
      } catch {
        /* Durable unresolved reservation must block transition; never retry. */
      }
    }
    const safe = ports.safeError?.(error);
    if (safe) throw safe;
    if (admitted)
      throw new TransportSelectionError(
        "R06_UNCERTAIN",
        parsed.data.operation === "send",
      );
    if (error instanceof TransportSelectionError) throw error;
    throw new TransportSelectionError("R06_UNAVAILABLE");
  }
}
