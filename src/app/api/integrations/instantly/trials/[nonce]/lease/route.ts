import { instantlyLeaseEndpoint } from "@/lib/server/instantly/control-endpoints";
import { requireUser, serviceClient, checkOrigin } from "@/lib/server/supabase";
export const runtime = "nodejs";
export const POST = instantlyLeaseEndpoint({
  env: () => process.env,
  client: serviceClient,
  checkOrigin,
  authorize: async () => {
    let attempts = 0;
    const bounded: typeof fetch = async (input, init) => {
      if (++attempts > 4) throw Error("AUTH_BUDGET_EXHAUSTED");
      const u = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (
        u.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin ||
        (!u.pathname.startsWith("/auth/v1/") &&
          u.pathname !== "/rest/v1/profiles")
      )
        throw Error("AUTH_ROUTE_BLOCKED");
      return fetch(input, {
        ...init,
        signal: AbortSignal.any([
          AbortSignal.timeout(8000),
          ...(init?.signal ? [init.signal] : []),
        ]),
      });
    };
    const { profile } = await requireUser({ fetchImpl: bounded });
    return {
      id: profile.id,
      role: profile.role,
      active: profile.active === true,
      aal: "aal2",
    };
  },
});
