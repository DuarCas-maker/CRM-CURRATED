import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { flowLaunchSchema } from "../campaign-flow";
import { leadFunnelFilters } from "../campaign-lead-funnel";
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
  if (url.searchParams.has("mode")) {
    z.literal("leads").parse(url.searchParams.get("mode"));
    const result = await rpc(ctx, "campaign_flow_leads", {
      filter: z.enum(leadFunnelFilters).parse(url.searchParams.get("filter") || "all"),
      search_text: z.string().max(200).parse(url.searchParams.get("search") || ""),
      page_number: z.coerce.number().int().min(0).max(1000000).parse(url.searchParams.get("page") || 0),
      page_size: z.coerce.number().refine((v) => [20, 50, 100].includes(v)).parse(url.searchParams.get("size") || 50),
    });
    if (Array.isArray(result?.rows) && result.rows.length) {
      const income = await ctx.db.from("contacts").select("id,monthly_income").in("id", result.rows.map((r: { contact_id: string }) => r.contact_id));
      if (income.error) throw new HttpError(503, "No se pudo cargar el ingreso mensual.");
      const values = new Map((income.data || []).map((r) => [r.id, r.monthly_income]));
      result.rows = result.rows.map((r: { contact_id: string }) => ({ ...r, monthly_income: values.get(r.contact_id) ?? null }));
    }
    return result;
  }
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
  const usesFunding = /\{\{\s*(monthly_income|sender_email|funding_)/.test(JSON.stringify(e.payload.reminders));
  let fundingModel;
  if (usesFunding) {
    const source = await ctx.db.from("email_templates").select("funding_model").eq("id", e.payload.template_id).single();
    if (source.error || !source.data?.funding_model) throw new HttpError(409, "Selecciona una plantilla con ingreso mensual para estos recordatorios.");
    fundingModel = source.data.funding_model;
  }
  campaignTemplateSchema.parse({
    name: "Sequence",
    subject: "Preview",
    body: "{{unsubscribe_url}}",
    steps: e.payload.reminders,
    funding_model: fundingModel,
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
