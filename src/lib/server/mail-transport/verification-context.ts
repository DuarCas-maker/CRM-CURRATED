import { createHash } from "node:crypto";
import { z } from "zod";
// Shared configuration contract only: no verifier, administration, DB or provider.
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const text = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const verificationContextSchema = z.strictObject({
  composio_project_id: id,
  credential_version: text,
  google_quota_project_id: id,
  auth_config_revision: text,
  provenance_reference: text,
  project_provenance: z.literal("server_reviewed"),
  quota_provenance: z.literal("oauth_client_reviewed"),
});
export type VerificationContext = z.infer<typeof verificationContextSchema>;
export function verificationContextHash(input: unknown): string | null {
  const parsed = verificationContextSchema.safeParse(input);
  if (!parsed.success) return null;
  const c = parsed.data;
  return createHash("sha256")
    .update(
      JSON.stringify([
        c.composio_project_id,
        c.credential_version,
        c.google_quota_project_id,
        c.auth_config_revision,
        c.provenance_reference,
        c.project_provenance,
        c.quota_provenance,
      ]),
    )
    .digest("hex");
}
