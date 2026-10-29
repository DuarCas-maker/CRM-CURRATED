// Status is offline by default. No dotenv, implicit source/env loading or OAuth browser launch.
import { parseArgs } from "node:util";
import {
  runComposioReconnect,
  assertReconnectPermission,
  type ReconnectAction,
  type ReconnectOptions,
} from "./s00-composio-reconnect";
import { reconnectFiles } from "./s00-composio-reconnect-files";
import { fail, S00RunError } from "./s00-composio-common";
import {
  runComposioCorrection,
  correctionReport,
  correctionTargetCheck,
  assertCorrectionPermission,
  type CorrectionAction,
  type CorrectionOptions,
} from "./s00-composio-correction";
import { reconnectReport } from "./s00-composio-reconnect";

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: "string", default: "status" },
      execute: { type: "boolean", default: false },
      "authorized-total": { type: "string" },
      "authorize-connection-management": { type: "boolean", default: false },
      "included-calls-confirmed": { type: "boolean", default: false },
      "gates-confirmed": { type: "boolean", default: false },
      "oauth-completed": { type: "boolean", default: false },
      "recovery-confirmed": { type: "boolean", default: false },
      "authorize-identity-diagnostic": { type: "boolean", default: false },
      "authorize-m1-correction": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    ![
      "status",
      "prepare",
      "revoke",
      "verify",
      "recover",
      "reconcile",
      "inspect_identity",
      "correct_precheck",
      "correct_prepare",
      "correct_verify",
      "correct_reconcile",
      "correct_deliver",
    ].includes(values.action!)
  )
    return fail("INVALID_ACTION");
  const files = reconnectFiles(process.cwd()),
    action = values.action as ReconnectAction;
  if (values.action === "correct_precheck") {
    const ledger = await files.ledgerStore.load();
    if (!ledger) return fail("CORRECTION_PREDECESSOR_REQUIRED");
    console.log(
      JSON.stringify(
        correctionTargetCheck(
          await files.targetText(),
          ledger.version === 2 ? ledger.predecessor : ledger,
          await files.sources(),
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (!values.execute || action === "status") {
    const ledger = await files.ledgerStore.load();
    console.log(
      JSON.stringify(
        ledger?.version === 2
          ? correctionReport(ledger)
          : reconnectReport(ledger),
        null,
        2,
      ),
    );
    return;
  }
  if (values.action!.startsWith("correct_")) {
    const options: CorrectionOptions = {
      execute: true,
      authorizedTotal: values["authorized-total"] === "97" ? 97 : undefined,
      correctionAuthorized: values["authorize-m1-correction"],
      managementAuthorized: values["authorize-connection-management"],
      includedCallsConfirmed: values["included-calls-confirmed"],
      oauthCompleted: values["oauth-completed"],
      gates: values["gates-confirmed"]
        ? {
            managementPermission: true,
            operatorReady: true,
            grantIsolated: true,
            noVerifier: true,
          }
        : undefined,
    };
    assertCorrectionPermission(options);
    const abort = new AbortController(),
      stop = () => abort.abort();
    options.signal = abort.signal;
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
      const result = await files.locked(async () =>
        runComposioCorrection(
          process.env,
          await files.sources(),
          files.ledgerStore,
          values.action as CorrectionAction,
          await files.targetText(),
          options,
        ),
      );
      console.log(JSON.stringify(result, null, 2));
      if (
        result &&
        (["blocked", "recovery_required"].includes(result.phase) ||
          result.usageError ||
          (result.phase === "completed" && !result.closureComplete))
      )
        process.exitCode = 2;
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    return;
  }
  const options: ReconnectOptions = {
    execute: true,
    authorizedTotal: values["authorized-total"] === "88" ? 88 : undefined,
    managementAuthorized: values["authorize-connection-management"],
    includedCallsConfirmed: values["included-calls-confirmed"],
    gates: values["gates-confirmed"]
      ? {
          managementPermission: true,
          operatorReady: true,
          grantIsolated: true,
          noVerifier: true,
        }
      : undefined,
    oauthCompleted: values["oauth-completed"],
    recoveryConfirmed: values["recovery-confirmed"],
    identityDiagnosticAuthorized: values["authorize-identity-diagnostic"],
  };
  assertReconnectPermission(options);
  if ((await files.ledgerStore.load())?.version === 2)
    return fail("CORRECTION_LEDGER_REQUIRES_V2");
  const abort = new AbortController(),
    stop = () => abort.abort();
  options.signal = abort.signal;
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const result = await files.locked(async () =>
      runComposioReconnect(
        process.env,
        await files.sources(),
        files.store,
        action,
        options,
      ),
    );
    console.log(JSON.stringify(result, null, 2));
    if (
      ["blocked", "recovery_required", "revocation_uncertain"].includes(
        result.phase,
      ) ||
      result.usageError ||
      (result.phase === "completed" && !result.closureComplete)
    )
      process.exitCode = 2;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      error: e instanceof S00RunError ? e.code : "S00_RECONNECT_FAILED",
    }),
  );
  process.exitCode = 2;
});
