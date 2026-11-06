import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { OAuth2Client } from "google-auth-library";
import { encrypt } from "../src/lib/server/crypto";
import { buildMime } from "../worker/mime";
import { GmailError, isGmailQuotaError } from "../src/lib/gmail-errors";
import { gmail } from "../src/lib/server/google";
import { createMailTransport } from "../src/lib/server/mail-transport/factory";
import type { GmailRequest } from "../src/lib/server/mail-transport/contract";
import { MailTransportError } from "../src/lib/server/mail-transport/errors";
import {
  composioProxyUrl,
  proxyRequestLimit,
  proxyResponseLimit,
} from "../src/lib/server/mail-transport/composio-proxy";
import {
  fixtureBinding,
  fixtureKey,
  fixtureData,
  fixtureMime,
  fixtureRaw,
  fixtureSend,
  fakeProxy,
  jsonResponse,
} from "./fixtures/pipeline-os-s02-transport";

function proxy(response: () => Response | Promise<Response>) {
  const fake = fakeProxy(response);
  return {
    ...fake,
    transport: createMailTransport({
      provider: "composio",
      apiKey: fixtureKey,
      binding: fixtureBinding,
      fetchImpl: fake.fetchImpl,
    }),
  };
}
const errorCode =
  (code: string, uncertain = false) =>
  (error: unknown) => {
    assert(error instanceof MailTransportError);
    assert.equal(error.code, code);
    assert.equal(error.deliveryUncertain, uncertain);
    assert(!JSON.stringify(error).includes(fixtureKey));
    assert.equal(error.cause, undefined);
    return true;
  };

test("AC01/10: product selects only direct, new modules have no env, DB, S00 or client imports", () => {
  const source = fs.readFileSync("src/lib/server/google.ts", "utf8");
  assert.match(source, /provider: "gmail_oauth"/);
  assert.doesNotMatch(
    source,
    /COMPOSIO_|composioProxyTransport|provider: "composio"/,
  );
  for (const name of [
    "contract",
    "errors",
    "factory",
    "gmail-direct",
    "composio-proxy",
  ]) {
    const text = fs.readFileSync(
      `src/lib/server/mail-transport/${name}.ts`,
      "utf8",
    );
    assert.doesNotMatch(
      text,
      /process\.env|readFile|serviceClient|s00-|use client/,
    );
  }
  assert.throws(
    () => createMailTransport({ provider: "unknown" } as never),
    errorCode("INVALID_TRANSPORT_CONFIGURATION"),
  );
  assert.throws(
    () => createMailTransport({ provider: "gmail_oauth", accessToken: "" }),
    errorCode("INVALID_TRANSPORT_CONFIGURATION"),
  );
});

test("AC02: direct wire extraction preserves raw MIME, options, timeout, headers and JSON without quota or OAuth inside", async () => {
  const raw = fixtureRaw;
  const body = JSON.stringify({ raw, threadId: "def456" });
  const fake = fakeProxy(() => jsonResponse(fixtureData.send));
  const transport = createMailTransport({
    provider: "gmail_oauth",
    accessToken: "fixture-access",
    fetchImpl: fake.fetchImpl,
  });
  assert.equal(transport.provider, "gmail_oauth");
  assert.deepEqual(
    await transport.execute({
      path: "messages/send",
      init: {
        method: "POST",
        body,
        headers: { "X-Fixture": "kept" },
        cache: "no-store",
      },
    }),
    fixtureData.send,
  );
  assert.equal(fake.calls.length, 1);
  assert.equal(
    fake.calls[0].url,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
  );
  assert.equal(fake.calls[0].init.body, body);
  assert.equal(fake.calls[0].init.cache, "no-store");
  assert.deepEqual(fake.calls[0].init.headers, {
    Authorization: "Bearer fixture-access",
    "Content-Type": "application/json",
    "X-Fixture": "kept",
  });
  assert(fake.calls[0].init.signal instanceof AbortSignal);
  assert.equal(Buffer.from(raw, "base64url").toString(), fixtureMime);
});

