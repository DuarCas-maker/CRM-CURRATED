import { AsyncLocalStorage } from "node:async_hooks";
import { TransportSelectionError } from "./selection";

export type MailboxScope = Readonly<{
  account: string;
  revision: number;
  cycle?: string;
  capability?: string;
  directOnly?: boolean;
  validate(): Promise<boolean>;
}>;
const scopes = new AsyncLocalStorage<MailboxScope>();
export const mailboxScope = () => scopes.getStore();
export function withMailboxScope<T>(
  scope: MailboxScope,
  action: () => Promise<T>,
) {
  if (scopes.getStore()) throw new TransportSelectionError("R06_DENIED");
  return scopes.run(Object.freeze({ ...scope }), action);
}
export async function validateMailboxScope() {
  const scope = scopes.getStore();
  if (scope && !(await scope.validate()))
    throw new TransportSelectionError("R06_DENIED");
}
