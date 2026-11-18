import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
const directory =
  "docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/";
const env = {
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  COMSPEC: process.env.COMSPEC,
  PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
  APP_ORIGIN: "https://crm.example.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-public-key",
  DEMO_ENABLED: "false",
  SIMPLE_MAIL_ENABLED: "false",
  COMPOSIO_CONNECT_ENABLED: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS:
    "--import " + pathToFileURL(path.resolve("tests/offline.mjs")).href,
};
const run = (name, args) =>
  new Promise((resolve) => {
    const out = fs.openSync(directory + name + ".txt", "w");
    const child = spawn(process.execPath, args, {
      env,
      windowsHide: true,
      stdio: ["ignore", out, out],
    });
    child.on("exit", (code) => {
      fs.closeSync(out);
      const result = { check: name, exit: code };
      console.log(JSON.stringify(result));
      resolve(result);
    });
    child.on("error", () => {
      fs.closeSync(out);
      resolve({ check: name, exit: 1 });
    });
  });
const files = fs
  .readdirSync("tests")
  .filter(
    (n) =>
      /\.test\.(ts|tsx)$/.test(n) &&
      (/^(mail-|gmail-|connections|campaign-)/.test(n) ||
        /^pipeline-os-s02-(connect-|quota-|transport|mailbox|brand-|composio|existing-)/.test(
          n,
        ) ||
        n === "pipeline-os-s00-connections.test.ts"),
  );
const prior = process.argv.includes("--compile-only")
  ? JSON.parse(fs.readFileSync(directory + "local-checks.json", "utf8"))
  : null;
const tests = prior
  ? prior.checks.find((r) => r.check === "regression")
  : await run("regression", [
      "--import",
      import.meta.resolve("tsx"),
      "--import",
      "./tests/simple-mail-register.mjs",
      "--test",
      "--test-concurrency=2",
      ...files.map((n) => "tests/" + n),
    ]);
const gen = await run("types", [
  "../../../node_modules/next/dist/bin/next",
  "typegen",
]);
const types =
  gen.exit === 0
    ? await run("typecheck", [
        "../../../node_modules/typescript/bin/tsc",
        "--noEmit",
      ])
    : gen;
const build =
  types.exit === 0
    ? await run("build-webpack", [
        "../../../node_modules/next/dist/bin/next",
        "build",
        "--webpack",
      ])
    : { check: "build-webpack", exit: null };
const checks = [tests, gen, types, build];
fs.writeFileSync(
  directory + "local-checks.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      files: files.length,
      regressionReusedFrom: prior?.at ?? null,
      checks,
      realCredentials: false,
      externalFetchGuard: true,
    },
    null,
    2,
  ) + "\n",
);
process.exitCode = checks.every((r) => r.exit === 0) ? 0 : 1;
