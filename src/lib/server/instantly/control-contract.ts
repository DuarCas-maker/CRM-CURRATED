import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { cReceiverManifestSchema, validateCManifest } from "./receiver";

export const controlHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const controlBudgets = {
  instantly: {
    base: 43,
    normal: 14,
    reserve: 3,
    emergency: 2,
    maxNew: 19,
    maxTotal: 62,
  },
  control: { base: 0, normal: 19, reserve: 4, emergency: 2, maxNew: 25 },
  maxNewClientApiRequests: 44,
  maxAdditionalGrantAuthBackendRequests: 4,
  callback: {
    windowMs: 120000,
    maxAdmissions: 16,
    maxStoredReceipts: 16,
    incomingHttpLimitGuaranteed: false,
    maxDbHttpPerDelivery: 4,
  },
} as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const nonceSchema = z.string().regex(/^[a-f0-9]{24}$/);
export const cappManifestSchema = z
  .object({
    draftVersion: z.literal(1),
    protocol: z.literal("S00_INSTANTLY_C_APP_V1"),
    draft: z.literal(false),
    executionReady: z.literal(true),
    origin: z.string().url(),
    source: z
      .object({
        version: z.literal(7),
        calls: z.literal(43),
        canonicalHash: digest,
        scopeHash: digest,
        bManifestHash: digest,
        configurationFingerprint: digest,
        workspaceId: z.string().uuid(),
        campaignId: z.string().uuid(),
      })
      .strict(),
    receiverManifest: cReceiverManifestSchema,
    control: z
      .object({
        authorizationMode: z.literal("superadmin_mfa_opaque_lease"),
        leaseId: z.null(),
        ticketFile: z.null(),
        issuedAt: z.null(),
        expiresAt: z.null(),
        maxLeaseMs: z.literal(600000),
        scopes: z.tuple([
          z.literal("prepare"),
          z.literal("arm"),
          z.literal("observe"),
          z.literal("close"),
          z.literal("revoke"),
        ]),
        maxObservationRequests: z.literal(12),
        minimumPollMs: z.literal(10000),
      })
      .strict(),
    budgets: z.custom<typeof controlBudgets>((value) =>
      isDeepStrictEqual(value, controlBudgets),
    ),
    gates: z
      .object({
        implementationVerified: z.literal(true),
        migrationAndDeploymentVerified: z.literal(true),
        manifestReviewed: z.literal(true),
        apiAndWebhooksIncludedConfirmed: z.literal(true),
        logsRedactedVerified: z.literal(true),
        providerExecutionAuthorized: z.literal(true),
        controlExecutionAuthorized: z.literal(true),
        webhookActivationAuthorized: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type CAppManifest = z.infer<typeof cappManifestSchema>;
export function validateCAppManifest(input: unknown): CAppManifest {
  const m = cappManifestSchema.parse(input),
    r = validateCManifest(m.receiverManifest),
    u = new URL(m.origin);
  if (
    u.protocol !== "https:" ||
    u.origin !== m.origin ||
    r.url !== m.origin + "/api/integrations/instantly/webhook/" + r.nonce ||
    r.sourceHash !== m.source.canonicalHash
  )
    throw Error("CAPP_MANIFEST_BINDING");
  return m;
}
export const controlSnapshotSchema = z
  .object({
    nonce: nonceSchema,
    sourceHash: digest,
    manifestHash: digest,
    revision: z.number().int().nonnegative(),
    armed: z.boolean(),
    closed: z.boolean(),
    authenticated: z.boolean(),
    contextValidated: z.boolean(),
    conflict: z.boolean(),
    payloadDigest: digest.nullable(),
    receivedAt: z.number().int().nonnegative().nullable(),
    observations: z.number().int().min(0).max(16),
  })
  .strict()
  .refine(
    (s) =>
      (!s.closed || s.armed) &&
      (!s.contextValidated || s.authenticated) &&
      (!s.conflict || s.authenticated) &&
      (s.authenticated
        ? s.payloadDigest !== null &&
          s.receivedAt !== null &&
          s.observations > 0
        : s.payloadDigest === null &&
          s.receivedAt === null &&
          s.observations === 0),
  );
export type ControlSnapshot = z.infer<typeof controlSnapshotSchema>;
export const controlTicketSchema = z
  .object({
    leaseId: z.string().uuid(),
    intentId: z.string().uuid(),
    expiresAt: z.number().int().positive(),
    nonce: nonceSchema,
    sourceHash: digest,
    manifestHash: digest,
  })
  .strict();
export type ControlTicket = z.infer<typeof controlTicketSchema>;
