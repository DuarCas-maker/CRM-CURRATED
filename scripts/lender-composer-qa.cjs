// Offline feature checks. Run with the repository's supported Node 22 runtime.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { createRequire } = require("node:module"),
  { spawnSync } = require("node:child_process"),
  { pathToFileURL } = require("node:url");
const repo = path.resolve(__dirname, ".."),
  req = createRequire(repo + "/package.json");
const esbuild = createRequire(req.resolve("tsx"))("esbuild");
const out =
  process.env.LENDER_QA_OUTPUT ||
  fs.mkdtempSync(path.join(os.tmpdir(), "lender-composer-qa-"));
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "lender-composer.test.ts",
      "lender-composer-server.test.ts",
      "lender-composer-db.test.ts",
      "mail-recipient-selections.test.ts",
      "mail-editor-compatibility.test.ts",
      "mail-compose-database.test.ts",
      "mail-manager.test.ts",
      "mail-channels.test.ts",
      "pipeline-os-case-flow-db.test.ts",
      "campaign-studio.test.ts",
      "campaign-templates.test.ts",
    ];
const env = {};
for (const k of [
  "SystemRoot",
  "COMSPEC",
  "TEMP",
  "TMP",
  "PATH",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
])
  if (process.env[k]) env[k] = process.env[k];
Object.assign(env, {
  NODE_ENV: "test",
  NODE_PATH: repo + "/node_modules",
  COMPOSIO_BINDING_V2_ENABLED: "false",
  MAIL_TRANSPORT_ROUTING_ENABLED: "false",
  LENDER_COMPOSER_PGROOT: process.env.LENDER_COMPOSER_PGROOT || "",
});
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const rows = [];
  for (const name of files) {
    const file = path.join(out, name + ".cjs");
    await esbuild.build({
      entryPoints: [repo + "/tests/" + name],
      outfile: file,
      bundle: true,
      format: "cjs",
      platform: "node",
      jsx: "automatic",
      nodePaths: [repo + "/node_modules"],
      tsconfig: repo + "/tsconfig.json",
      external: [
        "@electric-sql/pglite",
        "@supabase/supabase-js",
        "google-auth-library",
      ],
      loader: { ".css": "empty" },
      logLevel: "silent",
    });
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(repo + "/tests/offline.mjs").href,
        "--test",
        file,
      ],
      { cwd: repo, env, encoding: "utf8", windowsHide: true, timeout: 180000 },
    );
    const log = (result.stdout || "") + (result.stderr || "");
    fs.writeFileSync(path.join(out, name + ".log"), log);
    const row = {
      name,
      exit: result.status,
      pass: Number(log.match(/# pass (\d+)/)?.[1] || 0),
      fail: Number(log.match(/# fail (\d+)/)?.[1] || 0),
      skip: Number(log.match(/# skipped (\d+)/)?.[1] || 0),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(rows, null, 2),
  );
  console.log("Evidence: " + out);
  process.exitCode = rows.every((r) => r.exit === 0) ? 0 : 1;
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
