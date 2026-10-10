import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { encrypt } from "../src/lib/server/crypto";
import { sendNext } from "../worker/gmail";

test("sender retries confirmed quota rejections but never blindly repeats an uncertain Gmail POST", async (t) => {
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-only",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
    GOOGLE_OAUTH_ORGANIZATIONS: JSON.stringify([
      {
        id: "fixture",
        domain: "example.com",
        clientId: "fixture.apps.googleusercontent.com",
        clientSecret: "fixture-only",
      },
    ]),
  };
  const prior = Object.fromEntries(
    Object.keys(environment).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, environment);
  try {
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({
      token: "fixture-access",
    }));
    const account = {
      id: randomUUID(),
      email: "owner@example.com",
      status: "connected",
      organization: "fixture",
    };
    const msg = {
      id: randomUUID(),
      account_id: account.id,
      opportunity_id: randomUUID(),
      status: "queued",
      send_attempts: 1,
      to_email: "test@example.com",
      subject: "Fixture",
      body: "Fixture body",
      attachment_ids: [],
      gmail_file_ids: [],
      conversation_id: null,
      message_id_header: "<fixture@example.com>",
    };
    let mode:
      "quota403" | "quota429" | "ok" | "timeout" | "policy" | "db_failure" =
      "quota403";
    let posts = 0;
    const deferred: { seconds: number; error_code: string }[] = [],
      marks: unknown[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const url = new URL(req.url);
        const body = ["POST", "PATCH"].includes(req.method)
          ? await req.json()
          : null;
        if (url.hostname === "gmail.googleapis.com") {
          assert.equal(req.method, "POST");
          assert.ok(url.pathname.endsWith("messages/send"));
          posts++;
          if (mode === "timeout") throw new TypeError("Failed to fetch");
          if (["quota403", "quota429", "policy"].includes(mode))
            return Response.json(
              {
                error: {
                  errors: [
                    {
                      reason:
                        mode === "policy"
                          ? "domainPolicy"
                          : "rateLimitExceeded",
                    },
                  ],
                },
              },
              {
                status: mode === "quota429" ? 429 : 403,
                headers: { "Retry-After": "7200" },
              },
            );
          return Response.json({ id: "gmail-id", threadId: "thread-id" });
        }
        assert.equal(
          url.hostname,
          "supabase.example.test",
          "Never contact real services",
        );
        const resource = url.pathname.replace("/rest/v1/", "");
        if (resource === "rpc/claim_outbox") {
          if (msg.status !== "queued") return Response.json([]);
          msg.status = "sending";
          return Response.json([{ ...msg }]);
        }
        if (resource === "rpc/claim_notification_outbox")
          return Response.json([]);
        if (resource === "mail_accounts") {
          if (req.method === "PATCH") Object.assign(account, body);
          return Response.json(account);
        }
        if (resource === "mail_credentials")
          return Response.json({
            encrypted_refresh_token: encrypt("fixture-refresh"),
          });
        if (resource === "rpc/defer_gmail_send") {
          deferred.push(body);
          msg.status = "queued";
          return Response.json(null);
        }
        if (resource === "outbox") {
          if (body?.status) msg.status = body.status;
          return Response.json(null);
        }
        if (resource === "rpc/mark_sent") {
          if (mode === "db_failure")
            return Response.json(
              { message: "fixture DB failure" },
              { status: 500 },
            );
          marks.push(body);
          msg.status = "sent";
          return Response.json(null);
        }
        if (resource === "profiles") return Response.json([]);
        throw new Error(`Unexpected request: ${resource}`);
      },
    );
    await sendNext();
    assert.equal(msg.status, "queued");
    assert.equal(account.status, "connected");
    assert.equal(deferred[0].seconds, 7200);
    assert.equal(deferred[0].error_code, "GMAIL_HTTP_403_rateLimitExceeded");
    mode = "quota429";
    await sendNext();
    assert.equal(msg.status, "queued");
    assert.equal(account.status, "connected");
    mode = "ok";
    await sendNext();
    assert.equal(msg.status, "sent");
    assert.equal(marks.length, 1);
    for (const failure of ["timeout", "db_failure"] as const) {
      mode = failure;
      msg.status = "queued";
      await sendNext();
      assert.equal(msg.status, "uncertain");
      const before = posts;
      await sendNext();
      assert.equal(
        posts,
        before,
        "Uncertain sends cannot be claimed for repeat delivery",
      );
    }
    mode = "policy";
    msg.status = "queued";
    await sendNext();
    assert.equal(
      account.status,
      "restricted",
      "Real policy failure remains distinct from quota",
    );
    assert.equal(deferred.length, 2);
  } finally {
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