test("AC02/07: direct provider keeps Gmail quota and permission errors with operation and Retry-After", async (t) => {
  for (const [status, reason, quota] of [
    [429, "userRateLimitExceeded", true],
    [403, "domainPolicy", false],
    [401, "authError", false],
  ] as const) {
    await t.test(String(status), async () => {
      const fake = fakeProxy(() =>
        jsonResponse(
          { error: { errors: [{ reason, message: fixtureKey }] } },
          status,
          { "retry-after": "23" },
        ),
      );
      const transport = createMailTransport({
        provider: "gmail_oauth",
        accessToken: "fixture-access",
        fetchImpl: fake.fetchImpl,
      });
      await assert.rejects(
        transport.execute({ path: "messages/send", init: { method: "POST" } }),
        (e: unknown) => {
          assert(e instanceof GmailError);
          assert.equal(e.status, status);
          assert.equal(e.reason, reason);
          assert.equal(e.operation, "messages.send");
          assert.equal(e.retryAfter, 23);
          assert.equal(isGmailQuotaError(e), quota);
          assert(!JSON.stringify(e).includes(fixtureKey));
          return true;
        },
      );
    });
  }
});

test("AC03/09: each proxy resource preserves Gmail identity, body, cursor and signature, using only its bound connection", async (t) => {
  const cases = [
    ["profile", fixtureData.profile],
    [
      "messages?q=rfc822msgid%3Afixture%40example.test&pageToken=opaque%2B%2F%3D&fields=messages(id,threadId),nextPageToken",
      fixtureData.messages,
    ],
    [
      "messages/abc123?format=metadata&metadataHeaders=From&metadataHeaders=To",
      fixtureData.message,
    ],
    ["threads/def456?format=full", fixtureData.thread],
    [
      "history?startHistoryId=1234567&historyTypes=messageAdded",
      fixtureData.history,
    ],
    ["messages/abc123/attachments/fixture_part_1", fixtureData.attachment],
    ["settings/sendAs/mailbox%40example.test", fixtureData.signature],
    ["messages/send", fixtureData.send],
  ] as const;
  for (const [path, data] of cases) {
    await t.test(path.split("?")[0], async () => {
      const p = proxy(() => jsonResponse({ status: 200, data }));
      const init =
        path === "messages/send"
          ? { method: "POST", body: JSON.stringify(fixtureSend) }
          : undefined;
      assert.deepEqual(await p.transport.execute({ path, init }), data);
      assert.equal(p.calls.length, 1);
      const request = p.calls[0];
      assert.equal(request.url, composioProxyUrl);
      assert.equal(request.init.method, "POST");
      assert.equal(request.init.redirect, "manual");
      assert.equal(
        new Headers(request.init.headers).get("x-api-key"),
        fixtureKey,
      );
      const sent = JSON.parse(String(request.init.body));
      assert.equal(
        sent.connected_account_id,
        fixtureBinding.connectedAccountId,
      );
      assert.equal(sent.user_id, fixtureBinding.userId);
      assert.equal(
        new URL(sent.endpoint).pathname,
        "/gmail/v1/users/me/" + path.split("?")[0],
      );
      if (init) assert.deepEqual(sent.body, fixtureSend);
      else assert.equal(sent.body, undefined);
      if (path.startsWith("messages?"))
        assert.equal(
          new URL(sent.endpoint).searchParams.get("pageToken"),
          "opaque+/=",
        );
    });
  }
});

