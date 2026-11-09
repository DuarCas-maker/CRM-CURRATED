import { readFile } from "node:fs/promises";
import { transportFixture } from "./pipeline-os-s02-transport-selection";
import { c1Candidate } from "./pipeline-os-s02-composio-bindings";
import type { RuntimeDependencies } from "../../src/lib/server/mail-transport/runtime-context";
export const runtimeSqlPath =
  "docs/specs/pipeline-os/s02/transport-selection/migrations/r06-i02.local.sql";
export const runtimeConfiguration = () => ({
  context: {
    composio_project_id: c1Candidate.composio_project_id,
    credential_version: "fixture-version-1",
    google_quota_project_id: c1Candidate.google_quota_project_id,
    auth_config_revision: "fixture-r1",
    provenance_reference: "fixture-reviewed",
    project_provenance: "server_reviewed",
    quota_provenance: "oauth_client_reviewed",
  },
  apiKey: "fictional-api-key",
});
export async function runtimeFixture(install = true) {
  const f = await transportFixture();
  try {
    if (install) {
      await f.owner();
      await f.db.exec("set pipeline_os.r06_i02_local='in_memory_test'");
      await f.db.exec(await readFile(runtimeSqlPath, "utf8"));
    }
    const parameters: Record<string, string[]> = {
      mail_transport_snapshot: ["account"],
      mail_transport_acquire: [
        "account",
        "expected_revision",
        "operation",
        "resource",
        "capability_hash",
      ],
      mail_transport_validate_context: [
        "attempt",
        "capability",
        "context_digest",
        "config_generation",
        "admit",
      ],
      mail_transport_finish: ["attempt", "capability", "outcome"],
      mail_transport_settle_dispatch: ["attempt", "capability"],
    };
    const calls: string[] = [];
    const deps: RuntimeDependencies = {
      rpc: async (name, p) => {
        const keys = parameters[name];
        if (!keys) throw Error("Unlisted fixture RPC");
        calls.push(name);
        await f.service();
        return f.scalar(
          `select public.${name}(${keys.map((_, i) => "$" + (i + 1)).join(",")}) v`,
          keys.map((k) => p[k]),
        );
      },
      composioEnabled: true,
      configuration: runtimeConfiguration,
      fetchImpl: async () => {
        throw Error("HTTP fixture not selected");
      },
      now: () => Date.now(),
    };
    async function composio() {
      const fresh = await f.onboard();
      await f.verifyAndConfirm(fresh.account);
      await f.run("prepare_transition", "composio", fresh.account);
      await f.run("commit_transition", "composio", fresh.account);
      return fresh;
    }
    return { ...f, deps, calls, composio };
  } catch (e) {
    await f.db.close();
    throw e;
  }
}
