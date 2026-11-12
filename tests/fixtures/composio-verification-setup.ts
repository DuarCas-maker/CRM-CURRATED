import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerificationSetupPorts } from "../../src/lib/server/mail-accounts/composio-verification-setup";
import type { BindingPageV2 } from "../../src/lib/composio-bindings-v2";
import type { MailQuotaPolicy } from "../../src/lib/mail-quota-policy";

export function setupFixture() {
  const account = randomUUID(),
    binding = randomUUID(),
    events: string[] = [];
  const now = Date.now();
  const policy: MailQuotaPolicy = {
    contract_version: 2,
    policy_id: randomUUID(),
    generation: 1,
    mode: "crm_shared_conservative",
    state: "enabled",
    limits: {
      group_units_per_minute: 4500,
      account_units_per_minute: 4500,
      group_units_per_window: 75000000,
      window_seconds: 86460,
    },
  };
  const context = {
    contract_version: 2,
    composio_project_id: "pr_fixture",
    credential_version: "cred_fixture",
    auth_config_revision: "revision_fixture",
    provenance_reference: "review_fixture",
    project_provenance: "server_reviewed",
    policy,
  };
  let descriptor: unknown = { context, auth_config_id: "ac_fixture" };
  const page: BindingPageV2 = {
    contract_version: 2,
    account: {
      id: account,
      email: "qa@example.test",
      brand_id: randomUUID(),
      brand_name: "QA",
      brand_revision: 1,
      account_revision: 1,
      context_hash: "a".repeat(64),
      ready: true,
    },
    head_revision: 1,
    transport: "gmail_oauth",
    composio_enabled: false,
    verification_available: false,
    can_confirm: false,
    current: {
      id: binding,
      revision: 1,
      status: "candidate",
      reason: null,
      stale: false,
      created_at: new Date(now).toISOString(),
      reviewed_at: null,
      external_refs: {
        project: "…ture",
        auth_config: "…ture",
        connection: "…ture",
        user: "…ture",
        quota: "…",
      },
    },
    history: [],
    cursor: null,
    policy: { id: policy.policy_id, generation: 1, enabled: true },
    latest_check: null,
  };
  let head: MailQuotaPolicy | null = null,
    closed = false,
    denied = false,
    used = 0;
  let error: string | null = null,
    afterAuthorize = () => {};
  const publications = new Map<string, string>(),
    budgets = new Map<string, string>();
  const writes: {
    name: string;
    input: Record<string, unknown>;
    role: string;
  }[] = [];
  const rpc =
    (role: string) =>
    async (name: string, input: Record<string, unknown> = {}) => {
      events.push(role + ":" + name);
      if (error) return { data: null, error: { message: error } };
      if (name === "composio_binding_authorize_v2") {
        afterAuthorize();
        return {
          data: null,
          error: denied ? { message: "C_BINDING_FORBIDDEN" } : null,
        };
      }
      let data: unknown = null;
      if (name === "composio_binding_page_v2") data = structuredClone(page);
      else if (name === "mail_quota_snapshot")
        data = { closed, policy: head && structuredClone(head) };
      else if (name === "mail_quota_publish") {
        writes.push({ name, input, role });
        const key = String(input.request_key),
          fingerprint = JSON.stringify(input);
        if (publications.has(key) && publications.get(key) !== fingerprint)
          throw Error("FIXTURE_KEY_REUSE");
        if (
          !publications.has(key) &&
          input.expected_generation !== (head?.generation ?? 0)
        )
          return { data: null, error: { message: "QGR_STALE" } };
        publications.set(key, fingerprint);
        head = structuredClone(input.value as MailQuotaPolicy);
        data = {
          policy_id: head.policy_id,
          generation: head.generation,
          state: head.state,
          group_scope: "gmail:crm:shared",
        };
      } else if (name === "composio_binding_budget_v2") {
        writes.push({ name, input, role });
        const key = String(input.request_key),
          fingerprint = JSON.stringify(input);
        if (budgets.has(key) && budgets.get(key) !== fingerprint)
          throw Error("FIXTURE_KEY_REUSE");
        if (!budgets.has(key)) {
          budgets.set(key, fingerprint);
          used = 0;
        }
        page.verification_available = true;
      } else if (name !== "composio_binding_authorize_v2")
        throw Error("UNEXPECTED_RPC:" + name);
      return { data, error: null };
    };
  const human = { rpc: rpc("human") } as unknown as SupabaseClient;
  const ports: VerificationSetupPorts = {
    enabled: true,
    targetAccount: account,
    quotaEnabled: true,
    binding: {
      enabled: true,
      checksEnabled: true,
      human,
      descriptor: () => {
        events.push("descriptor");
        return descriptor;
      },
      service: () => {
        events.push("service");
        return { rpc: rpc("service") } as unknown as SupabaseClient;
      },
      apiKey: () => {
        throw Error("KEY_ACCESS_FORBIDDEN");
      },
      fetchImpl: async () => {
        throw Error("PROVIDER_ACCESS_FORBIDDEN");
      },
      now: () => now,
    },
  };
  return {
    account,
    binding,
    now,
    policy,
    context,
    page,
    ports,
    events,
    writes,
    publishHead: () => {
      head = structuredClone(policy);
    },
    setHead: (v: MailQuotaPolicy | null) => {
      head = v;
    },
    descriptor: (v: unknown) => {
      descriptor = v;
    },
    deny: () => {
      denied = true;
    },
    close: () => {
      closed = true;
    },
    error: (v: string) => {
      error = v;
    },
    afterAuthorize: (fn: () => void) => {
      afterAuthorize = fn;
    },
    consume: (n: number) => {
      used += n;
    },
    get used() {
      return used;
    },
  };
}
