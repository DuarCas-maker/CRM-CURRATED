import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as supabase from "../src/lib/server/supabase";
import { runtimeFixture } from "./fixtures/pipeline-os-s02-transport-runtime";
import { fakeBrandEnvelope } from "./fixtures/pipeline-os-s02-brand-delivery";
import { fixtureBinding } from "./fixtures/pipeline-os-s02-transport";
import {
  withMailRuntime,
  type RuntimeDependencies,
} from "../src/lib/server/mail-transport/runtime-context";
import { verificationContextHash } from "../src/lib/server/mail-accounts/composio-verifier";
import { runtimeConfiguration } from "./fixtures/pipeline-os-s02-transport-runtime";
if (!process.execArgv.includes("--experimental-test-module-mocks"))
  test("R06-I02 API composition in isolated mocked process", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const offlineImports = process.execArgv.flatMap((arg, i) =>
      arg === "--import" && process.execArgv[i + 1]?.endsWith("offline.mjs")
        ? ["--import", process.execArgv[i + 1]]
        : [],
    );
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        ...offlineImports,
        "--import",
        "tsx",
        "--test",
        "tests/pipeline-os-s02-transport-runtime-api.test.ts",
      ],
      { env, encoding: "utf8", timeout: 90000 },
    );
    assert.match(output, /# fail 0/);
  });
