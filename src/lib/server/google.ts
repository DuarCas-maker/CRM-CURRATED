import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { decrypt } from "./crypto";
import { serviceClient, checkDb, HttpError } from "./supabase";
import { GmailError, isGmailQuotaError } from "../gmail-errors";
import { GmailQuotaPacer, gmailRequestCost } from "../gmail-quota";
import { createMailTransport } from "./mail-transport/factory";
import {
  mailRoutingActive,
  executeRuntimeMail,
} from "./mail-transport/runtime-context";
import {
  authorizeWorkerRequest,
  inWorkerPilot,
  pilotAccessToken,
} from "./worker-request-control";
export { GmailError } from "../gmail-errors";
const quotaPacer = new GmailQuotaPacer();
const quotaProjects = new Map<string, string>();
function preparedDirectTransport(accessToken: string) {
  return createMailTransport({ provider: "gmail_oauth", accessToken });
}
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
  // Deny foreign/closed pilot contexts before credential reads or SDK refresh.
  if (inWorkerPilot())
    await authorizeWorkerRequest("oauth", accountId, "", "POST");
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
    if (inWorkerPilot()) {
      const bounded = await pilotAccessToken(
        accountId,
        client.credentials,
        org,
      );
      client.setCredentials({
        ...client.credentials,
        access_token: bounded.token,
        expiry_date: bounded.expiry,
      });
      access = { token: bounded.token };
    } else access = await client.getAccessToken();
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
  if (mailRoutingActive()) {
    try {
      return await executeRuntimeMail<T>(
        { account: accountId, path, init, beforeRequest },
        {
          direct: async () => {
            const accessToken = await gmailToken(accountId);
            const quotaProjectId = quotaProjects.get(accountId);
            if (!quotaProjectId)
              throw new Error("GMAIL_QUOTA_PROJECT_REQUIRED");
            return {
              transport: preparedDirectTransport(accessToken),
              quotaProjectId,
            };
          },
          quota: async (project) => {
            await quotaPacer.wait(
              accountId,
              gmailRequestCost(path, init.method),
            );
            const reserved = checkDb(
              await serviceClient().rpc("reserve_gmail_api", {
                account: accountId,
                project,
                units: gmailRequestCost(path, init.method),
              }),
            );
            if (reserved === -1)
              throw new GmailError(403, "dailyLimitExceeded", 3600);
            if (
              typeof reserved !== "number" ||
              !Number.isFinite(reserved) ||
              reserved < 0
            )
              throw new Error("GMAIL_QUOTA_RESERVATION_FAILED");
            if (reserved > 0) await delay(reserved);
          },
        },
      );
    } catch (error) {
      if (isGmailQuotaError(error))
        error.unitsPerMinute = quotaPacer.throttle(accountId);
      throw error;
    }
  }
  if (inWorkerPilot())
    await authorizeWorkerRequest(
      "gmail_oauth",
      accountId,
      path,
      init.method ?? "GET",
    );
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
  if (inWorkerPilot())
    await authorizeWorkerRequest(
      "gmail_oauth",
      accountId,
      path,
      init.method ?? "GET",
      true,
    );
  try {
    // Compatibility mode retains direct Gmail; no per-account fallback on routing errors.
    return await preparedDirectTransport(access).execute<T>({ path, init });
  } catch (error) {
    if (isGmailQuotaError(error))
      error.unitsPerMinute = quotaPacer.throttle(accountId);
    throw error;
  }
}
