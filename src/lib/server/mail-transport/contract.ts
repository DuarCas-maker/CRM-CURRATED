// Server/worker contracts only. A resolved binding is not an authorization grant.
export interface GmailRequest {
  path: string;
  init?: RequestInit;
}

export interface PreparedGmailTransport {
  readonly provider: "gmail_oauth" | "composio";
  execute<T>(request: GmailRequest): Promise<T>;
}

export interface ResolvedComposioBinding {
  readonly accountId: string;
  readonly connectedAccountId: string;
  readonly authConfigId: string;
  readonly userId: string;
  readonly mailboxEmail: string;
  readonly verifiedMailboxEmail: string;
  readonly identityVerified: true;
  readonly status: "active";
  readonly revision: number;
  readonly quotaProjectId: string;
}

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
