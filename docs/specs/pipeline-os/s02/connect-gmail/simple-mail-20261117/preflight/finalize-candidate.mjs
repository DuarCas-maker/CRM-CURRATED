import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Offline packaging: preserve observations instead of regenerating their dates.
const feature =
  "docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/";
const root = feature + "preflight/";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
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
const catalog = read(root + "catalog.json");
const selected = read(root + "selected-metadata.json");
const quota = read(root + "composio-quota-review.json");
const priorQuota = read(root + "composio-usage-observation.json");
const runtime = read(root + "runtime-observation.json");
const checks = read(feature + "local-checks.json");
if (
  contract.checked !== 16 ||
  contract.failures.length ||
  !contract.candidateGuard.expected_match ||
  contract.productionCapture !== catalog.at
)
  throw Error("CATALOG_GATE_FAILED");
if (
  !catalog.readOnly ||
  catalog.remoteChanges !== 0 ||
  selected.read_only !== "on" ||
  selected.remoteChanges !== 0
)
  throw Error("READ_ONLY_GATE_FAILED");
if (
  !checks.externalFetchGuard ||
  checks.realCredentials ||
  checks.checks.some((c) => c.exit !== 0)
)
  throw Error("LOCAL_CHECKS_NOT_GREEN");
function tap(file) {
  const body = fs.readFileSync(feature + file, "utf8");
  const result = Object.fromEntries(
    ["tests", "pass", "fail", "skipped", "cancelled"].map((k) => [
      k,
      Number(
        body.match(new RegExp("^# " + k + " (\\d+)\\r?$", "m"))?.[1] ?? NaN,
      ),
    ]),
  );
  if (
    Object.values(result).some((v) => !Number.isFinite(v)) ||
    result.fail ||
    result.cancelled ||
    !result.pass
  )
    throw Error("TAP_NOT_GREEN: " + file);
  return result;
}
const regression = tap("regression.txt");
const attachments = tap("preflight/attachments-after.txt");
const native = tap("native-tests.txt");
const core = tap("core-tests.txt");
if (
  attachments.pass !== 6 ||
  native.pass !== 14 ||
  core.pass !== 42 ||
  quota.remainingProxy !== null ||
  quota.budgetSeeded
)
  throw Error("EXPECTED_EVIDENCE_CHANGED");
