// Disposable public-source build. Never load/copy env files or provider state.
import { cp, mkdir, symlink, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
const root = process.cwd();
const target = resolve(".local/application-performance-20261118/build");
await mkdir(target, { recursive: true });
for (const name of ["src", "worker", "public", "package.json", "tsconfig.json", "next.config.ts", "pnpm-workspace.yaml"])
  await cp(join(root, name), join(target, name), { recursive: true });
await mkdir(join(target, "scripts"), { recursive: true });
await cp(join(root, "scripts/prepare-pdf-viewer.mjs"), join(target, "scripts/prepare-pdf-viewer.mjs"));
try { await access(join(target, "node_modules")); }
catch { await symlink(join(root, "node_modules"), join(target, "node_modules"), "junction"); }
const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
Object.assign(env, { NEXT_TELEMETRY_DISABLED: "1", CI: "1" });
const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "build", "--webpack"], { cwd: target, env, stdio: "inherit", windowsHide: true });
child.on("error", () => { process.stderr.write("Isolated build could not start.\n"); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
