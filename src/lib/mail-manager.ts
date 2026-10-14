import { z } from "zod";

const address = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const outgoingMailSchema = z
  .object({
    opportunity_id: z.uuid(),
    account_id: z.uuid(),
    mode: z.enum(["compose", "reply", "forward", "lenders"]).default("compose"),
    to_email: address,
    cc_emails: z.array(address).max(20).default([]),
    bcc_emails: z.array(address).max(20).default([]),
    subject: z
      .string()
      .min(1)
      .max(2000)
      .refine((s) => s.trim().length > 0 && !/[\r\n]/.test(s)),
    body: z.string().trim().min(1).max(10000),
    process_id: z.uuid().nullable().optional(),
    conversation_id: z.uuid().optional(),
    reply_message_id: z.uuid().optional(),
    submission_id: z.uuid().optional(),
    lender_id: z.uuid().optional(),
    attachment_ids: z.array(z.uuid()).max(10).default([]),
    gmail_file_ids: z.array(z.uuid()).max(10).default([]),
    upload_ids: z.array(z.uuid()).max(20).default([]),
    targets: z
      .array(
        z.object({
          lender_id: z.uuid(),
          email: address,
          submission_id: z.uuid().optional(),
        }),
      )
      .max(20)
      .default([]),
    draft_id: z.uuid().optional(),
    forward_message_id: z.uuid().optional(),
    forward_file_ids: z.array(z.uuid()).max(20).default([]),
  })
  .superRefine((input, context) => {
    if (input.mode !== "reply" && input.subject.length > 200)
      context.addIssue({
        code: "custom",
        message: "Maximum 200 subject characters for new mail",
      });
    if (
      input.mode !== "forward" &&
      (input.forward_message_id || input.forward_file_ids.length)
    )
      context.addIssue({
        code: "custom",
        message: "Forward attachments require a forwarded message",
      });
    if (input.mode === "forward" && !input.forward_message_id)
      context.addIssue({
        code: "custom",
        message: "Choose the forwarded message",
      });
    if (
      input.attachment_ids.length +
        input.gmail_file_ids.length +
        input.upload_ids.length +
        input.forward_file_ids.length >
      20
    )
      context.addIssue({ code: "custom", message: "Maximum 20 attachments" });
    if (
      input.mode === "reply" &&
      (!input.conversation_id || !input.reply_message_id)
    )
      context.addIssue({ code: "custom", message: "Choose a reply message" });
    if (
      input.mode === "lenders" &&
      (!input.process_id ||
        !input.targets.length ||
        input.cc_emails.length ||
        input.bcc_emails.length)
    )
      context.addIssue({
        code: "custom",
        message:
          "Choose a process and lenders; copies cannot be shared across lenders",
      });
  });
export type OutgoingMail = z.infer<typeof outgoingMailSchema>;
export type MailDraft = Partial<OutgoingMail> & { id?: string };
export function mailCopies(value: string, excluded: string[] = []) {
  const blocked = new Set(excluded.map((e) => e.toLowerCase()));
  return [
    ...new Set(
      value
        .split(/[,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].filter((e) => !blocked.has(e));
}
export function defaultReplyAccount(
  receivedAccount: string,
  allowed: string[],
) {
  return allowed.includes(receivedAccount) ? receivedAccount : "";
}
export function forwardedBody(
  sender: string,
  date: string,
  subject: string,
  body: string,
) {
  return `\n\n---------- Forwarded message ----------\nFrom: ${sender}\nDate: ${date}\nSubject: ${subject}\n\n${body}`;
}
