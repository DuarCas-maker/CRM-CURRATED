import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignAudience } from "../campaign-delivery";
import { checkDb, HttpError } from "./supabase";
import { deliveryResult } from "./brand-delivery";

export function campaignDb<T>(result: {
  data: T;
  error: { code?: string; message: string } | null;
}): T {
  if (result.error?.message.startsWith("BRAND_")) return deliveryResult(result);
  if (
    result.error &&
    ["PGRST202", "PGRST204", "42703", "42883"].includes(result.error.code || "")
  )
    throw new HttpError(
      503,
      "Aplica la migración 039_campaign_delivery_controls.sql para habilitar los controles de campañas.",
    );
  return checkDb(result);
}
export async function campaignAudience(db: SupabaseClient, id: string) {
  const model = campaignDb(await db.from("campaigns").select("funding_model").eq("id", id).single())?.funding_model;
  const contacts: CampaignAudience[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const rows = campaignDb(
      await db
        .rpc("campaign_audience", { campaign_id: id })
        .range(offset, offset + 999),
    ) as CampaignAudience[];
    if (model && rows.length) {
      const ids = rows.map((r) => r.contact_id);
      const current = campaignDb(await db.from("contacts").select("id,monthly_income").in("id", ids));
      const frozen = campaignDb(await db.from("campaign_enrollments").select("contact_id,funding_income_snapshot").eq("campaign_id", id).in("contact_id", ids));
      const incomes = new Map((current || []).map((r) => [r.id, r.monthly_income]));
      for (const r of frozen || []) incomes.set(r.contact_id, r.funding_income_snapshot);
      for (const row of rows) row.monthly_income = incomes.get(row.contact_id) ?? null;
    }
    contacts.push(...rows);
    if (rows.length < 1000) return contacts;
  }
  throw new HttpError(
    400,
    "Selecciona un lote de menos de 50.000 contactos para revisar la audiencia.",
  );
}
