import { gmailPushEnabled } from "../src/lib/gmail-sync";

type MailboxCredential = {
  account_id: string;
  watch_expires_at: string | null;
};
type MailboxJob = {
  kind: "gmail_sync" | "gmail_watch";
  payload: { account_id: string };
  dedupe_key: string;
};

export async function scheduleMailboxJobs(
  credentials: MailboxCredential[],
  enqueue: (job: MailboxJob) => Promise<void>,
  now = Date.now(),
) {
  const pushEnabled = gmailPushEnabled();
  for (const account of credentials) {
    await enqueue({
      kind: "gmail_sync",
      payload: { account_id: account.account_id },
      dedupe_key: `reconcile:${account.account_id}:${Math.floor(now / 300000)}`,
    });
    if (
      pushEnabled &&
      (!account.watch_expires_at ||
        new Date(account.watch_expires_at).getTime() < now + 86400000)
    )
      await enqueue({
        kind: "gmail_watch",
        payload: { account_id: account.account_id },
        dedupe_key: `watch:${account.account_id}:${Math.floor(now / 3600000)}`,
      });
  }
}
