import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as supabase from "../src/lib/server/supabase";
import {
  c1Fixture,
  c1Candidate,
} from "./fixtures/pipeline-os-s02-composio-bindings";
import {
  bindingExpected,
  bindingPageSchema,
  type BindingPage,
} from "../src/lib/composio-bindings";

if (!process.execArgv.includes("--experimental-test-module-mocks"))
  test("C1 route composition in isolated mocks", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--test",
        "tests/pipeline-os-s02-block-c-api.test.ts",
      ],
      { env, encoding: "utf8", timeout: 60000 },
    );
    assert.match(output, /# fail 0/);
  });
else
  test("C1 real API routes with signed fixture database and no provider", async (t) => {
    const f = await c1Fixture(),
      { db, users, accounts, asUser } = f;
    const origin = "http://localhost:3000";
    let actor = users.admin,
      aal = "aal2",
      session = true,
      mode = "normal",
      serviceCalls = 0;
    const calls: string[] = [];
    const module = mock.module("../src/lib/server/supabase.ts", {
      namedExports: {
        ...supabase,
        requireUser: async () => {
          if (!session)
            throw new supabase.HttpError(401, "private auth detail");
          await db.exec("reset role");
          const profile = (
            await db.query<{ active: boolean; role: string; id: string }>(
              "select * from profiles where id=$1",
              [actor],
            )
          ).rows[0];
          if (aal !== "aal2" || !profile.active)
            throw new supabase.HttpError(403, "private MFA/profile detail");
          return {
            user: { id: actor },
            profile,
            db: {
              rpc: async (name: string, p: Record<string, unknown>) => {
                calls.push(name);
                if (mode === "missing")
                  return {
                    data: null,
                    error: {
                      code: "PGRST202",
                      message: "private missing schema detail",
                    },
                  };
                if (mode === "sql-error")
                  return {
                    data: null,
                    error: {
                      code: "XX000",
                      message: "private provider credentials detail",
                    },
                  };
                await asUser(actor, aal);
                const keys =
                  name === "composio_binding_page"
                    ? ["account", "cursor", "page_size"]
                    : name === "composio_binding_command"
                      ? ["account", "kind", "p", "request_key"]
                      : null;
                assert.ok(keys, "Unexpected RPC");
                try {
                  let v = (
                    await db.query<{ v: unknown }>(
                      "select " +
                        name +
                        "(" +
                        keys.map((_, i) => "$" + (i + 1)).join(",") +
                        ") v",
                      keys.map((k) => p[k]),
                    )
                  ).rows[0].v;
                  if (mode === "bad-dto")
                    v = { ...(v as object), private_token: "must-not-escape" };
                  return { data: v, error: null };
                } catch (error) {
                  return {
                    data: null,
                    error: {
                      code: (error as { code?: string }).code,
                      message: (error as Error).message,
                    },
                  };
                }
              },
            },
          };
        },
        serviceClient: () => {
          serviceCalls++;
          throw new Error("Service fallback forbidden");
        },
      },
    });
    try {
      const route =
        await import("../src/app/api/mail/accounts/[id]/composio/route");
      const context = (id: string = accounts[0]) => ({
        params: Promise.resolve({ id }),
      });
      const get = (query = "", id: string = accounts[0]) =>
        route.GET(
          new Request(
            origin + "/api/mail/accounts/" + id + "/composio" + query,
          ),
          context(id),
        );
      const post = (body: unknown, id = accounts[0], requestOrigin = origin) =>
        route.POST(
          new Request(origin + "/api/mail/accounts/" + id + "/composio", {
            method: "POST",
            headers: {
              Origin: requestOrigin,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }),
          context(id),
        );
      const readPage = async () => {
        const response = await get();
        assert.equal(response.status, 200);
        return (await response.json()) as BindingPage;
      };
      await t.test(
        "requires session/MFA and operational roles have no access before SQL",
        async () => {
          session = false;
          assert.equal((await get()).status, 401);
          session = true;
          aal = "aal1";
          assert.equal((await get()).status, 403);
          aal = "aal2";
          for (const id of f.roles) {
            actor = id;
            assert.equal((await get()).status, 403);
            assert.equal((await post({})).status, 403);
          }
          actor = users.admin;
          assert.equal(calls.length, 0);
        },
      );
      await t.test(
        "Origin, query, path, body size and strict shape are validated before mutation",
        async () => {
          assert.equal(
            (await post({}, accounts[0], "https://other.test")).status,
            403,
          );
          for (const query of [
            "?limit=0",
            "?limit=101",
            "?limit=25&limit=25",
            "?cursor=bad",
            "?private=x",
          ])
            assert.equal((await get(query)).status, 400);
          assert.equal((await get("", "not-a-uuid")).status, 400);
          assert.equal((await post({})).status, 400);
          const url =
            origin + "/api/mail/accounts/" + accounts[0] + "/composio";
          assert.equal(
            (
              await route.POST(
                new Request(url, {
                  method: "POST",
                  headers: {
                    Origin: origin,
                    "Content-Type": "application/json",
                  },
                  body: "{",
                }),
                context(),
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await route.POST(
                new Request(url, {
                  method: "POST",
                  headers: {
                    Origin: origin,
                    "Content-Type": "application/json",
                    "Content-Length": "17000",
                  },
                  body: "{}",
                }),
                context(),
              )
            ).status,
            413,
          );
          assert.equal(
            (
              await route.POST(
                new Request(url, {
                  method: "POST",
                  headers: {
                    Origin: origin,
                    "Content-Type": "application/json-extra",
                  },
                  body: "{}",
                }),
                context(),
              )
            ).status,
            400,
          );
          assert.equal(calls.length, 0);
        },
      );
      await t.test(
        "SQL absent, unknown error and adulterated DTO fail closed without service or detail leaks",
        async () => {
          for (mode of ["missing", "sql-error", "bad-dto"]) {
            const response = await get();
            assert.equal(response.status, 503);
            const body = await response.text();
            assert(!/private|must-not-escape/.test(body));
            assert.equal(response.headers.get("cache-control"), "no-store");
          }
          mode = "normal";
          assert.equal((await get("", randomUUID())).status, 404);
          assert.equal(serviceCalls, 0);
        },
      );
      let created = "";
      await t.test(
        "valid candidate uses bounded RPC, no-store DTO and canonical retry, never active",
        async () => {
          const page = await readPage();
          assert.ok(bindingPageSchema.safeParse(page).success);
          const payload = { ...bindingExpected(page), ...c1Candidate },
            request = {
              kind: "register_candidate",
              payload,
              idempotency_key: randomUUID(),
            };
          const first = await post(request);
          assert.equal(first.status, 200);
          const result = await first.json();
          created = result.id;
          assert.equal(result.transport, "gmail_oauth");
          assert.equal(result.composio_enabled, false);
          const retry = await post({
            ...request,
            payload: {
              ...payload,
              composio_user_id: " " + payload.composio_user_id + " ",
            },
          });
          assert.equal(retry.status, 200);
          assert.deepEqual(await retry.json(), result);
          assert.equal(
            (
              await post({
                ...request,
                payload: { ...payload, connected_account_id: "ca_other" },
              })
            ).status,
            409,
          );
          const current = await readPage();
          assert.equal(current.current?.id, created);
          for (const value of Object.values(c1Candidate))
            assert(!JSON.stringify(current).includes(value));
          assert.equal(
            (
              await post({
                ...request,
                idempotency_key: randomUUID(),
                payload: { ...payload, verified: true },
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "stale preparation and fabricated confirmation are rejected, then local revoke succeeds",
        async () => {
          const page = await readPage();
          const expected = bindingExpected(page);
          assert.equal(
            (
              await post({
                kind: "register_candidate",
                payload: {
                  ...expected,
                  ...c1Candidate,
                  expected_head_revision: 0,
                },
                idempotency_key: randomUUID(),
              })
            ).status,
            409,
          );
          const confirm = await post({
            kind: "confirm_binding",
            payload: {
              ...expected,
              binding_id: created,
              check_id: randomUUID(),
            },
            idempotency_key: randomUUID(),
          });
          assert.equal(confirm.status, 409);
          assert.equal(
            (await confirm.json()).code,
            "C_BINDING_EVIDENCE_REQUIRED",
          );
          const revoked = await post({
            kind: "revoke_binding",
            payload: {
              ...expected,
              binding_id: created,
              reason: "operator_revoked",
            },
            idempotency_key: randomUUID(),
          });
          assert.equal(revoked.status, 200);
          assert.equal((await readPage()).current?.status, "revoked");
          assert.equal(serviceCalls, 0);
          assert(
            calls.every((name) =>
              ["composio_binding_page", "composio_binding_command"].includes(
                name,
              ),
            ),
          );
        },
      );
    } finally {
      module.restore();
      await db.close();
    }
  });
