import { gmailResponseError } from "../../gmail-errors";
import { gmailRequestOperation } from "../../gmail-quota";
import {
  gmailApiRoot,
  type GmailRequest,
  type PreparedGmailTransport,
} from "./contract";
import { inWorkerPilot } from "../worker-request-control";
import { assertMailQuotaEmission } from "../mail-quota";

// OAuth, quota reservations and the final permission hook remain in google.ts.
export function directGmailTransport(
  accessToken: string,
  fetchImpl?: typeof fetch,
): PreparedGmailTransport {
  return {
    provider: "gmail_oauth",
    async execute<T>({ path, init = {} }: GmailRequest) {
      assertMailQuotaEmission("gmail_oauth", path, init.method ?? "GET");
      const res = await (fetchImpl ?? fetch)(gmailApiRoot + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: AbortSignal.timeout(30000),
        ...(inWorkerPilot() ? { redirect: "manual" as const } : {}),
      });
      if (!res.ok) {
        const error = await gmailResponseError(res);
        error.operation = gmailRequestOperation(path, init.method);
        throw error;
      }
      return res.json() as Promise<T>;
    },
  };
}
