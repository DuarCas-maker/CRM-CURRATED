import { execFileSync } from "node:child_process";
import { readFile, writeFile, lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { hash, runtimeReleaseRoot } from "./mail-runtime-release";

// Explicit public build context only. No env/credentials/cluster/dependencies.
// No push, install, network or server operations. Archive is local and private.
export async function packageRuntimeRelease(
  destination = ".local/pipeline-os/mail-runtime-release-20261108",
) {
  const root = process.cwd(),
    resolved = path.resolve(destination);
  assert(resolved.startsWith(path.resolve(root, ".local") + path.sep));
  await mkdir(resolved, { recursive: true });
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const files = [];
  for (const p of [...new Set(paths)].sort()) {
    // Release receipts are external to the build context: including a parent
    // receipt which hashes this archive would introduce a recursive hash cycle.
    if (/(^|\/)(manifest|sources)\.json$/.test(p)) continue;
    assert(
      !p.includes("\\") &&
        !p.startsWith("-") &&
        !p.startsWith("/") &&
        !p.split("/").some((x) => x === ".."),
    );
    assert(
      !/(^|\/)(?:\.env(?:\..*)?|[^/]+\.env)$/.test(p) || p === ".env.example",
      "private env excluded",
    );
    if (
      /(^|\/)(?:\.git|\.local|node_modules|\.next|\.pnpm-store)(\/|$)/.test(
        p,
      ) ||
      /\.(?:log|tsbuildinfo)$/.test(p) ||
      p === "next-env.d.ts"
    )
      continue;
    const stat = await lstat(p);
    assert(stat.isFile() && !stat.isSymbolicLink());
    const b = await readFile(p);
    files.push({ path: p, bytes: b.length, sha256: hash(b) });
  }
  for (const p of [
    "Dockerfile",
    "Dockerfile.worker",
    ".dockerignore",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "src/components/composio-connect.tsx",
    "scripts/prepare-pdf-viewer.mjs",
  ])
    assert(files.some((f) => f.path === p));
  assert(
    files.some(
      (f) =>
        f.path ===
        runtimeReleaseRoot + "050_integrate_mail_runtime_and_connect.sql",
    ),
  );
  await writeFile(
    path.join(resolved, "sources.txt"),
    files.map((f) => f.path).join("\n") + "\n",
  );
  const archive = path.join(resolved, "mail-runtime-web-worker-sources.tar.gz");
  execFileSync(
    "tar",
    [
      "-czf",
      archive,
      "--no-recursion",
      "-T",
      path.join(resolved, "sources.txt"),
    ],
    { cwd: root, stdio: "pipe" },
  );
  const list = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/);
  assert.deepEqual(
    list,
    files.map((f) => f.path),
  );
  const b = await readFile(archive);
  const receipt = {
    id: "MR-SOURCES-r1",
    files,
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    archive: {
      path: path.relative(root, archive).replaceAll("\\", "/"),
      bytes: b.length,
      sha256: hash(b),
    },
    sourceTreeSha256: hash(JSON.stringify(files)),
    linuxImageBuilt: false,
    remoteOperations: 0,
  };
  await writeFile(
    runtimeReleaseRoot + "sources.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      files: files.length,
      archive: receipt.archive,
      sourceTreeSha256: receipt.sourceTreeSha256,
      remoteOperations: 0,
    }),
  );
  return receipt;
}
if (
  process.argv[1]
    ?.replaceAll("\\", "/")
    .endsWith("/package-mail-runtime-release.ts")
)
  await packageRuntimeRelease();
