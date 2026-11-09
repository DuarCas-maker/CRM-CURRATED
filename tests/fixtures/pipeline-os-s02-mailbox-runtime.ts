import { readFile } from "node:fs/promises";
import { runtimeFixture } from "./pipeline-os-s02-transport-runtime";
export const mailboxSqlPath =
  "docs/specs/pipeline-os/s02/transport-selection/migrations/r06-i03.local.sql";
export async function mailboxFixture(install = true) {
  const f = await runtimeFixture();
  try {
    if (install) {
      await f.owner();
      await f.db.exec("set pipeline_os.r06_i03_local='in_memory_test'");
      await f.db.exec(await readFile(mailboxSqlPath, "utf8"));
    }
    const parameters: Record<string, string[]> = {
      mail_sync_begin: ["account", "expected_revision", "capability_hash"],
      mail_sync_validate: ["cycle", "capability"],
      mail_sync_acquire: [
        "cycle",
        "capability",
        "operation",
        "resource",
        "capability_hash",
      ],
      mail_sync_complete: ["cycle", "capability", "checkpoint"],
      mail_sync_abort: ["cycle", "capability"],
      mail_transport_schedule: [],
      mail_direct_job: ["account"],
    };
    const base = f.deps.rpc;
    f.deps.rpc = async (name, p) => {
      const keys = parameters[name];
      if (!keys) return base(name, p);
      f.calls.push(name);
      await f.service();
      return f.scalar(
        `select public.${name}(${keys.map((_, i) => "$" + (i + 1)).join(",")}) v`,
        keys.map((k) => p[k]),
      );
    };
    async function receiving(account = f.accounts[0]) {
      await f.owner();
      await f.db.query(
        "update mail_accounts set live_enabled=true,sync_enabled=true where id=$1",
        [account],
      );
    }
    return { ...f, receiving };
  } catch (e) {
    await f.db.close();
    throw e;
  }
}
