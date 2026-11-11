import { z } from "zod";
const base = {
  accountId: z.uuid(),
  connectedAccountId: z.string().regex(/^ca_[A-Za-z0-9_-]{1,128}$/),
  authConfigId: z.string().regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
  userId: z
    .string()
    .min(1)
    .max(1024)
    .regex(/^[^\s\x00-\x1f\x7f]+$/),
  mailboxEmail: z.email().max(254),
  verifiedMailboxEmail: z.email().max(254),
  identityVerified: z.literal(true),
  status: z.literal("active"),
  revision: z.number().int().positive().safe(),
};
export const resolvedBindingSchema = z
  .union([
    z.strictObject({
      ...base,
      quotaContractVersion: z.literal(1).optional(),
      quotaProjectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    }),
    z.strictObject({
      ...base,
      quotaContractVersion: z.literal(2),
      quotaProjectId: z.null(),
      quotaPolicyId: z.uuid(),
      quotaPolicyGeneration: z.number().int().positive().safe(),
    }),
  ])
  .refine(
    (b) =>
      b.mailboxEmail.toLowerCase() === b.verifiedMailboxEmail.toLowerCase(),
  );
export type ResolvedBinding = Readonly<z.infer<typeof resolvedBindingSchema>>;
