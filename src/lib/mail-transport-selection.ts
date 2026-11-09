import { z } from "zod";

export const transportRevision = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
export const transportProvider = z.enum(["gmail_oauth", "composio"]);
export const transportOperation = z.enum([
  "profile",
  "history",
  "messages",
  "message",
  "thread",
  "attachment",
  "signature",
  "send",
  "watch",
  "stop",
]);
export const transportRequest = z
  .strictObject({
    account_id: z.uuid(),
    expected_revision: transportRevision,
    operation: transportOperation,
    resource: z.string().min(1).max(2300),
  })
  .superRefine((p, c) => {
    const good =
      p.operation === "send"
        ? z.uuid().safeParse(p.resource).success
        : p.operation === "message" || p.operation === "thread"
          ? /^[a-f0-9]{1,128}$/i.test(p.resource)
          : p.operation === "attachment"
            ? /^[a-f0-9]{1,128}:[A-Za-z0-9_-]{1,2048}$/i.test(p.resource)
            : p.operation === "signature"
              ? z.email().max(254).safeParse(p.resource).success
              : p.resource === p.operation;
    if (!good) c.addIssue({ code: "custom", message: "Invalid resource" });
  });
export type TransportRequest = z.infer<typeof transportRequest>;
export const transportPage = z.strictObject({
  account_id: z.uuid(),
  provider: transportProvider,
  state: z.enum(["paused", "draining", "ready"]),
  revision: transportRevision,
  target_provider: transportProvider.nullable(),
  binding_id: z.uuid().nullable(),
});
export const transportCommand = z.strictObject({
  kind: z.enum([
    "bootstrap_direct",
    "prepare_transition",
    "pause",
    "commit_transition",
    "cancel_transition",
  ]),
  payload: z.strictObject({
    expected_revision: transportRevision,
    target_provider: transportProvider,
    expected_head_revision: transportRevision,
    expected_account_revision: transportRevision,
    expected_brand_revision: transportRevision,
    expected_config_generation: transportRevision,
    expected_context_hash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  idempotency_key: z.uuid(),
});
export type TransportPage = z.infer<typeof transportPage>;
export type TransportCommand = z.infer<typeof transportCommand>;
export const transportReview = z.strictObject({
  selection: transportPage.nullable(),
  expected: transportCommand.shape.payload.omit({ target_provider: true }),
  receive_enabled: z.boolean(),
  unresolved: z.boolean(),
  current: z.boolean(),
  eligible_direct: z.boolean(),
  binding_verified: z.boolean(),
  composio_enabled: z.boolean(),
});
export type TransportReview = z.infer<typeof transportReview>;