else {
  test("R06-I02 human route with signed fixture DB and product gates", async (t) => {
    const f = await runtimeFixture(),
      oldFlag = process.env.MAIL_TRANSPORT_ROUTING_ENABLED,
      oldOrigin = process.env.APP_ORIGIN,
      origin = "http://localhost:3000";
    let actor = f.users.admin,
      aal = "aal2",
      session = true,
      mode = "normal",
      serviceCalls = 0,
      rpcCalls = 0;
    process.env.APP_ORIGIN = origin;
    process.env.MAIL_TRANSPORT_ROUTING_ENABLED = "false";
    const module = mock.module("../src/lib/server/supabase.ts", {
      namedExports: {
        ...supabase,
        requireUser: async () => {
          if (!session)
            throw new supabase.HttpError(401, "fictional-auth-detail");
          if (aal !== "aal2")
            throw new supabase.HttpError(403, "fictional-MFA-detail");
          await f.owner();
          const profile = await f.scalar<Record<string, unknown>>(
            "select to_jsonb(p) v from profiles p where id=$1",
            [actor],
          );
          await f.human(actor, aal);
          return {
            profile,
            user: { id: actor },
            db: {
              rpc: async (name: string, p: Record<string, unknown>) => {
                rpcCalls++;
                if (mode === "missing")
                  return {
                    data: null,
                    error: { message: "fictional-private-SQL-detail" },
                  };
                try {
                  return {
                    data:
                      name === "mail_transport_page"
                        ? await f.scalar("select mail_transport_page($1) v", [
                            p.account,
                          ])
                        : await f.scalar(
                            "select mail_transport_command($1,$2,$3,$4) v",
                            [p.account, p.kind, p.p, p.request_key],
                          ),
                    error: null,
                  };
                } catch (e) {
                  return {
                    data: null,
                    error: { message: (e as Error).message },
                  };
                }
              },
            },
          };
        },
        serviceClient: () => {
          serviceCalls++;
          throw Error("SERVICE_MUST_NOT_APPROVE");
        },
      },
    });
    try {
      const route =
        await import("../src/app/api/mail/accounts/[id]/transport/route");
      const account = f.accounts[0];
      const context = () => ({ params: Promise.resolve({ id: account }) });
      const get = () =>
        route.GET(
          new Request(origin + "/api/mail/accounts/" + account + "/transport"),
          context(),
        );
      const post = (body: unknown, requestOrigin = origin) =>
        route.POST(
          new Request(origin + "/api/mail/accounts/" + account + "/transport", {
            method: "POST",
            headers: {
              Origin: requestOrigin,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }),
          context(),
        );
      await t.test(
        "disabled routing cannot mutate; session and admin/MFA still required",
        async () => {
          assert.equal((await get()).status, 503);
          assert.equal(rpcCalls, 0);
          session = false;
          assert.equal((await get()).status, 401);
          session = true;
          aal = "aal1";
          assert.equal((await get()).status, 403);
          aal = "aal2";
          actor = f.users.seller;
          assert.equal((await get()).status, 403);
          actor = f.users.admin;
        },
      );
      process.env.MAIL_TRANSPORT_ROUTING_ENABLED = "true";
      let body: Record<string, unknown>;
      await t.test(
        "direct bootstrap uses human client; exact retry returns same receipt/no-store",
        async () => {
          body = {
            kind: "bootstrap_direct",
            payload: await f.expected(),
            idempotency_key: randomUUID(),
          };
          const a = await post(body);
          assert.equal(a.status, 200);
          const value = await a.json();
          const b = await post(body);
          assert.equal(b.status, 200);
          assert.deepEqual(await b.json(), value);
          assert.equal(b.headers.get("cache-control"), "no-store");
          assert.equal(serviceCalls, 0);
        },
      );
      await t.test(
        "origin, query, body/schema and identity parameters reject without mutation",
        async () => {
          assert.equal(
            (await post(body, "https://other.example.test")).status,
            403,
          );
          assert.equal(
            (await post({ ...body, secret: "not-allowed" })).status,
            400,
          );
          assert.equal(
            (await route.GET(new Request(origin + "/api/test?x=1"), context()))
              .status,
            400,
          );
          assert.equal(
            (
              await route.GET(new Request(origin + "/api/test"), {
                params: Promise.resolve({ id: "bad" }),
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "Composio transitions are denied by code gate even when routing flag is true",
        async () => {
          const p = await f.expected(account, "composio");
          const before = rpcCalls;
          assert.equal(
            (
              await post({
                kind: "prepare_transition",
                payload: p,
                idempotency_key: randomUUID(),
              })
            ).status,
            503,
          );
          assert.equal(rpcCalls, before);
          assert.equal(serviceCalls, 0);
        },
      );
      await t.test(
        "missing SQL is unavailable and cannot leak details or use service fallback",
        async () => {
          mode = "missing";
          const r = await get();
          assert.equal(r.status, 503);
          assert.doesNotMatch(
            JSON.stringify(await r.json()),
            /private|SQL-detail|fictional/,
          );
          assert.equal(serviceCalls, 0);
          mode = "normal";
        },
      );
      await t.test(
        "DB session revocation is authoritative after web session/MFA checks",
        async () => {
          await f.owner();
          await f.db.query("delete from auth.sessions where id=$1", [
            f.sessions.get(f.users.admin),
          ]);
          assert.equal((await get()).status, 403);
        },
      );
    } finally {
      module.restore();
      if (oldFlag === undefined)
        delete process.env.MAIL_TRANSPORT_ROUTING_ENABLED;
      else process.env.MAIL_TRANSPORT_ROUTING_ENABLED = oldFlag;
      if (oldOrigin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = oldOrigin;
      await f.db.close();
    }
  });
  test("R06-I02 actual google facade and sender preserve post-send persistence boundary", async (t) => {
    const account = fixtureBinding.accountId,
      outbox = randomUUID(),
      events: string[] = [];
    let sent = false,
      failPersist = false;
    const context = {
      ...runtimeConfiguration().context,
      google_quota_project_id: fixtureBinding.quotaProjectId,
    };
    const selected = {
      ...fakeBrandEnvelope(account),
      id: outbox,
      account_id: account,
      signature_html: "",
      sender_name: "",
      subject: "Fixture",
      body: "Fixture",
      to_email: "controlled@example.test",
      cc_emails: [],
      bcc_emails: [],
      message_id_header: "<r06@fixture.test>",
      attachment_ids: [],
    };
    const client = {
      from: (table: string) => {
        const q = {
          select: () => q,
          eq: () => q,
          neq: () => q,
          update: () => q,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
          single: async () => ({
            data: { id: account, email: fixtureBinding.mailboxEmail },
            error: null,
          }),
        };
        return q;
      },
      rpc: async (name: string) => {
        events.push(name);
        if (name === "claim_outbox") return { data: [selected], error: null };
        if (name === "admit_brand_dispatch")
          return { data: randomUUID(), error: null };
        if (name === "mark_sent") {
          if (failPersist)
            return {
              data: null,
              error: { message: "fixture-persist-failure" },
            };
          sent = true;
          return { data: null, error: null };
        }
        if (name === "reserve_gmail_api") return { data: 0, error: null };
        if (name === "brand_dispatch_uncertain")
          return { data: null, error: null };
        throw Error("unexpected worker RPC");
      },
    };
    const store = mock.module("../worker/db.ts", {
      namedExports: {
        db: () => client,
        checked: (r: { data: unknown; error: unknown }) => {
          if (r.error) throw Error("DATABASE_OPERATION_FAILED");
          return r.data;
        },
        alertAdmins: async () => {},
      },
    });
    const source = mock.module("../src/lib/server/supabase.ts", {
      namedExports: {
        ...supabase,
        serviceClient: () => ({
          ...client,
          from: () => {
            throw Error("DIRECT_CREDENTIAL_MUST_NOT_BE_READ");
          },
        }),
      },
    });
    const deps: RuntimeDependencies = {
      composioEnabled: true,
      configuration: () => ({ context, apiKey: "fictional-api-key" }),
      now: () => Date.now(),
      rpc: async (name, p) => {
        if (name === "mail_transport_snapshot")
          return {
            account_id: account,
            provider: "composio",
            revision: 1,
            verification_context_hash: verificationContextHash(context),
            config_generation: 1,
            project_id: context.composio_project_id,
            auth_config_id: fixtureBinding.authConfigId,
            quota_project_id: fixtureBinding.quotaProjectId,
          };
        if (name === "mail_transport_acquire")
          return {
            id: randomUUID(),
            account_id: account,
            provider: "composio",
            revision: 1,
            operation: p.operation,
            resource: p.resource,
            deadline: new Date(Date.now() + 30000).toISOString(),
            binding: fixtureBinding,
          };
        if (name === "mail_transport_validate_context") return true;
        if (name === "mail_transport_finish") {
          events.push("finish:" + p.outcome);
          return null;
        }
        if (name === "mail_transport_settle_dispatch") {
          events.push("settle");
          return sent ? "finished" : "uncertain";
        }
        throw Error("unexpected runtime RPC");
      },
      fetchImpl: async () => {
        events.push("wire");
        return Response.json({
          status: 200,
          data: { id: "abc123", threadId: "def456" },
        });
      },
    };
    try {
      const { sendNext } = await import("../worker/gmail");
      await t.test(
        "actual sender calls mark_sent before deferred settlement, with one proxy POST",
        async () => {
          await withMailRuntime(deps, () => sendNext());
          assert(sent);
          assert(events.indexOf("wire") < events.indexOf("mark_sent"));
          assert(events.indexOf("mark_sent") < events.indexOf("settle"));
          assert(!events.includes("finish:finished"));
          assert.equal(events.filter((v) => v === "wire").length, 1);
        },
      );
      await t.test(
        "persistence failure after acceptance leaves uncertain and does not issue a second POST",
        async () => {
          sent = false;
          failPersist = true;
          events.length = 0;
          await assert.rejects(
            withMailRuntime(deps, () => sendNext()),
            /R06_UNCERTAIN/,
          );
          assert(events.includes("brand_dispatch_uncertain"));
          assert.equal(events.filter((v) => v === "wire").length, 1);
          assert(!events.includes("finish:finished"));
        },
      );
    } finally {
      store.restore();
      source.restore();
    }
  });
}
