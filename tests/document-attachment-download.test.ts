import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import * as realDb from "../src/lib/server/supabase";
import * as realCrypto from "../src/lib/server/crypto";
import { withMailQuota } from "../src/lib/server/mail-quota";
import { quotaFixture } from "./fixtures/pipeline-os-quota-i03";

test("authorized referenced Gmail attachment downloads and previews under the active quota policy", async (t) => {
  const keys = [
    "SIMPLE_MAIL_ENABLED",
    "SIMPLE_MAIL_COMPOSIO_ENABLED",
    "MAIL_TRANSPORT_ROUTING_ENABLED",
    "MAIL_QUOTA_POLICY_ENABLED",
    "GOOGLE_OAUTH_ORGANIZATIONS",
  ];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    SIMPLE_MAIL_ENABLED: "true",
    SIMPLE_MAIL_COMPOSIO_ENABLED: "false",
    MAIL_TRANSPORT_ROUTING_ENABLED: "false",
    MAIL_QUOTA_POLICY_ENABLED: "true",
    GOOGLE_OAUTH_ORGANIZATIONS: JSON.stringify([
      {
        id: "fixture",
        domain: "example.test",
        clientId: "fixture-client",
        clientSecret: "fictional",
        projectId: "fixture-project",
      },
    ]),
  });
  const f = quotaFixture();
  f.deps.uuid = randomUUID;
  const fileId = randomUUID(),
    archiveId = randomUUID(),
    caseId = randomUUID();
  const legacyId = randomUUID(),
    legacyMessageId = randomUUID(),
    legacyConversationId = randomUUID();
  const bytes = Buffer.from(
    "%PDF-1.7\nFictional attachment for offline regression",
  );
  let allowed = true,
    wires = 0,
    credentials = 0;
  let afterCredential: () => void = () => {};
  const part = {
    part_id: "0.1",
    attachment_id: "part1",
    size: bytes.length,
    name: "fixture.pdf",
    mime_type: "application/pdf",
    data: undefined as string | undefined,
  };
  const file = {
    id: fileId,
    archive_message_id: archiveId,
    opportunity_id: caseId,
    part_id: part.part_id,
    size: bytes.length,
    name: part.name,
    storage_path: null as string | null,
    imported_document_id: null,
  };
  const archive = {
    id: archiveId,
    account_id: f.account,
    gmail_message_id: "abc123",
    encrypted_payload: "archive-fixture",
  };
  const legacyFile = {
    id: legacyId,
    message_id: legacyMessageId,
    gmail_attachment_id: "part1",
    size: bytes.length,
    name: part.name,
    imported_document_id: null,
  };
  const legacyMessage = {
    id: legacyMessageId,
    gmail_message_id: "abc123",
    conversation_id: legacyConversationId,
  };
  function chain(data: unknown) {
    let listed = false;
    const c = {
      select: () => c,
      eq: () => c,
      is: () => c,
      limit: () => {
        listed = true;
        return c;
      },
      order: () => c,
      single: async () => ({ data: structuredClone(data), error: null }),
      maybeSingle: async () => ({ data: structuredClone(data), error: null }),
      then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
        Promise.resolve(
          resolve({
            data: structuredClone(listed ? [data] : data),
            error: null,
          }),
        ),
    };
    return c;
  }
  const userDb = {
    rpc: async (name: string) => ({
      data: name === "mail_source_allowed" ? allowed : true,
      error: null,
    }),
    from: (name: string) =>
      chain(
        name === "gmail_saved_attachments"
          ? file
          : name === "mail_archive_visible"
            ? archive
            : name === "message_attachments"
              ? legacyFile
              : name === "messages"
                ? legacyMessage
                : name === "mail_conversations_visible"
                  ? { account_id: f.account, opportunity_id: caseId }
                  : name === "opportunity_workspace"
                    ? { id: caseId }
                    : [],
      ),
  };
  const service = {
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob(["stored-fixture"]),
          error: null,
        }),
      }),
    },
    from: (name: string) => {
      if (name === "mail_credentials") credentials++;
      return chain(
        name === "gmail_archive_messages"
          ? archive
          : name === "mail_accounts"
            ? { id: f.account, status: "connected", organization: "fixture" }
            : { encrypted_refresh_token: "fixture-refresh" },
      );
    },
    rpc: async (name: string) => {
      assert.equal(name, "simple_mail_managed");
      return { data: false, error: null };
    },
  };
  const dbMock = mock.module("../src/lib/server/supabase.ts", {
    namedExports: {
      ...realDb,
      requireUser: async () => ({
        db: userDb,
        user: { id: randomUUID() },
        profile: { role: "superadmin" },
      }),
      serviceClient: () => service,
    },
  });
  const cryptoMock = mock.module("../src/lib/server/crypto.ts", {
    namedExports: {
      ...realCrypto,
      decrypt: (value: string) =>
        value === "archive-fixture"
          ? JSON.stringify({ attachments: [part] })
          : value === "stored-fixture"
            ? bytes.toString("base64")
            : "synthetic-refresh",
    },
  });
  t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => {
    afterCredential();
    return { token: "synthetic-access" };
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        String(input),
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/abc123/attachments/part1",
      );
      assert.equal(init?.method || "GET", "GET");
      wires++;
      return Response.json({
        data: bytes.toString("base64url"),
        size: bytes.length,
      });
    },
  );
  try {
    const { gmail } = await import("../src/lib/server/google");
    await t.test(
      "an unscoped request is denied before credentials and provider calls",
      async () => {
        await assert.rejects(
          withMailQuota(f.deps, () =>
            gmail(f.account, "messages/abc123/attachments/part1"),
          ),
          /QGR_DENIED/,
        );
        assert.equal(credentials, 0);
        assert.equal(wires, 0);
      },
    );
    const { GET: download } =
      await import("../src/app/api/gmail/files/[id]/route");
    const { GET: review } =
      await import("../src/app/api/documents/review/route");
    const request = () =>
      new Request(`http://localhost/api/gmail/files/${fileId}`);
    await t.test(
      "download reaches Gmail through quota and returns the original bytes",
      async () => {
        const response = await withMailQuota(f.deps, () =>
          download(request(), { params: Promise.resolve({ id: fileId }) }),
        );
        assert.equal(response.status, 200, await response.clone().text());
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
        assert.match(
          response.headers.get("content-disposition")!,
          /attachment/,
        );
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(wires, 1);
      },
    );
    await t.test(
      "preview uses identical bytes and supplies the hash required for automatic classification",
      async () => {
        const response = await withMailQuota(f.deps, () =>
          review(
            new Request(
              `http://localhost/api/documents/review?source=saved&id=${fileId}&preview=true`,
            ),
          ),
        );
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal(response.headers.get("content-type"), "application/pdf");
        assert.equal(
          response.headers.get("x-document-hash"),
          realCrypto.hash(bytes),
        );
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      },
    );
    await t.test(
      "legacy conversation attachments use the same guarded preview and source hash",
      async () => {
        const response = await withMailQuota(f.deps, () =>
          review(
            new Request(
              `http://localhost/api/documents/review?source=legacy&id=${legacyId}&preview=true`,
            ),
          ),
        );
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal(
          response.headers.get("x-document-hash"),
          realCrypto.hash(bytes),
        );
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      },
    );
    await t.test(
      "inline and stored attachments keep working without credentials or Gmail",
      async () => {
        const before = { wires, credentials };
        part.data = bytes.toString("base64url");
        let response = await withMailQuota(f.deps, () =>
          download(request(), { params: Promise.resolve({ id: fileId }) }),
        );
        assert.equal(response.status, 200, await response.clone().text());
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
        part.data = undefined;
        file.storage_path = "synthetic-stored-file";
        response = await withMailQuota(f.deps, () =>
          download(request(), { params: Promise.resolve({ id: fileId }) }),
        );
        assert.equal(response.status, 200, await response.clone().text());
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
        file.storage_path = null;
        assert.deepEqual({ wires, credentials }, before);
      },
    );
    await t.test(
      "a source moved to another mailbox during credential preparation never reaches Gmail",
      async () => {
        const before = wires;
        afterCredential = () => {
          archive.account_id = randomUUID();
        };
        const response = await withMailQuota(f.deps, () =>
          download(request(), { params: Promise.resolve({ id: fileId }) }),
        );
        assert.equal(response.status, 409, await response.clone().text());
        assert.equal(wires, before);
        archive.account_id = f.account;
        afterCredential = () => {};
      },
    );
    await t.test(
      "revocation during credential preparation prevents provider emission",
      async () => {
        const before = wires;
        afterCredential = () => {
          allowed = false;
        };
        const response = await withMailQuota(f.deps, () =>
          download(request(), { params: Promise.resolve({ id: fileId }) }),
        );
        assert.equal(response.status, 404);
        assert.equal(wires, before);
        allowed = true;
        afterCredential = () => {};
      },
    );
    await t.test(
      "oversized attachments fail before credentials or Gmail",
      async () => {
        const before = { wires, credentials };
        part.size = 21 * 1024 * 1024;
        const response = await withMailQuota(f.deps, () =>
          download(request(), { params: Promise.resolve({ id: fileId }) }),
        );
        assert.equal(response.status, 413);
        assert.deepEqual({ wires, credentials }, before);
        part.size = bytes.length;
        file.size = 21 * 1024 * 1024;
        const savedResponse = await withMailQuota(f.deps, () =>
          download(request(), { params: Promise.resolve({ id: fileId }) }),
        );
        assert.equal(savedResponse.status, 413);
        assert.deepEqual({ wires, credentials }, before);
        file.size = bytes.length;
      },
    );
    await t.test(
      "revoked file access is rejected before privileged credentials or Gmail",
      async () => {
        allowed = false;
        const before = { wires, credentials };
        const response = await withMailQuota(f.deps, () =>
          download(request(), { params: Promise.resolve({ id: fileId }) }),
        );
        assert.equal(response.status, 404);
        assert.deepEqual({ wires, credentials }, before);
      },
    );
  } finally {
    dbMock.restore();
    cryptoMock.restore();
    for (const key of keys)
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
  }
});
