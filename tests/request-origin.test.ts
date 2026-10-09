import test from "node:test";
import assert from "node:assert/strict";
import { checkOrigin, HttpError } from "../src/lib/server/supabase";

function inEnvironment(
  origin: string | undefined,
  mode: string,
  run: () => void,
) {
  const environment: Record<string, string | undefined> = process.env;
  const priorOrigin = environment.APP_ORIGIN;
  const priorMode = environment.NODE_ENV;
  if (origin === undefined) delete environment.APP_ORIGIN;
  else environment.APP_ORIGIN = origin;
  environment.NODE_ENV = mode;
  try {
    run();
  } finally {
    if (priorOrigin === undefined) delete environment.APP_ORIGIN;
    else environment.APP_ORIGIN = priorOrigin;
    if (priorMode === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = priorMode;
  }
}
function request(
  origin: string | null,
  extraHeaders: Record<string, string> = {},
) {
  return new Request("http://internal-container:3000/api/actions", {
    method: "POST",
    headers: { ...extraHeaders, ...(origin === null ? {} : { origin }) },
    body: "{}",
  });
}
const originError = (status: number) => (error: unknown) =>
  error instanceof HttpError &&
  error.status === status &&
  /APP_ORIGIN/.test(error.message);

test("production accepts the configured origin behind a proxy and normalizes harmless formatting", () => {
  for (const configured of [
    "https://crm.example.com",
    " https://CRM.example.com:443/ ",
  ])
    inEnvironment(configured, "production", () => {
      assert.doesNotThrow(() =>
        checkOrigin(request("https://crm.example.com")),
      );
    });
});

test("a localhost production configuration rejects the real CRM origin with an actionable error", () => {
  inEnvironment("http://localhost:3000", "production", () => {
    assert.throws(
      () => checkOrigin(request("https://crm.example.com")),
      originError(403),
    );
  });
});

test("production rejects missing, opaque, cross-site, scheme and port mismatches even with spoofed proxy headers", () => {
  inEnvironment("https://crm.example.com", "production", () => {
    for (const origin of [
      null,
      "null",
      "https://attacker.example",
      "http://crm.example.com",
      "https://crm.example.com:8443",
      "https://www.crm.example.com",
      "https://crm.example.com/path",
      "https://crm.example.com?x=1",
      "https://user:password@crm.example.com",
    ])
      assert.throws(
        () =>
          checkOrigin(
            request(origin, {
              host: "crm.example.com",
              "x-forwarded-host": "crm.example.com",
              "x-forwarded-proto": "https",
            }),
          ),
        originError(403),
      );
  });
});

test("production fails closed when APP_ORIGIN is missing or malformed", () => {
  for (const origin of [
    undefined,
    "",
    "https://crm.example.com/app",
    "https://crm.example.com?x=1",
    "https://user:password@crm.example.com",
    "file:///tmp/crm",
  ])
    inEnvironment(origin, "production", () => {
      assert.throws(
        () => checkOrigin(request("http://localhost:3000")),
        originError(503),
      );
    });
});

test("local development accepts its two loopback origins without admitting other websites", () => {
  inEnvironment("https://crm.example.com", "development", () => {
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"])
      assert.doesNotThrow(() => checkOrigin(request(origin)));
    assert.throws(
      () => checkOrigin(request("https://attacker.example")),
      originError(403),
    );
  });
});
