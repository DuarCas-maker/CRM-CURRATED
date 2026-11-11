import { z } from "zod";

// Pure contracts only. These local ceilings do not certify provider allowance.
export const mailQuotaPolicyCeilings = Object.freeze({
  group_units_per_minute: 900_000,
  account_units_per_minute: 4_500,
  group_units_per_window: 75_000_000,
  window_seconds: 86_460,
});

const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const uuid = z.uuid().transform((value) => value.toLowerCase());
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const googleProject = z.discriminatedUnion("provenance", [
  z.strictObject({ provenance: z.literal("unknown"), project_id: z.null() }),
  z.strictObject({
    provenance: z.literal("oauth_client_reviewed"),
    project_id: identifier,
  }),
]);
const limits = z
  .strictObject({
    group_units_per_minute: positiveInteger.max(
      mailQuotaPolicyCeilings.group_units_per_minute,
    ),
    account_units_per_minute: positiveInteger.max(
      mailQuotaPolicyCeilings.account_units_per_minute,
    ),
    group_units_per_window: positiveInteger.max(
      mailQuotaPolicyCeilings.group_units_per_window,
    ),
    window_seconds: z.literal(mailQuotaPolicyCeilings.window_seconds),
  })
  .refine(
    (value) => value.account_units_per_minute <= value.group_units_per_minute,
    { message: "Account limit exceeds group limit" },
  );

// A v1 Google-project context is deliberately not accepted or upgraded here.
export const mailQuotaPolicySchema = z.strictObject({
  contract_version: z.literal(2),
  policy_id: uuid,
  generation: positiveInteger,
  mode: z.literal("crm_shared_conservative"),
  state: z.enum(["disabled", "enabled"]),
  limits,
  google_project: googleProject.nullable().optional(),
});
export type MailQuotaPolicy = z.infer<typeof mailQuotaPolicySchema>;

export const mailQuotaScopeRequestSchema = z.discriminatedUnion("provider", [
  z.strictObject({ provider: z.literal("gmail_oauth"), account_id: uuid }),
  z.strictObject({
    provider: z.literal("composio"),
    account_id: uuid,
    auth_config_id: z.string().regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
  }),
]);
export type MailQuotaScopeRequest = z.infer<typeof mailQuotaScopeRequestSchema>;

export type MailQuotaPolicyErrorCode =
  | "MAIL_QUOTA_POLICY_INVALID"
  | "MAIL_QUOTA_POLICY_DISABLED"
  | "MAIL_QUOTA_SCOPE_INVALID";

export class MailQuotaPolicyError extends Error {
  constructor(public readonly code: MailQuotaPolicyErrorCode) {
    super(code);
    this.name = "MailQuotaPolicyError";
  }
}

export type MailQuotaScopes = Readonly<{
  contract_version: 2;
  policy_id: string;
  generation: number;
  group_scope: "gmail:crm:shared";
  account_scope: `gmail:account:${string}`;
  limits: Readonly<MailQuotaPolicy["limits"]>;
}>;

// The shared namespace is installation-wide, not a Google project identifier.
// Resolving scopes neither reserves quota nor grants account/transport access.
export function resolveMailQuotaScopes(
  policyInput: unknown,
  requestInput: unknown,
): MailQuotaScopes {
  const policy = mailQuotaPolicySchema.safeParse(policyInput);
  if (!policy.success)
    throw new MailQuotaPolicyError("MAIL_QUOTA_POLICY_INVALID");
  if (policy.data.state !== "enabled")
    throw new MailQuotaPolicyError("MAIL_QUOTA_POLICY_DISABLED");
  const request = mailQuotaScopeRequestSchema.safeParse(requestInput);
  if (!request.success)
    throw new MailQuotaPolicyError("MAIL_QUOTA_SCOPE_INVALID");

  return Object.freeze({
    contract_version: 2,
    policy_id: policy.data.policy_id,
    generation: policy.data.generation,
    group_scope: "gmail:crm:shared",
    account_scope: `gmail:account:${request.data.account_id}`,
    limits: Object.freeze({ ...policy.data.limits }),
  });
}
