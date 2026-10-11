import { messageText, type GmailPart } from "../../worker/mime";

export type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: string;
  labelIds?: string[];
  payload: GmailPart;
};
export type MailParticipant = {
  team?: import("./gmail-team").TeamLabel;
  email: string;
  name: string;
  role: "from" | "to" | "cc" | "bcc";
};
export type MailNature =
  | "personal"
  | "campaign"
  | "automatic"
  | "permanent_bounce"
  | "temporary_bounce"
  | "delivery_report";
export type MailSnapshot = {
  gmail_message_id: string;
  gmail_thread_id: string;
  internet_message_id: string;
  subject: string;
  sent_at: string;
  direction: "inbound" | "outbound";
  nature: MailNature;
  participants: MailParticipant[];
  body: string;
  attachments: {
    part_id: string;
    attachment_id: string | null;
    data?: string;
    name: string;
    mime_type: string;
    size: number;
    inline?: boolean;
  }[];
};

export function mailHeader(payload: GmailPart, name: string) {
  return (
    payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
      ?.value || ""
  );
}

// Split at commas outside quoted display names/angle brackets, not at every comma.
export function parseAddresses(
  value: string,
  role: MailParticipant["role"],
): MailParticipant[] {
  const pieces: string[] = [];
  let start = 0,
    quoted = false,
    angle = false;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"' && value[i - 1] !== "\\") quoted = !quoted;
    if (!quoted && value[i] === "<") angle = true;
    if (!quoted && value[i] === ">") angle = false;
    if (!quoted && !angle && value[i] === ",") {
      pieces.push(value.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(value.slice(start));
  return pieces.flatMap((piece) => {
    const enclosed = piece.match(/<([^<>]+)>/);
    const email = (enclosed?.[1] || piece).trim().toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return [];
    const name = enclosed
      ? piece.slice(0, enclosed.index).trim().replace(/^"|"$/g, "")
      : "";
    return [{ email, name, role }];
  });
}

export function excludedGmailMessage(msg: GmailMessage) {
  return (msg.labelIds || []).some((l) =>
    ["SPAM", "TRASH", "DRAFT"].includes(l),
  );
}

export function historicalQuery(from: string, until: string) {
  return `after:${Math.floor(new Date(from).getTime() / 1000) - 1} before:${Math.ceil(new Date(until).getTime() / 1000)} -in:spam -in:trash -in:drafts`;
}

export function twoMonthsBefore(value: string) {
  const result = new Date(value),
    day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - 2);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result.toISOString();
}
export function shouldCopyGmailFile(
  sentAt: string,
  cutoff: string,
  active: boolean,
  name: string,
) {
  return (
    sentAt >= cutoff ||
    (active &&
      /\b(application|statement|bank|identification|passport|license|contract|agreement|aplicaci[oó]n|estado|identificaci[oó]n|contrato)\b/i.test(
        name.replace(/[_-]/g, " "),
      ))
  );
}

function deliveryStatuses(part: GmailPart): string[] {
  const text =
    part.mimeType === "message/delivery-status" && part.body?.data
      ? Buffer.from(part.body.data, "base64url").toString("utf8")
      : "";
  return [
    ...Array.from(
      text.matchAll(/^Status:\s*([245]\.\d+\.\d+)/gim),
      (m) => m[1],
    ),
    ...(part.parts || []).flatMap(deliveryStatuses),
  ];
}

export function snapshotMessage(
  msg: GmailMessage,
  accountEmail: string,
): MailSnapshot {
  const h = (name: string) => mailHeader(msg.payload, name);
  const participants = (["from", "to", "cc", "bcc"] as const).flatMap((role) =>
    parseAddresses(h(role), role),
  );
  const outbound =
    !!msg.labelIds?.includes("SENT") ||
    participants.some(
      (p) => p.role === "from" && p.email === accountEmail.toLowerCase(),
    );
  const delivery =
    msg.payload.mimeType === "multipart/report" ||
    participants.some(
      (p) => p.role === "from" && /^(mailer-daemon|postmaster)@/i.test(p.email),
    );
  const statuses = deliveryStatuses(msg.payload);
  const nature: MailNature = delivery
    ? statuses.length && statuses.every((s) => s.startsWith("5."))
      ? "permanent_bounce"
      : statuses.length && statuses.every((s) => s.startsWith("4."))
        ? "temporary_bounce"
        : "delivery_report"
    : h("Auto-Submitted") && h("Auto-Submitted").toLowerCase() !== "no"
      ? "automatic"
      : h("List-ID") ||
          h("List-Unsubscribe") ||
          /^(bulk|list)$/i.test(h("Precedence"))
        ? "campaign"
        : "personal";
  const files: MailSnapshot["attachments"] = [];
  function collect(part: GmailPart, path: string) {
    if (part.filename && (part.body?.attachmentId || part.body?.data))
      files.push({
        part_id: path,
        attachment_id: part.body.attachmentId || null,
        data: part.body.data,
        name: part.filename,
        mime_type: part.mimeType || "application/octet-stream",
        size: part.body.size || 0,
        inline:
          /^inline\b/i.test(mailHeader(part, "Content-Disposition")) ||
          !!mailHeader(part, "Content-ID"),
      });
    part.parts?.forEach((child, i) => collect(child, `${path}.${i}`));
  }
  collect(msg.payload, "0");
  return {
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    internet_message_id: h("Message-ID"),
    subject: h("Subject"),
    sent_at: new Date(Number(msg.internalDate)).toISOString(),
    direction: outbound ? "outbound" : "inbound",
    nature,
    participants,
    body: messageText(msg.payload),
    attachments: files,
  };
}

export function primaryPeers(snapshot: MailSnapshot, teamEmails: string[]) {
  const team = new Set(teamEmails.map((e) => e.toLowerCase()));
  return snapshot.participants.filter(
    (p) =>
      !team.has(p.email) &&
      (snapshot.direction === "inbound"
        ? p.role === "from"
        : p.role === "to") &&
      !/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(p.email),
  );
}
