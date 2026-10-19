import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { hash, encrypt } from "../src/lib/server/crypto";
import { sendNext } from "../worker/gmail";
test("campaign mail sends the frozen generic attachment and rejects changed bytes before Gmail", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://campaign-fixture.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-only",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
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
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, env);
  try {
    const bytes = Buffer.from("%PDF-1.7 fictional generic brochure"),
      asset = {
        id: randomUUID(),
        name: "Brochure.pdf",
        mime_type: "application/pdf",
        storage_path: "fixture/brochure.pdf",
        content_hash: hash(bytes),
        bucket: "campaign-assets",
      };
    const account = {
      id: randomUUID(),
      email: "sender@team.test",
      organization: "fixture",
      status: "connected",
    };
    const msg = {
      id: randomUUID(),
      account_id: account.id,
      opportunity_id: randomUUID(),
      enrollment_id: randomUUID(),
      campaign_asset_snapshot: [asset],
      signature_html: "",
      sender_name: "Team",
      subject: "Hi Alex",
      body: "Fictional outreach\nhttps://example.test/unsubscribe/test",
      to_email: "recipient@fictional.test",
      message_id_header: "<fixture-campaign@test>",
      status: "queued",
    };
    let posts = 0,
      altered = false;
    let snapshot: unknown;
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({
      token: "fixture-access",
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
          posts++;
          const mime = Buffer.from(body.raw, "base64url").toString();
          assert(mime.includes(bytes.toString("base64")));
          assert.match(mime, /Brochure.pdf/);
          return Response.json({
            id: "fixture-mail",
            threadId: "fixture-thread",
          });
        }
        assert.equal(url.hostname, "campaign-fixture.example.test");
        if (url.pathname.includes("/storage/v1/")) {
          assert(
            url.pathname.includes("/campaign-assets/fixture/brochure.pdf"),
          );
          return new Response(altered ? Buffer.from("altered") : bytes, {
            headers: { "Content-Type": "application/pdf" },
          });
        }
        const path = url.pathname.split("/").pop();
        if (path === "reserve_gmail_api") return Response.json(0);
        if (path === "recheck_outbox_delivery") return Response.json(true);
        if (path === "claim_outbox") {
          if (msg.status !== "queued") return Response.json([]);
          msg.status = "sending";
          return Response.json([{ ...msg }]);
        }
        if (path === "mail_accounts") return Response.json(account);
        if (path === "mail_credentials")
          return Response.json({
            encrypted_refresh_token: encrypt("fixture-refresh"),
          });
        if (path === "outbox") {
          if (body.attachment_snapshot) snapshot = body.attachment_snapshot;
          if (body.status) msg.status = body.status;
          return new Response(null, { status: 204 });
        }
        if (path === "mark_sent") {
          msg.status = "sent";
          return Response.json(null);
        }
        if (path === "profiles") return Response.json([]);
        throw new Error(`Unexpected fixture path ${url.pathname}`);
      },
    );
    await sendNext();
    assert.equal(posts, 1);
    assert.equal(msg.status, "sent");
    assert.deepEqual(snapshot, [asset]);
    altered = true;
    msg.status = "queued";
    await sendNext();
    assert.equal(posts, 1);
    assert.equal(msg.status, "failed");
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
