import { open, mkdir, readFile, rename, unlink, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  runComposioTest,
  S00RunError,
  validateRunState,
  type RunState,
} from "./s00-composio-runner";

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: "string", default: "status" },
      execute: { type: "boolean", default: false },
      "included-calls-confirmed": { type: "boolean", default: false },
      "provided-pdfs-authorized": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const action = values.action;
  if (
    !["status", "prepare", "send", "inspect", "confirm", "usage"].includes(
      action ?? "",
    )
  )
    throw new S00RunError("INVALID_ACTION");
  const folder = resolve(".local/pipeline-os"),
    path = resolve(folder, "s00-composio-run.json"),
    temporary = path + ".tmp",
    lockPath = path + ".lock";
  await mkdir(folder, { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    throw new S00RunError("JOURNAL_LOCKED");
  }
  try {
    if (values.execute) {
      try {
        await stat(resolve(folder, "s00-composio-reconnect.json"));
        throw new S00RunError("RECONNECT_LEDGER_SUPERSEDES_RUNNER");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      try {
        await stat(resolve(folder, "s00-composio-observation.json"));
        throw new S00RunError("OBSERVATION_LEDGER_SUPERSEDES_RUNNER");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    const store = {
      async load() {
        let text;
        try {
          text = await readFile(path, "utf8");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw new S00RunError("JOURNAL_READ_ERROR");
        }
        if (Buffer.byteLength(text) > 32768)
          throw new S00RunError("INVALID_JOURNAL");
        try {
          return validateRunState(JSON.parse(text));
        } catch {
          throw new S00RunError("INVALID_JOURNAL");
        }
      },
      async save(state: RunState) {
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify(state, null, 2) + "\n");
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      },
    };
    const result = await runComposioTest(
      process.env,
      store,
      action as "status" | "prepare" | "send" | "inspect" | "confirm" | "usage",
      {
        execute: values.execute,
        includedCallsConfirmed: values["included-calls-confirmed"],
        providedPdfsAuthorized: values["provided-pdfs-authorized"],
      },
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      error: error instanceof S00RunError ? error.code : "S00_RUNNER_FAILED",
    }),
  );
  process.exitCode = 2;
});
