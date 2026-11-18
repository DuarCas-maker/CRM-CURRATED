import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Local packaging only. Never loads credentials or calls a remote service.
const feature =
  "docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/";
const root = feature + "preflight/";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const write = (p, value) =>
  fs.writeFileSync(root + p, JSON.stringify(value, null, 2) + "\n");
const hash = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const promotion = read(root + "promotion-base.json");
if (
  git("rev-parse", "HEAD") !== promotion.baseCommit ||
  git("branch", "--show-current") !== promotion.branch
)
  throw Error("PROMOTION_BASE_DRIFT");
for (const f of promotion.copiedPublicFiles)
  if (hash(f.path) !== f.sha256)
    throw Error("PROMOTION_SOURCE_CHANGED: " + f.path);
const contract = read(root + "contract-comparison.json");
if (
  contract.checked !== 16 ||
  contract.failures.length ||
  !contract.candidateGuard.expected_match
)
  throw Error("CATALOG_CONTRACT_DRIFT");
const checks = read(feature + "local-checks.json");
for (const name of ["types", "typecheck", "build-webpack"])
  if (checks.checks.find((c) => c.check === name)?.exit !== 0)
    throw Error("COMPILE_GATE_FAILED");
for (const [file, count] of [
  ["core-tests.txt", 42],
  ["native-tests.txt", 14],
]) {
  const body = fs.readFileSync(feature + file, "utf8");
  if (!body.includes("# pass " + count) || !body.includes("# fail 0"))
    throw Error("LOCAL_TEST_GATE_FAILED: " + file);
}
const noSecrets = {
  secretValuesCaptured: false,
  environmentFilesCopied: false,
  configurationChanged: false,
};
write("runtime-observation.json", {
  recordedAt: new Date().toISOString(),
  method:
    "Visible Coolify terminal; selected allowlisted metadata from running processes; no complete env dumps",
  sourceCommit: promotion.baseCommit,
  web: {
    resource: "rv8rpfxhf0mbxprge6h6ki9c",
    container: "rv8rpfxhf0mbxprge6h6ki9c-20261118T032456",
    node: "22.23.5",
    origin: "https://crm.finlabinc.com",
    flags: {
      SIMPLE_MAIL_ENABLED: null,
      SIMPLE_MAIL_ORGANIZATION: null,
      GMAIL_HISTORY_ENABLED: "true",
      GMAIL_SYNC_MODE: "polling",
      MAIL_TRANSPORT_ROUTING_ENABLED: "false",
      MAIL_QUOTA_POLICY_ENABLED: "false",
      COMPOSIO_CONNECT_ENABLED: "true",
      COMPOSIO_BINDING_V2_ENABLED: "true",
      COMPOSIO_BINDING_CHECKS_ENABLED: "false",
      COMPOSIO_VERIFIER_SETUP_ENABLED: "true",
    },
    composio: {
      apiKeyPresent: true,
      contextPresent: true,
      contextVersion: 2,
      connectKeyringPresent: true,
      project: "pr_y-80FotblnGt",
      authConfig: "ac_0c4QEKnwPtOd",
      generation: 1,
    },
    encryptionKeyPresent: true,
  },
  worker: {
    resource: "vc4aybj4ucje7zstpsp3zboh",
    container: "vc4aybj4ucje7zstpsp3zboh-20261118T032340",
    origin: "https://crm.finlabinc.com",
    flags: {
      SIMPLE_MAIL_ENABLED: null,
      SIMPLE_MAIL_ORGANIZATION: null,
      GMAIL_HISTORY_ENABLED: "true",
      GMAIL_SYNC_MODE: "polling",
      WORKER_EXECUTION_MODE: "normal",
      MAIL_TRANSPORT_ROUTING_ENABLED: null,
      MAIL_QUOTA_POLICY_ENABLED: null,
      COMPOSIO_CONNECT_ENABLED: null,
      COMPOSIO_BINDING_V2_ENABLED: null,
      COMPOSIO_BINDING_CHECKS_ENABLED: null,
      COMPOSIO_VERIFIER_SETUP_ENABLED: null,
    },
    composio: {
      apiKeyPresent: false,
      contextPresent: false,
      connectKeyringPresent: false,
    },
    google: {
      organization: "curated",
      domain: "curatedfinancial.com",
      clientIdSha256:
        "3d080f6c798dc0651fad2cfa51fcaa981ec4b3250e131ae50a1caa2396cd4e60",
      secretPresent: true,
    },
    encryptionKeyPresent: true,
  },
  limitations: [
    "Coolify showed a pre-existing unsaved-changes notice; no Save or Reset used",
    "Initial long terminal probes failed parsing before requests; successful probes were short allowlisted reads",
    "Inspection shell exited; no application process was stopped",
  ],
  ...noSecrets,
});
const directClient =
  "12677035404-590sclhh4graph847arkqsn15mmui1tg.apps.googleusercontent.com";
