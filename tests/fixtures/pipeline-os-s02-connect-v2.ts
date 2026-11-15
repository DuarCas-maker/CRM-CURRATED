import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { connectHttpFixture } from "./pipeline-os-s02-connect-http";
import { connectProviderConfigSchema } from "../../src/lib/server/mail-accounts/composio-connect/config";
import { mailQuotaPolicySchema } from "../../src/lib/mail-quota-policy";

export const deltaPath =
  "docs/specs/pipeline-os/s02/connect-gmail/production-completion/connect-v2.delta.sql";
export async function connectV2Fixture() {
  const f = await connectHttpFixture();
  try {
    await f.owner();
    const root = "docs/specs/pipeline-os/s02/quota-policy-reuse/migrations/";
    const quota = await readFile(root + "quota-policy-v2.local.sql", "utf8");
    // Only the local fixture guard is excluded; the production candidate below is executed verbatim.
    await f.db.exec(quota.slice(quota.indexOf("create schema mail_quota;")));
    const admission = await readFile(root + "quota-i03.local.sql", "utf8");
    await f.db.exec(
      admission.slice(admission.indexOf("alter table mail_quota.reservations")),
    );
    const delta = await readFile(deltaPath, "utf8");
    await f.db.exec(delta);
    const policy = mailQuotaPolicySchema.parse({
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
      google_project: { provenance: "unknown", project_id: null },
    });
    await f.human();
    await f.scalar("select public.mail_quota_publish($1,0,true,$2) v", [
      policy,
      randomUUID(),
    ]);
    const previous = f.config.descriptor;
    f.config.descriptor = connectProviderConfigSchema.parse({
      ...previous,
      config: { ...previous.config, generation: 3, quota_project_id: null },
      context: {
        contract_version: 2,
        composio_project_id: previous.context.composio_project_id,
        credential_version: previous.context.credential_version,
        auth_config_revision: previous.context.auth_config_revision,
        provenance_reference: "fixture-v2-reviewed",
        project_provenance: "server_reviewed",
        policy,
      },
    });
    await f.service();
    await f.scalar("select public.composio_connect_v2_publish($1,0,0,2) v", [
      f.config.descriptor,
    ]);
    const original = f.p.service,
      rpcErrors: string[] = [];
    const names: Record<string, string[]> = {
      composio_connect_policy_current: ["attempt", "authority"],
      composio_connect_profile_reserve: ["attempt", "phase", "authority"],
      composio_connect_profile_admit: ["attempt", "phase", "authority"],
    };
    f.p.service = () => ({
      rpc: async (name, input) => {
        if (!names[name]) return original().rpc(name, input);
        try {
          await f.service();
          return {
            data: await f.scalar(
              `select public.${name}(${names[name].map((_, i) => "$" + (i + 1)).join(",")}) v`,
              names[name].map((k) => input[k]),
            ),
            error: null,
          };
        } catch (e) {
          rpcErrors.push((e as Error).message);
          return { data: null, error: { message: "CONNECT_UNAVAILABLE" } };
        }
      },
    });
    return {
      ...f,
      policy,
      delta,
      rpcErrors,
      async newIntent() {
        return f.intent({ expected_config_generation: 3 });
      },
    };
  } catch (e) {
    await f.db.close();
    throw e;
  }
}
