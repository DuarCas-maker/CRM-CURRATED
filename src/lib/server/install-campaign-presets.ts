import type { SupabaseClient } from "@supabase/supabase-js";
import { campaignPresets } from "../campaign-presets";
import { campaignTemplateSchema } from "../campaign-templates";

function checked<T>(
  step: string,
  result: { data: T; error: { code?: string } | null },
) {
  if (result.error)
    throw new Error(`${step}: ${result.error.code || "DATABASE_ERROR"}`);
  return result.data;
}

// Uses the configured server credential, creates only the requested templates,
// and preserves any later edits, archival decisions and historical snapshots.
export async function installCampaignPresets(client: SupabaseClient) {
  campaignPresets.forEach((preset) => campaignTemplateSchema.parse(preset));
  const admin = checked(
    "ADMIN_LOOKUP",
    await client
      .from("profiles")
      .select("id")
      .eq("active", true)
      .eq("role", "superadmin")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  );
  if (!admin)
    throw new Error(
      "No hay un superadministrador activo para registrar las plantillas.",
    );
  const rows = campaignPresets.map((preset) => ({
    ...preset,
    created_by: admin.id,
    updated_by: admin.id,
  }));
  const created =
    checked(
      "TEMPLATE_INSTALL",
      await client
        .from("email_templates")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
        .select("id"),
    ) || [];
  const saved =
    checked(
      "TEMPLATE_VERIFY",
      await client
        .from("email_templates")
        .select("*")
        .in(
          "id",
          campaignPresets.map((p) => p.id),
        ),
    ) || [];
  if (saved.length !== campaignPresets.length)
    throw new Error("No se pudieron verificar las dos plantillas guardadas.");
  checked(
    "VERSION_INSTALL",
    await client.from("email_template_versions").upsert(
      saved.map((row) => ({
        template_id: row.id,
        version: row.version,
        snapshot: row,
      })),
      { onConflict: "template_id,version", ignoreDuplicates: true },
    ),
  );
  return {
    created: created.length,
    available: saved.length,
    names: saved.map((row) => row.name),
  };
}
