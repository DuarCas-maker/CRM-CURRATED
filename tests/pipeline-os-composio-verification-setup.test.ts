import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupFixture } from "./fixtures/composio-verification-setup";
import {
  verificationSetupPage,
  verificationSetupCommand,
  verificationSetupJsonError,
} from "../src/lib/server/mail-accounts/composio-verification-setup";
import {
  verificationSetupCommandSchema,
  verificationSetupPageSchema,
} from "../src/lib/composio-verification-setup";
const publish = (r: Awaited<ReturnType<typeof verificationSetupPage>>) => ({
  action: "publish_policy",
  setup_revision: r.setup_revision,
  expected_generation: 0,
  quiescent: true,
  idempotency_key: randomUUID(),
});
const budget = (
  f: ReturnType<typeof setupFixture>,
  r: Awaited<ReturnType<typeof verificationSetupPage>>,
) => ({
  action: "grant_budget",
  setup_revision: r.setup_revision,
  binding_id: f.binding,
  included_confirmed: true,
  expires_at: new Date(f.now + 600000).toISOString(),
  idempotency_key: randomUUID(),
});
test("CT01 flags and target deny before any RPC, descriptor, service or provider", async () => {
  for (const change of [
    (f: ReturnType<typeof setupFixture>) => {
      f.ports.enabled = false;
    },
    (f: ReturnType<typeof setupFixture>) => {
      f.ports.binding.enabled = false;
    },
    (f: ReturnType<typeof setupFixture>) => {
      f.ports.targetAccount = randomUUID();
    },
    (f: ReturnType<typeof setupFixture>) => {
      f.ports.targetAccount = "bad";
    },
  ]) {
    const f = setupFixture();
    change(f);
    await assert.rejects(verificationSetupPage(f.ports, f.account), {
      status: 404,
    });
    assert.deepEqual(f.events, []);
  }
});
test("CT01 human authorization precedes private descriptor and service", async () => {
  const f = setupFixture();
  f.deny();
  await assert.rejects(verificationSetupPage(f.ports, f.account), {
    code: "SETUP_FORBIDDEN",
    status: 403,
  });
  assert.deepEqual(f.events, ["human:composio_binding_authorize_v2"]);
});
test("CT02 GET is sanitized read-only; no context publication or credentials", async () => {
  const f = setupFixture(),
    r = await verificationSetupPage(f.ports, f.account);
  assert.ok(verificationSetupPageSchema.safeParse(r).success);
  assert.equal(r.policy.can_publish, true);
  assert.equal(r.can_grant, false);
  for (const text of [
    "pr_fixture",
    "ac_fixture",
    "cred_fixture",
    "qa@example.test",
    "review_fixture",
  ])
    assert.equal(JSON.stringify(r).includes(text), false);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.events, [
    "human:composio_binding_authorize_v2",
    "descriptor",
    "human:composio_binding_page_v2",
    "service",
    "service:mail_quota_snapshot",
  ]);
});
test("CT02 closed head and invalid descriptor fail closed", async () => {
  const f = setupFixture();
  f.close();
  await assert.rejects(verificationSetupPage(f.ports, f.account), {
    code: "SETUP_CONFLICT",
  });
  const g = setupFixture();
  g.descriptor({ context: {} });
  await assert.rejects(verificationSetupPage(g.ports, g.account), {
    status: 503,
  });
  assert.equal(g.events.includes("service"), false);
});
test("CT03 publish only server policy with human role; same key replays", async () => {
  const f = setupFixture(),
    r = await verificationSetupPage(f.ports, f.account),
    b = publish(r);
  await verificationSetupCommand(f.ports, f.account, b);
  await verificationSetupCommand(f.ports, f.account, b);
  assert.equal(f.writes.length, 2);
  for (const w of f.writes) {
    assert.equal(w.role, "human");
    assert.deepEqual(w.input.value, f.policy);
  }
  assert.equal(
    (await verificationSetupPage(f.ports, f.account)).policy.ready,
    true,
  );
  assert.equal(
    (await verificationSetupPage(f.ports, f.account)).setup_revision,
    r.setup_revision,
  );
  await assert.rejects(
    verificationSetupCommand(f.ports, f.account, {
      ...b,
      idempotency_key: randomUUID(),
    }),
    { code: "SETUP_CONFLICT" },
  );
});
test("CT03 browser policy, missing pause and mismatched generation rejected without writes", async () => {
  const f = setupFixture(),
    r = await verificationSetupPage(f.ports, f.account),
    b = publish(r);
  for (const bad of [
    { ...b, policy: f.policy },
    { ...b, quiescent: false },
    { ...b, expected_generation: 1 },
  ])
    await assert.rejects(verificationSetupCommand(f.ports, f.account, bad));
  assert.equal(f.writes.length, 0);
});
test("CT03 foreign policy cannot be replaced or silently accepted", async () => {
  const f = setupFixture();
  f.setHead({ ...f.policy, policy_id: randomUUID() });
  const r = await verificationSetupPage(f.ports, f.account);
  assert.equal(r.policy.can_publish, false);
  assert.equal(r.policy.ready, false);
  await assert.rejects(
    verificationSetupCommand(f.ports, f.account, publish(r)),
  );
  assert.equal(f.writes.length, 0);
});
test("CT03 stale account, binding and server descriptor fail before mutation", async () => {
  for (const field of ["account", "binding", "descriptor"]) {
    const f = setupFixture(),
      r = await verificationSetupPage(f.ports, f.account);
    if (field === "account") f.page.account.account_revision++;
    if (field === "binding") f.page.current!.revision++;
    if (field === "descriptor") f.context.credential_version = "changed";
    await assert.rejects(
      verificationSetupCommand(f.ports, f.account, publish(r)),
      { code: "SETUP_STALE" },
    );
    assert.equal(f.writes.length, 0);
  }
});
test("CT03 change during final authorization fails closed", async () => {
  const f = setupFixture(),
    r = await verificationSetupPage(f.ports, f.account);
  let auths = 0;
  f.afterAuthorize(() => {
    if (++auths === 2) f.page.head_revision++;
  });
  await assert.rejects(
    verificationSetupCommand(f.ports, f.account, publish(r)),
    { code: "SETUP_STALE" },
  );
  assert.equal(f.writes.length, 0);
});
test("CT04 a check appearing during final authorization prevents a new budget", async () => {
  const f = setupFixture();
  f.publishHead();
  const b = budget(f, await verificationSetupPage(f.ports, f.account));
  let auths = 0;
  f.afterAuthorize(() => {
    if (++auths === 2)
      f.page.latest_check = {
        id: randomUUID(),
        status: "completed",
        valid_until: new Date(f.now + 10000).toISOString(),
      };
  });
  await assert.rejects(verificationSetupCommand(f.ports, f.account, b), {
    code: "SETUP_STALE",
  });
  assert.equal(f.writes.length, 0);
});
test("CT04 budget fixed four, exact TTL and same-key replay preserves consumed requests", async () => {
  const f = setupFixture();
  f.publishHead();
  const r = await verificationSetupPage(f.ports, f.account),
    b = budget(f, r);
  assert.equal(r.can_grant, true);
  await verificationSetupCommand(f.ports, f.account, b);
  f.consume(2);
  await verificationSetupCommand(f.ports, f.account, b);
  assert.equal(f.used, 2);
  for (const w of f.writes) {
    assert.equal(w.role, "human");
    assert.equal(w.input.maximum, 4);
    assert.equal(w.input.expires_at, b.expires_at);
    assert.equal(w.input.request_key, b.idempotency_key);
  }
});
test("CT04 TTL, included confirmation, injected maximum and wrong candidate rejected", async () => {
  const f = setupFixture();
  f.publishHead();
  const b = budget(f, await verificationSetupPage(f.ports, f.account));
  for (const bad of [
    { ...b, expires_at: new Date(f.now).toISOString() },
    { ...b, expires_at: new Date(f.now + 600001).toISOString() },
    { ...b, included_confirmed: false },
    { ...b, maximum: 5 },
    { ...b, binding_id: randomUUID() },
  ])
    await assert.rejects(verificationSetupCommand(f.ports, f.account, bad));
  assert.equal(f.writes.length, 0);
});
test("CT04 disabled checks/quota, stale/unready/non-candidate and prior check block grants", async () => {
  for (const change of [
    (f: ReturnType<typeof setupFixture>) => {
      f.ports.binding.checksEnabled = false;
    },
    (f: ReturnType<typeof setupFixture>) => {
      f.ports.quotaEnabled = false;
    },
    (f: ReturnType<typeof setupFixture>) => {
      f.page.account.ready = false;
    },
    (f: ReturnType<typeof setupFixture>) => {
      f.page.current!.stale = true;
    },
    (f: ReturnType<typeof setupFixture>) => {
      f.page.current!.status = "verified";
    },
    (f: ReturnType<typeof setupFixture>) => {
      f.page.latest_check = {
        id: randomUUID(),
        status: "failed",
        valid_until: null,
      };
    },
    (f: ReturnType<typeof setupFixture>) => {
      f.page.policy!.generation = 2;
    },
  ]) {
    const f = setupFixture();
    f.publishHead();
    change(f);
    const r = await verificationSetupPage(f.ports, f.account);
    assert.equal(r.can_grant, false);
    await assert.rejects(
      verificationSetupCommand(f.ports, f.account, budget(f, r)),
      { code: "SETUP_CONFLICT" },
    );
    assert.equal(f.writes.length, 0);
  }
});
test("CT05 strict DTO and sanitized failures never return provider/config details", async () => {
  const f = setupFixture(),
    r = await verificationSetupPage(f.ports, f.account);
  assert.equal(
    verificationSetupCommandSchema.safeParse({ ...publish(r), token: "secret" })
      .success,
    false,
  );
  f.error("private database details");
  try {
    await verificationSetupPage(f.ports, f.account);
    assert.fail();
  } catch (e) {
    const response = verificationSetupJsonError(e);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      JSON.stringify(await response.json()).includes("private"),
      false,
    );
  }
});
