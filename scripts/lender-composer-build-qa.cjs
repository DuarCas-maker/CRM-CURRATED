const fs = require("node:fs"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  { pathToFileURL } = require("node:url");
const repo = path.resolve(__dirname, ".."),
  out = process.env.LENDER_QA_OUTPUT;
if (!out) throw Error("Set LENDER_QA_OUTPUT");
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(repo))
  if (name.startsWith(".env") && name !== ".env.example")
    throw Error("Real env forbidden in isolated QA");
const env = {};
for (const key of [
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PATHEXT",
])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  PATH:
    path.dirname(process.execPath) + path.delimiter + (process.env.PATH || ""),
  NEXT_TELEMETRY_DISABLED: "1",
  DEMO_ENABLED: "true",
  APP_ORIGIN: "http://127.0.0.1:3282",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-synthetic-qa",
  NO_COLOR: "1",
  NODE_OPTIONS: "--import=" + pathToFileURL(repo + "/tests/offline.mjs").href,
});
const log = fs.openSync(path.join(out, "next-build.log"), "w");
const child = spawn(
  process.execPath,
  [repo + "/node_modules/next/dist/bin/next", "build", "--webpack"],
  { cwd: repo, env, stdio: ["ignore", log, log], windowsHide: true },
);
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  fs.closeSync(log);
  fs.writeFileSync(
    path.join(out, "next-build.json"),
    JSON.stringify({
      exitCode: code,
      node: process.version,
      realEnv: false,
      externalFetchBlocked: true,
    }),
  );
  console.log(JSON.stringify({ exitCode: code }));
  process.exitCode = code || 0;
});
