import test from "node:test";
import assert from "node:assert/strict";
import { simpleMailReturnUrl } from "../src/lib/server/mail-accounts/onboarding/return-url";
import { HttpError } from "../src/lib/server/supabase";

const connection = "11111111-1111-4111-8111-111111111111";
const publicOrigin = "https://crm.example.test";

test("OAuth behind a container proxy returns only to the configured public CRM", () => {
  for (const incoming of [
    "https://0.0.0.0:3000/api/gmail/callback",
    "http://127.0.0.1:3000/api/gmail/callback",
    "https://attacker.example.invalid/api/gmail/callback",
  ]) {
    const request = new Request(
      incoming + "?code=fixture-code&state=fixture-state",
      {
        headers: {
          host: "attacker.example.invalid",
          "x-forwarded-host": "attacker.example.invalid",
          "x-forwarded-proto": "http",
        },
      },
    );
    // This is the exact constructor used by the failing callback before the fix.
    const oldDestination = new URL(
      "/?module=connections&mail_connection=" + connection,
      request.url,
    );
    assert.notEqual(oldDestination.origin, publicOrigin);
    const destination = simpleMailReturnUrl(
      connection,
      publicOrigin,
      "production",
    );
    const response = Response.redirect(destination, 303);
    assert.equal(response.status, 303);
    const target = new URL(response.headers.get("location")!);
    assert.equal(target.origin, publicOrigin);
    assert.equal(target.pathname, "/");
    assert.deepEqual(Object.fromEntries(target.searchParams), {
      module: "connections",
      mail_connection: connection,
      mail_provider: "gmail_oauth",
    });
    assert.equal(target.searchParams.has("code"), false);
    assert.equal(target.searchParams.has("state"), false);
  }
});

test("Invalid public-origin configuration fails closed without internal-host fallback", () => {
  for (const origin of [
    "",
    "not-a-url",
    "javascript:alert(1)",
    "file:///tmp/crm",
    "https://user:secret@crm.example.test",
    "https://crm.example.test/nested",
    "https://crm.example.test?redirect=evil",
    "https://crm.example.test#fragment",
    "https://0.0.0.0:3000",
    "https://[::]:3000",
    "http://crm.example.test",
    "https://localhost:3000",
    "https://127.0.0.1:3000",
    "https://[::1]:3000",
  ])
    assert.throws(
      () => simpleMailReturnUrl(connection, origin, "production"),
      (e: unknown) =>
        e instanceof HttpError &&
        e.status === 503 &&
        e.message === "SIMPLE_NOT_CONFIGURED",
    );
});

test("Public origins normalize their root slash; configured localhost remains usable in development", () => {
  assert.equal(
    simpleMailReturnUrl(connection, publicOrigin, "production").href,
    simpleMailReturnUrl(connection, publicOrigin + "/", "production").href,
  );
  assert.equal(
    simpleMailReturnUrl(connection, "http://127.0.0.1:3000", "development")
      .origin,
    "http://127.0.0.1:3000",
  );
  const destination = simpleMailReturnUrl(
    connection + "&code=untrusted",
    publicOrigin,
    "production",
  );
  assert.equal(
    destination.searchParams.get("mail_connection"),
    connection + "&code=untrusted",
  );
  assert.equal(destination.searchParams.has("code"), false);
});
