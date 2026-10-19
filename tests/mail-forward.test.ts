import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { encrypt, hash } from "../src/lib/server/crypto";
import { sendNext } from "../worker/gmail";

test("forwarding sends the original encrypted attachment bytes and refuses altered content before any Gmail send", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://forward-fixture.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-only",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    GOOGLE_OAUTH_ORGANIZATIONS: JSON.stringify([
      {
        id: "fixture",
        domain: "example.test",
        clientId: "fixture",
        clientSecret: "fixture",
      },
    ]),
  };
  const prior = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  try {
    const account = {
      id: randomUUID(),
      email: "valentina@example.test",
      organization: "fixture",
      status: "connected",
    };
    const bytes = Buffer.from("original file version"),
      fileId = randomUUID(),
      caseId = randomUUID();
    const msg = {
      id: randomUUID(),
      account_id: account.id,
      opportunity_id: caseId,
      forward_message_id: randomUUID(),
      forward_file_ids: [fileId],
      attachment_ids: [],
      gmail_file_ids: [],
      upload_ids: [],
      conversation_id: null,
      subject: "Fwd: Documents",
      body: "Forwarded document",
      to_email: "reviewer@customer.test",
      signature_html: "<b>Valentina</b>",
      sender_name: "Valentina",
      message_id_header: "<forward@crm.curated.local>",
      status: "queued",
    };
    const original = {
      id: fileId,
      name: "Original.xlsx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bucket: "gmail-documents",
      storage_path: "private/original-version",
      content_hash: hash(bytes),
    };
    let altered = false,
      posts = 0;
    let snapshot: unknown;
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({
      token: "fixture-access",
    }));
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init),
          url = new URL(req.url);
        const body = ["POST", "PATCH"].includes(req.method)
          ? await req.json()
          : null;
        if (url.hostname === "gmail.googleapis.com") {
          assert.ok(url.pathname.endsWith("/messages/send"));
          posts++;
          const mime = Buffer.from(body.raw, "base64url").toString();
          assert.match(mime, /Original.xlsx/);
          assert.ok(mime.includes(bytes.toString("base64")));
          assert.ok(
            !mime.includes("In-Reply-To:"),
            "A forwarded message starts a new thread",
          );
          return Response.json({
            id: "forwarded-gmail-message",
            threadId: "forward-thread",
          });
        }
        assert.equal(url.hostname, "forward-fixture.example.test");
        if (url.pathname.includes("/storage/v1/"))
          return new Response(
            encrypt(
              (altered ? Buffer.from("changed file") : bytes).toString(
                "base64",
              ),
            ),
            { headers: { "Content-Type": "application/octet-stream" } },
          );
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
        if (path === "messages")
          return Response.json({
            internet_message_id: "<source@crm.curated.local>",
            archive_message_id: null,
            conversation_id: randomUUID(),
          });
        if (path === "conversations")
          return Response.json({ opportunity_id: caseId });
        if (path === "outbox") {
          if (req.method === "GET")
            return Response.json({
              attachment_snapshot: [original],
              upload_ids: [fileId],
              gmail_file_ids: [],
            });
          if (body.attachment_snapshot) snapshot = body.attachment_snapshot;
          if (body.status) msg.status = body.status;
          return new Response(null, { status: 204 });
        }
        if (path === "mark_sent") {
          msg.status = "sent";
          return Response.json(null);
        }
        if (path === "profiles") return Response.json([]);
        throw Error(`Unexpected fixture request: ${url.pathname}`);
      },
    );
    await sendNext();
    assert.equal(posts, 1);
    assert.equal(msg.status, "sent");
    assert.deepEqual(snapshot, [original]);
    altered = true;
    msg.status = "queued";
    await sendNext();
    assert.equal(posts, 1, "Corrupt content must never be submitted to Gmail");
    assert.equal(msg.status, "failed");
  } finally {
    for (const [key, value] of Object.entries(prior))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
