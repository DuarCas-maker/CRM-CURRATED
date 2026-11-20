import { z } from "zod";
import { HttpError } from "./supabase";
import { gmail } from "./google";
import { mailQuotaEnabled } from "./mail-quota";
import {
  mailboxScope,
  withMailboxScope,
} from "./mail-transport/mailbox-context";
import {
  mailRoutingActive,
  simpleAccountRuntime,
  withMailRuntime,
} from "./mail-transport/runtime-context";

// This entry point can only read the exact attachment, never send or list mail.
// Callers bind authorization to their RLS-visible source and its current identity.
export async function readAuthorizedGmailAttachment(
  account: string,
  message: string,
  attachment: string,
  authorize: () => Promise<void>,
) {
  if (
    !z.uuid().safeParse(account).success ||
    !/^[a-f0-9]{1,128}$/i.test(message) ||
    !/^[A-Za-z0-9_-]{1,2048}$/.test(attachment)
  )
    throw new HttpError(400, "Invalid attachment reference");
  await authorize();
  const scope = mailboxScope();
  if (scope && scope.account !== account)
    throw new HttpError(403, "Attachment mailbox changed");
  const request = () =>
    gmail<{ data: string }>(
      account,
      `messages/${message}/attachments/${attachment}`,
      {},
      authorize,
    );
  if (scope || mailRoutingActive() || !mailQuotaEnabled()) return request();
  const managed = await simpleAccountRuntime(account);
  if (managed) return withMailRuntime(managed, request);
  // Legacy human reads need their own source proof; they are not worker jobs.
  // A concurrent switch to a managed route is denied by revision/directOnly.
  return withMailboxScope(
    {
      account,
      revision: 0,
      directOnly: true,
      validate: async () => {
        await authorize();
        return true;
      },
    },
    request,
  );
}
