import test from "node:test";
import assert from "node:assert/strict";
import { GmailError } from "../src/lib/gmail-errors";
import { WorkerDatabaseError, workerErrorCode } from "../worker/errors";
import { checked } from "../worker/db";

test("worker errors retain only allowlisted operational codes", () => {
  for (const code of ["QGR_DENIED", "R06_UNAVAILABLE", "COMPOSIO_AUTH_REJECTED", "GMAIL_TOKEN_REFRESH_FAILED"])
    assert.equal(workerErrorCode(Object.assign(new Error("private response"), { code })), code);
  assert.equal(workerErrorCode(new GmailError(403, "insufficientPermissions")), "GMAIL_HTTP_403_insufficientPermissions");
  assert.equal(workerErrorCode(new GmailError(429, "arbitrary private data")), "GMAIL_HTTP_429");
  assert.equal(workerErrorCode(new Error("Organization is not configured")), "GOOGLE_ORGANIZATION_UNCONFIGURED");
  assert.equal(workerErrorCode(new WorkerDatabaseError("42501")), "DATABASE_42501");
  assert.equal(workerErrorCode(new WorkerDatabaseError("PGRST202")), "DATABASE_PGRST202");
  assert.throws(() => checked({ data: null, error: { message: "private SQL details", code: "42501" } }), e => e instanceof WorkerDatabaseError && e.message === "DATABASE_OPERATION_FAILED" && workerErrorCode(e) === "DATABASE_42501");
});
test("worker errors never retain unknown credentials, provider bodies or nested causes", () => {
  const secret = "private-token-private@example.test";
  for (const value of [new Error(secret), Object.assign(new Error(secret), { code: secret }), { code: "QGR_DENIED", body: secret }, new Error(secret, { cause: { token: secret } }), new WorkerDatabaseError(secret)]) {
    const code = workerErrorCode(value);
    assert(!code.includes(secret));
    assert(["PROCESSING_FAILED", "DATABASE_OPERATION_FAILED"].includes(code));
  }
});
