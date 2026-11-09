import { z } from "zod";
import { ConnectError, connectConfigSchema } from "../../../composio-connect";
import { verificationContextSchema } from "../composio-verifier";

const httpsOrigin = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        u.origin === value &&
        !u.username &&
        !u.password
      );
    } catch {
      return false;
    }
  });

// Server-reviewed descriptor, never a browser assertion or proof of a live project setting.
export const connectProviderConfigSchema = z
  .strictObject({
    enabled: z.literal(true),
    config: connectConfigSchema,
    context: verificationContextSchema,
    callback_origin: httpsOrigin,
  })
  .superRefine((value, ctx) => {
    if (
      value.config.project_id !== value.context.composio_project_id ||
      value.config.quota_project_id !== value.context.google_quota_project_id
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent server descriptor",
      });
  });
export type ConnectProviderConfiguration = z.infer<
  typeof connectProviderConfigSchema
>;

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export function validateConnectProviderConfiguration(
  descriptor: unknown,
  expected: unknown,
): ConnectProviderConfiguration {
  const current = connectProviderConfigSchema.safeParse(descriptor);
  const snapshot = connectProviderConfigSchema.safeParse(expected);
  if (!current.success || !snapshot.success)
    throw new ConnectError("CONNECT_UNAVAILABLE", { beforeEmission: true });
  // Zod constructs a new object in schema order. Compare every descriptor field, including generation/version.
  if (JSON.stringify(current.data) !== JSON.stringify(snapshot.data))
    throw new ConnectError("CONNECT_STALE", { beforeEmission: true });
  return freeze(current.data);
}
