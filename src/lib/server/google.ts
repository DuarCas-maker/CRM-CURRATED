import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { decrypt } from "./crypto";
import { serviceClient, checkDb, HttpError } from "./supabase";
import {
  GmailError,
  gmailResponseError,
  isGmailQuotaError,
} from "../gmail-errors";
import {
  GmailQuotaPacer,
  gmailRequestCost,
  gmailRequestOperation,
} from "../gmail-quota";
export { GmailError } from "../gmail-errors";
const quotaPacer = new GmailQuotaPacer();
const quotaProjects = new Map<string, string>();
const organizationSchema = z.array(
  z.object({
    id: z.string(),
    domain: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    pubsubTopic: z.string().optional(),
    projectId: z.string().optional(),
  }),
);
export function configuredOrganizations() {
  return organizationSchema.parse(
    JSON.parse(process.env.GOOGLE_OAUTH_ORGANIZATIONS || "[]"),
  );
}
export function organization(id: string) {
  const org = configuredOrganizations().find((o) => o.id === id);
  if (!org) throw new HttpError(400, "Organization is not configured");
  return org;
}
export function oauthClient(id: string) {
  const org = organization(id);
  return new OAuth2Client(
    org.clientId,
    org.clientSecret,
    `${process.env.APP_ORIGIN}/api/gmail/callback`,
  );
}
const tokenClients = new Map<
  string,
  { credential: string; client: OAuth2Client }
>();
export async function gmailToken(accountId: string) {
  const db = serviceClient();
  const account = checkDb(
    await db.from("mail_accounts").select("*").eq("id", accountId).single(),
  )!;
  if (account.status !== "connected") {
    tokenClients.delete(accountId);
    throw new GmailError(401);
  }
  const org = organization(account.organization);
  quotaProjects.set(accountId, org.projectId || org.clientId.split("-")[0]);
  const credentials = checkDb(
    await db
      .from("mail_credentials")
      .select("*")
      .eq("account_id", accountId)
      .single(),
  )!;
  let cached = tokenClients.get(accountId);
  if (!cached || cached.credential !== credentials.encrypted_refresh_token) {
    const client = oauthClient(account.organization);
    client.setCredentials({
      refresh_token: decrypt(credentials.encrypted_refresh_token),
    });
    cached = { credential: credentials.encrypted_refresh_token, client };
    tokenClients.set(accountId, cached);
  }
  const client = cached.client;
  let access;
  try {
    access = await client.getAccessToken();
  } catch (error) {
    const response = (
      error as { response?: { status?: number; data?: { error?: string } } }
    ).response;
    if (response?.status === 401 || response?.data?.error === "invalid_grant") {
      checkDb(
        await db
          .from("mail_accounts")
          .update({ status: "disconnected" })
          .eq("id", accountId),
      );
      checkDb(
        await db
          .from("outbox")
          .update({ status: "paused" })
          .eq("account_id", accountId)
          .eq("status", "queued"),
      );
      throw new GmailError(401);
    }
    throw new Error("GMAIL_TOKEN_REFRESH_FAILED");
  }
  if (!access.token) throw new Error("GMAIL_AUTH");
  return access.token;
}
export async function gmail<T>(
  accountId: string,
  path: string,
  init: RequestInit = {},
  beforeRequest?: () => Promise<void>,
): Promise<T> {
  const access = await gmailToken(accountId);
  await quotaPacer.wait(accountId, gmailRequestCost(path, init.method));
  const reserved = checkDb(
    await serviceClient().rpc("reserve_gmail_api", {
      account: accountId,
      project: quotaProjects.get(accountId),
      units: gmailRequestCost(path, init.method),
    }),
  );
  if (reserved === -1) throw new GmailError(403, "dailyLimitExceeded", 3600);
  if (
    typeof reserved !== "number" ||
    !Number.isFinite(reserved) ||
    reserved < 0
  )
    throw new Error("GMAIL_QUOTA_RESERVATION_FAILED");
  if (reserved > 0) await delay(reserved);
  await beforeRequest?.();
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) {
    const error = await gmailResponseError(res);
    error.operation = gmailRequestOperation(path, init.method);
    if (isGmailQuotaError(error))
      error.unitsPerMinute = quotaPacer.throttle(accountId);
    throw error;
  }
  return res.json() as Promise<T>;
}
