import { z } from "zod";

export function lenderPortalUrl(notes: string) {
  const value =
    notes.match(/(?:^|\n)\s*Portal:\s*(https:\/\/[^\s<>]+)/i)?.[1] ||
    notes.match(/https:\/\/[^\s<>]+/i)?.[0] ||
    "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? value
      : "";
  } catch {
    return "";
  }
}
export function lenderPortalNotes(notes: string, url: string) {
  const clean = notes
    .split(/\r?\n/)
    .filter((line) => !/^Portal:\s*https:\/\//i.test(line.trim()))
    .join("\n")
    .trim();
  return url ? `${clean}${clean ? "\n" : ""}Portal: ${url}` : clean;
}
export const lenderDirectorySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().toLowerCase().default(""),
    channel: z.enum(["email", "portal"]),
    products: z.string().max(2000).default(""),
    notes: z.string().max(10000).default(""),
    portal_url: z.string().trim().default(""),
  })
  .superRefine((input, ctx) => {
    if (
      (input.channel === "email" || input.email) &&
      !z.email().max(254).safeParse(input.email).success
    )
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message:
          "Correo válido requerido para el canal Email. / A valid address is required for the Email channel.",
      });
    if (input.email.endsWith("@curatedfinancial.com"))
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message:
          "Los correos internos de Curated no son lenders. / Internal Curated addresses cannot be lenders.",
      });
    const portal = input.portal_url || lenderPortalUrl(input.notes);
    if (
      input.channel === "portal" &&
      (!portal || lenderPortalUrl(portal) !== portal)
    )
      ctx.addIssue({
        code: "custom",
        path: ["portal_url"],
        message:
          "Indica un enlace HTTPS válido al portal. / Enter a valid HTTPS portal URL.",
      });
  })
  .transform((input) => ({
    ...input,
    notes:
      input.channel === "portal"
        ? lenderPortalNotes(
            input.notes,
            input.portal_url || lenderPortalUrl(input.notes),
          )
        : input.notes,
  }));
