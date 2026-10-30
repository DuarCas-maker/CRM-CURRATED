import { instantlyWebhookEndpoint } from "@/lib/server/instantly/endpoints";
import { serviceClient } from "@/lib/server/supabase";
import { admitInstantlyCallback } from "@/lib/server/instantly/control-endpoints";

export const runtime = "nodejs";
export const POST = instantlyWebhookEndpoint({
  env: () => process.env,
  client: serviceClient,
  admit: admitInstantlyCallback,
});
