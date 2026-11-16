// Anonymous smoke of the isolated build. No env files or provider credentials.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const root = process.cwd(),
  target = resolve(".local/user-management/build");
const portServer = createServer();
await new Promise((done) => portServer.listen(0, "127.0.0.1", done));
const port = portServer.address().port;
await new Promise((done) => portServer.close(done));
const origin = `http://127.0.0.1:${port}`;
const env = Object.fromEntries(
  [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
  ]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
Object.assign(env, {
  NEXT_TELEMETRY_DISABLED: "1",
  APP_ORIGIN: origin,
  NODE_ENV: "production",
});
const child = spawn(
  process.execPath,
  [
    resolve(root, "node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: target, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
try {
  await new Promise((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Local smoke startup timed out")),
      30000,
    );
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Ready in")) {
        clearTimeout(timer);
        done();
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Local smoke failed to start"));
    });
    child.on("exit", () => {
      clearTimeout(timer);
      reject(new Error("Local smoke stopped before ready"));
    });
  });
  const results = [];
  for (const [path, options, expected] of [
    ["/login", {}, 200],
    ["/demo", {}, 404],
    ["/api/users", {}, 503],
    [
      "/api/users",
      {
        method: "POST",
        headers: {
          origin: "https://untrusted.invalid",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
      403,
    ],
  ]) {
    const response = await fetch(origin + path, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    if (response.status !== expected)
      throw new Error(
        `Smoke ${path}: expected ${expected}, got ${response.status}`,
      );
    if (
      path === "/api/users" &&
      (response.headers.get("Cache-Control") !== "private, no-store" ||
        /encrypted_text|SUPABASE_SERVICE_ROLE_KEY|INTEGRATION_ENCRYPTION_KEY/.test(
          text,
        ))
    )
      throw new Error(
        `Anonymous response privacy failed (Cache-Control: ${response.headers.get("Cache-Control")})`,
      );
    results.push({
      path,
      method: options.method || "GET",
      status: response.status,
    });
  }
  await mkdir("docs/specs/user-management/evidence", { recursive: true });
  await writeFile(
    "docs/specs/user-management/evidence/anonymous-smoke.json",
    JSON.stringify(
      {
        runtime: process.version,
        realProviderCalls: 0,
        note: "No Supabase configuration; GET denies with 503 and invalid POST origin with 403.",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(
    JSON.stringify({
      checks: results.length,
      passed: true,
      realProviderCalls: 0,
    }) + "\n",
  );
} finally {
  child.kill();
}
