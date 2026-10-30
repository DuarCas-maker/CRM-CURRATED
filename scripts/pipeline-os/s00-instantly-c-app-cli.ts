// Explicit entry point. No env-file autoload, default status never reads credentials.
import { parseArgs } from "node:util";
import { cAppFiles } from "./s00-instantly-c-app-files";
import {
  cAppReport,
  prepareCAppGrant,
  runCApp,
  validateCAppInputs,
} from "./s00-instantly-c-app";
async function main() {
  const { values: v } = parseArgs({
    strict: true,
    allowPositionals: false,
    options: {
      execute: { type: "boolean", default: false },
      "prepare-grant": { type: "boolean", default: false },
      "check-manifest": { type: "boolean", default: false },
      "authorized-provider-new": { type: "string" },
      "authorized-provider-total": { type: "string" },
      "authorized-control-new": { type: "string" },
      "included-confirmed": { type: "boolean", default: false },
    },
  });
  const files = cAppFiles(process.cwd());
  if (!v.execute) {
    if (
      v["prepare-grant"] ||
      v["authorized-provider-new"] ||
      v["authorized-provider-total"] ||
      v["authorized-control-new"] ||
      v["included-confirmed"]
    )
      throw Error("CAPP_AUTHORIZATION_REQUIRED");
    if (v["check-manifest"]) {
      validateCAppInputs(await files.inputs());
      console.log(
        JSON.stringify({ mode: "offline_manifest", http: 0, ready: true }),
      );
    } else console.log(JSON.stringify(cAppReport(await files.store.load())));
    return;
  }
  if (
    v["check-manifest"] ||
    v["authorized-provider-new"] !== "19" ||
    v["authorized-provider-total"] !== "62" ||
    v["authorized-control-new"] !== "25" ||
    !v["included-confirmed"]
  )
    throw Error("CAPP_AUTHORIZATION_REQUIRED");
  await files.locked(async () => {
    const old = await files.store.load();
    if (old?.version === 9 && old.status !== "awaiting_ticket") {
      console.log(JSON.stringify(cAppReport(old)));
      return;
    }
    const inputs = await files.inputs();
    if (v["prepare-grant"]) {
      const approval = await prepareCAppGrant(files.store, inputs, {
        execute: true,
        authorizedProviderNew: 19,
        authorizedProviderTotal: 62,
        authorizedControlNew: 25,
      });
      await files.approval(approval);
      console.log(
        JSON.stringify({
          status: "awaiting_operator_mfa",
          calls: 43,
          controlReserved: 1,
          http: 0,
        }),
      );
      return;
    }
    const controller = new AbortController(),
      stop = () => controller.abort();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
      const result = await runCApp(
        process.env,
        files.store,
        inputs,
        await files.ticket(),
        {
          execute: true,
          authorizedProviderNew: 19,
          authorizedProviderTotal: 62,
          authorizedControlNew: 25,
          includedConfirmed: true,
          signal: controller.signal,
        },
      );
      console.log(JSON.stringify(result));
      if (result.status !== "completed") process.exitCode = 2;
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  });
}
main().catch(() => {
  console.error(JSON.stringify({ error: "CAPP_CLI_REJECTED" }));
  process.exitCode = 2;
});
