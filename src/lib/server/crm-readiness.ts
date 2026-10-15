import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDb, HttpError } from "./supabase";
// The final migration's singleton is the activation marker for migrations 027–031.
export async function crmExtensionsReady(db: SupabaseClient) {
  const result = await db
    .from("operational_settings")
    .select("id")
    .eq("id", 1)
    .maybeSingle();
  if (
    result.error &&
    ["PGRST205", "PGRST204", "42P01"].includes(result.error.code)
  )
    return false;
  return !!checkDb(result, "operational_settings");
}
export async function requireCrmExtensions(db: SupabaseClient) {
  if (!(await crmExtensionsReady(db)))
    throw new HttpError(
      503,
      "Funciones pendientes de activación: aplicar migraciones 027–031 en Supabase.",
    );
}
