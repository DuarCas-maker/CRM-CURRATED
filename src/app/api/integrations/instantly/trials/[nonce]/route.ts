import { instantlyTrialEndpoint } from "@/lib/server/instantly/endpoints";
import { serviceClient, requireUser, checkOrigin } from "@/lib/server/supabase";

export const runtime = "nodejs";
const handler = instantlyTrialEndpoint({
  env: () => process.env,
  client: serviceClient,
  checkOrigin,
  authorize: async () => {
    const { profile } = await requireUser();
    return { role: profile.role, active: profile.active === true, aal: "aal2" };
  },
});
export const GET = handler;
export const POST = handler;
