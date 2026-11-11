// Seal observed preparation evidence. No env, provider, remote Git or database access.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { format } from "prettier";
const root = "docs/specs/pipeline-os/s02/release/quota-final/",
  local = ".local/pipeline-os/qgr-i05/";
const read = (p) => fs.readFileSync(p, "utf8"),
  json = (p) => JSON.parse(read(p));
const hash = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const valueHash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sources = json(root + "sources.json"),
  buildInputs = json(local + "build-inputs.json"),
  build = json(local + "build.json");
assert.equal(build.code, 0);
assert.equal(build.sourceTreeSha256, buildInputs.sourceTreeSha256);
const codeFiles = (files) =>
  files.filter(
    (f) =>
      /^(src|worker|public|tests|scripts)\//.test(f.path) ||
      /^(Dockerfile(?:\.worker)?|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.json|next\.config\.ts|\.dockerignore)$/.test(
        f.path,
      ),
  );
assert.deepEqual(
  codeFiles(sources.files),
  codeFiles(buildInputs.files),
  "Application changed since build",
);
for (const s of sources.files) assert.equal(hash(s.path), s.sha256, s.path);
const i04 = json(
  "docs/specs/pipeline-os/s02/quota-policy-reuse/i04-manifest.json",
);
for (const s of [...i04.sources, ...i04.artifacts])
  assert.equal(hash(s.path), s.sha256, s.path);
const runs = fs
  .readdirSync(local + "runs")
  .map((p) => path.join(local, "runs", p))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const nativePath = path.join(runs[0], "result.json"),
  native = json(nativePath),
  tap = read(local + "native.tap");
assert.equal(native.failed, 0);
assert.equal(native.clusterStopped, true);
assert.equal(native.providerCalls, 0);
assert.match(tap, /# pass 7\r?\n# fail 0/);
assert.equal(hash(root + "contract.json"), native.contractSha256);
for (const name of [
  "preflight.sql",
  "052_integrate_mail_quota_and_existing_bindings.sql",
  "postflight.sql",
])
  assert.ok(read(root + name).includes(native.contractSha256));
const contract = json(root + "contract.json");
const artifacts = fs
  .readdirSync(root)
  .filter((p) => p !== "manifest.json")
  .sort()
  .map((p) => ({
    path: root + p,
    sha256: hash(root + p),
    bytes: fs.statSync(root + p).size,
  }));
const result = {
  protocol: "QGR-I05-PREP-r1",
  date: "2026-11-11",
  level: "STRICT",
  status: "preparation_complete_remote_gates_pending",
  ordinal: "052",
  ordinalStatus: "coordinator_local_reservation_only",
  head: sources.head,
  commitCreated: false,
  pushed: false,
  remoteChanges: 0,
  providerCalls: 0,
  messages: 0,
  instantlyConsumed: 43,
  composioEnabled: false,
  gmailDirect: "preserved",
  worker: "paused_expected_not_remotely_rechecked",
  contractSha256: native.contractSha256,
  changes: Object.fromEntries(
    Object.entries(contract.post).map(([g, v]) => [g, Object.keys(v).length]),
  ),
  artifacts,
  sourceTreeSha256: sources.sourceTreeSha256,
  applicationSourceSha256: valueHash(codeFiles(sources.files)),
  sourceFiles: sources.files.length,
  archive: sources.archive,
  native: {
    ...native,
    resultPath: nativePath,
    tapPath: local + "native.tap",
    tapSha256: hash(local + "native.tap"),
    reportedTests: 7,
  },
  build: {
    ...build,
    applicationSourcesMatchCurrent: true,
    buildInputSourceTreeSha256: buildInputs.sourceTreeSha256,
    releaseSqlRehearsedSeparately: true,
    log: local + "build.log",
    logSha256: hash(local + "build.log"),
  },
  inheritedI04: {
    reportedTests: 248,
    sourceHashesMatch: true,
    notRepeated: true,
  },
  checks: {
    typeScript: "passed_in_isolated_build",
    format: "checked_mjs_and_markdown",
    diff: "git_diff_check",
    dockerfiles: "reviewed_existing",
    linuxImagesBuilt: false,
    workerStarted: false,
    privateEnvRead: false,
  },
  nextRemoteScripts: [
    "preflight.sql",
    "052_integrate_mail_quota_and_existing_bindings.sql",
    "postflight.sql",
  ],
  pending: [
    "current_CRM_target_and_flags_confirmation",
    "new_read_only_preflight_authorization_and_result",
    "052_application_authorization",
    "reviewed_new_commit_and_remote_Git",
    "Linux_build_and_health_of_both_resources",
    "authorized_smoke",
  ],
  publicationReady: false,
};
fs.writeFileSync(
  root + "manifest.json",
  await format(JSON.stringify(result), { parser: "json" }),
);
process.stdout.write(
  JSON.stringify({
    protocol: result.protocol,
    nativeTests: 7,
    windowsBuild: build.code,
    codeSourcesMatch: true,
    linuxImages: false,
    publicationReady: false,
    providerCalls: 0,
  }) + "\n",
);
