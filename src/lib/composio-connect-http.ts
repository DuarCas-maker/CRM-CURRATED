import { z } from "zod";
import { connectErrorCodes, connectStates } from "./composio-connect";
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  digest = z.string().regex(/^[a-f0-9]{64}$/);
export const connectBeginHttp = z
  .strictObject({
    mode: z.enum(["new", "existing", "reconnect"]),
    idempotency_key: z.uuid(),
    brand_id: z.uuid(),
    expected_brand_revision: revision.min(1),
    email: z.email().max(254).optional(),
    organization: z.string().min(1).max(100).optional(),
    account_id: z.uuid().optional(),
    expected_account_revision: revision,
    expected_head_revision: revision,
    expected_config_generation: revision.min(1),
  })
  .superRefine((v, c) => {
    if (
      v.mode === "new"
        ? !v.email ||
          v.email !== v.email.toLowerCase().trim() ||
          !v.organization ||
          v.account_id !== undefined ||
          v.expected_account_revision !== 0 ||
          v.expected_head_revision !== 0
        : v.account_id === undefined ||
          v.email !== undefined ||
          v.organization !== undefined
    )
      c.addIssue({ code: "custom", message: "Invalid account intent" });
  });
export const connectCommandHttp = z.strictObject({
  expected_revision: revision,
  idempotency_key: z.uuid(),
});
export const connectAdoptHttp = z.strictObject({ idempotency_key: z.uuid() });
export const connectPendingReview = z.strictObject({
  review_id: z.uuid(),
  expected_revision: revision,
  context_hash: digest,
});
export const connectStatusHttp = z.strictObject({
  id: z.uuid(),
  revision,
  state: z.enum(connectStates),
  deadline_ms: revision,
  expected_mailbox_email: z.email().max(254),
  account_id: z.uuid(),
  brand_id: z.uuid(),
  binding_id: z.uuid().nullable(),
  cleanup_required: z.boolean(),
  composio_enabled: z.literal(false),
  next: z.enum([
    "authorize",
    "resume",
    "review_brand",
    "register_candidate",
    "reconcile",
    "wait",
    "none",
  ]),
  expired: z.boolean(),
});
export const connectViewHttp = z.strictObject({
  status: connectStatusHttp.nullable(),
  pending: connectPendingReview.nullable(),
  context_changed: z.boolean(),
});
export const connectOptionsHttp = z.strictObject({
  enabled: z.boolean(),
  generation: revision,
  organizations: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        label: z.string().min(1).max(120),
      }),
    )
    .max(100),
  brands: z
    .array(
      z.strictObject({ id: z.uuid(), name: z.string().max(120), revision }),
    )
    .max(100),
  next_cursor: z.string().max(100).nullable(),
  account: z
    .strictObject({
      id: z.uuid(),
      email: z.email(),
      account_revision: revision,
      head_revision: revision,
    })
    .nullable(),
});
export type ConnectHttpView = z.infer<typeof connectViewHttp>;
export type ConnectHttpOptions = z.infer<typeof connectOptionsHttp>;
export const connectRecoveryItemsHttp = z.strictObject({
  items: z
    .array(
      z.strictObject({
        source_id: z.uuid(),
        source_revision: revision,
        email: z.email(),
        created_at: z.string(),
        state: z.enum(["available", "verifying", "failed", "completed"]),
        child_id: z.uuid().nullable(),
      }),
    )
    .max(20),
});
export function connectReturnAttempt(search: URLSearchParams) {
  const id = search.get("composio_connect");
  return search.getAll("composio_connect").length === 1 &&
    z.uuid().safeParse(id).success
    ? id
    : null;
}

// Display-only hint: never authorizes a state transition or a provider request.
export function connectReturnError(search: URLSearchParams) {
  if (
    !connectReturnAttempt(search) ||
    search.getAll("connect_error").length !== 1
  )
    return null;
  const code = z.enum(connectErrorCodes).safeParse(search.get("connect_error"));
  return code.success &&
    code.data !== "CONNECT_FORBIDDEN" &&
    code.data !== "CONNECT_INVALID_INPUT"
    ? code.data
    : null;
}
export type ConnectReturnError = ReturnType<typeof connectReturnError>;

// A reference only: reading its state still requires the original session and server cookie.
export function connectAttemptHref(current: string, attempt: string | null) {
  const url = new URL(current, "https://crm.invalid");
  if (attempt === null) url.searchParams.delete("composio_connect");
  else url.searchParams.set("composio_connect", z.uuid().parse(attempt));
  url.searchParams.delete("connect_error");
  return url.pathname + url.search + url.hash;
}
