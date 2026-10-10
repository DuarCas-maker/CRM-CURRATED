import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import {
  GmailError,
  gmailResponseError,
  isGmailQuotaError,
  gmailRunErrorMessage,
} from "../src/lib/gmail-errors";
import { GmailQuotaPacer, gmailRequestCost } from "../src/lib/gmail-quota";
import { encrypt } from "../src/lib/server/crypto";
import { archiveStep } from "../worker/gmail-archive";

test("403 quota, Workspace policy and permission failures remain distinct without exposing raw Google data", async () => {
  for (const reason of [
    "userRateLimitExceeded",
    "rateLimitExceeded",
    "dailyLimitExceeded",
    "quotaExceeded",
    "domainPolicy",
    "insufficientPermissions",
    "accessNotConfigured",
  ]) {
    const error = await gmailResponseError(
      Response.json(
        {
          error: {
            message: "private@example.com token=private-value",
            errors: [{ reason }],
          },
        },
        { status: 403 },
      ),
    );
    assert.equal(error.code, `GMAIL_HTTP_403_${reason}`);
    assert.equal(
      isGmailQuotaError(error),
      [
        "userRateLimitExceeded",
        "rateLimitExceeded",
        "dailyLimitExceeded",
        "quotaExceeded",
      ].includes(reason),
    );
    assert.ok(!error.code.includes("private"));
    assert.notEqual(gmailRunErrorMessage(error.code, "es"), error.code);
    assert.notEqual(gmailRunErrorMessage(error.code, "en"), error.code);
  }
  const unknown = await gmailResponseError(
    Response.json(
      { error: { errors: [{ reason: "private@example.com" }] } },
      { status: 403 },
    ),
  );
  assert.equal(unknown.code, "GMAIL_HTTP_403");
  assert.equal(isGmailQuotaError(unknown), false);
  assert.match(
    gmailRunErrorMessage(unknown.code, "es"),
    /no identifica la causa/,
  );
  const structured = await gmailResponseError(
    Response.json(
      { error: { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } },
      { status: 403 },
    ),
  );
  assert.equal(structured.reason, "ACCESS_TOKEN_SCOPE_INSUFFICIENT");
  assert.equal(isGmailQuotaError(structured), false);
  const malformed = await gmailResponseError(
    new Response("not JSON", { status: 429 }),
  );
  assert.equal(isGmailQuotaError(malformed), true);
});

test("Gmail Retry-After supports seconds and HTTP dates without reducing Google's wait", async () => {
  const numeric = await gmailResponseError(
    new Response("", { status: 429, headers: { "Retry-After": "7200" } }),
  );
  assert.equal(numeric.retryAfter, 7200);
  const date = new Date(Date.now() + 60000).toUTCString();
  const dated = await gmailResponseError(
    new Response("", { status: 429, headers: { "Retry-After": date } }),
  );
  assert.ok(dated.retryAfter >= 59 && dated.retryAfter <= 60);
  const invalid = await gmailResponseError(
    new Response("", { status: 429, headers: { "Retry-After": "invalid" } }),
  );
  assert.equal(invalid.retryAfter, 0);
});

test("Gmail reads are paced below the new per-user quota, including parallel requests, without serializing different accounts", () => {
  const pacer = new GmailQuotaPacer();
  const slots = Array.from({ length: 1000 }, () =>
    pacer.reserve("account-a", gmailRequestCost("messages/id?format=full"), 0),
  );
  assert.equal(slots[0], 0);
  assert.ok(slots[1] >= 267);
  for (const start of slots) {
    const units =
      slots.filter((at) => at >= start && at < start + 60000).length * 20;
    assert.ok(units <= 4500, `Minute window has ${units} units`);
  }
  assert.equal(pacer.reserve("account-b", 20, 0), 0);
  assert.equal(pacer.reserve("account-b", 20, 60000), 0);
  assert.equal(gmailRequestCost("messages?pageToken=cursor"), 5);
  assert.equal(gmailRequestCost("messages/id/attachments/part"), 20);
  assert.equal(gmailRequestCost("history?startHistoryId=1"), 2);
  assert.equal(gmailRequestCost("messages/send", "POST"), 100);
  assert.throws(() => new GmailQuotaPacer(0));
  assert.throws(() => pacer.reserve("account-a", 0));
});

