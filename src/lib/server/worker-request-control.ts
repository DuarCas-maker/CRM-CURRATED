import { AsyncLocalStorage } from "node:async_hooks";

export type PilotProvider = "gmail_oauth" | "composio" | "oauth";
export type PilotRequest = Readonly<{
  provider: PilotProvider;
  account: string;
  kind: "send" | "signature" | "thread" | "oauth";
  target: string;
}>;
export type WorkerPilotContext = Readonly<{
  accountId: string;
  outboxId: string;
  provider: Exclude<PilotProvider, "oauth">;
  action: "send" | "thread";
  threadId: string | null;
  authorize: (request: PilotRequest, reserve: boolean) => Promise<boolean>;
}>;
export class WorkerPilotError extends Error {
  constructor() {
    super("WORKER_PILOT_HELD");
  }
}
const contexts = new AsyncLocalStorage<WorkerPilotContext>();
export function inWorkerPilot() {
  return contexts.getStore() !== undefined;
}
export function withWorkerPilot<T>(
  context: WorkerPilotContext,
  action: () => Promise<T>,
): Promise<T> {
  return contexts.run(Object.freeze({ ...context }), action);
}
function requestFor(
  context: WorkerPilotContext,
  provider: PilotProvider,
  account: string,
  path: string,
  method: string,
): PilotRequest {
  if (account !== context.accountId) throw new WorkerPilotError();
  if (provider === "oauth") {
    if (context.provider !== "gmail_oauth") throw new WorkerPilotError();
    return { provider, account, kind: "oauth", target: account };
  }
  if (provider !== context.provider) throw new WorkerPilotError();
  if (
    context.action === "send" &&
    method === "POST" &&
    path === "messages/send"
  )
    return { provider, account, kind: "send", target: context.outboxId };
  if (
    context.action === "send" &&
    method === "GET" &&
    /^settings\/sendAs\/[^?/#]+$/.test(path)
  ) {
    let target: string;
    try {
      target = decodeURIComponent(path.slice("settings/sendAs/".length));
    } catch {
      throw new WorkerPilotError();
    }
    return { provider, account, kind: "signature", target };
  }
  if (
    context.action === "thread" &&
    context.threadId &&
    method === "GET" &&
    path === `threads/${encodeURIComponent(context.threadId)}?format=full`
  )
    return { provider, account, kind: "thread", target: context.threadId };
  throw new WorkerPilotError();
}
export async function authorizeWorkerRequest(
  provider: PilotProvider,
  account: string,
  path: string,
  method = "GET",
  reserve = false,
) {
  const context = contexts.getStore();
  if (!context) return;
  const request = Object.freeze(
    requestFor(context, provider, account, path, method),
  );
  if (!(await context.authorize(request, reserve)))
    throw new WorkerPilotError();
}

// Only the opt-in pilot uses this single-attempt OAuth path. Normal SDK behaviour
// and credential storage remain unchanged. No retries or redirect following.
export async function pilotAccessToken(
  accountId: string,
  credentials: {
    access_token?: string | null;
    expiry_date?: number | null;
    refresh_token?: string | null;
  },
  organization: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
) {
  if (!inWorkerPilot()) throw new WorkerPilotError();
  await authorizeWorkerRequest("oauth", accountId, "", "POST");
  if (credentials.access_token && (credentials.expiry_date ?? 0) > now + 60000)
    return {
      token: credentials.access_token,
      expiry: credentials.expiry_date!,
    };
  if (!credentials.refresh_token) throw new WorkerPilotError();
  await authorizeWorkerRequest("oauth", accountId, "", "POST", true);
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
      client_id: organization.clientId,
      client_secret: organization.clientSecret,
    }),
  });
  if (!response.ok || response.redirected) {
    await response.body?.cancel();
    throw new WorkerPilotError();
  }
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new WorkerPilotError();
  const value = body as Record<string, unknown>;
  if (
    typeof value.access_token !== "string" ||
    !value.access_token ||
    value.access_token.length > 16384 ||
    typeof value.expires_in !== "number" ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    value.expires_in > 86400
  )
    throw new WorkerPilotError();
  return { token: value.access_token, expiry: now + value.expires_in * 1000 };
}
