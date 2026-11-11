import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { MailQuotaPolicy } from "../src/lib/mail-quota-policy";

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls++;
  throw new Error("Real fetch forbidden in QGR-I01");
}) as typeof fetch;
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(fetchCalls, 0);
});

const {
  mailQuotaPolicySchema,
  mailQuotaScopeRequestSchema,
  MailQuotaPolicyError,
  resolveMailQuotaScopes,
} = await import("../src/lib/mail-quota-policy");

const policyId = "aa000000-0000-4000-8000-000000000001";
const secondPolicyId = "aa000000-0000-4000-8000-000000000002";
const accountA = "bb000000-0000-4000-8000-000000000001";
const accountB = "bb000000-0000-4000-8000-000000000002";
const direct = (account = accountA) => ({
  provider: "gmail_oauth" as const,
  account_id: account,
});
const composio = (account = accountA, auth = "ac_fixture_a") => ({
  provider: "composio" as const,
  account_id: account,
  auth_config_id: auth,
});
function policy(): MailQuotaPolicy {
  return {
    contract_version: 2,
    policy_id: policyId,
    generation: 1,
    mode: "crm_shared_conservative",
    state: "enabled",
    limits: {
      group_units_per_minute: 900_000,
      account_units_per_minute: 4_500,
      group_units_per_window: 75_000_000,
      window_seconds: 86_460,
    },
  };
}
const errorCode = (code: string) => (error: unknown) => {
  assert.ok(error instanceof MailQuotaPolicyError);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  return true;
};

test("QGR-AC01: v2 accepts a policy without a Google project or invented provenance", () => {
  const parsed = mailQuotaPolicySchema.parse(policy());
  assert.equal(parsed.contract_version, 2);
  assert.equal(parsed.google_project, undefined);
  assert.equal("google_quota_project_id" in parsed, false);
  assert.equal("quota_provenance" in parsed, false);
  assert.equal(resolveMailQuotaScopes(parsed, composio()).policy_id, policyId);
});

test("QGR-AC01: absent, null and explicitly unknown Google metadata remain unknown", () => {
  for (const google of [
    undefined,
    null,
    { provenance: "unknown", project_id: null },
  ]) {
    const input = { ...policy(), google_project: google };
    const parsed = mailQuotaPolicySchema.parse(input);
    assert.deepEqual(parsed.google_project, google);
    assert.equal(
      resolveMailQuotaScopes(parsed, direct()).group_scope,
      "gmail:crm:shared",
    );
  }
});

test("QGR-AC01: reviewed Google metadata is an explicit declaration, not a scope partition", () => {
  const input = {
    ...policy(),
    google_project: {
      provenance: "oauth_client_reviewed",
      project_id: "google-fixture-a",
    },
  };
  assert.deepEqual(
    mailQuotaPolicySchema.parse(input).google_project,
    input.google_project,
  );
  assert.deepEqual(
    resolveMailQuotaScopes(input, direct()),
    resolveMailQuotaScopes(policy(), direct()),
  );
});

test("QGR-AC02: contradictory, incomplete or extra Google provenance is rejected", () => {
  const invalid = [
    {},
    { provenance: "unknown" },
    { provenance: "unknown", project_id: "google-fixture" },
    { provenance: "oauth_client_reviewed", project_id: null },
    { provenance: "oauth_client_reviewed", project_id: "" },
    { provenance: "oauth_client_reviewed", project_id: "project with spaces" },
    { provenance: "declared", project_id: "google-fixture" },
    { provenance: "unknown", project_id: null, verified: true },
  ];
  for (const google of invalid)
    assert.equal(
      mailQuotaPolicySchema.safeParse({ ...policy(), google_project: google })
        .success,
      false,
    );
});

test("QGR-AC02/14: legacy contexts are never upgraded, even with a forged v2 discriminator", () => {
  const legacy = {
    composio_project_id: "pr_fixture",
    credential_version: "fixture-v1",
    google_quota_project_id: "google-fixture",
    auth_config_revision: "fixture-revision",
    provenance_reference: "fixture-review",
    project_provenance: "server_reviewed",
    quota_provenance: "oauth_client_reviewed",
  };
  const before = structuredClone(legacy);
  for (const input of [
    legacy,
    { ...legacy, contract_version: 2 },
    { ...policy(), ...legacy },
  ]) {
    assert.equal(mailQuotaPolicySchema.safeParse(input).success, false);
    assert.throws(
      () => resolveMailQuotaScopes(input, direct()),
      errorCode("MAIL_QUOTA_POLICY_INVALID"),
    );
  }
  assert.deepEqual(legacy, before);
});

