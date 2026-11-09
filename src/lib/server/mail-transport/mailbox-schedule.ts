import { z } from "zod";
import {
  transportProvider,
  transportRevision,
} from "../../mail-transport-selection";
import { withMailboxScope } from "./mailbox-context";
import { withMailRuntime, type RuntimeDependencies } from "./runtime-context";
const schema = z.array(
  z.strictObject({
    account_id: z.uuid(),
    provider: transportProvider,
    route_revision: transportRevision,
    receive_enabled: z.boolean(),
    watch_expires_at: z.iso.datetime({ offset: true }).nullable(),
  }),
);
export async function selectedMailboxSchedule(deps: RuntimeDependencies) {
  return schema
    .parse(await deps.rpc("mail_transport_schedule", {}))
    .filter((a) => a.provider !== "composio" || deps.composioEnabled);
}
export async function selectedDirectJob(
  deps: RuntimeDependencies,
  account: string,
) {
  const revision = await deps.rpc("mail_direct_job", { account });
  return revision === null ? null : transportRevision.parse(revision);
}
export async function withSelectedDirectJob<T>(
  deps: RuntimeDependencies,
  account: string,
  revision: unknown,
  action: () => Promise<T>,
) {
  if (
    !transportRevision.safeParse(revision).success ||
    (await selectedDirectJob(deps, account)) !== revision
  )
    return;
  return withMailRuntime(deps, () =>
    withMailboxScope(
      {
        account,
        revision: revision as number,
        directOnly: true,
        validate: async () =>
          (await selectedDirectJob(deps, account)) === revision,
      },
      action,
    ),
  );
}
