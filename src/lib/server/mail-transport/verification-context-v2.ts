import { createHash } from "node:crypto";
import { z } from "zod";
import { mailQuotaPolicySchema } from "../../mail-quota-policy";

// Shared inert contract: no administration, verifier, credential reader or IO.
const reference = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]+$/);
export const verificationContextV2Schema = z.strictObject({
  contract_version: z.literal(2),
  composio_project_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  credential_version: reference,
  auth_config_revision: reference,
  provenance_reference: reference,
  project_provenance: z.literal("server_reviewed"),
  policy: mailQuotaPolicySchema,
});
export type VerificationContextV2 = z.infer<typeof verificationContextV2Schema>;
export function verificationContextV2Hash(input: unknown): string | null {
  const p = verificationContextV2Schema.safeParse(input);
  return p.success
    ? createHash("sha256")
        .update("QGR-C2-v2\0" + JSON.stringify(p.data))
        .digest("hex")
    : null;
}