test("QGR-AC02: absent state/version, unknown modes and injected policy fields do not default open", () => {
  const invalid = [
    null,
    [],
    true,
    "policy",
    {},
    { ...policy(), contract_version: undefined },
    { ...policy(), contract_version: 1 },
    { ...policy(), contract_version: "2" },
    { ...policy(), state: undefined },
    { ...policy(), state: true },
    { ...policy(), mode: "per_mailbox" },
    { ...policy(), group_scope: "attacker-scope" },
    { ...policy(), enabled: true },
  ];
  for (const input of invalid)
    assert.throws(
      () => resolveMailQuotaScopes(input, direct()),
      errorCode("MAIL_QUOTA_POLICY_INVALID"),
    );
});

test("QGR-AC02: policy IDs and generations are strict, bounded and noncoercing", () => {
  for (const id of [undefined, null, "", "pr_fixture", " " + policyId])
    assert.equal(
      mailQuotaPolicySchema.safeParse({ ...policy(), policy_id: id }).success,
      false,
    );
  for (const generation of [
    undefined,
    null,
    "1",
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.equal(
      mailQuotaPolicySchema.safeParse({ ...policy(), generation }).success,
      false,
    );
  assert.equal(
    mailQuotaPolicySchema.parse({
      ...policy(),
      generation: Number.MAX_SAFE_INTEGER,
    }).generation,
    Number.MAX_SAFE_INTEGER,
  );
});

test("QGR-AC03: accounts, providers and Auth Configs all share one aggregate", () => {
  const requests = [
    direct(),
    direct(accountB),
    composio(),
    composio(accountB),
    composio(accountA, "ac_fixture_b"),
  ];
  const resolved = requests.map((r) => resolveMailQuotaScopes(policy(), r));
  assert.equal(new Set(resolved.map((r) => r.group_scope)).size, 1);
  assert.equal(new Set(resolved.map((r) => r.account_scope)).size, 2);
});

test("QGR-AC04: direct and Composio preserve the same per-account scope", () => {
  const fromDirect = resolveMailQuotaScopes(policy(), direct());
  const fromComposio = resolveMailQuotaScopes(policy(), composio());
  assert.deepEqual(fromDirect, fromComposio);
  assert.notEqual(
    resolveMailQuotaScopes(policy(), direct(accountB)).account_scope,
    fromDirect.account_scope,
  );
});

test("QGR-AC03/06: policy replacement, generation and Google metadata cannot reset scopes", () => {
  const before = resolveMailQuotaScopes(policy(), composio());
  const next = resolveMailQuotaScopes(
    {
      ...policy(),
      policy_id: secondPolicyId,
      generation: 12,
      limits: { ...policy().limits, group_units_per_minute: 100_000 },
      google_project: {
        provenance: "oauth_client_reviewed",
        project_id: "google-fixture-b",
      },
    },
    composio(accountA, "ac_fixture_b"),
  );
  assert.equal(next.group_scope, before.group_scope);
  assert.equal(next.account_scope, before.account_scope);
  assert.equal(next.policy_id, secondPolicyId);
  assert.equal(next.generation, 12);
  assert.equal(next.limits.group_units_per_minute, 100_000);
});

test("QGR-AC03: equivalent UUID casing cannot fragment policy or account scopes", () => {
  const expected = resolveMailQuotaScopes(policy(), direct());
  const alternate = resolveMailQuotaScopes(
    { ...policy(), policy_id: policyId.toUpperCase() },
    direct(accountA.toUpperCase()),
  );
  assert.deepEqual(alternate, expected);
});

test("QGR-AC05: disabled is valid configuration but never resolves an emission scope", () => {
  const disabled = { ...policy(), state: "disabled" };
  assert.equal(mailQuotaPolicySchema.safeParse(disabled).success, true);
  for (const request of [direct(), composio()])
    assert.throws(
      () => resolveMailQuotaScopes(disabled, request),
      errorCode("MAIL_QUOTA_POLICY_DISABLED"),
    );
  assert.equal(disabled.state, "disabled");
});

test("QGR-AC02/07: malformed or client-selected scope requests are rejected", () => {
  const requests = [
    null,
    [],
    {},
    { ...direct(), provider: "instantly" },
    { ...direct(), account_id: "" },
    { ...direct(), account_id: "not-an-account" },
    { ...direct(), account_id: " " + accountA },
    { ...direct(), group_scope: "another-group" },
    { ...direct(), limits: policy().limits },
    { ...direct(), google_quota_project_id: "google-fixture" },
    { ...composio(), auth_config_id: undefined },
    { ...composio(), auth_config_id: "ca_fixture" },
    { ...composio(), auth_config_id: "ac_" },
    { ...composio(), auth_config_id: "ac_" + "x".repeat(129) },
    { ...composio(), user_id: "owner-fixture" },
  ];
  for (const request of requests) {
    assert.equal(mailQuotaScopeRequestSchema.safeParse(request).success, false);
    assert.throws(
      () => resolveMailQuotaScopes(policy(), request),
      errorCode("MAIL_QUOTA_SCOPE_INVALID"),
    );
  }
});

test("QGR-AC03: a direct scope cannot masquerade as a Composio configuration", () => {
  assert.equal(
    mailQuotaScopeRequestSchema.safeParse({
      ...direct(),
      auth_config_id: "ac_fixture",
    }).success,
    false,
  );
  assert.equal(
    mailQuotaScopeRequestSchema.safeParse(composio(accountB, "ac_fixture-b_2"))
      .success,
    true,
  );
});

test("QGR-AC02: numeric limits reject coercion, fractions and unsafe/nonfinite values", () => {
  const fields = [
    "group_units_per_minute",
    "account_units_per_minute",
    "group_units_per_window",
  ] as const;
  for (const field of fields)
    for (const value of [
      undefined,
      null,
      "1",
      true,
      0,
      -1,
      0.1,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      assert.equal(
        mailQuotaPolicySchema.safeParse({
          ...policy(),
          limits: { ...policy().limits, [field]: value },
        }).success,
        false,
      );
});

test("QGR-AC03: limits may be lower than the ceilings but never higher", () => {
  const atCeiling = resolveMailQuotaScopes(policy(), direct());
  assert.deepEqual(atCeiling.limits, policy().limits);
  const lower = {
    group_units_per_minute: 1,
    account_units_per_minute: 1,
    group_units_per_window: 1,
    window_seconds: 86_460,
  };
  assert.deepEqual(
    resolveMailQuotaScopes({ ...policy(), limits: lower }, direct()).limits,
    lower,
  );
  for (const field of [
    "group_units_per_minute",
    "account_units_per_minute",
    "group_units_per_window",
  ] as const)
    assert.equal(
      mailQuotaPolicySchema.safeParse({
        ...policy(),
        limits: { ...policy().limits, [field]: policy().limits[field] + 1 },
      }).success,
      false,
    );
});

test("QGR-AC03: an account budget cannot exceed its aggregate budget", () => {
  assert.equal(
    mailQuotaPolicySchema.safeParse({
      ...policy(),
      limits: {
        ...policy().limits,
        group_units_per_minute: 100,
        account_units_per_minute: 101,
      },
    }).success,
    false,
  );
  assert.equal(
    mailQuotaPolicySchema.safeParse({
      ...policy(),
      limits: {
        ...policy().limits,
        group_units_per_minute: 100,
        account_units_per_minute: 100,
      },
    }).success,
    true,
  );
});

test("QGR-AC06: the rolling window cannot be omitted, shortened or silently coerced", () => {
  for (const seconds of [
    undefined,
    null,
    "86460",
    0,
    86_400,
    86_459,
    86_461,
    NaN,
    Infinity,
  ])
    assert.equal(
      mailQuotaPolicySchema.safeParse({
        ...policy(),
        limits: { ...policy().limits, window_seconds: seconds },
      }).success,
      false,
    );
  assert.equal(
    mailQuotaPolicySchema.safeParse({
      ...policy(),
      limits: { ...policy().limits, allowance_remaining: 123 },
    }).success,
    false,
  );
});

test("QGR-AC07: resolved limits and identity references are immutable snapshots", () => {
  const input = policy();
  const request = composio();
  const resolved = resolveMailQuotaScopes(input, request);
  input.limits.account_units_per_minute = 1;
  input.generation = 50;
  request.account_id = accountB;
  assert.equal(resolved.limits.account_units_per_minute, 4_500);
  assert.equal(resolved.generation, 1);
  assert.equal(resolved.account_scope, `gmail:account:${accountA}`);
  assert.throws(
    () => Object.assign(resolved.limits, { account_units_per_minute: 99 }),
    TypeError,
  );
  assert.throws(
    () => Object.assign(resolved, { group_scope: "another" }),
    TypeError,
  );
});

test("QGR-AC07: repeated resolution is deterministic and does not mutate frozen inputs", () => {
  const input = policy();
  Object.freeze(input.limits);
  Object.freeze(input);
  const request = Object.freeze(composio());
  const before = structuredClone(input);
  const first = resolveMailQuotaScopes(input, request);
  const second = resolveMailQuotaScopes(input, request);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.deepEqual(input, before);
});

test("QGR-AC02: errors never expose rejected values or Zod validation details", () => {
  const rejected = "fixture-private-input-never-echo";
  for (const run of [
    () =>
      resolveMailQuotaScopes({ ...policy(), policy_id: rejected }, direct()),
    () =>
      resolveMailQuotaScopes(policy(), { ...direct(), account_id: rejected }),
  ]) {
    assert.throws(run, (error: unknown) => {
      assert.ok(error instanceof MailQuotaPolicyError);
      assert.equal(error.message.includes(rejected), false);
      assert.equal(JSON.stringify(error).includes(rejected), false);
      assert.equal("issues" in error, false);
      return true;
    });
  }
});
