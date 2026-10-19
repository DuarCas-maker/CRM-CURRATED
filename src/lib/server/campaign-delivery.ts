import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignAudience } from "../campaign-delivery";
import { checkDb, HttpError } from "./supabase";

export function campaignDb<T>(result: {
  data: T;
  error: { code?: string; message: string } | null;
}): T {
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
  const contacts: CampaignAudience[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const rows = campaignDb(
      await db
        .rpc("campaign_audience", { campaign_id: id })
        .range(offset, offset + 999),
    ) as CampaignAudience[];
    contacts.push(...rows);
    if (rows.length < 1000) return contacts;
  }
  throw new HttpError(
    400,
    "Selecciona un lote de menos de 50.000 contactos para revisar la audiencia.",
  );
}
