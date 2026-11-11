// Record observed local evidence only; never opens env, private provider ledgers or network.
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { join } from "node:path";
import { format } from "prettier";
const dir = "docs/specs/pipeline-os/s02/quota-policy-reuse/";
const read = (p) => readFileSync(p, "utf8");
const json = (p) => JSON.parse(read(p).replace(/^\uFEFF/, ""));
const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const baseline = json(dir + "i04-implementation-baseline.json");
const allowed = new Set([
  "src/lib/server/mail-accounts/composio-existing-verifier.ts",
  "src/app/api/mail/accounts/[id]/composio/route.ts",
  "src/lib/server/mail-transport/contract.ts",
  "src/lib/server/mail-transport/selection.ts",
  "src/lib/server/mail-transport/runtime-context.ts",
  "src/lib/server/mail-transport/composio-proxy.ts",
]);
const sources = baseline.sources.map((s) => {
  const current = hash(s.path),
    changed = current !== s.sha256;
  assert.ok(
    !changed || allowed.has(s.path),
    "Unexpected source change: " + s.path,
  );
  return {
    path: s.path,
    baselineSha256: s.sha256,
    sha256: current,
    changed,
    editAuthorized: allowed.has(s.path),
    role: changed ? "I04_A_R_delta" : "preserved_dependency",
  };
});
const additions = [
  ".env.example",
  "src/lib/composio-bindings-v2.ts",
  "src/lib/server/mail-accounts/composio-binding-v2.ts",
  "src/lib/server/mail-transport/verification-context-v2.ts",
  "src/lib/server/mail-transport/resolved-binding.ts",
  "src/app/api/mail/accounts/[id]/composio/check/route.ts",
  "src/components/composio-account-bindings-v2.tsx",
  "src/components/integrations.tsx",
  "src/lib/domain.ts",
  "src/lib/server/workspace.ts",
  "tests/pipeline-os-s02-quota-i04.test.ts",
  "tests/pipeline-os-s02-quota-i04-http.test.ts",
  "tests/pipeline-os-s02-quota-i04-ui.test.ts",
  "tests/pipeline-os-s02-quota-i04-db.test.ts",
  "tests/fixtures/quota-i04-ui.tsx",
  "scripts/pipeline-os/add-i04-runtime.mjs",
  "scripts/pipeline-os/preview-i04.mjs",
  "scripts/pipeline-os/record-i04.mjs",
  ...[
    "quota-i04.local.sql",
    "quota-i04.rollback.sql",
    "quota-i04.postflight.sql",
    "quota-i04-runtime.body.sql",
    "quota-i04-runtime.wrappers.sql",
  ].map((n) => dir + "migrations/" + n),
  ...[
    "i04-plan.md",
    "i04-implementation.md",
    "i04-verification.md",
    "tasks.md",
  ].map((n) => dir + n),
].map((path) => ({ path, sha256: hash(path) }));
const tap = (p) => {
  const s = read(p),
    fail = Number(s.match(/^# fail (\d+)\s*$/m)?.[1]),
    passed = Number(s.match(/^# pass (\d+)\s*$/m)?.[1]);
  assert.equal(fail, 0, p);
  assert.ok(passed > 0, p);
  return { path: p, passed, failed: fail, sha256: hash(p) };
};
const root = ".local/pipeline-os/qgr-i04";
const run = readdirSync(root + "/runs")
  .map((n) => join(root, "runs", n))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const native = json(join(run, "result.json"));
assert.equal(native.failed, 0);
assert.equal(native.clusterStopped, true);
assert.equal(native.providerCalls, 0);
assert.match(
  read("src/lib/server/mail-transport/runtime-context.ts"),
  /export const composioProductOperationEnabled = false;/,
);
const image = root + "/visual/confirmed-1280.png";
assert.ok(existsSync(image));
const result = {
  ...baseline,
  protocol: "QGR-I04-IMPL-r1",
  mode: "implemented_and_verified_offline",
  implementationAuthorized: true,
  plan: "i04-plan.md",
  implementation: "i04-implementation.md",
  verification: "i04-verification.md",
  sources,
  artifacts: additions,
  extraBaseline: json(dir + "i04-extra-baseline.json"),
  tests: {
    regression: tap(root + "/regression.tap"),
    ui: tap(root + "/ui.tap"),
    native: tap(root + "/native.tap"),
    nativeRun: run,
    nativeResult: native,
    typecheck: "tsc --noEmit: exit 0",
    format: "Prettier --check: exit 0",
  },
  visual: {
    source:
      "standalone_loopback_fixture_with_synthetic_fetch_and_CSP_connect_src_none",
    contentWidths: [360, 768, 1280],
    horizontalOverflow: false,
    keyboard: true,
    busy: true,
    errorFocus: true,
    dirtyDraftProtection: true,
    languages: ["es", "en"],
    screenshot: image,
    screenshotSha256: hash(image),
    providerCalls: 0,
    serverStopped: true,
  },
  tasks: {
    A1: "done_offline",
    A2: "done_offline",
    A3: "done_offline",
    A4: "done_offline",
    R1: "done_offline",
    R2: "done_offline",
    B: "deferred",
    I05: "pending",
  },
  proposedNewPaths: undefined,
  migrationOrdinal: null,
  publicationReady: false,
  limitations: [
    "real_tokeninfo_compatibility_unproven",
    "private_configuration_and_included_quota_not_rechecked",
    "production_build_and_deployment_not_executed",
    "new_account_Connect_I04_B_deferred",
  ],
};
writeFileSync(
  dir + "i04-manifest.json",
  await format(JSON.stringify(result), { parser: "json" }),
);
process.stdout.write(
  JSON.stringify({
    protocol: result.protocol,
    tests:
      result.tests.regression.passed +
      result.tests.ui.passed +
      result.tests.native.passed,
    preservedSources: sources.filter((s) => !s.changed).length,
    changedBaseSources: sources.filter((s) => s.changed).length,
    providerCalls: 0,
    publicationReady: false,
  }) + "\n",
);
