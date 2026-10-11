export type GmailAttachmentItem = {
  archive_message_id: string;
  part_id: string;
  name: string;
  mime_type: string;
  size: number;
  sent_at: string;
  subject: string;
  participants: { email: string; role: string }[];
  format: string;
  suspected_inline: boolean;
  decision: "pending" | "included" | "excluded";
  copied: boolean;
  last_error: string | null;
};
export const attachmentKey = (
  f: Pick<GmailAttachmentItem, "archive_message_id" | "part_id">,
) => `${f.archive_message_id}:${f.part_id}`;
// Never trust a filename or a sender-supplied MIME type for browser rendering.
export function attachmentPreviewType(bytes: Uint8Array): string | null {
  const ascii = (n: number) => String.fromCharCode(...bytes.slice(0, n));
  if (ascii(5) === "%PDF-") return "application/pdf";
  if (bytes[0] === 0x89 && ascii(8).slice(1) === "PNG\r\n\x1a\n")
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(ascii(6))) return "image/gif";
  if (
    ascii(4) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
