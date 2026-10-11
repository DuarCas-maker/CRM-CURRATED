// Presentation only: original evidence is never rewritten or parsed into invented messages.
export function readableMail(body: string) {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const next = lines.slice(i, i + 5).join(" ");
    if (
      /^>/.test(line) ||
      /^-{3,}\s*(Original Message|Forwarded message|Mensaje original)/i.test(
        line,
      ) ||
      (/^(On |El )/.test(line) && /(?:wrote:|escribi[oó]:)(?:\s|$)/.test(next))
    ) {
      end = i;
      break;
    }
  }
  for (let i = 1; i < end; i++) {
    const line = lines[i].trim();
    if (
      /^(--\s*$|CONFIDENTIALITY NOTICE|AVISO DE CONFIDENCIALIDAD|Sent from my |Enviado desde mi )/i.test(
        line,
      )
    ) {
      end = i;
      break;
    }
    if (
      /^(Chief (Executive|Financial) Officer|Funding Manager|CEO\b)/i.test(
        line,
      ) &&
      /(?:@|Toll-Free|Direct:|Fax:)/i.test(lines.slice(i, i + 8).join(" "))
    ) {
      end = Math.max(1, i - 1);
      break;
    }
    if (
      /\|\s*(Funding Manager|Seller|Closer)\b/i.test(line) &&
      /@/.test(lines.slice(i, i + 5).join(" "))
    ) {
      end = i;
      break;
    }
  }
  const clean = lines.slice(0, end).join("\n").trim();
  return { text: clean || "", folded: end < lines.length, original: body };
}

export type MailPeer = { email: string; role: string; name?: string };
export function messageChannels(
  input: {
    sender: string;
    direction: string;
    participants?: MailPeer[];
    sender_team?: unknown;
  },
  context: {
    team: string[];
    clients: string[];
    lenders: { email: string; lender_id: string }[];
    fallbackLender?: string;
  },
) {
  const team = new Set(context.team.map((e) => e.toLowerCase()));
  const sender = input.sender.toLowerCase();
  const own =
    input.direction === "outbound" || !!input.sender_team || team.has(sender);
  const senderLender = context.lenders.find((l) => l.email === sender);
  if (!own && senderLender) return [`lender:${senderLender.lender_id}`];
  const recipients = (input.participants || [])
    .filter((p) => p.role !== "from")
    .map((p) => p.email.toLowerCase());
  if (own) {
    const lenders = [
      ...new Set(
        context.lenders
          .filter((l) => recipients.includes(l.email))
          .map((l) => `lender:${l.lender_id}`),
      ),
    ];
    if (lenders.length) return lenders;
    if (context.fallbackLender) return [`lender:${context.fallbackLender}`];
    if (recipients.length && recipients.every((e) => team.has(e)))
      return ["team"];
    if (recipients.some((e) => context.clients.includes(e))) return ["client"];
    return ["review"];
  }
  if (context.clients.includes(sender)) return ["client"];
  return ["review"];
}
export function suggestedReply(
  participants: MailPeer[],
  sender: string,
  ownEmails: string[],
  allowedPeers?: string[],
) {
  const own = new Set(ownEmails.map((e) => e.toLowerCase()));
  const permitted =
    allowedPeers &&
    new Set([...allowedPeers, ...ownEmails].map((e) => e.toLowerCase()));
  const target = sender.toLowerCase();
  const to =
    !own.has(target) && (!permitted || permitted.has(target)) ? target : "";
  const recipient =
    to ||
    participants
      .find(
        (p) =>
          p.role === "to" &&
          !own.has(p.email.toLowerCase()) &&
          (!permitted || permitted.has(p.email.toLowerCase())),
      )
      ?.email.toLowerCase() ||
    "";
  const cc = [
    ...new Set(
      participants
        .filter((p) => ["to", "cc"].includes(p.role))
        .map((p) => p.email.toLowerCase()),
    ),
  ].filter(
    (e) => !own.has(e) && e !== recipient && (!permitted || permitted.has(e)),
  );
  return { to: recipient, cc };
}
