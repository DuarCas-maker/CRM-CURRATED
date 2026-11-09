import { gmailPushEnabled } from "../src/lib/gmail-sync";

type MailboxCredential = {
  account_id: string;
  watch_expires_at: string | null;
  provider?: "gmail_oauth" | "composio";
  route_revision?: number;
  receive_enabled?: boolean;
};
type MailboxJob = {
  kind: "gmail_sync" | "gmail_watch";
  payload: { account_id: string; route_revision?: number };
  dedupe_key: string;
};

export async function scheduleMailboxJobs(
  credentials: MailboxCredential[],
  enqueue: (job: MailboxJob) => Promise<void>,
  now = Date.now(),
) {
  const pushEnabled = gmailPushEnabled();
  for (const account of credentials) {
    if (account.receive_enabled === false) continue;
    const payload = {
      account_id: account.account_id,
      ...(account.route_revision === undefined
        ? {}
        : { route_revision: account.route_revision }),
    };
    await enqueue({
      kind: "gmail_sync",
      payload,
      dedupe_key: `reconcile:${account.account_id}:${Math.floor(now / 60000)}`,
    });
    if (
      pushEnabled &&
      account.provider !== "composio" &&
      (!account.watch_expires_at ||
        new Date(account.watch_expires_at).getTime() < now + 86400000)
    )
      await enqueue({
        kind: "gmail_watch",
        payload,
        dedupe_key: `watch:${account.account_id}:${Math.floor(now / 3600000)}`,
      });
  }
}
