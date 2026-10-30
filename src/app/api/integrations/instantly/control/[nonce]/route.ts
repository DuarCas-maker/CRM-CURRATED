import { instantlyControlEndpoint } from "@/lib/server/instantly/control-endpoints";
import { serviceClient } from "@/lib/server/supabase";
export const runtime = "nodejs";
const handler = instantlyControlEndpoint({
  env: () => process.env,
  client: serviceClient,
});
export const GET = handler;
export const POST = handler;
