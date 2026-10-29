import { z } from "zod";

// S00 validation harness only. This module does not activate campaigns or call APIs.
const positiveInteger = z.number().int().positive();
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const timezone = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
const distribution = z.discriminatedUnion("mode", [
  z
    .strictObject({
      mode: z.literal("percentages"),
      emailPercent: z.number().int().min(0).max(100),
      smsPercent: z.number().int().min(0).max(100),
    })
    .refine((value) => value.emailPercent + value.smsPercent === 100),
  z.strictObject({
    mode: z.literal("filters"),
    rules: z
      .array(
        z.strictObject({
          channel: z.enum(["email", "sms"]),
          field: z.enum(["industry", "country", "state", "source_segment"]),
          values: z.array(z.string().trim().min(1)).min(1),
          priority: positiveInteger,
        }),
      )
      .min(1)
      .refine((rules) => unique(rules.map((rule) => rule.priority))),
    unmatched: z.literal("hold_for_review"),
  }),
]);

export const s00CampaignContract = z.strictObject({
  environment: z.enum(["local", "staging"]),
  pilot: z.strictObject({
    brandIds: z.array(z.string().trim().min(1)).length(1),
    mailboxIds: z.array(z.string().trim().min(1)).length(2).refine(unique),
    smsLineIds: z.array(z.string().trim().min(1)).length(1),
    leadLimit: positiveInteger.max(500),
  }),
  distribution,
  prospecting: z.strictObject({
    intervalHours: z.literal(48),
    maxTotalAttempts: positiveInteger,
    includesInitial: z.literal(true),
    onExhaustion: z.literal("pause"),
  }),
  interested: z.strictObject({
    intervalHours: z.literal(24),
    maxReminders: positiveInteger,
    onExhaustion: z.literal("human_task"),
  }),
  schedule: z
    .strictObject({
      timezone,
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).refine(unique),
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(1).max(24),
    })
    .refine((value) => value.startHour < value.endHour),
  budgets: z.strictObject({
    dailyEmailRecipients: positiveInteger,
    dailySmsSegments: positiveInteger,
    dailyAiUsd: z.number().positive().finite(),
  }),
  optOut: z.literal("group_global"),
  initialAssistantMode: z.literal("human_approval"),
  attribution: z.literal("last_significant_interaction"),
  loyalty: z.literal("internal_tasks_manual_payments"),
});

export function validateS00Campaign(input: unknown) {
  const result = s00CampaignContract.safeParse(input);
  // Never include input values, Zod's diagnostic text or arbitrary field names.
  return result.success
    ? { valid: true as const, issueCodes: [] as string[] }
    : {
        valid: false as const,
        issueCodes: [
          ...new Set(result.error.issues.map((issue) => issue.code)),
        ],
      };
}

type Environment = Record<string, string | undefined>;
const keys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_ORIGIN",
  "INTEGRATION_ENCRYPTION_KEY",
  "BOUNCER_API_KEY",
  "GOOGLE_OAUTH_ORGANIZATIONS",
  "GMAIL_SYNC_MODE",
  "GMAIL_HISTORY_ENABLED",
  "GOOGLE_PUBSUB_TOPIC",
  "GOOGLE_PUBSUB_AUDIENCE",
  "GOOGLE_PUBSUB_SERVICE_ACCOUNT",
  "COMPOSIO_API_KEY",
  "COMPOSIO_AUTH_CONFIG_ID",
  "INSTANTLY_API_KEY",
  "TEXTTORRENT_API_SID",
  "TEXTTORRENT_API_PUBLIC_KEY",
] as const;

function targetKind(value: string | undefined) {
  if (!value?.trim()) return "unset";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "invalid";
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ? "loopback_unverified"
      : "remote_unclassified_do_not_contact";
  } catch {
    return "invalid";
  }
}

export function inspectS00Environment(env: Environment) {
  const presence = Object.fromEntries(
    keys.map((key) => [
      key,
      env[key]?.trim()
        ? "present_not_validated"
        : key in env
          ? "empty"
          : "absent",
    ]),
  );
  let googleOAuth: { state: string; entries?: number } = { state: "absent" };
  const raw = env.GOOGLE_OAUTH_ORGANIZATIONS;
  if (raw?.trim()) {
    try {
      const value: unknown = JSON.parse(raw);
      googleOAuth = Array.isArray(value)
        ? {
            state: value.length ? "present_not_validated" : "empty_list",
            entries: value.length,
          }
        : { state: "invalid_shape" };
    } catch {
      googleOAuth = { state: "invalid_json" };
    }
  }
  const providerCredentialsPresent = {
    composio: !!env.COMPOSIO_API_KEY?.trim(),
    instantly: !!env.INSTANTLY_API_KEY?.trim(),
    texttorrent: !!(
      env.TEXTTORRENT_API_SID?.trim() && env.TEXTTORRENT_API_PUBLIC_KEY?.trim()
    ),
  };
  return {
    mode: "offline_inventory_only",
    networkCalls: 0,
    presence,
    targets: {
      supabase: targetKind(env.NEXT_PUBLIC_SUPABASE_URL),
      appOrigin: targetKind(env.APP_ORIGIN),
    },
    googleOAuth,
    providerCredentialsPresent,
    realApiReadiness: "unverified_requires_target_access_and_authorization",
  };
}
