import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../supabase";
import { TransportSelectionError } from "./selection";
import {
  composioProductOperationEnabled,
  type RuntimeDependencies,
} from "./runtime-context";

export function serviceMailRuntime(
  client: () => SupabaseClient = serviceClient,
): RuntimeDependencies {
  return {
    async rpc(name, input) {
      try {
        const { data, error } = await client().rpc(name, input);
        if (error) throw new TransportSelectionError("R06_UNAVAILABLE");
        return data;
      } catch {
        throw new TransportSelectionError("R06_UNAVAILABLE");
      }
    },
    composioEnabled: composioProductOperationEnabled,
    configuration() {
      // Never read the private S00 file or expose this object to a response/log.
      try {
        return {
          context: JSON.parse(process.env.COMPOSIO_MAIL_CONTEXT || "{}"),
          apiKey: process.env.COMPOSIO_API_KEY,
        };
      } catch {
        throw new TransportSelectionError("R06_UNAVAILABLE");
      }
    },
    fetchImpl: (input, init) => fetch(input, init),
    now: () => Date.now(),
  };
}
