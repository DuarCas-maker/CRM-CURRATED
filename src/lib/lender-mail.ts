import type { MailPeer } from "./mail-display";

// A shared mailbox provider cannot identify a company by its domain.
export const publicMailDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "mail.com",
  "gmx.com",
  "yahoo.es",
]);
export type LenderMailDirectory = {
  lenders: { id: string; email: string; name: string }[];
  lender_contacts: { email: string; lender_id: string; name?: string }[];
  team_emails: string[];
  client_emails: string[];
};
export function lenderEmailResolver(context: LenderMailDirectory) {
  const contacts = [
    ...context.lender_contacts,
    ...context.lenders.map((l) => ({ email: l.email, lender_id: l.id })),
  ];
  const exact = new Map<string, Set<string>>(),
    domains = new Map<string, Set<string>>();
  for (const contact of contacts) {
    const email = contact.email.trim().toLowerCase();
    const domain = email.split("@")[1];
    const ids = exact.get(email) || new Set<string>();
    ids.add(contact.lender_id);
    exact.set(email, ids);
    if (domain && !publicMailDomains.has(domain)) {
      const firms = domains.get(domain) || new Set<string>();
      firms.add(contact.lender_id);
      domains.set(domain, firms);
    }
  }
  const excluded = new Set(
    [...context.team_emails, ...context.client_emails].map((e) =>
      e.toLowerCase(),
    ),
  );
  return (address: string): string | undefined => {
    const email = address.trim().toLowerCase();
    if (email.endsWith("@curatedfinancial.com")) return undefined;
    if (excluded.has(email)) return undefined;
    const matches = exact.get(email) || domains.get(email.split("@")[1]);
    return matches?.size === 1 ? [...matches][0] : undefined;
  };
}
export function lenderMessageIds(
  message: { sender: string; direction: string; participants?: MailPeer[] },
  resolve: (email: string) => string | undefined,
  teamEmails: string[],
) {
  const own =
    message.direction === "outbound" ||
    teamEmails.includes(message.sender.toLowerCase());
  if (!own) {
    const firm = resolve(message.sender);
    return firm ? [firm] : [];
  }
  // Broadcasts belong to each recipient company; incoming CCs never route a reply to another lender.
  return [
    ...new Set(
      (message.participants || [])
        .filter((p) => p.role !== "from")
        .map((p) => resolve(p.email))
        .filter((id): id is string => !!id),
    ),
  ];
}
export function lenderReplyRecipients(
  message: { sender: string; direction: string; participants?: MailPeer[] },
  lender: string,
  context: LenderMailDirectory,
  sendingEmail: string,
) {
  const resolve = lenderEmailResolver(context);
  const sender = message.sender.toLowerCase();
  const participants = message.participants || [];
  const to =
    resolve(sender) === lender
      ? sender
      : participants
          .find(
            (p) =>
              ["to", "cc", "bcc"].includes(p.role) &&
              resolve(p.email) === lender,
          )
          ?.email.toLowerCase() || "";
  const own = sendingEmail.toLowerCase();
  const team = new Set(context.team_emails.map((e) => e.toLowerCase()));
  const cc = [
    ...new Set([
      ...(team.has(sender) ? [sender] : []),
      ...participants
        .filter((p) => ["to", "cc"].includes(p.role))
        .map((p) => p.email.toLowerCase()),
    ]),
  ].filter(
    (e) => e !== to && e !== own && (resolve(e) === lender || team.has(e)),
  );
  return { to, cc };
}
