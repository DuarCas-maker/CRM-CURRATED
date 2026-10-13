import type { MailAccount, Message } from "./domain";

export type MailReplySend = {
  id: string;
  conversation_id: string;
  reply_message_id: string;
  account_id: string;
  to_email: string;
  cc_emails: string[];
  body: string;
  subject: string;
  status: string;
  message_id_header: string;
  gmail_message_id?: string | null;
  created_at: string;
  sent_at?: string | null;
  last_error?: string | null;
};
export type MailChatMessage = Message & { queued_send?: MailReplySend };
export type MailDateOrder = "newest" | "oldest";

export function orderMailMessages<T extends Pick<Message, "id" | "sent_at">>(
  messages: readonly T[],
  order: MailDateOrder = "newest",
): T[] {
  const direction = order === "newest" ? -1 : 1;
  return [...messages].sort(
    (a, b) =>
      direction *
      (Date.parse(a.sent_at) - Date.parse(b.sent_at) ||
        a.id.localeCompare(b.id)),
  );
}

// A queued reply stays visible until its actual Gmail message is available.
// Gmail IDs are scoped to a mailbox; RFC Message-ID can match across mailboxes.
export function mailChatMessages(
  messages: Message[],
  sends: MailReplySend[],
  accounts: Pick<MailAccount, "id" | "email">[],
): MailChatMessage[] {
  const pending = sends.filter(
    (s) =>
      !messages.some(
        (m) =>
          (!!m.internet_message_id &&
            m.internet_message_id === s.message_id_header) ||
          (!!s.gmail_message_id &&
            m.gmail_message_id === s.gmail_message_id &&
            m.conversation_id === s.conversation_id),
      ),
  );
  return orderMailMessages(
    [
      ...messages,
      ...pending.map((s): MailChatMessage => ({
        id: `send:${s.id}`,
        conversation_id: s.conversation_id,
        direction: "outbound",
        sender: accounts.find((a) => a.id === s.account_id)?.email || "",
        body: s.body,
        sent_at: s.sent_at || s.created_at,
        status: s.status,
        queued_send: s,
        participants: [
          { email: s.to_email, role: "to" },
          ...(s.cc_emails || []).map((email) => ({ email, role: "cc" })),
        ],
      })),
    ],
    "oldest",
  );
}

export const mailSendLabels: Record<string, [string, string]> = {
  queued: ["En cola", "Queued"],
  sending: ["Enviando", "Sending"],
  sent: ["Enviado · aceptado por Gmail", "Sent · accepted by Gmail"],
  uncertain: [
    "Resultado incierto · revisar antes de reenviar",
    "Uncertain · review before resending",
  ],
  failed: ["Error de envío", "Sending failed"],
  paused: ["Envío pausado", "Sending paused"],
  cancelled: ["Cancelado", "Cancelled"],
};