test("AC05/06: binding rejects unknown project, wrong identity, owner/config/status/revision and copies its snapshot", async () => {
  const fake = fakeProxy(() =>
    jsonResponse({ status: 200, data: fixtureData.profile }),
  );
  for (const delta of [
    { accountId: "not-uuid" },
    { connectedAccountId: "ac_wrong" },
    { authConfigId: "ca_wrong" },
    { userId: "" },
    { userId: "owner\nprivate" },
    { identityVerified: false },
    { status: "revoked" },
    { revision: 0 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { verifiedMailboxEmail: "other@example.test" },
    { quotaProjectId: "" },
    { quotaProjectId: undefined },
    { quotaProjectId: 123 },
  ])
    assert.throws(
      () =>
        createMailTransport({
          provider: "composio",
          apiKey: fixtureKey,
          binding: { ...fixtureBinding, ...delta },
          fetchImpl: fake.fetchImpl,
        } as never),
      errorCode("INVALID_COMPOSIO_BINDING"),
    );
  for (const delta of [
    { apiKey: "" },
    { apiKey: "ac_wrong" },
    { apiKey: "private\r\nvalue" },
    { fetchImpl: undefined },
  ]) {
    assert.throws(
      () =>
        createMailTransport({
          provider: "composio",
          apiKey: fixtureKey,
          binding: fixtureBinding,
          fetchImpl: fake.fetchImpl,
          ...delta,
        } as never),
      errorCode("INVALID_TRANSPORT_CONFIGURATION"),
    );
  }
  assert.equal(fake.calls.length, 0);
  const binding = { ...fixtureBinding };
  const transport = createMailTransport({
    provider: "composio",
    apiKey: fixtureKey,
    binding,
    fetchImpl: fake.fetchImpl,
  });
  Object.assign(binding, {
    connectedAccountId: "ca_changed",
    userId: "changed",
    mailboxEmail: "changed@example.test",
  });
  await transport.execute({ path: "profile" });
  assert.equal(
    JSON.parse(String(fake.calls[0].init.body)).connected_account_id,
    fixtureBinding.connectedAccountId,
  );
});

test("AC06: unlisted routes, methods, injection, extra send fields and request options fail before any HTTP", async () => {
  const p = proxy(() => {
    throw Error("fetch must not run");
  });
  const requests: GmailRequest[] = [
    { path: "https://attacker.example.test/profile" },
    { path: "//attacker.example.test/profile" },
    { path: "../profile" },
    { path: "messages/../profile" },
    { path: "messages/%2fprofile" },
    { path: "profile#secret" },
    { path: "profile\nprivate" },
    { path: "profile?fields=id?x=2" },
    { path: "watch", init: { method: "POST" } },
    { path: "stop", init: { method: "POST" } },
    { path: "messages/abc123", init: { method: "DELETE" } },
    { path: "settings/sendAs/other%40example.test" },
    { path: "settings/sendAs/mailbox%2540example.test" },
    { path: "profile?redirect=https://attacker.example.test" },
    { path: "messages?q=bad%0Aquery" },
    {
      path: "messages/send",
      init: {
        method: "POST",
        body: JSON.stringify({ ...fixtureSend, account_id: "other" }),
      },
    },
    {
      path: "messages/send",
      init: { method: "POST", body: JSON.stringify({ raw: "bad!" }) },
    },
    { path: "messages/send", init: { method: "POST", body: "{invalid-json" } },
    {
      path: "messages/send",
      init: { method: "POST", body: new Blob(["fixture"]) },
    },
    { path: "profile", init: { body: "{}" } },
    { path: "profile", init: { headers: { Authorization: "Bearer other" } } },
    { path: "profile", init: { redirect: "follow" } },
  ];
  for (const request of requests)
    await assert.rejects(
      p.transport.execute(request),
      errorCode("INVALID_GMAIL_REQUEST"),
    );
  assert.equal(p.calls.length, 0);
  await assert.rejects(
    p.transport.execute({ path: "profile", init: null } as never),
    errorCode("INVALID_GMAIL_REQUEST"),
  );
});

test("AC03/09: empty lists and zero-byte attachments are valid, but invalid unit resources or cursor types are not", async () => {
  for (const [path, data] of [
    ["messages", {}],
    ["messages", { messages: [] }],
    ["history", { historyId: "123" }],
    ["messages/abc123/attachments/part", { size: 0, data: "" }],
  ] as const) {
    assert.deepEqual(
      await proxy(() => jsonResponse({ status: 200, data })).transport.execute({
        path,
      }),
      data,
    );
  }
  for (const [path, data] of [
    ["profile", { ...fixtureData.profile, emailAddress: "wrong@example.test" }],
    ["messages", { messages: "not-array" }],
    ["messages", { nextPageToken: 42 }],
    ["history", { historyId: 123 }],
    ["history", { historyId: "123", history: [{ messagesAdded: [{}] }] }],
    ["messages/abc123", {}],
    ["messages/abc123", { id: "fff999" }],
    ["threads/def456", { id: "fff999" }],
    ["threads/def456", { id: "def456", messages: [null] }],
    ["messages/abc123/attachments/part", { data: "not!base64" }],
    ["messages/abc123/attachments/part", { data: "SGVsbG8", size: 4 }],
    [
      "messages/abc123/attachments/part",
      { data: "SGVsbG8=".slice(0, -1) + "==" },
    ],
    ["settings/sendAs/mailbox%40example.test", {}],
  ] as const)
    await assert.rejects(
      proxy(() => jsonResponse({ status: 200, data })).transport.execute({
        path,
      }),
      errorCode("COMPOSIO_INVALID_RESPONSE"),
    );
});

test("AC07/08: external rejection stays a Composio error, with no retry, fallback, secret or false Google quota classification", async (t) => {
  for (const [status, code] of [
    [401, "COMPOSIO_AUTH_REJECTED"],
    [403, "COMPOSIO_AUTH_REJECTED"],
    [429, "COMPOSIO_RATE_LIMITED"],
    [500, "COMPOSIO_UNAVAILABLE"],
    [422, "COMPOSIO_HTTP_REJECTED"],
    [302, "COMPOSIO_REDIRECT_REJECTED"],
  ] as const) {
    await t.test(String(status), async () => {
      const p = proxy(
        () =>
          new Response(fixtureKey, {
            status,
            headers: {
              "retry-after": "7",
              location: "https://private.example.test/secret",
            },
          }),
      );
      await assert.rejects(
        p.transport.execute({
          path: "messages/send",
          init: { method: "POST", body: JSON.stringify(fixtureSend) },
        }),
        (e: unknown) => {
          errorCode(code, true)(e);
          assert.equal(isGmailQuotaError(e), false);
          if (status === 429)
            assert.equal((e as MailTransportError).retryAfter, 7);
          return true;
        },
      );
      assert.equal(p.calls.length, 1);
    });
  }
});

test("AC07: wrapped Gmail errors preserve their Google layer, without using external Retry-After as Google's", async () => {
  for (const [status, reason] of [
    [401, "authError"],
    [403, "domainPolicy"],
    [429, "userRateLimitExceeded"],
  ] as const) {
    const p = proxy(() =>
      jsonResponse(
        {
          status,
          data: { error: { errors: [{ reason, message: fixtureKey }] } },
        },
        200,
        { "retry-after": "999" },
      ),
    );
    await assert.rejects(
      p.transport.execute({ path: "profile" }),
      (e: unknown) => {
        assert(e instanceof GmailError);
        assert.equal(e.status, status);
        assert.equal(e.reason, reason);
        assert.equal(e.retryAfter, 0);
        assert(!JSON.stringify(e).includes(fixtureKey));
        return true;
      },
    );
    assert.equal(p.calls.length, 1);
  }
});

test("AC08: network failure or malformed success after POST remains uncertain and makes one attempt", async () => {
  const responses = [
    () => {
      throw Error(fixtureKey);
    },
    () =>
      new Response("truncated private JSON", {
        headers: { "content-type": "application/json" },
      }),
    () => jsonResponse({ status: "200", data: fixtureData.send }),
    () => jsonResponse({ status: 200, data: {} }),
    () => jsonResponse({ status: 204, data: {} }),
    () => jsonResponse({ status: 302, data: {} }),
  ];
  for (const response of responses) {
    const p = proxy(response);
    await assert.rejects(
      p.transport.execute({
        path: "messages/send",
        init: { method: "POST", body: JSON.stringify(fixtureSend) },
      }),
      (e: unknown) => {
        assert(e instanceof MailTransportError);
        assert.equal(e.deliveryUncertain, true);
        assert(!JSON.stringify(e).includes(fixtureKey));
        return true;
      },
    );
    assert.equal(p.calls.length, 1);
  }
});

test("AC06/08: aborted requests never dispatch; stalled body reads abort with redacted uncertainty", async () => {
  const p = proxy(() =>
    jsonResponse({ status: 200, data: fixtureData.profile }),
  );
  await assert.rejects(
    p.transport.execute({
      path: "profile",
      init: { signal: AbortSignal.abort() },
    }),
    errorCode("COMPOSIO_NETWORK_OR_TIMEOUT"),
  );
  assert.equal(p.calls.length, 0);
  const controller = new AbortController();
  const stalled = proxy(() => {
    setImmediate(() => controller.abort());
    return new Response(
      new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  await assert.rejects(
    stalled.transport.execute({
      path: "messages/send",
      init: {
        method: "POST",
        body: JSON.stringify(fixtureSend),
        signal: controller.signal,
      },
    }),
    errorCode("COMPOSIO_NETWORK_OR_TIMEOUT", true),
  );
  assert.equal(stalled.calls.length, 1);
  const pending = new AbortController();
  const hanging = proxy(() => new Promise<Response>(() => {}));
  const promise = hanging.transport.execute({
    path: "profile",
    init: { signal: pending.signal },
  });
  pending.abort();
  await assert.rejects(promise, errorCode("COMPOSIO_NETWORK_OR_TIMEOUT"));
  assert.equal(hanging.calls.length, 1);
});

test("AC09: attachment response exceeds old 2.1MB trial limit without corruption, oversized responses and raw payloads fail explicitly", async () => {
  const bytes = Buffer.alloc(20 * 1024 * 1024, 5);
  const data = { data: bytes.toString("base64url"), size: bytes.length };
  const p = proxy(() => jsonResponse({ status: 200, data }));
  const result = await p.transport.execute<typeof data>({
    path: "messages/abc123/attachments/part",
  });
  assert.deepEqual(Buffer.from(result.data, "base64url"), bytes);
  const tooLarge = proxy(() =>
    jsonResponse({}, 200, { "content-length": String(proxyResponseLimit + 1) }),
  );
  await assert.rejects(
    tooLarge.transport.execute({ path: "profile" }),
    errorCode("MAIL_RESPONSE_TOO_LARGE"),
  );
  const oversized = proxy(() => {
    throw Error("no HTTP for oversized body");
  });
  await assert.rejects(
    oversized.transport.execute({
      path: "messages/send",
      init: {
        method: "POST",
        body: JSON.stringify({ raw: "A".repeat(proxyRequestLimit) }),
      },
    }),
    errorCode("MAIL_REQUEST_TOO_LARGE"),
  );
  assert.equal(oversized.calls.length, 0);
});

test("AC09: 18MiB outgoing attachment survives MIME then base64url, within the 40MiB proxy bound", async () => {
  const raw = buildMime({
    from: fixtureBinding.mailboxEmail,
    to: "controlled@example.test",
    subject: "Size fixture",
    body: "Fixture",
    messageId: "<s02-size@example.test>",
    attachments: [
      {
        name: "fixture.pdf",
        mime: "application/pdf",
        bytes: Buffer.alloc(18 * 1024 * 1024, 3),
      },
    ],
  });
  const p = proxy(() => jsonResponse({ status: 200, data: fixtureData.send }));
  await p.transport.execute({
    path: "messages/send",
    init: { method: "POST", body: JSON.stringify({ raw }) },
  });
  const body = String(p.calls[0].init.body);
  assert(Buffer.byteLength(body) < proxyRequestLimit);
  assert.equal(JSON.parse(body).body.raw, raw);
  const overflow = proxy(() => {
    throw Error("must not dispatch envelope overflow");
  });
  await assert.rejects(
    overflow.transport.execute({
      path: "messages/send",
      init: {
        method: "POST",
        body: JSON.stringify({ raw: "A".repeat(proxyRequestLimit - 24) }),
      },
    }),
    errorCode("MAIL_REQUEST_TOO_LARGE"),
  );
  assert.equal(overflow.calls.length, 0);
});

test("AC08/09: streamed overflow, wrong content type and corrupt UTF8 cannot masquerade as successful proxy JSON", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const p = proxy(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < 33; i++) controller.enqueue(chunk);
            controller.close();
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  await assert.rejects(
    p.transport.execute({ path: "profile" }),
    errorCode("MAIL_RESPONSE_TOO_LARGE"),
  );
  for (const response of [
    () => new Response("{}", { headers: { "content-type": "text/html" } }),
    () =>
      new Response(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]), {
        headers: { "content-type": "application/json" },
      }),
  ])
    await assert.rejects(
      proxy(response).transport.execute({ path: "profile" }),
      errorCode("COMPOSIO_INVALID_RESPONSE"),
    );
});

test("AC03/09: caller mutation during a request cannot redirect its binding or change response correlation", async () => {
  const request = { path: "messages/abc123" };
  const p = proxy(() => {
    request.path = "messages/fff999";
    return jsonResponse({ status: 200, data: fixtureData.message });
  });
  assert.deepEqual(await p.transport.execute(request), fixtureData.message);
  assert.equal(
    new URL(JSON.parse(String(p.calls[0].init.body)).endpoint).pathname,
    "/gmail/v1/users/me/messages/abc123",
  );
});

test("AC01/04/05: real facade retains OAuth -> reservation -> final hook -> direct wire, and vetoes before HTTP", async (t) => {
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: "https://s02-supabase.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "s02-service-fixture",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    GOOGLE_OAUTH_ORGANIZATIONS: JSON.stringify([
      {
        id: "s02-fixture",
        domain: "example.test",
        clientId: "123-fixture.apps.googleusercontent.com",
        clientSecret: "s02-client-fixture",
        projectId: "s02-project",
      },
    ]),
    COMPOSIO_API_KEY: fixtureKey,
    MAIL_TRANSPORT: "composio",
  };
  const prior = Object.fromEntries(
    Object.keys(environment).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, environment);
  const events: string[] = [];
  let reservation: unknown = 0,
    wire = 0;
  const calls: { name: string; body?: unknown }[] = [];
  try {
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => {
      events.push("oauth");
      return { token: "s02-access-fixture" };
    });
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname === "s02-supabase.example.test") {
          if (url.pathname.endsWith("mail_accounts"))
            return jsonResponse({
              id: fixtureBinding.accountId,
              status: "connected",
              organization: "s02-fixture",
            });
          if (url.pathname.endsWith("mail_credentials"))
            return jsonResponse({
              encrypted_refresh_token: encrypt("s02-refresh-fixture"),
            });
          if (url.pathname.endsWith("reserve_gmail_api")) {
            events.push("reserve");
            calls.push({
              name: "reserve",
              body: JSON.parse(String(init?.body)),
            });
            return jsonResponse(reservation);
          }
        }
        assert.equal(url.hostname, "gmail.googleapis.com");
        wire++;
        events.push("wire");
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer s02-access-fixture",
        );
        return jsonResponse({ historyId: "123" });
      },
    );
    assert.deepEqual(
      await gmail(fixtureBinding.accountId, "profile", {}, async () => {
        events.push("hook");
      }),
      { historyId: "123" },
    );
    assert.deepEqual(events, ["oauth", "reserve", "hook", "wire"]);
    assert.deepEqual(calls[0].body, {
      account: fixtureBinding.accountId,
      project: "s02-project",
      units: 1,
    });
    assert.equal(wire, 1);
    await assert.rejects(
      gmail(fixtureBinding.accountId, "profile", {}, async () => {
        throw Error("DELIVERY_HELD");
      }),
      /DELIVERY_HELD/,
    );
    assert.equal(wire, 1);
    reservation = -1;
    await assert.rejects(
      gmail(fixtureBinding.accountId, "profile", {}, async () => {
        throw Error("must not call hook");
      }),
      (e: unknown) =>
        e instanceof GmailError && e.reason === "dailyLimitExceeded",
    );
    assert.equal(wire, 1);
    reservation = {};
    await assert.rejects(
      gmail(fixtureBinding.accountId, "profile"),
      /GMAIL_QUOTA_RESERVATION_FAILED/,
    );
    assert.equal(wire, 1);
  } finally {
    for (const key of Object.keys(environment)) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
});
