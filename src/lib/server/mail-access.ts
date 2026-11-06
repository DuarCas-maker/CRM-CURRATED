import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./supabase";

// These RPCs use the signed-in client. Missing SQL must never fall back to a
// service-role query: this increment is intentionally unusable until integrated.
export async function mailAccess(
  db: SupabaseClient,
  caseId: string,
  write = false,
) {
  const result = await db.rpc("mail_access_context", { case_id: caseId });
  if (result.error)
    throw new HttpError(503, "Mail access contract is unavailable");
  const context = result.data as {
    area: "seller" | "closer";
    can_write: boolean;
  } | null;
  if (context === null)
    throw new HttpError(403, "Case and area access required");
  if (
    !context ||
    !["seller", "closer"].includes(context.area) ||
    typeof context.can_write !== "boolean"
  )
    throw new HttpError(503, "Mail access contract is unavailable");
  if (write && context.can_write !== true)
    throw new HttpError(403, "Case and area access required");
  return context;
}

export async function requireMailSource(
  db: SupabaseClient,
  source: "document" | "version" | "saved" | "upload" | "legacy",
  resource: string,
  hash: string | null = null,
) {
  const result = await db.rpc("mail_source_allowed", {
    source,
    resource,
    hash,
  });
  if (result.error)
    throw new HttpError(503, "Mail access contract is unavailable");
  if (result.data !== true) throw new HttpError(404, "File not found");
}

export async function requireMailSnapshot(
  db: SupabaseClient,
  message: string,
  file: string,
) {
  const result = await db.rpc("mail_snapshot_allowed", { message, file });
  if (result.error)
    throw new HttpError(503, "Mail access contract is unavailable");
  if (result.data !== true) throw new HttpError(404, "File not found");
}
