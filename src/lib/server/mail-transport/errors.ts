export type MailTransportErrorCode =
  | "INVALID_TRANSPORT_CONFIGURATION"
  | "INVALID_COMPOSIO_BINDING"
  | "INVALID_GMAIL_REQUEST"
  | "MAIL_REQUEST_TOO_LARGE"
  | "COMPOSIO_AUTH_REJECTED"
  | "COMPOSIO_RATE_LIMITED"
  | "COMPOSIO_UNAVAILABLE"
  | "COMPOSIO_HTTP_REJECTED"
  | "COMPOSIO_REDIRECT_REJECTED"
  | "COMPOSIO_INVALID_RESPONSE"
  | "MAIL_RESPONSE_TOO_LARGE"
  | "COMPOSIO_NETWORK_OR_TIMEOUT";

// Never retain provider text, credential, URL, body or original Error/cause.
export class MailTransportError extends Error {
  constructor(
    public readonly code: MailTransportErrorCode,
    public readonly deliveryUncertain = false,
    public readonly status?: number,
    public readonly retryAfter = 0,
  ) {
    super(code);
    this.name = "MailTransportError";
  }
}

// Only OAuth preparation before a mail request can create this error.
export class DirectCredentialUnavailable extends Error {
  constructor() {
    super("DIRECT_CREDENTIAL_UNAVAILABLE");
    this.name = "DirectCredentialUnavailable";
  }
}
