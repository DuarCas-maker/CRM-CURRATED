import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";
import {
  validateCManifest,
  createCReceiver,
  validateCReceipt,
  type CReceiptState,
} from "../src/lib/server/instantly/receiver";
import {
  prepareInstantlyTrial,
  readInstantlyTrial,
  instantlyReceiptStore,
  createInstantlyDbReceiver,
  type WebhookRpcClient,
} from "../src/lib/server/instantly/store";
import {
  instantlyWebhookEndpoint,
  instantlyTrialEndpoint,
} from "../src/lib/server/instantly/endpoints";

globalThis.fetch = async () => {
  throw Error("REAL_NETWORK_FORBIDDEN");
};
const token = "a".repeat(64),
  key = "b".repeat(64),
  origin = "https://crm.example.invalid",
  hash = (x: string) => createHash("sha256").update(x).digest("hex");
const env = {
  INSTANTLY_WEBHOOK_ENABLED: "true",
  APP_ORIGIN: origin,
  INSTANTLY_S00_WEBHOOK_SECRET: token,
  INSTANTLY_S00_WEBHOOK_DEDUP_KEY: key,
};
let f: Awaited<ReturnType<typeof featureDatabase>>;
let queue: Promise<unknown> = Promise.resolve();
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
const sql: Record<string, { text: string; keys: string[] }> = {
  instantly_webhook_trial_read: {
    text: "select public.instantly_webhook_trial_read($1) result",
    keys: ["p_nonce"],
  },
  instantly_webhook_trial_prepare: {
    text: "select public.instantly_webhook_trial_prepare($1,$2::jsonb,$3,$4::uuid,$5::uuid) result",
    keys: [
      "p_nonce",
      "p_manifest",
      "p_manifest_hash",
      "p_workspace",
      "p_campaign",
    ],
  },
  instantly_webhook_trial_cas: {
    text: "select public.instantly_webhook_trial_cas($1,$2,$3::jsonb) result",
    keys: ["p_nonce", "p_revision", "p_state"],
  },
};
const client: WebhookRpcClient = {
  rpc(name, args) {
    rpcCalls.push({ name, args: structuredClone(args) });
    const operation = queue.then(async () => {
      await f.db.exec("set role service_role");
      try {
        const q = sql[name];
        if (!q) throw Error("RPC_FORBIDDEN");
        return {
          data: (
            await f.db.query<{ result: unknown }>(
              q.text,
              q.keys.map((k) => args[k]),
            )
          ).rows[0].result,
          error: null,
        };
      } catch {
        return { data: null, error: { message: "PRIVATE_SQL_ERROR_SENTINEL" } };
      } finally {
        await f.db.exec("reset role");
      }
    });
    queue = operation.then(() => undefined);
    return operation;
  },
};
before(async () => {
  f = await featureDatabase();
});
after(async () => {
  await queue;
  await f.db.close();
});
async function fixture(prepared = true, armed = true) {
  const nonce = randomBytes(12).toString("hex"),
    now = Number(
      (
        await f.db.query<{ time: string }>(
          "select (extract(epoch from clock_timestamp())*1000)::bigint time",
        )
      ).rows[0].time,
    );
  const manifest = validateCManifest({
    version: 1,
    sourceHash: "c".repeat(64),
    nonce,
    url: origin + "/api/integrations/instantly/webhook/" + nonce,
    startsAt: now - 100,
    endsAt: now + 119900,
    tokenHash: hash(token),
    dedupKeyHash: hash(key),
    controlled: true,
    noAdditionalCost: true,
    persistenceVerified: true,
    logsRedacted: true,
  });
  const workspace = randomUUID(),
    campaign = randomUUID();
  let time = now;
  if (prepared)
    await prepareInstantlyTrial(client, manifest, workspace, campaign);
  const trial = prepared ? await readInstantlyTrial(client, nonce) : undefined;
  if (armed && trial)
    await createInstantlyDbReceiver({
      client,
      trial,
      token,
      key,
      now: () => time,
    }).arm();
  const context = { params: Promise.resolve({ nonce }) };
  const payload = {
    timestamp: new Date(now).toISOString(),
    workspace,
    campaign_id: campaign,
    event_type: "reply_received",
    lead_email: "PRIVATE_EMAIL_SENTINEL@example.invalid",
    reply_text: "PRIVATE_BODY_SENTINEL",
  };
  const request = (
    body: unknown = payload,
    headers: Record<string, string> = {},
  ) =>
    new Request(
      "http://0.0.0.0:3000/api/integrations/instantly/webhook/" + nonce,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-S00-Webhook-Token": token,
          ...headers,
        },
        body: JSON.stringify(body),
      },
    );
  const endpoint = instantlyWebhookEndpoint({
    env: () => env,
    client: () => client,
    now: () => time,
  });
  return {
    manifest,
    nonce,
    workspace,
    campaign,
    context,
    payload,
    request,
    endpoint,
    setTime: (n: number) => (time = n),
    now,
  };
}
test("IA-AC01 default feature and disabled production routes do not create a DB client", async () => {
  let clients = 0;
  for (const value of [undefined, "false", "TRUE"]) {
    const endpoint = instantlyWebhookEndpoint({
      env: () => ({ INSTANTLY_WEBHOOK_ENABLED: value }),
      client: () => {
        clients++;
        throw Error("CLIENT_FORBIDDEN");
      },
    });
    assert.equal(
      (
        await endpoint(new Request(origin, { method: "POST" }), {
          params: Promise.resolve({ nonce: "c".repeat(24) }),
        })
      ).status,
      404,
    );
  }
  const previous = process.env.INSTANTLY_WEBHOOK_ENABLED;
  process.env.INSTANTLY_WEBHOOK_ENABLED = "false";
  try {
    const route =
      await import("../src/app/api/integrations/instantly/webhook/[nonce]/route");
    assert.equal(route.runtime, "nodejs");
    assert.equal(
      (
        await route.POST(new Request(origin, { method: "POST" }), {
          params: Promise.resolve({ nonce: "c".repeat(24) }),
        })
      ).status,
      404,
    );
  } finally {
    if (previous === undefined) delete process.env.INSTANTLY_WEBHOOK_ENABLED;
    else process.env.INSTANTLY_WEBHOOK_ENABLED = previous;
  }
  assert.equal(clients, 0);
});
test("IA-AC03 invalid/missing callback token and nonce reject before privileged access", async () => {
  let clients = 0;
  const endpoint = instantlyWebhookEndpoint({
    env: () => env,
    client: () => {
      clients++;
      throw Error("CLIENT_FORBIDDEN");
    },
  });
  for (const supplied of ["", "bad"])
    assert.equal(
      (
        await endpoint(
          new Request(origin, {
            method: "POST",
            headers: { "X-S00-Webhook-Token": supplied },
          }),
          { params: Promise.resolve({ nonce: "c".repeat(24) }) },
        )
      ).status,
      401,
    );
  assert.equal(
    (
      await endpoint(
        new Request(origin, {
          method: "POST",
          headers: { "X-S00-Webhook-Token": token },
        }),
        { params: Promise.resolve({ nonce: "not-valid" }) },
      )
    ).status,
    404,
  );
  assert.equal(clients, 0);
});
test("IA-AC04/07 durable callback keeps only metadatos and no CRM side effects", async () => {
  const h = await fixture();
  const before = await f.db.query(
    "select (select count(*) from jobs) jobs,(select count(*) from outbox) outbox,(select count(*) from messages) messages,(select count(*) from campaign_events) events",
  );
  const response = await h.endpoint(h.request(), h.context);
  assert.equal(response.status, 200);
  const trial = (await readInstantlyTrial(client, h.nonce))!;
  assert.equal(trial.state!.receipts.length, 1);
  assert.equal(trial.state!.receipts[0].classification, "accepted");
  const stored = JSON.stringify(
    await f.db.query("select * from instantly_webhook_receipts"),
  );
  for (const v of [
    "PRIVATE_EMAIL_SENTINEL",
    "PRIVATE_BODY_SENTINEL",
    token,
    key,
  ])
    assert.ok(!stored.includes(v));
  assert.deepEqual(
    (
      await f.db.query(
        "select (select count(*) from jobs) jobs,(select count(*) from outbox) outbox,(select count(*) from messages) messages,(select count(*) from campaign_events) events",
      )
    ).rows,
    before.rows,
  );
});
test("IA-AC03 internal proxy origin canonicalization ignores spoofed forwarded headers", async () => {
  const h = await fixture();
  assert.equal(
    (
      await h.endpoint(
        h.request(undefined, {
          "x-forwarded-host": "evil.example.invalid",
          "x-forwarded-proto": "http",
        }),
        h.context,
      )
    ).status,
    200,
  );
  const wrong = new Request(
    "http://internal/api/integrations/instantly/webhook/" + h.nonce + "?x=1",
    { method: "POST", headers: { "X-S00-Webhook-Token": token } },
  );
  const n = rpcCalls.length;
  assert.equal((await h.endpoint(wrong, h.context)).status, 404);
  assert.equal(rpcCalls.length, n);
});
test("IA-AC03/07 callback missing schema/oversize/foreign context cannot become business reply", async () => {
  const h = await fixture();
  assert.equal((await h.endpoint(h.request([]), h.context)).status, 400);
  assert.equal(
    (await h.endpoint(h.request({ ...h.payload, workspace: 1 }), h.context))
      .status,
    400,
  );
  assert.equal(
    (
      await h.endpoint(
        h.request({ ...h.payload, reply_text: "x".repeat(262145) }),
        h.context,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await h.endpoint(
        h.request({ ...h.payload, workspace: randomUUID() }),
        h.context,
      )
    ).status,
    200,
  );
  assert.equal(
    (await readInstantlyTrial(client, h.nonce))!.state!.receipts[0]
      .classification,
    "quarantined",
  );
});
test("IA-AC04 duplicate delivery is metadata and distinct body is quarantined", async () => {
  const h = await fixture();
  assert.equal((await h.endpoint(h.request(), h.context)).status, 200);
  assert.equal((await h.endpoint(h.request(), h.context)).status, 200);
  assert.equal(
    (
      await h.endpoint(
        h.request({ ...h.payload, reply_text: "DIFFERENT" }),
        h.context,
      )
    ).status,
    200,
  );
  const rows = (await readInstantlyTrial(client, h.nonce))!.state!.receipts;
  assert.equal(rows[1].duplicate, true);
  assert.equal(rows[2].classification, "quarantined");
});
test("IA-AC04 concurrent handlers CAS/retry preserve both observations without lost writes", async () => {
  const h = await fixture();
  const results = await Promise.all([
    h.endpoint(h.request(), h.context),
    h.endpoint(h.request(), h.context),
  ]);
  assert.ok(results.every((r) => r.status === 200));
  const rows = (await readInstantlyTrial(client, h.nonce))!.state!.receipts;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].duplicate, true);
});
test("IA-AC04 receiver quota16 is transactional and does not append beyond the cap", async () => {
  const h = await fixture();
  for (let i = 0; i < 16; i++)
    assert.equal((await h.endpoint(h.request(), h.context)).status, 200);
  assert.equal((await h.endpoint(h.request(), h.context)).status, 429);
  assert.equal(
    (await readInstantlyTrial(client, h.nonce))!.state!.receipts.length,
    16,
  );
});
test("IA-AC03/04 unknown/unarmed/closed/expired trials fail closed", async () => {
  const unknown = await fixture(false, false);
  assert.equal(
    (await unknown.endpoint(unknown.request(), unknown.context)).status,
    404,
  );
  const h = await fixture(true, false);
  assert.equal((await h.endpoint(h.request(), h.context)).status, 410);
  const trial = (await readInstantlyTrial(client, h.nonce))!,
    receiver = createInstantlyDbReceiver({
      client,
      trial,
      token,
      key,
      now: () => h.now,
    });
  await receiver.arm();
  await receiver.close();
  assert.equal((await h.endpoint(h.request(), h.context)).status, 410);
  await assert.rejects(receiver.arm());
  const late = await fixture();
  late.setTime(late.manifest.endsAt + 1);
  assert.equal((await late.endpoint(late.request(), late.context)).status, 410);
});
test("IA-AC04 DB failure returns503 without leaking SQL or acknowledging a commit", async () => {
  const h = await fixture();
  let n = 0;
  const failClient: WebhookRpcClient = {
    rpc(name, args) {
      if (name === "instantly_webhook_trial_cas") {
        n++;
        return Promise.resolve({
          data: null,
          error: { message: "PRIVATE_SQL_ERROR_SENTINEL" },
        });
      }
      return client.rpc(name, args);
    },
  };
  const endpoint = instantlyWebhookEndpoint({
    env: () => env,
    client: () => failClient,
    now: () => h.now,
  });
  const r = await endpoint(h.request(), h.context);
  assert.equal(r.status, 503);
  assert.equal(await r.text(), "");
  assert.equal(n, 1);
  assert.equal(
    (await readInstantlyTrial(client, h.nonce))!.state!.receipts.length,
    0,
  );
});
test("IA-AC04 at most one CAS conflict retry; immutable nonce/manifest binding", async () => {
  const h = await fixture(),
    trial = (await readInstantlyTrial(client, h.nonce))!;
  let writes = 0;
  const conflict: WebhookRpcClient = {
    rpc(name, args) {
      return name === "instantly_webhook_trial_cas"
        ? (writes++,
          Promise.resolve({
            data: { applied: false, revision: 99 },
            error: null,
          }))
        : client.rpc(name, args);
    },
  };
  const store = instantlyReceiptStore(conflict, trial);
  await assert.rejects(store.transact((p) => ({ ...p!, closed: true })));
  assert.equal(writes, 2);
  const other = await fixture();
  const foreign: WebhookRpcClient = {
    rpc() {
      return Promise.resolve({
        data: {
          manifest: other.manifest,
          workspace: other.workspace,
          campaign: other.campaign,
          revision: 0,
          state: null,
        },
        error: null,
      });
    },
  };
  await assert.rejects(readInstantlyTrial(foreign, h.nonce));
});
test("IA-AC05 admin gates precede service client and mutations require origin", async () => {
  const h = await fixture(false, false);
  let clients = 0;
  for (const auth of [
    { role: "seller", active: true, aal: "aal2" },
    { role: "superadmin", active: true, aal: "aal1" },
    { role: "superadmin", active: false, aal: "aal2" },
  ]) {
    const endpoint = instantlyTrialEndpoint({
      env: () => env,
      client: () => {
        clients++;
        throw Error("CLIENT_FORBIDDEN");
      },
      authorize: async () => auth,
      checkOrigin: () => {},
    });
    assert.equal(
      (
        await endpoint(
          new Request(origin + "/api/integrations/instantly/trials/" + h.nonce),
          h.context,
        )
      ).status,
      403,
    );
  }
  const noSession = instantlyTrialEndpoint({
    env: () => env,
    client: () => {
      clients++;
      throw Error("CLIENT_FORBIDDEN");
    },
    authorize: async () => {
      throw { status: 401 };
    },
    checkOrigin: () => {},
  });
  assert.equal((await noSession(new Request(origin), h.context)).status, 401);
  const badOrigin = instantlyTrialEndpoint({
    env: () => env,
    client: () => {
      clients++;
      throw Error("CLIENT_FORBIDDEN");
    },
    authorize: async () => ({ role: "superadmin", active: true, aal: "aal2" }),
    checkOrigin: () => {
      throw { status: 403 };
    },
  });
  assert.equal(
    (await badOrigin(new Request(origin, { method: "POST" }), h.context))
      .status,
    403,
  );
  assert.equal(clients, 0);
});
test("IA-AC05 lifecycle prepare/arm/status/close is authenticated and sanitized", async () => {
  const h = await fixture(false, false);
  const endpoint = instantlyTrialEndpoint({
    env: () => env,
    client: () => client,
    now: () => h.now,
    authorize: async () => ({ role: "superadmin", active: true, aal: "aal2" }),
    checkOrigin: (r) => {
      if (r.headers.get("origin") !== origin) throw { status: 403 };
    },
  });
  const request = (body: unknown) =>
    new Request(origin + "/api/integrations/instantly/trials/" + h.nonce, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const prepared = await endpoint(
    request({
      action: "prepare",
      manifest: h.manifest,
      workspace: h.workspace,
      campaign: h.campaign,
    }),
    h.context,
  );
  assert.equal(prepared.status, 200);
  assert.equal((await prepared.json()).armed, false);
  assert.equal(
    (await endpoint(request({ action: "arm" }), h.context)).status,
    200,
  );
  assert.equal((await h.endpoint(h.request(), h.context)).status, 200);
  const state = await endpoint(
    new Request(origin + "/api/integrations/instantly/trials/" + h.nonce),
    h.context,
  );
  const body = await state.text();
  assert.equal(JSON.parse(body).observations, 1);
  for (const v of [
    token,
    key,
    h.workspace,
    h.campaign,
    h.manifest.url,
    hash(token),
    "PRIVATE_BODY",
  ])
    assert.ok(!body.includes(v));
  assert.equal(
    (await endpoint(request({ action: "close" }), h.context)).status,
    200,
  );
  assert.equal(
    (await endpoint(request({ action: "arm" }), h.context)).status,
    503,
  );
});
test("IA-AC05 manifest drift/foreign URL/extra fields cannot register another trial", async () => {
  const h = await fixture(false, false);
  const endpoint = instantlyTrialEndpoint({
    env: () => env,
    client: () => client,
    now: () => h.now,
    authorize: async () => ({ role: "superadmin", active: true, aal: "aal2" }),
    checkOrigin: () => {},
  });
  for (const body of [
    {
      action: "prepare",
      manifest: {
        ...h.manifest,
        url:
          "https://other.example.invalid/api/integrations/instantly/webhook/" +
          h.nonce,
      },
      workspace: h.workspace,
      campaign: h.campaign,
    },
    {
      action: "prepare",
      manifest: { ...h.manifest, tokenHash: "e".repeat(64) },
      workspace: h.workspace,
      campaign: h.campaign,
    },
    { action: "arm", secret: token },
  ]) {
    const n = rpcCalls.length,
      r = await endpoint(
        new Request(origin + "/api/integrations/instantly/trials/" + h.nonce, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        h.context,
      );
    assert.equal(r.status, 400);
    assert.equal(rpcCalls.length, n);
  }
});
test("IA-AC06 RLS and grants deny direct tables/RPC to anon and authenticated including superadmin", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    await f.db.exec("set role " + role);
    try {
      await assert.rejects(
        f.db.query("select * from public.instantly_webhook_trials"),
        { code: "42501" },
      );
      await assert.rejects(
        f.db.query("select * from public.instantly_webhook_receipts"),
        { code: "42501" },
      );
      await assert.rejects(
        f.db.query("delete from public.instantly_webhook_receipts where false"),
        { code: "42501" },
      );
      if (role !== "service_role")
        await assert.rejects(
          f.db.query("select public.instantly_webhook_trial_read($1)", [
            "c".repeat(24),
          ]),
        );
    } finally {
      await f.db.exec("reset role");
    }
  }
  for (const actor of [f.users.admin, f.users.seller, f.users.outsider]) {
    await f.asUser(actor);
    try {
      await assert.rejects(
        f.db.query("select * from public.instantly_webhook_trials"),
        { code: "42501" },
      );
      await assert.rejects(
        f.db.query("select public.instantly_webhook_trial_read($1)", [
          "c".repeat(24),
        ]),
        { code: "42501" },
      );
    } finally {
      await f.db.exec("reset role");
    }
  }
  const rows = await f.db.query<{ rls: boolean }>(
    "select relrowsecurity rls from pg_class where relname in ('instantly_webhook_trials','instantly_webhook_receipts')",
  );
  assert.ok(rows.rows.every((r) => r.rls));
});
test("IA-AC06 prepare immutable/replay and CAS reject forged state, history or private fields", async () => {
  const h = await fixture();
  await prepareInstantlyTrial(client, h.manifest, h.workspace, h.campaign);
  await assert.rejects(
    prepareInstantlyTrial(
      client,
      { ...h.manifest, sourceHash: "d".repeat(64) },
      h.workspace,
      h.campaign,
    ),
  );
  const trial = (await readInstantlyTrial(client, h.nonce))!;
  for (const change of [
    (s: any) => (s.manifestHash = "d".repeat(64)),
    (s: any) => s.armedAt--,
    (s: any) => (s.raw = "PRIVATE_BODY_SENTINEL"),
    (s: any) =>
      s.receipts.push({
        digest: "d".repeat(64),
        payloadDigest: "e".repeat(64),
        receivedAt: h.now,
        contextValidated: true,
        classification: "accepted",
        duplicate: true,
      }),
  ]) {
    const state = structuredClone(trial.state)!;
    change(state);
    const r = await client.rpc("instantly_webhook_trial_cas", {
      p_nonce: h.nonce,
      p_revision: trial.revision,
      p_state: state,
    });
    assert.ok(r.error);
  }
  assert.equal(
    (await readInstantlyTrial(client, h.nonce))!.revision,
    trial.revision,
  );
  assert.equal((await h.endpoint(h.request(), h.context)).status, 200);
  const saved = (await readInstantlyTrial(client, h.nonce))!,
    altered = structuredClone(saved.state)!;
  altered.receipts[0].payloadDigest = "f".repeat(64);
  const rejected = await client.rpc("instantly_webhook_trial_cas", {
    p_nonce: h.nonce,
    p_revision: saved.revision,
    p_state: altered,
  });
  assert.ok(rejected.error);
  assert.deepEqual(
    (await readInstantlyTrial(client, h.nonce))!.state,
    saved.state,
  );
});

