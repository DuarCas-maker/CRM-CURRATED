import { z } from "zod";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ConnectError,
  connectStatus,
  type ConnectConfig,
  type ConnectSession,
} from "../../../composio-connect";
import {
  connectBeginHttp,
  connectCommandHttp,
  connectAdoptHttp,
  connectPendingReview,
  connectOptionsHttp,
  connectViewHttp,
} from "../../../composio-connect-http";
import {
  connectProviderConfigSchema,
  type ConnectProviderConfiguration,
} from "./config";
import { createConnectStore, type ConnectRpcClient } from "./store";
import { createConnectSecrets, type ConnectSecrets } from "./secrets";
import { createHttpCorrelation } from "./http-correlation";
import { createConnectProvider } from "./provider";
import { createComposioConnectOrchestrator } from "./orchestrator";
import {
  connectAuthority,
  connectDigest,
  currentConnectSession,
} from "./session";
import { readBounded } from "../../body";
import { parseBrandPage } from "../../../brand-management";
import { composioBindingPage } from "../composio-binding";
import { mailQuotaEnabled, reserveGmailQuota } from "../../mail-quota";
import { reserveConnectProfileQuota } from "./profile-quota";
const nonce = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const cookieSchema = z.strictObject({
  proof: nonce,
  actor_id: z.uuid(),
  session_hash: z.string().regex(/^[a-f0-9]{64}$/),
  deadline_ms: revision,
  callback_revision: revision.optional(),
  callback_key: z.uuid(),
  pending: connectPendingReview.optional(),
});
type Correlation = z.infer<typeof cookieSchema>;
export type ConnectHttpConfiguration = {
  descriptor: ConnectProviderConfiguration;
  organizations: { id: string; label: string }[];
  secrets: ConnectSecrets;
  credential: { version: string; api_key: string };
  fingerprint: string;
  material: ReturnType<typeof createHttpCorrelation>;
};
type Jar = {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: "lax";
      path: string;
      maxAge: number;
      expires: Date;
    },
  ): unknown;
};
export type ConnectHttpPorts = {
  enabled(): boolean;
  configuration(): ConnectHttpConfiguration;
  user(): Promise<{
    db: SupabaseClient;
    profile: { id: string; role: string; active?: boolean };
    session(): Promise<ConnectSession>;
  }>;
  service(): ConnectRpcClient;
  jar(): Promise<Jar>;
  fetchImpl: typeof fetch;
  now(): number;
  uuid(): string;
  proof(): string;
};
const contexts = new AsyncLocalStorage<ConnectHttpPorts>();
export function withConnectHttpPorts<T>(
  ports: ConnectHttpPorts,
  action: () => Promise<T>,
) {
  return contexts.run(ports, action);
}
const fail = (
  code: ConstructorParameters<typeof ConnectError>[0] = "CONNECT_UNAVAILABLE",
): never => {
  throw new ConnectError(code);
};
export function connectHttpEnabled() {
  const v = process.env.COMPOSIO_CONNECT_ENABLED ?? "false";
  if (!["true", "false"].includes(v)) return fail();
  return v === "true";
}
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
export function connectHttpError(error: unknown) {
  const e =
    error instanceof ConnectError
      ? error
      : new ConnectError("CONNECT_UNAVAILABLE");
  const status =
    e.code === "CONNECT_FORBIDDEN"
      ? 403
      : e.code === "CONNECT_INVALID_INPUT"
        ? 400
        : e.code === "CONNECT_NOT_FOUND"
          ? 404
          : e.code === "CONNECT_UNAVAILABLE"
            ? 503
            : 409;
  return Response.json({ code: e.code, error: e.message }, { status, headers });
}
function currentConfiguration(): ConnectHttpConfiguration {
  try {
    if (!connectHttpEnabled()) return fail();
    const settings = z
      .strictObject({
        descriptor: connectProviderConfigSchema,
        organizations: z
          .array(
            z.strictObject({
              id: z.string().min(1).max(100),
              label: z.string().min(1).max(120),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(JSON.parse(process.env.COMPOSIO_CONNECT_SETTINGS || "{}"));
    if (
      settings.descriptor.callback_origin !== process.env.APP_ORIGIN ||
      new Set(settings.organizations.map((x) => x.id)).size !==
        settings.organizations.length
    )
      return fail();
    const ring = z
      .strictObject({
        activeKeyId: z.string(),
        keys: z.record(z.string(), z.string()),
      })
      .parse(JSON.parse(process.env.COMPOSIO_CONNECT_KEYRING || "{}"));
    const keys = Object.fromEntries(
      Object.entries(ring.keys).map(([id, value]) => {
        const b = Buffer.from(value, "base64url");
        if (b.length !== 32 || b.toString("base64url") !== value) return fail();
        return [id, b];
      }),
    );
    const api_key = z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/)
      .parse(process.env.COMPOSIO_API_KEY);
    return {
      ...settings,
      secrets: createConnectSecrets({
        activeKeyId: ring.activeKeyId,
        keys,
        randomBytes,
      }),
      material: createHttpCorrelation(keys[ring.activeKeyId]),
      credential: {
        version: settings.descriptor.context.credential_version,
        api_key,
      },
      fingerprint: createHash("sha256")
        .update(
          JSON.stringify([settings, ring, api_key, process.env.APP_ORIGIN]),
        )
        .digest("hex"),
    };
  } catch {
    return fail();
  }
}
async function ports(): Promise<ConnectHttpPorts> {
  const injected = contexts.getStore();
  if (injected) return injected;
  const { requireUser, serviceClient } = await import("../../supabase");
  const { cookies } = await import("next/headers");
  return {
    enabled: connectHttpEnabled,
    configuration: currentConfiguration,
    now: Date.now,
    uuid: randomUUID,
    proof: () => randomBytes(32).toString("base64url"),
    jar: async () => await cookies(),
    service: serviceClient,
    fetchImpl: (...args) => fetch(...args),
    user: async () => {
      const u = await requireUser();
      return {
        ...u,
        session: () => verifiedConnectSession(u.db, u.user.id, Date.now()),
      };
    },
  };
}
export async function verifiedConnectSession(
  db: SupabaseClient,
  userId: string,
  now: number,
): Promise<ConnectSession> {
  const { data, error } = await db.auth.getClaims();
  if (error || !data) return fail("CONNECT_FORBIDDEN");
  const c = z
    .object({
      sub: z.uuid(),
      session_id: z.uuid(),
      aal: z.literal("aal2"),
      exp: z.number().int().positive(),
      role: z.literal("authenticated"),
    })
    .safeParse(data.claims);
  if (!c.success || c.data.sub !== userId) return fail("CONNECT_FORBIDDEN");
  const result = await db
    .from("profiles")
    .select("id,role,active,mail_authorization_revision")
    .eq("id", userId)
    .single();
  if (result.error || !result.data || result.data.id !== userId)
    return fail("CONNECT_FORBIDDEN");
  const p = result.data;
  return currentConnectSession(
    {
      actor_id: p.id,
      session_id: c.data.session_id,
      role: p.role,
      active: p.active,
      aal: c.data.aal,
      authorization_revision: p.mail_authorization_revision,
      expires_at_ms: c.data.exp * 1000,
    },
    now,
  );
}
async function context() {
  const p = await ports();
  let u;
  try {
    u = await p.user();
  } catch {
    return fail("CONNECT_FORBIDDEN");
  }
  if (!u.profile.active || u.profile.role !== "superadmin")
    return fail("CONNECT_FORBIDDEN");
  return { p, u };
}
function configFor(c: ConnectHttpConfiguration, config: ConnectConfig) {
  const { owner_id: _owner, ...fixed } = config,
    { owner_id: _template, ...reviewed } = c.descriptor.config;
  if (JSON.stringify(fixed) !== JSON.stringify(reviewed))
    return fail("CONNECT_STALE");
  return { ...c.descriptor, config };
}
function guardOrigin(request: Request, c: ConnectHttpConfiguration) {
  if (request.headers.get("origin") !== c.descriptor.callback_origin)
    return fail("CONNECT_FORBIDDEN");
}
async function jsonBody(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    return fail("CONNECT_INVALID_INPUT");
  try {
    return JSON.parse((await readBounded(request, 16384)).toString("utf8"));
  } catch {
    return fail("CONNECT_INVALID_INPUT");
  }
}
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const out = schema.safeParse(value);
  return out.success ? out.data : fail("CONNECT_INVALID_INPUT");
}
const name = (id: string) => "__Host-crm-connect-" + id;
async function correlation(
  p: ConnectHttpPorts,
  id: string,
  session: ConnectSession,
) {
  const value = (await p.jar()).get(name(id))?.value;
  if (!value || value.length > 8000) return fail("CONNECT_FORBIDDEN");
  let c: Correlation;
  try {
    c = cookieSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    return fail("CONNECT_FORBIDDEN");
  }
  if (
    c.actor_id !== session.actor_id ||
    c.session_hash !== connectDigest(session.session_id)
  )
    return fail("CONNECT_FORBIDDEN");
  if (c.deadline_ms <= p.now()) return fail("CONNECT_CLOSED");
  return c;
}
async function saveCookie(p: ConnectHttpPorts, id: string, c: Correlation) {
  const maxAge = Math.min(600, Math.floor((c.deadline_ms - p.now()) / 1000));
  if (maxAge <= 0) return fail("CONNECT_CLOSED");
  (await p.jar()).set(
    name(id),
    Buffer.from(JSON.stringify(cookieSchema.parse(c))).toString("base64url"),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge,
      expires: new Date(c.deadline_ms),
    },
  );
}
async function runtime(
  ctx: Awaited<ReturnType<typeof context>>,
  c: ConnectHttpConfiguration,
) {
  const { p, u } = ctx;
  const session = () =>
    u.session().then((s) => currentConnectSession(s, p.now()));
  const api = createConnectStore({
    human: u.db,
    service: p.service(),
    secrets: c.secrets,
    session,
    now: p.now,
    uuid: p.uuid,
    proof: p.proof,
    configuration: (config) => configFor(c, config),
  });
  return { api, session };
}
function view(
  snapshot: Parameters<typeof connectStatus>[0],
  pending: Correlation["pending"] | undefined,
  p: ConnectHttpPorts,
) {
  return connectViewHttp.parse({
    status: {
      ...connectStatus(snapshot),
      expected_mailbox_email: snapshot.expected_mailbox_email,
      expired: snapshot.deadline_ms <= p.now(),
    },
    pending: pending ?? null,
    context_changed: false,
  });
}
async function inspect(
  p: ConnectHttpPorts,
  api: ReturnType<typeof createConnectStore>,
  session: ConnectSession,
  id: string,
  cookie: Correlation,
) {
  const result = await api.inspectIntent({
    attempt_id: id,
    authority: connectAuthority(session, cookie.proof),
  });
  if (result.snapshot.attempt.id !== id) return fail();
  if (result.snapshot.attempt.state === "awaiting_brand" && result.review_id)
    cookie.pending = {
      review_id: result.review_id,
      expected_revision: result.snapshot.attempt.revision,
      context_hash: result.snapshot.attempt.context_hash,
    };
  if (result.snapshot.attempt.state === "completed") delete cookie.pending;
  await saveCookie(p, id, cookie);
  return result.snapshot.attempt;
}
async function engine(
  ctx: Awaited<ReturnType<typeof context>>,
  c: ConnectHttpConfiguration,
  api: ReturnType<typeof createConnectStore>,
  session: ConnectSession,
  id: string,
  cookie: Correlation,
) {
  const descriptor = await api.bindConfiguration({
    attempt_id: id,
    authority: connectAuthority(session, cookie.proof),
  });
  const provider = createConnectProvider({
    configuration: configFor(c, descriptor.config),
    expectedConfiguration: descriptor,
    credential: c.credential,
    clock: {
      now: ctx.p.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    fetchImpl: async (input, init) => {
      if (
        !ctx.p.enabled() ||
        ctx.p.configuration().fingerprint !== c.fingerprint
      )
        return fail("CONNECT_STALE");
      if ("contract_version" in c.descriptor.context) {
        const checked = await ctx.p
          .service()
          .rpc("composio_connect_policy_current", {
            attempt: id,
            authority: connectAuthority(session, cookie.proof),
          });
        if (checked.error || checked.data !== true)
          return fail("CONNECT_STALE");
      }
      // Only the pinned Gmail profile proxy needs Gmail units. Metadata/link are separate Composio requests.
      if (
        (mailQuotaEnabled() || "contract_version" in c.descriptor.context) &&
        String(input) ===
          "https://backend.composio.dev/api/v3.1/tools/execute/proxy"
      ) {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : null;
        if (
          init?.method !== "POST" ||
          body?.method !== "GET" ||
          body?.endpoint !==
            "https://gmail.googleapis.com/gmail/v1/users/me/profile"
        )
          return fail();
        const loaded = await api.inspectIntent({
          attempt_id: id,
          authority: connectAuthority(session, cookie.proof),
        });
        const a = loaded.snapshot.attempt;
        if (
          !a.account_id ||
          a.state !== "identity_checking" ||
          a.phase?.kind !== "identity" ||
          body.connected_account_id !== a.connection_id ||
          body.user_id !== a.config.owner_id
        )
          return fail();
        const account = a.account_id,
          phase = a.phase.id;
        const authorize = async () => {
          if (
            !ctx.p.enabled() ||
            ctx.p.configuration().fingerprint !== c.fingerprint
          )
            return fail("CONNECT_STALE");
          const current = currentConnectSession(
            await ctx.u.session(),
            ctx.p.now(),
          );
          if (
            current.actor_id !== session.actor_id ||
            current.session_id !== session.session_id ||
            current.authorization_revision !== session.authorization_revision
          )
            return fail("CONNECT_FORBIDDEN");
          const next = (
            await api.inspectIntent({
              attempt_id: id,
              authority: connectAuthority(current, cookie.proof),
            })
          ).snapshot.attempt;
          if (
            next.state !== "identity_checking" ||
            next.phase?.id !== phase ||
            next.account_id !== account ||
            next.connection_id !== a.connection_id ||
            JSON.stringify(next.config) !== JSON.stringify(a.config) ||
            next.deadline_ms <= ctx.p.now()
          )
            return fail("CONNECT_STALE");
        };
        const lease =
          "contract_version" in c.descriptor.context
            ? await reserveConnectProfileQuota({
                attempt: id,
                phase,
                authority: connectAuthority(session, cookie.proof),
                policy: c.descriptor.context.policy,
                deadline: a.deadline_ms,
                rpc: (name, input) => ctx.p.service().rpc(name, input),
                now: ctx.p.now,
                signal: init.signal ?? undefined,
                authorize,
              })
            : await reserveGmailQuota({
                account,
                provider: "composio",
                path: "profile",
                key: phase,
                deadline: new Date(a.deadline_ms).toISOString(),
                signal: init.signal ?? undefined,
                authorize,
                requiresV2: true,
                legacy: async () => fail(),
              });
        return lease.emit(() => ctx.p.fetchImpl(input, init));
      }
      return ctx.p.fetchImpl(input, init);
    },
  });
  return createComposioConnectOrchestrator({
    store: api.store,
    provider,
    session: { readCurrent: ctx.u.session },
    clock: {
      now: ctx.p.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    callbackOrigin: c.descriptor.callback_origin,
  });
}
const reply = (data: unknown) => Response.json(data, { headers });
const redirect = (url: string) =>
  new Response(null, { status: 303, headers: { ...headers, Location: url } });
export async function connectOptions(request: Request) {
  try {
    const ctx = await context(),
      { p, u } = ctx;
    if (!p.enabled())
      return reply({
        enabled: false,
        generation: 0,
        organizations: [],
        brands: [],
        next_cursor: null,
        account: null,
      });
    const c = p.configuration();
    const q = new URL(request.url).searchParams;
    if (
      [...q.keys()].some(
        (k) =>
          !["account_id", "cursor"].includes(k) || q.getAll(k).length !== 1,
      )
    )
      return fail("CONNECT_INVALID_INPUT");
    const account = q.has("account_id")
        ? parsed(z.uuid(), q.get("account_id"))
        : null,
      cursor = q.get("cursor");
    if (cursor !== null && !z.uuid().safeParse(cursor).success)
      return fail("CONNECT_INVALID_INPUT");
    const result = await u.db.rpc("brand_management_page", {
      collection: "brands",
      cursor,
      page_size: 100,
    });
    if (result.error) return fail();
    const page = parseBrandPage("brands", result.data);
    if (!page || !page.is_admin) return fail();
    const row = account
      ? await composioBindingPage(u.db, account, null, 1)
      : null;
    return reply(
      connectOptionsHttp.parse({
        enabled: true,
        generation: c.descriptor.config.generation,
        organizations: c.organizations,
        brands: page.items
          .filter((b) => b.active)
          .map((b) => ({ id: b.id, name: b.name, revision: b.revision })),
        next_cursor: page.next_cursor,
        account: row
          ? {
              id: row.account.id,
              email: row.account.email,
              account_revision: row.account.account_revision,
              head_revision: row.head_revision,
            }
          : null,
      }),
    );
  } catch (e) {
    return connectHttpError(e);
  }
}
export async function connectBegin(request: Request) {
  try {
    const ctx = await context(),
      { p } = ctx;
    if (!p.enabled()) return fail();
    const c = p.configuration();
    guardOrigin(request, c);
    if (new URL(request.url).search) return fail("CONNECT_INVALID_INPUT");
    const body = parsed(connectBeginHttp, await jsonBody(request));
    if (
      body.organization &&
      !c.organizations.some((o) => o.id === body.organization)
    )
      return fail("CONNECT_INVALID_INPUT");
    const { api, session } = await runtime(ctx, c),
      s = await session(),
      { id, proof, state, callbackKey } = c.material(s, body.idempotency_key);
    const result = await api.beginIntent({
      ...body,
      attempt_id: id,
      browser_proof: proof,
      callback_state: state,
    });
    const a = result.snapshot.attempt;
    let existing: Correlation | undefined;
    try {
      existing = await correlation(p, id, s);
    } catch {
      /* The durable receipt remains the authority for reconstructing this browser binding. */
    }
    const cookie = existing ?? {
      proof,
      actor_id: s.actor_id,
      session_hash: connectDigest(s.session_id),
      deadline_ms: a.deadline_ms,
      callback_key: callbackKey,
    };
    if (cookie.proof !== proof) return fail("CONNECT_FORBIDDEN");
    await saveCookie(p, id, cookie);
    return reply(view(a, cookie.pending, p));
  } catch (e) {
    return connectHttpError(e);
  }
}
export async function connectGetStatus(request: Request, id: unknown) {
  try {
    const ctx = await context(),
      { p } = ctx;
    if (!p.enabled()) return fail();
    if (new URL(request.url).search) return fail("CONNECT_INVALID_INPUT");
    const account = parsed(z.uuid(), id),
      c = p.configuration(),
      { api, session } = await runtime(ctx, c),
      s = await session(),
      cookie = await correlation(p, account, s);
    try {
      return reply(
        view(await inspect(p, api, s, account, cookie), cookie.pending, p),
      );
    } catch (e) {
      if (
        e instanceof ConnectError &&
        e.code === "CONNECT_STALE" &&
        cookie.pending
      )
        return reply({
          status: null,
          pending: cookie.pending,
          context_changed: true,
        });
      throw e;
    }
  } catch (e) {
    return connectHttpError(e);
  }
}
export async function connectAction(
  request: Request,
  id: unknown,
  action: unknown,
) {
  try {
    const ctx = await context(),
      { p } = ctx;
    if (!p.enabled()) return fail();
    const c = p.configuration();
    guardOrigin(request, c);
    if (new URL(request.url).search) return fail("CONNECT_INVALID_INPUT");
    const attempt = parsed(z.uuid(), id),
      kind = parsed(
        z.enum(["start", "resume", "cancel", "register", "adopt"]),
        action,
      ),
      { api, session } = await runtime(ctx, c),
      s = await session(),
      cookie = await correlation(p, attempt, s);
    if (kind === "adopt") {
      const body = parsed(connectAdoptHttp, await jsonBody(request));
      if (!cookie.pending) return fail("CONNECT_NOT_READY");
      const pending = cookie.pending;
      const snapshot = await api.adoptBrand(
        {
          attempt_id: attempt,
          expected_revision: pending.expected_revision,
          idempotency_key: body.idempotency_key,
          fingerprint: connectDigest(
            JSON.stringify([
              "http-adopt",
              attempt,
              pending,
              body.idempotency_key,
            ]),
          ),
          command: "register",
          authority: connectAuthority(s, cookie.proof),
          expected_context_hash: pending.context_hash,
        },
        pending.review_id,
      );
      delete cookie.pending;
      await saveCookie(p, attempt, cookie);
      return reply(view(snapshot.attempt, undefined, p));
    }
    const e = await engine(ctx, c, api, s, attempt, cookie);
    if (kind === "resume") {
      if (
        request.headers.get("content-type")?.split(";")[0] !==
          "application/x-www-form-urlencoded" ||
        (await readBounded(request, 1024)).length
      )
        return fail("CONNECT_INVALID_INPUT");
      const a = await inspect(p, api, s, attempt, cookie),
        nav = await e.resume({
          attempt_id: attempt,
          browser_proof: cookie.proof,
        });
      cookie.callback_revision = a.revision;
      await saveCookie(p, attempt, cookie);
      return redirect(nav.url);
    }
    const body = parsed(connectCommandHttp, await jsonBody(request));
    await e[kind]({
      attempt_id: attempt,
      browser_proof: cookie.proof,
      ...body,
    });
    const a = await inspect(p, api, s, attempt, cookie);
    if (kind === "start") {
      cookie.callback_revision = a.revision;
      await saveCookie(p, attempt, cookie);
    }
    return reply(view(a, cookie.pending, p));
  } catch (e) {
    return connectHttpError(e);
  }
}
export async function connectCallback(request: Request) {
  try {
    const ctx = await context(),
      { p } = ctx;
    if (!p.enabled()) return fail();
    const c = p.configuration(),
      q = new URL(request.url).searchParams;
    if (
      [...q.keys()].some(
        (k) =>
          !["state", "status", "connected_account_id"].includes(k) ||
          q.getAll(k).length !== 1,
      )
    )
      return fail("CONNECT_INVALID_INPUT");
    const state = parsed(nonce, q.get("state")),
      id = parsed(z.uuid(), state.slice(0, 36));
    if (state[36] !== "_") return fail("CONNECT_INVALID_INPUT");
    const status = parsed(z.enum(["success", "failed"]), q.get("status"));
    const connection = q.has("connected_account_id")
      ? parsed(
          z.string().regex(/^ca_[A-Za-z0-9_-]{1,128}$/),
          q.get("connected_account_id"),
        )
      : undefined;
    if (status === "success" && !connection)
      return fail("CONNECT_INVALID_INPUT");
    const { api, session } = await runtime(ctx, c),
      s = await session(),
      cookie = await correlation(p, id, s);
    if (cookie.callback_revision === undefined)
      return fail("CONNECT_NOT_READY");
    const e = await engine(ctx, c, api, s, id, cookie);
    try {
      await e.callback({
        attempt_id: id,
        expected_revision: cookie.callback_revision,
        idempotency_key: cookie.callback_key,
        browser_proof: cookie.proof,
        state,
        status,
        connected_account_id: connection,
      });
      await inspect(p, api, s, id, cookie);
    } catch (e) {
      if (
        e instanceof ConnectError &&
        !["CONNECT_FORBIDDEN", "CONNECT_INVALID_INPUT"].includes(e.code)
      )
        return redirect(
          c.descriptor.callback_origin +
            "/?composio_connect=" +
            encodeURIComponent(id) +
            "&connect_error=" +
            e.code,
        );
      throw e;
    }
    return redirect(
      c.descriptor.callback_origin +
        "/?composio_connect=" +
        encodeURIComponent(id),
    );
  } catch (e) {
    return connectHttpError(e);
  }
}
