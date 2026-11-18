import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { HttpError } from "../../supabase";
import { simpleMailEnabled } from "../../../mail-connections";
type IncludedScope = {
  account: string | null;
  reserve(
    key: string,
    account: string | null,
    proxy: boolean,
  ): Promise<boolean>;
};
const scopes = new AsyncLocalStorage<IncludedScope>();
export const withIncludedUsage = <T>(
  scope: IncludedScope,
  action: () => Promise<T>,
) => scopes.run(scope, action);
// Called at the actual HTTP boundary, once for every attempt including retries.
export async function includedComposioFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch = fetch,
) {
  const scope = scopes.getStore();
  if (!scope && simpleMailEnabled())
    throw new HttpError(409, "SIMPLE_INCLUDED_UNAVAILABLE");
  if (scope) {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    if (url.origin !== "https://backend.composio.dev")
      throw new HttpError(409, "SIMPLE_INCLUDED_UNAVAILABLE");
    if (
      !(await scope.reserve(
        randomUUID(),
        scope.account,
        url.pathname.endsWith("/tools/execute/proxy"),
      ))
    )
      throw new HttpError(409, "SIMPLE_INCLUDED_UNAVAILABLE");
  }
  return fetchImpl(input, init);
}
