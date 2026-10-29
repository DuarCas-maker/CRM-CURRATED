// No dotenv/autoload. Default status is offline, without mkdir, env or source access.
import { parseArgs } from "node:util";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { observeComposio } from "./s00-composio-observer";
import { observationFiles } from "./s00-composio-observer-files";
import { S00RunError, fail } from "./s00-composio-common";

async function main() {
  const { values } = parseArgs({
    options: {
      execute: { type: "boolean", default: false },
      "authorized-total": { type: "string" },
      "included-calls-confirmed": { type: "boolean", default: false },
      "clock-synchronized": { type: "boolean", default: false },
      "clock-uncertainty-ms": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const files = observationFiles(process.cwd());
  if (!values.execute) {
    console.log(
      JSON.stringify(
        await observeComposio({}, undefined, files.store),
        null,
        2,
      ),
    );
    return;
  }
  if (
    values["authorized-total"] !== "77" ||
    !values["included-calls-confirmed"]
  )
    return fail("OBSERVATION_AUTHORIZATION_REQUIRED");
  try {
    await stat(resolve(".local/pipeline-os/s00-composio-reconnect.json"));
    return fail("RECONNECT_LEDGER_SUPERSEDES_OBSERVER");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const uncertainty = values["clock-uncertainty-ms"];
  if (uncertainty !== undefined && !/^\d{1,8}$/.test(uncertainty))
    return fail("INVALID_CLOCK_EVIDENCE");
  const controller = new AbortController(),
    stop = () => controller.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    const report = await files.locked(async () =>
      observeComposio(process.env, await files.source(), files.store, {
        execute: true,
        authorizedTotal: 77,
        includedCallsConfirmed: true,
        signal: controller.signal,
        clockEvidence: {
          synchronized: values["clock-synchronized"],
          uncertaintyMs: uncertainty === undefined ? null : Number(uncertainty),
        },
        onReady: () => {
          console.log(
            JSON.stringify({
              event: "READY",
              aliases: [1, 2],
              replyInExistingThreads: true,
              attachmentsRequired: false,
            }),
          );
        },
      }),
    );
    console.log(JSON.stringify(report, null, 2));
    if (
      report.phase !== "completed" ||
      report.usageError ||
      report.mailboxes.some((b) => b.latencyAcceptance !== "pass")
    )
      process.exitCode = 2;
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      error: e instanceof S00RunError ? e.code : "S00_OBSERVER_FAILED",
    }),
  );
  process.exitCode = 2;
});
