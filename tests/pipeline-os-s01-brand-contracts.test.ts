import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  parseBrandCreateInput,
  parseBrandMembershipInput,
  parseBrandReviewInput,
  validateExpectedAccountRevision,
} from "../src/lib/pipeline-os/s01/brand-inputs";

const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error("I01_NETWORK_DISABLED");
};
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkAttempts, 0);
});

const review = () => ({
  account_id: randomUUID(),
  proposed_brand_id: null,
  expected_account_revision: 0,
  request_key: randomUUID(),
});

test("I01 normalizes M1/M2 without activating or mutating the input", () => {
  const input = Object.freeze({ code: " m1 ", name: " Marca Prueba " });
  assert.deepEqual(parseBrandCreateInput(input), {
    ok: true,
    value: { code: "M1", name: "Marca Prueba", active: false },
  });
  assert.equal(input.code, " m1 ");
  assert.deepEqual(parseBrandCreateInput({ code: "m2", name: "M2" }), {
    ok: true,
    value: { code: "M2", name: "M2", active: false },
  });
  assert.equal(parseBrandCreateInput({ name: "Missing identity" }).ok, false);
});

test("I01 bounds codes and Unicode names without coercing missing values", () => {
  for (const code of ["", "-M1", "M 1", "M/1", "M".repeat(33), null, 1])
    assert.equal(parseBrandCreateInput({ code, name: "Fixture" }).ok, false);
  assert.equal(
    parseBrandCreateInput({ code: "M".repeat(32), name: "😀".repeat(120) }).ok,
    true,
  );
  for (const name of ["", "  ", "\n\t", "😀".repeat(121), null])
    assert.equal(parseBrandCreateInput({ code: "M1", name }).ok, false);
  assert.equal(
    parseBrandCreateInput({ code: "M1", name: "Fixture", active: "true" }).ok,
    false,
  );
});

test("I01 returns safe issue codes without echoing values or unknown keys", () => {
  const sentinel = "fixture-sensitive-value";
  const result = parseBrandCreateInput({
    code: sentinel + "/",
    name: "Fixture",
    [sentinel]: { token: sentinel },
  });
  assert.equal(result.ok, false);
  assert(!JSON.stringify(result).includes(sentinel));
  if (!result.ok)
    for (const issue of result.issues)
      assert.equal(issue.code, "invalid_input");
});

test("I01 membership input validates IDs and safe revisions, not authority", () => {
  const input = {
    brand_id: randomUUID(),
    user_id: randomUUID(),
    active: true,
    expected_revision: 0,
  };
  assert.deepEqual(parseBrandMembershipInput(input), {
    ok: true,
    value: input,
  });
  for (const value of [
    -1,
    1.5,
    "1",
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.equal(
      parseBrandMembershipInput({ ...input, expected_revision: value }).ok,
      false,
    );
  assert.equal(
    parseBrandMembershipInput({ ...input, brand_id: "M1" }).ok,
    false,
  );
  assert.equal(
    parseBrandMembershipInput({ ...input, role: "superadmin" }).ok,
    false,
  );
});

test("I01 retains an unconfirmed mapping without inventing a brand", () => {
  const input = Object.freeze(review());
  const first = parseBrandReviewInput(input);
  assert(first.ok);
  assert.equal(first.value.proposed_brand_id, null);
  assert.equal(first.value.status, "pending");
  assert.equal(first.value.history_approved, false);
  assert.equal(first.value.history_from, null);
  assert.equal(first.value.evidence_reference, null);
  assert.deepEqual(parseBrandReviewInput(input), first);
  for (const status of ["confirmed", "unknown", "active"])
    assert.equal(parseBrandReviewInput({ ...input, status }).ok, false);
  assert.equal(parseBrandReviewInput({ ...input, revision: 0 }).ok, false);
  assert.equal(parseBrandReviewInput({ ...input, account_id: "A1" }).ok, false);
});

test("I01 confirmation needs a proposed identity and evidence, not inference", () => {
  const input = {
    ...review(),
    proposed_brand_id: randomUUID(),
    status: "confirmed",
    evidence_reference: " proof-01 ",
  };
  const result = parseBrandReviewInput(input);
  assert(result.ok);
  assert.equal(result.value.evidence_reference, "proof-01");
  assert.equal(result.value.history_approved, false);
  for (const evidence_reference of [null, " ", "x".repeat(121)])
    assert.equal(
      parseBrandReviewInput({ ...input, evidence_reference }).ok,
      false,
    );
  assert.equal(
    parseBrandReviewInput({ ...input, proposed_brand_id: null }).ok,
    false,
  );
});

test("I01 historical attribution requires an evidenced and ordered UTC range", () => {
  const input = {
    ...review(),
    evidence_reference: "period-proof",
    history_approved: true,
    history_from: "2026-10-01T00:00:00-05:00",
    history_to: "2026-10-02T00:00:00-05:00",
  };
  const result = parseBrandReviewInput(input);
  assert(result.ok);
  assert.equal(result.value.history_from, "2026-10-01T05:00:00.000Z");
  for (const patch of [
    { history_from: null },
    { history_to: null },
    { history_to: input.history_from },
    { history_to: "2026-09-30T00:00:00Z" },
    { history_from: "2026-02-30T00:00:00Z" },
    { history_from: "2026-10-01" },
    { history_from: "infinity" },
    { evidence_reference: null },
  ])
    assert.equal(parseBrandReviewInput({ ...input, ...patch }).ok, false);
  assert.equal(
    parseBrandReviewInput({ ...review(), history_from: input.history_from }).ok,
    false,
  );
});

test("I01 stale revision check handles the initial revision without an atomicity claim", () => {
  assert.deepEqual(validateExpectedAccountRevision(0, 0), {
    ok: true,
    value: { expected_account_revision: 0 },
  });
  assert.deepEqual(validateExpectedAccountRevision(0, 1), {
    ok: false,
    issues: [{ field: "expected_account_revision", code: "stale_revision" }],
  });
  for (const value of [-1, 1.5, "0", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateExpectedAccountRevision(value, 0).ok, false);
    assert.equal(validateExpectedAccountRevision(0, value).ok, false);
  }
});
