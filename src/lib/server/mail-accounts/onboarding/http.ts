import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import {
  simpleMailEnabled,
  simpleMailComposioEnabled,
  mailConnectionInput,
} from "../../../mail-connections";
import { checkOrigin, HttpError, requireUser } from "../../supabase";
import {
  createOnboarding,
  simpleConnectionError,
  type OnboardingPorts,
} from "./service";

type HttpPorts = {
  enabled(): boolean;
  composioEnabled?(): boolean;
  authorize(): Promise<void>;
  origin(request: Request): void;
  onboarding(request: Request): Promise<OnboardingPorts>;
};
const contexts = new AsyncLocalStorage<HttpPorts>();
export const withSimpleMailHttp = <T>(ports: HttpPorts, fn: () => Promise<T>) =>
  contexts.run(ports, fn);
const defaults: HttpPorts = {
  enabled: simpleMailEnabled,
  composioEnabled: simpleMailComposioEnabled,
  authorize: async () => {
    const { profile } = await requireUser();
    if (profile.role !== "superadmin" || !profile.active)
      throw new HttpError(403, "SIMPLE_FORBIDDEN");
  },
  origin: checkOrigin,
  onboarding: async (request) =>
    (await import("./production")).productionOnboarding(request),
};
async function json(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new HttpError(400, "SIMPLE_INVALID_INPUT");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "SIMPLE_INVALID_INPUT");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 2048) throw new HttpError(413, "SIMPLE_INVALID_INPUT");
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "SIMPLE_INVALID_INPUT");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function simpleMailHttp(
  request: Request,
  id?: string,
  action?: "continue" | "disconnect",
) {
  try {
    const p = contexts.getStore() ?? defaults;
    if (!p.enabled()) throw new HttpError(503, "SIMPLE_NOT_CONFIGURED");
    if (new URL(request.url).search)
      throw new HttpError(400, "SIMPLE_INVALID_INPUT");
    if (!["GET", "POST"].includes(request.method))
      throw new HttpError(405, "SIMPLE_INVALID_INPUT");
    if (request.method === "POST") p.origin(request);
    await p.authorize();
    if (id && !z.uuid().safeParse(id).success)
      throw new HttpError(400, "SIMPLE_INVALID_INPUT");
    const api = createOnboarding(await p.onboarding(request));
    const composioEnabled =
      p.composioEnabled?.() ?? simpleMailComposioEnabled();
    let result: unknown;
    if (request.method === "GET") {
      if (action) throw new HttpError(405, "SIMPLE_INVALID_INPUT");
      if (id) result = await api.get(id);
      else {
        const options = await api.options();
        result = {
          ...options,
          composio_enabled: composioEnabled,
          included_available: composioEnabled && options.included_available,
        };
      }
    } else if (!id) {
      const input = mailConnectionInput.parse(await json(request));
      if (input.provider === "composio" && !composioEnabled)
        throw new HttpError(409, "SIMPLE_COMPOSIO_DISABLED");
      result = await api.begin(input);
    } else {
      const body = z.strictObject({}).parse(await json(request));
      void body;
      if (action === "continue") {
        if (!composioEnabled && (await api.get(id)).provider === "composio")
          throw new HttpError(409, "SIMPLE_COMPOSIO_DISABLED");
        result = await api.continue(id);
      } else if (action === "disconnect") result = await api.disconnect(id);
      else throw new HttpError(405, "SIMPLE_INVALID_INPUT");
    }
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return simpleConnectionError(new HttpError(400, "SIMPLE_INVALID_INPUT"));
    return simpleConnectionError(error);
  }
}
