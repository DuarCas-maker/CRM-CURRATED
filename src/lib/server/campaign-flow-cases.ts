import type { SupabaseClient } from "@supabase/supabase-js";
import type { Opportunity } from "../domain";
import { checkDb, HttpError } from "./supabase";
export async function campaignFlowCases(
  db: SupabaseClient,
  opportunities: Opportunity[],
) {
  const states = new Map<
    string,
    { initial_sent: boolean; engagement: Opportunity["campaign_engagement"] }
  >();
  for (let i = 0; i < opportunities.length; i += 500) {
    const response = await db.rpc("campaign_flow_cases", {
      case_ids: opportunities.slice(i, i + 500).map((o) => o.id),
    });
    const rows = checkDb(response, "campaign_flow.cases");
    if (!Array.isArray(rows))
      throw new HttpError(
        503,
        "No se pudo comprobar el estado de envío de los expedientes.",
      );
    for (const row of rows) states.set(row.id, row);
  }
  return opportunities
    .filter(
      (o) =>
        !states.has(o.id) ||
        states.get(o.id)!.initial_sent ||
        !["new", "contacting"].includes(o.stage) ||
        o.application_complete ||
        o.handed_off_at,
    )
    .map((o) =>
      states.has(o.id)
        ? { ...o, campaign_engagement: states.get(o.id)!.engagement }
        : o,
    );
}