test("IA-AC01/03 configuration invalid and source binding changed fail without storing callback", async () => {
  const h = await fixture();
  let clients = 0;
  for (const bad of [
    { ...env, APP_ORIGIN: "http://crm.example.invalid" },
    { ...env, INSTANTLY_S00_WEBHOOK_DEDUP_KEY: token },
    { ...env, INSTANTLY_S00_WEBHOOK_SECRET: "" },
  ]) {
    const endpoint = instantlyWebhookEndpoint({
      env: () => bad,
      client: () => {
        clients++;
        return client;
      },
    });
    assert.equal((await endpoint(h.request(), h.context)).status, 503);
  }
  assert.equal(clients, 0);
  const endpoint = instantlyWebhookEndpoint({
    env: () => ({ ...env, INSTANTLY_S00_WEBHOOK_SECRET: "d".repeat(64) }),
    client: () => client,
  });
  assert.equal(
    (
      await endpoint(
        h.request(undefined, { "X-S00-Webhook-Token": "d".repeat(64) }),
        h.context,
      )
    ).status,
    503,
  );
  assert.equal(
    (await readInstantlyTrial(client, h.nonce))!.state!.receipts.length,
    0,
  );
});
test("IA-AC03/04 RPC timeout is bounded and masks provider/SQL failures", async () => {
  const h = await fixture(false, false);
  let aborted = false;
  const never: WebhookRpcClient = {
    rpc() {
      const result = new Promise<{ data: unknown; error: unknown }>(() => {});
      return Object.assign(result, {
        abortSignal: (signal: AbortSignal) => {
          signal.addEventListener("abort", () => (aborted = true), {
            once: true,
          });
          return result;
        },
      });
    },
  };
  const endpoint = instantlyWebhookEndpoint({
    env: () => env,
    client: () => never,
  });
  const result = await endpoint(h.request(), h.context);
  assert.equal(result.status, 503);
  assert.equal(await result.text(), "");
  assert.equal(aborted, true);
});
test("IA-AC06 additive late migration and isolated reverse preserve existing CRM rows", async () => {
  const local = await featureDatabase({ beforeMigration: "046" });
  try {
    const row = (
      await local.db.query<{ id: string }>(
        "insert into public.contacts(name,email) values('Existing fixture','existing@fixture.invalid') returning id",
      )
    ).rows[0];
    const before = await local.db.query(
      "select * from public.contacts where id=$1",
      [row.id],
    );
    const migration = await readFile(
      "supabase/migrations/046_instantly_webhook_trials.sql",
      "utf8",
    );
    await local.db.exec(migration);
    assert.deepEqual(
      (
        await local.db.query("select * from public.contacts where id=$1", [
          row.id,
        ])
      ).rows,
      before.rows,
    );
    await local.db.exec(
      "drop function public.instantly_webhook_trial_cas(text,integer,jsonb);drop function public.instantly_webhook_trial_prepare(text,jsonb,text,uuid,uuid);drop function public.instantly_webhook_trial_read(text);drop table public.instantly_webhook_receipts;drop table public.instantly_webhook_trials;",
    );
    assert.deepEqual(
      (
        await local.db.query("select * from public.contacts where id=$1", [
          row.id,
        ])
      ).rows,
      before.rows,
    );
    await local.db.exec(migration);
  } finally {
    await local.db.close();
  }
});
