import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const feature =
  "docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/";
const release = feature + "release-gmail-direct/";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const hash = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const base = "17cbbd65d76e0c341f545b8a82a4fcdbe6e71084";
if (git("rev-parse", "HEAD") !== base) throw Error("RELEASE_BASE_DRIFT");
const checks = read(feature + "local-checks.json");
if (checks.checks.some((c) => c.exit !== 0) || !checks.externalFetchGuard)
  throw Error("CHECKS_NOT_GREEN");
const tap = fs.readFileSync(feature + "regression.txt", "utf8");
if (!/^# fail 0\r?$/m.test(tap) || !/^# pass 541\r?$/m.test(tap))
  throw Error("REGRESSION_NOT_GREEN");
const flags = fs.readFileSync(release + "flag-tests.txt", "utf8");
if (!/^# pass 18\r?$/m.test(flags) || !/^# fail 0\r?$/m.test(flags))
  throw Error("FLAG_TESTS_NOT_GREEN");
const sql = read(release + "sql-application.json");
if (
  !sql.applied ||
  !sql.postflightVerified ||
  !sql.backup.explicitlyWaivedByUser ||
  sql.sqlSha256 !== hash(release + "058_simple_mail_connections.sql")
)
  throw Error("SQL_NOT_VERIFIED");
const product = read(
  feature + "preflight/promotion-base.json",
).copiedPublicFiles.map((f) => f.path);
const files = [
  ...new Set([
    ...product,
      ...git("ls-files", "--", feature).split(/\r?\n/).filter(Boolean),
    ...git("ls-files", "--others", "--exclude-standard", "--", feature)
      .split(/\r?\n/)
      .filter(Boolean),
  ]),
]
  .filter(
    (p) =>
      ![
        "support-submitted.jpg",
        "support-submission.json",
      "selected-read-result.txt",
      "catalog.json",
      "catalog-prior.json",
      ].includes(path.basename(p)) && p !== release + "manifest.json",
  )
  .sort();
for (const p of files) {
  if (
    p.split(/[\\/]/).some((s) => [".local", ".env", "node_modules"].includes(s))
  )
    throw Error("PRIVATE_PATH_REJECTED");
  if (!fs.existsSync(p)) throw Error("MISSING_RELEASE_FILE");
}
const dirty = git("diff", "--name-only").split(/\r?\n/).filter(Boolean);
if (dirty.some((p) => !files.includes(p))) throw Error("UNOWNED_DIRTY_PATH");
const manifest = {
  at: new Date().toISOString(),
  scope: "Gmail direct first; Composio explicitly disabled",
  baseCommit: base,
  branch: git("branch", "--show-current"),
  backup: { created: false, explicitlyWaivedByUser: true },
  authorization:
    "Publish Gmail direct, SQL and coordinated web/worker deployment; no new backup. No consent, test email, campaign resume, credit purchase or plan change.",
  checks: {
    regressionPass: 541,
    regressionFail: 0,
    skipped: 6,
    files: checks.files,
    flagTestsPass: 18,
    compile: checks.checks.filter((c) => c.check !== "regression"),
  },
  sql: {
    path: release + "058_simple_mail_connections.sql",
    sha256: sql.sqlSha256,
    applied: true,
    postflightVerified: true,
    sourceBodyUnchangedFromNativeTest: true,
    ordinal: 58,
    location:
      "Dedicated canonical release directory; historical 048–054 are also coordinated outside supabase/migrations",
  },
  flags: {
    initial: {
      SIMPLE_MAIL_ENABLED: "false",
      SIMPLE_MAIL_COMPOSIO_ENABLED: "false",
      SIMPLE_MAIL_ORGANIZATION: "curated",
    },
    final: {
      SIMPLE_MAIL_ENABLED: "true",
      SIMPLE_MAIL_COMPOSIO_ENABLED: "false",
      SIMPLE_MAIL_ORGANIZATION: "curated",
      MAIL_QUOTA_POLICY_ENABLED: "true",
      MAIL_TRANSPORT_ROUTING_ENABLED: "false",
    },
    composioWeb: {
      COMPOSIO_CONNECT_ENABLED: "false",
      COMPOSIO_BINDING_V2_ENABLED: "false",
      COMPOSIO_BINDING_CHECKS_ENABLED: "false",
      COMPOSIO_VERIFIER_SETUP_ENABLED: "false",
    },
  },
  files: files.map((p) => ({
    path: p,
    bytes: fs.statSync(p).size,
    sha256: hash(p),
  })),
  rollback:
    "Close SIMPLE_MAIL_ENABLED in both resources, deploy prior compatible commit; preserve used schema and receipts. SQL reverse only without use.",
};
fs.writeFileSync(
  release + "manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
if (process.argv.includes("--stage")) {
  const staged = [...files, release + "manifest.json"];
  for (let i = 0; i < staged.length; i += 15)
    execFileSync("git", ["add", "--", ...staged.slice(i, i + 15)], {
      windowsHide: true,
      stdio: "inherit",
    });
}
console.log(
  JSON.stringify({
    base,
    files: files.length + 1,
    sqlApplied: true,
    backupWaived: true,
    staged: process.argv.includes("--stage"),
  }),
);
