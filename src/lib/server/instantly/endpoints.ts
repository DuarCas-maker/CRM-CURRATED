import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { cSecrets, validateCManifest } from "./receiver";
import {
  readInstantlyTrial,
  prepareInstantlyTrial,
  createInstantlyDbReceiver,
  type WebhookRpcClient,
  type Trial,
} from "./store";

type Env = Readonly<Record<string, string | undefined>>;
export type InstantlyRouteContext = { params: Promise<{ nonce: string }> };
type Auth = { role: string; active: boolean; aal: string };
type Deps = {
  env: () => Env;
  client: () => WebhookRpcClient;
  now?: () => number;
  authorize?: () => Promise<Auth>;
  checkOrigin?: (request: Request) => void;
  admit?: (
    client: WebhookRpcClient,
    nonce: string,
  ) => Promise<{ status: number; trial?: Trial }>;
};
const reply = (status: number, body?: unknown) =>
  body === undefined
    ? new Response(null, { status, headers: { "cache-control": "no-store" } })
    : Response.json(body, { status, headers: { "cache-control": "no-store" } });
const nonceSchema = z.string().regex(/^[a-f0-9]{24}$/);
function config(env: Env) {
  const token = env.INSTANTLY_S00_WEBHOOK_SECRET,
    key = env.INSTANTLY_S00_WEBHOOK_DEDUP_KEY,
    u = new URL(env.APP_ORIGIN ?? "");
  if (
    u.protocol !== "https:" ||
    u.origin !== env.APP_ORIGIN ||
    u.username ||
    u.password ||
    !token ||
    !key ||
    !/^[a-f0-9]{64}$/.test(token) ||
    !/^[a-f0-9]{64}$/.test(key) ||
    token === key
  )
    throw Error("CONFIGURATION_UNAVAILABLE");
  return { origin: u.origin, token, key };
}
const sameToken = (a: string, b: string) =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
const urlFor = (origin: string, nonce: string) =>
  origin + "/api/integrations/instantly/webhook/" + nonce;