test("archive quota recovery retains its cursor and messages, clears stale errors, and still pauses real policy failures", async (t) => {
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-only-key",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
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
    const account = {
      id: randomUUID(),
      email: "owner@example.com",
      status: "connected",
      organization: "fixture",
    };
    const credentials = { encrypted_refresh_token: encrypt("fixture-refresh") };
    const run = {
      id: randomUUID(),
      account_id: account.id,
      purpose: "historical",
      status: "analyzing",
      phase: "read",
      baseline_history_id: "1",
      pending_ids: ["m1", "m2", "m3"],
      offset_index: 0,
      exhausted: false,
      errors: 0,
      scanned: 301,
      skipped: 0,
      last_error: null as string | null,
      retry_at: null as string | null,
      lease_token: null as string | null,
      lease_until: null as string | null,
    };
    const saved = new Set<string>(),
      queued: unknown[] = [],
      reads: string[] = [],
      logs: string[] = [];
    let failure: "quota" | "none" | "policy" = "quota";
    // google-auth-library uses its own HTTP transport rather than global fetch.
    // Avoid real token refresh requests while exercising the Gmail/DB workflow.
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({
      token: "fixture-access",
    }));
    t.mock.method(console, "warn", (message: string) => logs.push(message));
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (url.hostname === "gmail.googleapis.com") {
          const id = url.pathname.split("/").at(-1)!;
          reads.push(id);
          if ((failure === "quota" && id === "m2") || failure === "policy")
            return Response.json(
              {
                error: {
                  errors: [
                    {
                      reason:
                        failure === "quota"
                          ? "userRateLimitExceeded"
                          : "domainPolicy",
                      message: "private raw response",
                    },
                  ],
                },
              },
              { status: 403, headers: { "Retry-After": "7200" } },
            );
          return Response.json({
            id,
            threadId: "thread",
            internalDate: String(Date.now()),
            labelIds: ["INBOX"],
            payload: {
              headers: [
                { name: "From", value: "client@example.com" },
                { name: "To", value: account.email },
              ],
              mimeType: "text/plain",
              body: { data: Buffer.from("Fixture").toString("base64url") },
            },
          });
        }
        assert.equal(
          url.hostname,
          "supabase.example.test",
          "All network calls must stay mocked",
        );
        const resource = url.pathname.replace("/rest/v1/", "");
        const body =
          request.method === "POST" || request.method === "PATCH"
            ? await request.json()
            : null;
        if (resource === "mail_accounts") {
          if (request.method === "PATCH") Object.assign(account, body);
          return Response.json(account);
        }
        if (resource === "mail_credentials") return Response.json(credentials);
        if (resource === "rpc/gmail_claim_run") {
          if (
            !["analyzing", "importing"].includes(run.status) ||
            (run.retry_at && Date.parse(run.retry_at) > Date.now())
          )
            return Response.json([]);
          run.lease_token = randomUUID();
          return Response.json([{ ...run }]);
        }
        if (resource === "rpc/gmail_store_message") {
          assert.equal(body.lease, run.lease_token);
          const id = body.entry.gmail_message_id;
          if (!saved.has(id)) {
            saved.add(id);
            run.scanned++;
          }
          return Response.json(randomUUID());
        }
        if (resource === "gmail_runs") {
          if (request.method === "PATCH") {
            const lease = url.searchParams.get("lease_token");
            if (lease && lease !== `eq.${run.lease_token}`)
              return Response.json([]);
            Object.assign(run, body);
            return Response.json(
              request.headers.get("prefer")?.includes("return=representation")
                ? [{ id: run.id }]
                : null,
            );
          }
          return Response.json(run);
        }
        if (resource === "jobs") {
          queued.push(body);
          return Response.json(null);
        }
        throw new Error(`Unexpected fixture request: ${resource}`);
      },
    );

    // One message succeeded before a quota response. Persist its offset and retire
    // the job; only the run scheduler retries after Google's required wait.
    const before = Date.now();
    await archiveStep(run.id);
    assert.equal(run.scanned, 302);
    assert.equal(run.offset_index, 1);
    assert.equal(run.last_error, "GMAIL_HTTP_403_userRateLimitExceeded");
    assert.ok(Date.parse(run.retry_at!) >= before + 7200000);
    assert.equal(run.status, "analyzing");
    assert.equal(account.status, "connected");
    assert.equal(run.lease_token, null);
    assert.equal(queued.length, 0);
    assert.ok(!logs.join(" ").includes("private"));
    const attempted = reads.length;
    await archiveStep(run.id);
    assert.equal(
      reads.length,
      attempted,
      "Retries must not run before retry_at",
    );

    // Simulate the elapsed wait. Resume from the persisted offset, with no reset
    // of the existing archive and no duplicate read of the saved first message.
    run.retry_at = null;
    failure = "none";
    await archiveStep(run.id);
    assert.equal(run.scanned, 304);
    assert.deepEqual([...saved], ["m1", "m2", "m3"]);
    assert.equal(reads.filter((id) => id === "m1").length, 1);
    assert.equal(run.last_error, null);
    assert.equal(run.retry_at, null);
    assert.equal(run.phase, "list");
    assert.equal(queued.length, 1);

    // A policy denial must not be treated as temporary quota or silently resumed.
    Object.assign(run, {
      phase: "read",
      pending_ids: ["blocked"],
      offset_index: 0,
    });
    failure = "policy";
    await assert.rejects(
      archiveStep(run.id),
      (error: unknown) =>
        error instanceof GmailError && error.reason === "domainPolicy",
    );
    assert.equal(run.status, "paused");
    assert.equal(account.status, "restricted");
    assert.equal(run.last_error, "GMAIL_HTTP_403_domainPolicy");
    assert.equal(run.scanned, 304);
    assert.equal(queued.length, 1);
  } finally {
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
