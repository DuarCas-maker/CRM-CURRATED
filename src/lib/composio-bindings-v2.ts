import { z } from "zod";
import {
  bindingPageSchema,
  bindingResultSchema,
  bindingRevokeReasons,
  parseBindingQuery,
} from "./composio-bindings";
const revision = z.number().int().nonnegative().safe();
export const expectedV2 = z.strictObject({
  expected_head_revision: revision,
  expected_account_revision: revision,
  expected_brand_revision: revision,
  expected_context_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
const reference = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const candidate = expectedV2.extend({
  composio_project_id: reference.refine((v) => !/^(ca_|ac_)/.test(v)),
  auth_config_id: z
    .string()
    .trim()
    .regex(/^ac_[A-Za-z0-9_-]{1,128}$/),
  connected_account_id: z
    .string()
    .trim()
    .regex(/^ca_[A-Za-z0-9_-]{1,128}$/),
  composio_user_id: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .regex(/^[^\s\x00-\x1f\x7f]+$/),
});
export const bindingCommandV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    contract_version: z.literal(2),
    kind: z.literal("register_candidate"),
    payload: candidate,
    idempotency_key: z.uuid(),
  }),
  z.strictObject({
    contract_version: z.literal(2),
    kind: z.literal("confirm_binding"),
    payload: expectedV2.extend({ binding_id: z.uuid(), check_id: z.uuid() }),
    idempotency_key: z.uuid(),
  }),
  z.strictObject({
    contract_version: z.literal(2),
    kind: z.literal("revoke_binding"),
    payload: expectedV2.extend({
      binding_id: z.uuid(),
      reason: z.enum(bindingRevokeReasons),
    }),
    idempotency_key: z.uuid(),
  }),
]);
export const checkCommandV2Schema = z.strictObject({
  contract_version: z.literal(2),
  binding_id: z.uuid(),
  expected: expectedV2,
  idempotency_key: z.uuid(),
});
export const checkResultV2Schema = z.strictObject({
  contract_version: z.literal(2),
  id: z.uuid(),
  status: z.enum(["prepared", "completed", "failed", "expired"]),
  replay: z.boolean(),
  valid_until: z.iso.datetime({ offset: true }).nullable(),
});
export const bindingPageV2Schema = bindingPageSchema.extend({
  contract_version: z.literal(2),
  policy: z
    .strictObject({
      id: z.uuid(),
      generation: revision.min(1),
      enabled: z.boolean(),
    })
    .nullable(),
  latest_check: checkResultV2Schema
    .omit({ contract_version: true, replay: true })
    .nullable(),
});
export const bindingResultV2Schema = bindingResultSchema.extend({
  contract_version: z.literal(2),
});
export type BindingPageV2 = z.infer<typeof bindingPageV2Schema>;
export type BindingCommandV2 = z.infer<typeof bindingCommandV2Schema>;
export function bindingV2Query(params: URLSearchParams) {
  if (
    params.getAll("contract_version").length !== 1 ||
    params.get("contract_version") !== "2"
  )
    return null;
  const rest = new URLSearchParams(params);
  rest.delete("contract_version");
  return parseBindingQuery(rest);
}
