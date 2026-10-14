import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { encrypt } from "../src/lib/server/crypto";
import { syncMailbox } from "../worker/gmail";

test("a real-time sync path receives a reply without any historical run and never advances the cursor after an incomplete write", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-only",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    GMAIL_HISTORY_ENABLED: "true",
    GOOGLE_OAUTH_ORGANIZATIONS: JSON.stringify([
      {
        id: "fixture",
        domain: "example.test",
        clientId: "fixture.apps.googleusercontent.com",
        clientSecret: "fixture-only",
      },
    ]),
  };
  const prior = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  try {
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({
      token: "fixture-access",
    }));
    const account = {
      id: randomUUID(),
      email: "daniel@example.test",
      organization: "fixture",
      status: "connected",
      sync_enabled: false,
      live_enabled: true,
      live_started_at: new Date().toISOString(),
    };
    const archiveId = randomUUID(),
      messageId = randomUUID(),
      fileId = randomUUID(),
      caseId = randomUUID(),
      seller = randomUUID(),
      closer = randomUUID();
    const received = {
      id: "incoming",
      threadId: "sent-test-thread",
      internalDate: String(Date.now()),
      labelIds: ["INBOX"],
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "Client <client@customer.test>" },
          { name: "To", value: account.email },
          { name: "Subject", value: "Prueba Gmail" },
          { name: "Message-ID", value: "<reply@customer.test>" },
          { name: "References", value: "<sent@crm.curated.local>" },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("Reply to the test email").toString(
                "base64url",
              ),
            },
          },
          {
            mimeType: "application/pdf",
            filename: "Statement.pdf",
            body: { attachmentId: "gmail-file", size: 20 },
          },
        ],
      },
    };
    let failWrite = true;
    let cursorWrites = 0;
    let archived = 0;
    let filesQueued = 0;
    const notifications = new Set<string>();
    const paths: string[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (url.hostname === "gmail.googleapis.com") {
          if (url.pathname.endsWith("/profile"))
            return Response.json({ historyId: "100" });
          if (url.pathname.endsWith("/messages"))
            return Response.json({ messages: [{ id: received.id }] });
          if (url.pathname.endsWith("/messages/incoming"))
            return Response.json(received);
          throw Error(`Unexpected Gmail request: ${url.pathname}`);
        }
        const path = url.pathname.split("/").pop();
        if (path === "mail_accounts") return Response.json(account);
        if (path === "mail_credentials")
          return Response.json({
            account_id: account.id,
            encrypted_refresh_token: encrypt("fixture-refresh"),
            history_id: null,
            last_reconciled_at: null,
          });
        if (path === "gmail_archive_messages") {
          assert.equal(body.account_id, account.id);
          assert.equal(body.gmail_thread_id, received.threadId);
          assert.equal(body.direction, "inbound");
          assert.equal(body.references_header, "<sent@crm.curated.local>");
          assert.equal(body.attachment_index.length, 1);
          archived++;
          return Response.json({ id: archiveId });
        }
        if (path === "gmail_record_reply") {
          assert.equal(body.archive, archiveId);
          assert.equal(body.intent, "review");
          return Response.json(null);
        }
        if (path === "gmail_associate_continuous") return Response.json(null);
        if (path === "gmail_link_message") return Response.json(messageId);
        if (path === "messages") {
          assert.equal(body.references_header, "<sent@crm.curated.local>");
          if (failWrite)
            return Response.json(
              { message: "Fixture database write failed" },
              { status: 500 },
            );
          return new Response(null, { status: 204 });
        }
        if (path === "gmail_saved_attachments") {
          assert.equal(body.auto_saved, true);
          return Response.json([{ id: fileId, storage_path: null }]);
        }
        if (path === "jobs") {
          assert.equal(body.kind, "gmail_copy_attachment");
          assert.equal(body.payload.file_id, fileId);
          filesQueued++;
          return new Response(null, { status: 201 });
        }
        if (
          path === "gmail_process_live_reply" ||
          path === "gmail_track_live_wait"
        )
          return Response.json(null);
        if (path === "gmail_thread_links")
          return Response.json({ opportunity_id: caseId });
        if (path === "opportunities")
          return Response.json({ seller_id: seller, closer_id: closer });
        if (path === "gmail_team_members") return Response.json([]);
        if (path === "notify_user") {
          notifications.add(`${body.recipient}:${body.event}`);
          return Response.json(null);
        }
        if (path === "advance_gmail_history") {
          assert.equal(body.checkpoint, "100");
          cursorWrites++;
          return Response.json(null);
        }
        throw Error(`Unexpected Supabase request: ${url.pathname}`);
      },
    );
    await assert.rejects(syncMailbox(account.id), /DATABASE_OPERATION_FAILED/);
    assert.equal(cursorWrites, 0);
    failWrite = false;
    await syncMailbox(account.id);
    assert.equal(cursorWrites, 1);
    assert.equal(archived, 2);
    assert.equal(filesQueued, 1);
    assert.equal(notifications.size, 2);
    assert.ok(
      !paths.some(
        (p) => p.includes("gmail_runs") || p.includes("gmail_claim_run"),
      ),
    );
    await syncMailbox(account.id);
    assert.equal(notifications.size, 2);
  } finally {
    for (const [key, value] of Object.entries(prior))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
