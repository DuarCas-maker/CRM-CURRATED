import { GmailError } from "../src/lib/gmail-errors";

const known = new Set([
  "PROCESSING_FAILED", "DATABASE_OPERATION_FAILED", "MISSING_SUPABASE",
  "QGR_UNAVAILABLE", "QGR_STALE", "QGR_EXPIRED", "QGR_REPLAY", "QGR_DENIED",
  "R06_INVALID_INPUT", "R06_UNAVAILABLE", "R06_DENIED", "R06_UNCERTAIN",
  "INVALID_TRANSPORT_CONFIGURATION", "INVALID_COMPOSIO_BINDING", "INVALID_GMAIL_REQUEST",
  "MAIL_REQUEST_TOO_LARGE", "COMPOSIO_AUTH_REJECTED", "COMPOSIO_RATE_LIMITED",
  "COMPOSIO_UNAVAILABLE", "COMPOSIO_HTTP_REJECTED", "COMPOSIO_REDIRECT_REJECTED",
  "COMPOSIO_INVALID_RESPONSE", "MAIL_RESPONSE_TOO_LARGE", "COMPOSIO_NETWORK_OR_TIMEOUT",
  "GMAIL_TOKEN_REFRESH_FAILED", "GMAIL_AUTH", "GMAIL_QUOTA_PROJECT_REQUIRED",
  "GMAIL_QUOTA_RESERVATION_FAILED", "DIRECT_HEALTH_UNAVAILABLE", "DIRECT_CREDENTIAL_UNAVAILABLE",
  "MISSING_PUBSUB_TOPIC", "GMAIL_HISTORY_DISABLED", "UNKNOWN_JOB",
]);
export class WorkerDatabaseError extends Error {
  readonly code: string;
  constructor(sqlState?: string) {
    super("DATABASE_OPERATION_FAILED");
    this.code = sqlState && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(sqlState)
      ? "DATABASE_" + sqlState : "DATABASE_OPERATION_FAILED";
  }
}
// Only stable, explicitly permitted identifiers leave the worker. Never raw messages/cause.
export function workerErrorCode(error: unknown): string {
  if (error instanceof WorkerDatabaseError) return error.code;
  if (error instanceof GmailError && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599)
    return new GmailError(error.status, error.reason).code;
  if (!(error instanceof Error)) return "PROCESSING_FAILED";
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "string" && known.has(code)) return code;
  if (known.has(error.message)) return error.message;
  if (error.message === "Organization is not configured") return "GOOGLE_ORGANIZATION_UNCONFIGURED";
  if (error.name === "AbortError" || error.name === "TimeoutError") return "UPSTREAM_TIMEOUT";
  return "PROCESSING_FAILED";
}