if (
  createHash("sha256").update(directClient).digest("hex") !==
  "3d080f6c798dc0651fad2cfa51fcaa981ec4b3250e131ae50a1caa2396cd4e60"
)
  throw Error("WORKER_GOOGLE_CLIENT_MISMATCH");
write("oauth-observation.json", {
  recordedAt: new Date().toISOString(),
  project: {
    name: "Curated CRM Gmail",
    id: "curated-crm-gmail",
    number: "12677035404",
    organization: "curatedfinancial.com",
    audience: "Internal",
    gmailApiEnabled: true,
  },
  direct: {
    name: "Curated CRM Production",
    clientId: directClient,
    redirect: "https://crm.finlabinc.com/api/gmail/callback",
    matchesWebRuntime: true,
    matchesWorkerRuntimeHash: true,
  },
  composio: {
    name: "Curated CRM Composio",
    clientId:
      "12677035404-od8d1btd1r7eij9c4apv0r0pv40hqap6.apps.googleusercontent.com",
    redirect: "https://backend.composio.dev/api/v1/auth-apps/add",
    project: "pr_y-80FotblnGt",
    authConfig: "ac_0c4QEKnwPtOd",
    scheme: "OAUTH2",
    toolkit: "gmail",
    customAuthConfigEnabled: true,
    matchesAuthConfigClient: true,
    declaredScopes: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ],
  },
  dataAccessScopeRows: 0,
  dataAccessInterpretation:
    "Internal Workspace app; empty consent-screen scope listing alone is not a blocker. Effective grants must still be verified for each mailbox.",
  effectiveMailboxScopesVerified: false,
  consentsPerformed: 0,
  tokenExchangesPerformed: 0,
  sources: [
    "https://console.cloud.google.com/apis/dashboard?project=curated-crm-gmail",
    "https://console.cloud.google.com/auth/audience?project=curated-crm-gmail",
    "https://developers.google.com/workspace/guides/configure-oauth-consent",
    "https://developers.google.com/workspace/gmail/api/auth/scopes",
  ],
  ...noSecrets,
});
write("composio-usage-observation.json", {
  recordedAt: new Date().toISOString(),
  workspace: "santino_workspace",
  project: "pr_y-80FotblnGt",
  authConfig: "ac_0c4QEKnwPtOd",
  plan: "Hobby",
  priceUsdMonthly: 0,
  billingPage: {
    toolCallsMonthly: 100000,
    triggerEventsMonthly: 50000,
    connectedAccounts: "unlimited",
    instantCreditsUsd: 2,
    instantCreditsIncludedInMailBudget: false,
  },
  usagePage: {
    range: "Month to date",
    month: "2026-11",
    toolCalls: 3,
    managedAppCallsRounded: "33.18K",
    proxyRemainingShown: false,
  },
  usageApi: {
    method: "POST",
    path: "/api/v3.1/project/usage/summary",
    httpStatus: 200,
    from: 1793491200000,
    to: 1794973578587,
    entities: {
      tool_calls: { unit: "count", total_quantity: "3", event_count: 3 },
    },
    proxyCounterReturned: false,
  },
  publishedPricing: {
    toolCallsMonthly: 100000,
    managedAppCallsSubsetMonthly: 20000,
    proxyMonthly: 1000,
    appliesToThisProjectVerified: false,
    source: "https://composio.dev/pricing/platform",
  },
  decision: {
    remainingCalls: null,
    remainingProxy: null,
    hardCapFreeVerified: false,
    seedIncludedBudget: false,
    reason:
      "No exact applicable proxy meter/remaining period; managed-app UI and base tool-call aggregation cannot be substituted for it. Legacy/grandfathered applicability not established.",
  },
  apiReads: {
    administrative: 2,
    authConfigGet: 1,
    usageSummaryPost: 1,
    toolsExecute: 0,
    proxyExecute: 0,
    mailboxReads: 0,
    emailSends: 0,
    purchases: 0,
  },
  limitations: [
    "UI counters are rounded and different meters",
    "No org key created, no plan changed, no paid credits used",
    "Do not infer 99997 calls or 997 proxy units from this observation",
  ],
  ...noSecrets,
});
fs.copyFileSync(
  feature + "simple-mail.local.sql",
  root + "058_simple_mail_connections.sql",
);
fs.copyFileSync(
  feature + "simple-mail.rollback.sql",
  root + "058_simple_mail_connections.rollback.sql",
);
const manifest = {
  recordedAt: new Date().toISOString(),
  feature: "simple-mail-20261117",
  level: "STRICT",
  mode: "production-preflight-read-only",
  branch: promotion.branch,
  baseCommit: promotion.baseCommit,
  originalImplementationBase: promotion.originalImplementationBase,
  files: promotion.copiedPublicFiles.map((f) => ({
    path: f.path,
    bytes: fs.statSync(f.path).size,
    sha256: hash(f.path),
  })),
  migration: {
    proposedOrdinal: "058",
    ordinalReserved: false,
    registeredInMigrationsDirectory: false,
    sql: root + "058_simple_mail_connections.sql",
    sha256: hash(root + "058_simple_mail_connections.sql"),
    rollback: root + "058_simple_mail_connections.rollback.sql",
    rollbackSha256: hash(root + "058_simple_mail_connections.rollback.sql"),
    remoteApplied: false,
  },
  catalog: {
    capture: root + "catalog.json",
    selected: root + "selected-metadata.json",
    comparison: root + "contract-comparison.json",
    contractsCompared: 16,
    failures: 0,
    guardMd5: contract.candidateGuard.source_md5,
    brandCode: "CURATED_FINANCIAL",
    brandId: "a7563a6a-fc36-4888-a0af-76a12fea33c9",
  },
  checks: {
    core: { passed: 42, failed: 0 },
    native: { passed: 14, failed: 0, postgres: "15.19", clusterStopped: true },
    regression: {
      files: checks.files,
      passed: 536,
      failed: 1,
      skipped: 6,
      failure:
        "tests/gmail-attachments.test.ts:235; expected 3 actual 4; reproduced on unchanged baseline 9d28d5a",
    },
    compile: checks.checks.filter((c) => c.check !== "regression"),
  },
  gates: {
    oauthConfiguration: true,
    selectedCatalogContracts: true,
    mainReconciled: true,
    localFeatureTests: true,
    broadRegressionAllGreen: false,
    composioFreeProxyBudgetVerified: false,
    freshReleaseBackup: false,
    productionPublicationAuthorizedThisTurn: false,
  },
  readyToPublishCompleteScope: false,
  remoteChanges: 0,
  committed: false,
  pushed: false,
  deployed: false,
  releasePrerequisites: [
    "Resolve or explicitly disposition the inherited attachment regression without hiding it",
    "Prove all applicable global Composio free meters/period and enforceable no-charge cap before seeding included budget; otherwise Composio remains unavailable",
    "Recheck main/catalog/ordinal, obtain verified point-in-time backup and concrete production authorization",
    "Provision existing Composio runtime secret/context to worker securely; coordinate web/worker flags after compatible SQL",
  ],
  localCorrection:
    "Existing production brand code CURATED_FINANCIAL reused; no brand created or renamed",
  rollback:
    "Disable feature; preserve receipts and used additive schema. SQL reverse rejects used installations.",
};
manifest.evidence = [
  "preflight/release-plan.md",
  "preflight/promotion-base.json",
  "preflight/catalog.sql",
  "preflight/catalog.json",
  "preflight/selected-metadata.sql",
  "preflight/selected-metadata.json",
  "preflight/contract-comparison.json",
  "preflight/runtime-observation.json",
  "preflight/oauth-observation.json",
  "preflight/composio-usage-observation.json",
  "preflight/package-promotion.mjs",
  "preflight/compare-contract.mjs",
  "local-checks.json",
  "core-tests.txt",
  "native-tests.txt",
  "regression.txt",
  "types.txt",
  "typecheck.txt",
  "build-webpack.txt",
  "baseline-attachments.txt",
].map((relative) => ({
  path: feature + relative,
  bytes: fs.statSync(feature + relative).size,
  sha256: hash(feature + relative),
}));
write("promotion-manifest.json", manifest);
console.log(
  JSON.stringify({
    files: manifest.files.length,
    contracts: 16,
    core: 42,
    native: 14,
    remoteChanges: 0,
    readyToPublishCompleteScope: false,
  }),
);
