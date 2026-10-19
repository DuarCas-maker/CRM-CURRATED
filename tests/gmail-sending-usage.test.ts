import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { encrypt } from "../src/lib/server/crypto";
import { syncSendingUsage } from "../worker/gmail-sending-usage";

test("external sending usage resumes pages, stores metadata only and marks freshness only after a complete scan", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://usage-fixture.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    GOOGLE_OAUTH_ORGANIZATIONS: JSON.stringify([
      {
        id: "fixture",
        domain: "example.test",
        clientId: "fixture",
        clientSecret: "fixture",
      },
    ]),
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  const account = {
    id: randomUUID(),
    organization: "fixture",
    email: "sender@example.test",
    status: "connected",
  };
  const stored: Record<string, unknown>[] = [],
    jobs: { payload: Parameters<typeof syncSendingUsage>[0] }[] = [];
  let synced = 0,
    reads = 0,
    failRead = false;
  t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({
    token: "fixture",
  }));
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
          input instanceof Request ? input : new Request(input, init),
        url = new URL(request.url);
      const body = ["POST", "PATCH"].includes(request.method)
        ? await request.json()
        : null;
      if (url.hostname === "gmail.googleapis.com") {
        if (url.pathname.endsWith("/messages"))
          return Response.json(
            url.searchParams.has("pageToken")
              ? {}
              : {
                  messages: [{ id: "outside-crm" }],
                  nextPageToken: "next-page",
                },
          );
        assert.equal(url.searchParams.get("format"), "metadata");
        reads++;
        if (failRead) throw new TypeError("fixture connection failure");
        return Response.json({
          internalDate: String(Date.now()),
          payload: {
            headers: [
              { name: "Message-ID", value: "<outside-crm@example.test>" },
              { name: "To", value: '"Last, First" <first@client.test>' },
              { name: "Cc", value: "second@client.test" },
            ],
          },
        });
      }
      const resource = url.pathname.split("/").at(-1);
      if (resource === "reserve_gmail_api") return Response.json(0);
      if (resource === "mail_accounts") {
        if (request.method === "PATCH") {
          assert(body.external_usage_synced_at);
          synced++;
          return new Response(null, { status: 204 });
        }
        return Response.json(account);
      }
      if (resource === "mail_credentials")
        return Response.json({ encrypted_refresh_token: encrypt("fixture") });
      if (resource === "gmail_sent_usage") {
        if (request.method === "GET") return Response.json([]);
        if (request.method === "POST") stored.push(body);
        return new Response(null, { status: 204 });
      }
      if (resource === "jobs") {
        jobs.push(body);
        return new Response(null, { status: 204 });
      }
      throw Error(`Unexpected usage fixture request: ${resource}`);
    },
  );
  try {
    const payload = {
      account_id: account.id,
      since: Math.floor(Date.now() / 1000) - 86400,
      cycle: 1,
    };
    await syncSendingUsage(payload);
    assert.equal(reads, 1);
    assert.equal(synced, 0);
    assert.equal(jobs.length, 1);
    assert.equal(stored[0].recipients, 2);
    assert.equal(stored[0].internet_message_id, "<outside-crm@example.test>");
    assert(!("body" in stored[0]));
    assert(!("email" in stored[0]));
    assert.equal(jobs[0].payload.since, payload.since);
    assert.equal(jobs[0].payload.page_token, "next-page");
    await syncSendingUsage(jobs[0].payload);
    assert.equal(synced, 1);
    failRead = true;
    await assert.rejects(
      syncSendingUsage({ ...payload, cycle: 2 }),
      /connection failure/,
    );
    assert.equal(synced, 1, "a partial failure cannot claim fresh usage");
    assert.equal(jobs.length, 1, "a failed page never advances the cursor");
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
