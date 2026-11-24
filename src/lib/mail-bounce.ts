import type { GmailPart } from "../../worker/mime";

export type BounceReason = "mailbox_full" | "address_not_found" | "policy_rejected" | "delivery_failed";
export type BounceReport = {
  recipient: string;
  status: string;
  action: "failed" | "delayed";
  reason: BounceReason;
  references: string[];
};
const header = (part: GmailPart, name: string) =>
  (part.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "").replace(/\r?\n[ \t]+/g, " ");
const decode = (part: GmailPart) => part.body?.data ? Buffer.from(part.body.data, "base64url").toString("utf8") : "";
const ids = (value: string) => [...new Set(value.match(/<[^<>\s]+@[^<>\s]+>/g) || [])];
const email = (value: string) => value.trim().toLowerCase().match(/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/)?.[0];
export function bounceReason(status: string): BounceReason {
  if (/^[45]\.2\.2$/.test(status)) return "mailbox_full";
  if (/^[45]\.1\.[12346]$/.test(status)) return "address_not_found";
  if (/^[45]\.7\./.test(status)) return "policy_rejected";
  return "delivery_failed";
}
/** Parse evidence only. The database must still correlate account, RFC ID/thread and recipient. */
export function parseBounceReport(root: GmailPart): BounceReport[] {
  const from = header(root, "From").match(/(?:<|^)([^<>\s]+@[^<>\s]+)(?:>|$)/)?.[1]?.toLowerCase() || "";
  if (header(root, "X-CRM-Outbound") || !(/^(mailer-daemon|postmaster)@/.test(from) || root.mimeType === "multipart/report")) return [];
  const reports: string[] = [], originals: string[] = [], plain: string[] = [];
  function walk(part: GmailPart, attached = false) {
    const original = attached || /^(?:message\/rfc822|text\/rfc822-headers)$/.test(part.mimeType || "");
    if (original) {
      originals.push(header(part, "Message-ID"), header(part, "Original-Message-ID"));
      originals.push(...(decode(part).match(/^Message-ID:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/gim) || []));
    } else if (part.mimeType === "message/delivery-status") reports.push(decode(part));
    else if (part.mimeType === "text/plain") plain.push(decode(part));
    for (const child of part.parts || []) walk(child, original);
  }
  walk(root);
  const refs = ids([header(root, "In-Reply-To"), header(root, "References"), ...originals].join(" "));
  const result: BounceReport[] = [];
  for (const report of reports) {
    const unfolded = report.replace(/\r?\n[ \t]+/g, " ");
    const reportRefs = ids([...refs, ...(unfolded.match(/^Original-Message-ID:.*$/gim) || [])].join(" "));
    for (const block of unfolded.split(/\r?\n\s*\r?\n/)) {
      const recipient = email(block.match(/^(?:Final|Original)-Recipient:\s*[^;\r\n]+;\s*([^\r\n]+)/im)?.[1] || "");
      const status = block.match(/^Status:\s*([45]\.\d{1,3}\.\d{1,3})\s*$/im)?.[1];
      const action = block.match(/^Action:\s*(failed|delayed)\s*$/im)?.[1] as BounceReport["action"] | undefined;
      if (recipient && status && action) result.push({ recipient, status, action, reason: bounceReason(status), references: reportRefs });
    }
  }
  // Google occasionally omits the DSN MIME part. Require its exact system sender,
  // a standard delivery-failure sentence and enhanced SMTP code (never quoted mail).
  if (!reports.length && /^mailer-daemon@(?:googlemail|gmail)\.com$/.test(from)) {
    const text = plain.join("\n").split(/(?:^|\n)(?:On .+ wrote:|>)/)[0];
    const recipient = email(text.match(/Your message (?:(?:couldn't|could not) be|wasn't|was not) delivered to\s+([^\s<>]+@[^\s<>.]+(?:\.[^\s<>.]+)+)/i)?.[1]?.replace(/[.,;:]$/, "") || "");
    const status = text.match(/\b[45]\d\d[ -]+([45]\.\d{1,3}\.\d{1,3})\b/)?.[1];
    if (recipient && status) result.push({ recipient, status, action: status.startsWith("4") ? "delayed" : "failed", reason: bounceReason(status), references: refs });
  }
  return [...new Map(result.map(r => [r.recipient, r])).values()];
}

/** Only small, relevant machine-readable report parts may be fetched. */
export async function hydrateBounceParts(root: GmailPart, fetchPart: (id: string) => Promise<{data?: string}>) {
  let reads = 0;
  async function walk(part: GmailPart) {
    if (/^(?:message\/delivery-status|text\/rfc822-headers)$/.test(part.mimeType || "") && part.body?.attachmentId && !part.body.data) {
      if (++reads > 12 || (part.body.size || 0) > 262144) throw new Error("BOUNCE_REPORT_TOO_LARGE");
      const payload = await fetchPart(part.body.attachmentId);
      if (!payload.data || payload.data.length > 350000) throw new Error("BOUNCE_REPORT_UNAVAILABLE");
      part.body.data = payload.data;
    }
    for (const child of part.parts || []) await walk(child);
  }
  await walk(root);
}
