import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const recipientTargetsSchema = z
  .array(
    z.object({
      lender_id: z.uuid(),
      lender_name: z.string().max(200).optional(),
      email,
      cc_emails: z.array(email).max(20).default([]),
    }),
  )
  .min(1)
  .max(20)
  .refine(
    (targets) =>
      new Set(targets.map((target) => target.lender_id)).size ===
      targets.length,
    "Duplicate lenders",
  );
export const recipientSelectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  targets: recipientTargetsSchema,
});
export type RecipientTarget = z.infer<typeof recipientTargetsSchema>[number];
export type RecipientSelection = z.infer<typeof recipientSelectionSchema> & {
  id: string;
};
type Availability = {
  active?: boolean;
  archived_at?: string | null;
  status?: string;
};
export type RecipientDirectory = {
  lenders: ({ id: string; name: string; email: string } & Availability)[];
  contacts: ({
    lender_id: string;
    email: string;
    name?: string;
  } & Availability)[];
};
const active = (item: Availability) =>
  item.active !== false &&
  !item.archived_at &&
  !["inactive", "archived", "deleted"].includes(item.status || "");
export function lenderContacts(directory: RecipientDirectory, id: string) {
  const lender = directory.lenders.find((l) => l.id === id);
  return lender && active(lender)
    ? directory.contacts.filter((c) => c.lender_id === id && active(c))
    : [];
}
export function recipientIssues(
  targets: RecipientTarget[],
  directory: RecipientDirectory,
) {
  return targets.flatMap<{
    lender_id: string;
    email: string;
    reason: "lender" | "contact";
  }>((target) => {
    const lender = directory.lenders.find((l) => l.id === target.lender_id);
    if (!lender || !active(lender))
      return [
        { lender_id: target.lender_id, email: "", reason: "lender" as const },
      ];
    return [...new Set([target.email, ...target.cc_emails])].flatMap(
      (email) => {
        const contact = directory.contacts.find(
          (c) => c.email.toLowerCase() === email.trim().toLowerCase(),
        );
        return contact &&
          active(contact) &&
          contact.lender_id === target.lender_id
          ? []
          : [
              {
                lender_id: target.lender_id,
                email,
                reason: "contact" as const,
              },
            ];
      },
    );
  });
}

export function filterRecipientLenders(
  directory: RecipientDirectory,
  search: string,
  order: "asc" | "desc",
  locale: string,
) {
  const query = search.trim().toLocaleLowerCase(locale);
  const contacts = new Map<string, RecipientDirectory["contacts"]>();
  for (const contact of directory.contacts) {
    if (!active(contact)) continue;
    const group = contacts.get(contact.lender_id) || [];
    group.push(contact);
    contacts.set(contact.lender_id, group);
  }
  return directory.lenders
    .filter(
      (l) =>
        active(l) &&
        contacts.has(l.id) &&
        [
          l.name,
          l.email,
          ...(contacts.get(l.id) || []).flatMap((c) => [c.email, c.name || ""]),
        ].some((text) => text.toLocaleLowerCase(locale).includes(query)),
    )
    .sort(
      (a, b) =>
        (order === "asc" ? 1 : -1) *
        (a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id)),
    );
}
