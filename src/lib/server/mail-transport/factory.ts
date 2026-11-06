import type { MailTransportOptions, PreparedGmailTransport } from "./contract";
import { directGmailTransport } from "./gmail-direct";
import { composioProxyTransport } from "./composio-proxy";
import { MailTransportError } from "./errors";

export function createMailTransport(
  options: MailTransportOptions,
): PreparedGmailTransport {
  if (options?.provider === "gmail_oauth") {
    if (
      typeof options.accessToken !== "string" ||
      !options.accessToken ||
      (options.fetchImpl !== undefined &&
        typeof options.fetchImpl !== "function")
    )
      throw new MailTransportError("INVALID_TRANSPORT_CONFIGURATION");
    return directGmailTransport(options.accessToken, options.fetchImpl);
  }
  if (options?.provider === "composio") return composioProxyTransport(options);
  throw new MailTransportError("INVALID_TRANSPORT_CONFIGURATION");
}
