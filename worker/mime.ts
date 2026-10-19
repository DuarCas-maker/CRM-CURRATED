import { randomUUID } from "node:crypto";
export type Attachment = { name: string; mime: string; bytes: Buffer };
function header(value: string) {
  if (/[\r\n]/.test(value)) throw new Error("INVALID_MAIL_HEADER");
  return value;
}
function encoded(value: string) {
  const words: string[] = [];
  let chunk = "",
    bytes = 0;
  for (const char of header(value)) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 45) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`);
      chunk = "";
      bytes = 0;
    }
    chunk += char;
    bytes += size;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`);
  return words.join("\r\n ");
}
const base64 = (bytes: Buffer) =>
  bytes
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") || "";
export function buildMime(input: {
  from: string;
  to: string;
  cc?: string[];
  bcc?: string[];
  senderName?: string;
  signatureHtml?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  unsubscribe?: string;
  attachments?: Attachment[];
}) {
  const boundary = `curated_${randomUUID()}`;
  const headers = [
    `From: ${input.senderName ? encoded(input.senderName) + " " : ""}${input.senderName ? "<" : ""}${header(input.from)}${input.senderName ? ">" : ""}`,
    `To: ${header(input.to)}`,
    `Subject: ${encoded(input.subject)}`,
    `Message-ID: ${header(input.messageId)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ];
  if (input.cc?.length) headers.push(`Cc: ${input.cc.map(header).join(", ")}`);
  if (input.bcc?.length)
    headers.push(`Bcc: ${input.bcc.map(header).join(", ")}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${header(input.inReplyTo)}`);
  if (input.references) headers.push(`References: ${header(input.references)}`);
  if (input.unsubscribe)
    headers.push(
      `List-Unsubscribe: <${header(input.unsubscribe)}>`,
      `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    );
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const signatureText = input.signatureHtml
    ?.replace(/<(?:br|\/p|\/div)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
  const plain = input.body + (signatureText ? "\n\n" + signatureText : "");
  const alternative = `alternative_${randomUUID()}`;
  const escapedBody = input.body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br>");
  const textPart = `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(Buffer.from(plain))}`;
  const parts = [
    input.signatureHtml || input.bodyHtml
      ? `--${boundary}\r\nContent-Type: multipart/alternative; boundary="${alternative}"\r\n\r\n--${alternative}\r\n${textPart}\r\n--${alternative}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(Buffer.from(`<div>${input.bodyHtml || escapedBody}</div>${input.signatureHtml ? `<br><div>${input.signatureHtml}</div>` : ""}`))}\r\n--${alternative}--`
      : `--${boundary}\r\n${textPart}`,
  ];
  for (const attachment of input.attachments || [])
    parts.push(
      `--${boundary}\r\nContent-Type: ${header(attachment.mime)}\r\nContent-Disposition: attachment; filename="${header(attachment.name).replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/'/g, "%27")}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(attachment.bytes)}`,
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
  if (part.filename) return ""; // Attachments have their own evidence and selection flow.
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  if (part.mimeType === "multipart/alternative") {
    const plain = (part.parts || []).find(
      (p) => p.mimeType === "text/plain" && p.body?.data && !p.filename,
    );
    if (plain) return messageText(plain);
    for (const child of part.parts || []) {
      const text = messageText(child);
      if (text) return text;
    }
    return "";
  }
  const plain = (part.parts || []).map(messageText).filter(Boolean).join("\n");
  if (plain) return plain;
  if (part.mimeType === "text/html" && part.body?.data)
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/(?:&#39;|&apos;)/g, "'");
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
