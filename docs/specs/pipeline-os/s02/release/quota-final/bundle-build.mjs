// Explicit local source bundle and isolated Windows build. No actual env or network.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = process.cwd(),
  release = "docs/specs/pipeline-os/s02/release/quota-final/",
  dest = path.resolve(".local/pipeline-os/qgr-i05");
const hash = (b) => createHash("sha256").update(b).digest("hex");
await fs.mkdir(dest, { recursive: true });
const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const top = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "next.config.ts",
  "Dockerfile",
  "Dockerfile.worker",
  ".dockerignore",
  ".env.example",
  ".gitignore",
  ".gitattributes",
  "AGENTS.md",
]);
const files = [];
for (const p of [...new Set(paths)].sort()) {
  if (
    !top.has(p) &&
    !/^(src|worker|public|supabase|scripts|tests|docs)\//.test(p)
  )
    continue;
  if (
    /(^|\/)(?:\.local|\.git|node_modules|\.next)(\/|$)/.test(p) ||
    /\.(log|tsbuildinfo)$/.test(p)
  )
    continue;
  if (/(^|\/)(?:\.env(?:\..*)?|[^/]+\.env)$/.test(p) && p !== ".env.example")
    throw Error("Private filename excluded: " + p);
  if (
    p.startsWith(release) &&
    ["manifest.json", "sources.json", "verification.md"].includes(
      path.basename(p),
    )
  )
    continue;
  const stat = await fs.lstat(p);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), p);
  const b = await fs.readFile(p);
  files.push({ path: p, bytes: b.length, sha256: hash(b) });
}
const receipt = {
  protocol: "QGR-I05-SOURCES-r1",
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  files,
  sourceTreeSha256: hash(JSON.stringify(files)),
  linuxImageBuilt: false,
  providerCalls: 0,
};
await fs.writeFile(
  release + "sources.json",
  JSON.stringify(receipt, null, 2) + "\n",
);
const list = path.join(dest, "sources.txt"),
  archive = path.join(dest, "web-worker-sources.tar.gz");
await fs.writeFile(list, files.map((f) => f.path).join("\n") + "\n");
execFileSync("tar", ["-czf", archive, "--no-recursion", "-T", list], {
  cwd: root,
  windowsHide: true,
  stdio: "pipe",
});
const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/);
assert.deepEqual(
  entries,
  files.map((f) => f.path),
);
receipt.archive = {
  path: path.relative(root, archive).replaceAll("\\", "/"),
  sha256: hash(await fs.readFile(archive)),
};
await fs.writeFile(
  release + "sources.json",
  JSON.stringify(receipt, null, 2) + "\n",
);
if (!process.argv.includes("--build")) {
  process.stdout.write(
    JSON.stringify({
      files: files.length,
      sourceTreeSha256: receipt.sourceTreeSha256,
    }) + "\n",
  );
  process.exit(0);
}
const context = await fs.mkdtemp(path.join(dest, "build-"));
execFileSync("tar", ["-xzf", archive, "-C", context], {
  windowsHide: true,
  stdio: "pipe",
});
for (const f of files)
  assert.equal(
    hash(await fs.readFile(path.join(context, f.path))),
    f.sha256,
    f.path,
  );
for (const n of [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
])
  await assert.rejects(fs.access(path.join(context, n)));
await fs.symlink(
  path.join(root, "node_modules"),
  path.join(context, "node_modules"),
  "junction",
);
const env = {
  SystemRoot: process.env.SystemRoot,
  ComSpec: process.env.ComSpec,
  PATHEXT: process.env.PATHEXT,
  PATH:
    path.dirname(process.execPath) + ";" + process.env.SystemRoot + "/System32",
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  USERPROFILE: process.env.USERPROFILE,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS:
    "--import=" +
    pathToFileURL(
      path.join(root, ".local/pipeline-os/worker-control-20261108/offline.mjs"),
    ).href,
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "offline-public-placeholder",
  APP_ORIGIN: "https://crm.example.test",
  COMPOSIO_CONNECT_ENABLED: "false",
  COMPOSIO_BINDING_V2_ENABLED: "false",
  COMPOSIO_BINDING_CHECKS_ENABLED: "false",
  MAIL_QUOTA_POLICY_ENABLED: "false",
  MAIL_TRANSPORT_ROUTING_ENABLED: "false",
  INSTANTLY_WEBHOOK_ENABLED: "false",
  WORKER_EXECUTION_MODE: "paused",
  DEMO_ENABLED: "false",
};
execFileSync(process.execPath, ["scripts/prepare-pdf-viewer.mjs"], {
  cwd: context,
  env,
  windowsHide: true,
  stdio: "pipe",
});
const log = await fs.open(path.join(dest, "build.log"), "w");
const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "build",
    context,
    "--webpack",
  ],
  { cwd: context, env, windowsHide: true, stdio: ["ignore", log.fd, log.fd] },
);
const code = await new Promise((r, reject) => {
  child.once("error", reject);
  child.once("close", r);
});
await log.close();
const result = {
  protocol: "QGR-I05-BUILD-r1",
  code,
  context: path.relative(root, context).replaceAll("\\", "/"),
  sourceTreeSha256: receipt.sourceTreeSha256,
  platform: process.platform,
  node: process.versions.node,
  linuxImage: false,
  realEnvFiles: 0,
  providerCalls: 0,
  networkPermitted: false,
};
await fs.writeFile(
  path.join(dest, "build.json"),
  JSON.stringify(result, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(result) + "\n");
process.exitCode = code;
