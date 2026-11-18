import { z } from "zod";

export const mailProvider = z.enum(["gmail_oauth", "composio"]);
export const mailConnectionInput = z.strictObject({
  email: z
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  provider: mailProvider,
  advisor_id: z.uuid().optional(),
  idempotency_key: z.uuid(),
});
export const mailConnectionState = z.enum([
  "prepared",
  "authorizing",
  "preparing",
  "ready",
  "attention",
  "disconnected",
]);
export const mailConnectionView = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  provider: mailProvider,
  state: mailConnectionState,
  account_id: z.uuid().nullable(),
  advisor_id: z.uuid(),
  error: z.string().nullable(),
  sync_status: z
    .enum(["pending", "syncing", "current", "attention"])
    .optional(),
  last_synced_at: z.iso.datetime({ offset: true }).nullable().optional(),
  authorization_url: z.url().nullable().optional(),
});
export const mailConnectionsOptions = z.strictObject({
  enabled: z.boolean(),
  included_available: z.boolean().default(false),
  composio_enabled: z.boolean().default(false),
  direct_account_ids: z.array(z.uuid()).default([]),
  advisors: z.array(
    z.strictObject({ id: z.uuid(), name: z.string(), email: z.email() }),
  ),
  connections: z.array(mailConnectionView),
});
export type MailConnection = z.infer<typeof mailConnectionView>;
export type MailConnectionInput = z.infer<typeof mailConnectionInput>;
export const mailConnectionLabels: Record<MailConnection["state"], string> = {
  prepared: "Preparando conexión",
  authorizing: "Esperando autorización",
  preparing: "Preparando el buzón",
  ready: "Lista",
  attention: "Necesita atención",
  disconnected: "Desconectada",
};
export function matchingAdvisor(
  email: string,
  advisors: { id: string; email: string }[],
) {
  const matches = advisors.filter(
    (a) => a.email.toLowerCase() === email.trim().toLowerCase(),
  );
  return matches.length === 1 ? matches[0].id : null;
}
export function simpleMailEnabled() {
  return process.env.SIMPLE_MAIL_ENABLED === "true";
}
export function simpleMailComposioEnabled() {
  return (
    simpleMailEnabled() && process.env.SIMPLE_MAIL_COMPOSIO_ENABLED === "true"
  );
}
