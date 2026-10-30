import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";
import {
  cAppFixture,
  appOrigin,
  appToken,
} from "./fixtures/pipeline-os-instantly-c-app";
import { cToken, cDedup } from "./fixtures/pipeline-os-instantly-c";
import {
  controlHash,
  validateCAppManifest,
} from "../src/lib/server/instantly/control-contract";
import {
  instantlyLeaseEndpoint,
  instantlyControlEndpoint,
  admitInstantlyCallback,
} from "../src/lib/server/instantly/control-endpoints";
import { instantlyWebhookEndpoint } from "../src/lib/server/instantly/endpoints";
import type { WebhookRpcClient } from "../src/lib/server/instantly/store";
globalThis.fetch = async () => {
  throw Error("REAL_NETWORK_FORBIDDEN");
};
let f: Awaited<ReturnType<typeof featureDatabase>>,
  queue = Promise.resolve<unknown>(undefined),
  calls = 0;
const sql: Record<string, [string, string[]]> = {
  instantly_webhook_control_issue: [
    "select public.instantly_webhook_control_issue($1,$2,$3::jsonb,$4,$5::uuid,$6::uuid,$7,$8::uuid) result",
    [
      "p_actor",
      "p_nonce",
      "p_manifest",
      "p_hash",
      "p_workspace",
      "p_campaign",
      "p_token_hash",
      "p_intent",
    ],
  ],
  instantly_webhook_control_execute: [
    "select public.instantly_webhook_control_execute($1,$2,$3,$4,$5::uuid) result",
    ["p_nonce", "p_token_hash", "p_action", "p_bucket", "p_request"],
  ],
  instantly_webhook_control_admit: [
    "select public.instantly_webhook_control_admit($1) result",
    ["p_nonce"],
  ],
  instantly_webhook_trial_read: [
    "select public.instantly_webhook_trial_read($1) result",
    ["p_nonce"],
  ],
  instantly_webhook_trial_cas: [
    "select public.instantly_webhook_trial_cas($1,$2,$3::jsonb) result",
    ["p_nonce", "p_revision", "p_state"],
  ],
};
const client: WebhookRpcClient = {
  rpc(name, args) {
    calls++;
    const p = queue.then(async () => {
      await f.db.exec("set role service_role");
      try {
        const [q, keys] = sql[name];
        return {
          data: (
            await f.db.query<{ result: unknown }>(
              q,
              keys.map((k) => args[k]),
            )
          ).rows[0].result,
          error: null,
        };
      } catch (e) {
        return { data: null, error: { message: "PRIVATE_DB_SENTINEL" } };
      } finally {
        await f.db.exec("reset role");
      }
    });
    queue = p.then(() => undefined);
    return p;
  },
};
const env = {
  INSTANTLY_WEBHOOK_ENABLED: "true",
  APP_ORIGIN: appOrigin,
  INSTANTLY_S00_WEBHOOK_SECRET: cToken,
  INSTANTLY_S00_WEBHOOK_DEDUP_KEY: cDedup,
};
before(async () => {
  f = await featureDatabase();
});
after(async () => {
  await queue;
  await f.db.close();
});
async function fixture() {
  const h = await cAppFixture(),
    nonce = h.manifest.receiverManifest.nonce,
    ctx = { params: Promise.resolve({ nonce }) };
  const actor = {
      id: f.users.admin,
      role: "superadmin",
      active: true,
      aal: "aal2",
    },
    token = randomBytes(32).toString("hex");
  const deps = {
    env: () => env,
    client: () => client,
    authorize: async () => actor,
    checkOrigin: (r: Request) => {
      if (r.headers.get("origin") !== appOrigin) throw Error("ORIGIN");
    },
    randomToken: () => token,
  };
  const lease = instantlyLeaseEndpoint(deps),
    endpoint = instantlyControlEndpoint(deps),
    intentId = randomUUID();
  const grant = () =>
    lease(
      new Request(
        appOrigin + "/api/integrations/instantly/trials/" + nonce + "/lease",
        {
          method: "POST",
          headers: { origin: appOrigin, "content-type": "application/json" },
          body: JSON.stringify({ intentId, manifest: h.manifest }),
        },
      ),
      ctx,
    );
  const control = (
    action: string,
    bucket = "N",
    credential = token,
    id = randomUUID(),
  ) =>
    endpoint(
      new Request(appOrigin + "/api/integrations/instantly/control/" + nonce, {
        method: ["arm", "close", "revoke"].includes(action) ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + credential,
          "X-S00-Control-Bucket": bucket,
          "X-S00-Control-Request-Id": id,
          "X-S00-Control-Action": action,
          "content-type": "application/json",
        },
        ...(["arm", "close", "revoke"].includes(action)
          ? { body: JSON.stringify({ action }) }
          : {}),
      }),
      ctx,
    );
  const callback = instantlyWebhookEndpoint({
    ...deps,
    admit: admitInstantlyCallback,
  });
  const deliver = (extra = {}) =>
    callback(
      new Request(h.manifest.receiverManifest.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-S00-Webhook-Token": cToken,
        },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          workspace: h.manifest.source.workspaceId,
          campaign_id: h.manifest.source.campaignId,
          event_type: "reply_received",
          lead_email: "PRIVATE_EMAIL_SENTINEL@example.invalid",
          reply_text: "PRIVATE_BODY_SENTINEL",
          ...extra,
        }),
      }),
      ctx,
    );
  return { ...h, nonce, ctx, actor, deps, grant, control, deliver, token };
}
test("CAPP-AC01/03 disabled routes, no client/auth/env credential access", async () => {
  let access = 0;
  for (const factory of [instantlyLeaseEndpoint, instantlyControlEndpoint]) {
    const endpoint = factory({
      env: () => ({}),
      client: () => {
        access++;
        throw Error();
      },
      authorize: async () => {
        access++;
        throw Error();
      },
    });
    assert.equal(
      (
        await endpoint(new Request(appOrigin, { method: "POST" }), {
          params: Promise.resolve({ nonce: "c".repeat(24) }),
        })
      ).status,
      404,
    );
  }
  assert.equal(access, 0);
  const previous = process.env.INSTANTLY_WEBHOOK_ENABLED;
  process.env.INSTANTLY_WEBHOOK_ENABLED = "false";
  try {
    const control =
      await import("../src/app/api/integrations/instantly/control/[nonce]/route");
    const lease =
      await import("../src/app/api/integrations/instantly/trials/[nonce]/lease/route");
    const ctx = { params: Promise.resolve({ nonce: "c".repeat(24) }) };
    assert.equal((await control.GET(new Request(appOrigin), ctx)).status, 404);
    assert.equal(
      (await lease.POST(new Request(appOrigin, { method: "POST" }), ctx))
        .status,
      404,
    );
  } finally {
    if (previous === undefined) delete process.env.INSTANTLY_WEBHOOK_ENABLED;
    else process.env.INSTANTLY_WEBHOOK_ENABLED = previous;
  }
});
test("CAPP-AC02 actor/MFA/origin/invalid manifest fail before DB", async () => {
  const h = await fixture(),
    start = calls;
  for (const change of [
    { aal: "aal1" },
    { role: "seller" },
    { active: false },
  ]) {
    Object.assign(h.actor, change);
    assert.equal((await h.grant()).status, 403);
    Object.assign(h.actor, { aal: "aal2", role: "superadmin", active: true });
  }
  h.manifest.draft = true as false;
  assert.equal((await h.grant()).status, 400);
  assert.equal(calls, start);
  assert.throws(() => validateCAppManifest({ draft: true }));
});
test("CAPP-AC02/05/07 full SQL/API lifecycle retains hashes only and revokes", async () => {
  const h = await fixture();
  const grant = await h.grant();
  assert.equal(grant.status, 201);
  assert.equal(grant.headers.get("cache-control"), "no-store");
  const data = await grant.json();
  assert.equal(data.credential.value, h.token);
  assert.equal(data.ticket.intentId.length, 36);
  assert.equal((await h.grant()).status, 409);
  assert.equal((await h.control("probe")).status, 200);
  assert.equal((await h.control("arm")).status, 200);
  assert.equal((await h.deliver()).status, 200);
  const observed = await (await h.control("observe")).json();
  assert.equal(observed.authenticated, true);
  assert.equal(observed.contextValidated, true);
  assert.equal((await h.control("close")).status, 200);
  assert.equal((await h.deliver()).status, 410);
  const final = await (await h.control("final")).json();
  assert.equal(final.closed, true);
  assert.equal(final.payloadDigest, observed.payloadDigest);
  assert.equal((await h.control("arm")).status, 409);
  assert.equal((await h.control("revoke")).status, 200);
  assert.equal((await h.control("probe")).status, 401);
  const rows = await f.db.query(
    "select token_hash,attempts from instantly_webhook_control_leases where id=$1",
    [data.ticket.leaseId],
  );
  assert.equal((rows.rows[0] as any).token_hash, controlHash(h.token));
  const text =
    JSON.stringify(rows) +
    JSON.stringify(
      await f.db.query("select * from instantly_webhook_receipts"),
    );
  for (const sentinel of [
    h.token,
    "PRIVATE_EMAIL_SENTINEL",
    "PRIVATE_BODY_SENTINEL",
  ])
    assert.equal(text.includes(sentinel), false);
});
test("CAPP-AC04 repeated mutation consumes attempt, failed close stays reserved", async () => {
  const h = await fixture();
  assert.equal((await h.grant()).status, 201);
  assert.equal((await h.control("close")).status, 409);
  assert.equal((await h.control("arm")).status, 200);
  assert.equal((await h.control("close")).status, 409);
  const id = randomUUID();
  assert.equal((await h.control("probe", "N", h.token, id)).status, 200);
  assert.equal((await h.control("probe", "N", h.token, id)).status, 409);
  const row = (
    await f.db.query<any>(
      "select normal,close_attempted from instantly_webhook_control_leases l join instantly_webhook_trials t on t.id=l.trial_id where t.nonce=$1",
      [h.nonce],
    )
  ).rows[0];
  assert.equal(row.normal, 6);
  assert.equal(row.close_attempted, true);
});
test("CAPP-AC03/04 wrong token/actor disabled/observation and callback ceilings", async () => {
  const h = await fixture();
  assert.equal((await h.grant()).status, 201);
  assert.equal((await h.control("probe", "N", "e".repeat(64))).status, 401);
  assert.equal((await h.control("arm", "R")).status, 400);
  assert.equal((await h.control("arm")).status, 200);
  for (let i = 0; i < 12; i++)
    assert.equal((await h.control("observe")).status, 200);
  assert.equal((await h.control("observe")).status, 429);
  for (let i = 0; i < 16; i++)
    assert.equal((await admitInstantlyCallback(client, h.nonce)).status, 200);
  assert.equal((await admitInstantlyCallback(client, h.nonce)).status, 429);
  await f.db.query("update profiles set active=false where id=$1", [
    f.users.admin,
  ]);
  assert.equal((await h.control("probe")).status, 403);
  assert.equal((await admitInstantlyCallback(client, h.nonce)).status, 410);
  await f.db.query("update profiles set active=true where id=$1", [
    f.users.admin,
  ]);
});
test("CAPP-AC03 expiry denies and invalid issue rolls back preparation", async () => {
  const h = await fixture();
  h.manifest.receiverManifest.endsAt = Date.now() + 600000;
  h.manifest.receiverManifest.startsAt =
    h.manifest.receiverManifest.endsAt - 120000;
  assert.equal((await h.grant()).status, 409);
  assert.equal(
    (
      await f.db.query(
        "select * from instantly_webhook_trials where nonce=$1",
        [h.nonce],
      )
    ).rows.length,
    0,
  );
  const good = await fixture();
  assert.equal((await good.grant()).status, 201);
  await f.db.query(
    "update instantly_webhook_control_leases set issued_at=now()-interval '5 minutes',expires_at=now()-interval '1 minute' where trial_id=(select id from instantly_webhook_trials where nonce=$1)",
    [good.nonce],
  );
  assert.equal((await good.control("probe")).status, 401);
  assert.equal((await admitInstantlyCallback(client, good.nonce)).status, 410);
});
test("CAPP-AC06 direct access and RPC grants restricted, private snapshot denied to service", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    await f.db.exec("set role " + role);
    try {
      await assert.rejects(
        f.db.query("select * from instantly_webhook_control_leases"),
        /permission denied/,
      );
      await assert.rejects(
        f.db.query("select instantly_webhook_control_snapshot('none')"),
        /permission denied/,
      );
      if (role !== "service_role")
        await assert.rejects(
          f.db.query("select instantly_webhook_control_admit('none')"),
          /permission denied/,
        );
    } finally {
      await f.db.exec("reset role");
    }
  }
  const q = await f.db.query<any>(
    "select proconfig,prosecdef from pg_proc where proname like 'instantly_webhook_control_%'",
  );
  assert.equal(q.rows.length, 4);
  assert.ok(
    q.rows.every((x) => x.prosecdef && x.proconfig.includes('search_path=""')),
  );
});
test("CAPP-AC03 SQL rechecks active superadmin independently of API and rejects cross-trial tokens", async () => {
  const h = await fixture(),
    m = h.manifest;
  for (const actor of [f.users.seller, f.users.outsider, randomUUID()]) {
    const r = await client.rpc("instantly_webhook_control_issue", {
      p_actor: actor,
      p_nonce: h.nonce,
      p_manifest: m.receiverManifest,
      p_hash: controlHash(JSON.stringify(m.receiverManifest)),
      p_workspace: m.source.workspaceId,
      p_campaign: m.source.campaignId,
      p_token_hash: controlHash(h.token),
      p_intent: randomUUID(),
    });
    assert.deepEqual(r.data, { status: 403 });
  }
  assert.equal((await h.grant()).status, 201);
  const other = await fixture();
  assert.equal((await other.grant()).status, 201);
  assert.equal((await other.control("arm", "N", h.token)).status, 401);
  assert.equal((await other.control("probe")).status, 200);
});
test("CAPP-AC04 durable server N19/R4/H2 ceilings allow only bounded cleanup", async () => {
  const h = await fixture();
  assert.equal((await h.grant()).status, 201);
  assert.equal((await h.control("arm")).status, 200);
  for (let i = 0; i < 17; i++)
    assert.equal((await h.control("probe")).status, 200);
  assert.equal((await h.control("probe")).status, 429);
  for (let i = 0; i < 4; i++)
    assert.equal((await h.control("probe", "R")).status, 200);
  assert.equal((await h.control("probe", "R")).status, 429);
  assert.equal((await h.control("close", "H")).status, 200);
  assert.equal((await h.control("revoke", "H")).status, 200);
  const row = (
    await f.db.query<any>(
      "select normal,reserve,emergency,jsonb_array_length(attempts) attempts from instantly_webhook_control_leases l join instantly_webhook_trials t on t.id=l.trial_id where t.nonce=$1",
      [h.nonce],
    )
  ).rows[0];
  assert.deepEqual(row, { normal: 19, reserve: 4, emergency: 2, attempts: 24 });
});
test("CAPP-AC02 malformed/oversized/foreign origin requests never invoke RPC", async () => {
  const h = await fixture(),
    start = calls,
    lease = instantlyLeaseEndpoint(h.deps),
    url =
      appOrigin + "/api/integrations/instantly/trials/" + h.nonce + "/lease";
  for (const body of [
    "{",
    JSON.stringify({ intentId: randomUUID(), manifest: {}, extra: true }),
    "x".repeat(16385),
  ]) {
    const r = await lease(
      new Request(url, {
        method: "POST",
        headers: { origin: appOrigin, "content-type": "application/json" },
        body,
      }),
      h.ctx,
    );
    assert.equal(r.status, 400);
  }
  assert.equal(
    (
      await lease(
        new Request(url, {
          method: "POST",
          headers: {
            origin: "https://outside.invalid",
            "content-type": "application/json",
          },
          body: "{}",
        }),
        h.ctx,
      )
    ).status,
    403,
  );
  assert.equal(calls, start);
});
test("CAPP-AC05 storage unavailable is sanitized without token or SQL details", async () => {
  const h = await fixture(),
    lease = instantlyLeaseEndpoint({
      ...h.deps,
      client: () => ({
        rpc: async () => ({
          data: null,
          error: { message: "PRIVATE_SQL_SENTINEL" },
        }),
      }),
    });
  const r = await lease(
    new Request(
      appOrigin + "/api/integrations/instantly/trials/" + h.nonce + "/lease",
      {
        method: "POST",
        headers: { origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({ intentId: randomUUID(), manifest: h.manifest }),
      },
    ),
    h.ctx,
  );
  assert.equal(r.status, 503);
  assert.equal(await r.text(), "");
});
test("CAPP-AC07 callback admitted before close cannot alter frozen snapshot", async () => {
  const h = await fixture();
  await h.grant();
  await h.control("arm");
  const stale = await admitInstantlyCallback(client, h.nonce);
  assert.equal(stale.status, 200);
  await h.control("close");
  const state = {
    ...stale.trial!.state!,
    receipts: [
      {
        digest: "e".repeat(64),
        payloadDigest: "f".repeat(64),
        receivedAt: Date.now(),
        contextValidated: true,
        classification: "context_validated",
        duplicate: false,
      },
    ],
  };
  const r = await client.rpc("instantly_webhook_trial_cas", {
    p_nonce: h.nonce,
    p_revision: stale.trial!.revision,
    p_state: state,
  });
  assert.equal((r.data as any).applied, false);
  const final = await (await h.control("final")).json();
  assert.equal(final.observations, 0);
  assert.equal(final.closed, true);
});
test("CAPP-AC06 047 upgrade under supabase_admin and disposable reversal preserves 046", async () => {
  const g = await featureDatabase({ beforeMigration: "047" });
  try {
    await g.db.exec(
      "create role supabase_admin superuser;set role supabase_admin",
    );
    await g.db.exec(
      await readFile(
        "supabase/migrations/047_instantly_webhook_control_leases.sql",
        "utf8",
      ),
    );
    await g.db.exec("reset role");
    assert.equal(
      (
        await g.db.query<any>(
          "select tableowner from pg_tables where tablename='instantly_webhook_control_leases'",
        )
      ).rows[0].tableowner,
      "supabase_admin",
    );
    await g.db.exec(
      "begin;drop table instantly_webhook_control_leases;rollback",
    );
    assert.equal(
      (await g.db.query("select * from instantly_webhook_trials")).rows.length,
      0,
    );
    assert.equal((await g.db.query("select * from profiles")).rows.length, 4);
  } finally {
    await g.db.close();
  }
});