function locationMatches(request: Request, path: string) {
  const u = new URL(request.url);
  return (
    u.pathname === path && !u.search && !u.hash && !u.username && !u.password
  );
}
function summary(t: Trial) {
  const rows = t.state?.receipts ?? [],
    first = rows[0];
  return {
    prepared: true,
    armed: !!t.state,
    closed: t.state?.closed ?? false,
    observations: rows.length,
    uniqueTechnicalReceipts: new Set(rows.map((r) => r.digest)).size,
    transportObserved: !!first,
    contextValidated:
      !!first?.contextValidated && !rows.some((r) => r.digest !== first.digest),
    conflictingDeliveries: rows.some((r) => r.digest !== first.digest),
    realReplyVerified: false,
  };
}
async function boundedControlJson(request: Request) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw Error("INVALID_INPUT");
  if (Number(request.headers.get("content-length") ?? 0) > 16384)
    throw Error("INVALID_INPUT");
  const reader = request.body?.getReader();
  if (!reader) throw Error("INVALID_INPUT");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("INVALID_INPUT")), 8000);
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const x = await Promise.race([reader.read(), timeout]);
      if (x.done) break;
      size += x.value.byteLength;
      if (size > 16384) throw Error("INVALID_INPUT");
      chunks.push(x.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export function instantlyWebhookEndpoint(deps: Deps) {
  return async (request: Request, context: InstantlyRouteContext) => {
    if (request.method !== "POST") return reply(405);
    const env = deps.env();
    if (env.INSTANTLY_WEBHOOK_ENABLED !== "true") return reply(404);
    let cfg: ReturnType<typeof config>;
    try {
      cfg = config(env);
    } catch {
      return reply(503);
    }
    if (!sameToken(request.headers.get("X-S00-Webhook-Token") ?? "", cfg.token))
      return reply(401);
    let nonce: string;
    try {
      nonce = nonceSchema.parse((await context.params).nonce);
    } catch {
      return reply(404);
    }
    if (
      !locationMatches(request, "/api/integrations/instantly/webhook/" + nonce)
    )
      return reply(404);
    try {
      const client = deps.client();
      const admission = deps.admit
        ? await deps.admit(client, nonce)
        : undefined;
      if (admission && admission.status !== 200)
        return reply(
          [404, 410, 429].includes(admission.status) ? admission.status : 503,
        );
      const trial = admission
        ? admission.trial
        : await readInstantlyTrial(client, nonce);
      if (!trial) return reply(404);
      if (trial.manifest.url !== urlFor(cfg.origin, nonce)) return reply(503);
      cSecrets(
        {
          INSTANTLY_S00_WEBHOOK_SECRET: cfg.token,
          INSTANTLY_S00_WEBHOOK_DEDUP_KEY: cfg.key,
        },
        trial.manifest,
      );
      if (!trial.state) return reply(410);
      const receiver = createInstantlyDbReceiver({
        client,
        trial,
        token: cfg.token,
        key: cfg.key,
        now: deps.now,
      });
      // Trust the configured origin, never forwarded host/proto or the proxy's internal URL.
      const canonical = new Request(trial.manifest.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: request.signal,
        duplex: "half",
      } as RequestInit);
      return await receiver.handle(canonical);
    } catch {
      return reply(503);
    }
  };
}
export function instantlyTrialEndpoint(deps: Deps) {
  return async (request: Request, context: InstantlyRouteContext) => {
    if (!["GET", "POST"].includes(request.method)) return reply(405);
    const env = deps.env();
    if (env.INSTANTLY_WEBHOOK_ENABLED !== "true") return reply(404);
    let auth: Auth;
    try {
      if (request.method === "POST") {
        if (!deps.checkOrigin) return reply(503);
        deps.checkOrigin(request);
      }
      if (!deps.authorize) return reply(503);
      auth = await deps.authorize();
    } catch (e) {
      const status =
        e &&
        typeof e === "object" &&
        "status" in e &&
        (e.status === 401 || e.status === 403)
          ? e.status
          : 403;
      return reply(status);
    }
    if (auth.role !== "superadmin" || !auth.active || auth.aal !== "aal2")
      return reply(403);
    let nonce: string, cfg: ReturnType<typeof config>;
    try {
      nonce = nonceSchema.parse((await context.params).nonce);
      cfg = config(env);
    } catch {
      return reply(503);
    }
    if (
      !locationMatches(request, "/api/integrations/instantly/trials/" + nonce)
    )
      return reply(404);
    let input: unknown;
    if (request.method === "POST")
      try {
        input = await boundedControlJson(request);
      } catch {
        return reply(400);
      }
    try {
      let action:
        | {
            action: "prepare";
            manifest: unknown;
            workspace: string;
            campaign: string;
          }
        | { action: "arm" | "close" }
        | undefined;
      if (request.method === "POST") {
        const p = z
          .discriminatedUnion("action", [
            z
              .object({
                action: z.literal("prepare"),
                manifest: z.unknown(),
                workspace: z.string().uuid(),
                campaign: z.string().uuid(),
              })
              .strict(),
            z.object({ action: z.enum(["arm", "close"]) }).strict(),
          ])
          .safeParse(input);
        if (!p.success) return reply(400);
        action = p.data;
        if (action.action === "prepare") {
          let m;
          try {
            m = validateCManifest(action.manifest);
            cSecrets(
              {
                INSTANTLY_S00_WEBHOOK_SECRET: cfg.token,
                INSTANTLY_S00_WEBHOOK_DEDUP_KEY: cfg.key,
              },
              m,
            );
          } catch {
            return reply(400);
          }
          if (m.nonce !== nonce || m.url !== urlFor(cfg.origin, nonce))
            return reply(400);
          const client = deps.client();
          await prepareInstantlyTrial(
            client,
            m,
            action.workspace,
            action.campaign,
          );
          const trial = await readInstantlyTrial(client, nonce);
          return trial ? reply(200, summary(trial)) : reply(503);
        }
      }
      const client = deps.client(),
        trial = await readInstantlyTrial(client, nonce);
      if (!trial) return reply(404);
      if (trial.manifest.url !== urlFor(cfg.origin, nonce)) return reply(503);
      cSecrets(
        {
          INSTANTLY_S00_WEBHOOK_SECRET: cfg.token,
          INSTANTLY_S00_WEBHOOK_DEDUP_KEY: cfg.key,
        },
        trial.manifest,
      );
      const receiver = createInstantlyDbReceiver({
        client,
        trial,
        token: cfg.token,
        key: cfg.key,
        now: deps.now,
      });
      if (action?.action === "arm") await receiver.arm();
      else if (action?.action === "close") await receiver.close();
      const result = await readInstantlyTrial(client, nonce);
      return result ? reply(200, summary(result)) : reply(503);
    } catch {
      return reply(503);
    }
  };
}
