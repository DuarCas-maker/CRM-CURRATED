import { createHash, timingSafeEqual } from "node:crypto";
import {
  ConnectError,
  connectSessionSchema,
  type ConnectBinding,
  type ConnectSession,
  type ConnectAuthority,
} from "../../../composio-connect";

export function connectDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
export function sameConnectDigest(value: string, expected: string): boolean {
  const actual = Buffer.from(connectDigest(value), "hex");
  const reference = Buffer.from(expected, "hex");
  return (
    actual.length === reference.length && timingSafeEqual(actual, reference)
  );
}

// The dependency must obtain and verify this context on the server. Parsing is not JWT verification.
export function currentConnectSession(
  input: unknown,
  now: number,
): ConnectSession {
  const parsed = connectSessionSchema.safeParse(input);
  if (
    !parsed.success ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    parsed.data.role !== "superadmin" ||
    !parsed.data.active ||
    parsed.data.aal !== "aal2" ||
    parsed.data.expires_at_ms <= now
  )
    throw new ConnectError("CONNECT_FORBIDDEN");
  return parsed.data;
}

export function connectAuthority(
  session: ConnectSession,
  browserProof: string,
): ConnectAuthority {
  return {
    actor_id: session.actor_id,
    session_hash: connectDigest(session.session_id),
    authorization_revision: session.authorization_revision,
    browser_hash: connectDigest(browserProof),
  };
}
export function assertConnectBinding(
  session: ConnectSession,
  binding: ConnectBinding,
  browserProof: string,
): void {
  if (
    session.actor_id !== binding.actor_id ||
    !sameConnectDigest(session.session_id, binding.session_hash) ||
    !sameConnectDigest(browserProof, binding.browser_hash)
  )
    throw new ConnectError("CONNECT_FORBIDDEN");
  if (session.authorization_revision !== binding.authorization_revision)
    throw new ConnectError("CONNECT_STALE");
}
