import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadBundle } from "./artifacts";
import { nativeFixture } from "./fixture";
import { nativeEngine } from "./process";
import { runRehearsal } from "./runner";
import { QaError, demand, executionFile, validateConfig } from "./types";

async function main(args: string[]) {
  const workspace = await realpath(process.cwd());
  demand(
    args.length === 0 ||
      (args.length === 1 && args[0] === "--plan") ||
      (args.length === 2 && args[0] === "--execute-local"),
    "QA_CLI_ARGUMENTS",
  );
  const bundle = await loadBundle(workspace);
  if (!args.length || args[0] === "--plan") {
    console.log(
      JSON.stringify({
        protocol: "PG-EXEC-r1",
        mode: "plan",
        fixtureSteps: nativeFixture(bundle).length,
        contractSha256: bundle.contractSha,
        migrationSha256: bundle.migrationSha,
        plannedCases: 16,
        nativeTestsExecuted: 0,
        processStarts: 0,
        publicationReady: false,
        instantly: { consumed: 43, new: 0 },
        requires:
          "approved private execution.json plus two provisioned PostgreSQL15 clusters; no installation/start performed",
      }),
    );
    return;
  }
  const privateRoot = path.join(workspace, ".local/pipeline-os/pg15-049");
  const configPath = executionFile(
    workspace,
    await realpath(executionFile(workspace, args[1])),
  );
  const c = validateConfig(
    JSON.parse(await readFile(configPath, "utf8")),
    workspace,
  );
  demand(
    path.resolve(configPath) ===
      path.resolve(privateRoot, c.runId, "execution.json"),
    "QA_CONFIG_PATH",
  );
  const engine = await nativeEngine(c, workspace);
  const report = await runRehearsal(c, workspace, bundle, engine);
  await writeFile(
    path.join(privateRoot, c.runId, "report.json"),
    JSON.stringify(report, null, 2),
    { flag: "wx" },
  );
  console.log(JSON.stringify(report));
  if (!report.finished) process.exitCode = 1;
}
main(process.argv.slice(2)).catch((e) => {
  console.error(
    JSON.stringify({
      protocol: "PG-EXEC-r1",
      error: e instanceof QaError ? e.tag : "QA_RUNTIME_OR_INPUT_UNAVAILABLE",
      publicationReady: false,
      instantly: { consumed: 43, new: 0 },
    }),
  );
  process.exitCode = 1;
});
