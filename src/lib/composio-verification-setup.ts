import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const generation = z.number().int().nonnegative().safe();
const limits = z.strictObject({
  group_units_per_minute: z.number().int().positive().max(900000),
  account_units_per_minute: z.number().int().positive().max(4500),
  group_units_per_window: z.number().int().positive().max(75000000),
  window_seconds: z.literal(86460),
});
export const verificationSetupPageSchema = z.strictObject({
  account_id: z.uuid(),
  setup_revision: hash,
  policy: z.strictObject({
    expected_generation: generation,
    proposed_generation: generation.min(1),
    limits,
    ready: z.boolean(),
    can_publish: z.boolean(),
  }),
  candidate_id: z.uuid().nullable(),
  can_grant: z.boolean(),
  verification_available: z.boolean(),
  checks_enabled: z.boolean(),
  transport: z.literal("gmail_oauth"),
  composio_enabled: z.literal(false),
});
const common = { setup_revision: hash, idempotency_key: z.uuid() };
export const verificationSetupCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...common,
    action: z.literal("publish_policy"),
    expected_generation: generation,
    quiescent: z.literal(true),
  }),
  z.strictObject({
    ...common,
    action: z.literal("grant_budget"),
    binding_id: z.uuid(),
    included_confirmed: z.literal(true),
    expires_at: z.iso.datetime({ offset: true }),
  }),
]);
export const verificationSetupResultSchema = z.strictObject({
  action: z.enum(["publish_policy", "grant_budget"]),
  saved: z.literal(true),
  transport: z.literal("gmail_oauth"),
  composio_enabled: z.literal(false),
});
export type VerificationSetupPage = z.infer<typeof verificationSetupPageSchema>;
export type VerificationSetupCommand = z.infer<
  typeof verificationSetupCommandSchema
>;
export const verificationSetupMessages = {
  SETUP_FORBIDDEN: [
    "Requiere sesión superadmin con MFA y acceso al buzón.",
    "A superadmin MFA session with mailbox access is required.",
  ],
  SETUP_UNAVAILABLE: [
    "La preparación no está disponible. Actualiza la revisión.",
    "Setup is unavailable. Refresh the review.",
  ],
  SETUP_INVALID_INPUT: [
    "Revisa la confirmación y la caducidad del presupuesto.",
    "Review the confirmation and budget expiry.",
  ],
  SETUP_STALE: [
    "La revisión cambió. Actualízala antes de continuar.",
    "The review changed. Refresh it before continuing.",
  ],
  SETUP_CONFLICT: [
    "La política o la asociación no permite esta acción. Revisa su estado.",
    "The policy or binding does not allow this action. Review its status.",
  ],
} as const;
export type VerificationSetupErrorCode = keyof typeof verificationSetupMessages;
export function verificationSetupErrorText(code: unknown, locale: string) {
  const key =
    typeof code === "string" && Object.hasOwn(verificationSetupMessages, code)
      ? (code as VerificationSetupErrorCode)
      : "SETUP_UNAVAILABLE";
  return verificationSetupMessages[key][locale === "en" ? 1 : 0];
}
