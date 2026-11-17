import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { campaignTemplateSchema } from "../campaign-templates";
import { campaignImportErrors } from "../campaign-import";
import { importRetrySchema, reviewFilters } from "../campaign-import-review";
import { brandPreparationSchema } from "../brand-delivery";
import {
  deliveryContext,
  deliveryJsonError,
  deliveryResult,
} from "./brand-delivery";
import { HttpError } from "./supabase";

export type ImportCampaignContext = {
  db: SupabaseClient;
  profile: { role: string };
};
function administrator(ctx: ImportCampaignContext) {
  if (!["superadmin", "seller_admin"].includes(ctx.profile.role))
    throw new HttpError(403, campaignImportErrors.CI_FORBIDDEN[0]);
}
export function importCampaignError(error: unknown) {
  if (error instanceof SyntaxError)
    return Response.json(
      { error: "JSON inválido. / Invalid JSON." },
      { status: 400 },
    );
  if (error instanceof z.ZodError)
    return Response.json(
      { error: "Revisa los campos del formulario. / Check the form fields." },
      { status: 400 },
    );
  return deliveryJsonError(error);
}
async function rpc(
  ctx: ImportCampaignContext,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await ctx.db.rpc(name, args);
  if (!error) return data;
  if (["PGRST202", "42883"].includes(error.code || ""))
    throw new HttpError(503, campaignImportErrors.CI_UNAVAILABLE[0]);
  if (error.message in campaignImportErrors)
    throw new HttpError(
      error.message === "CI_FORBIDDEN"
        ? 403
        : error.message === "CI_BATCH_NOT_FOUND"
          ? 404
          : 409,
      campaignImportErrors[error.message][0],
    );
  return deliveryResult({ data, error });
}
export async function readImportCampaign(url: URL, ctx: ImportCampaignContext) {
  administrator(ctx);
  const p = url.searchParams;
  const batch = z.uuid().parse(p.get("batch"));
  const mode = z
    .enum(["status", "leads", "review"])
    .parse(p.get("mode") || "status");
  if (mode === "review")
    return rpc(ctx, "campaign_import_review_page", {
      batch,
      search_text: z
        .string()
        .max(200)
        .parse(p.get("search") || ""),
      review_filter: z
        .enum(reviewFilters)
        .parse(p.get("filter") || "attention"),
      page_number: z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .parse(p.get("page") || 0),
    });
  return mode === "status"
    ? rpc(ctx, "campaign_import_status", { batch })
    : rpc(ctx, "campaign_import_leads_page", {
        batch,
        template: z.uuid().parse(p.get("template")),
        account: z.uuid().parse(p.get("account")),
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
export async function writeImportCampaign(
  body: unknown,
  ctx: ImportCampaignContext,
) {
  administrator(ctx);
  if (
    body &&
    typeof body === "object" &&
    "kind" in body &&
    body.kind === "retry"
  ) {
    const p = importRetrySchema.parse(body);
    if (!process.env.BOUNCER_API_KEY)
      throw new HttpError(
        503,
        "Bouncer no está configurado. / Bouncer is not configured.",
      );
    return rpc(ctx, "campaign_retry_import", {
      batch: p.batch,
      contact_ids: p.contact_ids,
      expected_count: p.expected_count,
      request_key: p.request_key,
    });
  }
  const envelope = z
    .discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("verify"),
          batch: z.uuid(),
          expected_count: z.number().int().min(1).max(5000),
          request_key: z.uuid(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("create"),
          request_key: z.uuid(),
          payload: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ])
    .parse(body);
  if (envelope.kind === "verify") {
    if (!process.env.BOUNCER_API_KEY)
      throw new HttpError(
        503,
        "Bouncer no está configurado. / Bouncer is not configured.",
      );
    return rpc(ctx, "campaign_verify_import", {
      batch: envelope.batch,
      expected_count: envelope.expected_count,
      request_key: envelope.request_key,
    });
  }
  const p = envelope.payload;
  const config = z
    .object({
      import_batch_id: z.uuid(),
      account_id: z.uuid(),
      seller_id: z.uuid(),
      template_id: z.uuid(),
      template_version: z.coerce.number().int().positive(),
      daily_limit: z.coerce.number().int().min(1).max(2000),
      timezone: z.string().min(1).max(80),
      start_hour: z.coerce.number().int().min(0).max(23),
      end_hour: z.coerce.number().int().min(1).max(24),
      selected_contact_ids: z.array(z.uuid()).max(5000).optional(),
      brand_preparation: brandPreparationSchema,
    })
    .parse(p);
  if (config.start_hour >= config.end_hour)
    throw new HttpError(
      400,
      "Revisa el horario de envío. / Check the sending hours.",
    );
  const content = campaignTemplateSchema.parse(p);
  await deliveryContext(
    ctx.db,
    config.account_id,
    config.brand_preparation,
    "campaign",
  );
  return rpc(ctx, "campaign_create_from_import", {
    p: { ...config, ...content, steps: [] },
    request_key: envelope.request_key,
  });
}
