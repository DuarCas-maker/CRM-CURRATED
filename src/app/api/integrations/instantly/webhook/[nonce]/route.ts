import { instantlyWebhookEndpoint } from "@/lib/server/instantly/endpoints";
import { serviceClient } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const POST = instantlyWebhookEndpoint({
  env: () => process.env,
  client: serviceClient,
});
