import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { MailQuotaPorts } from "../../src/lib/server/mail-quota";
export function quotaFixture() {
  const account = randomUUID(),
    key = randomUUID(),
    calls: { name: string; input: Record<string, unknown> }[] = [];
  let now = Date.now(),
    wait = 0,
    admit = true,
    authorized = true,
    legacy = 0,
    emitted = 0;
  let p = {
    contract_version: 2 as const,
    policy_id: randomUUID(),
    generation: 1,
    mode: "crm_shared_conservative" as const,
    state: "enabled" as "enabled" | "disabled",
    limits: {
      group_units_per_minute: 900000,
      account_units_per_minute: 4500,
      group_units_per_window: 75000000,
      window_seconds: 86460 as const,
    },
  };
  let afterSleep = async () => {},
    rawSnapshot: unknown = undefined,
    rawReceipt: unknown = undefined;
  const deps: MailQuotaPorts = {
    enabled: true,
    now: () => now,
    uuid: () => key,
    sleep: async (ms) => {
      now += ms;
      await afterSleep();
    },
    rpc: async (name, input) => {
      calls.push({ name, input });
      if (name === "mail_quota_snapshot")
        return rawSnapshot ?? { closed: false, policy: structuredClone(p) };
      if (name === "mail_quota_reserve")
        return (
          rawReceipt ?? {
            reserved: true,
            wait_ms: wait,
            group_scope: "gmail:crm:shared",
            account_scope: "gmail:account:" + input.account,
            policy_id: p.policy_id,
            generation: p.generation,
          }
        );
      assert.equal(name, "mail_quota_admit");
      return admit;
    },
  };
  return {
    account,
    key,
    calls,
    deps,
    get policy() {
      return p;
    },
    set policy(v) {
      p = v;
    },
    get now() {
      return now;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get legacy() {
      return legacy;
    },
    get emitted() {
      return emitted;
    },
    authorize: async () => {
      if (!authorized) throw Error("fixture revoked");
    },
    legacyCall: async () => {
      legacy++;
    },
    emit: async () => {
      emitted++;
      return "fixture";
    },
    revoke: () => {
      authorized = false;
    },
    wait: (n: number) => {
      wait = n;
    },
    denyAdmit: () => {
      admit = false;
    },
    afterSleep: (fn: () => Promise<void>) => {
      afterSleep = fn;
    },
    snapshot: (v: unknown) => {
      rawSnapshot = v;
    },
    receipt: (v: unknown) => {
      rawReceipt = v;
    },
  };
}
