// Server/worker contracts only. A resolved binding is not an authorization grant.
export interface GmailRequest {
  path: string;
  init?: RequestInit;
}

export interface PreparedGmailTransport {
  readonly provider: "gmail_oauth" | "composio";
  execute<T>(request: GmailRequest): Promise<T>;
}

export type { ResolvedBinding as ResolvedComposioBinding } from "./resolved-binding";
import type { ResolvedBinding as ResolvedComposioBinding } from "./resolved-binding";

export type MailTransportOptions =
  | { provider: "gmail_oauth"; accessToken: string; fetchImpl?: typeof fetch }
  | {
      provider: "composio";
      apiKey: string;
      binding: ResolvedComposioBinding;
      // No implicit global fetch: product cannot enable Composio via env alone.
      fetchImpl: typeof fetch;
    };

export const gmailApiRoot = "https://gmail.googleapis.com/gmail/v1/users/me/";