for (const [from, to] of [
  ["simple-mail.local.sql", "058_simple_mail_connections.sql"],
  ["simple-mail.rollback.sql", "058_simple_mail_connections.rollback.sql"],
]) {
  if (hash(feature + from) !== hash(root + to)) throw Error("SQL_COPY_DRIFT");
}
const evidence = [
  "preflight/closure.md",
  "preflight/bugfix-and-quota.md",
  "preflight/composio-support-request.md",
  "preflight/promotion-base.json",
  "preflight/catalog.json",
  "preflight/selected-metadata.json",
  "preflight/contract-comparison.json",
  "preflight/composio-quota-review.json",
  "preflight/composio-usage-observation.json",
  "preflight/runtime-observation.json",
  "preflight/oauth-observation.json",
  "preflight/attachments-before.txt",
  "preflight/attachments-diagnosis.txt",
  "preflight/attachments-after.txt",
  "preflight/finalize-candidate.mjs",
  "preflight/compare-contract.mjs",
  "core-tests.txt",
  "native-tests.txt",
  "regression.txt",
  "local-checks.json",
  "types.txt",
  "typecheck.txt",
  "build-webpack.txt",
].map((p) => ({
  path: feature + p,
  sha256: hash(feature + p),
  bytes: fs.statSync(feature + p).size,
}));
const manifest = {
  recordedAt: new Date().toISOString(),
  feature: "simple-mail-20261117",
  level: "STRICT",
  mode: "authorized-local-fix-and-read-only-production-preflight",
  branch: promotion.branch,
  baseCommit: promotion.baseCommit,
  priorPromotionBase: promotion.priorPromotionBase,
  originalImplementationBase: promotion.originalImplementationBase,
  files: promotion.copiedPublicFiles.map((f) => ({
    ...f,
    bytes: fs.statSync(f.path).size,
  })),
  evidence,
  codeChangesThisTurn: ["tests/gmail-attachments.test.ts"],
  applicationPermissionsChanged: false,
  dependenciesAdded: false,
  compatibility: {
    sharedOverlap: promotion.sharedOverlap,
    upstreamChangesReviewed: promotion.upstreamChangesReviewed,
    catalogAt: catalog.at,
    contractsCompared: contract.checked,
    contractFailures: contract.failures,
    functions: catalog.functions.length,
    relations: catalog.relations.length,
    columns: catalog.columns.length,
    guardMd5: contract.candidateGuard.source_md5,
  },
  checks: {
    regression: { ...regression, files: checks.files, at: checks.at },
    attachmentsAndCaseFlow: attachments,
    compile: checks.checks.filter((c) => c.check !== "regression"),
    core: {
      ...core,
      reusedFrom:
        "b861486; unchanged feature tests also covered by current full regression",
    },
    native: {
      ...native,
      postgres: "15.19",
      reusedFrom:
        "b861486; SQL/native fixture/harness unchanged across upstream delta",
      clusterStopped: true,
    },
  },
  oauth: {
    configurationVerified: true,
    effectiveMailboxScopesNotExercised: true,
    evidence: root + "oauth-observation.json",
  },
  runtime: {
    observedSourceCommit: runtime.sourceCommit,
    observationReused: true,
    workerSecretProvisioningPending: true,
    recheckAtRelease: true,
  },
  quota: {
    plan: quota.plan,
    publishedProxyMonthly: quota.publicProxyAllowanceMonthly,
    publicHardCapNoCharge: quota.publicHardCapNoCharge,
    observedProjectProxyRows: quota.logs.rows.length,
    observedRange: quota.logs.range,
    remainingCalls: null,
    remainingProxy: quota.remainingProxy,
    globalProxyBalanceVerified: false,
    billingPeriodVerified: quota.applicableBillingPeriodVerified,
    managedCallsRoundedFromPriorCapture:
      priorQuota.usagePage.managedAppCallsRounded,
    budgetSeeded: false,
    source: quota.pricingSource,
  },
  migration: {
    proposedOrdinal: "058",
    ordinalReserved: false,
    sql: root + "058_simple_mail_connections.sql",
    sha256: hash(root + "058_simple_mail_connections.sql"),
    rollback: root + "058_simple_mail_connections.rollback.sql",
    rollbackSha256: hash(root + "058_simple_mail_connections.rollback.sql"),
    remoteApplied: false,
  },
  gates: {
    attachmentFailureResolved: true,
    localRegressionGreen: true,
    selectedCatalogContracts: true,
    sourceMainReconciled: true,
    composioFreeBudgetVerified: false,
    freshReleaseBackup: false,
    productionPublicationAuthorizedThisTurn: false,
  },
  localCandidateReady: true,
  readyToPublishCompleteScope: false,
  outstanding: [
    "Provider evidence of applicable organization-wide proxy meter/remaining allowance and reset period; request drafted, not sent",
    "At publication: recheck moving main/runtime/catalog/ordinal, verify immediate backup, provision existing worker secrets securely and obtain concrete production authorization",
  ],
  externalOperations: {
    sqlMetadataRequestsThisTurn: 2,
    sqlWrites: 0,
    composioApiRequestsThisTurn: 0,
    composioToolOrProxyExecutions: 0,
    mailboxReads: 0,
    emailSends: 0,
    consents: 0,
    purchases: 0,
    configurationChanges: 0,
    commits: 0,
    pushes: 0,
    deployments: 0,
  },
  rollback:
    "No application/SQL permission change in this fix. Feature rollback closes flags and retains used additive schema/receipts; SQL reverse allowed only before use.",
};
fs.writeFileSync(
  root + "promotion-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    files: manifest.files.length,
    baseCommit: manifest.baseCommit,
    regression: manifest.checks.regression,
    attachments,
    contracts: 16,
    localCandidateReady: true,
    readyToPublishCompleteScope: false,
    remoteChanges: 0,
  }),
);
