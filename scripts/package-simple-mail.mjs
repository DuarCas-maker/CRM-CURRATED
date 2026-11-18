import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const folder = "docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/";
const base = "9d28d5a257ef26c618d1884f4dc90eb7c0701530";
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
if (
  git("rev-parse", "HEAD") !== base ||
  git("branch", "--show-current") !== "codex/simple-mail-20261117"
)
  throw Error("IMPLEMENTATION_BASE_DRIFT");
const files = [
  ...new Set([
    ...git("diff", "--name-only").split(/\r?\n/),
    ...git("ls-files", "--others", "--exclude-standard").split(/\r?\n/),
  ]),
]
  .filter(
    (p) =>
      p === ".env.example" ||
      /^(src|worker|tests)\//.test(p) ||
      /^scripts\/(verify|preview|package|run)-simple-mail.*\.mjs$/.test(p) ||
      p === folder + "simple-mail.local.sql" ||
      p === folder + "simple-mail.rollback.sql",
  )
  .sort();
const entries = files.map((path) => {
  const body = fs.readFileSync(path);
  return {
    path,
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
});
const checks = JSON.parse(
  fs.readFileSync(folder + "local-checks.json", "utf8"),
);
const manifest = {
  feature: "simple-mail-20261117",
  mode: "implementation-local",
  level: "STRICT",
  sourceCommit: base,
  branch: git("branch", "--show-current"),
  productImplemented: true,
  remoteChanges: false,
  dependenciesAdded: false,
  sharedPathsProposed: git("diff", "--name-only")
    .split(/\r?\n/)
    .filter((p) => p === ".env.example" || /^(src|tests|worker)\//.test(p)),
  files: entries,
  sql: {
    strategy: "expand-compatible",
    ordinalReserved: false,
    requiresCatalogReconciliation: true,
    rollbackProtectsRegisteredReceipts: true,
    compatibilityFix: {
      signature: "mail_runtime.command_v1(uuid,text,jsonb,uuid)",
      expectedNormalizedMd5: "c2c3178219832b68d64bb85d22e39276",
      change: "qualifier only; original DDL retained for unused rollback",
    },
  },
  authorization:
    "Implementar y probar todo el alcance, incluyendo compartidos, rutas, pantalla, worker y SQL local; no publicación ni operaciones reales",
  checks,
  limits: [
    "Real OAuth/provider/cap evidence not exercised",
    "Live catalog and current main still need promotion preflight",
    "Known inherited gmail-attachments.test.ts:235 failure retained",
    "No push, commit, migration remote, email or purchase",
  ],
};
fs.writeFileSync(
  folder + "implementation-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    implementationFiles: entries.length,
    remoteChanges: false,
    sourceCommit: base,
  }),
);
