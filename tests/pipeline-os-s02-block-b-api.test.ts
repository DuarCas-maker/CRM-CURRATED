import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";
import * as supabase from "../src/lib/server/supabase";
import * as google from "../src/lib/server/google";
import { hash, decrypt } from "../src/lib/server/crypto";
import { parseBrandPage } from "../src/lib/brand-management";

if (!process.execArgv.includes("--experimental-test-module-mocks")) {
  test("B1 real routes with fake Google, cookies and in-memory SQL", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--test",
        "tests/pipeline-os-s02-block-b-api.test.ts",
      ],
      { env, encoding: "utf8", timeout: 60000 },
    );
    assert.match(output, /# fail 0/);
  });
} else
  test("B1 API / OAuth routes, no external network", async (t) => {
    const f = await featureDatabase(),
      { db, users, asUser } = f;
    const root = "docs/specs/pipeline-os/s02/integration/";
    await db.exec(
      "set pipeline_os.block_a_local='in_memory_test';set pipeline_os.block_b1_local='in_memory_test'",
    );
    for (const file of [
      "migrations/a-brand-foundation.local.sql",
      "migrations/a-mail-permissions.local.sql",
      "block-b/migrations/b-brand-management.local.sql",
    ])
      await db.exec(await readFile(root + file, "utf8"));
    const environment = {
      APP_ORIGIN: "https://crm.b1.test",
      GMAIL_HISTORY_ENABLED: "true",
      GMAIL_SYNC_MODE: "pubsub",
      INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 31).toString("base64"),
    };
    const prior = Object.fromEntries(
      Object.keys(environment).map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, environment);
    let actor = users.admin,
      aal = "aal2",
      identity = "new@b1.test",
      hook: (() => Promise<void>) | null = null,
      missing = false,
      googleCalls = 0;
    const jar = new Map<string, string>(),
      rpcCalls: string[] = [];
    const owner = () => db.exec("reset role");
    async function rpc(
      name: string,
      p: Record<string, unknown>,
      service = false,
    ) {
      rpcCalls.push(name);
      if (missing)
        return {
          data: null,
          error: { code: "PGRST202", message: "private schema details" },
        };
      const signatures: Record<string, string[]> = {
        crm_command: ["kind", "p", "request_key"],
        brand_management_page: ["collection", "cursor", "page_size"],
        brand_oauth_begin: ["state_hash", "organization_id", "intent"],
        brand_oauth_claim: ["state_hash", "actor_id"],
        brand_oauth_finish: [
          "state_hash",
          "actor_id",
          "mailbox_email",
          "encrypted_token",
          "watch_enabled",
        ],
      };
      const keys = signatures[name];
      assert.ok(keys, `unexpected RPC ${name}`);
      try {
        if (service) {
          await owner();
          await db.exec("set role service_role");
        } else await asUser(actor, aal);
        const v = (
          await db.query<{ v: unknown }>(
            `select ${name}(${keys.map((_, i) => "$" + (i + 1)).join(",")}) v`,
            keys.map((k) => p[k]),
          )
        ).rows[0].v;
        return { data: v, error: null };
      } catch (e) {
        return {
          data: null,
          error: {
            message: (e as Error).message,
            code: (e as { code?: string }).code,
          },
        };
      }
    }
    const client = {
      rpc: (n: string, p: Record<string, unknown>) => rpc(n, p),
    };
    const mocks = [
      mock.module("../src/lib/server/supabase.ts", {
        namedExports: {
          ...supabase,
          requireUser: async () => {
            await owner();
            const profile = (
              await db.query<Record<string, unknown>>(
                "select * from profiles where id=$1",
                [actor],
              )
            ).rows[0];
            if (aal !== "aal2" || !profile.active)
              throw new supabase.HttpError(403, "MFA / active required");
            await asUser(actor, aal);
            return { db: client, profile, user: { id: actor } };
          },
          serviceClient: () => ({
            rpc: (n: string, p: Record<string, unknown>) => rpc(n, p, true),
          }),
        },
      }),
      mock.module("next/headers", {
        namedExports: {
          cookies: async () => ({
            get: (k: string) =>
              jar.has(k) ? { value: jar.get(k) } : undefined,
            set: (k: string, v: string) => jar.set(k, v),
            delete: (k: string) => jar.delete(k),
          }),
        },
      }),
      mock.module("../src/lib/server/google.ts", {
        namedExports: {
          ...google,
          organization: (id: string) => {
            assert.equal(id, "fixture");
            return { id, domain: "b1.test", clientId: "fixture-client" };
          },
          oauthClient: () => ({
            generateAuthUrl: (p: { state: string }) =>
              `https://google.example.test/oauth?state=${p.state}`,
            getToken: async () => {
              googleCalls++;
              if (hook) await hook();
              return {
                tokens: {
                  id_token: "fixture-id",
                  refresh_token: "fixture-refresh",
                  scope:
                    "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
                },
              };
            },
            verifyIdToken: async () => ({
              getPayload: () => ({
                email: identity,
                email_verified: true,
                hd: "b1.test",
              }),
            }),
          }),
        },
      }),
    ];
    try {
      const actions = await import("../src/app/api/actions/route"),
        pages = await import("../src/app/api/brands/route"),
        connect = await import("../src/app/api/gmail/connect/route"),
        callback = await import("../src/app/api/gmail/callback/route");
      const request = (
        kind: string,
        payload: object,
        key = randomUUID(),
        origin = "https://crm.b1.test",
      ) =>
        actions.POST(
          new Request("https://crm.b1.test/api/actions", {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify({ kind, payload, idempotency_key: key }),
          }),
        );
      let brand: string;
      let account: string;
      await t.test(
        "actual action route, closed validation, origin, role, CAS and missing SQL",
        async () => {
          const key = randomUUID(),
            p = { code: "API", name: "API", active: true };
          let r = await request("brand_create", p, key);
          assert.equal(r.status, 200);
          brand = (await r.json()).result.id;
          r = await request("brand_create", p, key);
          assert.equal((await r.json()).result.replayed, true);
          assert.equal(
            (await request("brand_create", { ...p, name: "Changed" }, key))
              .status,
            409,
          );
          assert.equal(
            (
              await request(
                "brand_create",
                p,
                randomUUID(),
                "https://other.test",
              )
            ).status,
            403,
          );
          assert.equal(
            (await request("brand_create", { ...p, actor_id: users.admin }))
              .status,
            400,
          );
          actor = users.seller;
          assert.equal((await request("brand_create", p)).status, 403);
          actor = users.admin;
          aal = "aal1";
          assert.equal((await request("brand_create", p)).status, 403);
          aal = "aal2";
          missing = true;
          r = await request("brand_create", p);
          assert.equal(r.status, 503);
          assert.doesNotMatch(JSON.stringify(await r.json()), /private schema/);
          missing = false;
        },
      );
      await t.test(
        "GET validates pages, strips internal fields and restricts admin catalog",
        async () => {
          let r = await pages.GET(
            new Request("https://crm.b1.test/api/brands?collection=brands"),
          );
          assert.equal(r.status, 200);
          const body = await r.json();
          assert.ok(parseBrandPage("brands", body));
          assert.ok(!("created_by" in body.items[0]));
          assert.equal(r.headers.get("cache-control"), "no-store");
          assert.equal(
            (
              await pages.GET(
                new Request("https://crm.b1.test/api/brands?limit=101"),
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await pages.GET(
                new Request("https://crm.b1.test/api/brands?actor_id=spoof"),
              )
            ).status,
            400,
          );
          actor = users.seller;
          assert.equal(
            (
              await pages.GET(
                new Request(
                  "https://crm.b1.test/api/brands?collection=accounts",
                ),
              )
            ).status,
            403,
          );
          actor = users.admin;
        },
      );
      async function begin(
        mode = "new",
        accountId?: string,
        revision?: number,
      ) {
        const q = new URLSearchParams({
          organization: "fixture",
          mode,
          brand_id: brand!,
          expected_brand_revision: "1",
        });
        if (accountId) {
          q.set("account_id", accountId);
          q.set("expected_account_revision", String(revision));
        }
        const r = await connect.GET(
          new Request("https://crm.b1.test/api/gmail/connect?" + q),
        );
        assert.equal(r.status, 302, JSON.stringify(await r.clone().text()));
        return new URL(r.headers.get("location")!).searchParams.get("state")!;
      }
      const finish = (state: string) =>
        callback.GET(
          new Request(
            "https://crm.b1.test/api/gmail/callback?" +
              new URLSearchParams({ state, code: "fixture-code" }),
          ),
        );
      await t.test(
        "new OAuth consumes state, stores encrypted credential atomically and only proposes a brand",
        async () => {
          const state = await begin();
          const response = await finish(state);
          assert.equal(response.status, 302, await response.clone().text());
          await owner();
          const a = (
            await db.query<Record<string, unknown>>(
              "select * from mail_accounts where email=$1",
              [identity],
            )
          ).rows[0];
          account = String(a.id);
          assert.equal(a.operating_brand_id, null);
          assert.equal(a.brand_revision, 0);
          const credential = (
            await db.query<Record<string, unknown>>(
              "select encrypted_refresh_token from mail_credentials where account_id=$1",
              [account],
            )
          ).rows[0];
          assert.equal(
            decrypt(String(credential.encrypted_refresh_token)),
            "fixture-refresh",
          );
          const review = (
            await db.query<Record<string, unknown>>(
              "select * from mail_account_brand_reviews where account_id=$1",
              [account],
            )
          ).rows[0];
          assert.equal(review.status, "pending");
          assert.equal(review.proposed_brand_id, brand!);
          assert.equal(
            (
              await db.query<Record<string, unknown>>(
                "select count(*) n from operating_brand_memberships",
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await db.query<Record<string, unknown>>(
                "select count(*) n from outbox",
              )
            ).rows[0].n,
            0,
          );
          assert.deepEqual(
            (
              await db.query<Record<string, unknown>>(
                "select kind from jobs where dedupe_key like '%:brand-oauth:%' order by kind",
              )
            ).rows.map((r) => r.kind),
            ["gmail_sync", "gmail_watch"],
          );
          jar.set("gmail_oauth_state", hash(state));
          assert.equal((await finish(state)).status, 409);
          assert.equal(googleCalls, 1);
          await asUser(users.admin);
          const r = await client.rpc("crm_command", {
            kind: "brand_mapping_confirm",
            p: {
              review_id: review.id,
              expected_review_revision: 1,
              expected_account_revision: 0,
            },
            request_key: randomUUID(),
          });
          assert.equal(r.error, null);
        },
      );
      await t.test(
        "reconnect rejects wrong identity, preserves credential, then correct reconnect preserves ID/brand",
        async () => {
          let state = await begin("reconnect", account!, 1);
          identity = "wrong@b1.test";
          let r = await finish(state);
          assert.equal(r.status, 409);
          assert.equal((await r.json()).code, "BRAND_IDENTITY_MISMATCH");
          await owner();
          assert.equal(
            (
              await db.query<Record<string, unknown>>(
                "select count(*) n from mail_accounts",
              )
            ).rows[0].n,
            1,
          );
          const priorToken = (
            await db.query<Record<string, unknown>>(
              "select encrypted_refresh_token v from mail_credentials where account_id=$1",
              [account!],
            )
          ).rows[0].v;
          assert.equal(decrypt(String(priorToken)), "fixture-refresh");
          state = await begin("reconnect", account!, 1);
          identity = "new@b1.test";
          r = await finish(state);
          assert.equal(r.status, 302);
          await owner();
          const a = (
            await db.query<Record<string, unknown>>(
              "select id,operating_brand_id,brand_revision from mail_accounts",
            )
          ).rows[0];
          assert.equal(a.id, account!);
          assert.equal(a.operating_brand_id, brand!);
          assert.equal(a.brand_revision, 1);
          assert.equal(
            (
              await db.query<Record<string, unknown>>(
                "select count(*) n from mail_account_brand_reviews",
              )
            ).rows[0].n,
            1,
          );
        },
      );
      await t.test(
        "new intent matching existing account never overwrites it",
        async () => {
          const s = await begin();
          const r = await finish(s);
          assert.equal(r.status, 409);
          assert.equal((await r.json()).code, "BRAND_RECONNECT_REQUIRED");
        },
      );
      await t.test(
        "account revision changes during reconnect preserve original credential and reject finish",
        async () => {
          const s = await begin("reconnect", account!, 1);
          identity = "new@b1.test";
          await owner();
          const priorCredential = (
            await db.query<{ v: string }>(
              "select encrypted_refresh_token v from mail_credentials where account_id=$1",
              [account!],
            )
          ).rows[0].v;
          hook = async () => {
            await owner();
            await db.query(
              "update mail_accounts set brand_revision=brand_revision+1 where id=$1",
              [account!],
            );
          };
          const r = await finish(s);
          hook = null;
          assert.equal(r.status, 409);
          assert.equal((await r.json()).code, "BRAND_STALE_REVISION");
          await owner();
          assert.equal(
            (
              await db.query<{ v: string }>(
                "select encrypted_refresh_token v from mail_credentials where account_id=$1",
                [account!],
              )
            ).rows[0].v,
            priorCredential,
          );
          await db.query(
            "update mail_accounts set brand_revision=1 where id=$1",
            [account!],
          );
        },
      );
      await t.test(
        "brand revision changes during token exchange reject finish with no partial writes",
        async () => {
          const s = await begin();
          identity = "unwritten@b1.test";
          hook = async () => {
            await owner();
            await db.query<Record<string, unknown>>(
              "update operating_brands set revision=revision+1 where id=$1",
              [brand!],
            );
          };
          const r = await finish(s);
          hook = null;
          assert.equal(r.status, 409);
          assert.equal((await r.json()).code, "BRAND_STALE_REVISION");
          await owner();
          assert.equal(
            (
              await db.query<Record<string, unknown>>(
                "select count(*) n from mail_accounts where email=$1",
                [identity],
              )
            ).rows[0].n,
            0,
          );
          await db.query<Record<string, unknown>>(
            "update operating_brands set revision=1 where id=$1",
            [brand!],
          );
        },
      );
      await t.test(
        "inactive actor after claim, expired state and bad cookie reject without new credentials",
        async () => {
          let s = await begin();
          hook = async () => {
            await owner();
            await db.query<Record<string, unknown>>(
              "update profiles set active=false where id=$1",
              [actor],
            );
          };
          let r = await finish(s);
          hook = null;
          assert.equal(r.status, 403);
          await owner();
          await db.query<Record<string, unknown>>(
            "update profiles set active=true where id=$1",
            [actor],
          );
          s = await begin();
          await owner();
          await db.query<Record<string, unknown>>(
            "update oauth_states set expires_at=now()-interval '1 second' where state_hash=$1",
            [hash(s)],
          );
          const before = googleCalls;
          r = await finish(s);
          assert.equal(r.status, 409);
          assert.equal(googleCalls, before);
          jar.clear();
          r = await finish(s);
          assert.equal(r.status, 400);
        },
      );
      await t.test(
        "transaction rollback: failed downstream credential/job write persists no mailbox or review",
        async () => {
          await owner();
          await db.exec(
            "create function b1_fake_fail() returns trigger language plpgsql as $$begin raise exception 'fixture failure with private detail';end$$;create trigger b1_fake_fail before insert on jobs for each row execute function b1_fake_fail()",
          );
          identity = "rollback@b1.test";
          const s = await begin();
          const r = await finish(s);
          assert.equal(r.status, 503);
          assert.doesNotMatch(JSON.stringify(await r.json()), /private detail/);
          await owner();
          assert.equal(
            (
              await db.query<Record<string, unknown>>(
                "select count(*) n from mail_accounts where email=$1",
                [identity],
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await db.query<Record<string, unknown>>(
                "select completed_at from oauth_states where state_hash=$1",
                [hash(s)],
              )
            ).rows[0].completed_at,
            null,
          );
          await db.exec(
            "drop trigger b1_fake_fail on jobs;drop function b1_fake_fail()",
          );
        },
      );
      await t.test(
        "missing B1 SQL at OAuth begin fails closed without Google redirect or table fallback",
        async () => {
          missing = true;
          const r = await connect.GET(
            new Request(
              `https://crm.b1.test/api/gmail/connect?organization=fixture&mode=new&brand_id=${brand!}&expected_brand_revision=1`,
            ),
          );
          missing = false;
          assert.equal(r.status, 503);
          assert.ok(rpcCalls.includes("brand_oauth_begin"));
        },
      );
    } finally {
      for (const m of mocks) m.restore();
      for (const [k, v] of Object.entries(prior)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await db.close();
    }
  });
