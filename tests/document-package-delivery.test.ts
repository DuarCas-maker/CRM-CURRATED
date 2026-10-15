import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { encrypt, hash } from "../src/lib/server/crypto";
import { sendNext } from "../worker/gmail";
test("lender packages send the approved queued version even after replacement and never send altered bytes", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://document-fixture.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-only",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString("base64"),
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
    const bytes = Buffer.from("%PDF-1.7 approved original only"),
      fileId = randomUUID(),
      accountId = randomUUID();
    const original = {
      id: fileId,
      name: "First Bank - Bank Statement 1",
      bucket: "case-documents",
      storage_path: "private/original.pdf",
      content_hash: hash(bytes),
    };
    const msg = {
      id: randomUUID(),
      account_id: accountId,
      opportunity_id: randomUUID(),
      attachment_ids: [fileId],
      attachment_snapshot: [original],
      gmail_file_ids: [],
      upload_ids: [],
      forward_file_ids: [],
      conversation_id: null,
      subject: "Submission",
      body: "Fictional test only",
      to_email: "review@lender.test",
      signature_html: "",
      sender_name: "Test",
      message_id_header: "<fixture@crm.test>",
      status: "queued",
    };
    let altered = false,
      posts = 0;
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({
      token: "fixture",
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
          posts++;
          const mime = Buffer.from(body.raw, "base64url").toString();
          assert.ok(mime.includes(bytes.toString("base64")));
          return Response.json({ id: "fixture", threadId: "fixture-thread" });
        }
        assert.equal(url.hostname, "document-fixture.example.test");
        if (url.pathname.includes("/storage/v1/")) {
          assert.ok(url.pathname.endsWith("/private/original.pdf"));
          return new Response(altered ? "Changed file" : bytes, {
            headers: { "Content-Type": "application/pdf" },
          });
        }
        const path = url.pathname.split("/").pop();
        if (path === "claim_outbox") {
          if (msg.status !== "queued") return Response.json([]);
          msg.status = "sending";
          return Response.json([msg]);
        }
        if (path === "mail_accounts")
          return Response.json({
            id: accountId,
            email: "test@example.test",
            organization: "fixture",
            status: "connected",
          });
        if (path === "mail_credentials")
          return Response.json({ encrypted_refresh_token: encrypt("fixture") });
        if (path === "outbox") {
          if (body?.status) msg.status = body.status;
          return new Response(null, { status: 204 });
        }
        if (path === "mark_sent") {
          msg.status = "sent";
          return Response.json(null);
        }
        if (path === "profiles") return Response.json([]);
        if (path === "documents")
          throw new Error("Must not read the replaced current document");
        throw new Error(`Unexpected fixture request: ${url.pathname}`);
      },
    );
    await sendNext();
    assert.equal(posts, 1);
    assert.equal(msg.status, "sent");
    altered = true;
    msg.status = "queued";
    await sendNext();
    assert.equal(posts, 1);
    assert.equal(msg.status, "failed");
  } finally {
    for (const [k, v] of Object.entries(previous))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});
