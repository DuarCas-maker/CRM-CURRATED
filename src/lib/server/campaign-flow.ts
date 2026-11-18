import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { flowLaunchSchema } from "../campaign-flow";
import { campaignTemplateSchema } from "../campaign-templates";
import { deliveryContext, deliveryResult } from "./brand-delivery";
import { HttpError } from "./supabase";
type Context = { db: SupabaseClient; profile: { role: string } };
function allowed(c: Context) {
  if (!["superadmin", "seller_admin"].includes(c.profile.role))
    throw new HttpError(403, "Se requiere un administrador con MFA.");
}
async function rpc(c: Context, name: string, args: Record<string, unknown>) {
  const r = await c.db.rpc(name, args);
  if (r.error?.message === "CF_STALE")
    throw new HttpError(
      409,
      "Los contactos, la plantilla o sus permisos cambiaron. Actualiza la selección y vuelve a revisar.",
    );
  if (r.error?.message === "CF_FORBIDDEN")
    throw new HttpError(403, "Se requiere una sesión autorizada con MFA.");
  if (r.error?.message === "CF_TEMPLATE_DATA")
    throw new HttpError(409,"A algunos leads les faltan datos que usa la plantilla. Completa sus datos o elige una plantilla sin esas variables.");
  if (r.error?.message === "CF_INVALID_INPUT")
    throw new HttpError(
      400,
      "Revisa la fecha, los destinatarios y los cuatro recordatorios.",
    );
  return deliveryResult(r);
}
export async function readFlow(url: URL, ctx: Context) {
  if (url.searchParams.has("campaign")) {
    if (!["superadmin", "seller_admin", "seller"].includes(ctx.profile.role))
      throw new HttpError(403, "Se requiere una sesión autorizada con MFA.");
    return rpc(ctx, "campaign_flow_progress", {
      campaign: z.uuid().parse(url.searchParams.get("campaign")),
    });
  }
  allowed(ctx);
  return rpc(ctx, "campaign_flow_pool", {
    search_text: z
      .string()
      .max(200)
      .parse(url.searchParams.get("search") || ""),
    page_number: z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(url.searchParams.get("page") || 0),
    page_size: z.coerce
      .number()
      .refine((v) => [20, 50, 100].includes(v))
      .parse(url.searchParams.get("size") || 20),
  });
}
export async function launchFlow(body: unknown, ctx: Context) {
  allowed(ctx);
  const e = z
    .strictObject({ payload: flowLaunchSchema, request_key: z.uuid() })
    .parse(body);
  // Validate all message merge fields before crossing into the transactional RPC.
  campaignTemplateSchema.parse({
    name: "Sequence",
    subject: "Preview",
    body: "{{unsubscribe_url}}",
    steps: e.payload.reminders,
  });
  await deliveryContext(
    ctx.db,
    e.payload.account_id,
    e.payload.brand_preparation,
    "campaign",
  );
  return rpc(ctx, "campaign_flow_launch", {
    p: { ...e.payload, contact_ids: [...e.payload.contact_ids].sort() },
    request_key: e.request_key,
  });
}
