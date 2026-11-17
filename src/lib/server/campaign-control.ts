import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { campaignTemplateSchema } from "../campaign-templates";
import { brandPreparationSchema } from "../brand-delivery";
import { controlMessages } from "../campaign-control";
import {
  deliveryContext,
  deliveryResult,
  deliveryJsonError,
} from "./brand-delivery";
import { HttpError } from "./supabase";
type Context = { db: SupabaseClient; profile: { role: string } };
const sender = z
  .object({
    account_id: z.uuid(),
    brand_preparation: brandPreparationSchema,
    daily_limit: z.coerce.number().int().min(1).max(2000).optional(),
  })
  .strict();
const senders = z
  .array(sender)
  .min(1)
  .max(20)
  .refine((a) => new Set(a.map((s) => s.account_id)).size === a.length);
const selection = z.object({
  contact_ids: z.array(z.uuid()).min(1).max(5000),
  expected_count: z.number().int().min(1).max(5000),
});
async function rpc(ctx: Context, name: string, args: Record<string, unknown>) {
  const r = await ctx.db.rpc(name, args);
  if (!r.error) return r.data;
  if (["PGRST202", "42703", "42883"].includes(r.error.code || ""))
    throw new HttpError(
      503,
      "El control de campañas aún no está disponible. / Campaign control is unavailable.",
    );
  if (Object.hasOwn(controlMessages, r.error.message))
    throw new HttpError(
      r.error.message === "CC_FORBIDDEN"
        ? 403
        : r.error.message === "CC_NOT_FOUND"
          ? 404
          : r.error.message === "CC_INVALID_INPUT"
            ? 400
            : 409,
      controlMessages[r.error.message][0],
    );
  return deliveryResult(r);
}
export function controlError(e: unknown) {
  if (e instanceof z.ZodError || e instanceof SyntaxError)
    return Response.json(
      { error: "Revisa los campos de la solicitud. / Check request fields." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  return deliveryJsonError(e);
}
function allowed(ctx: Context, manage = false) {
  if (
    !(
      manage
        ? ["superadmin", "seller_admin"]
        : ["superadmin", "seller_admin", "seller"]
    ).includes(ctx.profile.role)
  )
    throw new HttpError(403, controlMessages.CC_FORBIDDEN[0]);
}
export async function readControl(url: URL, ctx: Context) {
  allowed(ctx);
  const p = url.searchParams;
  return rpc(ctx, "campaign_control_read", {
    mode: z
      .enum(["overview", "leads", "details"])
      .parse(p.get("mode") || "overview"),
    batch: p.get("batch") ? z.uuid().parse(p.get("batch")) : null,
    campaign: p.get("campaign") ? z.uuid().parse(p.get("campaign")) : null,
    filter: z
      .enum([
        "all",
        "active",
        "scheduled",
        "draft",
        "paused",
        "completed",
        "valid",
        "invalid",
        "uncertain",
        "pending",
        "review",
        "sent",
        "replied",
        "unanswered",
        "errors",
      ])
      .parse(p.get("filter") || "all"),
    search_text: z
      .string()
      .max(200)
      .parse(p.get("search") || ""),
    page_number: z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(p.get("page") || 0),
  });
}
export async function writeControl(body: unknown, ctx: Context) {
  allowed(ctx, true);
  const e = z
    .object({
      kind: z.enum([
        "create",
        "activate",
        "schedule",
        "pause",
        "reassign",
        "exclude",
        "verify",
      ]),
      payload: z.record(z.string(), z.unknown()),
      request_key: z.uuid(),
    })
    .strict()
    .parse(body);
  let p: Record<string, unknown>;
  if (e.kind === "create") {
    const config = z
      .object({
        import_batch_id: z.uuid(),
        seller_id: z.uuid(),
        template_id: z.uuid(),
        template_version: z.coerce.number().int().positive(),
        daily_limit: z.coerce.number().int().min(1).max(2000),
        timezone: z.string().min(1).max(80),
        start_hour: z.coerce.number().int().min(0).max(23),
        end_hour: z.coerce.number().int().min(1).max(24),
        selected_contact_ids: z.array(z.uuid()).max(5000).optional(),
        senders,
      })
      .parse(e.payload);
    if (
      config.start_hour >= config.end_hour ||
      config.senders.some((s) => !s.daily_limit)
    )
      throw new HttpError(400, "Revisa horarios y límites de remitentes.");
    const contexts = await Promise.all(
      config.senders.map((s) =>
        deliveryContext(ctx.db, s.account_id, s.brand_preparation, "campaign"),
      ),
    );
    if (
      new Set(contexts.map((c) => (c as { brand_id: string }).brand_id))
        .size !== 1
    )
      throw new HttpError(409, controlMessages.CC_MIXED_BRAND[0]);
    p = { ...campaignTemplateSchema.parse(e.payload), ...config, steps: [] };
  } else if (e.kind === "activate" || e.kind === "schedule") {
    p = z
      .object({
        id: z.uuid(),
        senders,
        scheduled_at: z.iso.datetime().optional(),
      })
      .strict()
      .parse(e.payload);
    if (e.kind === "schedule" && !p.scheduled_at)
      throw new HttpError(400, "Selecciona una fecha futura.");
  } else if (e.kind === "pause")
    p = z.object({ id: z.uuid() }).strict().parse(e.payload);
  else {
    const selected = selection.parse(e.payload);
    if (
      selected.contact_ids.length !== selected.expected_count ||
      new Set(selected.contact_ids).size !== selected.expected_count
    )
      throw new HttpError(400, controlMessages.CC_STALE[0]);
    if (e.kind === "verify") {
      if (!process.env.BOUNCER_API_KEY)
        throw new HttpError(
          503,
          "Bouncer no está configurado. / Bouncer is not configured.",
        );
      p = z
        .object({
          batch: z.uuid().nullable().optional(),
          contact_ids: selection.shape.contact_ids,
          expected_count: selection.shape.expected_count,
          cause_resolved: z.boolean(),
        })
        .strict()
        .parse(e.payload);
    } else
      p = z
        .object({
          id: z.uuid(),
          contact_ids: selection.shape.contact_ids,
          expected_count: selection.shape.expected_count,
          ...(e.kind === "reassign"
            ? {
                target_account_id: z.uuid(),
                target_preparation: brandPreparationSchema,
              }
            : {}),
        })
        .strict()
        .parse(e.payload);
    p.contact_ids = [...selected.contact_ids].sort();
  }
  return rpc(ctx, "campaign_control_command", {
    kind: e.kind,
    p,
    request_key: e.request_key,
  });
}
