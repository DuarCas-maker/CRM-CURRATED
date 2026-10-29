// No env autoload. Default status never reads process.env, creates files or calls HTTP.
import { parseArgs } from "node:util";
import {
  inspectInstantlyConfiguration,
  runInstantlyPhaseA,
} from "./s00-instantly-runner";
import { instantlyFiles } from "./s00-instantly-files";
import { S00RunError } from "./s00-composio-common";
import {
  instantlyLedgerReport,
  recoverInstantlyPagination,
} from "./s00-instantly-recovery";
import { bReport, runInstantlyB, validateBInputs } from "./s00-instantly-b";
import {
  bdReport,
  runInstantlyBDiagnostic,
  validateBDInputs,
} from "./s00-instantly-b-diagnostic";

async function main() {
  const { values } = parseArgs({
    options: {
      execute: { type: "boolean", default: false },
      "check-config": { type: "boolean", default: false },
      phase: { type: "string" },
      "authorized-new": { type: "string" },
      "included-calls-confirmed": { type: "boolean", default: false },
      "recover-pagination": { type: "boolean", default: false },
      "authorized-total": { type: "string" },
      "check-b-manifest": { type: "boolean", default: false },
      "manifest-reviewed": { type: "boolean", default: false },
      "check-b-diagnostic": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.phase === "B_DIAGNOSTIC" || values["check-b-diagnostic"]) {
    if (
      values["check-config"] ||
      values["recover-pagination"] ||
      values["check-b-manifest"] ||
      (values.phase && values.phase !== "B_DIAGNOSTIC")
    )
      throw new S00RunError("INVALID_INSTANTLY_CLI_MODE");
    if (!values.execute) {
      if (
        values["authorized-new"] ||
        values["authorized-total"] ||
        values["included-calls-confirmed"] ||
        values["manifest-reviewed"]
      )
        throw new S00RunError("INVALID_INSTANTLY_CLI_MODE");
      const files = instantlyFiles(process.cwd());
      if (values["check-b-diagnostic"]) {
        const v = validateBDInputs(await files.diagnosticInputs());
        console.log(
          JSON.stringify({
            mode: "offline_b_diagnostic",
            sourceCalls: v.source.calls,
            apiCalls: 0,
            bindingsValid: true,
          }),
        );
      } else
        console.log(
          JSON.stringify(
            await runInstantlyBDiagnostic({}, files.diagnosticStore, undefined),
            null,
            2,
          ),
        );
      return;
    }
    if (
      values["check-b-diagnostic"] ||
      values["authorized-new"] !== "2" ||
      values["authorized-total"] !== "20" ||
      !values["included-calls-confirmed"] ||
      !values["manifest-reviewed"]
    )
      throw new S00RunError("BD_AUTHORIZATION_REQUIRED");
    const files = instantlyFiles(process.cwd()),
      controller = new AbortController(),
      stop = () => controller.abort();
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    try {
      const r = await files.locked(async () =>
        runInstantlyBDiagnostic(
          process.env,
          files.diagnosticStore,
          await files.diagnosticInputs(),
          {
            execute: true,
            authorizedNew: 2,
            authorizedTotal: 20,
            includedCallsConfirmed: true,
            manifestReviewed: true,
            signal: controller.signal,
          },
        ),
      );
      console.log(JSON.stringify(r, null, 2));
      if (r.status !== "completed") process.exitCode = 2;
    } finally {
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    }
    return;
  }
  if (values.phase === "B" || values["check-b-manifest"]) {
    if (values["check-config"] || values["recover-pagination"])
      throw new S00RunError("INVALID_INSTANTLY_CLI_MODE");
    if (!values.execute) {
      if (
        values["authorized-new"] ||
        values["authorized-total"] ||
        values["included-calls-confirmed"] ||
        values["manifest-reviewed"]
      )
        throw new S00RunError("INVALID_INSTANTLY_CLI_MODE");
      const files = instantlyFiles(process.cwd());
      if (values["check-b-manifest"]) {
        const v = validateBInputs(await files.bInputs());
        console.log(
          JSON.stringify({
            mode: "offline_b_manifest",
            calls: v.prior.calls,
            apiCalls: 0,
            controlledRecipientsConfirmed:
              v.manifest.controlledRecipientsConfirmed,
            exclusiveTrialControlConfirmed:
              v.manifest.exclusiveTrialControlConfirmed,
            statusMappingConfirmed: v.manifest.statusMapping.confirmed,
            scopeEvidenceBound: true,
          }),
        );
      } else
        console.log(
          JSON.stringify(
            await runInstantlyB({}, files.bStore, undefined),
            null,
            2,
          ),
        );
      return;
    }
    if (
      values["check-b-manifest"] ||
      values["authorized-new"] !== "25" ||
      values["authorized-total"] !== "36" ||
      !values["included-calls-confirmed"] ||
      !values["manifest-reviewed"]
    )
      throw new S00RunError("B_AUTHORIZATION_REQUIRED");
    const files = instantlyFiles(process.cwd()),
      controller = new AbortController(),
      stop = () => controller.abort();
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    try {
      const r = await files.locked(async () =>
        runInstantlyB(process.env, files.bStore, await files.bInputs(), {
          execute: true,
          authorizedNew: 25,
          authorizedTotal: 36,
          includedCallsConfirmed: true,
          manifestReviewed: true,
          signal: controller.signal,
        }),
      );
      console.log(JSON.stringify(r, null, 2));
      if (r.status !== "completed") process.exitCode = 2;
    } finally {
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    }
    return;
  }
  if (values["manifest-reviewed"])
    throw new S00RunError("INVALID_INSTANTLY_CLI_MODE");
  if (values["check-config"]) {
    if (
      values.execute ||
      values.phase ||
      values["authorized-new"] ||
      values["authorized-total"] ||
      values["recover-pagination"] ||
      values["included-calls-confirmed"]
    )
      throw new S00RunError("INVALID_INSTANTLY_CLI_MODE");
    console.log(
      JSON.stringify(
        {
          mode: "offline_configuration",
          calls: 0,
          configuration: inspectInstantlyConfiguration(process.env),
        },
        null,
        2,
      ),
    );
    return;
  }
  const files = instantlyFiles(process.cwd());
  if (!values.execute) {
    if (
      values.phase ||
      values["authorized-new"] ||
      values["authorized-total"] ||
      values["included-calls-confirmed"]
    )
      throw new S00RunError("INVALID_INSTANTLY_CLI_MODE");
    console.log(
      JSON.stringify(
        await (async () => {
          const s = await files.allStore.load();
          return s?.version === 4
            ? bdReport(s)
            : s?.version === 3
              ? bReport(s)
              : instantlyLedgerReport(s);
        })(),
        null,
        2,
      ),
    );
    return;
  }
  // Validate flags before lock/mkdir/environment access. These flags do not grant human consent.
  if (
    values.phase !== "A" ||
    !values["included-calls-confirmed"] ||
    (values["recover-pagination"]
      ? values["authorized-new"] !== "8" || values["authorized-total"] !== "12"
      : values["authorized-new"] !== "12" ||
        values["authorized-total"] !== undefined)
  )
    throw new S00RunError(
      values["recover-pagination"]
        ? "INSTANTLY_RECOVERY_AUTHORIZATION_REQUIRED"
        : "INSTANTLY_A_AUTHORIZATION_REQUIRED",
    );
  const controller = new AbortController(),
    stop = () => controller.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    const result = await files.locked(async () => {
      if (values["recover-pagination"])
        return recoverInstantlyPagination(process.env, files.ledgerStore, {
          execute: true,
          phase: "A",
          authorizedNew: 8,
          authorizedTotal: 12,
          includedCallsConfirmed: true,
          signal: controller.signal,
        });
      return runInstantlyPhaseA(process.env, files.store, {
        execute: true,
        phase: "A",
        authorizedNew: 12,
        includedCallsConfirmed: true,
        signal: controller.signal,
      });
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "completed" || result.blockers.length)
      process.exitCode = 2;
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}
main().catch((e) => {
  // Exceptions from parsing flags, filesystem, transport or schemas can contain secrets/PII.
  console.error(
    JSON.stringify({
      error: e instanceof S00RunError ? e.code : "INSTANTLY_CLI_FAILED",
    }),
  );
  process.exitCode = 2;
});
