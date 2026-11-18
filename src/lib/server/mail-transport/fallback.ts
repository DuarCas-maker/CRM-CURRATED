import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ticketSchema,
  TransportSelectionError,
  type TransportTicket,
} from "./selection";
import type { PreparedGmailTransport } from "./contract";
import type { MailQuotaLease } from "../mail-quota";

export const fallbackSnapshot = z.strictObject({
  ticket: ticketSchema,
  context_hash: z.string().regex(/^[a-f0-9]{64}$/),
  config_generation: z.number().int().positive(),
  project_id: z.string(),
});
export type FallbackSnapshot = z.infer<typeof fallbackSnapshot>;
export type FallbackPorts = {
  begin(
    parent: string,
    parentCapability: string,
    hash: string,
  ): Promise<unknown>;
  validate(id: string, capability: string, admit: boolean): Promise<boolean>;
  prepare(
    snapshot: FallbackSnapshot,
    validate: () => Promise<void>,
  ): Promise<PreparedGmailTransport>;
  quota(ticket: TransportTicket): Promise<void | MailQuotaLease>;
  beforeRequest(): Promise<void>;
  record(id: string, capability: string): void;
  finish(
    id: string,
    capability: string,
    outcome: "cancelled_before_wire" | "uncertain",
  ): Promise<void>;
  now(): number;
};
// Parent is durably cancelled before wire. No recursive retry of a failed child.
export async function executeFallback<T>(
  parent: TransportTicket,
  parentCapability: string,
  path: string,
  init: RequestInit,
  ports: FallbackPorts,
): Promise<T> {
  const capability = randomBytes(32).toString("hex");
  let ticket: TransportTicket | undefined,
    admitted = false;
  try {
    const snapshot = fallbackSnapshot.parse(
      await ports.begin(
        parent.id,
        parentCapability,
        createHash("sha256").update(capability).digest("hex"),
      ),
    );
    ticket = snapshot.ticket;
    if (
      ticket.provider !== "composio" ||
      ticket.operation !== "send" ||
      ticket.account_id !== parent.account_id ||
      ticket.resource !== parent.resource ||
      ticket.revision !== parent.revision ||
      !ticket.binding ||
      ticket.id === parent.id
    )
      throw new TransportSelectionError("R06_DENIED");
    const validate = async () => {
      if (
        !ticket ||
        ports.now() >= Date.parse(ticket.deadline) ||
        !(await ports.validate(ticket.id, capability, false))
      )
        throw new TransportSelectionError("R06_DENIED");
    };
    await validate();
    const transport = await ports.prepare(snapshot, validate);
    if (transport.provider !== "composio")
      throw new TransportSelectionError("R06_DENIED");
    const lease = await ports.quota(ticket);
    await ports.beforeRequest();
    await validate();
    ports.record(ticket.id, capability);
    if (!(await ports.validate(ticket.id, capability, true)))
      throw new TransportSelectionError("R06_DENIED");
    admitted = true;
    const send = () => transport.execute<T>({ path, init });
    return lease ? await lease.emit(send) : await send();
  } catch (error) {
    if (ticket) {
      try {
        await ports.finish(
          ticket.id,
          capability,
          admitted ? "uncertain" : "cancelled_before_wire",
        );
      } catch {
        throw new TransportSelectionError("R06_UNCERTAIN", true);
      }
    }
    if (admitted) throw new TransportSelectionError("R06_UNCERTAIN", true);
    throw error;
  }
}
