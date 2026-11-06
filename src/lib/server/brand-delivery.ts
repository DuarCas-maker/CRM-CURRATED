import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HttpError, jsonError } from "./supabase";
import {
  brandCapabilitySchema,
  brandDeliveryMessages,
  brandPreparationSchema,
  brandSnapshotSchema,
} from "../brand-delivery";
export class BrandDeliveryError extends HttpError {
  constructor(
    public readonly code: keyof typeof brandDeliveryMessages,
    status = 409,
  ) {
    super(status, brandDeliveryMessages[code][0]);
  }
}
export function deliveryResult<T>(result: {
  data: T;
  error: { message: string; code?: string } | null;
}): T {
  if (!result.error) return result.data;
  const code = result.error.message as keyof typeof brandDeliveryMessages;
  if (Object.hasOwn(brandDeliveryMessages, code))
    throw new BrandDeliveryError(
      code,
      code === "BRAND_DELIVERY_FORBIDDEN" ? 403 : 409,
    );
  if (
    ["PGRST202", "PGRST204", "42703", "42883"].includes(result.error.code || "")
  )
    throw new BrandDeliveryError("BRAND_DELIVERY_UNAVAILABLE", 503);
  throw new HttpError(
    400,
    "No se pudo preparar la operación. / The operation could not be prepared.",
  );
}
export function deliveryJsonError(e: unknown) {
  return e instanceof BrandDeliveryError
    ? Response.json(
        { error: e.message, code: e.code },
        { status: e.status, headers: { "Cache-Control": "no-store" } },
      )
    : jsonError(e);
}
export async function deliveryContext(
  db: SupabaseClient,
  account: string,
  preparation: unknown,
  purpose: "mail" | "campaign",
  caseId: string | null = null,
) {
  const p = brandPreparationSchema.safeParse(preparation);
  if (!p.success) throw new BrandDeliveryError("BRAND_PREPARATION_REQUIRED");
  const data = deliveryResult(
    await db.rpc("brand_prepare_context", {
      account,
      preparation: p.data,
      purpose,
      case_id: caseId,
    }),
  );
  if (!brandSnapshotSchema.safeParse(data).success)
    throw new BrandDeliveryError("BRAND_DELIVERY_UNAVAILABLE", 503);
  return data;
}
export async function senderCapabilities(db: SupabaseClient) {
  const data = deliveryResult(await db.rpc("brand_sender_capabilities"));
  const p = z.array(brandCapabilitySchema).safeParse(data);
  if (!p.success)
    throw new BrandDeliveryError("BRAND_DELIVERY_UNAVAILABLE", 503);
  return p.data;
}
// During expand-first rollout, history remains readable without implying send access.
export async function readableSenderCapabilities(db: SupabaseClient) {
  try {
    return await senderCapabilities(db);
  } catch (e) {
    if (e instanceof BrandDeliveryError && e.status === 503) return [];
    throw e;
  }
}
export async function queueBrandMail(
  db: SupabaseClient,
  operation: string,
  p: Record<string, unknown>,
  preparation: unknown,
) {
  const parsed = brandPreparationSchema.safeParse(preparation);
  if (!parsed.success)
    throw new BrandDeliveryError("BRAND_PREPARATION_REQUIRED");
  return deliveryResult(
    await db.rpc("brand_queue_mail", {
      operation,
      p,
      preparation: parsed.data,
    }),
  );
}
