import { gmail } from "./google";
import { checkDb, HttpError, serviceClient } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { outgoingMailSchema } from "../mail-manager";
import type { Profile } from "../domain";
export async function senderSignature(db: SupabaseClient, accountId: string) {
  if (!checkDb(await db.rpc("can_send", { account: accountId })))
    throw new HttpError(403, "Sender permission required");
  const account = checkDb(
    await db
      .from("mail_accounts")
      .select("email,status")
      .eq("id", accountId)
      .single(),
  )!;
  if (account.status !== "connected")
    throw new HttpError(409, "Connect the sender account");
  const settings = await gmail<{ signature?: string; displayName?: string }>(
    accountId,
    `settings/sendAs/${encodeURIComponent(account.email)}`,
  );
  if (
    (settings.signature || "").length > 100000 ||
    /[\r\n]/.test(settings.displayName || "")
  )
    throw new HttpError(400, "Invalid Gmail sender settings");
  return {
    html: settings.signature || "",
    name: settings.displayName || "",
    email: account.email,
  };
}
export async function messageFiles(
  db: SupabaseClient,
  messages: {
    id: string;
    archive_message_id?: string | null;
    internet_message_id?: string | null;
    conversation_id: string;
  }[],
) {
  const archives = messages
    .map((m) => m.archive_message_id)
    .filter((id): id is string => !!id);
  const incoming = archives.length
    ? checkDb(
        await db
          .from("gmail_saved_attachments")
          .select("id,archive_message_id,name,size,status,last_error")
          .in("archive_message_id", archives),
      ) || []
    : [];
  const headers = messages
    .map((m) => m.internet_message_id)
    .filter((id): id is string => !!id);
  const conversations = messages.length
    ? checkDb(
        await db
          .from("conversations")
          .select("id,opportunity_id")
          .in("id", [...new Set(messages.map((m) => m.conversation_id))]),
      ) || []
    : [];
  const service = serviceClient();
  const sent = headers.length
    ? checkDb(
        await service
          .from("outbox")
          .select(
            "id,message_id_header,opportunity_id,attachment_snapshot,attachment_ids,gmail_file_ids,upload_ids",
          )
          .in("message_id_header", headers)
          .in("opportunity_id", [
            ...new Set(conversations.map((c) => c.opportunity_id)),
          ])
          .eq("status", "sent"),
      ) || []
    : [];
  const docIds = sent.flatMap((s) => s.attachment_ids || []),
    gmailIds = sent.flatMap((s) => s.gmail_file_ids || []),
    uploadIds = sent.flatMap((s) => s.upload_ids || []);
  const docNames = docIds.length
    ? checkDb(
        await service.from("documents").select("id,name").in("id", docIds),
      ) || []
    : [];
  const gmailNames = gmailIds.length
    ? checkDb(
        await service
          .from("gmail_saved_attachments")
          .select("id,name")
          .in("id", gmailIds),
      ) || []
    : [];
  const uploadNames = uploadIds.length
    ? checkDb(
        await service
          .from("mail_uploads")
          .select("id,name")
          .in("id", uploadIds),
      ) || []
    : [];
  const names = [...docNames, ...gmailNames, ...uploadNames];
  return messages.flatMap((m) => {
    const outgoing = sent.find(
      (s) =>
        s.message_id_header === m.internet_message_id &&
        conversations.find((c) => c.id === m.conversation_id)
          ?.opportunity_id === s.opportunity_id,
    );
    if (outgoing)
      return (outgoing.attachment_snapshot || []).map(
        (f: { id: string; name?: string }) => ({
          message_id: m.id,
          id: f.id,
          name:
            f.name || names.find((n) => n.id === f.id)?.name || "Attachment",
          href: `/api/mail/sent-files?message=${m.id}&file=${f.id}`,
        }),
      );
    return incoming
      .filter((f) => f.archive_message_id === m.archive_message_id)
      .map((f) => ({
        message_id: m.id,
        id: f.id,
        name: f.name,
        href: `/api/gmail/files/${f.id}`,
        last_error: f.last_error,
      }));
  });
}
export async function sendManagedMail(
  db: SupabaseClient,
  profile: Profile,
  payload: unknown,
  requestId: string,
) {
  const input = outgoingMailSchema.parse(payload);
  if (
    !checkDb(await db.rpc("can_mail_case", { case_id: input.opportunity_id }))
  )
    throw new HttpError(403, "Case access required");
  const signature = await senderSignature(db, input.account_id);
  const common = {
    case_id: input.opportunity_id,
    account: input.account_id,
    recipient: input.to_email,
    subject_text: input.subject,
    body_text: input.body,
    files: input.attachment_ids,
    gmail_files: input.gmail_file_ids,
    uploads: input.upload_ids,
    copies: input.cc_emails,
    hidden_copies: input.bcc_emails,
    process: input.process_id || null,
    conversation: input.mode === "reply" ? input.conversation_id : null,
    reply_message: input.mode === "reply" ? input.reply_message_id : null,
    submission: input.submission_id || null,
    signature: signature.html,
    display_name: signature.name,
    request: requestId,
  };
  const result =
    input.mode === "forward"
      ? checkDb(
          await db.rpc("queue_mail_forward", {
            input: {
              ...common,
              forward_message_id: input.forward_message_id,
              forward_file_ids: input.forward_file_ids,
            },
          }),
        )
      : input.mode === "lenders"
        ? checkDb(
            await db.rpc("queue_mail_lenders", {
              input: { ...common, targets: input.targets },
            }),
          )
        : checkDb(await db.rpc("queue_mail_email", common));
  if (input.draft_id)
    checkDb(
      await db
        .from("mail_drafts")
        .delete()
        .eq("id", input.draft_id)
        .eq("user_id", profile.id),
    );
  return { ok: true, result };
}
