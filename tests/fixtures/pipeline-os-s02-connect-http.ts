import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connectStoreCompositionFixture } from "./pipeline-os-s02-connect-store-composition";
import { createConnectSecrets } from "../../src/lib/server/mail-accounts/composio-connect/secrets";
import { createHttpCorrelation } from "../../src/lib/server/mail-accounts/composio-connect/http-correlation";
import { connectProviderConfigSchema } from "../../src/lib/server/mail-accounts/composio-connect/config";
import {
  withConnectHttpPorts,
  type ConnectHttpPorts,
  type ConnectHttpConfiguration,
} from "../../src/lib/server/mail-accounts/composio-connect/http";
import {
  GET as options,
  POST as begin,
} from "../../src/app/api/mail/composio/connect/route";
import { GET as status } from "../../src/app/api/mail/composio/connect/[id]/route";
import { POST as action } from "../../src/app/api/mail/composio/connect/[id]/[action]/route";
import { GET as callback } from "../../src/app/api/mail/composio/connect/callback/route";
export async function connectHttpFixture() {
  const f = await connectStoreCompositionFixture();
  const cookies = new Map<
      string,
      { value: string; options: Record<string, unknown> }
    >(),
    calls: { path: string; method: string }[] = [];
  const links = new Map<string, { owner: string; email: string }>();
  let enabled = true,
    foreign = false,
    networkFailure = false,
    offset = 0,
    configCalls = 0,
    rpcCalls = 0;
  const config: ConnectHttpConfiguration = {
    descriptor: connectProviderConfigSchema.parse(f.descriptor),
    organizations: [{ id: "fixture", label: "Marca de ensayo" }],
    secrets: createConnectSecrets({
      activeKeyId: "fixture",
      keys: { fixture: Buffer.alloc(32, 17) },
      randomBytes,
    }),
    material: createHttpCorrelation(Buffer.alloc(32, 17)),
    credential: {
      version: f.descriptor.context.credential_version,
      api_key: "fictional-http-key",
    },
    fingerprint: "fixture-http-v1",
  };
  const human = f.client(true),
    db = {
      rpc: async (name: string, p: Record<string, unknown>) => {
        rpcCalls++;
        if (name.startsWith("composio_connect_runtime_"))
          return human.rpc(name, p);
        try {
          await f.human();
          if (name === "brand_management_page")
            return {
              data: await f.scalar("select brand_management_page($1,$2,$3) v", [
                p.collection,
                p.cursor,
                p.page_size,
              ]),
              error: null,
            };
          if (name === "composio_binding_page")
            return {
              data: await f.scalar("select composio_binding_page($1,$2,$3) v", [
                p.account,
                p.cursor,
                p.page_size,
              ]),
              error: null,
            };
          throw Error("UNLISTED_RPC");
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        }
      },
    } as unknown as SupabaseClient;
  const p: ConnectHttpPorts = {
    enabled: () => enabled,
    configuration: () => {
      configCalls++;
      return config;
    },
    now: () => Date.now() + offset,
    uuid: randomUUID,
    proof: () => randomBytes(32).toString("base64url"),
    user: async () => ({
      db,
      profile: { id: f.users.admin, role: "superadmin", active: true },
      session: async () => structuredClone(f.session),
    }),
    service: () => f.client(false),
    jar: async () => ({
      get: (n) => cookies.get(n),
      set: (n, value, options) => {
        cookies.set(n, { value, options });
      },
    }),
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname,
        body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path, method: init?.method ?? "GET" });
      if (path.endsWith("/link")) {
        if (networkFailure) throw Error("fixture unknown emission");
        await f.owner();
        const a = await f.scalar<{
          id: string;
          email: string;
          deadline: string;
        }>(
          "select jsonb_build_object('id',a.id,'email',s.email,'deadline',a.deadline) v from composio_connect.attempts a join composio_connect.subjects s on s.id=a.subject_id where a.owner_id=$1 order by a.created_at desc limit 1",
          [body.user_id],
        );
        const id = "ca_" + a.id.replaceAll("-", "");
        links.set(id, { owner: body.user_id, email: a.email });
        return Response.json(
          {
            connected_account_id: id,
            redirect_url:
              "https://connect.composio.dev/link/fixture_" +
              a.id.replaceAll("-", ""),
            expires_at: a.deadline,
          },
          { status: 201 },
        );
      }
      if (path.includes("/connected_accounts/")) {
        const id = path.split("/").at(-1)!,
          l = links.get(id)!;
        return Response.json({
          id,
          user_id: l.owner,
          toolkit: { slug: "gmail" },
          authScheme: "OAUTH2",
          auth_config: {
            id: config.descriptor.config.auth_config_id,
            auth_scheme: "OAUTH2",
            is_disabled: false,
          },
          status: "ACTIVE",
          is_disabled: false,
        });
      }
      if (path.includes("/auth_configs/"))
        return Response.json({
          id: config.descriptor.config.auth_config_id,
          toolkit: { slug: "gmail" },
          auth_scheme: "OAUTH2",
          status: "ENABLED",
        });
      const l = links.get(body.connected_account_id)!;
      return Response.json({
        status: 200,
        data: { emailAddress: foreign ? "other@fixture.test" : l.email },
      });
    },
  };
  const origin = config.descriptor.callback_origin;
  const request = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request(origin + path, {
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            body: typeof body === "string" ? body : JSON.stringify(body),
          }),
      headers: {
        ...(body === undefined
          ? {}
          : {
              Origin: origin,
              "Content-Type":
                typeof body === "string"
                  ? "application/x-www-form-urlencoded"
                  : "application/json",
            }),
        ...headers,
      },
    });
  const run = <T>(fn: () => Promise<T>) => withConnectHttpPorts(p, fn);
  async function intent(overrides: Record<string, unknown> = {}) {
    await f.owner();
    return {
      mode: "new",
      idempotency_key: randomUUID(),
      brand_id: f.brandA.brand_id,
      expected_brand_revision: await f.scalar<number>(
        "select revision::int v from operating_brands where id=$1",
        [f.brandA.brand_id],
      ),
      email: `http-${randomUUID().slice(0, 8)}@fixture.test`,
      organization: "fixture",
      expected_account_revision: 0,
      expected_head_revision: 0,
      expected_config_generation: 2,
      ...overrides,
    };
  }
  return {
    ...f,
    p,
    config,
    cookies,
    calls,
    origin,
    request,
    run,
    intent,
    get configCalls() {
      return configCalls;
    },
    get rpcCalls() {
      return rpcCalls;
    },
    disable() {
      enabled = false;
    },
    wrongMailbox() {
      foreign = true;
    },
    failNetwork() {
      networkFailure = true;
    },
    advance(ms: number) {
      offset += ms;
    },
    options: (q = "") =>
      run(() => options(request("/api/mail/composio/connect" + q))),
    begin: (body: unknown, headers?: Record<string, string>) =>
      run(() => begin(request("/api/mail/composio/connect", body, headers))),
    status: (id: string) =>
      run(() =>
        status(request(`/api/mail/composio/connect/${id}`), {
          params: Promise.resolve({ id }),
        }),
      ),
    action: (
      id: string,
      kind: string,
      body: unknown,
      headers?: Record<string, string>,
    ) =>
      run(() =>
        action(
          request(`/api/mail/composio/connect/${id}/${kind}`, body, headers),
          { params: Promise.resolve({ id, action: kind }) },
        ),
      ),
    callback: (url: string) => run(() => callback(new Request(url))),
    cookie: (id: string) =>
      JSON.parse(
        Buffer.from(
          cookies.get("__Host-crm-connect-" + id)!.value,
          "base64url",
        ).toString("utf8"),
      ),
  };
}
