import { HttpError } from "../../supabase";

// OAuth requests can use an internal container URL behind the reverse proxy.
// Only operator configuration determines the browser's public destination.
export function simpleMailReturnUrl(
  connection: string,
  configuredOrigin = process.env.APP_ORIGIN,
  nodeEnv = process.env.NODE_ENV,
): URL {
  let origin: URL;
  try {
    origin = new URL(configuredOrigin ?? "");
  } catch {
    throw new HttpError(503, "SIMPLE_NOT_CONFIGURED");
  }
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    ["0.0.0.0", "[::]"].includes(origin.hostname) ||
    (nodeEnv === "production" &&
      (origin.protocol !== "https:" ||
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))
  )
    throw new HttpError(503, "SIMPLE_NOT_CONFIGURED");

  const destination = new URL("/", origin.origin);
  destination.searchParams.set("module", "connections");
  destination.searchParams.set("mail_connection", connection);
  destination.searchParams.set("mail_provider", "gmail_oauth");
  return destination;
}
