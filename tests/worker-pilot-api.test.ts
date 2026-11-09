import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { OAuth2Client } from "google-auth-library";
import * as originalDb from "../src/lib/server/supabase";
import * as originalCrypto from "../src/lib/server/crypto";
import {
  withWorkerPilot,
  type WorkerPilotContext,
} from "../src/lib/server/worker-request-control";
import {
  fixtureBinding,
  fixtureSend,
} from "./fixtures/pipeline-os-s02-transport";
import { fakeBrandEnvelope } from "./fixtures/pipeline-os-s02-brand-delivery";

if (!process.execArgv.includes("--experimental-test-module-mocks")) {
  test("worker pilot API integration in isolated module-mock process", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
    delete env.NODE_TEST_CONTEXT;
    const preloads = process.execArgv.flatMap((arg, i) =>
      arg === "--import" && process.execArgv[i + 1]?.endsWith("offline.mjs")
        ? [arg, process.execArgv[i + 1]]
        : [],
    );
    const output = execFileSync(
      process.execPath,
      [
        ...preloads,
        "--import",
        "tsx",
        "--experimental-test-module-mocks",
        "--test",
        "tests/worker-pilot-api.test.ts",
      ],
      { encoding: "utf8", timeout: 90000, env },
    );
    assert.match(output, /# fail 0/);
  });
} else
  test("real facade and proxy obey pilot control before credentials and actual wire", async (t) => {
    const accountId = fixtureBinding.accountId;
    const previous = process.env.GOOGLE_OAUTH_ORGANIZATIONS;
    process.env.GOOGLE_OAUTH_ORGANIZATIONS = JSON.stringify([
      {
        id: "pilot-fixture",
        domain: "example.test",
        clientId: "fixture-client",
        clientSecret: "fictional-secret",
      },
    ]);
    let reads = 0,
      sdk = 0,
      oauth = 0,
      gmail = 0,
      proxies = 0,
      revoked = false,
      revokeDuringQuota = false;
    let selected: Record<string, unknown> | null = null;
    let claims = 0,
      markedSent = false,
      wireStatus = 200;
    const mutations: string[] = [];
    const client = {
      from: (table: string) => {
        reads++;
        const query = {
          select: () => query,
          eq: () => query,
          neq: () => query,
          update: () => {
            mutations.push(table);
            return query;
          },
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
          single: async () => ({
            data:
              table === "mail_accounts"
                ? {
                    id: accountId,
                    status: "connected",
                    organization: "pilot-fixture",
                    email: fixtureBinding.mailboxEmail,
                  }
                : { encrypted_refresh_token: "fixture" },
            error: null,
          }),
        };
        return query;
      },
      rpc: async (name: string) => {
        if (name === "worker_pilot_claim" && selected) {
          claims++;
          return { data: [selected], error: null };
        }
        if (name === "admit_brand_dispatch" && selected)
          return { data: "22222222-2222-4222-8222-222222222222", error: null };
        if (name === "mark_sent" && selected) {
          markedSent = true;
          return { data: null, error: null };
        }
        if (name === "brand_dispatch_uncertain" && selected)
          return { data: null, error: null };
        assert.equal(name, "reserve_gmail_api");
        if (revokeDuringQuota) revoked = true;
        return { data: 0, error: null };
      },
    };
    const dbMock = mock.module("../src/lib/server/supabase.ts", {
      namedExports: { ...originalDb, serviceClient: () => client },
    });
    const cryptoMock = mock.module("../src/lib/server/crypto.ts", {
      namedExports: { ...originalCrypto, decrypt: () => "fictional-refresh" },
    });
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => {
      sdk++;
      return { token: "normal-fixture-token" };
    });
    const wires: RequestInit[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        wires.push(init ?? {});
        if (url === "https://oauth2.googleapis.com/token") {
          oauth++;
          return Response.json({
            access_token: "pilot-token",
            expires_in: 3600,
          });
        }
        assert(url.startsWith("https://gmail.googleapis.com/"));
        gmail++;
        if (wireStatus !== 200)
          return Response.json(
            { error: { message: "fictional auth error" } },
            { status: wireStatus },
          );
        return Response.json({ id: "abc123", threadId: "def456" });
      },
    );
    const reservations: string[] = [];
    const context = (
      extra: Partial<WorkerPilotContext> = {},
    ): WorkerPilotContext => ({
      accountId,
      outboxId: "11111111-1111-4111-8111-111111111111",
      provider: "gmail_oauth",
      action: "send",
      threadId: null,
      authorize: async (r, reserve) => {
        if (revoked) return false;
        if (reserve) reservations.push(r.provider + ":" + r.kind);
        return true;
      },
      ...extra,
    });
    try {
      const facade = await import("../src/lib/server/google.ts");
      await t.test(
        "budget denied before facade token/DB/SDK/wire",
        async () => {
          await withWorkerPilot(context({ authorize: async () => false }), () =>
            assert.rejects(
              facade.gmail(accountId, "messages/send", {
                method: "POST",
                body: "{}",
              }),
              /WORKER_PILOT_HELD/,
            ),
          );
          assert.deepEqual([reads, sdk, oauth, gmail], [0, 0, 0, 0]);
        },
      );
      await t.test(
        "single bounded token refresh then exactly one reserved Gmail request",
        async () => {
          await withWorkerPilot(context(), () =>
            facade.gmail(accountId, "messages/send", {
              method: "POST",
              body: "{}",
            }),
          );
          assert.deepEqual([sdk, oauth, gmail], [0, 1, 1]);
          assert.deepEqual(reservations, ["oauth:oauth", "gmail_oauth:send"]);
          assert(wires.every((w) => w.redirect === "manual"));
        },
      );
      await t.test(
        "revocation during quota wait denies final wire without SDK refresh",
        async () => {
          const before = gmail;
          revokeDuringQuota = true;
          await withWorkerPilot(context(), () =>
            assert.rejects(
              facade.gmail(accountId, "messages/send", {
                method: "POST",
                body: "{}",
              }),
              /WORKER_PILOT_HELD/,
            ),
          );
          assert.equal(gmail, before);
          assert.equal(oauth, 1);
          revokeDuringQuota = false;
          revoked = false;
        },
      );
      await t.test("normal facade retains SDK path outside pilot", async () => {
        await facade.gmail(accountId, "profile");
        assert.equal(sdk, 1);
      });
      await t.test(
        "actual sender only claims selected message and pilot auth failure cannot pause other messages",
        async () => {
          const db = mock.module("../worker/db.ts", {
            namedExports: {
              db: () => client,
              checked: (r: { data: unknown; error: unknown }) => {
                if (r.error) throw Error("fixture DB error");
                return r.data;
              },
              alertAdmins: async () => {},
            },
          });
          try {
            const { sendNext } = await import("../worker/gmail.ts");
            selected = {
              ...fakeBrandEnvelope(accountId),
              id: context().outboxId,
              account_id: accountId,
              signature_html: "",
              sender_name: "",
              subject: "Fixture",
              body: "Fixture",
              to_email: "controlled@example.test",
              cc_emails: [],
              bcc_emails: [],
              message_id_header: "<pilot@fixture.test>",
              attachment_ids: [],
            };
            await withWorkerPilot(context(), () =>
              sendNext({ pilotId: context().outboxId, lease: "a".repeat(64) }),
            );
            assert.equal(claims, 1);
            assert.equal(markedSent, true);
            wireStatus = 401;
            markedSent = false;
            mutations.length = 0;
            await withWorkerPilot(context(), () =>
              sendNext({ pilotId: context().outboxId, lease: "a".repeat(64) }),
            );
            assert.equal(markedSent, false);
            assert(!mutations.includes("mail_accounts"));
            assert(mutations.includes("outbox"));
          } finally {
            db.restore();
            selected = null;
            wireStatus = 200;
          }
        },
      );
      await t.test(
        "Composio adapter checks budget and preserves failed attempt reservation",
        async () => {
          const { composioProxyTransport } =
            await import("../src/lib/server/mail-transport/composio-proxy.ts");
          const proxy = composioProxyTransport({
            apiKey: "fictional-api-key",
            binding: fixtureBinding,
            fetchImpl: async () => {
              proxies++;
              throw Error("fixture wire failure");
            },
          });
          await withWorkerPilot(
            context({ provider: "composio", authorize: async () => false }),
            () =>
              assert.rejects(
                proxy.execute({
                  path: "messages/send",
                  init: { method: "POST", body: JSON.stringify(fixtureSend) },
                }),
              ),
          );
          assert.equal(proxies, 0);
          await withWorkerPilot(context({ provider: "composio" }), () =>
            assert.rejects(
              proxy.execute({
                path: "messages/send",
                init: { method: "POST", body: JSON.stringify(fixtureSend) },
              }),
            ),
          );
          assert.equal(proxies, 1);
          assert.equal(reservations.at(-1), "composio:send");
          const controller = new AbortController();
          await withWorkerPilot(
            context({
              provider: "composio",
              authorize: async () => {
                controller.abort();
                return true;
              },
            }),
            () =>
              assert.rejects(
                proxy.execute({
                  path: "messages/send",
                  init: {
                    method: "POST",
                    body: JSON.stringify(fixtureSend),
                    signal: controller.signal,
                  },
                }),
              ),
          );
          assert.equal(proxies, 1); // Admission raced with cancellation: no new wire.
        },
      );
    } finally {
      dbMock.restore();
      cryptoMock.restore();
      if (previous === undefined) delete process.env.GOOGLE_OAUTH_ORGANIZATIONS;
      else process.env.GOOGLE_OAUTH_ORGANIZATIONS = previous;
    }
  });
