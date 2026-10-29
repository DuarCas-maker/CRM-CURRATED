import { parseArgs } from "node:util";
import { runS00Connections } from "./s00-connections";

async function main() {
  const { values } = parseArgs({
    options: { "execute-readonly": { type: "boolean", default: false } },
    strict: true,
    allowPositionals: false,
  });
  // Credentials must already be provisioned in this process. Never load files here.
  const report = await runS00Connections(process.env, {
    executeReadonly: values["execute-readonly"],
  });
  console.log(JSON.stringify(report, null, 2));
  if (
    values["execute-readonly"] &&
    report.checks.some((check) => check.status !== "ok")
  ) {
    process.exitCode = 2;
  }
}

main().catch(() => {
  console.error(JSON.stringify({ error: "S00_CONNECTIONS_INPUT_ERROR" }));
  process.exitCode = 1;
});
