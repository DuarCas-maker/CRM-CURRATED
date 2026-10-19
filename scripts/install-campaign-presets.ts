import { createClient } from "@supabase/supabase-js";
import { installCampaignPresets } from "../src/lib/server/install-campaign-presets";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Configura las credenciales existentes de Supabase en el entorno del servidor.",
  );
  process.exitCode = 1;
} else {
  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log(JSON.stringify(await installCampaignPresets(client)));
  } catch (error) {
    // Don't print request objects, URLs, credentials, or database contents.
    console.error(
      error instanceof Error ? error.message : "TEMPLATE_INSTALL_FAILED",
    );
    process.exitCode = 1;
  }
}
