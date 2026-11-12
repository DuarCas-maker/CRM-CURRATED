// Local release preparation only: explicit sources, fictitious build env, no provider or Git mutation.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const root = process.cwd();
const folder =
  "docs/specs/pipeline-os/s02/release/daniel-verification-20261111/";
const runtime = path.resolve(".local/pipeline-os/dv-publication");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", windowsHide: true });
const head = git(["rev-parse", "HEAD"]).trim();
const implementation = JSON.parse(
  await fs.readFile(folder + "controls-manifest.json", "utf8"),
);
assert.equal(
  head,
  implementation.base,
  "Publication base changed; review again",
);
const changed = git(["diff", "HEAD", "--name-only", "-z"])
  .split("\0")
  .filter(Boolean)
  .sort();
assert.deepEqual(
  changed,
  [...implementation.trackedChanged].sort(),
  "Unexpected tracked delta",
);
assert.equal(
  git(["diff", "--cached", "--name-only"]).trim(),
  "",
  "Preserve pre-existing index; review required",
);
for (const f of implementation.files)
  assert.equal(hash(await fs.readFile(f.path)), f.sha256, f.path);

const generated = new Set([
  folder + "controls-publication-sources.json",
  folder + "controls-publication-manifest.json",
  folder + "controls-publication-verification.md",
]);
const selected = new Set(git(["ls-files", "-z"]).split("\0").filter(Boolean));
for (const f of implementation.files) selected.add(f.path);
for (const name of await fs.readdir(folder)) {
  if (!/\.(md|json|mjs)$/.test(name))
    throw Error("Unexpected release document extension");
  selected.add(folder + name);
}
const paths = [...selected].filter((p) => !generated.has(p)).sort();
const rawAttributes = execFileSync(
  "git",
  ["check-attr", "-z", "--stdin", "text", "filter"],
  {
    input: paths.join("\0") + "\0",
    encoding: "utf8",
    windowsHide: true,
  },
).split("\0");
const attributes = new Map();
for (let i = 0; i + 2 < rawAttributes.length; i += 3) {
  const [p, attribute, value] = rawAttributes.slice(i, i + 3);
  if (!attributes.has(p)) attributes.set(p, {});
  attributes.get(p)[attribute] = value;
}
await fs.mkdir(runtime, { recursive: true });
const context = await fs.mkdtemp(path.join(runtime, "build-"));
assert.ok(context.startsWith(runtime + path.sep));
const files = [];
for (const p of paths) {
  assert.ok(
    !path.isAbsolute(p) && !p.split("/").includes(".."),
    "Unsafe relative path",
  );
  assert.ok(
    !/(^|\/)(?:\.local|\.git|node_modules|\.next)(\/|$)/.test(p),
    "Private directory",
  );
  assert.ok(
    !/(^|\/)(?:\.env(?:\..*)?|[^/]+\.env)$/.test(p) || p === ".env.example",
    "Private env filename",
  );
  const stat = await fs.lstat(p);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink(),
    "Non-regular source: " + p,
  );
  const raw = await fs.readFile(p),
    attr = attributes.get(p);
  assert.equal(
    attr?.filter,
    "unspecified",
    "Custom Git filter requires review",
  );
  // Match this repository's LF rules; preserve -text and binary bytes, including sealed evidence.
  const normalized =
    attr.text !== "unset" && !raw.includes(0)
      ? Buffer.from(raw.toString("utf8").replaceAll("\r\n", "\n"))
      : raw;
  const blob = createHash("sha1")
    .update(`blob ${normalized.length}\0`)
    .update(normalized)
    .digest("hex");
  const target = path.join(context, p);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, normalized);
  files.push({
    path: p,
    workingSha256: hash(raw),
    sha256: hash(normalized),
    bytes: normalized.length,
    gitBlobSha1: blob,
  });
}
const receipt = {
  protocol: "DV-PUB-SOURCES-r1",
  head,
  sourceTreeSha256: hash(JSON.stringify(files)),
  files,
  metadataExcluded: [...generated],
  privateFiles: 0,
  sourceNormalization: "Git LF text; -text/binary preserved",
  providerCalls: 0,
  remoteChanges: 0,
};
const list = path.join(runtime, "sources.txt"),
  archive = path.join(runtime, "web-worker-sources.tar.gz");
await fs.writeFile(list, files.map((f) => f.path).join("\n") + "\n");
execFileSync("tar", ["-czf", archive, "--no-recursion", "-T", list], {
  cwd: context,
  windowsHide: true,
  stdio: "pipe",
});
// Read the archive back independently; no installation, upload or Git write.
assert.deepEqual(
  execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
    windowsHide: true,
  })
    .trim()
    .split(/\r?\n/),
  files.map((f) => f.path),
);
receipt.archive = {
  path: path.relative(root, archive).replaceAll("\\", "/"),
  sha256: hash(await fs.readFile(archive)),
};
await fs.writeFile(
  folder + "controls-publication-sources.json",
  JSON.stringify(receipt, null, 2) + "\n",
);
const common = {
  protocol: "DV-PUB-BUILD-r1",
  context: path.relative(root, context).replaceAll("\\", "/"),
  sourceTreeSha256: receipt.sourceTreeSha256,
  platform: process.platform,
  node: process.versions.node,
  linuxImage: false,
  realEnvFiles: 0,
  providerCalls: 0,
  remoteChanges: 0,
  instantlyConsumed: 43,
};
if (!process.argv.includes("--build")) {
  process.stdout.write(
    JSON.stringify({ ...common, buildExecuted: false, files: files.length }) +
      "\n",
  );
  process.exit(0);
}
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
  COMPOSIO_VERIFIER_SETUP_ENABLED: "false",
  COMPOSIO_VERIFIER_ACCOUNT_ID: "",
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
const log = await fs.open(path.join(runtime, "build.log"), "w");
const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "build",
    context,
    "--webpack",
  ],
  {
    cwd: context,
    env,
    windowsHide: true,
    stdio: ["ignore", log.fd, log.fd],
  },
);
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
await log.close();
let setupRouteCompiled = false;
let standaloneEntry = null;
if (code === 0) {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(context, ".next/server/app-paths-manifest.json"),
      "utf8",
    ),
  );
  setupRouteCompiled = Object.hasOwn(
    manifest,
    "/api/mail/accounts/[id]/composio/verification-setup/route",
  );
  assert.ok(setupRouteCompiled, "New route missing from compiled app");
  const traced = JSON.parse(
    await fs.readFile(
      path.join(context, ".next/required-server-files.json"),
      "utf8",
    ),
  );
  const standaloneRoot = path.join(context, ".next/standalone");
  const server = path.resolve(
    standaloneRoot,
    traced.relativeAppDir ?? "",
    "server.js",
  );
  assert.ok(
    server.startsWith(standaloneRoot + path.sep),
    "Standalone path escaped build output",
  );
  await fs.access(server);
  standaloneEntry = path.relative(context, server).replaceAll("\\", "/");
}
const result = {
  ...common,
  code,
  buildExecuted: true,
  setupRouteCompiled,
  standaloneEntry,
  networkPermitted: false,
  buildMode: "Windows webpack standalone; Linux Coolify pending",
};
await fs.writeFile(
  path.join(runtime, "build.json"),
  JSON.stringify(result, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(result) + "\n");
process.exitCode = code;
