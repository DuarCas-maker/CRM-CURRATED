"use client";
import {
  Reply,
  ReplyAll,
  Forward,
  MoreHorizontal,
  ExternalLink,
} from "lucide-react";
import type { Locale, Message, Workspace } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import type { MailChatMessage } from "@/lib/mail-chat";
import { mailSendLabels } from "@/lib/mail-chat";
import { teamLabel } from "@/lib/gmail-team";
import { MailBody } from "./mail-bubble";
import { t } from "./ui";

export type { MailVisibleFile } from "@/lib/mail-files";
import type { MailVisibleFile } from "@/lib/mail-files";
import { MailAttachments } from "./mail-attachments";
export function MailMessage({
  message,
  data,
  locale,
  teamEmails,
  files,
  legacyAttachments = [],
  onAttachment,
  onFileReview,
  onReply,
  onForward,
  onOriginal,
  canReplyAll = false,
}: {
  message: MailChatMessage;
  data: Workspace;
  locale: Locale;
  teamEmails: string[];
  files: MailVisibleFile[];
  onReply: (m: Message, all?: boolean) => void;
  onForward: (m: Message) => void;
  onOriginal: (m: Message) => void;
  canReplyAll?: boolean;
  onFileReview?: (file: MailVisibleFile) => void;
  legacyAttachments?: NonNullable<Workspace["attachments"]>;
  onAttachment?: (
    a: NonNullable<Workspace["attachments"]>[number],
    m: Message,
  ) => void;
}) {
  const outbound =
    message.direction === "outbound" ||
    !!message.sender_team ||
    teamEmails.includes(message.sender.toLowerCase());
  const named =
    data.profiles.find(
      (p) => p.email.toLowerCase() === message.sender.toLowerCase(),
    )?.name ||
    data.lender_contacts?.find(
      (p) => p.email.toLowerCase() === message.sender.toLowerCase(),
    )?.name ||
    message.participants?.find((p) => p.role === "from")?.name;
  return (
    <article className={`cw-message ${outbound ? "outgoing" : "incoming"}`}>
      <span className="cw-message-avatar" aria-hidden="true">
        {(named || message.sender || "?").slice(0, 1).toUpperCase()}
      </span>
      <div className="cw-message-bubble">
        <div className="cw-message-meta">
          <strong>{named || message.sender}</strong>
          <time dateTime={message.sent_at}>
            {dateLabel(message.sent_at, locale, true)}
          </time>
        </div>
        {named && (
          <small className="cw-message-address">{message.sender}</small>
        )}
        {message.sender_team && (
          <small className="cw-message-address">
            {teamLabel(message.sender_team, locale)}
          </small>
        )}
        <MailBody body={message.body} locale={locale} />
        <MailAttachments
          data={data}
          locale={locale}
          files={files}
          legacyAttachments={legacyAttachments}
          onFileReview={onFileReview}
          onAttachment={
            onAttachment ? (a) => onAttachment(a, message) : undefined
          }
        />
        <div className="cw-message-bottom">
          {message.direction === "outbound" && (
            <span className={`cw-send-state ${message.status}`} role="status">
              {t(
                locale,
                ...(mailSendLabels[message.status] || [
                  message.status,
                  message.status,
                ]),
              )}
            </span>
          )}
          <details className="cw-message-details">
            <summary
              aria-label={t(
                locale,
                "Destinatarios y acciones del mensaje",
                "Message recipients and actions",
              )}
            >
              <MoreHorizontal size={14} />
            </summary>
            <div>
              {(message.participants || []).map((p, i) => (
                <p key={`${p.role}:${i}`}>
                  <b>
                    {p.role === "from"
                      ? t(locale, "De", "From")
                      : p.role === "to"
                        ? t(locale, "Para", "To")
                        : p.role.toUpperCase()}
                    :
                  </b>{" "}
                  {p.email}
                </p>
              ))}
              {!message.queued_send && (
                <>
                  <button type="button" onClick={() => onReply(message)}>
                    <Reply size={13} />
                    {t(locale, "Responder", "Reply")}
                  </button>
                  <button
                    type="button"
                    disabled={
                      (!data.gmail_history_enabled && !canReplyAll) || data.demo
                    }
                    onClick={() => onReply(message, true)}
                  >
                    <ReplyAll size={13} />
                    {t(locale, "Responder a todos", "Reply all")}
                  </button>
                  <button
                    type="button"
                    disabled={!data.gmail_history_enabled || data.demo}
                    onClick={() => onForward(message)}
                  >
                    <Forward size={13} />
                    {t(locale, "Reenviar", "Forward")}
                  </button>
                  <button type="button" onClick={() => onOriginal(message)}>
                    <ExternalLink size={13} />
                    {t(locale, "Abrir hilo original", "Open original thread")}
                  </button>
                </>
              )}
            </div>
          </details>
          {!message.queued_send && (
            <button
              className="cw-message-reply"
              type="button"
              onClick={() => onReply(message)}
            >
              <Reply size={12} />
              {t(locale, "Responder", "Reply")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
