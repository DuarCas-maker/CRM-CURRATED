import { randomBytes } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { connectProviderConfigSchema } from "../src/lib/server/mail-accounts/composio-connect/config";
import { mailQuotaPolicySchema } from "../src/lib/mail-quota-policy";

const inputSchema = z.strictObject({
  origin: z.literal("https://crm.finlabinc.com"),
  expectedGeneration: z.number().int().min(0).max(9007199254740990),
  projectId: z.string(),
  authConfigId: z.string(),
  credentialVersion: z.string().min(1).max(128),
  authConfigRevision: z.string().min(1).max(128),
  provenanceReference: z.string().min(1).max(128),
  policy: mailQuotaPolicySchema,
  organizations: z.array(z.string().min(1).max(100)).min(1).max(100),
  sessionOverlay: z.strictObject({
    maxAgeSeconds: z.number().int().min(0).max(2147483647),
    inactivitySeconds: z.number().int().min(0).max(2147483647),
  }),
});

// Pure preparation. No environment, credential source, SQL, provider or deployment transport.
export function prepareConnectOnboardingSettings(value: unknown) {
  const input = inputSchema.parse(value);
  if (new Set(input.organizations).size !== input.organizations.length)
    throw Error("CONNECT_SETUP_DUPLICATE_ORGANIZATION");
  const descriptor = connectProviderConfigSchema.parse({
    enabled: true,
    config: {
      generation: input.expectedGeneration + 1,
      project_id: input.projectId,
      auth_config_id: input.authConfigId,
      quota_project_id: null,
      owner_id: "crm-connect-template",
      callback_mode: "standard",
    },
    context: {
      contract_version: 2,
      composio_project_id: input.projectId,
      credential_version: input.credentialVersion,
      auth_config_revision: input.authConfigRevision,
      provenance_reference: input.provenanceReference,
      project_provenance: "server_reviewed",
      policy: input.policy,
    },
    callback_origin: input.origin,
  });
  return {
    settings: {
      descriptor,
      organizations: input.organizations.map((id) => ({ id, label: id })),
    },
    publication: {
      rpc: "composio_connect_v2_publish",
      arguments: {
        descriptor,
        max_age_seconds: input.sessionOverlay.maxAgeSeconds,
        inactivity_seconds: input.sessionOverlay.inactivitySeconds,
        expected_generation: input.expectedGeneration,
      },
    },
    secretReference: {
      variable: "COMPOSIO_API_KEY",
      expectedVersion: input.credentialVersion,
      read: false,
      copied: false,
    },
    flagChanges: { COMPOSIO_CONNECT_ENABLED: "true" },
    preserve: [
      "MAIL_QUOTA_POLICY_ENABLED",
      "MAIL_TRANSPORT_ROUTING_ENABLED",
      "COMPOSIO_BINDING_CHECKS_ENABLED",
      "COMPOSIO_MAIL_OPERATION_ENABLED",
      "WORKER_EXECUTION_MODE",
    ],
    executionAuthorized: false,
    realConsentCompleted: false,
  };
}

function localPath(value: string) {
  const target = path.resolve(value),
    local = path.resolve(".local");
  const relative = path.relative(local, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("CONNECT_SETUP_PRIVATE_PATH_REQUIRED");
  mkdirSync(local, { recursive: true });
  let parent = target;
  while (!existsSync(parent)) parent = path.dirname(parent);
  const resolved = path.relative(realpathSync(local), realpathSync(parent));
  if (resolved.startsWith("..") || path.isAbsolute(resolved))
    throw Error("CONNECT_SETUP_PRIVATE_PATH_REQUIRED");
  return target;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 5 || process.argv[2] !== "--prepare-private")
      throw Error("CONNECT_SETUP_PREPARE_ONLY");
    const input = JSON.parse(readFileSync(localPath(process.argv[3]), "utf8"));
    const prepared = prepareConnectOnboardingSettings(input);
    const output = localPath(process.argv[4]);
    const activeKeyId = "connect-v2-r1";
    const keyring = {
      activeKeyId,
      keys: { [activeKeyId]: randomBytes(32).toString("base64url") },
    };
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(
      output,
      JSON.stringify({ ...prepared, keyring }, null, 2) + "\n",
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    console.log(
      JSON.stringify({
        prepared: true,
        generation: prepared.settings.descriptor.config.generation,
        organizations: prepared.settings.organizations.length,
        secretValuesPrinted: false,
        apiKeyRead: false,
        remoteRequests: 0,
        executionAuthorized: false,
      }),
    );
  } catch {
    console.error(
      "CONNECT_SETUP_CLOSED: preparation failed; no remote action was attempted",
    );
    process.exitCode = 1;
  }
}
