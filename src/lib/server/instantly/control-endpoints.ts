import { randomBytes } from "node:crypto";
import { z } from "zod";
import { cSecrets } from "./receiver";
import {
  instantlyRpc,
  parseInstantlyTrial,
  type Trial,
  type WebhookRpcClient,
} from "./store";
import {
  controlHash,
  controlSnapshotSchema,
  controlTicketSchema,
  nonceSchema,
  validateCAppManifest,
} from "./control-contract";
type Env = Readonly<Record<string, string | undefined>>;
type Context = { params: Promise<{ nonce: string }> };
type Actor = { id: string; role: string; active: boolean; aal: string };
type Deps = {
  env: () => Env;
  client: () => WebhookRpcClient;
  authorize?: () => Promise<Actor>;
  checkOrigin?: (r: Request) => void;
  randomToken?: () => string;
};
const reply = (status: number, body?: unknown) =>
  body === undefined
    ? new Response(null, { status, headers: { "cache-control": "no-store" } })
    : Response.json(body, { status, headers: { "cache-control": "no-store" } });
const resultSchema = z
  .object({
    status: z.number().int(),
    snapshot: controlSnapshotSchema.optional(),
  })
  .strict();
async function body(request: Request) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw Error("INVALID_INPUT");
  const reader = request.body?.getReader();
  if (!reader) throw Error("INVALID_INPUT");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("INVALID_INPUT")), 8000);
      }),
      chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const p = await Promise.race([reader.read(), timeout]);
      if (p.done) break;
      size += p.value.length;
      if (size > 16384) throw Error("INVALID_INPUT");
      chunks.push(p.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function location(request: Request, origin: string, path: string) {
  const u = new URL(request.url),
    o = new URL(origin);
  return (
    o.protocol === "https:" &&
    o.origin === origin &&
    u.pathname === path &&
    !u.search &&
    !u.hash &&
    !u.username &&
    !u.password
  );
}
export function instantlyLeaseEndpoint(deps: Deps) {
  return async (request: Request, ctx: Context) => {
    if (request.method !== "POST") return reply(405);
    const env = deps.env();
    if (env.INSTANTLY_WEBHOOK_ENABLED !== "true") return reply(404);
    let actor: Actor;
    try {
      if (!deps.checkOrigin || !deps.authorize) return reply(503);
      deps.checkOrigin(request);
      actor = await deps.authorize();
    } catch {
      return reply(403);
    }
    if (
      actor.role !== "superadmin" ||
      !actor.active ||
      actor.aal !== "aal2" ||
      !z.string().uuid().safeParse(actor.id).success
    )
      return reply(403);
    let m: ReturnType<typeof validateCAppManifest>,
      nonce: string,
      intent: string;
    try {
      nonce = nonceSchema.parse((await ctx.params).nonce);
      const p = z
        .object({ intentId: z.string().uuid(), manifest: z.unknown() })
        .strict()
        .parse(await body(request));
      m = validateCAppManifest(p.manifest);
      intent = p.intentId;
      if (
        m.origin !== env.APP_ORIGIN ||
        m.receiverManifest.nonce !== nonce ||
        !location(
          request,
          m.origin,
          "/api/integrations/instantly/trials/" + nonce + "/lease",
        )
      )
        return reply(400);
      cSecrets(env, m.receiverManifest);
    } catch {
      return reply(400);
    }
    try {
      const token = (
        deps.randomToken ?? (() => randomBytes(32).toString("hex"))
      )();
      if (
        !/^[a-f0-9]{64}$/.test(token) ||
        [
          env.INSTANTLY_API_KEY,
          env.INSTANTLY_S00_WEBHOOK_SECRET,
          env.INSTANTLY_S00_WEBHOOK_DEDUP_KEY,
        ].includes(token)
      )
        return reply(503);
      const raw = await instantlyRpc(
        deps.client(),
        "instantly_webhook_control_issue",
        {
          p_actor: actor.id,
          p_nonce: nonce,
          p_manifest: m.receiverManifest,
          p_hash: controlHash(JSON.stringify(m.receiverManifest)),
          p_workspace: m.source.workspaceId,
          p_campaign: m.source.campaignId,
          p_token_hash: controlHash(token),
          p_intent: intent,
        },
      );
      const parsed = z
        .object({
          status: z.number().int(),
          leaseId: z.string().uuid().optional(),
          intentId: z.string().uuid().optional(),
          expiresAt: z.number().int().positive().optional(),
          snapshot: controlSnapshotSchema.optional(),
        })
        .strict()
        .parse(raw);
      if (parsed.status !== 201)
        return reply(
          [400, 403, 409].includes(parsed.status) ? parsed.status : 503,
        );
      const s = parsed.snapshot!;
      if (
        s.nonce !== nonce ||
        s.sourceHash !== m.source.canonicalHash ||
        s.manifestHash !== controlHash(JSON.stringify(m.receiverManifest)) ||
        s.armed
      )
        return reply(503);
      const ticket = controlTicketSchema.parse({
        leaseId: parsed.leaseId,
        intentId: parsed.intentId,
        expiresAt: parsed.expiresAt,
        nonce,
        sourceHash: s.sourceHash,
        manifestHash: s.manifestHash,
      });
      if (ticket.intentId !== intent) return reply(503);
      return reply(201, {
        ticket,
        credential: { variable: "INSTANTLY_S00_CONTROL_TOKEN", value: token },
      });
    } catch {
      return reply(503);
    }
  };
}
export function instantlyControlEndpoint(deps: Deps) {
  return async (request: Request, ctx: Context) => {
    if (!["GET", "POST"].includes(request.method)) return reply(405);
    const env = deps.env();
    if (env.INSTANTLY_WEBHOOK_ENABLED !== "true") return reply(404);
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) return reply(401);
    let nonce: string, action: string, bucket: string, id: string;
    try {
      nonce = nonceSchema.parse((await ctx.params).nonce);
      if (
        !location(
          request,
          env.APP_ORIGIN ?? "",
          "/api/integrations/instantly/control/" + nonce,
        )
      )
        return reply(404);
      if (
        request.headers.has("origin") &&
        request.headers.get("origin") !== env.APP_ORIGIN
      )
        return reply(403);
      bucket = z
        .enum(["N", "R", "H"])
        .parse(request.headers.get("X-S00-Control-Bucket"));
      id = z
        .string()
        .uuid()
        .parse(request.headers.get("X-S00-Control-Request-Id"));
      action =
        request.method === "GET"
          ? z
              .enum(["probe", "observe", "final"])
              .parse(request.headers.get("X-S00-Control-Action"))
          : z
              .object({ action: z.enum(["arm", "close", "revoke"]) })
              .strict()
              .parse(await body(request)).action;
    } catch {
      return reply(400);
    }
    try {
      const p = resultSchema.parse(
        await instantlyRpc(deps.client(), "instantly_webhook_control_execute", {
          p_nonce: nonce,
          p_token_hash: controlHash(token),
          p_action: action,
          p_bucket: bucket,
          p_request: id,
        }),
      );
      if (p.status !== 200)
        return reply(
          [400, 401, 403, 409, 429].includes(p.status) ? p.status : 503,
        );
      if (!p.snapshot || p.snapshot.nonce !== nonce) return reply(503);
      return reply(200, p.snapshot);
    } catch {
      return reply(503);
    }
  };
}
export async function admitInstantlyCallback(
  client: WebhookRpcClient,
  nonce: string,
): Promise<{ status: number; trial?: Trial }> {
  const raw = z
    .object({ status: z.number().int(), trial: z.unknown().optional() })
    .strict()
    .parse(
      await instantlyRpc(client, "instantly_webhook_control_admit", {
        p_nonce: nonce,
      }),
    );
  if (raw.status !== 200)
    return { status: [404, 410, 429].includes(raw.status) ? raw.status : 503 };
  return { status: 200, trial: parseInstantlyTrial(nonce, raw.trial) };
}
