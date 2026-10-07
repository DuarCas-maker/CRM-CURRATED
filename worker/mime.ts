import { randomUUID } from "node:crypto";
export type Attachment = { name: string; mime: string; bytes: Buffer };
function header(value: string) {
  if (/[\r\n]/.test(value)) throw new Error("INVALID_MAIL_HEADER");
  return value;
}
function encoded(value: string) {
  return `=?UTF-8?B?${Buffer.from(header(value)).toString("base64")}?=`;
}
const base64 = (bytes: Buffer) =>
  bytes
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") || "";
export function buildMime(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  unsubscribe?: string;
  attachments?: Attachment[];
}) {
  const boundary = `curated_${randomUUID()}`;
  const headers = [
    `From: ${header(input.from)}`,
    `To: ${header(input.to)}`,
    `Subject: ${encoded(input.subject)}`,
    `Message-ID: ${header(input.messageId)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${header(input.inReplyTo)}`);
  if (input.references) headers.push(`References: ${header(input.references)}`);
  if (input.unsubscribe)
    headers.push(
      `List-Unsubscribe: <${header(input.unsubscribe)}>`,
      `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    );
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(Buffer.from(input.body))}`,
  ];
  for (const attachment of input.attachments || [])
    parts.push(
      `--${boundary}\r\nContent-Type: ${header(attachment.mime)}\r\nContent-Disposition: attachment; filename="${header(attachment.name).replace(/["\\]/g, "_")}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(attachment.bytes)}`,
    );
  return Buffer.from(
    headers.join("\r\n") +
      "\r\n\r\n" +
      parts.join("\r\n") +
      `\r\n--${boundary}--\r\n`,
  ).toString("base64url");
}
export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};
export function messageText(part: GmailPart): string {
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  const plain = (part.parts || []).map(messageText).filter(Boolean).join("\n");
  if (plain) return plain;
  if (part.mimeType === "text/html" && part.body?.data)
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  return "";
}
export function attachments(part: GmailPart): GmailPart[] {
  return [
    ...(part.filename && part.body?.attachmentId ? [part] : []),
    ...(part.parts || []).flatMap(attachments),
  ];
}
export function emailAddress(value: string) {
  return (value.match(/<([^>]+)>/)?.[1] || value).trim().toLowerCase();
}
