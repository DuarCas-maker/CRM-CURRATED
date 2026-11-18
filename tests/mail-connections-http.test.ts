import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  simpleMailHttp,
  withSimpleMailHttp,
} from "../src/lib/server/mail-accounts/onboarding/http";
import {
  createOnboarding,
  type OnboardingPorts,
} from "../src/lib/server/mail-accounts/onboarding/service";
import { HttpError } from "../src/lib/server/supabase";
import {
  withIncludedUsage,
  includedComposioFetch,
} from "../src/lib/server/mail-accounts/onboarding/included";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connectHttpFixture } from "./fixtures/pipeline-os-s02-connect-http";
import { simpleMailComposioEnabled } from "../src/lib/mail-connections";

function fixture() {
  const actor = randomUUID(),
    advisor = randomUUID(),
    events: string[] = [],
    rows = new Map<string, any>(),
    requests = new Map<string, string>();
  let enabled = true,
    composioEnabled = true,
    denied = false,
    free = false;
  const view = (r: any) => ({
    id: r.id,
    email: r.email,
    provider: r.provider,
    state: r.state,
    account_id: r.account_id,
    advisor_id: r.advisor_id,
    error: null,
  });
  const rpc = (role: string) =>
    ({
      rpc: async (name: string, p: Record<string, any> = {}) => {
        events.push(role + ":" + name);
        let data: any;
        if (name === "simple_mail_options")
          data = {
            enabled: true,
            included_available: free,
            advisors: [
              {
                id: advisor,
                name: "Asesor de prueba",
                email: "advisor@example.test",
              },
            ],
            connections: [...rows.values()].map(view),
          };
        else if (name === "simple_mail_begin") {
          let id = requests.get(p.p.idempotency_key);
          if (!id) {
            id = randomUUID();
            requests.set(p.p.idempotency_key, id);
            rows.set(id, {
              id,
              actor_id: actor,
              advisor_id: advisor,
              request_key: p.p.idempotency_key,
              ...p.p,
              organization: p.organization,
              domain: p.domain,
              brand_id: randomUUID(),
              state_hash: p.state_hash,
              encrypted_state: p.encrypted_state,
              account_id: null,
              provider_attempt_id: null,
              identity_saved: false,
              exchange_started: false,
              deadline: new Date(Date.now() + 600000).toISOString(),
              state: "prepared",
            });
          }
          data = view(rows.get(id));
        } else if (name === "simple_mail_get") data = view(rows.get(p.id));
        else if (name === "simple_mail_private") data = { ...rows.get(p.id) };
        else if (name === "simple_mail_included_available") data = free;
        else if (name === "simple_mail_update") {
          const r = rows.get(p.id);
          r.state = "authorizing";
          data = view(r);
        } else if (name === "simple_mail_confirm") {
          data = view(rows.get(p.id));
        } else if (name === "simple_mail_finalize") {
          const r = rows.get(p.id);
          r.state = "ready";
          data = view(r);
        } else if (name === "simple_mail_disconnect") {
          const r = rows.get(p.id);
          r.state = "disconnected";
          data = view(r);
        } else throw Error("Unexpected RPC " + name);
        return { data, error: null };
      },
    }) as unknown as SupabaseClient;
  const p: OnboardingPorts = {
    human: rpc("human"),
    service: rpc("service"),
    workspace: () => ({ id: "fixture", domain: "example.test" }),
    state: () => "fixture-state-" + randomUUID(),
    encrypt: (v) => "fictional-encrypted:" + v,
    decrypt: (v) => v.slice("fictional-encrypted:".length),
    directUrl: async (r, state) =>
      "https://accounts.google.com/o/oauth2/auth?state=" +
      encodeURIComponent(state),
    composioBegin: async () => {
      events.push("provider-link");
      return randomUUID();
    },
    composioUrl: async () => "https://connect.composio.dev/fixture",
    composioPrepare: async () => true,
    activate: async () => {
      events.push("activate");
    },
  };
  const request = (body?: unknown, origin = "https://crm.example.test") =>
    new Request(
      "https://crm.example.test/api/mail/connections",
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { origin, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  const ports = {
    enabled: () => enabled,
    composioEnabled: () => composioEnabled,
    authorize: async () => {
      events.push("authorize");
      if (denied) throw new HttpError(403, "SIMPLE_FORBIDDEN");
    },
    origin: (r: Request) => {
      if (r.headers.get("origin") !== "https://crm.example.test")
        throw new HttpError(403, "SIMPLE_FORBIDDEN");
    },
    onboarding: async () => p,
  };
  const run = (r: Request, id?: string, action?: "continue" | "disconnect") =>
    withSimpleMailHttp(ports, () => simpleMailHttp(r, id, action));
  return {
    p,
    events,
    rows,
    advisor,
    request,
    run,
    close: () => {
      enabled = false;
    },
    deny: () => {
      denied = true;
    },
    setFree: () => {
      free = true;
    },
    closeComposio: () => {
      composioEnabled = false;
    },
  };
}
test("Connection HTTP rejects closed, unauthorized, cross-origin, invalid and oversized requests before effects", async () => {
  for (const kind of [
    "closed",
    "unauthorized",
    "origin",
    "invalid",
    "oversized",
  ]) {
    const f = fixture();
    let r: Request;
    if (kind === "closed") f.close();
    if (kind === "unauthorized") f.deny();
    const body = {
      email: "advisor@example.test",
      provider: "gmail_oauth",
      idempotency_key: randomUUID(),
    };
    r = f.request(
      kind === "invalid" ? { ...body, brand_id: randomUUID() } : body,
      kind === "origin"
        ? "https://foreign.example.test"
        : "https://crm.example.test",
    );
    if (kind === "oversized")
      r = new Request(r.url, {
        method: "POST",
        headers: {
          origin: "https://crm.example.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "x".repeat(3000) }),
      });
    const response = await f.run(r);
    assert.ok([400, 403, 413, 503].includes(response.status));
    assert.ok(
      !f.events.some(
        (e) => e.includes("simple_mail_begin") || e.includes("provider-link"),
      ),
    );
  }
});
test("Gmail-only release blocks Composio even with free capacity, including resuming an existing attempt", async () => {
  const f = fixture();
  f.setFree();
  const existing = await (
    await f.run(
      f.request({
        email: "advisor@example.test",
        provider: "composio",
        idempotency_key: randomUUID(),
      }),
    )
  ).json();
  assert.equal(f.rows.size, 1);
  f.closeComposio();
  const before = [...f.events];
  const denied = await f.run(
    f.request({
      email: "advisor@example.test",
      provider: "composio",
      idempotency_key: randomUUID(),
    }),
  );
  assert.equal(denied.status, 409);
  assert.equal((await denied.json()).code, "SIMPLE_COMPOSIO_DISABLED");
  assert.equal(f.rows.size, 1);
  const resumed = await f.run(f.request({}), existing.id, "continue");
  assert.equal(resumed.status, 409);
  assert.equal((await resumed.json()).code, "SIMPLE_COMPOSIO_DISABLED");
  assert.equal(
    f.events.filter((e) => e === "provider-link").length,
    before.filter((e) => e === "provider-link").length,
  );
  const options = await (await f.run(f.request())).json();
  assert.equal(options.composio_enabled, false);
  assert.equal(options.included_available, false);
  const direct = await f.run(
    f.request({
      email: "advisor@example.test",
      provider: "gmail_oauth",
      idempotency_key: randomUUID(),
    }),
  );
  assert.equal(direct.status, 200);
});

test("Composio product flag is closed by default and cannot be enabled without the main feature", () => {
  const keys = ["SIMPLE_MAIL_ENABLED", "SIMPLE_MAIL_COMPOSIO_ENABLED"] as const;
  const prior = keys.map((k) => process.env[k]);
  try {
    process.env.SIMPLE_MAIL_ENABLED = "true";
    delete process.env.SIMPLE_MAIL_COMPOSIO_ENABLED;
    assert.equal(simpleMailComposioEnabled(), false);
    process.env.SIMPLE_MAIL_COMPOSIO_ENABLED = "true";
    assert.equal(simpleMailComposioEnabled(), true);
    process.env.SIMPLE_MAIL_ENABLED = "false";
    assert.equal(simpleMailComposioEnabled(), false);
  } finally {
    keys.forEach((key, i) => {
      if (prior[i] === undefined) delete process.env[key];
      else process.env[key] = prior[i];
    });
  }
});

test("Repeated connect returns same durable state and authorization URL without leaking private correlation", async () => {
  const f = fixture(),
    body = {
      email: "advisor@example.test",
      provider: "gmail_oauth",
      idempotency_key: randomUUID(),
    };
  const first = await (await f.run(f.request(body))).json(),
    second = await (await f.run(f.request(body))).json();
  assert.equal(first.id, second.id);
  assert.equal(first.authorization_url, second.authorization_url);
  assert.equal(f.rows.size, 1);
  assert.ok(!JSON.stringify(first).includes("fictional-encrypted"));
  assert.ok(!Object.hasOwn(first, "state_hash"));
  const options = await f.run(f.request());
  assert.equal(options.status, 200);
  assert.equal(options.headers.get("cache-control"), "no-store");
});
test("Composio without included capacity does not create even an onboarding/link", async () => {
  const f = fixture();
  const response = await f.run(
    f.request({
      email: "advisor@example.test",
      provider: "composio",
      idempotency_key: randomUUID(),
    }),
  );
  assert.equal(response.status, 409);
  assert.equal(f.rows.size, 0);
  assert.ok(!f.events.includes("provider-link"));
});
test("Thirty-day setup resumes from a saved identity and finalizes once ready", async () => {
  const f = fixture(),
    api = createOnboarding(f.p);
  const first = await api.begin({
    email: "advisor@example.test",
    provider: "gmail_oauth",
    idempotency_key: randomUUID(),
  });
  const row = f.rows.get(first.id);
  row.identity_saved = true;
  row.state = "preparing";
  row.account_id = randomUUID();
  const result = await api.continue(first.id);
  assert.equal(result.state, "ready");
  assert.equal((await api.continue(first.id)).state, "ready");
  assert.equal(f.events.filter((e) => e === "activate").length, 1);
});
test("A pending code exchange does not reopen Google; an expired authorization requires explicit reconnect", async () => {
  const f = fixture(),
    api = createOnboarding(f.p);
  const first = await api.begin({
    email: "advisor@example.test",
    provider: "gmail_oauth",
    idempotency_key: randomUUID(),
  });
  const row = f.rows.get(first.id);
  row.exchange_started = true;
  row.state = "preparing";
  assert.equal((await api.continue(first.id)).authorization_url, undefined);
  row.deadline = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(api.continue(first.id), /SIMPLE_AUTHORIZATION_REQUIRED/);
});
test("Included guard charges each attempted request and never emits when capacity is unknown", async () => {
  let reserves = 0,
    wires = 0,
    available = true;
  const keys = new Set<string>();
  const scope = {
    account: randomUUID(),
    reserve: async (key: string) => {
      reserves++;
      keys.add(key);
      return available;
    },
  };
  const fake: typeof fetch = async () => {
    wires++;
    return Response.json({ ok: true });
  };
  await withIncludedUsage(scope, async () => {
    await includedComposioFetch(
      "https://backend.composio.dev/api/v3.1/tools/execute/proxy",
      { method: "POST" },
      fake,
    );
    await includedComposioFetch(
      "https://backend.composio.dev/api/v3.1/tools/execute/proxy",
      { method: "POST" },
      fake,
    );
    available = false;
    await assert.rejects(
      includedComposioFetch(
        "https://backend.composio.dev/api/v3.1/tools/execute/proxy",
        {},
        fake,
      ),
      /SIMPLE_INCLUDED_UNAVAILABLE/,
    );
    await assert.rejects(
      includedComposioFetch("https://foreign.example.test/", {}, fake),
      /SIMPLE_INCLUDED_UNAVAILABLE/,
    );
  });
  assert.equal(reserves, 3);
  assert.equal(keys.size, 3);
  assert.equal(wires, 2);
});

test("actual Composio callback reserves every metadata/profile request and blocks unknown free capacity", async () => {
  const previous = process.env.SIMPLE_MAIL_ENABLED;
  for (const available of [true, false]) {
    const f = await connectHttpFixture();
    try {
      delete process.env.SIMPLE_MAIL_ENABLED;
      const body = await f.intent();
      const begun = await (await f.begin(body)).json();
      const id = begun.status.id;
      assert.equal(
        (
          await f.action(id, "start", {
            expected_revision: begun.status.revision,
            idempotency_key: randomUUID(),
          })
        ).status,
        200,
      );
      const original = f.p.service;
      const reservations: any[] = [];
      f.p.service = () => ({
        rpc: async (name, p) => {
          if (name === "simple_mail_included_reserve") {
            reservations.push(p);
            return { data: available, error: null };
          }
          return original().rpc(name, p);
        },
      });
      const callback = new URL("/api/mail/composio/connect/callback", f.origin);
      callback.searchParams.set(
        "state",
        f.config.material(f.session, body.idempotency_key).state,
      );
      callback.searchParams.set("status", "success");
      callback.searchParams.set(
        "connected_account_id",
        "ca_" + id.replaceAll("-", ""),
      );
      const before = f.calls.length;
      process.env.SIMPLE_MAIL_ENABLED = "true";
      assert.equal((await f.callback(callback.href)).status, 303);
      if (available) {
        assert.ok(f.calls.length > before);
        assert.equal(reservations.length, f.calls.length - before);
        assert.equal(reservations.filter((r) => r.proxy === 1).length, 1);
        assert.equal(
          new Set(reservations.map((r) => r.request_key)).size,
          reservations.length,
        );
      } else {
        assert.equal(f.calls.length, before);
        assert.equal(reservations.length, 1);
      }
      assert.ok(
        reservations.every(
          (r) => r.project === f.config.descriptor.config.project_id,
        ),
      );
    } finally {
      await f.db.close();
      if (previous === undefined) delete process.env.SIMPLE_MAIL_ENABLED;
      else process.env.SIMPLE_MAIL_ENABLED = previous;
    }
  }
});

test("simple-mail feature refuses a Composio request outside a budget scope", async () => {
  const previous = process.env.SIMPLE_MAIL_ENABLED;
  process.env.SIMPLE_MAIL_ENABLED = "true";
  let wires = 0;
  try {
    await assert.rejects(
      includedComposioFetch(
        "https://backend.composio.dev/api/v3.1/connected_accounts/ca_fixture",
        {},
        async () => {
          wires++;
          return Response.json({});
        },
      ),
      /SIMPLE_INCLUDED_UNAVAILABLE/,
    );
    assert.equal(wires, 0);
  } finally {
    if (previous === undefined) delete process.env.SIMPLE_MAIL_ENABLED;
    else process.env.SIMPLE_MAIL_ENABLED = previous;
  }
});
