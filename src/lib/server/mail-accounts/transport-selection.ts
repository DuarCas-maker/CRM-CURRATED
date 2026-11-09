import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../../domain";
import {
  transportCommand,
  transportPage,
  transportReview,
} from "../../mail-transport-selection";
import { HttpError } from "../supabase";
export class TransportAdminError extends HttpError {
  constructor(
    public readonly code: string,
    status = 409,
  ) {
    super(status, code);
  }
}
const codes = new Set([
  "R06_FORBIDDEN",
  "R06_NOT_FOUND",
  "R06_INVALID_INPUT",
  "R06_STALE",
  "R06_BUSY",
  "R06_IDEMPOTENCY_CONFLICT",
  "R06_NOT_READY",
  "R06_EVIDENCE_REQUIRED",
  "R06_UNRESOLVED",
]);
function data<T>(result: { data: T; error: { message?: string } | null }): T {
  if (!result.error) return result.data;
  const raw = result.error.message ?? "";
  if (raw === "CONNECT_FORBIDDEN")
    throw new TransportAdminError("R06_FORBIDDEN", 403);
  const code = codes.has(raw) ? raw : "R06_UNAVAILABLE";
  throw new TransportAdminError(
    code,
    code === "R06_FORBIDDEN"
      ? 403
      : code === "R06_INVALID_INPUT"
        ? 400
        : code === "R06_NOT_FOUND"
          ? 404
          : code === "R06_UNAVAILABLE"
            ? 503
            : 409,
  );
}
export function requireTransportAdmin(
  profile: Pick<Profile, "active" | "role">,
) {
  if (!profile.active || profile.role !== "superadmin")
    throw new TransportAdminError("R06_FORBIDDEN", 403);
}
export async function readTransportSelection(
  db: SupabaseClient,
  account: string,
) {
  const result = data(await db.rpc("mail_transport_page", { account }));
  if (result === null) throw new TransportAdminError("R06_NOT_FOUND", 404);
  const parsed = transportPage.safeParse(result);
  if (!parsed.success || parsed.data.account_id !== account)
    throw new TransportAdminError("R06_UNAVAILABLE", 503);
  return parsed.data;
}
export async function commandTransportSelection(
  db: SupabaseClient,
  account: string,
  body: unknown,
  composioEnabled: boolean,
) {
  const parsed = transportCommand.safeParse(body);
  if (!parsed.success) throw new TransportAdminError("R06_INVALID_INPUT", 400);
  if (
    parsed.data.payload.target_provider === "composio" &&
    !composioEnabled &&
    !["pause", "cancel_transition"].includes(parsed.data.kind)
  )
    throw new TransportAdminError("R06_NOT_READY", 503);
  const result = data(
    await db.rpc("mail_transport_command", {
      account,
      kind: parsed.data.kind,
      p: parsed.data.payload,
      request_key: parsed.data.idempotency_key,
    }),
  );
  const out = transportPage.safeParse(result);
  if (!out.success || out.data.account_id !== account)
    throw new TransportAdminError("R06_UNAVAILABLE", 503);
  return out.data;
}
export async function reviewTransportSelection(
  db: SupabaseClient,
  account: string,
  composioEnabled: boolean,
) {
  const result = data(await db.rpc("mail_transport_review", { account }));
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new TransportAdminError("R06_UNAVAILABLE", 503);
  const parsed = transportReview.safeParse({
    ...result,
    composio_enabled: composioEnabled,
  });
  if (
    !parsed.success ||
    (parsed.data.selection && parsed.data.selection.account_id !== account)
  )
    throw new TransportAdminError("R06_UNAVAILABLE", 503);
  return parsed.data;
}
export function transportAdminJsonError(error: unknown) {
  const status =
    error instanceof HttpError &&
    [400, 401, 403, 404, 409, 413, 503].includes(error.status)
      ? error.status
      : 503;
  const code =
    error instanceof TransportAdminError
      ? error.code
      : status === 400 || status === 413
        ? "R06_INVALID_INPUT"
        : status === 401 || status === 403
          ? "R06_FORBIDDEN"
          : "R06_UNAVAILABLE";
  return Response.json(
    { code, error: code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
